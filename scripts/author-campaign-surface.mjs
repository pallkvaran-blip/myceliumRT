#!/usr/bin/env node
// =============================================================================
// author-campaign-surface.mjs — give each authored campaign level an OVERGROUND.
//
//   node scripts/author-campaign-surface.mjs            # rewrite every campaign-*.json
//   node scripts/author-campaign-surface.mjs --dry      # report, write nothing
//   node scripts/author-campaign-surface.mjs 03 07      # only those slots
//   then: node scripts/gen-levels.mjs
//
// A traced map ships with rock and nothing above the soil line. buildLevel flags every
// non-goal surface column 'concrete', and the two renderers that would otherwise decorate it
// BOTH stand down on an authored map:
//
//   mountainRuns()  returns sub.authoredMountains when non-empty, else derives runs from
//                   `surface[c].barrier === 'mountain'` — which an authored map never sets.
//   cityRuns()      returns sub.authoredCities when non-empty, else derives runs from the
//                   contiguous 'concrete' spans.
//
// and drawMountains bails on `!runs.length` BEFORE the foreground peaks — so a level with no
// mountain object gets no peaks at all. (The distant hazed RANGE is drawn above that guard, so
// it shows either way.) The result is a bare horizon. This script places what the procedural
// game would have placed, so a campaign map's sky reads like a survival map's.
//
// THE RULES ARE SURVIVAL'S, transcribed from generateSubstrate + cityRuns:
//
//   • MOUNTAINS. Procedurally `wallCount` = 1-3 barriers of `wallWidthCols` (3) cells, centred
//     at (i+1)/(count+1) across [startCols+3, goalStart-3-wallW-summerCols] with ±2 jitter.
//   • CITIES. Every contiguous 'concrete' run of at least CITY_MIN_RUN (5) cells takes one
//     skyline, centred, CITY_W_MIN..CITY_W_MAX (7-12) cells wide and capped at the run, never
//     starting under the left home hill (homeHillCols()).
//   • PROPS. None. surfaceProps() scatters trees on `surf.soil && !surf.goal`, and no column
//     is ever both — the goal zone sets soil AND goal together — so survival's dark surface
//     carries no trees at all. Adding them here would look like survival to nobody who has
//     played it. The goal hill's own greenery is drawn by the goal renderer, not from objects.
//   • NO LAKES (owner). generateSubstrate carves lakeCountMin..Max basins; skipped entirely.
//     Two of these levels place their own water, and that is the designer's, not this script's.
//
// ONE DEPARTURE, and it is forced. Procedurally a mountain's BARRIER is 3 cells while its
// SPRITE is drawn 10-40 cells wide (MOUNTAIN_W_MIN/MAX) — two independent numbers. An authored
// mountain has only one: buildLevel derives the span from the object's own width
// (`spanCols`), and mountainRuns hands that same span to the renderer as `wCells`. A faithful
// 3-cell object would therefore draw a 3-cell sliver. So the objects here are written at the
// DRAWN width and the barrier span widens to match. That costs nothing: every non-goal column
// is impassable already, 'mountain' and 'concrete' differ only in which art covers them.
//
// Deterministic per slot, so re-running reproduces the same sky rather than reshuffling it.
// =============================================================================
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');
const LEVELS = resolve(ROOT, 'docs/levels');
const argv = process.argv.slice(2);
const DRY = argv.includes('--dry');
const ONLY = argv.filter((a) => /^\d+$/.test(a)).map(Number);

// Straight from index.html — kept as named constants so a retune there is a visible mismatch
// here rather than a silent drift.
const MOUNTAIN_W_MIN = 10, MOUNTAIN_W_MAX = 40;
const CITY_W_MIN = 7, CITY_W_MAX = 12, CITY_MIN_RUN = 5;
const CITY_KEYS = ['skyline1', 'skyline2', 'skyline3', 'skyline4', 'skyline5', 'skyline6'];
const PEAK_KEYS = ['mountain1', 'mountain2', 'mountain3', 'mountain4', 'mountain5'];
// Narrower than survival's 10-40. At 40 cells three peaks would cover half an 82-column map and
// overlap into one ridge — survival gets away with it because its barrier is 3 cells and only
// the SPRITE is wide, so its peaks are free to overlap. Ours own their span, so they have to
// fit side by side and still leave runs wide enough for a skyline.
const PEAK_W_MIN = 12, PEAK_W_MAX = 26;
const GAP_MIN = CITY_MIN_RUN + 1;        // every gap must be able to hold a city

// Deterministic per slot: same level, same sky, every run.
function rng(seed) {
  let s = (seed * 2654435761) >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}
const pick = (r, lo, hi) => lo + r() * (hi - lo);
const pickInt = (r, lo, hi) => Math.floor(lo + r() * (hi - lo + 1));

// A surface object spans whole CELLS, and buildLevel recovers that span from x and w via
// spanCols: c0 = floor((x - w/2)/cs), c1 = ceil((x + w/2)/cs) - 1. Inverting it here means the
// span the loader computes is exactly the one this script decided, with no off-by-one at the
// right edge (`ceil - 1` is why the naive centre+width lands one column wide).
const spanObject = (t, key, c0, c1, cs) => ({
  t, key,
  x: ((c0 + c1 + 1) / 2) * cs,
  w: (c1 - c0 + 1) * cs,
});

function buildSurface(level, slot) {
  const cs = level.world.cellSize || 36;
  const cols = Math.round(level.world.width / cs);
  const lay = level.layout || {};
  const goalCols = Math.max(2, Math.min(cols - 4, lay.goalCols || 6));
  const startCols = Math.max(1, Math.min(cols - goalCols - 1, lay.startCols || 2));
  const goalStart = cols - goalCols;
  const summerCols = Math.max(0, Math.min(goalStart - startCols - 2, lay.summerCols != null ? lay.summerCols : 7));
  // The band the dark-world surface may use: right of the home hill (homeHillCols, which is
  // max(6, startCols + 4)) and left of the summery approach that leads into the goal.
  const homeCols = Math.max(6, startCols + 4);
  const bandLo = homeCols;
  const bandHi = goalStart - summerCols - 1;
  const band = bandHi - bandLo + 1;
  const r = rng(slot * 7919 + 13);

  // ---- mountains ----------------------------------------------------------
  // Survival's count, survival's fraction positions. Widths are then trimmed until the peaks
  // and the gaps between them both fit the band, rather than placed and left overlapping.
  let count = pickInt(r, 1, 3);
  let widths = [];
  for (let i = 0; i < count; i++) widths.push(Math.round(pick(r, PEAK_W_MIN, PEAK_W_MAX)));
  const gapsNeeded = (n) => (n + 1) * GAP_MIN;
  while (count > 0 && widths.reduce((a, b) => a + b, 0) + gapsNeeded(count) > band) {
    const total = widths.reduce((a, b) => a + b, 0);
    if (total > count * PEAK_W_MIN) {
      const i = widths.indexOf(Math.max(...widths));
      widths[i] -= 1;                                  // shave the widest first
    } else { count -= 1; widths.pop(); }               // one peak fewer rather than a cramped one
  }

  const mountains = [];
  if (count > 0) {
    // Survival centres peak i at (i+1)/(count+1) of the inner band, ±2 columns of jitter. Kept,
    // then clamped so neighbours cannot overlap and the end gaps stay city-sized.
    let cursor = bandLo + GAP_MIN;
    for (let i = 0; i < count; i++) {
      const frac = (i + 1) / (count + 1);
      const want = Math.round(bandLo + frac * band + pick(r, -2, 2) - widths[i] / 2);
      const remainingAfter = widths.slice(i + 1).reduce((a, b) => a + b, 0) + gapsNeeded(count - i - 1);
      const c0 = Math.max(cursor, Math.min(want, bandHi - remainingAfter - widths[i] + 1));
      const c1 = c0 + widths[i] - 1;
      if (c1 > bandHi) break;
      mountains.push({ c0, c1 });
      cursor = c1 + 1 + GAP_MIN;
    }
  }
  // A distinct peak per mountain, shuffled per level so the ten do not all open on mountain1.
  const peakOrder = PEAK_KEYS.map((k) => ({ k, o: r() })).sort((a, b) => a.o - b.o).map((o) => o.k);

  // ---- cities -------------------------------------------------------------
  // The runs cityRuns() would have derived: the concrete left between the mountains, inside the
  // same band. A run shorter than CITY_MIN_RUN stays bare ground, exactly as it does in survival.
  const runs = [];
  let at = bandLo;
  for (const m of mountains) {
    if (m.c0 - at >= CITY_MIN_RUN) runs.push({ c0: at, c1: m.c0 - 1 });
    at = m.c1 + 1;
  }
  if (bandHi - at + 1 >= CITY_MIN_RUN) runs.push({ c0: at, c1: bandHi });

  const cityOrder = CITY_KEYS.map((k) => ({ k, o: r() })).sort((a, b) => a.o - b.o).map((o) => o.k);
  const cities = [];
  runs.forEach((run, i) => {
    if (i >= cityOrder.length) return;                 // at most one of each skyline, as in survival
    const runCells = run.c1 - run.c0 + 1;
    const w = Math.min(runCells, Math.round(pick(r, CITY_W_MIN, CITY_W_MAX)));
    const c0 = run.c0 + Math.floor((runCells - w) / 2); // centred in its run
    cities.push({ c0, c1: c0 + w - 1, key: cityOrder[i] });
  });

  const objects = [
    ...mountains.map((m, i) => spanObject('mountain', peakOrder[i % peakOrder.length], m.c0, m.c1, cs)),
    ...cities.map((c) => spanObject('city', c.key, c.c0, c.c1, cs)),
  ];
  return { objects, mountains, cities, band: [bandLo, bandHi], cols };
}

const files = readdirSync(LEVELS).filter((f) => /^campaign-\d\d-.*\.json$/.test(f)).sort();
let touched = 0;
for (const f of files) {
  const p = resolve(LEVELS, f);
  const level = JSON.parse(readFileSync(p, 'utf8'));
  const slot = level.campaignLevel;
  if (ONLY.length && !ONLY.includes(slot)) continue;

  // Idempotent: drop any surface objects from a previous run before regenerating, so this can
  // be re-run after a retune without stacking a second skyline on the first.
  const SURFACE = new Set(['mountain', 'city', 'prop']);
  const kept = level.objects.filter((o) => !SURFACE.has(o.t));
  const dropped = level.objects.length - kept.length;

  const { objects, mountains, cities, band } = buildSurface(level, slot);
  // Surface objects last: they change no cell that food or water cares about (a mountain only
  // flags `surface[c].barrier`, a city changes nothing at all), so order is free — but keeping
  // the underground block first leaves the designer's own list where they wrote it.
  level.objects = [...kept, ...objects];

  const mtnTxt = mountains.map((m) => `${m.c0}-${m.c1}`).join(' ') || 'none';
  const cityTxt = cities.map((c) => `${c.key}@${c.c0}-${c.c1}`).join(' ') || 'none';
  console.log(`${level.id}  (slot ${slot})`);
  console.log(`   band cols ${band[0]}-${band[1]}   mountains: ${mtnTxt}   cities: ${cityTxt}` +
    (dropped ? `   [replaced ${dropped} previous surface object(s)]` : ''));
  if (!DRY) { writeFileSync(p, JSON.stringify(level, null, 2) + '\n'); touched++; }
}
console.log(DRY ? '\n--dry: nothing written.' : `\n${touched} level(s) rewritten. Next: node scripts/gen-levels.mjs`);
