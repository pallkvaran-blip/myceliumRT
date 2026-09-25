// IS THE 28 m CEILING THE MAP OR THE PROBE? Read-only diagnostic.
//
// Per trial, on a FRESH #mine,<seed> page with threats cleared and the tank bottomless (exactly the
// heat block's setup):
//   1. run mine-check's own `__digTo(70, 700)` (copied verbatim) and record where it stalls;
//   2. from THAT stalled colony, run a path-following navigator: flood the real fine mask from every
//      living strand, take the deepest reachable open cell, reconstruct a wall-clearance-preferring
//      path to it, and dig from the strand nearest the path's frontier toward a waypoint a little
//      further along — i.e. what a player does: press some strand, drag along the corridor.
// If (2) goes on past the stall, the colony was never boxed in and the ceiling is the probe.
const http = require('http'), fs = require('fs'), path = require('path');
const { chromium } = require('playwright');
const ROOT = path.resolve(__dirname, '..', '..');
const SEED = +(process.argv[2] || 4242), TRIALS = +(process.argv[3] || 3), TARGET = +(process.argv[4] || 150);
const T = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.png': 'image/png',
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.svg': 'image/svg+xml', '.webp': 'image/webp',
  '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.css': 'text/css' };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  const srv = await new Promise((res) => { const s = http.createServer((rq, rs) => {
    let p = decodeURIComponent(rq.url.split('?')[0].split('#')[0]); if (p === '/') p = '/index.html';
    const fp = path.join(ROOT, p);
    if (!fp.startsWith(ROOT) || !fs.existsSync(fp) || fs.statSync(fp).isDirectory()) { rs.writeHead(404); rs.end('nf'); return; }
    rs.writeHead(200, { 'Content-Type': T[path.extname(fp)] || 'application/octet-stream' });
    fs.createReadStream(fp).pipe(rs); }); s.listen(0, () => res(s)); });
  const base = 'http://localhost:' + srv.address().port;
  const browser = await chromium.launch({ headless: true, executablePath: '/opt/pw-browsers/chromium' });
  for (let t = 0; t < TRIALS; t++) {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const page = await ctx.newPage();
    const errs = []; page.on('pageerror', (e) => errs.push(String(e && e.message)));
    await page.addInitScript(() => { window.MYCELIUM_SUPABASE = { url: '', anonKey: '' }; });
    await page.goto(base + '/index.html#mine,' + SEED, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('#loadscreen.ld-ready', { timeout: 40000 }).catch(() => {});
    await page.click('#loadscreen', { timeout: 5000 }).catch(() => {});
    await page.waitForFunction(() => !!(window.__game && window.__game.mine && window.__game.state
      && window.__game.state.substrate && window.__game.state.substrate.mine), { timeout: 40000 });
    await page.waitForFunction(() => !!window.__game.state.substrate._fineSolid, { timeout: 20000 });
    await sleep(1200);
    const t0 = Date.now();
    const r = await page.evaluate(async ({ TARGET }) => {
      const g = window.__game, s = g.state, sub = s.substrate;
      // ---- mine-check's helpers, verbatim --------------------------------------------------
      const aimDown = () => {
        let tip = null;
        for (const n of s.active.nodes) if (!n.infected && (!tip || n.y > tip.y)) tip = n;
        if (!tip) return 0;
        const reach = (s.config.growth.segmentLength || 25.5) * 3;
        let best = 0, bestGain = -1;
        for (const dx of [0, 0.35, -0.35, 0.7, -0.7, 1.1, -1.1, 1.6, -1.6]) {
          const nrm = Math.hypot(dx, 1);
          let clear = 0;
          for (let t = 0.25; t <= 1.0001; t += 0.25) {
            const x = tip.x + (dx / nrm) * reach * t, y = tip.y + (1 / nrm) * reach * t;
            if (sub.solidAtWorld(x, y)) break;
            clear = (1 / nrm) * reach * t;
          }
          if (clear > bestGain) { bestGain = clear; best = dx; }
        }
        return bestGain > 0 ? best : null;
      };
      const digTo = async (targetM, iters) => {
        let stuck = 0, i = 0, nulls = 0, refused = 0;
        for (; i < (iters || 140) && g.mine.depth() < targetM && !s.runOver; i++) {
          const d0 = g.mine.depth();
          const dx = aimDown();
          if (dx === null) { nulls++; if (++stuck > 10) break; }
          else if (!g.mine.grow(dx, 1).ok) { refused++; if (++stuck > 10) break; }
          if (g.mine.depth() <= d0) { if (++stuck > 14) break; } else stuck = 0;
          if (i % 4 === 3) await new Promise((r) => setTimeout(r, 60));
        }
        return { depth: g.mine.depth(), iters: i, nulls, refused };
      };
      // ---- the heat block's setup ----------------------------------------------------------
      s.nematodes.length = 0; s.clouds.length = 0;
      s.config.nematodes.respawnChance = 0; s.config.trichoderma.respawnChance = 0;
      s.active.water = 999999;
      const stall = await digTo(70, 700);
      const stallNodes = s.active.nodes.length;
      // ---- the navigator -----------------------------------------------------------------
      const step = sub._fineSize, W = sub._fineCols, H = sub._fineRows;
      const cw = s.config.mine.chunkCols, K = Math.round(sub.cellSize / step);
      const fxOf = (x) => Math.floor(x / step), fyOf = (y) => Math.floor((y - sub.surfaceY) / step);
      const plan = () => {
        const solid = sub._fineSolid;
        const cis = g.mine.chunks();
        const fx0 = cis[0] * cw * K, fx1 = Math.min(W - 1, (cis[cis.length - 1] + 1) * cw * K - 1);
        // clearance: BFS distance (in fine cells) to the nearest solid cell, capped at 4
        const clr = new Uint8Array(W * H).fill(255);
        let q = [];
        for (let y = 0; y < H; y++) for (let x = fx0; x <= fx1; x++) if (solid[y * W + x]) { clr[y * W + x] = 0; q.push(y * W + x); }
        for (let d = 0; d < 4 && q.length; d++) {
          const nq = [];
          for (const i of q) { const y = (i / W) | 0, x = i % W;
            for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const nx = x + dx, ny = y + dy;
              if (nx < fx0 || nx > fx1 || ny < 0 || ny >= H) continue; const j = ny * W + nx;
              if (clr[j] > d + 1) { clr[j] = d + 1; nq.push(j); } } }
          q = nq;
        }
        // Dijkstra-ish with 3 cost buckets: cheap in the middle of a corridor, dear against a wall.
        const cost = (j) => (clr[j] >= 3 ? 1 : clr[j] === 2 ? 3 : 9);
        const dist = new Float32Array(W * H).fill(Infinity), prev = new Int32Array(W * H).fill(-1);
        const buckets = [[]];
        for (const n of s.active.nodes) { if (n.infected) continue;
          const x = fxOf(n.x), y = fyOf(n.y); if (x < fx0 || x > fx1 || y < 0 || y >= H) continue;
          const i = y * W + x; if (solid[i] || dist[i] === 0) continue; dist[i] = 0; buckets[0].push(i); }
        let best = -1, bestY = -1;
        for (let d = 0; d < buckets.length; d++) {
          const b = buckets[d]; if (!b) continue;
          for (const i of b) {
            if (dist[i] !== d) continue;
            const y = (i / W) | 0, x = i % W;
            if (y > bestY) { bestY = y; best = i; }
            for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const nx = x + dx, ny = y + dy;
              if (nx < fx0 || nx > fx1 || ny < 0 || ny >= H) continue; const j = ny * W + nx;
              if (solid[j]) continue; const nd = d + cost(j);
              if (nd < dist[j]) { dist[j] = nd; prev[j] = i; (buckets[nd] = buckets[nd] || []).push(j); } }
          }
          buckets[d] = null;
        }
        const targetFy = Math.min(H - 1, Math.floor(TARGET * sub.cellSize / step));
        // prefer the cheapest cell AT the target depth; else the deepest reachable
        let goal = best;
        { let bd = Infinity; for (let x = fx0; x <= fx1; x++) { const i = targetFy * W + x; if (dist[i] < bd) { bd = dist[i]; goal = i; } } }
        const pathIdx = [];
        for (let i = goal; i !== -1; i = prev[i]) pathIdx.push(i);
        pathIdx.reverse();
        return { pts: pathIdx.map((i) => ({ x: ((i % W) + 0.5) * step, y: sub.surfaceY + (((i / W) | 0) + 0.5) * step })),
                 deepestReachM: Math.floor(bestY * step / sub.cellSize) };
      };
      let P = plan();
      const planned = { pathLen: P.pts.length, deepestReachM: P.deepestReachM };
      let prog = 0, digs = 0, fails = 0, replans = 0;
      for (let i = 0; i < 500 && g.mine.depth() < TARGET && !s.runOver; i++) {
        // progress = furthest path point with a living strand within 28 units
        const live = s.active.nodes.filter((n) => !n.infected);
        for (let k = P.pts.length - 1; k > prog; k--) {
          const p = P.pts[k];
          if (live.some((n) => (n.x - p.x) ** 2 + (n.y - p.y) ** 2 < 28 * 28)) { prog = k; break; }
        }
        const wp = P.pts[Math.min(P.pts.length - 1, prog + 14)];
        const at = P.pts[prog];
        let src = null, sd = Infinity;
        for (const n of live) { const d = (n.x - at.x) ** 2 + (n.y - at.y) ** 2; if (d < sd) { sd = d; src = n; } }
        const res = g.mine.growFrom(src.x, src.y, wp.x, wp.y);
        if (res.ok) digs++; else fails++;
        if (fails > 12 || (i % 60 === 59)) { P = plan(); prog = 0; fails = 0; replans++; }
        if (i % 3 === 2) await new Promise((r) => setTimeout(r, 70));
      }
      return { stall, stallNodes, planned, nav: { depth: g.mine.depth(), digs, replans, nodes: s.active.nodes.length },
               over: !!s.runOver };
    }, { TARGET });
    console.log(JSON.stringify({ seed: SEED, trial: t + 1, secs: Math.round((Date.now() - t0) / 1000), ...r, errs: errs.slice(0, 2) }));
    await ctx.close();
  }
  await browser.close(); srv.close();
})().catch((e) => { console.error('HARNESS ERROR', e); process.exit(2); });
