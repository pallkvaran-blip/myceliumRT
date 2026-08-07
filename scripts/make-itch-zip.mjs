/* Build the itch.io HTML5 zip.
 *
 *   node scripts/make-itch-zip.mjs            -> dist/mycelium-itch.zip
 *   node scripts/make-itch-zip.mjs --keep-dev  (diagnostic only; never upload this)
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
const ZIP = path.join(OUT_DIR, 'mycelium-itch.zip');
const keepDev = process.argv.includes('--keep-dev');
// Leave `dist/stage/` behind. Only CI wants this: GitHub zips an artifact's CONTENTS, so uploading
// the STAGE gives a downloaded artifact that is itself a valid itch zip — see the workflow.
const keepStage = process.argv.includes('--keep-stage');

const say = (...a) => console.log(...a);
const mb = (n) => (n / 1048576).toFixed(1) + ' MB';

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

const SRC = path.join(ROOT, 'assets');
let copied = 0, skipped = 0;
for (const name of fs.readdirSync(SRC)) {
  const from = path.join(SRC, name);
  if (!fs.statSync(from).isDirectory()) { fs.copyFileSync(from, path.join(STAGE, 'assets', name)); copied++; continue; }
  // A folder is either SHARED ART (cards, species, music, …) or one map's sprites. Shared art has
  // no level of that name, so "is there a level with this id?" is the whole test — and it is
  // derived rather than listed, so a new shared folder needs no edit here.
  const isLevelFolder = fs.existsSync(path.join(levelsDir, name + '.json'))
    || fs.readdirSync(from).some((f) => /^r\d+\.webp$/.test(f));
  if (isLevelFolder && !reachable.has(name)) { skipped++; continue; }
  execFileSync('cp', ['-a', from, path.join(STAGE, 'assets', name)]);
  copied++;
}
say(`assets: ${copied} folders/files staged, ${skipped} unreachable map folders skipped`);

// ...AND THE MANIFEST HAS TO AGREE. `loadAssets` holds `kind: 'level'` entries back from the boot
// preload, so a stale one would not hang the boot — but it would 404 the moment anything asked for
// it, and leaving 2,215 entries describing files that are not in the zip is a trap for the next
// person. Filtered to the folders actually staged.
const mfPath = path.join(STAGE, 'assets', 'manifest.json');
const mf = JSON.parse(fs.readFileSync(mfPath, 'utf8'));
const before = mf.assets.length;
mf.assets = mf.assets.filter((a) => a.kind !== 'level' || reachable.has(String(a.file).split('/')[0]));
fs.writeFileSync(mfPath, JSON.stringify(mf, null, 2));
say(`manifest: ${before} entries -> ${mf.assets.length}`);

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
const ITCH_MAX_ENTRIES = 1000;
say(`entries: ${entries.length} / ${ITCH_MAX_ENTRIES} (itch's HTML5 cap)`);
if (entries.length > ITCH_MAX_ENTRIES) {
  console.error(`FAILED: ${entries.length} entries — itch rejects an HTML5 zip over ${ITCH_MAX_ENTRIES}.`);
  process.exit(1);
}
if (!keepStage) fs.rmSync(STAGE, { recursive: true, force: true });
else say(`stage kept at ${path.relative(ROOT, STAGE)} (its CONTENTS are a valid itch zip on their own)`);
if (!rootHtml || strays.length) process.exit(1);
