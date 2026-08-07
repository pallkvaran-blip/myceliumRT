/* Build the HTML5 zip, for itch.io or for CrazyGames.
 *
 *   node scripts/make-web-zip.mjs                          -> dist/mycelium-itch.zip
 *   node scripts/make-web-zip.mjs --platform crazygames    -> dist/mycelium-crazygames.zip
 *   node scripts/make-web-zip.mjs --keep-dev                (diagnostic only; never upload this)
 *
 * TWO TARGETS, AND THE ONLY DIFFERENCE IS THE SDK. CrazyGames measures a game's initial download
 * as the bytes between load start and the first `gameplayStart` event and rejects a submission
 * that never fires one — so their build gets
 * `<script src="https://sdk.crazygames.com/crazygames-sdk-v3.js">` injected ahead of the game.
 * The ITCH build must NOT have it: the zip is self-contained by design, and the tag would be a
 * cross-origin request on every boot that can only fail there (off-platform the SDK reports
 * `"disabled"` and every call throws). The call sites live in index.html either way and no-op
 * without `window.CrazyGames`, so the repo and the itch build are byte-identical to before.
 *
 * Their caps are looser than itch's — 1500 files and 250 MB against 1000 and no stated size — but
 * the prune runs for both: 980 entries and 42.8 MB clears everything, and shipping map art nobody
 * can open helps no one.
 *
 * THE DEV FLAG IS FLIPPED AT BUILD TIME, NOT IN THE REPO. `CONFIG.dev.enabled` stays `true` on the
 * branch because that is what the owner tests with AND what the checks need — it gates the visible
 * dev buttons, the map switcher, the rock editor, the minimised carousel and the skipped level
 * intro, and `edit-check` / `mapmenu-check` drive those directly. Flipping it in the tree to cut a
 * zip means either committing a change that breaks the suite or remembering to flip it back, and
 * "remembering" is exactly the step that gets skipped. So the build patches a COPY and asserts the
 * patch landed.
 *
 * WHAT GOES IN: `index.html` + `assets/` AT THE ZIP ROOT. Not inside a folder — itch serves a
 * directory listing instead of the game if the html is one level down. No `docs/`, no `tests/`,
 * no `scripts/`.
 *
 * itch project settings, which this script cannot set for you:
 *   HTML5 · fullscreen button ON · mobile-friendly ON · viewport 1280x720
 *
 * And the thing most easily forgotten, from the old notes: a fix is not "shipped" when it is
 * pushed, it is shipped when the zip goes up.
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = path.join(ROOT, 'dist');
const STAGE = path.join(OUT_DIR, 'stage');
const argAt = (flag) => { const i = process.argv.indexOf(flag); return i >= 0 ? process.argv[i + 1] : null; };
const PLATFORM = (argAt('--platform') || 'itch').toLowerCase();
if (PLATFORM !== 'itch' && PLATFORM !== 'crazygames') {
  console.error(`FAILED: unknown --platform "${PLATFORM}". Use itch or crazygames.`);
  process.exit(2);
}
// itch caps an HTML5 zip at 1000 entries; CrazyGames at 1500 files and 250 MB. Each build is
// checked against ITS OWN platform's limit rather than the tighter of the two, so a future
// CrazyGames-only map cannot be blocked by a cap that does not apply to it.
const LIMITS = { itch: { entries: 1000, bytes: null }, crazygames: { entries: 1500, bytes: 250 * 1048576 } }[PLATFORM];
const ZIP = path.join(OUT_DIR, `mycelium-${PLATFORM}.zip`);
const keepDev = process.argv.includes('--keep-dev');
// Leave `dist/stage/` behind. Only CI wants this: GitHub zips an artifact's CONTENTS, so uploading
// the STAGE gives a downloaded artifact that is itself a valid itch zip — see the workflow.
const keepStage = process.argv.includes('--keep-stage');

const say = (...a) => console.log(...a);
const mb = (n) => (n / 1048576).toFixed(1) + ' MB';
const die = (m) => { console.error('\nmake-itch-zip: ' + m); process.exit(2); };

// ---- 1. the html, with the dev flag off ------------------------------------
let html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');

// Anchored on the comment that sits directly above it, so this cannot match some other
// `enabled: true` elsewhere in a 2 MB file. If the anchor ever moves, the build FAILS rather than
// quietly shipping the dev buttons — which is the whole point of doing it here.
const ANCHOR = '// itch zip, and confirm with scratchpad/verify-nodev.mjs.\n    enabled: true,';
if (!keepDev) {
  if (!html.includes(ANCHOR)) {
    console.error('FAILED: could not find CONFIG.dev.enabled. The anchor comment has moved —\n' +
                  'fix this script rather than shipping a build with the dev buttons in it.');
    process.exit(2);
  }
  html = html.replace(ANCHOR, ANCHOR.replace('enabled: true,', 'enabled: false,'));
  // Belt to the brace: prove the value the RUNTIME will read is false, not merely that a string
  // was replaced. The literal is `enabled: false,` inside the `dev:` block.
  const devBlock = html.slice(html.indexOf('  dev: {'), html.indexOf('  dev: {') + 900);
  if (!/enabled:\s*false,/.test(devBlock)) {
    console.error('FAILED: dev.enabled is still true after patching.');
    process.exit(2);
  }
  say('dev buttons: OFF (patched in the staged copy; index.html on the branch is untouched)');
} else {
  say('dev buttons: ON  — --keep-dev was passed. DO NOT UPLOAD THIS.');
}

// ---- 1b. the CrazyGames SDK, injected only for that target ------------------
// Ahead of the game's own <script>, so `window.CrazyGames` exists by the time `CRAZY.init()` runs.
// Anchored on </head>, and the build FAILS if that anchor is missing rather than producing a
// CrazyGames zip with no SDK in it — which is precisely the submission failure this target exists
// to fix, and it would look identical to a working build from the outside.
const SDK_TAG = '<script src="https://sdk.crazygames.com/crazygames-sdk-v3.js"></script>';
if (PLATFORM === 'crazygames') {
  if (!html.includes('</head>')) {
    console.error('FAILED: no </head> to inject the CrazyGames SDK before.');
    process.exit(2);
  }
  html = html.replace('</head>', '  ' + SDK_TAG + '\n</head>');
  say('CrazyGames SDK: injected before </head>');
} else if (/<script[^>]*sdk\.crazygames\.com/.test(html)) {
  // A SCRIPT TAG, not the bare string: index.html's own comments name the SDK URL when explaining
  // why the calls are guarded, and a substring test refused every itch build over a comment.
  console.error('FAILED: the itch build must not LOAD the CrazyGames SDK.');
  process.exit(2);
} else {
  say('CrazyGames SDK: not included (itch build is self-contained)');
}

// ---- 2. stage index.html + ONLY THE ASSETS A PUBLIC BUILD CAN REACH ---------
//
// ITCH CAPS AN HTML5 ZIP AT 1,000 ENTRIES. The whole `assets/` tree is 2,383 files across 65
// folders and the upload was rejected with "Too many files in zip (2450 > 1000)". Most of that is
// dead weight in a PUBLIC build: there are 58 traced map folders in the manifest and only the
// CAMPAIGN and SURVIVAL maps can ever be loaded once the dev flag is off — the map switcher, the
// rock editor and `#level,<id>` are all gated on it. So the build ships the reachable levels and
// nothing else: 1,493 files for maps nobody can open, gone.
//
// It is a BUILD-TIME prune, never a deletion. Every one of those maps is still in the repo and
// still reachable in development; CLAUDE.md's "deleting a level is three deletions" does not apply
// because nothing is being deleted.
const levelsDir = path.join(ROOT, 'docs', 'levels');
const reachable = new Set();
for (const f of fs.readdirSync(levelsDir).filter((n) => n.endsWith('.json'))) {
  const def = JSON.parse(fs.readFileSync(path.join(levelsDir, f), 'utf8'));
  if (def.campaignLevel || def.survival) reachable.add(def.assetsFrom || def.id);
}
say(`levels a public build can reach: ${reachable.size} folders`);

fs.rmSync(STAGE, { recursive: true, force: true });
fs.mkdirSync(path.join(STAGE, 'assets'), { recursive: true });
fs.writeFileSync(path.join(STAGE, 'index.html'), html);

// ---- ...AND THE ART A PUBLIC BUILD CANNOT REACH EITHER ----------------------
//
// The level prune above is about MAPS. This is the rest of the dead weight, and it is dead for the
// same reason: with the dev flag off every reachable level is AUTHORED, so the procedural drawing
// paths never run.
//
//   rockform1-14     drawn only by `drawRockFormations` / `drawBoulder`, the PROCEDURAL rock. An
//                    authored map's rock is `sub.levelSprites` through `drawLevelRocks`.
//   rockface/troll   `placeRockface()` returns early for any level with a `levelDef` — i.e. all of
//                    them — so the Magic Mushroom rock cannot appear in a public build at all.
//
// Measured: 1.06 MB and 15 entries. Small next to the maps, but it is waste with no upside, and the
// entry count is what itch actually caps. Derived from the MANIFEST rather than listed here, so a
// new procedural sprite needs no edit in this file.
//
// ARCHIVED CARD ART WAS THE THIRD CANDIDATE AND IT IS NOT SAFE — 468 KB, and both halves of the
// reasoning were wrong. `isArchived` keeps a card out of the DRAFT POOL, but the deck sheet and the
// card-face hover build faces straight from `CARD_DATA`, which still holds all 71 — so the art is
// requested and `itchzip-check` caught `leaf-litter-cache.jpg` 404ing in a real run. Worse, reading
// the names out of the `ARCHIVED` set by regex over-matched the PROSE COMMENTS inside it and
// pruned `tropic-lunge.jpg`, art for a card that is still in the game. Two 404s for 468 KB. If
// this is ever wanted, the names have to come from the module at runtime (`__game.cards.active()`)
// and every screen that can render a card face has to be checked first.
const DEAD_FILES = new Set(['rockface/troll.png']);
for (const a of JSON.parse(fs.readFileSync(path.join(ROOT, 'assets', 'manifest.json'), 'utf8')).assets) {
  if (/^rockform\d+$/.test(a.key)) DEAD_FILES.add(String(a.file));
}
say(`unreachable art: ${DEAD_FILES.size} files (the procedural boulders, the troll rock)`);

const SRC = path.join(ROOT, 'assets');
let copied = 0, skipped = 0, dead = 0;
const stageFile = (rel) => {
  if (DEAD_FILES.has(rel)) { dead++; return false; }
  const to = path.join(STAGE, 'assets', rel);
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.copyFileSync(path.join(SRC, rel), to);
  return true;
};
for (const name of fs.readdirSync(SRC)) {
  const from = path.join(SRC, name);
  if (!fs.statSync(from).isDirectory()) { stageFile(name); copied++; continue; }
  // A folder is either SHARED ART (cards, species, music, …) or one map's sprites. Shared art has
  // no level of that name, so "is there a level with this id?" is the whole test — and it is
  // derived rather than listed, so a new shared folder needs no edit here.
  const isLevelFolder = fs.existsSync(path.join(levelsDir, name + '.json'))
    || fs.readdirSync(from).some((f) => /^r\d+\.webp$/.test(f));
  if (isLevelFolder && !reachable.has(name)) { skipped++; continue; }
  // Copied file by file rather than `cp -a` so the dead-art filter reaches inside a folder —
  // the archived card art and the troll rock both live in one.
  for (const f of fs.readdirSync(from)) stageFile(name + '/' + f);
  copied++;
}
say(`assets: ${copied} folders/files staged, ${skipped} unreachable map folders skipped, ${dead} unreachable art files skipped`);
// A path that matched nothing means the derivation has gone stale. Note this guard is NOT enough on
// its own — it only proves the file existed, not that the game had stopped asking for it, which is
// how the archived-card attempt above passed here and still shipped two 404s. `itchzip-check`'s
// "no failed requests" assertion is the one that actually covers this.
if (dead !== DEAD_FILES.size) die(`${DEAD_FILES.size - dead} of the unreachable-art paths matched no file — the derivation is stale, fix it rather than shipping a prune that silently does nothing`);

// ...AND THE MANIFEST HAS TO AGREE. `loadAssets` holds `kind: 'level'` entries back from the boot
// preload, so a stale one would not hang the boot — but it would 404 the moment anything asked for
// it, and leaving 2,215 entries describing files that are not in the zip is a trap for the next
// person. Filtered to the folders actually staged.
const mfPath = path.join(STAGE, 'assets', 'manifest.json');
const mf = JSON.parse(fs.readFileSync(mfPath, 'utf8'));
const before = mf.assets.length;
mf.assets = mf.assets
  .filter((a) => a.kind !== 'level' || reachable.has(String(a.file).split('/')[0]))
  // The procedural boulders are EAGER entries, so a stale one here is worse than a stale level
  // entry: `loadAssets` waits for every non-level entry to settle, and one that 404s never does.
  .filter((a) => !DEAD_FILES.has(String(a.file)));
fs.writeFileSync(mfPath, JSON.stringify(mf, null, 2));
say(`manifest: ${before} entries -> ${mf.assets.length}`);

// ---- 2c. re-encode, in the stage only ---------------------------------------
//
// HIGH QUALITY ON PURPOSE — this is not the CrazyGames pass. That build has a 20 MB ceiling to
// clear and spends real picture quality doing it; itch has no ceiling, so the only thing taken
// here is what cannot be seen. Measured on the largest garnet-c40 sprites: webp q85 is 80% of the
// original at PSNR 39.6 dB, against 53% and 34.9 dB for the q75 the CrazyGames build uses.
//
// ALPHA IS BIT-IDENTICAL AT EVERY QUALITY (measured, max delta 0) and alpha is what `solidifyRock`
// and `_alphaMask` sample — so no wall can move, whatever these are set to.
//
// PNGs are left ALONE (`--png 0`): quantising them is 31% of the size but it is a real colour
// change, and there is no ceiling here worth paying it for. Music drops 182 -> 128 kb/s, still a
// transparent bitrate for ambient pads, and no track is cut.
if (!process.argv.includes('--no-shrink')) {
  say('re-encoding at high quality (a few minutes — libwebp method=6):');
  execFileSync('python3', [path.join(ROOT, 'scripts', 'shrink-assets.py'), path.join(STAGE, 'assets'),
    '--rock', '85', '--card', '85', '--species', '85', '--png', '0'], { stdio: 'inherit' });
  let ff = null;
  try { ff = execFileSync('python3', ['-c', 'import imageio_ffmpeg;print(imageio_ffmpeg.get_ffmpeg_exe())'], { encoding: 'utf8' }).trim(); }
  catch (e) { say('  ! no ffmpeg (pip install imageio-ffmpeg) — music left at full bitrate'); }
  if (ff) {
    const dir = path.join(STAGE, 'assets', 'music');
    let o = 0, n = 0;
    for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.mp3'))) {
      const p = path.join(dir, f), tmp = p + '.tmp.mp3';
      o += fs.statSync(p).size;
      execFileSync(ff, ['-v', 'error', '-y', '-i', p, '-c:a', 'libmp3lame', '-b:a', '128k', '-ar', '44100', tmp]);
      if (fs.statSync(tmp).size < fs.statSync(p).size) fs.renameSync(tmp, p); else fs.rmSync(tmp);
      n += fs.statSync(p).size;
    }
    say(`  mp3   ${fs.readdirSync(dir).length} files  ${mb(o)} -> ${mb(n)}  (128 kb/s, no track cut)`);
  }
}

// ---- 3. zip, from INSIDE the stage so paths are root-relative ---------------
// `-D` = NO DIRECTORY ENTRIES. itch counts them against the 1,000 cap (2,383 files reported as
// 2,450), and they carry nothing a browser needs.
fs.rmSync(ZIP, { force: true });
execFileSync('zip', ['-q', '-r', '-9', '-D', ZIP, 'index.html', 'assets'], { cwd: STAGE });

// ---- 4. report, and check the shape ----------------------------------------
const size = fs.statSync(ZIP).size;
// `unzip -Z1` lists PATHS ONLY — one per line, no header, no column ruler and no "N files"
// trailer. `unzip -l` needs all three stripped, and the first version's trailer parsed as a
// top-level entry called "files".
const entries = execFileSync('unzip', ['-Z1', ZIP], { encoding: 'utf8' })
  .split('\n').map((l) => l.trim()).filter(Boolean);
const top = new Set(entries.map((e) => e.split('/')[0]));
const rootHtml = entries.includes('index.html');
const strays = [...top].filter((t) => t !== 'index.html' && t !== 'assets');

say(`zip: ${path.relative(ROOT, ZIP)}  ${mb(size)}  (${entries.filter((e) => !e.endsWith('/')).length} files)`);
say(`index.html at the zip ROOT: ${rootHtml ? 'yes' : 'NO — itch will serve a directory listing'}`);
if (strays.length) say(`unexpected top-level entries: ${strays.join(', ')}`);
if (size > 200 * 1048576) say('WARNING: over 200 MB — itch caps a single file at 1 GB, but this is a browser download.');
// The cap that actually bit. Reported as an upload failure with no way to see it coming.
say(`entries: ${entries.length} / ${LIMITS.entries} (${PLATFORM}'s cap)`);
if (entries.length > LIMITS.entries) {
  console.error(`FAILED: ${entries.length} entries — ${PLATFORM} rejects a zip over ${LIMITS.entries}.`);
  process.exit(1);
}
if (LIMITS.bytes && size > LIMITS.bytes) {
  console.error(`FAILED: ${mb(size)} — ${PLATFORM} caps a game at ${mb(LIMITS.bytes)}.`);
  process.exit(1);
}
if (!keepStage) fs.rmSync(STAGE, { recursive: true, force: true });
else say(`stage kept at ${path.relative(ROOT, STAGE)} (its CONTENTS are a valid itch zip on their own)`);
if (!rootHtml || strays.length) process.exit(1);
