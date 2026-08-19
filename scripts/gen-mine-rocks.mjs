#!/usr/bin/env node
// Splice the DEEP MINE's rock library into index.html, from the owner's own editor exports.
//
// `docs/mine/*.json` is one `mycelium-level` export per ROCK TYPE — the owner opened a traced
// map in the in-game editor, kept the boulders they wanted for that type at the sizes they
// wanted them, and pasted Copy JSON out. That subset IS the signal: anthracite's source map has
// 47 rocks and the export keeps 42, hematite's has 50 and keeps 28. So this reads the exports,
// not the source maps.
//
// What lands in index.html is, per theme, `{ k, w, h }` for each sprite: the key the manifest
// knows it by and the size the owner placed it at. `__m_engine_mine` scales those per depth band
// (CONFIG.mine.bands[].scale), which is what "use them in different sizes" means — a multiple of
// the owner's own size rather than a number invented in the generator.
//
//   node scripts/gen-mine-rocks.mjs            # write
//   node scripts/gen-mine-rocks.mjs --check    # fail if index.html is stale (CI / pre-commit)
//
// THE THEME NAME COMES FROM THE SPRITE KEY, NOT THE FILE NAME. A key is `<assetsFrom>R<nnn>`
// (`anthracite-c24R017`), and the export's own `id` is the owner's map name — `anthracite-24-main`
// — which is NOT the asset folder. Parsing the id would name a folder that does not exist and the
// rocks would silently 404, so the folder is taken from the keys and every key in one file must
// agree on it.

import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(ROOT, 'docs', 'mine');
const PAGE = join(ROOT, 'index.html');
const OPEN = '// <mine-rocks>';
const CLOSE = '// </mine-rocks>';

// Depth order, shallowest first — it must match CONFIG.mine.bands[].theme, and the build fails
// rather than shipping a band whose library is missing (a band with no rocks generates as bare
// soil, which looks like the generator working and is a whole depth zone with no walls in it).
const ORDER = ['magnetite', 'anthracite', 'garnet', 'hematite'];

function keyFolder(keys, file) {
  const folders = new Set(keys.map((k) => {
    const m = /^(.*?)R\d+$/.exec(k);
    if (!m) throw new Error(`${file}: sprite key "${k}" is not <folder>R<nnn>`);
    return m[1];
  }));
  if (folders.size !== 1) throw new Error(`${file}: sprites span more than one asset folder: ${[...folders].join(', ')}`);
  return [...folders][0];
}

function read() {
  const out = {};
  for (const f of readdirSync(SRC).filter((f) => f.endsWith('.json')).sort()) {
    const def = JSON.parse(readFileSync(join(SRC, f), 'utf8'));
    const rocks = (def.objects || []).filter((o) => o && (o.t === 'boulder' || o.t === 'formation') && o.key);
    if (!rocks.length) throw new Error(`${f}: no rock objects`);
    const folder = keyFolder(rocks.map((o) => o.key), f);
    // A theme is the folder minus its `-c<count>` suffix: `anthracite-c24` -> `anthracite`.
    const theme = folder.replace(/-c\d+$/, '');
    if (out[theme]) throw new Error(`two exports claim theme "${theme}" (${f})`);
    out[theme] = {
      folder,
      rocks: rocks.map((o) => ({ k: o.key, w: +(+o.w).toFixed(1), h: +(+o.h).toFixed(1) })),
    };
  }
  for (const t of ORDER) if (!out[t]) throw new Error(`no export for band theme "${t}" — CONFIG.mine.bands would generate a band with no rock in it`);
  return out;
}

function render(lib) {
  const themes = [...ORDER, ...Object.keys(lib).filter((t) => !ORDER.includes(t))];
  const lines = [`const MINE_ROCKS = {`];
  for (const t of themes) {
    const e = lib[t];
    lines.push(`  // ${t} — ${e.rocks.length} sprites from assets/${e.folder}/`);
    lines.push(`  ${t}: [`);
    for (const r of e.rocks) lines.push(`    { k: '${r.k}', w: ${r.w}, h: ${r.h} },`);
    lines.push(`  ],`);
  }
  lines.push(`};`);
  return lines.join('\n');
}

const lib = read();
const block = render(lib);
const page = readFileSync(PAGE, 'utf8');
const a = page.indexOf(OPEN), b = page.indexOf(CLOSE);
if (a < 0 || b < 0 || b < a) {
  console.error(`index.html: missing the ${OPEN} / ${CLOSE} anchors`);
  process.exit(1);
}
const head = page.slice(0, a + OPEN.length);
const tail = page.slice(b);
const next = `${head}\n${block}\n${tail}`;

const total = Object.values(lib).reduce((n, e) => n + e.rocks.length, 0);
if (process.argv.includes('--check')) {
  if (next !== page) { console.error('index.html is STALE — run: node scripts/gen-mine-rocks.mjs'); process.exit(1); }
  console.log(`mine rocks up to date: ${Object.keys(lib).length} themes, ${total} sprites`);
} else {
  writeFileSync(PAGE, next);
  for (const t of [...ORDER]) console.log(`  ${t.padEnd(12)} ${String(lib[t].rocks.length).padStart(3)} sprites  assets/${lib[t].folder}/`);
  console.log(`wrote ${total} sprites across ${Object.keys(lib).length} themes into index.html`);
}
