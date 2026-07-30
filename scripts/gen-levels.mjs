#!/usr/bin/env node
// =============================================================================
// gen-levels.mjs — inject docs/levels/*.json into index.html's __m_levels_data.
//
// Upstream generated src/levels-data.js from docs/levels/*.json and then built the
// bundle. There is no build step here (index.html IS the build output), so this
// rewrites the `const LEVELS = [ … ]` array inside the __m_levels_data module in
// place, between the two markers below.
//
//   node scripts/gen-levels.mjs          # rewrite the inline array
//   node scripts/gen-levels.mjs --check  # exit 1 if index.html is out of date
//
// The inline copy is what the game reads and is therefore the source of truth at
// RUNTIME — but it is generated, so edit the JSON (or the authoring script that
// writes it) and re-run this, rather than hand-editing index.html.
// =============================================================================

import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { dirname, resolve, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');
const LEVELS_DIR = resolve(ROOT, 'docs/levels');
const INDEX = resolve(ROOT, 'index.html');

const BEGIN = 'const LEVELS = [';
const END = '];';

const check = process.argv.includes('--check');

// ---- collect + validate -----------------------------------------------------
const files = existsSync(LEVELS_DIR)
  ? readdirSync(LEVELS_DIR).filter((f) => f.endsWith('.json')).sort()
  : [];

const levels = [];
const claimed = new Map();     // campaignLevel -> file, so two maps can't claim one slot
for (const f of files) {
  const path = resolve(LEVELS_DIR, f);
  let obj;
  try { obj = JSON.parse(readFileSync(path, 'utf8')); } catch (e) {
    fail(`${f}: not valid JSON — ${e.message}`);
  }
  if (obj.format !== 'mycelium-level') fail(`${f}: format is ${JSON.stringify(obj.format)}, expected "mycelium-level"`);
  if ((obj.version | 0) > 1) fail(`${f}: version ${obj.version} is newer than the loader (1)`);
  if (!Array.isArray(obj.objects)) fail(`${f}: no objects array`);
  const slot = obj.campaignLevel;
  if (slot != null) {
    if (claimed.has(slot)) fail(`${f}: campaign level ${slot} is already claimed by ${claimed.get(slot)}`);
    claimed.set(slot, f);
  }
  levels.push({ file: f, id: obj.id || basename(f, '.json'), obj });
}

// ---- render the array -------------------------------------------------------
// One object per line inside each level, so a geometry change shows up as a
// handful of changed lines in the diff rather than one 40 KB line.
const render = (l) => {
  const { objects, ...rest } = l.obj;
  const head = JSON.stringify({ ...rest, objects: '@@' }, null, 2)
    .split('\n').map((line) => '  ' + line).join('\n');
  const body = objects.map((o) => '      ' + JSON.stringify(o)).join(',\n');
  return head.replace('"@@"', `[\n${body}\n    ]`);
};

const block = levels.length
  ? `${BEGIN}\n${levels.map(render).join(',\n')}\n${END}`
  : `${BEGIN}\n  \n${END}`;

// ---- splice into index.html -------------------------------------------------
const src = readFileSync(INDEX, 'utf8');
const i0 = src.indexOf(BEGIN);
if (i0 < 0) fail(`could not find "${BEGIN}" in index.html`);
const i1 = src.indexOf(`\n${END}`, i0);
if (i1 < 0) fail(`could not find the end of the LEVELS array in index.html`);
const out = src.slice(0, i0) + block + src.slice(i1 + 1 + END.length);

if (check) {
  if (out !== src) fail('index.html is out of date — run: node scripts/gen-levels.mjs');
  console.log(`index.html is up to date (${levels.length} authored level(s))`);
  process.exit(0);
}

writeFileSync(INDEX, out);
console.log(`injected ${levels.length} authored level(s) into index.html:`);
for (const l of levels) {
  const slot = l.obj.campaignLevel != null ? `campaign level ${l.obj.campaignLevel}` : 'no campaign slot (#level,' + l.id + ')';
  console.log(`  ${l.id} — ${l.obj.objects.length} objects, ${slot}`);
}

function fail(msg) { console.error('gen-levels: ' + msg); process.exit(1); }
