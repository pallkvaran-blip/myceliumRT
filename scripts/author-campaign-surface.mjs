#!/usr/bin/env node
// =============================================================================
// author-campaign-surface.mjs — give each authored campaign level an OVERGROUND.
//
//   node scripts/author-campaign-surface.mjs            # rewrite every campaign-*.json
//   node scripts/author-campaign-surface.mjs --dry      # report, write nothing
//   node scripts/author-campaign-surface.mjs 03 07      # only those campaign slots
//   node scripts/author-campaign-surface.mjs 2-obsidian # ...or any level by id substring
//   then: node scripts/gen-levels.mjs
//
// IT TAKES IDS AS WELL AS SLOTS because the owner's own Chapter 1 maps are not campaign-NN
// files — they are saved out of the in-game editor with their own ids ("2-obsidian") and
// `campaignLevel: null`, and they need this rule as much as the placeholders do. An id argument
// widens the sweep to every docs/levels/*.json; with no arguments it still touches only the
// campaign ten, so the default is unchanged and a traced map's bare horizon stays bare.
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
// ...AND ONE RULE THAT IS NOT SURVIVAL'S, because survival cannot have the problem:
//
//   • NO BUILDING OVER ROCK THE SOIL LINE CUTS (owner: "let's not place buildings over
//     underground rocks that are being clipped by the ground line. it looks weird - better to
//     have mountains on those spots"). An authored map's rock is a SPRITE, dragged by hand, and
//     drawLevelRocks clips it at surfaceY — so a boulder placed high ends as a flat horizontal
//     cut along the horizon. A skyline standing on that cut reads as a building balanced on a
//     sawn-off rock; a MOUNTAIN reads as the same rock continuing up into the sky, which is what
//     it looks like it is doing. Survival never hits this because its rock lives in CELLS, which
//     stop at the soil line by construction and can never be cut by it.
//
//     So every column whose rock is cut becomes mountain, and cities take only what is left.
//
// MEASURED FROM THE SPRITE ALPHA IN THE RUNNING GAME, not from the objects here — which is why
// this script now needs a browser. A boulder's BOUNDING BOX is mostly transparent, so the box
// test (`y - h/2 < surfaceY`) is not close: on campaign-01 it claims 56 of 82 columns where the
// drawn rock cuts 50, and on campaign-04 it claims none where 0 are cut but 12 columns still
// reach the line from below. The alpha is the picture, so the alpha is what decides. Sampled
// with drawLevelRocks' own geometry (centre, size, rotation) via `__game.rockArt`.
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
import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { createServer } from 'node:http';
import { createReadStream, statSync } from 'node:fs';
import { dirname, resolve, extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

// Playwright lives on NODE_PATH here and ESM will not resolve it from there.
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');
const LEVELS = resolve(ROOT, 'docs/levels');
const argv = process.argv.slice(2);
const DRY = argv.includes('--dry');
const ONLY = argv.filter((a) => /^\d+$/.test(a)).map(Number);          // campaign slots
const IDS = argv.filter((a) => !a.startsWith('-') && !/^\d+$/.test(a)); // id substrings

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
// Alpha above which a sprite pixel counts as drawn rock. solidifyRock uses the same idea for
// collision; here it only decides what the eye sees, so the exact value is not delicate.
const ROCK_ALPHA = 40;

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

// [3,4,5,9,10] -> [[3,5],[9,10]]
function toRuns(cols) {
  const runs = [];
  for (const c of [...cols].sort((a, b) => a - b)) {
    const last = runs[runs.length - 1];
    if (last && c === last[1] + 1) last[1] = c; else runs.push([c, c]);
  }
  return runs;
}

// ---------------------------------------------------------------------------
// WHICH COLUMNS DOES THE SOIL LINE CUT? Boots each level and walks every sprite's own alpha.
// ---------------------------------------------------------------------------
async function measureCutColumns(ids) {
  const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.png': 'image/png',
    '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.webp': 'image/webp', '.mp3': 'audio/mpeg', '.wav': 'audio/wav' };
  const srv = await new Promise((res) => {
    const s = createServer((rq, rs) => {
      let p = decodeURIComponent(rq.url.split('?')[0].split('#')[0]);
      if (p === '/') p = '/index.html';
      const fp = join(ROOT, p);
      if (!fp.startsWith(ROOT) || !existsSync(fp) || statSync(fp).isDirectory()) { rs.writeHead(404); rs.end('nf'); return; }
      rs.writeHead(200, { 'Content-Type': TYPES[extname(fp)] || 'application/octet-stream' });
      createReadStream(fp).pipe(rs);
    });
    s.listen(0, () => res(s));
  });
  const base = 'http://localhost:' + srv.address().port;
  const browser = await chromium.launch({ headless: true, executablePath: '/opt/pw-browsers/chromium' });
  const out = {};
  for (const id of ids) {
    const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
    await page.addInitScript(() => { window.MYCELIUM_SUPABASE = { url: '', anonKey: '' }; });
    await page.goto(base + '/index.html#level,' + id, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('#loadscreen.ld-ready', { timeout: 60000 }).catch(() => {});
    await page.click('#loadscreen', { timeout: 5000 }).catch(() => {});
    await page.waitForFunction(() => window.__game && window.__game.state && window.__game.state.active,
      null, { timeout: 30000 }).catch(() => {});
    const r = await page.evaluate(async (A) => {
      const g = window.__game, sub = g.state.substrate;
      // The sprites decode over the first frames and loadLevelAssets is deliberately not
      // awaited, so drive frames until the mask reports ready — measuring before that reads an
      // empty map and would quietly place no mountains at all.
      for (let i = 0; i < 200 && !sub._rockSolidified; i++) {
        try { g.renderFrame(); } catch (_) {}
        await new Promise((r) => setTimeout(r, 50));
      }
      const cs = sub.cellSize, cols = sub.cols, sy = sub.surfaceY, cut = new Set();
      for (const s of sub.levelSprites) {
        if ((s.y - s.h / 2) >= sy) continue;                 // wholly below the line: nothing cut
        const m = g.rockArt(s.key); if (!m) continue;
        const cos = Math.cos(-(s.rot || 0)), sin = Math.sin(-(s.rot || 0));
        for (let py = 0; py < m.mh; py++) for (let px = 0; px < m.mw; px++) {
          if (m.data[(py * m.mw + px) * 4 + 3] < A) continue;
          const lx = (px + 0.5) / m.mw * s.w - s.w / 2, ly = (py + 0.5) / m.mh * s.h - s.h / 2;
          const wx = s.x + lx * cos + ly * sin, wy = s.y - lx * sin + ly * cos;
          if (wy >= sy) continue;                            // below the line: drawn, not cut
          const c = Math.floor(wx / cs);
          if (c >= 0 && c < cols) cut.add(c);
        }
      }
      return { ok: !!sub._rockSolidified, cols, cut: [...cut].sort((a, b) => a - b) };
    }, ROCK_ALPHA);
    if (!r.ok) throw new Error(`${id}: the rock mask never solidified — refusing to author a sky off an unmeasured map`);
    out[id] = r.cut;
    await page.close();
  }
  await browser.close();
  srv.close();
  return out;
}

function buildSurface(level, slot, cutCols) {
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

  // ---- mountains the ROCK demands ------------------------------------------
  // Every cut column has to end up under a mountain, so those runs are placed FIRST and the
  // procedural peaks fill in around them. Three shaping passes, each of which the frames make
  // obvious if you skip it:
  //   • CLAMP to the band. Cut columns outside it (under the home hill, or in the goal
  //     approach) already carry no city — those zones draw their own art — so they need no
  //     mountain and cannot have one.
  //   • MERGE runs closer than GAP_MIN. A gap too narrow for a city is bare ground either way,
  //     and two peaks three columns apart read as one ridge with a notch bitten out of it.
  //   • WIDEN to PEAK_W_MIN. A 3-column mountain sprite is a sliver — the same reason
  //     PEAK_W_MIN exists for the procedural ones.
  // PEAK_W_MAX is deliberately NOT applied here: a mandatory peak has to be as wide as the rock
  // it covers, and survival draws mountains up to 40 cells anyway.
  const inBand = (cutCols || []).filter((c) => c >= bandLo && c <= bandHi);
  let forced = toRuns(inBand);
  for (let i = 0; i < forced.length - 1; ) {
    if (forced[i + 1][0] - forced[i][1] - 1 < GAP_MIN) { forced[i][1] = forced[i + 1][1]; forced.splice(i + 1, 1); }
    else i++;
  }
  forced = forced.map(([c0, c1]) => {
    const w = c1 - c0 + 1;
    if (w >= PEAK_W_MIN) return [c0, c1];
    const grow = PEAK_W_MIN - w, l = Math.floor(grow / 2);
    let a = Math.max(bandLo, c0 - l), b = Math.min(bandHi, a + PEAK_W_MIN - 1);
    a = Math.max(bandLo, b - PEAK_W_MIN + 1);
    return [a, b];
  });
  // Widening can overlap a neighbour; merge again rather than emitting two peaks on one span.
  for (let i = 0; i < forced.length - 1; ) {
    if (forced[i + 1][0] - forced[i][1] - 1 < GAP_MIN) { forced[i][1] = Math.max(forced[i][1], forced[i + 1][1]); forced.splice(i + 1, 1); }
    else i++;
  }

  // ---- mountains survival would have rolled ---------------------------------
  // Survival's count and fraction positions, but only for the peaks the rock has not already
  // supplied — a map whose rock cuts nothing (campaign-04) still wants a sky that looks like
  // survival's, and a map that is cut end to end does not want three more peaks on top.
  let count = pickInt(r, 1, 3);
  const extra = [];
  if (forced.length < count) {
    // The runs left over between the forced peaks, each of which could take one.
    const gaps = [];
    let at = bandLo;
    for (const f of forced) { if (f[0] - at >= PEAK_W_MIN + 2 * GAP_MIN) gaps.push([at, f[0] - 1]); at = f[1] + 1; }
    if (bandHi - at + 1 >= PEAK_W_MIN + 2 * GAP_MIN) gaps.push([at, bandHi]);
    for (const [g0, g1] of gaps) {
      if (forced.length + extra.length >= count) break;
      const room = g1 - g0 + 1 - 2 * GAP_MIN;
      const w = Math.max(PEAK_W_MIN, Math.min(PEAK_W_MAX, Math.min(room, Math.round(pick(r, PEAK_W_MIN, PEAK_W_MAX)))));
      const c0 = g0 + GAP_MIN + Math.floor((room - w) / 2);
      extra.push([c0, c0 + w - 1]);
    }
  }
  const mountains = [...forced, ...extra].sort((a, b) => a[0] - b[0]).map(([c0, c1]) => ({ c0, c1 }));
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
  const cutSet = new Set(cutCols || []);
  runs.forEach((run, i) => {
    if (i >= cityOrder.length) return;                 // at most one of each skyline, as in survival
    const runCells = run.c1 - run.c0 + 1;
    const w = Math.min(runCells, Math.round(pick(r, CITY_W_MIN, CITY_W_MAX)));
    const c0 = run.c0 + Math.floor((runCells - w) / 2); // centred in its run
    const c1 = c0 + w - 1;
    // BELT AND BRACES on the owner's rule. Every cut column inside the band is under a mountain
    // by now, so this can only fire on a bug in the merge/widen passes above — but a building on
    // a sawn-off rock is exactly the thing being fixed, and dropping one skyline costs nothing
    // next to shipping the artefact again.
    for (let c = c0; c <= c1; c++) if (cutSet.has(c)) return;
    cities.push({ c0, c1, key: cityOrder[i] });
  });

  const objects = [
    ...mountains.map((m, i) => spanObject('mountain', peakOrder[i % peakOrder.length], m.c0, m.c1, cs)),
    ...cities.map((c) => spanObject('city', c.key, c.c0, c.c1, cs)),
  ];
  return { objects, mountains, cities, band: [bandLo, bandHi], cols, forced: forced.length, extra: extra.length };
}

// Naming an id opens the sweep to every level file; otherwise it is the campaign ten.
const files = readdirSync(LEVELS)
  .filter((f) => f.endsWith('.json') && (IDS.length || /^campaign-\d\d-/.test(f)))
  .sort();
const chosen = files.map((f) => ({ f, level: JSON.parse(readFileSync(resolve(LEVELS, f), 'utf8')) }))
  .filter(({ level }) => (!ONLY.length && !IDS.length)
    || ONLY.includes(level.campaignLevel)
    || IDS.some((id) => String(level.id).includes(id)));
if (!chosen.length) { console.error('no level matched ' + JSON.stringify(argv.filter((a) => !a.startsWith('-')))); process.exit(1); }

console.log(`measuring the soil-line cut on ${chosen.length} level(s) — booting each map…\n`);
const cutByLevel = await measureCutColumns(chosen.map(({ level }) => level.id));

let touched = 0;
for (const { f, level } of chosen) {
  const p = resolve(LEVELS, f);
  // The rng SEED, so a map's sky is the same every run. A campaign map uses its slot; a map
  // with no slot (the owner's own Chapter 1 saves) hashes its id instead, which is just as
  // stable and is unique per map — `null | 0` would seed every one of them identically.
  const slot = level.campaignLevel != null ? level.campaignLevel
    : ([...String(level.id)].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7) % 9973) + 1;

  // Idempotent: drop any surface objects from a previous run before regenerating, so this can
  // be re-run after a retune without stacking a second skyline on the first.
  const SURFACE = new Set(['mountain', 'city', 'prop']);
  const kept = level.objects.filter((o) => !SURFACE.has(o.t));
  const dropped = level.objects.length - kept.length;

  const cut = cutByLevel[level.id] || [];
  const { objects, mountains, cities, band, forced, extra } = buildSurface(level, slot, cut);
  // Surface objects last: they change no cell that food or water cares about (a mountain only
  // flags `surface[c].barrier`, a city changes nothing at all), so order is free — but keeping
  // the underground block first leaves the designer's own list where they wrote it.
  level.objects = [...kept, ...objects];

  const mtnTxt = mountains.map((m) => `${m.c0}-${m.c1}`).join(' ') || 'none';
  const cityTxt = cities.map((c) => `${c.key}@${c.c0}-${c.c1}`).join(' ') || 'none';
  console.log(`${level.id}  (slot ${slot})`);
  console.log(`   soil line cuts ${cut.length} col(s): ${JSON.stringify(toRuns(cut))}`);
  console.log(`   band cols ${band[0]}-${band[1]}   mountains: ${mtnTxt}  (${forced} forced by rock, ${extra} rolled)`);
  console.log(`   cities: ${cityTxt}` + (dropped ? `   [replaced ${dropped} previous surface object(s)]` : ''));
  if (!DRY) { writeFileSync(p, JSON.stringify(level, null, 2) + '\n'); touched++; }
}
console.log(DRY ? '\n--dry: nothing written.' : `\n${touched} level(s) rewritten. Next: node scripts/gen-levels.mjs`);
