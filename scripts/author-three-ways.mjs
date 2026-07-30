#!/usr/bin/env node
// =============================================================================
// Authoring script for docs/levels/three-ways.json — the hand-designed level
// "Three Ways Up".
//
// Upstream authored levels came out of a GUI (docs/level-editor.html), which this
// repo never got a copy of. So the map is authored HERE instead, parametrically:
// the band table below is the design, and everything else (a few hundred rock
// sprites) is derived from it. That's the only sane way to place a 62-column
// rock wall by hand, and it means the layout can be re-tuned by editing four
// numbers instead of a JSON blob.
//
//   node scripts/author-three-ways.mjs   # rewrite docs/levels/three-ways.json
//   node scripts/gen-levels.mjs          # inject docs/levels/*.json into index.html
//
// The JSON is a normal `mycelium-level` object (see engine/level.js for the
// object types and their unit conventions — they are NOT all the same: food `r`
// is in CELLS, reservoir `r` is in WORLD UNITS, cloud `r` is in cells).
//
// -----------------------------------------------------------------------------
// THE DESIGN
// -----------------------------------------------------------------------------
// One decision, made once, in the first ten seconds: the colony drops into an
// open atrium behind the entry channel, sees three tunnel mouths, and picks one.
// Two continuous rock slabs seal the lanes from each other for the whole width
// of the map, so the choice sticks — the only ways to change your mind are to
// crawl all the way back to the atrium or to spend a rock-boring card on a slab.
// The three lanes reconverge in the goal channel, which buildLevel always digs
// clear (cols 73+), so every route can fruit.
//
// Each lane is one threat and one economy, tuned for REAL TIME — in RT the
// threats act on a 500 ms tick whether or not the player does anything, so route
// LENGTH is itself a difficulty knob and "food you have not reached yet" is food
// on a timer:
//
//   A — THE ANT TERRACE (rows 0-5, shallowest, shortest)
//       Ten piles in a chain and the fastest run to the goal, but three nests on
//       the surface strip that chain in real time (harvestRate 6.5/tick ≈ a pile
//       every 20 s once a line arrives). Ant trails no longer block growth, so
//       this lane is a pure RACE — outrun them, or spend Attack Ants. The lake at
//       cols 54-64 hangs into the corridor and squeezes it to three rows, which
//       is also where the lane pays you back in Water.
//
//   B — THE MOULD GALLERY (rows 10-17, middle, medium length)
//       Five chambers behind alternating stalactite/stalagmite throats, four
//       Trichoderma clouds, one per chamber. Rock blocks a cloud's line of sight,
//       so the throats keep each cloud chamber-local until you walk into its
//       room: the lane is a sequence of discrete gates rather than one swarm.
//       Two reservoirs make it the water-rich route. Needs a ward or Amputate.
//
//   C — THE WORM DEEP (rows 22-29, deepest, longest)
//       Long straight halls with almost no rock, so the five nematodes get their
//       full 500-unit sightline and come the moment you show a strand. The payoff
//       is the map's two biggest piles (including a second engine cache) and no
//       competition for them. The cost is the clock: you dive 22 rows, run the
//       length of the map, and climb all 29 rows back up in the goal channel.
//
// Threat COUNTS come from the authored spawns, not from the campaign table, so
// the map plays the same at whatever level it is slotted into.
// =============================================================================

import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(HERE, '../docs/levels/three-ways.json');

// ---- world box --------------------------------------------------------------
// 80 cols × 33 rows. Wider than the procedural default (72) so three lanes have
// room to feel like journeys, but not much wider: every extra column is nodes
// out of the 6000-node budget a crossing has to fit in.
const CS = 36;
const COLS = 80;
const ROWS = 33;
const SURFACE_Y = 380;
const WORLD = { width: COLS * CS, height: SURFACE_Y + ROWS * CS, surfaceY: SURFACE_Y, cellSize: CS };

// ---- the band table (the whole design lives here) ---------------------------
// Rows, top to bottom. Lanes are open corridors; walls are filled with rock.
const LANE_A = { r0: 0, r1: 5 };
const WALL_1 = { r0: 6, r1: 9 };
const LANE_B = { r0: 10, r1: 17 };
const WALL_2 = { r0: 18, r1: 21 };
const LANE_C = { r0: 22, r1: 29 };
const BEDROCK = { r0: 30, r1: 32 };

// Columns the slabs span. They start at 11 (leaving cols 3-10 as the open atrium
// where the choice is made — cols 0-2 are the entry channel buildLevel digs out)
// and stop at 72, one short of the goal channel: sprites drawn over `pathClear`
// cells are forced passable, which would read as an invisible hole in the wall.
const WALL_C0 = 11;
const WALL_C1 = 72;

// ---- helpers ----------------------------------------------------------------
const X = (col) => col * CS + CS / 2;              // cell-centre x
const Y = (row) => SURFACE_Y + row * CS + CS / 2;  // cell-centre y
const rowTop = (row) => SURFACE_Y + row * CS;      // top edge of a row
const rowBot = (row) => SURFACE_Y + (row + 1) * CS;

// Deterministic jitter — the JSON has to be byte-stable across runs, so no
// Math.random() anywhere. Plain LCG; `k` keys the stream so unrelated passes
// don't shift each other when one of them is re-tuned.
function jitter(k) {
  let s = (k * 1103515245 + 12345) >>> 0;
  return () => {
    s = (s * 1103515245 + 12345) >>> 0;
    return s / 4294967296;
  };
}
const spread = (rnd, amp) => (rnd() * 2 - 1) * amp;

// Native aspect ratios of the rock art (w/h of the PNG). Sizing a sprite off its
// own aspect is what keeps it from rendering as a stretched pancake.
const ASPECT = {
  rockform1: 1.79, rockform2: 1.95, rockform3: 1.96, rockform4: 1.58, rockform5: 3.20,
  rockform6: 2.06, rockform7: 1.56, rockform8: 2.12, rockform9: 1.96, rockform10: 3.81,
  rockform11: 1.93, rockform12: 1.60, rockform13: 2.88, rockform14: 1.86,
  rockBasalt: 1.27, rockMossy: 1.80, rockRiver: 1.15, rockSlate: 1.40, rockVeined: 1.65,
};

const objects = [];
const add = (o) => { objects.push(o); return o; };

// A rock sprite of a given VISUAL height, sized off its native aspect. Style
// 'boulder' blits the art plain; 'formation' fades its bottom 24% into the soil
// colour, which is right for a mass standing on the floor and wrong for a
// ceiling slab — a faded bottom edge still COLLIDES, so it would read as an
// invisible wall. Hence: slabs and pillars are boulders, bedrock is formation.
function rock(key, cx, cy, h, { rot = 0, style = 'boulder' } = {}) {
  return add({ t: style, key, x: round(cx), y: round(cy), w: round(h * ASPECT[key]), h: round(h), rot: +rot.toFixed(3) });
}
// Same, but rotated a quarter turn so a chunky sprite reads as a vertical pillar:
// `h` is then the pillar's WIDTH on screen and `len` its height.
function pillar(key, cx, cy, len, { lean = 0 } = {}) {
  const w = len, h = w / ASPECT[key];
  return add({ t: 'boulder', key, x: round(cx), y: round(cy), w: round(w), h: round(h), rot: +(Math.PI / 2 + lean).toFixed(3) });
}
const round = (n) => Math.round(n * 10) / 10;

// -----------------------------------------------------------------------------
// 1. WATER FIRST. stampFood skips cells that are already water, and buildLevel
//    walks `objects` in order — so every lake and reservoir has to be stamped
//    before any pile that might overlap it, or the pile wins and the water gets
//    a bite taken out of it.
// -----------------------------------------------------------------------------

// The lake hangs into lane A at cols 54-64 (bowl profile: 3 rows at the centre,
// tapering to 1 at the edges), squeezing that corridor from 6 rows to 3. Touching
// it pays Water, so lane A's worst pinch is also its lifeline.
add({ t: 'lake', key: 'lake2', x: X(59), w: 11 * CS, h: 3 * CS });

// Reservoirs: two in lane B (its identity — the wet route), one in lane C. Radius
// is in WORLD units here; keep the teardrop 1+ row clear of a slab, because
// markCoverGrid skips water cells and a pool touching a slab punches a hole
// straight through it.
add({ t: 'reservoir', key: 'reservoir1', x: X(27), y: Y(13), r: 2 * CS });
add({ t: 'reservoir', key: 'reservoir3', x: X(58), y: Y(14), r: 2 * CS });
add({ t: 'reservoir', key: 'reservoir2', x: X(37), y: Y(25), r: 2 * CS });

// -----------------------------------------------------------------------------
// 2. FOOD. Kinds: 'cache' drafts a basic/event card, 'duff' drafts nothing and
//    pays less, 'cache-engine' drafts an engine. `r` is a diamond radius in
//    CELLS (r=1 → 5 cells → 250 nutrient).
//
//    Clearance rule: a pile must stay a row clear of the slabs. Food cells are
//    skipped by the rock-solidify pass, so a pile that overlaps a slab is a hole
//    in it — the one way an authored map can accidentally connect two lanes.
// -----------------------------------------------------------------------------
const FOOD = [
  // --- lane A: the chain the ants are eating. Dense, cheap, and on a timer. ---
  [14, 3, 'duff', 1, 2], [19, 2, 'cache', 1, 3], [25, 3, 'cache', 1, 3],
  [31, 2, 'duff', 1, 2], [36, 3, 'cache', 1, 3], [42, 2, 'cache-engine', 1, 4],
  [48, 3, 'duff', 1, 2], [57, 3, 'cache', 1, 3], [63, 3, 'cache', 1, 3],
  [69, 2, 'duff', 1, 2],
  // --- lane B: one pile per chamber, each sitting under a cloud. Kept clear of
  //     the reservoirs too — water is stamped first and food yields to it, so a
  //     pile laid over a pool silently loses most of its cells. ---
  [16, 15, 'cache', 1, 3], [22, 15, 'duff', 1, 2], [37, 12, 'cache', 1, 3],
  [48, 15, 'cache', 1, 3], [63, 12, 'duff', 1, 2], [69, 15, 'cache', 1, 3],
  // --- lane C: few piles, but the two biggest on the map. Nothing competes
  //     for them: no ants down here, and mould is a lane up. ---
  [30, 25, 'cache-engine', 2, 5], [46, 26, 'cache', 3, 7], [62, 24, 'duff', 1, 2],
];
for (const [col, row, kind, r, energy] of FOOD) {
  add({ t: 'food', kind, x: X(col), y: Y(row), r, energy });
}

// -----------------------------------------------------------------------------
// 3. THE TWO SLABS. Each is two courses of wide, low rock sprites (rockform
//    5/10/13 are the ultra-wide ones — the only ones that read as a horizontal
//    ridge instead of a boulder), laid with heavy overlap and staggered so the
//    two courses' seams never line up.
//
//    Why two courses: collision is sampled from each sprite's ALPHA at ~9 px, so
//    a wall is only as solid as its thinnest continuous horizontal band. One
//    course of tapered ridges leaves gaps where two sprites meet at their thin
//    ends; a second course half a step out of phase covers exactly those. The
//    growth segment is 17 px and is sampled every ~6 px along its length, so the
//    band that survives has to be continuous, not merely thick on average.
//    tests/level-check.cjs flood-fills the real mask and fails on any leak.
// -----------------------------------------------------------------------------
const SLAB_KEYS = ['rockform5', 'rockform13', 'rockform10'];
const CRUST_KEYS = ['rockform6', 'rockform8', 'rockform11', 'rockform1'];
const SLAB_H = 96;      // visual thickness of one sprite
const SLAB_STEP = 150;  // horizontal step between sprite centres (≈ half a sprite)
const COURSE = 24;      // ± offset of the two courses from the band's midline

function slab(band, key) {
  const rnd = jitter(key);
  const yMid = (rowTop(band.r0) + rowBot(band.r1)) / 2;
  const x0 = WALL_C0 * CS, x1 = (WALL_C1 + 1) * CS;
  // Two courses, one above the band's midline and one below. They overlap by 48 px
  // before jitter; the per-sprite jitter is held to ±12 so the worst case still
  // leaves 24 px of overlap — the seal is the constraint here, not the look.
  for (const course of [-COURSE, COURSE]) {
    const phase = course < 0 ? 0 : SLAB_STEP / 2;
    for (let x = x0 + phase; x <= x1; x += SLAB_STEP) {
      const k = SLAB_KEYS[Math.floor(rnd() * SLAB_KEYS.length) % SLAB_KEYS.length];
      rock(k, x, yMid + course + spread(rnd, 12), SLAB_H + spread(rnd, 10), { rot: spread(rnd, 0.05) });
    }
  }
  // Crust: smaller lumps clinging to both faces, out of phase with the courses.
  // Two courses of tapered ridges read as a pair of tidy horizontal stripes with a
  // seam running the width of the map; this bumps the silhouette so each slab
  // reads as a stratum instead. It only ADDS rock, so it can't open a hole.
  //
  // Each lump protrudes past the band by exactly CRUST_LIP and no more — no y
  // jitter. A 6-row corridor has no spare room: a lump reaching the centre of the
  // corridor's edge row seals that row, which is how the first version of this
  // pass shut lane A's floor. 14 px keeps every cell centre in the clear while
  // still breaking the outline.
  const CRUST_LIP = 14;
  const half = (rowBot(band.r1) - rowTop(band.r0)) / 2;
  for (const face of [-1, 1]) {
    for (let x = x0 + 70; x <= x1; x += 190) {
      const k = CRUST_KEYS[Math.floor(rnd() * CRUST_KEYS.length) % CRUST_KEYS.length];
      const h = 56 + rnd() * 26;
      rock(k, x + spread(rnd, 24), yMid + face * (half - h / 2 + CRUST_LIP), h, { rot: spread(rnd, 0.5) });
    }
  }
  // End cap: the strata have to stop somewhere short of the goal channel (a sprite
  // over `pathClear` cells is drawn but not solid, which reads as a hole), so give
  // the break a chunky mass rather than a clean vertical cut.
  rock('rockform12', (WALL_C1 - 0.4) * CS, yMid + spread(rnd, 10), 150, { rot: spread(rnd, 0.25) });
}
slab(WALL_1, 'w1');
slab(WALL_2, 'w2');

// The mouths. A boulder on each side of each lane opening at the atrium end, so
// the three entrances read as doorways rather than as places the wall stopped.
for (const band of [LANE_A, LANE_B, LANE_C]) {
  rock('rockform12', WALL_C0 * CS - 26, rowTop(band.r0) + 18, 56);
  rock('rockform4', WALL_C0 * CS - 20, rowBot(band.r1) - 18, 62);
}

// -----------------------------------------------------------------------------
// 4. LANE INTERIORS.
// -----------------------------------------------------------------------------

// A — hanging boulders off the ceiling. Small on purpose: lane A's difficulty is
// the ant clock, not the geometry, and anything big here would also block the
// nests' trails from descending into the corridor at all.
const A_TEETH = [16, 22, 29, 34, 40, 46, 52, 66, 71];
{
  const rnd = jitter('teeth');
  const keys = ['rockBasalt', 'rockSlate', 'rockVeined', 'rockMossy'];
  A_TEETH.forEach((col, i) => {
    rock(keys[i % keys.length], X(col) + spread(rnd, 10), rowTop(LANE_A.r0) + 26 + spread(rnd, 8),
      54 + rnd() * 26, { rot: spread(rnd, 0.5) });
  });
}

// B — five throats, alternating: a long stalactite (gap at the floor) then a long
// stalagmite (gap at the ceiling). Alternating rather than pinching in the middle
// makes the strand weave up and down between chambers, which is what keeps each
// cloud's line of sight inside its own room, and reads far more like a cave.
const B_THROATS = [20, 31, 42, 53, 64];
{
  const rnd = jitter('throats');
  const keys = ['rockform7', 'rockform4', 'rockform12'];
  B_THROATS.forEach((col, i) => {
    const fromCeiling = i % 2 === 0;
    const len = 190;
    const cy = fromCeiling ? rowTop(LANE_B.r0) + len / 2 : rowBot(LANE_B.r1) - len / 2;
    pillar(keys[i % keys.length], X(col) + spread(rnd, 8), cy, len, { lean: spread(rnd, 0.09) });
    // A stub opposite the long one, so the gap is a throat and not just a shelf.
    const stubLen = 58;
    const sy = fromCeiling ? rowBot(LANE_B.r1) - stubLen / 2 : rowTop(LANE_B.r0) + stubLen / 2;
    pillar(keys[(i + 1) % keys.length], X(col) + spread(rnd, 14), sy, stubLen, { lean: spread(rnd, 0.2) });
  });
}

// C — nearly empty by design: the worms' 500-unit sightline is the threat, and
// rock is what breaks it. Two low stalagmites and one mid-hall island, all short
// enough to leave the sightlines down the hall intact.
{
  const rnd = jitter('deep');
  for (const col of [24, 39, 57]) {
    pillar('rockform12', X(col) + spread(rnd, 12), rowBot(LANE_C.r1) - 40, 80, { lean: spread(rnd, 0.25) });
  }
  rock('rockform8', X(51), Y(26), 104, { rot: spread(rnd, 0.12) });
}

// Cave debris on the floors of B and C. Pebble-scale on purpose: it has to dress
// the halls without shortening lane C's sightlines or narrowing B's chambers.
{
  const rnd = jitter('debris');
  const keys = ['rockBasalt', 'rockRiver', 'rockSlate', 'rockVeined', 'rockMossy'];
  let i = 0;
  for (const band of [LANE_B, LANE_C]) {
    for (let col = WALL_C0 + 2; col < WALL_C1 - 1; col += 4) {
      if (rnd() < 0.35) continue;                        // gaps, or it reads as a paved floor
      rock(keys[i++ % keys.length], X(col) + spread(rnd, 16), rowBot(band.r1) - 22 + spread(rnd, 6),
        38 + rnd() * 18, { rot: spread(rnd, 0.6) });
    }
  }
}

// Bedrock floor under lane C. 'formation' style here: its base fades into the
// soil colour, which is exactly right for a mass sitting on the bottom of the
// world and costs nothing in collision terms, since growth cannot reach the last
// two units of world height anyway.
{
  const rnd = jitter('bedrock');
  const keys = ['rockform1', 'rockform8', 'rockform11', 'rockform6'];
  let i = 0;
  for (let x = 0; x <= COLS * CS; x += 210) {
    const cx = Math.min(COLS * CS, Math.max(0, x + spread(rnd, 20)));
    rock(keys[i++ % keys.length], cx, rowTop(BEDROCK.r0) + 76 + spread(rnd, 14),
      150 + rnd() * 40, { style: 'formation', rot: spread(rnd, 0.06) });
  }
}

// -----------------------------------------------------------------------------
// 5. SURFACE. All of it is decor or barrier — the only fruitable soil is the goal
//    zone buildLevel flags on the right. Read left to right: the colony starts
//    under a city, crosses under a mountain range, passes a lake, and surfaces in
//    the summery goal.
// -----------------------------------------------------------------------------
add({ t: 'city', key: 'skyline3', x: X(7), w: 15 * CS });
add({ t: 'city', key: 'skyline5', x: X(22), w: 14 * CS });
add({ t: 'prop', key: 'house', x: X(17), h: 104 });
add({ t: 'prop', key: 'house', x: X(26), h: 92, flip: true });

add({ t: 'mountain', key: 'mountain2', x: X(33), w: 9 * CS });
add({ t: 'mountain', key: 'mountain5', x: X(43), w: 8 * CS });
add({ t: 'mountain', key: 'mountain1', x: X(51), w: 6 * CS });

// Goal-side greenery. Cols 67+ are the fruitable approach; the bush marks the
// finish the way the procedural maps do.
add({ t: 'prop', key: 'tree', x: X(68), h: 128 });
add({ t: 'prop', key: 'tree', x: X(71), h: 112, flip: true });
add({ t: 'prop', key: 'goalbush', x: X(75), h: 96 });
add({ t: 'prop', key: 'tree', x: X(78), h: 120 });

// -----------------------------------------------------------------------------
// 6. THREATS. One kind per lane — that is the entire point of the map, so this
//    list is also the difficulty statement. Counts here are what the run gets;
//    the campaign's per-level threat table only sets the respawn ceilings.
// -----------------------------------------------------------------------------

// A: three nests spaced along the terrace, each dropped directly over a pile so
// its first trail descends into lane A rather than pathing off somewhere else.
// (placeAntNests runs its BFS at build time, before rock is solidified, so a nest
// far from its food could otherwise plot a line straight through a slab.)
for (const col of [20, 39, 51]) add({ t: 'ant', x: X(col) });

// B: one cloud per chamber, offset from that chamber's pile so it has to creep
// onto the food (and onto you) instead of starting on top of it.
for (const [col, row] of [[24, 13], [35, 15], [46, 12], [57, 15]]) {
  add({ t: 'trichoderma', x: X(col), y: Y(row) });
}

// C: five worms down the halls, none of them near the mouth — they should be a
// sightline you walk into, not an ambush at the door.
for (const [col, row] of [[26, 26], [34, 24], [44, 27], [55, 25], [66, 26]]) {
  add({ t: 'nematode', x: X(col), y: Y(row) });
}

// -----------------------------------------------------------------------------
// Validation. These are the mistakes that are invisible in the JSON and obvious
// in the game: a pile eating a hole through a slab, or anything placed outside
// the world box.
// -----------------------------------------------------------------------------
const problems = [];
for (const o of objects) {
  if (o.x < 0 || o.x > WORLD.width) problems.push(`${o.t} at x=${o.x} is outside the world`);
  if (o.y != null && o.y > WORLD.height) problems.push(`${o.t} at y=${o.y} is below the world`);
}
for (const [col, row, kind, r] of FOOD) {
  for (const [name, band] of [['wall 1', WALL_1], ['wall 2', WALL_2]]) {
    const top = row - r, bot = row + r;
    if (bot >= band.r0 - 1 && top <= band.r1 + 1) {
      problems.push(`food ${kind} at (${col},${row}) r=${r} is within a row of ${name} — it would punch a hole through it`);
    }
  }
}
for (const o of objects) {
  if (o.t !== 'reservoir') continue;
  const rad = Math.round(o.r / CS), row = Math.floor((o.y - SURFACE_Y) / CS);
  for (const [name, band] of [['wall 1', WALL_1], ['wall 2', WALL_2]]) {
    if (row + rad >= band.r0 - 1 && row - rad <= band.r1 + 1) {
      problems.push(`reservoir at row ${row} r=${rad} touches ${name} — water is skipped by the solidify pass, so it would hole the slab`);
    }
  }
}
if (problems.length) {
  console.error('Layout problems:\n  ' + problems.join('\n  '));
  process.exit(1);
}

// -----------------------------------------------------------------------------
const level = {
  format: 'mycelium-level',
  version: 1,
  id: 'three-ways',
  name: 'Three Ways Up',
  // null = the map does not claim a campaign slot, so the procedural campaign is
  // untouched and this is reachable via `#level,three-ways`. Set it to a level
  // number to have it REPLACE that level's generated map.
  campaignLevel: null,
  world: WORLD,
  layout: { startCols: 2, goalCols: 6, summerCols: 7, clearChannels: true },
  objects,
};

mkdirSync(dirname(OUT), { recursive: true });
// One object per line: the file is a few hundred sprites and a flat list is far
// easier to diff (and to hand-tweak) than either fully-minified or fully-pretty.
const body = objects.map((o) => '    ' + JSON.stringify(o)).join(',\n');
const head = JSON.stringify({ ...level, objects: '@@' }, null, 2).replace('"@@"', `[\n${body}\n  ]`);
writeFileSync(OUT, head + '\n');

const count = (t) => objects.filter((o) => o.t === t).length;
console.log(`wrote ${OUT}`);
console.log(`  ${objects.length} objects: ${count('boulder')} boulder, ${count('formation')} formation, ` +
  `${count('food')} food, ${count('reservoir')} reservoir, ${count('lake')} lake`);
console.log(`  surface: ${count('city')} city, ${count('mountain')} mountain, ${count('prop')} prop`);
console.log(`  threats: ${count('ant')} ants, ${count('trichoderma')} mould, ${count('nematode')} worms`);
console.log(`  world ${WORLD.width}×${WORLD.height} (${COLS}×${ROWS} cells)`);
