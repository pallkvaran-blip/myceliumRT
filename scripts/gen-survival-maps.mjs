#!/usr/bin/env node
// Turn the owner's survival map exports into docs/levels/ entries.
//
// WHAT THE OWNER SUPPLIED and what this adds are deliberately separate, because re-running this
// must never touch their work: they placed the ROCK, the water (lakes + reservoirs) and the RED
// leaf piles by hand, and every one of those objects is copied through untouched. This script
// only ever adds what they asked for and did not do — the surface backdrop — plus the three
// bookkeeping fields a survival map needs (`survival`, `assetsFrom`, `campaignLevel: null`).
//
// The ORANGE and YELLOW piles are NOT placed here. They have to miss the rock, and on a traced
// map the rock is a set of irregular sprite silhouettes whose collision the game derives from
// each sprite's own alpha at RENDER time (solidifyRock). Reproducing that offline would be a
// second implementation of the thing being placed against, so `scripts/place-survival-food.mjs`
// runs afterwards and picks the spots inside the running game, off the real mask.
//
//   node scripts/gen-survival-maps.mjs <dir-of-owner-exports>   # writes docs/levels/*.json
//   node scripts/gen-survival-maps.mjs <dir> --dry              # prints, writes nothing
//
// THE SURFACE BACKDROP IS A TILING, not a scatter, and that is copied from the committed maps
// rather than invented: campaign-05 runs city 216-468, mountain 468-900, city 900-1116,
// mountain 1116-1548, city 1548-1764, mountain 1764-2268, city 2268-2484 — alternating, snapped
// to whole cells, edge to edge, and stopping exactly where the goal meadow starts. 2-obsidian
// and campaign-06 are the same rule with fewer, wider pieces. So: alternate mountain and city
// across [START_X, END_X], widths drawn from the ranges the existing maps use.
//
// The band's ends are not decoration either. Left of START_X is the entry channel the colony
// roots in; right of END_X is the goal meadow, whose green hill is drawn by the game — a city
// there would stand on top of it.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'docs', 'levels');

const CELL = 36;
const START_X = 216;    // clear of the entry channel (startCols 2 → the first 3 columns)
const END_X = 2484;     // where the goal meadow begins (goalCols 6 + summerCols 7 of a 2952 map)

const MOUNTAINS = ['mountain1', 'mountain2', 'mountain3', 'mountain4', 'mountain5'];
const SKYLINES = ['skyline1', 'skyline2', 'skyline3', 'skyline4', 'skyline5', 'skyline6'];
// Widths the committed maps actually use, in cells: mountains 12-52, cities 5-15.
const MTN_CELLS = [12, 52];
const CITY_CELLS = [5, 15];

// A tiny deterministic PRNG so re-running this script produces the SAME backdrop. A map whose
// skyline moved every time it was regenerated would make every diff unreadable, and the seed is
// the map's own id so two maps never get the same arrangement.
function rngFor(str) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
  return () => { h ^= h << 13; h >>>= 0; h ^= h >> 17; h ^= h << 5; h >>>= 0; return h / 4294967296; };
}
const pick = (rnd, arr) => arr[Math.floor(rnd() * arr.length) % arr.length];
const cellsIn = (rnd, [lo, hi]) => lo + Math.floor(rnd() * (hi - lo + 1));

// Alternate mountain / city across the band, each piece a whole number of cells, contiguous.
// The LAST piece is stretched to land exactly on END_X — a 1-2 cell tail would otherwise show
// as a notch of bare sky between the backdrop and the goal hill.
function surfaceBackdrop(id) {
  const rnd = rngFor(id + '/surface');
  const out = [];
  let x = START_X;
  let mtn = rnd() < 0.65;          // most committed maps open on a mountain
  while (x < END_X) {
    const w = cellsIn(rnd, mtn ? MTN_CELLS : CITY_CELLS) * CELL;
    const left = END_X - x;
    // Under two cells of headroom left: give the tail to this piece instead of starting another.
    const wid = (left - w < CELL * 4) ? left : Math.min(w, left);
    out.push({ t: mtn ? 'mountain' : 'city', key: pick(rnd, mtn ? MOUNTAINS : SKYLINES),
               x: Math.round(x + wid / 2), w: wid });
    x += wid;
    mtn = !mtn;
  }
  return out;
}

// Which assets/<folder>/ holds a map's rock sprites. A survival map has its own id and no folder
// of its own; the sprites are still the source traced map's, and the boulder KEYS name it
// (`anthracite-c24R017` → `anthracite-c24`). Read from the objects rather than parsed out of the
// id, because the ids are the owner's and do not all follow one pattern.
function assetsFromOf(def) {
  const pref = new Set();
  for (const o of def.objects || []) {
    if (!o.key) continue;
    const m = /^(.*?)R\d+$/.exec(o.key);
    if (m) pref.add(m[1]);
  }
  if (pref.size !== 1) return null;
  return [...pref][0];
}

const args = process.argv.slice(2);
const dry = args.includes('--dry');
const srcDir = args.find((a) => !a.startsWith('--'));
if (!srcDir) { console.error('usage: gen-survival-maps.mjs <dir-of-owner-exports> [--dry]'); process.exit(1); }

let n = 0;
for (const f of fs.readdirSync(srcDir).filter((f) => f.endsWith('.json')).sort()) {
  const def = JSON.parse(fs.readFileSync(path.join(srcDir, f), 'utf8'));
  if (def.format !== 'mycelium-level') continue;
  const af = assetsFromOf(def);
  if (!af) { console.error(`  SKIP ${def.id}: could not resolve one asset folder from its rock keys`); continue; }
  if (!fs.existsSync(path.join(ROOT, 'assets', af))) { console.error(`  SKIP ${def.id}: assets/${af} does not exist`); continue; }

  const dst = path.join(OUT, def.id + '.json');
  // Keep any orange/yellow piles a previous run of place-survival-food already wrote, so the two
  // scripts can be re-run in either order without one undoing the other.
  let keptFood = [];
  if (fs.existsSync(dst)) {
    const prev = JSON.parse(fs.readFileSync(dst, 'utf8'));
    keptFood = (prev.objects || []).filter((o) => o.t === 'food' && o.kind !== 'cache-engine');
  }

  const owner = (def.objects || []).filter((o) => !['mountain', 'city', 'prop'].includes(o.t)
                                                && !(o.t === 'food' && o.kind !== 'cache-engine'));
  const out = {
    format: 'mycelium-level',
    version: 1,
    id: def.id,
    name: def.name,
    campaignLevel: null,
    // THE SURVIVAL POOL, and the one flag that puts a map in it. It also means the map's threats
    // are seeded from the LEVEL rather than authored: survival plays these in a random order, so
    // the same map is level 2 in one run and level 40 in the next and a fixed spawn list could
    // only be right for one of them. See createLevelState.
    survival: true,
    assetsFrom: af,
    world: def.world,
    layout: def.layout,
    ...(def.traced ? { traced: def.traced } : {}),
    ...(def.render ? { render: def.render } : {}),
    objects: [...owner, ...keptFood, ...surfaceBackdrop(def.id)],
  };
  const bd = out.objects.filter((o) => o.t === 'mountain' || o.t === 'city');
  console.log(`  ${def.id.padEnd(34)} assets=${af.padEnd(16)} rock=${owner.filter((o) => o.t === 'boulder' || o.t === 'formation').length}` +
    ` water=${owner.filter((o) => o.t === 'lake' || o.t === 'reservoir').length} red=${owner.filter((o) => o.kind === 'cache-engine').length}` +
    ` +backdrop=${bd.length} (${bd.filter((o) => o.t === 'mountain').length}m/${bd.filter((o) => o.t === 'city').length}c)` +
    ` food=${keptFood.length}`);
  if (!dry) fs.writeFileSync(dst, JSON.stringify(out, null, 1) + '\n');
  n++;
}
console.log(`${dry ? 'would write' : 'wrote'} ${n} survival level(s) to docs/levels/`);
