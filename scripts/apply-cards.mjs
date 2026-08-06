#!/usr/bin/env node
// Apply docs/card-tool.html's exported JSON back into index.html.
//
//   node scripts/apply-cards.mjs /tmp/cards.json
//   node scripts/apply-cards.mjs /tmp/cards.json --dry     # say what would change, write nothing
//
// This is the half that makes the page a tool rather than a survey. `docs/card-review.html` has
// exported decisions nobody applied for months, because "export JSON" and "hand-edit a 30k-line
// file" are not the same distance apart.
//
// WHAT IT TOUCHES, AND NOTHING ELSE:
//   · per card, in CARD_DATA — buyCostEnergy, buyP, costW, costP, effect, produces, startCopies
//   · CONFIG.cards.<knob> — the numbers the effect functions actually read
// Card names, types, categories, families and the EFFECTS code itself are untouched. Renaming a
// card is not a cost edit: the name is the key EFFECTS, the species hands, the art filenames and
// every save's deck are all joined on.
//
// IT REFUSES RATHER THAN HALF-WRITING, and re-parses the RESULT before replacing the file.
// CARD_DATA is embedded JSON, so a bad write is a page that will not boot — and a page that will
// not boot is the one failure worth spending a re-parse to avoid. Notes ride along in the export
// and are reported here, deliberately unapplied: a note is a request for behaviour no number can
// express, which is a code change and a human's job.

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const IDX = join(ROOT, 'index.html');
const args = process.argv.slice(2);
const DRY = args.includes('--dry');
const file = args.find((a) => !a.startsWith('-'));

const die = (msg) => { console.error('apply-cards: ' + msg); process.exit(1); };
if (!file) die('give it the exported JSON: node scripts/apply-cards.mjs <file.json> [--dry]');

let spec;
try { spec = JSON.parse(readFileSync(file, 'utf8')); }
catch (e) { die(`could not read ${file} as JSON — ${e.message}`); }
if (!spec || spec.format !== 'mycelium-cards') die('that is not a card-tool export (no "format": "mycelium-cards")');

const html = readFileSync(IDX, 'utf8');
const grab = (re, what) => { const m = html.match(re); if (!m) die(`${what} not found in index.html`); return m; };

const mCards = grab(/const CARD_DATA = (\[[\s\S]*?\n\]);\n/, 'CARD_DATA');
const CARDS = JSON.parse(mCards[1]);
const byName = new Map(CARDS.map((c) => [c.name, c]));
const ARCHIVED = new Set(new Function('return ' + grab(/const ARCHIVED = new Set\((\[[\s\S]*?\n\])\);/, 'ARCHIVED')[1])());

// CONFIG.cards — located by block, then by `name: number,` line. Read as text rather than parsed:
// the block carries trailing comments and nested structure, and the write has to preserve both.
const cfgStart = html.indexOf('  cards: {', html.indexOf('const CONFIG'));
if (cfgStart < 0) die('CONFIG.cards not found in index.html');
const cfgEnd = html.indexOf('\n  },', cfgStart);
const CFG = {};
for (const m of html.slice(cfgStart, cfgEnd).matchAll(/\n {4}(\w+): (-?\d+(?:\.\d+)?),/g)) CFG[m[1]] = +m[2];

// ---- validate, all of it, before touching anything --------------------------
const NUM_FIELDS = ['buyCostEnergy', 'buyP', 'costW', 'costP', 'startCopies'];
const TXT_FIELDS = ['effect', 'produces'];
const errs = [];
const cardEdits = spec.cards || {};
const cfgEdits = spec.config || {};
const notes = spec.notes || {};

if (typeof cardEdits !== 'object' || Array.isArray(cardEdits)) die('"cards" must be an object keyed by card name');
for (const [name, e] of Object.entries(cardEdits)) {
  const c = byName.get(name);
  if (!c) { errs.push(`"${name}" is not a card in CARD_DATA`); continue; }
  // AN ARCHIVED CARD IS NOT IN THE GAME, so an edit to one is almost certainly a stale page —
  // the tool does not show them. Refused rather than applied silently, because the effect of
  // applying it is nothing at all, which reads as the tool being broken.
  if (ARCHIVED.has(name)) { errs.push(`"${name}" is ARCHIVED — it is not in the game, so editing it changes nothing (un-archive it in index.html first)`); continue; }
  if (!e || typeof e !== 'object') { errs.push(`${name}: edit is not an object`); continue; }
  for (const [f, v] of Object.entries(e)) {
    if (NUM_FIELDS.includes(f)) {
      if (!Number.isInteger(v) || v < 0) errs.push(`${name}.${f} is ${JSON.stringify(v)} (want a whole number, 0 or more)`);
    } else if (TXT_FIELDS.includes(f)) {
      if (typeof v !== 'string') errs.push(`${name}.${f} is not text`);
      // The card face is small and the text is not scrolled. 200 characters is already three
      // lines at the carousel's size; past that it silently overflows its own frame.
      else if (v.length > 200) errs.push(`${name}.${f} is ${v.length} characters — the card face cannot show that (200 max)`);
      else if (f === 'effect' && !v.trim()) errs.push(`${name}.effect is empty — the card face would be blank`);
    } else {
      errs.push(`${name}: "${f}" is not a field this script writes (${[...NUM_FIELDS, ...TXT_FIELDS].join(', ')})`);
    }
  }
}
for (const [k, v] of Object.entries(cfgEdits)) {
  if (!(k in CFG)) { errs.push(`CONFIG.cards.${k} is not a plain number in index.html (or does not exist)`); continue; }
  if (typeof v !== 'number' || !isFinite(v)) { errs.push(`CONFIG.cards.${k} is ${JSON.stringify(v)} (want a number)`); continue; }
  if (v < 0) errs.push(`CONFIG.cards.${k} is negative (${v})`);
  // `enabled` is a boolean and `roundSeconds` is the whole real-time clock. Neither belongs to a
  // card, and a card-tool export that moved one would be an accident.
  if (k === 'roundSeconds') errs.push('CONFIG.cards.roundSeconds is the real-time round clock, not a card knob — every cadence in the game reads it');
}
if (errs.length) {
  console.error('apply-cards: refusing to write — ' + errs.length + ' problem(s):');
  for (const e of errs) console.error('  · ' + e);
  process.exit(1);
}

// ---- build the new text -----------------------------------------------------
const changed = [];
const stale = [];        // knobs whose trailing comment now argues for the value they no longer hold
const next = CARDS.map((c) => {
  const e = cardEdits[c.name];
  if (!e) return c;
  const out = { ...c };
  for (const [f, v] of Object.entries(e)) {
    if (JSON.stringify(c[f]) === JSON.stringify(v)) continue;
    changed.push(`${c.name}.${f}: ${JSON.stringify(c[f])} -> ${JSON.stringify(v)}`);
    out[f] = v;
  }
  return out;
});

let out = html;
// CARD_DATA round-trips byte-identically through `JSON.stringify(arr, null, 1)` — verified, and
// that is why the whole block can be rewritten rather than patched entry by entry. If the file's
// formatting ever changes this stops being true, so the guard below re-checks it.
const cardsText = JSON.stringify(next, null, 1);
if (JSON.stringify(CARDS, null, 1) !== mCards[1])
  die('CARD_DATA is no longer written as JSON.stringify(…, null, 1) — rewriting the block would reformat the whole array, so this script is refusing until it is taught the new shape');
out = out.replace(mCards[0], 'const CARD_DATA = ' + cardsText + ';\n');

// The knobs, each on its own line inside CONFIG.cards, with its trailing comment kept.
for (const [k, v] of Object.entries(cfgEdits)) {
  if (CFG[k] === v) continue;
  const re = new RegExp('(\\n {4}' + k + ': )(-?\\d+(?:\\.\\d+)?)(,)');
  const at = out.indexOf('  cards: {', out.indexOf('const CONFIG'));
  const end = out.indexOf('\n  },', at);
  const block = out.slice(at, end);
  const m = block.match(re);
  if (!m) die(`could not find CONFIG.cards.${k} to write (it matched on read but not on write)`);
  changed.push(`CONFIG.cards.${k}: ${CFG[k]} -> ${v}`);
  out = out.slice(0, at) + block.replace(re, '$1' + v + '$3') + out.slice(end);
  // THE NUMBER MOVES; THE COMMENT BESIDE IT DOES NOT, and in this file the comment is usually
  // the reasoning ("buffed 1→2"). A script cannot rewrite prose, so it says so instead — a knob
  // whose comment still argues for the old value is worse than a knob with no comment.
  const tail = /\/\/(.*)$/.exec(block.match(new RegExp('\\n {4}' + k + ': -?[\\d.]+,(.*)'))?.[1] || '');
  if (tail && /\d/.test(tail[1])) stale.push(`cards.${k} — the comment beside it still reads: //${tail[1].trim()}`);
}

if (!changed.length) {
  console.log('apply-cards: nothing to change — index.html already says this.');
  if (Object.keys(notes).length) reportNotes();
  process.exit(0);
}

// ---- re-parse the RESULT and check it says what we meant --------------------
let check;
try {
  const m2 = out.match(/const CARD_DATA = (\[[\s\S]*?\n\]);\n/);
  if (!m2) throw new Error('CARD_DATA no longer matches its own pattern');
  check = JSON.parse(m2[1]);
} catch (e) { die(`the rewritten CARD_DATA will not parse (${e.message}) — nothing written`); }
if (check.length !== CARDS.length) die(`the rewrite changed the card count (${CARDS.length} -> ${check.length}) — nothing written`);
for (let i = 0; i < check.length; i++) {
  const want = next[i], got = check[i];
  if (got.name !== want.name) die(`card ${i} came out as "${got.name}", wanted "${want.name}" — nothing written`);
  for (const f of [...NUM_FIELDS, ...TXT_FIELDS])
    if (JSON.stringify(got[f]) !== JSON.stringify(want[f]))
      die(`${want.name}.${f} did not come out as intended — nothing written\n    wanted ${JSON.stringify(want[f])}\n    got    ${JSON.stringify(got[f])}`);
}
{
  const at = out.indexOf('  cards: {', out.indexOf('const CONFIG'));
  const block = out.slice(at, out.indexOf('\n  },', at));
  for (const [k, v] of Object.entries(cfgEdits)) {
    const m = block.match(new RegExp('\\n {4}' + k + ': (-?\\d+(?:\\.\\d+)?),'));
    if (!m || +m[1] !== v) die(`CONFIG.cards.${k} did not come out as intended — nothing written`);
  }
}

function reportNotes() {
  const ks = Object.keys(notes);
  if (!ks.length) return;
  console.log(`\napply-cards: ${ks.length} behaviour note(s) — NOT applied, they are code changes:`);
  for (const k of ks) console.log(`  · ${k}: ${String(notes[k]).replace(/\s+/g, ' ').trim()}`);
}

console.log(DRY ? 'apply-cards (dry run) would change:' : 'apply-cards: applied');
for (const c of changed) console.log('  · ' + c);
if (stale.length) {
  console.log('\napply-cards: ' + stale.length + ' comment(s) left behind by a number that moved — fix these by hand:');
  for (const s of stale) console.log('  · ' + s);
}
reportNotes();
if (DRY) { console.log('  (nothing written)'); process.exit(0); }
writeFileSync(IDX, out);
console.log('\n  index.html written. Then:');
console.log('    node scripts/gen-card-tool.mjs                     # so the page shows the new values');
console.log('    node tests/run.mjs cardtool review ingame species  # card text, timing and the hands that name these cards');
