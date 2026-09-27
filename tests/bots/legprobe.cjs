/* LEGPROBE — measures a JOURNEY LEG's generated world, and picks each leg's curated seed.
 * The finishing plan's M7 item 6. A tool: prints, and exits 1 only when `--check` finds a leg failing.
 *
 *   NODE_PATH=/opt/node22/lib/node_modules node tests/bots/legprobe.cjs [--legs 1,2,3] [--seed N]
 *   ...                                                                 [--pick 50] [--check]
 *
 * For each leg it boots '#leg,1,<l>' (or plays a candidate seed on the same page), generates every
 * chunk from chunk 0 to one past the island, waits until `solidifyMineRock` has stamped all of it, and
 * measures on the REAL fine mask (sprite alpha, what growth is tested against):
 * THE GROWTH LATTICE IS THE MODEL (M7 verifier fix). Growth places a node wherever the point is not
 * under drawn rock and tests a segment by sampling it every 0.7 fine cells, so a strand threads
 * hairlines; the first version measured with lib.cjs's CLEARANCE rule (a cell and its 4 neighbours
 * open) and certified a "broken shallow road" that real growth crossed at 42% below 42 m in 58 digs.
 * Lattice nodes are open fine-cell centres, edges are unit steps plus segment-length hops, every edge
 * checked with `_segmentClear`'s own sampling — an upper bound on what growth can pass.
 *   · reach       — the 4-neighbour fine-mask flood from the home head reaches the taproot (a cell
 *                   within landfall range, 54 units, of the knot); `reachLat` the same over the lattice
 *                   (`reachClr` with clearance: information only);
 *   · ratio       — the shortest growth-lattice path to landfall over the straight line; `ratioFine` the
 *                   plain 8-neighbour fine-mask path (no corner cutting); `ratioClr` with clearance;
 *   · cheapest    — Dijkstra over the lattice, each step costing length x the BARE dig price at its
 *                   depth / a grow 2's reach (2 x 3 x 25.5 units): its water, and the share of its EAST
 *                   metres spent below 42 m and below 84 m (`...Fine`, `...Clr`: the other two models);
 *   · shallow     — the farthest column the lattice reaches without going below 42 m;
 *   · seam        — the longest run of fine rows down any chunk seam with an open fine cell within 2 of
 *                   the seam line (the SEAM SLIT; the stitch pass closes it on a journey leg);
 *   · sealLeak    — sealed seam sides the lattice crosses within 8 columns / 5 rows without using a
 *                   crossing both carves made;
 *   · crust       — the farthest column a flood held to rows 0-2 (fine rows 0-11) reaches from the head;
 *   · lateral     — the longest STRAIGHT lateral channel at least 3 cells tall: consecutive columns on one
 *                   row whose cell and the cells above and below are open (coarse cells sampled on the fine
 *                   mask at their centres, the void-probe convention rotated 90 degrees);
 *   · shallowest  — the shallowest creature row placed on the leg (generator `spots` + the live lists).
 * `--pick N` scores N candidate seeds per leg, prints the ones that pass every gate (see PASS), and
 * DIGS the top five with `follow` (real growth along the cheapest route); pick one that landed.
 * `--follow` does the same for the curated (or `--seed`) seed.
 */
const path = require('path');
const H = require('../mine-harness.cjs');

// The plan: the rows-0-2 flood "never passes column 66 (home + 30)" — reaching 66 is allowed, so `<=`,
// the same comparison journey-check makes (it used `<` here and `<=` there).
// WPASS: the whole-world gates (`world`), checked on a candidate that passes PASS.
const WPASS = (w) => w.pilesOk === w.piles && w.pocketsOk === w.pockets && w.lateral <= 36
  && w.seamSolid != null && w.seamSolid - w.midSolid <= 0.2;
const PASS = (m, leg) => m.reach && m.reachLat && m.ratio >= 1.3 && m.ratio <= 2.0 && m.ratioFine >= 1.3 && m.ratioFine <= 2.0
  && m.crustMaxCol <= m.homeCol + 30 && m.lateral <= 36 && m.shallowestRow >= 42 && m.seamRunRows <= 42
  && (m.leaks || []).every((l) => l[1] >= (m.rows || 168) - 6)   // no sealed side above the floor strip leaks
  && (leg < 2 || m.east42 >= 0.5);

// Generate chunk 0 .. island+1, wait for the stamp, measure. Runs in the page.
async function measure(page, opts) {
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
  return page.evaluate((opts) => {
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
    const cxW = (x) => (x + 0.5) * fsz, cyW = (y) => sub.surfaceY + (y + 0.5) * fsz;
    // THE GROWTH LATTICE — what a strand can actually do (M7 verifier fix). Growth places a node
    // wherever the point is not under drawn rock (`Network._placeOk`) and tests a segment by sampling
    // it every 0.7 fine cells (`Network._segmentClear`), so a strand threads any gap a sample fits
    // through, including a hairline and a corner a long segment clips. Nodes are the open fine-cell
    // centres; an edge is either a unit step (8-neighbour) or a hop the length of a growth segment
    // (16 directions, ~2.8-3.2 fine cells), and EVERY edge is validated with the same sampling as
    // `_segmentClear`. It is an UPPER bound on what growth can pass (a strand cannot follow every
    // unit-step wiggle), which is the conservative side for "is the cheapest crossing deep?".
    const segOk = (x0, y0, x1, y1) => {
      const ax = cxW(x0), ay = cyW(y0), dx = cxW(x1) - ax, dy = cyW(y1) - ay;
      const n = Math.max(1, Math.ceil(Math.hypot(dx, dy) / (fsz * 0.7)));
      for (let i = 1; i <= n; i++) {
        const t = i / n, px = ax + dx * t, py = ay + dy * t;
        if (py <= sub.surfaceY + 2 || py >= sub.growFloorY - 2) return false;
        const fc = Math.floor(px / fsz), fr = Math.floor((py - sub.surfaceY) / fsz);
        if (!inWin(fc, fr) || solid[fr * W + fc]) return false;
      }
      return true;
    };
    const LAT = [];
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (dx || dy) LAT.push([dx, dy]);
    for (const [a, b] of [[3, 0], [3, 1], [2, 2], [1, 3]])
      for (const [sa, sb] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
        LAT.push([a * sa, b * sb]); if (a !== b) LAT.push([b * sa, a * sb]);
      }
    const LATU = []; { const seen = new Set(); for (const e of LAT) { const k = e.join(); if (!seen.has(k)) { seen.add(k); LATU.push(e); } } }
    const latOk = (x, y) => open(x, y) && cyW(y) > sub.surfaceY + 2;
    // 1. floods (4-neighbour), plain and with clearance; and over the growth lattice
    const seeds = (ok) => { const out = []; for (let y = sy; y < sy + K; y++) for (let x = sx - 2; x <= sx + 2; x++) if (ok(x, y)) out.push(y * W + x); return out; };
    const flood = (ok, rowMax) => {
      const seen = new Uint8Array(W * Hh), st = [];
      for (const i of seeds(ok)) if (((i / W) | 0) < rowMax) { seen[i] = 1; st.push(i); }
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
    const latFlood = (rowMax) => {
      const seen = new Uint8Array(W * Hh), st = [];
      for (const i of seeds(latOk)) { seen[i] = 1; st.push(i); }
      let hit = false, maxX = sx;
      while (st.length) {
        const i = st.pop(), y = (i / W) | 0, x = i % W;
        if (x > maxX) maxX = x;
        if (isLand(x, y)) hit = true;
        for (const [dx, dy] of LATU) {
          const nx = x + dx, ny = y + dy;
          if (ny >= rowMax || !latOk(nx, ny)) continue;
          const j = ny * W + nx; if (seen[j]) continue;
          if (!segOk(x, y, nx, ny)) continue;
          seen[j] = 1; st.push(j);
        }
      }
      return { hit, maxX };
    };
    const f1 = flood(open, Hh), f2 = flood(clr, Hh), fc = flood(open, 3 * K);
    const fl = latFlood(Hh);
    // How far east growth can get while never going below 42 m (a strand confined to band 0).
    const fShallow = latFlood(42 * K);
    // 2. Dijkstra with a binary heap; `w(x,y)` is the cost per unit length there. `mode`: 'clr' (lib.cjs's
    // clearance cells, 8-neighbour), 'fine' (every open fine cell, 8-neighbour, no corner cutting),
    // 'lat' (the growth lattice).
    const dijkstra = (w, mode) => {
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
      const ok = mode === 'clr' ? clr : mode === 'fine' ? open : latOk;
      const edges = mode === 'lat' ? LATU : LAT.slice(0, 8);
      for (const i of seeds(ok)) { dist[i] = 0; push(i, 0); }
      let goal = -1;
      while (hk.length) {
        const [i, d] = pop(); if (d > dist[i]) continue;
        const y = (i / W) | 0, x = i % W;
        if (isLand(x, y)) { goal = i; break; }
        for (const [dx, dy] of edges) {
          const nx = x + dx, ny = y + dy; if (!ok(nx, ny)) continue;
          if (mode === 'lat') { if (!segOk(x, y, nx, ny)) continue; }
          else if (dx && dy && (!ok(x + dx, y) || !ok(x, y + dy))) continue;
          const len = Math.hypot(dx, dy) * fsz;
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
    const straight = Math.hypot(tx - root.x, ty - root.y);
    const ratioOf = (r) => (r.goal >= 0 ? r.cost / straight : Infinity);
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
    const shortLat = dijkstra(() => 1, 'lat'), shortFine = dijkstra(() => 1, 'fine'), shortClr = dijkstra(() => 1, 'clr');
    const cheap = dijkstra(wPrice, 'lat');
    const { east, e42, e84 } = shares(cheap.path);
    const cheapClr = dijkstra(wPrice, 'clr'), shc = shares(cheapClr.path);
    const cheapFine = dijkstra(wPrice, 'fine'), shf = shares(cheapFine.path);
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
    // 3b. THE SEAM SLIT, as a number: the longest run of fine rows down any chunk seam in which some
    // fine cell within 2 of the seam line is open, i.e. a strand could run straight down the seam.
    let seamRun = 0, seamAt = null;
    for (let ci = Math.min(...cis) + 1; ci <= Math.max(...cis); ci++) {
      const sxF = ci * cw * K;
      let run = 0;
      for (let y = 0; y < Hh; y++) {
        let o = false;
        for (let x = sxF - 2; x <= sxF + 1 && !o; x++) if (open(x, y)) o = true;
        if (o) { run++; if (run > seamRun) { seamRun = run; seamAt = { ci, endRow: (y / K) | 0 }; } } else run = 0;
      }
    }
    // 3b'. A FREE-STANDING RIDGE DOWN THE SEAM (M7 verifier round 2): the stitch's first chain was a
    // straight column of stones standing in soil. Per column x, the longest run of fine rows where x is
    // rock and the fine cells 2 cells to BOTH sides are not (a wall at most ~4 cells thick with open
    // ground either side), counting a row where some x within 1 fine cell of the line qualifies.
    // Measured at every seam line and, as the control, at three interior columns per chunk (6, 12 and
    // 18 cells in): `ridgeSeam` should look like `ridgeMid`, i.e. a seam should read like any rock.
    const ridgeAt = (xc) => {
      let best = 0, run = 0;
      for (let y = 0; y < Hh; y++) {
        let q = false;
        for (let x = xc - 1; x <= xc + 1 && !q; x++)
          if (inWin(x, y) && solid[y * W + x] && open(x - 2 * K, y) && open(x + 2 * K, y)) q = true;
        if (q) { run++; if (run > best) best = run; } else run = 0;
      }
      return best;
    };
    const ridgeSeams = [], ridgeMids = [];
    for (let ci = Math.min(...cis); ci <= Math.max(...cis); ci++) {
      if (ci > Math.min(...cis)) ridgeSeams.push(ridgeAt(ci * cw * K));
      for (const off of [6, 12, 18]) ridgeMids.push(ridgeAt((ci * cw + off) * K));
    }
    const pct = (a, q) => { const b = a.slice().sort((x, y) => x - y); return b.length ? b[Math.min(b.length - 1, Math.floor(q * b.length))] : 0; };
    // 3c. SEALED SEAMS, locally: for every seam side the generator walled, can the growth lattice get
    // from beyond the seal (4 cells west of the seam) to beyond it on the other side (4 cells east),
    // staying within 8 columns and 5 rows of the gallery? A leaky seal is a crossing the map claims
    // is closed.
    let sealN = 0, sealLeak = 0; const leaks = [];
    const JO = sub.mineJourney._open || {};
    const carveBoth = (seamC, r) => { const a = JO[seamC / cw - 1], b = JO[seamC / cw]; if (!a || !b) return false;
      const wa = a.length / sub.rows, wb = b.length / sub.rows; return !!(a[r * wa + wa - 1] && b[r * wb]); };
    for (const sd of (sub.mineJourney._sealed || [])) {
      for (const side of ['L', 'R']) {
        if (!sd[side]) continue;
        const seamC = side === 'L' ? sd.ci * cw : (sd.ci + 1) * cw;
        if (seamC <= Math.min(...cis) * cw || seamC >= (Math.max(...cis) + 1) * cw) continue;
        sealN++;
        const sF = seamC * K, xa = sF - 8 * K, xb = sF + 8 * K, ya = Math.max(0, (sd.row - 5) * K), yb = Math.min(Hh - 1, (sd.row + 6) * K - 1);
        const inW = (x, y) => x >= xa && x < xb && y >= ya && y <= yb;
        const seen = new Uint8Array((xb - xa) * (yb - ya + 1)), st = [];
        const idx = (x, y) => (y - ya) * (xb - xa) + (x - xa);
        for (let y = ya; y <= yb; y++) for (let x = xa; x < sF - 4 * K; x++) if (latOk(x, y)) { seen[idx(x, y)] = 1; st.push([x, y]); }
        let crossed = false;
        while (st.length && !crossed) {
          const [x, y] = st.pop();
          if (x >= sF + 4 * K) { crossed = true; break; }
          for (const [dx, dy] of LATU) {
            const nx = x + dx, ny = y + dy;
            if (!inW(nx, ny) || !latOk(nx, ny) || seen[idx(nx, ny)]) continue;
            // Crossing the seam line where BOTH carves are open there is a corridor the carve made (a
            // spur or dead end from each side meeting, or pass e's trunk mouth), not a leak through the
            // seal: not counted — nor within ONE ROW of such a crossing, where the stitch's first piece
            // below a both-open mouth is round and leaves the mouth's own fringe (leg 2 seam 192: the
            // trunk at rows 105-107, the "leak" a hop from row 108 into it). A slit is caught anywhere
            // else.
            const both1 = (fy) => { const rr = (fy / K) | 0; return carveBoth(seamC, rr) || carveBoth(seamC, rr - 1) || carveBoth(seamC, rr + 1); };
            if ((x < sF) !== (nx < sF) && (both1(y) || both1(ny))) continue;
            if (!segOk(x, y, nx, ny)) continue;
            seen[idx(nx, ny)] = 1; st.push([nx, ny]);
          }
        }
        if (crossed) { sealLeak++; if (leaks.length < 6) leaks.push([seamC, sd.row]); }
      }
    }
    // 4. creatures (clouds carry cx/cy in world units, not x/y)
    let shallowestRow = Infinity;
    const rowOf = (y) => Math.floor((y - sub.surfaceY) / cs);
    for (const ci of cis) for (const sp of ((s.mineChunks[ci] && s.mineChunks[ci].spots) || [])) shallowestRow = Math.min(shallowestRow, rowOf(sp.y));
    for (const w of s.nematodes || []) if (isFinite(w.y)) shallowestRow = Math.min(shallowestRow, rowOf(w.y));
    let liveClouds = 0;
    for (const c of s.clouds || []) {
      const cy = isFinite(c.cy) ? c.cy : c.y;
      if (isFinite(cy)) { liveClouds++; shallowestRow = Math.min(shallowestRow, rowOf(cy)); }
    }
    const tapRec = (s.mineChunks[Math.floor(lay.taproot.col / cw)] || {}).taproot || null;
    const out = {
      leg: L.leg, seed: L.seed, homeCol: lay.homeCol, taproot: lay.taproot, tapRec,
      eastM: lay.taproot.col - lay.homeCol, depthM: lay.taproot.row,
      reach: f1.hit, reachLat: fl.hit, reachClr: f2.hit,
      ratio: +ratioOf(shortLat).toFixed(3), ratioFine: +ratioOf(shortFine).toFixed(3), ratioClr: +ratioOf(shortClr).toFixed(3),
      water: +cheap.cost.toFixed(1), east42: east ? +(e42 / east).toFixed(3) : 0, east84: east ? +(e84 / east).toFixed(3) : 0,
      waterFine: +cheapFine.cost.toFixed(1), east42Fine: shf.east ? +(shf.e42 / shf.east).toFixed(3) : 0,
      waterClr: +cheapClr.cost.toFixed(1), east42Clr: shc.east ? +(shc.e42 / shc.east).toFixed(3) : 0,
      shallowMaxCol: Math.floor(fShallow.maxX / K), islandC0: lay.islandC0,
      crustMaxCol: Math.floor(fc.maxX / K), sealN, sealLeak, leaks, lateral, latAt, seamRunRows: +(seamRun / K).toFixed(1), seamAt,
      // in coarse rows: the worst seam, the seams' median, and the interior columns' median and 90th percentile
      ridgeSeam: +(Math.max(0, ...ridgeSeams) / K).toFixed(1), ridgeSeamMed: +(pct(ridgeSeams, 0.5) / K).toFixed(1),
      ridgeMidMed: +(pct(ridgeMids, 0.5) / K).toFixed(1), ridgeMid90: +(pct(ridgeMids, 0.9) / K).toFixed(1), ridgeMidMax: +(Math.max(0, ...ridgeMids) / K).toFixed(1),
      shallowestRow: shallowestRow === Infinity ? 999 : shallowestRow, liveClouds,
      chunks: cis.length, rows: sub.rows,
    };
    // The cheapest route as world points (the follower walks it).
    if (opts && opts.route) out.route = cheap.path.map((i) => [+cxW(i % W).toFixed(1), +cyW((i / W) | 0).toFixed(1)]);
    return out;
  }, opts || {});
}

// THE WHOLE LEG WORLD (M7 verifier round 2): every chunk, not only home to island+1 — a reward
// stranded past the island, or a straight floor channel in chunk 19, is still on the map the player
// can dig into. Generates all chunks, waits for the stamp, and measures on the real fine mask:
//   · rewards — ore seams and water pockets the 4-neighbour flood from the colony's root reaches (a
//     pocket counts if a non-water cell within 2 of it is reached: mine-check's rule);
//   · lateral — the longest straight lateral channel 3 cells tall, over every chunk;
//   · seamSolid / midSolid — mean fine-mask solidity of carve-CLOSED cells within one cell of a chunk
//     seam, and 6+ cells from one (the look: a seam as dense as the ground beside it reads as rock,
//     a denser strip reads as a line — the first stitch measured 0.87 against 0.64).
// Works on the free layout too (no `_open`: the solidity pair is null there).
async function world(page) {
  await page.evaluate(() => {
    const g = window.__game, s = g.state, cs = s.substrate.cellSize, cw = s.config.mine.chunkCols;
    g.mine.ensureChunks(0, (s.substrate.cols - 1) * cs);
  });
  await page.waitForFunction(() => {
    const sub = window.__game.state.substrate;
    return !!sub._fineSolid && (sub._solidFrom | 0) === sub.levelSprites.length && sub._mineDirtyC0 == null;
  }, { timeout: 90000, polling: 200 });
  return page.evaluate(() => {
    const g = window.__game, s = g.state, sub = s.substrate, cs = sub.cellSize, cw = s.config.mine.chunkCols;
    const fsz = sub._fineSize, W = sub._fineCols, Hh = sub._fineRows, solid = sub._fineSolid, K = Math.round(cs / fsz);
    const cis = g.mine.chunks().slice().sort((a, b) => a - b);
    const root = s.active.nodes[0];
    const seen = new Uint8Array(W * Hh);
    const sx = Math.floor(root.x / fsz), sy = Math.max(0, Math.floor((root.y - sub.surfaceY) / fsz));
    const st = [sy * W + sx]; seen[st[0]] = 1;
    while (st.length) {
      const i = st.pop(), y = (i / W) | 0, x = i % W;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= W || ny >= Hh) continue;
        const j = ny * W + nx;
        if (seen[j] || solid[j]) continue;
        seen[j] = 1; st.push(j);
      }
    }
    const cellSeen = (col, row) => { const p = sub.cellCenter(col, row);
      const fx = Math.floor(p.x / fsz), fy = Math.floor((p.y - sub.surfaceY) / fsz);
      return fx >= 0 && fy >= 0 && fx < W && fy < Hh && !!seen[fy * W + fx]; };
    let piles = 0, pilesOk = 0, pockets = 0, pocketsOk = 0; const strandedAt = [];
    for (const pile of (sub.foodPiles || [])) {
      piles++;
      if (pile.cells.some((idx) => cellSeen(idx % sub.cols, (idx / sub.cols) | 0))) pilesOk++;
      else if (strandedAt.length < 8) strandedAt.push(['ore', pile.cells[0] % sub.cols, (pile.cells[0] / sub.cols) | 0]);
    }
    for (const r of (sub.reservoirs || [])) {
      pockets++;
      let near = false;
      for (let row = r.r0 - 2; row <= r.r1 + 2 && !near; row++)
        for (let col = r.c0 - 2; col <= r.c1 + 2 && !near; col++) {
          const c = sub.cellAt(col, row); if (c && !c.water && cellSeen(col, row)) near = true;
        }
      if (near) pocketsOk++; else if (strandedAt.length < 8) strandedAt.push(['pocket', r.c0, r.r0]);
    }
    const oc = (c, r) => r >= 0 && r < sub.rows && !sub.solidAtWorld((c + 0.5) * cs, sub.surfaceY + (r + 0.5) * cs);
    let lateral = 0, latAt = null;
    for (let r = 0; r < sub.rows; r++) {
      let run = 0;
      for (let c = 0; c < sub.cols; c++) {
        if (oc(c, r) && oc(c, r - 1) && oc(c, r + 1)) { run++; if (run > lateral) { lateral = run; latAt = { row: r, endCol: c }; } }
        else run = 0;
      }
    }
    let seamSolid = null, midSolid = null;
    const JO = sub.mineJourney && sub.mineJourney._open;
    if (JO) {
      let a0 = 0, n0 = 0, a1 = 0, n1 = 0;
      for (const ci of cis) {
        const o = JO[ci]; if (!o) continue; const Wc = o.length / sub.rows;
        for (let r = 3; r < sub.rows - 6; r++) for (let k = 0; k < Wc; k++) {
          if (o[r * Wc + k]) continue;
          const c = ci * cw + k, d = Math.min(Math.abs(c + 0.5 - ci * cw), Math.abs(c + 0.5 - (ci + 1) * cw));
          const nearSeam = d < 1 && c > 0 && c < sub.cols - 1, mid = d >= 6;
          if (!nearSeam && !mid) continue;
          let n = 0; for (let y = r * K; y < r * K + K; y++) for (let x = c * K; x < c * K + K; x++) if (solid[y * W + x]) n++;
          if (nearSeam) { a0 += n / (K * K); n0++; } else { a1 += n / (K * K); n1++; }
        }
      }
      seamSolid = +(a0 / n0).toFixed(3); midSolid = +(a1 / n1).toFixed(3);
    }
    return { chunks: cis.length, piles, pilesOk, pockets, pocketsOk, strandedAt, lateral, latAt, seamSolid, midSolid,
             sprites: sub.levelSprites.length };
  });
}

// REAL GROWTH ALONG THE CHEAPEST LATTICE ROUTE (M7 verifier fix): the lattice is a model, so its
// answer is checked by digging it. Threats and trich out, the tank topped up before every dig, the
// node caps lifted — this asks only "can the player's own dig (mine.growFrom) follow this route to the
// taproot?". Returns whether a clean strand landed within landfall range, the digs and refusals it
// took, and the landing strand's ANCESTRY: its east travel and the share of it below 42 m.
async function follow(page, route, opts = {}) {
  return page.evaluate(async ([route, o]) => {
    const g = window.__game, s = g.state, sub = s.substrate, cs = sub.cellSize, net = s.active;
    s.nematodes.length = 0; s.clouds.length = 0;
    for (const c of sub.cells) if (c && c.trich) c.trich = 0;
    s.config.growth.maxNodes = 1e6;
    const lay = g.mine.leg().layout;
    const tx = (lay.taproot.col + 0.5) * cs, ty = sub.surfaceY + (lay.taproot.row + 0.5) * cs;
    const land = (s.config.mine.journey.landfallCells || 1.5) * cs;
    const cum = [0]; for (let i = 1; i < route.length; i++) cum.push(cum[i - 1] + Math.hypot(route[i][0] - route[i - 1][0], route[i][1] - route[i - 1][1]));
    const landed = () => { for (const n of net.nodes) if (!n.infected && Math.hypot(n.x - tx, n.y - ty) <= land) return n; return null; };
    let k = 0, digs = 0, refused = 0, stall = 0, best = 0;
    const maxDigs = o.maxDigs || 400, ahead = o.ahead || 70, near = o.near || 16;
    let hit = landed();
    while (!hit && digs < maxDigs && !s.runOver) {
      // Furthest route point with a clean strand near it.
      for (let j = Math.min(route.length - 1, k + 400); j > k; j--) {
        const [px, py] = route[j];
        let okN = false;
        for (const n of net.nodes) if (!n.infected && Math.abs(n.x - px) < near && Math.abs(n.y - py) < near && Math.hypot(n.x - px, n.y - py) < near) { okN = true; break; }
        if (okN) { k = j; break; }
      }
      if (k > best) { best = k; stall = 0; } else stall++;
      if (stall > 25) break;
      // Aim from the strand nearest route[k] at the route point `ahead` units further on; shorten the
      // look-ahead (and back off the start point) as refusals pile up.
      const a = ahead / (1 + (stall % 4)), back = Math.floor(stall / 4) * 2;
      const ks = Math.max(0, k - back);
      let t = ks; while (t < route.length - 1 && cum[t] - cum[ks] < a) t++;
      let src = null, sd = Infinity;
      for (const n of net.nodes) { if (n.infected) continue; const d = (n.x - route[ks][0]) ** 2 + (n.y - route[ks][1]) ** 2; if (d < sd) { sd = d; src = n; } }
      net.water = 9999;
      const r = g.mine.growFrom(src.x, src.y, route[t][0], route[t][1]);
      digs++;
      if (!r || !r.ok) refused++;
      hit = landed();
    }
    const out = { landed: !!hit, digs, refused, routeFrac: +(best / Math.max(1, route.length - 1)).toFixed(3), nodes: net.nodes.length, over: !!s.runOver };
    if (hit) {
      let east = 0, e42 = 0, maxM = 0, len = 0;
      for (let n = hit; n && n.parentId != null;) {
        const p = net.byId.get(n.parentId); if (!p) break;
        const dx = n.x - p.x; len += Math.hypot(dx, n.y - p.y);
        const m = (n.y - sub.surfaceY) / cs; if (m > maxM) maxM = m;
        if (dx > 0) { east += dx; if (m >= 42) e42 += dx; }
        n = p;
      }
      const root = net.nodes[0];
      out.east42 = east ? +(e42 / east).toFixed(3) : 0; out.maxDepthM = +maxM.toFixed(1);
      out.chainRatio = +(len / Math.hypot(tx - root.x, ty - root.y)).toFixed(3);
    }
    return out;
  }, [route, opts]);
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

module.exports = { measure, world, follow, playLeg, openLeg, PASS, WPASS };

if (require.main === module) (async () => {
  const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
  const legs = arg('--legs', '1,2,3').split(',').map(Number);
  const pick = +arg('--pick', 0), seedArg = +arg('--seed', 0), check = process.argv.includes('--check');
  const doFollow = process.argv.includes('--follow');
  const file = arg('--file', null);     // e.g. a snapshot of index.html under the repo root
  const E = await H.start();
  let bad = 0;
  try {
    for (const leg of legs) {
      let b = await openLeg(E, leg, seedArg || 0, 390, 844, file);
      if (!pick) {
        const m = await measure(b.page, { route: doFollow });
        const route0 = m.route; delete m.route;
        m.world = await world(b.page);
        m.route = route0;
        const ok = PASS(m, leg) && WPASS(m.world);
        if (!ok) bad++;
        const route = m.route; delete m.route;
        console.log(`leg ${leg} seed ${m.seed}: ${ok ? 'PASS' : 'FAIL'} ` + JSON.stringify(m));
        if (doFollow && route && route.length) console.log(`  follow: ` + JSON.stringify(await follow(b.page, route)));
      } else {
        const good = [];
        for (let k = 0; k < pick; k++) {
          const sd = ((leg * 7919 + k * 104729 + 12345) % 2147483000) + 1;
          // A FRESH PAGE EVERY 6 CANDIDATES, and after any failure: one page replaying world after world
          // was killed mid-pick ("Target page ... has been closed") and took the whole pick with it.
          if (k && k % 6 === 0) { await b.ctx.close().catch(() => {}); b = await openLeg(E, leg, 0, 390, 844, file); }
          let m, ok;
          try {
            await playLeg(b.page, leg, sd);
            m = await measure(b.page);
            ok = PASS(m, leg);
            if (ok) { const w = await world(b.page); m.world = w; ok = WPASS(w); }
          } catch (e) {
            console.log(`leg ${leg} cand ${k} seed ${sd}: ERROR ${String(e && e.message || e).slice(0, 120)}`);
            await b.ctx.close().catch(() => {}); b = await openLeg(E, leg, 0, 390, 844, file);
            continue;
          }
          if (ok) good.push(m);
          console.log(`leg ${leg} cand ${k} seed ${sd}: ${ok ? 'PASS' : '    '} reach ${m.reach}/${m.reachLat} ratio ${m.ratio} (fine ${m.ratioFine}) water ${m.water} e42 ${m.east42} e84 ${m.east84} shallow ${m.shallowMaxCol} crust ${m.crustMaxCol} lat ${m.lateral} seam ${m.seamRunRows} leak ${m.sealLeak}/${m.sealN} creat ${m.shallowestRow} tapRep ${m.tapRec && m.tapRec.repairs}${m.world ? ` | world lat ${m.world.lateral} ore ${m.world.pilesOk}/${m.world.piles} pk ${m.world.pocketsOk}/${m.world.pockets} seam ${m.world.seamSolid}/${m.world.midSolid}` : ''}`);
        }
        console.log(`leg ${leg}: ${good.length} of ${pick} candidates pass`);
        // Prefer a ratio near the middle of the band, then (legs 2+) the deepest crossing.
        good.sort((a, b2) => Math.abs(a.ratio - 1.6) - Math.abs(b2.ratio - 1.6));
        // The lattice is an upper bound on what growth passes: DIG the top few, and keep only those
        // real growth can follow to the taproot.
        for (const m of good.slice(0, 5)) {
          try {
            await b.ctx.close().catch(() => {}); b = await openLeg(E, leg, 0, 390, 844, file);
            await playLeg(b.page, leg, m.seed);
            const r = await measure(b.page, { route: true });
            const f = await follow(b.page, r.route);
            console.log('  ', m.seed, 'follow', JSON.stringify(f), JSON.stringify(Object.assign({}, m, { route: undefined })));
          } catch (e) { console.log('  ', m.seed, 'follow ERROR', String(e && e.message || e).slice(0, 120)); }
        }
      }
      if (b.errs.length) console.log('page errors:', b.errs.slice(0, 3));
      await b.ctx.close();
    }
  } finally { await E.close(); }
  process.exit(check && bad ? 1 : 0);
})();
