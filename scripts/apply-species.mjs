#!/usr/bin/env node
// Apply docs/species-tool.html's exported JSON back into index.html.
//
//   node scripts/apply-species.mjs /tmp/species.json
//   node scripts/apply-species.mjs /tmp/species.json --dry     # say what would change, write nothing
//
// This is the half that makes the tool a tool. The card-review page has exported decisions nobody
// applied for months, because "export JSON" and "edit a 30k-line file by hand" are not the same
// distance apart. Here the export is already in the game's own shape — three constants plus one hand
// per species — so this only has to place it.
//
// IT REFUSES RATHER THAN HALF-WRITING. Every check runs before a byte is written, and the result is
// re-parsed and compared against the intent before it replaces the file: SPECIES is a JS literal, so
// a bad edit is a page that will not boot, and a page that will not boot is the one failure mode
// worth spending a re-parse to avoid. Nothing is written unless the whole thing lines up.
//
// What it touches, and nothing else: each species' `hand`, `STARTER_SPECIES_IDS`,
// `STORE_SPECIES_IDS`, `STORE_SPECIES_COST`. Blurbs, art, `memory`, `unlock` and the tier machinery
// are left exactly as they are — those are edited in index.html.

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const IDX = join(ROOT, 'index.html');
const args = process.argv.slice(2);
const DRY = args.includes('--dry');
const file = args.find((a) => !a.startsWith('-'));

const die = (msg) => { console.error('apply-species: ' + msg); process.exit(1); };
if (!file) die('give it the exported JSON: node scripts/apply-species.mjs <file.json> [--dry]');

let spec;
try { spec = JSON.parse(readFileSync(file, 'utf8')); }
catch (e) { die(`could not read ${file} as JSON — ${e.message}`); }
if (!spec || spec.format !== 'mycelium-species') die('that is not a species-tool export (no "format": "mycelium-species")');

const html = readFileSync(IDX, 'utf8');
const grab = (re, what) => { const m = html.match(re); if (!m) die(`${what} not found in index.html`); return m; };

const mSpecies = grab(/(\nconst SPECIES = )(\[[\s\S]*?\n\]);\n/, 'SPECIES');
const speciesText = mSpecies[2];
const SPECIES = new Function('return ' + speciesText)();
const CARDS = JSON.parse(grab(/const CARD_DATA = (\[[\s\S]*?\n\]);/, 'CARD_DATA')[1]);
const cardNames = new Set(CARDS.map((c) => c.name));
const ids = new Set(SPECIES.map((s) => s.id));

// ---- validate, all of it, before touching anything --------------------------
const errs = [];
const starters = spec.STARTER_SPECIES_IDS || [];
const store = spec.STORE_SPECIES_IDS || [];
const costs = spec.STORE_SPECIES_COST || {};
const hands = spec.hands || {};

if (!Array.isArray(starters) || starters.length !== 3)
  errs.push(`STARTER_SPECIES_IDS must hold exactly 3 ids (got ${Array.isArray(starters) ? starters.length : typeof starters})`);
if (new Set(starters).size !== starters.length) errs.push('STARTER_SPECIES_IDS repeats an id');
for (const id of starters) if (!ids.has(id)) errs.push(`starter "${id}" is not a species in index.html`);
if (!Array.isArray(store)) errs.push('STORE_SPECIES_IDS must be a list');
for (const id of store) {
  if (!ids.has(id)) errs.push(`store species "${id}" is not a species in index.html`);
  if (starters.indexOf(id) >= 0) errs.push(`"${id}" is both a starter and for sale — a starter needs no purchase`);
  const c = costs[id];
  if (!(Number.isFinite(c) && c >= 0)) errs.push(`store species "${id}" has no usable price (${JSON.stringify(c)})`);
}
for (const id of Object.keys(costs)) if (store.indexOf(id) < 0) errs.push(`STORE_SPECIES_COST prices "${id}", which is not for sale`);
for (const id of Object.keys(hands)) {
  if (!ids.has(id)) { errs.push(`hand given for "${id}", which is not a species in index.html`); continue; }
  const h = hands[id];
  if (!Array.isArray(h)) { errs.push(`${id}: hand is not a list`); continue; }
  if (!h.length) errs.push(`${id}: an empty starting hand — the run would open with no cards`);
  const seen = new Set();
  for (const row of h) {
    if (!row || typeof row.name !== 'string') { errs.push(`${id}: a hand row with no card name`); continue; }
    if (!cardNames.has(row.name)) errs.push(`${id}: "${row.name}" is not a card in CARD_DATA`);
    if (seen.has(row.name)) errs.push(`${id}: "${row.name}" is listed twice — use one row with a bigger count`);
    seen.add(row.name);
    if (!Number.isInteger(row.count) || row.count < 1) errs.push(`${id}: "${row.name}" has count ${JSON.stringify(row.count)} (want a whole number, 1 or more)`);
  }
}
if (errs.length) {
  console.error('apply-species: refusing to write — ' + errs.length + ' problem(s):');
  for (const e of errs) console.error('  · ' + e);
  process.exit(1);
}

// ---- build the new text -----------------------------------------------------
// Single quotes with an escape, because that is how the file is written and a card name with an
// apostrophe would otherwise close the string. (None has one today. That is not a reason.)
const q = (s) => "'" + String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'") + "'";
const handText = (rows) => rows.map((r) => `      { name: ${q(r.name)}, count: ${r.count} },`).join('\n');

let out = html;
const changed = [];

// Each species' hand, located from its own `id:` so the entries cannot be confused with each other.
// Done on the whole file rather than on the extracted array so the offsets stay honest.
for (const sp of SPECIES) {
  const want = hands[sp.id];
  if (!want) continue;
  const before = JSON.stringify((sp.hand || []).map((h) => ({ name: h.name, count: h.count })));
  const after = JSON.stringify(want.map((h) => ({ name: h.name, count: h.count })));
  if (before === after) continue;

  const idAt = out.indexOf(`id: ${q(sp.id)},`);
  if (idAt < 0) die(`could not find the entry for "${sp.id}" (looked for  id: ${q(sp.id)},  )`);
  const handAt = out.indexOf('\n    hand: [', idAt);
  if (handAt < 0) die(`could not find a hand block for "${sp.id}"`);
  const close = out.indexOf('\n    ],', handAt);
  if (close < 0) die(`could not find the end of "${sp.id}"'s hand block`);
  // Guard against reaching into the NEXT species: no `id:` may appear in between.
  if (out.slice(handAt, close).includes('\n    id: ')) die(`the hand block for "${sp.id}" does not look like one`);

  out = out.slice(0, handAt) + '\n    hand: [\n' + handText(want) + out.slice(close);
  const n = (rows) => rows.reduce((a, r) => a + r.count, 0);
  changed.push(`${sp.id}: ${sp.hand.length} cards / ${n(sp.hand)} copies  ->  ${want.length} / ${n(want)}`);
}

// The three constants. Each is written on one line, as it is today.
const listLine = (name, arr) => `const ${name} = [${arr.map(q).join(', ')}];`;
const replaceOne = (re, next, what) => {
  const m = out.match(re);
  if (!m) die(`${what} not found in index.html`);
  if (m[0] !== next) changed.push(`${what}: ${m[0].replace(/^const \w+ = /, '').replace(/;$/, '')}  ->  ${next.replace(/^const \w+ = /, '').replace(/;$/, '')}`);
  out = out.replace(m[0], next);
};
replaceOne(/const STARTER_SPECIES_IDS = \[[^\]]*\];/, listLine('STARTER_SPECIES_IDS', starters), 'STARTER_SPECIES_IDS');
replaceOne(/const STORE_SPECIES_IDS = \[[^\]]*\];/, listLine('STORE_SPECIES_IDS', store), 'STORE_SPECIES_IDS');
replaceOne(/const STORE_SPECIES_COST = \{[^}]*\};/,
  `const STORE_SPECIES_COST = { ${store.map((id) => `${id}: ${costs[id]}`).join(', ')} };`, 'STORE_SPECIES_COST');

if (!changed.length) { console.log('apply-species: nothing to change — index.html already says this.'); process.exit(0); }

// ---- re-parse the RESULT and check it says what we meant --------------------
// The whole reason this script can be trusted with a 30k-line file it cannot read back by eye.
let check;
try {
  const m2 = out.match(/\nconst SPECIES = (\[[\s\S]*?\n\]);\n/);
  if (!m2) throw new Error('SPECIES no longer matches its own pattern');
  check = new Function('return ' + m2[1])();
} catch (e) { die(`the rewritten SPECIES will not parse (${e.message}) — nothing written`); }
if (check.length !== SPECIES.length) die(`the rewrite changed the species count (${SPECIES.length} -> ${check.length}) — nothing written`);
for (const sp of check) {
  const want = hands[sp.id];
  if (!want) continue;
  const got = JSON.stringify((sp.hand || []).map((h) => ({ name: h.name, count: h.count })));
  if (got !== JSON.stringify(want.map((h) => ({ name: h.name, count: h.count }))))
    die(`"${sp.id}" did not come out as intended — nothing written\n    wanted ${JSON.stringify(want)}\n    got    ${got}`);
}
for (const [name, arr] of [['STARTER_SPECIES_IDS', starters], ['STORE_SPECIES_IDS', store]]) {
  const got = new Function('return ' + out.match(new RegExp(`const ${name} = (\\[[^\\]]*\\]);`))[1])();
  if (JSON.stringify(got) !== JSON.stringify(arr)) die(`${name} did not come out as intended — nothing written`);
}
{
  const got = new Function('return ' + out.match(/const STORE_SPECIES_COST = (\{[^}]*\});/)[1])();
  for (const id of store) if (got[id] !== costs[id]) die(`STORE_SPECIES_COST.${id} did not come out as intended — nothing written`);
  for (const id of Object.keys(got)) if (store.indexOf(id) < 0) die(`STORE_SPECIES_COST kept a stale entry "${id}" — nothing written`);
}

console.log((DRY ? 'apply-species (dry run) would change:' : 'apply-species: applied'));
for (const c of changed) console.log('  · ' + c);
if (DRY) { console.log('  (nothing written)'); process.exit(0); }
writeFileSync(IDX, out);
console.log('  index.html written. Re-run `node scripts/gen-species-tool.mjs` so the tool shows the new values,');
console.log('  and `node tests/run.mjs species store campaign` to check the roster still holds up.');
