#!/usr/bin/env node
// Scatter the orange (`cache`) and yellow (`duff`) leaf piles across every survival map.
//
// WHY THIS DRIVES THE REAL GAME instead of computing offline. A traced map's rock is a set of
// irregular sprite silhouettes, and its COLLISION is derived from each sprite's own alpha at
// RENDER time (main.js solidifyRock → `substrate._fineSolid`). There is no rock in the JSON to
// test against: `cell.rock` is empty until a frame has drawn. Reproducing that mask offline
// would be a second implementation of the exact thing the placement has to respect, and the two
// would drift. So each map is booted headless, given time to solidify, and the spots are chosen
// against the mask the player will actually play.
//
// FOUR RULES, and each one is a bug that would otherwise ship:
//   • NEVER OVERLAP ROCK. `markCoverGrid` skips every cell holding food, deliberately ("never
//     bury a food pile") — so a pile dropped inside a boulder opens a hole you can see and grow
//     through in a wall that still looks solid. Measured on garnet-c40 at 81 of 81 fine cells
//     down to 25. The test here is the game's own `objectHolesRock` logic, run at the pile's
//     real radius.
//   • REACHABLE. A flood over the FINE mask from the colony's own root — the mask growth tests,
//     not the coarse one. Food the colony cannot reach is food that is not in the game.
//   • SPREAD OUT. Farthest-point selection, so ten piles do not end up in the one big open
//     pocket. The two kinds are picked alternately from the same spread, so orange and yellow
//     interleave instead of the map having an orange half and a yellow half.
//   • CLEAR OF WATER, of the owner's red pile, and of the entry/goal channels.
//
// TURN-BASED BOOT (`#level,<id>,turn`), because `#level,<id>` alone boots REAL TIME and the sim
// starts ticking the moment the map loads — measured on one map as food going 105 cells → 10
// over two and a half seconds while the threats ate it. Nothing advances without a player
// action in turn-based, so what is measured is the map.
//
//   node scripts/place-survival-food.mjs                 # every survival map
//   node scripts/place-survival-food.mjs <id> <id> ...   # just these
//   CACHE=5 DUFF=5 node scripts/place-survival-food.mjs  # counts (default 5 and 5)
//
// Re-running REPLACES the orange/yellow piles and leaves everything else — rock, water and the
// owner's red pile — untouched. It is deterministic: the candidate order is seeded from the
// map's id, so the same map gets the same scatter every time and a re-run is an empty diff.
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const LEVELS = path.join(ROOT, 'docs', 'levels');
const N_CACHE = +(process.env.CACHE || 5);
const N_DUFF = +(process.env.DUFF || 5);
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.png': 'image/png',
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.svg': 'image/svg+xml', '.webp': 'image/webp',
  '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.css': 'text/css' };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const want = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const files = fs.readdirSync(LEVELS).filter((f) => f.endsWith('.json'))
  .map((f) => ({ f, def: JSON.parse(fs.readFileSync(path.join(LEVELS, f), 'utf8')) }))
  .filter(({ def }) => def.survival && (!want.length || want.includes(def.id)))
  .sort((a, b) => a.def.id.localeCompare(b.def.id));
if (!files.length) { console.error('no survival maps matched'); process.exit(1); }

// Runs INSIDE the page. Returns the chosen {x,y} spots, or a diagnosis of why it could not.
function chooseSpots({ nCache, nDuff, seedStr }) {
  const g = window.__game, st = g.state, sub = st.substrate;
  if (!sub._fineSolid) return { err: 'rock mask never solidified' };
  const cs = sub.cellSize, fs = sub._fineSize;
  // Reachability on the FINE mask, from the colony's own root — the mask growth tests.
  const root = st.networks[0].nodes[0];
  const FC = sub._fineCols, FR = sub._fineRows;
  const seen = new Uint8Array(FC * FR);
  const q = [];
  const push = (fc, fr) => {
    if (fc < 0 || fr < 0 || fc >= FC || fr >= FR) return;
    const i = fr * FC + fc;
    if (seen[i] || sub._fineSolid[i] === 1) return;
    seen[i] = 1; q.push(i);
  };
  push(Math.floor(root.x / fs), Math.floor((root.y - sub.surfaceY) / fs));
  for (let h = 0; h < q.length; h++) {
    const i = q[h], fc = i % FC, fr = (i / FC) | 0;
    push(fc + 1, fr); push(fc - 1, fr); push(fc, fr + 1); push(fc, fr - 1);
  }
  const reachable = (x, y) => {
    const fc = Math.floor(x / fs), fr = Math.floor((y - sub.surfaceY) / fs);
    return fc >= 0 && fr >= 0 && fc < FC && fr < FR && seen[fr * FC + fc] === 1;
  };
  // The game's own "does this pile hole the rock?" test, at the pile's real radius (r:1 cell).
  const holes = (x, y) => {
    const reach = cs;
    for (let dx = -reach; dx <= reach; dx += fs)
      for (let dy = -reach; dy <= reach; dy += fs) {
        if (dx * dx + dy * dy > reach * reach) continue;
        if (sub.solidAtWorld(x + dx, y + dy)) return true;
      }
    return false;
  };

  // The bands a pile may not sit in: the entry channel the colony roots in and the goal
  // channel, both flagged pathClear (rock loses to them, so a pile there is free food), plus a
  // margin so the diamond footprint cannot reach either.
  const lay = st.levelDef && st.levelDef.layout || {};
  const xLo = ((lay.startCols || 2) + 2) * cs;
  const xHi = sub.worldWidth - ((lay.goalCols || 6) + (lay.summerCols || 7) + 2) * cs;
  // Keep out of the top row of soil (the surface band reads as sky) and off the core floor.
  const yLo = sub.surfaceY + cs * 2;
  const yHi = (sub.growFloorY != null ? sub.growFloorY : sub.worldHeight) - cs * 2;

  // Existing objects a new pile must not land on: the owner's red pile, every reservoir/lake,
  // and any pile a previous run of this script placed (they are rewritten, so only the ones in
  // THIS pass matter — but the red one is theirs and is read off the live substrate).
  const taken = [];
  for (const p of sub.foodPiles || []) {
    for (const idx of p.cells) { taken.push({ x: (idx % sub.cols) * cs + cs / 2, y: sub.surfaceY + (((idx / sub.cols) | 0) + 0.5) * cs }); break; }
  }

  // Deterministic candidate order, seeded from the map id, so a re-run is an empty diff.
  let h32 = 2166136261 >>> 0;
  for (let i = 0; i < seedStr.length; i++) { h32 ^= seedStr.charCodeAt(i); h32 = Math.imul(h32, 16777619) >>> 0; }
  const rnd = () => { h32 ^= h32 << 13; h32 >>>= 0; h32 ^= h32 >> 17; h32 ^= h32 << 5; h32 >>>= 0; return h32 / 4294967296; };

  // Sweep the whole legal box on the CELL grid, keep everything clean, then thin it down.
  const cand = [];
  for (let y = yLo; y <= yHi; y += cs) {
    for (let x = xLo; x <= xHi; x += cs) {
      const cell = sub.cellAtWorld(x, y);
      if (!cell || cell.water || cell.hazard || cell.maxNutrient > 0) continue;
      if (!reachable(x, y)) continue;
      if (holes(x, y)) continue;
      cand.push({ x: Math.round(x), y: Math.round(y) });
    }
  }
  if (cand.length < nCache + nDuff) return { err: `only ${cand.length} legal spot(s)`, cand: cand.length };

  // FARTHEST-POINT selection so ten piles cover the map instead of crowding one pocket. Seeded
  // from the existing piles as well, so the new scatter also keeps its distance from the red one.
  for (let i = cand.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [cand[i], cand[j]] = [cand[j], cand[i]]; }
  const chosen = [];
  const d2 = (a, b) => (a.x - b.x) * (a.x - b.x) + (a.y - b.y) * (a.y - b.y);
  const anchors = taken.slice();
  // First pick: the candidate farthest from everything already on the map (or a stable one if
  // the map has nothing yet).
  while (chosen.length < nCache + nDuff) {
    let best = null, bestD = -1;
    for (const c of cand) {
      if (chosen.includes(c)) continue;
      let m = Infinity;
      for (const a of anchors.concat(chosen)) m = Math.min(m, d2(c, a));
      if (m === Infinity) m = 1e12;
      if (m > bestD) { bestD = m; best = c; }
    }
    if (!best) break;
    chosen.push(best);
  }
  // Alternate the kinds down the spread, so neither colour clusters.
  const out = [];
  let nc = nCache, nd = nDuff;
  for (const c of chosen) {
    const wantCache = nc > 0 && (nd === 0 || out.length % 2 === 0);
    if (wantCache) { out.push({ ...c, kind: 'cache' }); nc--; } else { out.push({ ...c, kind: 'duff' }); nd--; }
  }
  return { spots: out, cand: cand.length, spread: Math.round(Math.sqrt(Math.min(...out.map((a, i) => Math.min(...out.filter((_, j) => j !== i).map((b) => d2(a, b))))))) };
}

(async () => {
  const srv = await new Promise((res) => { const s = http.createServer((rq, rs) => {
    let p = decodeURIComponent(rq.url.split('?')[0].split('#')[0]); if (p === '/') p = '/index.html';
    const fp = path.join(ROOT, p);
    if (!fp.startsWith(ROOT) || !fs.existsSync(fp) || fs.statSync(fp).isDirectory()) { rs.writeHead(404); rs.end('nf'); return; }
    rs.writeHead(200, { 'Content-Type': MIME[path.extname(fp)] || 'application/octet-stream' });
    fs.createReadStream(fp).pipe(rs); }); s.listen(0, () => res(s)); });
  const base = 'http://localhost:' + srv.address().port;
  const browser = await chromium.launch({ headless: true, executablePath: '/opt/pw-browsers/chromium' });

  let done = 0, failed = 0;
  for (const { f, def } of files) {
    // ONE BROWSER CONTEXT PER MAP. Reusing one has leaked state between maps before, and here
    // the leak would be a sprite cache keyed by src — two maps' rock in one mask.
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const page = await ctx.newPage();
    await page.addInitScript(() => { window.MYCELIUM_SUPABASE = { url: '', anonKey: '' }; });
    await page.goto(base + '/index.html#level,' + def.id + ',turn', { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('#loadscreen.ld-ready', { timeout: 40000 }).catch(() => {});
    await page.click('#loadscreen', { timeout: 5000 }).catch(() => {});
    await page.waitForFunction(() => !!(window.__game && window.__game.state), { timeout: 40000 }).catch(() => {});
    // The mask lands on the first frame after every sprite decodes; a big map takes a few.
    const solid = await page.waitForFunction(() => {
      const s = window.__game && window.__game.state;
      return !!(s && s.substrate && s.substrate._fineSolid);
    }, { timeout: 60000 }).then(() => true).catch(() => false);

    if (!solid) { console.log(`  FAIL ${def.id}: rock mask never solidified`); failed++; await ctx.close(); continue; }
    const r = await page.evaluate(chooseSpots, { nCache: N_CACHE, nDuff: N_DUFF, seedStr: def.id }).catch((e) => ({ err: String(e.message || e) }));
    await ctx.close();
    if (!r || r.err) { console.log(`  FAIL ${def.id}: ${(r && r.err) || 'no result'}`); failed++; continue; }

    const kept = def.objects.filter((o) => !(o.t === 'food' && o.kind !== 'cache-engine'));
    const piles = r.spots.map((s) => ({ t: 'food', kind: s.kind, x: s.x, y: s.y, r: 1, energy: s.kind === 'cache' ? 4 : 2 }));
    // Slot the new piles in beside the owner's red one rather than at the end, so the objects
    // list still reads food-with-food.
    const at = kept.findIndex((o) => o.t === 'food');
    def.objects = at < 0 ? [...kept, ...piles] : [...kept.slice(0, at + 1), ...piles, ...kept.slice(at + 1)];
    fs.writeFileSync(path.join(LEVELS, f), JSON.stringify(def, null, 1) + '\n');
    console.log(`  ${def.id.padEnd(34)} ${piles.filter((p) => p.kind === 'cache').length} orange + ${piles.filter((p) => p.kind === 'duff').length} yellow` +
      `   (${r.cand} legal spots, nearest pair ${r.spread}u)`);
    done++;
  }
  console.log(`\nplaced on ${done} map(s), ${failed} failed`);
  await browser.close(); srv.close();
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error('ERROR', e); process.exit(1); });
