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

// ---- 2. stage index.html + assets at the zip root ---------------------------
fs.rmSync(STAGE, { recursive: true, force: true });
fs.mkdirSync(STAGE, { recursive: true });
fs.writeFileSync(path.join(STAGE, 'index.html'), html);
// cp -a rather than a hand-rolled walk: `assets/` is ~2,500 files and this is not the interesting
// part of the build.
execFileSync('cp', ['-a', path.join(ROOT, 'assets'), path.join(STAGE, 'assets')]);

// ---- 3. zip, from INSIDE the stage so paths are root-relative ---------------
fs.rmSync(ZIP, { force: true });
execFileSync('zip', ['-q', '-r', '-9', ZIP, 'index.html', 'assets'], { cwd: STAGE });

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
fs.rmSync(STAGE, { recursive: true, force: true });
if (!rootHtml || strays.length) process.exit(1);
