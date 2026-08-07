#!/usr/bin/env node
// Builds dist/mycelium-crazygames.zip — the CrazyGames cut.
//
// WHY THIS IS A SECOND SCRIPT AND NOT A FLAG ON make-itch-zip.mjs: the two builds want
// opposite things. itch has a 1,000-ENTRY cap and no size pressure, so that build keeps every
// asset at full quality and prunes only what a public build cannot reach. CrazyGames has no
// entry cap and a hard SIZE preference — under 50 MB, and under 20 MB to also appear in their
// mobile store — so this build keeps fewer maps and re-encodes everything it does keep.
// Folding both into one script would mean a flag on every decision in it.
//
// NOTHING HERE TOUCHES THE REPO. index.html, docs/levels and assets/ are read and never
// written; every transformation lands in dist/cg-stage. That is what lets this live on its own
// branch without index.html diverging from the itch build by a single byte — the CrazyGames SDK
// adapter is INJECTED (scripts/cg-sdk-shim.js), not committed into the game.
//
// Run:  node scripts/make-crazygames-zip.mjs
//       node tests/crazygames-check.cjs        # 24 assertions, against the ARTEFACT
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = path.join(ROOT, 'dist');
const STAGE = path.join(OUT_DIR, 'cg-stage');
const ZIP = path.join(OUT_DIR, 'mycelium-crazygames.zip');
const keepStage = process.argv.includes('--keep-stage');
const keepDev = process.argv.includes('--keep-dev');
const skipEncode = process.argv.includes('--fast');   // stage without re-encoding, for iterating

const say = (...a) => console.log(...a);
const mb = (n) => (n / 1048576).toFixed(2) + ' MB';
const die = (m) => { console.error('\nmake-crazygames-zip: ' + m); process.exit(1); };

// CrazyGames state 50 MB as a strong preference and 20 MB as the threshold for also being
// listed in their mobile store. The build FAILS above the ceiling rather than letting the
// submission be the thing that discovers it, which is the same stance make-itch-zip takes on
// the 1,000-entry cap for the same reason: the far end of that loop is slow and manual.
const MAX_MB = 20;

// ---- what the build keeps ---------------------------------------------------------
// All 9 campaign levels, always — the campaign is the game. Survival draws from a shuffled
// bag of 17 authored maps and each one is ~1-2.4 MB of traced sprites, so the bag is where the
// megabytes are. These 8 are chosen for THEME SPREAD rather than for size: five of them reuse
// a campaign map's `assetsFrom` folder and therefore cost nothing at all, and the other three
// buy the three themes that would otherwise be missing entirely.
//
//   free (already staged for the campaign): anthracite · garnet · obsidian · rust · veined
//   paid:                                   glass 0.96 · crystal 1.80 · biolum 1.63 MB
//
// Changing this list is the first lever if the size target moves. The survival ROTATION needs
// no code change: `survivalMaps()` reads whatever carries `survival: true` in LEVELS, and the
// levels dropped here are dropped from LEVELS too.
const SURVIVAL_KEEP = new Set([
  '0-survival-anthracite-24-main',
  '0-survival-garnet-40-main',
  '0-survival-obsidian-40-main',
  '0-survival-rust-90-main',
  '0-survival-veined-28-main',
  '0-survival-glass-24-main-maybe',
  '0-survival-crystal-36-main',
  '0-survival-bioluminescent-20-main',
]);

// Quality knobs, all measured on the real assets rather than picked. Rock sprites are the
// bulk: webp q85/q80/q75 come out at 80%/64%/53% of the originals across two map folders, at
// PSNR 39.6/36.2/34.9 dB on the three largest garnet sprites — and ALPHA IS BIT-IDENTICAL at
// every one of them (max delta 0), so collision cannot move whatever this is set to.
//
// `audioKbps` IS PICKED FROM A LADDER, NOT A LINE — MP3 has a fixed set of bitrates (…56, 64,
// 80, 96…) and libmp3lame silently rounds anything else DOWN to the nearest one. Asking for 72
// produced a byte-identical result to 64 and cost a build cycle to notice.
//
// Which made the choice 80 kb/s (four tracks, 20.13 MB — over) or 64 (19.09 MB), until the
// owner offered a third option: drop a track. That is strictly better than lowering the
// bitrate, because one whole file buys more than the 16 kb/s does — three tracks at 80 come to
// LESS than four at 64, and the ones that remain sound better.
const Q = { rock: 75, card: 60, species: 70, png: 256, audioKbps: 80 };

// The music is one menu theme (`MENU_TRACK`, played on the title and species screens) and a
// list of level tracks picked at random, never the same one twice running. So a level track is
// the only one that can be dropped — cutting the menu theme would silence the title screen —
// and `backrooms-vol7` is the one to cut: it is both the smallest file and the SHORTEST at
// 1:58, so dropping it keeps the most minutes of music per megabyte. Two level tracks still
// satisfy the module's own `LEVEL_TRACKS.length > 1` alternation guard.
const MUSIC_DROP = new Set(['backrooms-vol7.mp3']);

// ---- 1. the game file -------------------------------------------------------------
let html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const size0 = html.length;

// Same anchored patch as the itch build, and anchored for the same reason: CONFIG.dev.enabled
// stays true on the branch (edit-check and mapmenu-check drive the dev UI directly), so it is
// turned off in the COPY. If the anchor ever moves the build fails rather than quietly
// shipping the dev buttons, the map switcher and the rock editor to a public site.
const ANCHOR = '// itch zip, and confirm with scratchpad/verify-nodev.mjs.\n    enabled: true,';
if (!keepDev) {
  if (!html.includes(ANCHOR)) die('the dev-flag anchor moved — re-point ANCHOR before shipping, or the build ships the dev buttons');
  html = html.replace(ANCHOR, ANCHOR.replace('enabled: true,', 'enabled: false,'));
  say('dev buttons: OFF (patched in the staged copy; index.html on the branch is untouched)');
}

// ---- 2. drop the levels this cut does not ship ------------------------------------
// The LEVELS array must agree with what is staged, and this is the half that is not optional:
// a survival map left in LEVELS but with no assets folder joins the rotation bag and then 404s
// its sprites, and a preload that never completes hangs EVERY map on a black screen. Dropping
// it here removes it from the bag, because the bag is built from LEVELS.
const BEGIN = 'const LEVELS = [';
const i0 = html.indexOf(BEGIN);
if (i0 < 0) die(`could not find "${BEGIN}" in index.html`);
const i1 = html.indexOf('\n];', i0);
if (i1 < 0) die('could not find the end of the LEVELS array');
const levelsSrc = html.slice(i0 + BEGIN.length - 1, i1 + 2);
let LEVELS;
try { LEVELS = new Function('return ' + levelsSrc)(); }
catch (e) { die('could not parse the LEVELS array: ' + e.message); }
if (!Array.isArray(LEVELS) || !LEVELS.length) die('the LEVELS array parsed as empty');

const keptLevels = LEVELS.filter((l) => l.campaignLevel || (l.survival && SURVIVAL_KEEP.has(l.id)));
const campaignCount = keptLevels.filter((l) => l.campaignLevel).length;
const survivalCount = keptLevels.filter((l) => l.survival).length;
if (survivalCount !== SURVIVAL_KEEP.size)
  die(`SURVIVAL_KEEP names ${SURVIVAL_KEEP.size} maps but only ${survivalCount} matched a level id — check the ids`);
if (!campaignCount) die('no campaign levels survived the filter');
// A public build reaches a level through its campaign slot or the survival bag and nowhere
// else (`#level,<id>` and the map switcher are both behind the dev flag), so anything without
// one of those two is unreachable weight — 59 of the 76 here.
html = html.slice(0, i0) + BEGIN + '\n' + JSON.stringify(keptLevels, null, 1).slice(1, -1) + '\n];' + html.slice(i1 + 3);
say(`levels: ${LEVELS.length} -> ${keptLevels.length} (${campaignCount} campaign + ${survivalCount} survival), index.html ${mb(size0)} -> ${mb(html.length)}`);

// ---- 3. the CrazyGames adapter ----------------------------------------------------
// The game is one inline <script> holding all 37 modules. Re-tagging it as an inert type and
// letting the shim inject it for real is what makes "initialise the SDK before the game reads
// storage" possible without editing a single line inside it.
const GAME_TAG = '<script>';
const tagAt = html.indexOf(GAME_TAG);
if (tagAt < 0) die('could not find the game <script> tag');
if (html.indexOf(GAME_TAG, tagAt + 1) >= 0) die('index.html has more than one bare <script> tag — the deferral would pick the wrong one');
const shim = fs.readFileSync(path.join(ROOT, 'scripts', 'cg-sdk-shim.js'), 'utf8');
html = html.slice(0, tagAt) +
  '<script src="https://sdk.crazygames.com/crazygames-sdk-v3.js"></script>\n' +
  '<script>\n' + shim + '\n</script>\n' +
  '<script id="cgGame" type="text/cg-deferred">' +
  html.slice(tagAt + GAME_TAG.length);

// The shim reaches the two mute toggles through this. They are module-scoped `const`s inside
// the one script, so nothing outside it can see them — but code appended at the END of that
// same script is in their scope. One line, and it is why no module had to be edited.
const CLOSE = '\n</script>\n</head>';
if (!html.includes(CLOSE)) die('could not find the end of the game script to append the audio hook');
html = html.replace(CLOSE,
  '\n// -- injected by make-crazygames-zip.mjs: the shim runs in a different <script> and so\n' +
  '// cannot see these module-scoped bindings. Read-only handles; no behaviour changes.\n' +
  'window.__cgAudio = {\n' +
  '  isMusicMuted: __m_render_music.isMusicMuted, toggleMusic: __m_render_music.toggleMusic,\n' +
  '  isSfxMuted: __m_render_sfx.isSfxMuted, toggleSfx: __m_render_sfx.toggleSfx,\n' +
  '};' + CLOSE);
say('CrazyGames SDK: data module wired to storage, game settings wired to mute');

// ---- 3b. drop a music track ---------------------------------------------------------
// The four tracks are named in the source as literal paths, not read from the manifest, so a
// file deleted from the stage has to leave `LEVEL_TRACKS` as well or the game sets `audio.src`
// to a 404 and that level simply plays in silence. The menu theme is refused outright, and so
// is any cut that would leave fewer than two level tracks — `playLevelMusic` picks a random
// index that is not the previous one, which needs two to choose between.
for (const f of MUSIC_DROP) {
  const line = new RegExp(`^\\s*'assets/music/${f.replace(/[.*+?^$()|[\]\\]/g, '\\$&')}',?\\r?\\n`, 'm');
  if (html.includes(`const MENU_TRACK = 'assets/music/${f}'`)) die(`${f} is the menu theme — dropping it would silence the title screen`);
  if (!line.test(html)) die(`${f} is not in LEVEL_TRACKS — MUSIC_DROP would delete a file the game still asks for`);
  html = html.replace(line, '');
}
if (MUSIC_DROP.size) {
  const left = (html.match(/'assets\/music\/[^']+\.mp3'/g) || []).length - 1;   // minus MENU_TRACK
  if (left < 2) die(`only ${left} level track(s) left — playLevelMusic needs two to alternate between`);
  say(`music: dropped ${[...MUSIC_DROP].join(', ')}, ${left} level tracks left`);
}

fs.rmSync(STAGE, { recursive: true, force: true });
fs.mkdirSync(path.join(STAGE, 'assets'), { recursive: true });
fs.writeFileSync(path.join(STAGE, 'index.html'), html);

// ---- 4. assets --------------------------------------------------------------------
const reachable = new Set();
for (const l of keptLevels) reachable.add(l.assetsFrom || l.id);
say(`asset folders a kept level can reach: ${reachable.size}`);

const SRC = path.join(ROOT, 'assets');
let copied = 0, skipped = 0;
for (const name of fs.readdirSync(SRC)) {
  const from = path.join(SRC, name);
  if (name === 'music') {
    fs.mkdirSync(path.join(STAGE, 'assets', 'music'), { recursive: true });
    for (const t of fs.readdirSync(from)) {
      if (MUSIC_DROP.has(t)) continue;
      fs.copyFileSync(path.join(from, t), path.join(STAGE, 'assets', 'music', t));
    }
    copied++; continue;
  }
  if (!fs.statSync(from).isDirectory()) { fs.copyFileSync(from, path.join(STAGE, 'assets', name)); copied++; continue; }
  // A level folder is one holding traced rock sprites; everything else (cards, species,
  // music, tutorial, spores) ships whatever the level set is.
  const isLevelFolder = fs.readdirSync(from).some((f) => /^r\d+\.webp$/.test(f));
  if (isLevelFolder && !reachable.has(name)) { skipped++; continue; }
  execFileSync('cp', ['-a', from, path.join(STAGE, 'assets', name)]);
  copied++;
}
say(`assets: ${copied} folders/files staged, ${skipped} unreachable map folders skipped`);

// ---- 5. re-encode, in the stage only ----------------------------------------------
if (!skipEncode) {
  say('re-encoding images (this takes a few minutes — method=6 is the small end of the dial):');
  execFileSync('python3', [path.join(ROOT, 'scripts', 'cg-encode-assets.py'), path.join(STAGE, 'assets'),
    '--rock', String(Q.rock), '--card', String(Q.card), '--species', String(Q.species), '--png', String(Q.png)],
    { stdio: 'inherit' });

  // Music is 21% of the itch build: four ambient tracks at 168-190 kb/s stereo, which is a
  // music-library bitrate for something playing under a game. ffmpeg comes from the
  // imageio-ffmpeg wheel rather than the system, because this container has no ffmpeg.
  let ff = null;
  try { ff = execFileSync('python3', ['-c', 'import imageio_ffmpeg;print(imageio_ffmpeg.get_ffmpeg_exe())'], { encoding: 'utf8' }).trim(); }
  catch (e) { say('  ! no ffmpeg (pip install imageio-ffmpeg) — music left at full bitrate'); }
  if (ff) {
    const dir = path.join(STAGE, 'assets', 'music');
    let o = 0, n = 0;
    for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.mp3'))) {
      const p = path.join(dir, f), tmp = p + '.tmp.mp3';
      o += fs.statSync(p).size;
      execFileSync(ff, ['-v', 'error', '-y', '-i', p, '-c:a', 'libmp3lame', '-b:a', `${Q.audioKbps}k`, '-ar', '44100', tmp]);
      // Same rule as the images: never let a re-encode make a file bigger.
      if (fs.statSync(tmp).size < fs.statSync(p).size) fs.renameSync(tmp, p); else fs.rmSync(tmp);
      n += fs.statSync(p).size;
    }
    say(`  mp3   ${fs.readdirSync(dir).length} files  ${mb(o)} -> ${mb(n)}  (${Math.round(100 * n / o)}%, ${Q.audioKbps} kb/s)`);
  }
}

// ---- 6. the manifest has to agree ---------------------------------------------------
// A stale `kind: 'level'` entry does not hang the boot (those are held back from the preload)
// but it 404s the moment that map opens. A stale entry for anything else DOES hang it.
const mfPath = path.join(STAGE, 'assets', 'manifest.json');
const mf = JSON.parse(fs.readFileSync(mfPath, 'utf8'));
const before = mf.assets.length;
mf.assets = mf.assets
  .filter((a) => a.kind !== 'level' || reachable.has(String(a.file).split('/')[0]))
  .filter((a) => !MUSIC_DROP.has(path.basename(String(a.file))));
fs.writeFileSync(mfPath, JSON.stringify(mf));
say(`manifest: ${before} entries -> ${mf.assets.length}`);

// ---- 7. zip and check it -------------------------------------------------------------
fs.rmSync(ZIP, { force: true });
execFileSync('zip', ['-q', '-r', '-9', '-D', ZIP, 'index.html', 'assets'], { cwd: STAGE });

const size = fs.statSync(ZIP).size;
const entries = execFileSync('unzip', ['-Z1', ZIP], { encoding: 'utf8' }).split('\n').map((s) => s.trim()).filter(Boolean);
say(`\nzip: ${path.relative(ROOT, ZIP)}  ${mb(size)}  (${entries.length} files)`);

if (!entries.includes('index.html')) die('index.html is not at the zip ROOT');
const strays = [...new Set(entries.map((e) => e.split('/')[0]))].filter((t) => t !== 'index.html' && t !== 'assets');
if (strays.length) die('unexpected top-level entries: ' + strays.join(', '));
if (entries.some((e) => /\.(zip|tar|gz)$/i.test(e))) die('a nested archive is in the zip');

const overBy = size / 1048576 - MAX_MB;
if (overBy > 0) die(`${mb(size)} is over the ${MAX_MB} MB target by ${overBy.toFixed(2)} MB.\n` +
  `  Levers, cheapest first: drop a survival map from SURVIVAL_KEEP (~0.5-1.3 MB each after\n` +
  `  re-encoding), Q.audioKbps 80 -> 64, Q.rock 75 -> 70 (a further ~6% of the sprites).`);
say(`under the ${MAX_MB} MB target with ${(-overBy).toFixed(2)} MB to spare`);

if (!keepStage) fs.rmSync(STAGE, { recursive: true, force: true });
else say(`stage kept at ${path.relative(ROOT, STAGE)}`);
