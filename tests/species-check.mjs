/* The species table, checked statically (no browser): each starter's opening hand and
   starting Water. These are the numbers the game is balanced around, so they're asserted
   ABSOLUTELY — a diff against the previous commit would pass trivially once committed. */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const parse = (src) => {
  const start = src.indexOf('const SPECIES = [');
  const blk = src.slice(start, src.indexOf('\nconst LOCKED_TIERS', start));
  const out = {};
  const ids = [...blk.matchAll(/id: '([a-z]+)', vibe/g)].map((m) => [m.index, m[1]]);
  ids.forEach(([i, id], k) => {
    const chunk = blk.slice(i, k + 1 < ids.length ? ids[k + 1][0] : blk.length);
    const hand = {};
    for (const m of chunk.matchAll(/\{ name: '([^']+)', count: (\d+) \}/g)) hand[m[1]] = +m[2];
    out[id] = { water: +/res: \{ energy: \d+, water: (\d+)/.exec(chunk)[1], hand };
  });
  return out;
};

// id → [starting Water, { card: copies }]. Only the cards the balance passes have touched are
// listed; anything else in a hand is deliberately left unpinned.
const EXPECT = {
  marasmius:     [40, { 'Rhizomorph Lance': 5 }],                       // fairy ring
  armillaria:    [35, { 'Rhizomorph Lance': 10, 'Turgor Thrust': 5 }],  // honey fungus
  ganoderma:     [40, { 'Turgor Thrust': 6 }],
  pleurotus:     [40, { 'Turgor Thrust': 18 }],
  suillus:       [40, { 'Turgor Thrust': 6 }],
  schizophyllum: [57, { 'Turgor Thrust': 6 }],
  hydnellum:     [45, { 'Turgor Thrust': 6, 'Rhizomorph Lance': 6 }],
  stropharia:    [50, { 'Turgor Thrust': 6 }],
  cortinarius:   [50, { 'Turgor Thrust': 6 }],
  serpula:       [50, { 'Turgor Thrust': 14, 'Rhizomorph Lance': 6 }],
  scleroderma:   [40, { 'Turgor Thrust': 6, 'Rhizomorph Lance': 12 }],
  psilocybe:     [45, { 'Turgor Thrust': 16, 'Rhizomorph Lance': 10 }],
};

const now = parse(fs.readFileSync(path.join(REPO, 'index.html'), 'utf8'));
let pass = 0, fail = 0;
const ok = (n, c, x) => { c ? (pass++, console.log('  PASS  ' + n + (x ? '  — ' + x : ''))) : (fail++, console.log('  FAIL  ' + n + (x ? '  — ' + x : ''))); };

ok('every species is accounted for',
   Object.keys(now).length === Object.keys(EXPECT).length && Object.keys(EXPECT).every((k) => now[k]),
   `${Object.keys(now).length} in the table, ${Object.keys(EXPECT).length} expected`);

for (const [id, [water, cards]] of Object.entries(EXPECT)) {
  const s = now[id];
  if (!s) { ok(`${id}: present`, false, 'missing from the table'); continue; }
  ok(`${id}: starting Water`, s.water === water, `${s.water} (expected ${water})`);
  for (const [card, n] of Object.entries(cards)) {
    ok(`${id}: ${card}`, (s.hand[card] || 0) === n, `${s.hand[card] || 0} (expected ${n})`);
  }
  // Every species must be able to open with SOMETHING that grows.
  const growers = ['Apical Drive', 'Hyphal Extension', 'Rhizomorph Lance', 'Turgor Thrust', 'Foraging Fan'];
  ok(`${id}: has an opening grow`, growers.some((c) => (s.hand[c] || 0) > 0), Object.keys(s.hand).join(', '));
}

console.log(`\n==== ${pass} passed, ${fail} failed ====`);
process.exit(fail ? 1 : 0);
