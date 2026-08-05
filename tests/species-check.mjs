/* The species table, checked statically (no browser): each starter's opening hand, plus the
   UNIVERSAL opening resources and the store bases that stack on them. These are the numbers the
   game is balanced around, so they're asserted ABSOLUTELY — a diff against the previous commit
   would pass trivially once committed.

   Starting Water used to be asserted PER SPECIES, parsed out of a `res: { energy, water, … }` row
   on each entry. Those rows are gone: what a colony opens with is the player's (CONFIG's base plus
   the store's three resource tracks), not the mushroom's, so it is checked once, here. */
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
    // A species row carries NO resources any more — only a hand.
    out[id] = { hand };
  });
  return out;
};

// The universal opening and the store bases, straight out of the source.
const parseStart = (src) => {
  const base = (id) => {
    const m = new RegExp("id: '" + id + "'[^}]*?base: (\\d+)").exec(src);
    return m ? +m[1] : 0;
  };
  return {
    energy: +/^\s*start: (\d+),\s*\/\/ starting Energy/m.exec(src)[1],
    water: +/^\s*startWater: (\d+),/m.exec(src)[1],
    phosphorus: +/^\s*startPhosphorus: (\d+),/m.exec(src)[1],
    carryCards: base('carryCards'),
    carryEngines: base('carryEngines'),
    lives: base('lives'),
  };
};

// What EVERY colony opens with before the store's resource tracks add anything.
const EXPECT_START = { energy: 20, water: 20, phosphorus: 0 };

// The store bases — what a player has on a track they have never bought a step of. Basic/Event
// Memory is 3, which used to be a bare `3 +` at the run loop where the store tile could not see it.
const EXPECT_BASE = { carryCards: 3, carryEngines: 0, lives: 1 };

// id → { card: copies }. Only the cards the balance passes have touched are listed; anything
// else in a hand is deliberately left unpinned.
const EXPECT = {
  marasmius:     { 'Rhizomorph Lance': 5 },                       // fairy ring
  armillaria:    { 'Rhizomorph Lance': 10, 'Turgor Thrust': 5 },  // honey fungus
  ganoderma:     { 'Turgor Thrust': 6 },
  pleurotus:     { 'Turgor Thrust': 7, 'Guerrilla Runners': 7, 'Rhizomorph Lance': 7 },   // THE only starter
  suillus:       { 'Turgor Thrust': 6 },
  schizophyllum: { 'Turgor Thrust': 6 },
  hydnellum:     { 'Turgor Thrust': 7, 'Rhizomorph Lance': 7, 'Vesicle Surge': 7 },
  stropharia:    { 'Turgor Thrust': 6 },
  cortinarius:   { 'Toxocyst Burst': 6 },   // its Turgor Thrusts became anti-worm events (owner)
  serpula:       { 'Turgor Thrust': 14, 'Rhizomorph Lance': 6 },
  scleroderma:   { 'Turgor Thrust': 6, 'Rhizomorph Lance': 12 },
  psilocybe:     { 'Turgor Thrust': 10, 'Rhizomorph Lance': 10 },
  // The two store colonies whose specials fight a threat. Both open on 20 grow copies (owner).
  amanita:       { 'Turgor Thrust': 4, 'Rhizomorph Lance': 2 },   // fly agaric — Berserk
  pruinomycena:  { 'Turgor Thrust': 2 },                          // blue bonnet — Toxic Burst
};

const now = parse(fs.readFileSync(path.join(REPO, 'index.html'), 'utf8'));
let pass = 0, fail = 0;
const ok = (n, c, x) => { c ? (pass++, console.log('  PASS  ' + n + (x ? '  — ' + x : ''))) : (fail++, console.log('  FAIL  ' + n + (x ? '  — ' + x : ''))); };

ok('every species is accounted for',
   Object.keys(now).length === Object.keys(EXPECT).length && Object.keys(EXPECT).every((k) => now[k]),
   `${Object.keys(now).length} in the table, ${Object.keys(EXPECT).length} expected`);

const SRC = fs.readFileSync(path.join(REPO, 'index.html'), 'utf8');
const START = parseStart(SRC);
for (const k of Object.keys(EXPECT_START)) {
  ok(`universal starting ${k}`, START[k] === EXPECT_START[k], `${START[k]} (expected ${EXPECT_START[k]})`);
}
for (const k of Object.keys(EXPECT_BASE)) {
  ok(`store base: ${k}`, START[k] === EXPECT_BASE[k], `${START[k]} (expected ${EXPECT_BASE[k]})`);
}
// One source of truth. A reintroduced `res` row would silently win at deal time, exactly the way
// the old per-species block did, and nothing on screen would say which number was in force.
ok('no species declares its own starting resources', !/res: \{ energy: \d/.test(SRC),
   'species rows carry a hand only');
// The baseline must NOT also be added at the run loop, or every player quietly gets 6 — and
// `cleared` must not be added either: levels cleared no longer widen the allowance (owner), so
// the store track is the whole answer.
ok('the keep allowance is the store track alone',
   /const keep = store\.carryCards;/.test(SRC), 'keep = store.carryCards');

for (const [id, cards] of Object.entries(EXPECT)) {
  const s = now[id];
  if (!s) { ok(`${id}: present`, false, 'missing from the table'); continue; }
  for (const [card, n] of Object.entries(cards)) {
    ok(`${id}: ${card}`, (s.hand[card] || 0) === n, `${s.hand[card] || 0} (expected ${n})`);
  }
  // Every species must be able to open with SOMETHING that grows.
  const growers = ['Apical Drive', 'Hyphal Extension', 'Rhizomorph Lance', 'Turgor Thrust', 'Foraging Fan'];
  ok(`${id}: has an opening grow`, growers.some((c) => (s.hand[c] || 0) > 0), Object.keys(s.hand).join(', '));
}

console.log(`\n==== ${pass} passed, ${fail} failed ====`);
process.exit(fail ? 1 : 0);
