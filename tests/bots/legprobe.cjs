/* LEGPROBE — measures a JOURNEY LEG's generated world, and picks each leg's curated seed.
 * The finishing plan's M7 item 6. A tool: prints, and exits 1 only when `--check` finds a leg failing.
 *
 *   NODE_PATH=/opt/node22/lib/node_modules node tests/bots/legprobe.cjs [--legs 1,2,3] [--seed N]
 *   ...                                                                 [--pick 50] [--check]
 *
 * For each leg it boots '#leg,1,<l>' (or plays a candidate seed on the same page), generates every
 * chunk from chunk 0 to one past the island, waits until `solidifyMineRock` has stamped all of it, and
 * measures on the REAL fine mask (sprite alpha, what growth is tested against):
 *   · reach       — the 4-neighbour fine-mask flood from the home head reaches the taproot (a cell
 *                   within landfall range, 54 units, of the knot); `reachClr` the same with lib.cjs's
 *                   clearance rule (a cell and its 4 neighbours open — a strand needs more than a hairline);
 *   · ratio       — the shortest 8-neighbour path (clearance cells) to landfall over the straight line;
 *   · cheapest    — Dijkstra over clearance cells, each step costing length x the BARE dig price at its
 *                   depth / a grow 2's reach (2 x 3 x 25.5 units): its water, and the share of its EAST
 *                   metres spent below 42 m and below 84 m;
 *   · crust       — the farthest column a flood held to rows 0-2 (fine rows 0-11) reaches from the head;
 *   · lateral     — the longest STRAIGHT lateral channel at least 3 cells tall: consecutive columns on one
 *                   row whose cell and the cells above and below are open (coarse cells sampled on the fine
 *                   mask at their centres, the void-probe convention rotated 90 degrees);
 *   · shallowest  — the shallowest creature row placed on the leg (generator `spots` + the live lists).
 * `--pick N` scores N candidate seeds per leg and prints the ones that pass every gate (see PASS).
 */
const path = require('path');
const H = require('../mine-harness.cjs');

const PASS = (m, leg) => m.reach && m.reachClr && m.ratio >= 1.3 && m.ratio <= 2.0
  && m.crustMaxCol < m.homeCol + 30 && m.lateral <= 36 && m.shallowestRow >= 42
  && (leg < 2 || m.east42 >= 0.5);

// Generate chunk 0 .. island+1, wait for the stamp, measure. Runs in the page.
async function measure(page) {
  await page.evaluate(async () => {
    const g = window.__game, s = g.state, sub = s.substrate, cs = sub.cellSize;
    const L = g.mine.leg();
    const cw = s.config.mine.chunkCols;
    const ic = Math.floor(L.layout.taproot.col / cw);
    g.mine.ensureChunks(0, ((ic + 2) * cw - 1) * cs);
  });
  await page.waitForFunction(() => {
    const sub = window.__game.state.substrate;
    return !!sub._fineSolid && (sub._solidFrom | 0) === sub.levelSprites.length && sub._mineDirtyC0 == null;
  }, { timeout: 30000, polling: 100 });
  return page.evaluate(() => {
    const g = window.__game, s = g.state, sub = s.substrate, cs = sub.cellSize;
    const L = g.mine.leg(), lay = L.layout;
    const cw = s.config.mine.chunkCols;
    const fsz = sub._fineSize, W = sub._fineCols, Hh = sub._fineRows, solid = sub._fineSolid, K = Math.round(cs / fsz);
    const cis = g.mine.chunks();
    const fx0 = Math.min(...cis) * cw * K, fx1 = Math.min(W - 1, (Math.max(...cis) + 1) * cw * K - 1);
    const root = s.active.nodes[0];
    const sx = Math.floor(root.x / fsz), sy = Math.max(0, Math.floor((root.y - sub.surfaceY) / fsz));
    const tx = (lay.taproot.col + 0.5) * cs, ty = sub.surfaceY + (lay.taproot.row + 0.5) * cs;
    const land = (s.config.mine.journey.landfallCells || 1.5) * cs;
    const inWin = (x, y) => x >= fx0 && x <= fx1 && y >= 0 && y < Hh;
    const open = (x, y) => inWin(x, y) && !solid[y * W + x];
    const clr = (x, y) => open(x, y) && open(x + 1, y) && open(x - 1, y) && open(x, y + 1) && (y === 0 || open(x, y - 1));
    const isLand = (x, y) => Math.hypot((x + 0.5) * fsz - tx, sub.surfaceY + (y + 0.5) * fsz - ty) <= land;
    // 1. floods (4-neighbour), plain and with clearance
    const flood = (ok, rowMax) => {
      const seen = new Uint8Array(W * Hh), st = [];
      // Seed on every open fine cell of the root's own coarse cell: the head.
      for (let y = sy; y < sy + K; y++) for (let x = sx - 2; x <= sx + 2; x++) if (ok(x, y) && y < rowMax) { seen[y * W + x] = 1; st.push(y * W + x); }
      let hit = false, maxX = sx;
      while (st.length) {
        const i = st.pop(), y = (i / W) | 0, x = i % W;
        if (x > maxX) maxX = x;
        if (isLand(x, y)) hit = true;
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const nx = x + dx, ny = y + dy;
          if (ny >= rowMax || !ok(nx, ny)) continue;
          const j = ny * W + nx; if (seen[j]) continue;
          seen[j] = 1; st.push(j);
        }
      }
      return { hit, maxX };
    };
    const f1 = flood(open, Hh), f2 = flood(clr, Hh), fc = flood(open, 3 * K);
    // 2. Dijkstra (8-neighbour) with a binary heap; `w(x,y)` is the cost per unit length there.
    const dijkstra = (w, ok = clr) => {
      const N = W * Hh, dist = new Float64Array(N).fill(Infinity), par = new Int32Array(N).fill(-1);
      const hk = [], hv = [];
      const push = (k, v) => { hk.push(k); hv.push(v); let i = hk.length - 1;
        while (i > 0) { const p = (i - 1) >> 1; if (hv[p] <= hv[i]) break; [hk[p], hk[i]] = [hk[i], hk[p]]; [hv[p], hv[i]] = [hv[i], hv[p]]; i = p; } };
      const pop = () => { const k = hk[0], v = hv[0], lk = hk.pop(), lv = hv.pop();
        if (hk.length) { hk[0] = lk; hv[0] = lv; let i = 0;
          for (;;) { const a = 2 * i + 1, b = a + 1; let m = i;
            if (a < hk.length && hv[a] < hv[m]) m = a; if (b < hk.length && hv[b] < hv[m]) m = b;
            if (m === i) break; [hk[m], hk[i]] = [hk[i], hk[m]]; [hv[m], hv[i]] = [hv[i], hv[m]]; i = m; } }
        return [k, v]; };
      for (let y = sy; y < sy + K; y++) for (let x = sx - 2; x <= sx + 2; x++) if (ok(x, y)) { dist[y * W + x] = 0; push(y * W + x, 0); }
      let goal = -1;
      while (hk.length) {
        const [i, d] = pop(); if (d > dist[i]) continue;
        const y = (i / W) | 0, x = i % W;
        if (isLand(x, y)) { goal = i; break; }
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
          if (!dx && !dy) continue;
          const nx = x + dx, ny = y + dy; if (!ok(nx, ny)) continue;
          if (dx && dy && (!ok(x + dx, y) || !ok(x, y + dy))) continue;
          const len = (dx && dy ? Math.SQRT2 : 1) * fsz;
          const nd = d + len * 0.5 * (w(x, y) + w(nx, ny));
          const j = ny * W + nx;
          if (nd < dist[j]) { dist[j] = nd; par[j] = i; push(j, nd); }
        }
      }
      const pathC = [];
      for (let j = goal; j >= 0; j = par[j]) pathC.push(j);
      pathC.reverse();
      return { goal, cost: goal >= 0 ? dist[goal] : Infinity, path: pathC };
    };
    const priceAt = [];
    for (let m = 0; m <= sub.rows + 2; m++) priceAt.push(g.mine.cost(m));
    const reach = 2 * 3 * (s.config.growth.segmentLength || 25.5);
    const shortest = dijkstra(() => 1);
    const straight = Math.hypot(tx - root.x, ty - root.y);
    const ratio = shortest.goal >= 0 ? shortest.cost / straight : Infinity;
    const wPrice = (x, y) => priceAt[Math.max(0, Math.floor(y / K))] / reach;
    const shares = (path) => {
      let east = 0, e42 = 0, e84 = 0;
      for (let k = 1; k < path.length; k++) {
        const a = path[k - 1], b = path[k];
        const dx = (b % W) - (a % W); if (dx <= 0) continue;
        const m = Math.floor(((b / W) | 0) / K);
        east += dx; if (m >= 42) e42 += dx; if (m >= 84) e84 += dx;
      }
      return { east, e42, e84 };
    };
    const cheap = dijkstra(wPrice);
    const { east, e42, e84 } = shares(cheap.path);
    // The same route with no clearance (a hairline gap counts): informational — how much a strand that
    // threads a one-fine-cell slit could save. Not a gate.
    const cheapHair = dijkstra(wPrice, open), sh = shares(cheapHair.path);
    // 3. the longest straight lateral channel, 3 coarse cells tall
    const c0 = Math.min(...cis) * cw, c1 = (Math.max(...cis) + 1) * cw - 1;
    const oc = (c, r) => r >= 0 && r < sub.rows && !sub.solidAtWorld((c + 0.5) * cs, sub.surfaceY + (r + 0.5) * cs);
    let lateral = 0, latAt = null;
    for (let r = 0; r < sub.rows; r++) {
      let run = 0;
      for (let c = c0; c <= c1; c++) {
        if (oc(c, r) && oc(c, r - 1) && oc(c, r + 1)) { run++; if (run > lateral) { lateral = run; latAt = { row: r, endCol: c }; } }
        else run = 0;
      }
    }
    // 4. creatures
    let shallowestRow = Infinity;
    const rowOf = (y) => Math.floor((y - sub.surfaceY) / cs);
    for (const ci of cis) for (const sp of ((s.mineChunks[ci] && s.mineChunks[ci].spots) || [])) shallowestRow = Math.min(shallowestRow, rowOf(sp.y));
    for (const w of s.nematodes || []) if (isFinite(w.y)) shallowestRow = Math.min(shallowestRow, rowOf(w.y));
    for (const c of s.clouds || []) if (isFinite(c.y)) shallowestRow = Math.min(shallowestRow, rowOf(c.y));
    const tapRec = (s.mineChunks[Math.floor(lay.taproot.col / cw)] || {}).taproot || null;
    return {
      leg: L.leg, seed: L.seed, homeCol: lay.homeCol, taproot: lay.taproot, tapRec,
      eastM: lay.taproot.col - lay.homeCol, depthM: lay.taproot.row,
      reach: f1.hit, reachClr: f2.hit, ratio: +ratio.toFixed(3),
      waterHair: +cheapHair.cost.toFixed(1), east42Hair: sh.east ? +(sh.e42 / sh.east).toFixed(3) : 0,
      water: +cheap.cost.toFixed(1), east42: east ? +(e42 / east).toFixed(3) : 0, east84: east ? +(e84 / east).toFixed(3) : 0,
      crustMaxCol: Math.floor(fc.maxX / K), lateral, latAt,
      shallowestRow: shallowestRow === Infinity ? 999 : shallowestRow,
      chunks: cis.length,
    };
  });
}

async function playLeg(page, leg, seed) {
  await page.evaluate(([l, sd]) => window.__game.mine.playLeg(1, l, sd), [leg, seed || 0]);
  await page.waitForFunction(([l, sd]) => {
    const g = window.__game, s = g && g.state, L = g && g.mine.leg();
    return !!(L && L.leg === l && (!sd || L.seed === sd) && s.substrate && s.substrate._fineSolid && s.substrate.mineJourney);
  }, [leg, seed || 0], { timeout: 30000, polling: 100 });
}

async function openLeg(E, leg, seed, vw = 390, vh = 844, file) {
  const b = await E.boot('#leg,1,' + leg + (seed ? ',' + seed : ''), vw, vh, file ? { file } : {});
  await b.page.waitForFunction(() => !!(window.__game && window.__game.mine && window.__game.mine.leg
    && window.__game.mine.leg() && window.__game.state.substrate._fineSolid), { timeout: 40000 });
  return b;
}

module.exports = { measure, playLeg, openLeg, PASS };

if (require.main === module) (async () => {
  const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
  const legs = arg('--legs', '1,2,3').split(',').map(Number);
  const pick = +arg('--pick', 0), seedArg = +arg('--seed', 0), check = process.argv.includes('--check');
  const file = arg('--file', null);     // e.g. a snapshot of index.html under the repo root
  const E = await H.start();
  let bad = 0;
  try {
    for (const leg of legs) {
      const b = await openLeg(E, leg, seedArg || 0, 390, 844, file);
      if (!pick) {
        const m = await measure(b.page);
        const ok = PASS(m, leg);
        if (!ok) bad++;
        console.log(`leg ${leg} seed ${m.seed}: ${ok ? 'PASS' : 'FAIL'} ` + JSON.stringify(m));
      } else {
        const good = [];
        for (let k = 0; k < pick; k++) {
          const sd = ((leg * 7919 + k * 104729 + 12345) % 2147483000) + 1;
          await playLeg(b.page, leg, sd);
          const m = await measure(b.page);
          const ok = PASS(m, leg);
          if (ok) good.push(m);
          console.log(`leg ${leg} cand ${k} seed ${sd}: ${ok ? 'PASS' : '    '} reach ${m.reach}/${m.reachClr} ratio ${m.ratio} water ${m.water} e42 ${m.east42} e84 ${m.east84} crust ${m.crustMaxCol} lat ${m.lateral} creat ${m.shallowestRow} tapRep ${m.tapRec && m.tapRec.repairs}`);
        }
        console.log(`leg ${leg}: ${good.length} of ${pick} candidates pass`);
        // Prefer a ratio near the middle of the band, then (legs 2+) the deepest crossing.
        good.sort((a, b2) => Math.abs(a.ratio - 1.6) - Math.abs(b2.ratio - 1.6));
        for (const m of good.slice(0, 5)) console.log('  ', JSON.stringify(m));
      }
      if (b.errs.length) console.log('page errors:', b.errs.slice(0, 3));
      await b.ctx.close();
    }
  } finally { await E.close(); }
  process.exit(check && bad ? 1 : 0);
})();
