// Shared harness: static server + mine boot + in-page bot helpers. Read-only against the repo.
const http = require('http'), fs = require('fs'), path = require('path');
const { chromium } = require('playwright');
const ROOT = path.resolve(__dirname, '..', '..');
// Where screenshots and traces go. Outside the repo by default, because a career run writes dozens of PNGs.
const OUT = process.env.BOT_OUT || require('path').join(require('os').tmpdir(), 'mine-bots');
require('fs').mkdirSync(OUT, { recursive: true });
const T = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json', '.png': 'image/png',
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.svg': 'image/svg+xml', '.webp': 'image/webp',
  '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.ogg': 'audio/ogg', '.css': 'text/css' };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function serve() {
  return new Promise((res) => { const s = http.createServer((rq, rs) => {
    let p = decodeURIComponent(rq.url.split('?')[0].split('#')[0]); if (p === '/') p = '/index.html';
    const fp = path.join(ROOT, p);
    if (!fp.startsWith(ROOT) || !fs.existsSync(fp) || fs.statSync(fp).isDirectory()) { rs.writeHead(404); rs.end('nf'); return; }
    rs.writeHead(200, { 'Content-Type': T[path.extname(fp)] || 'application/octet-stream' });
    fs.createReadStream(fp).pipe(rs); }); s.listen(0, () => res(s)); });
}

async function launch() {
  const srv = await serve();
  const base = 'http://localhost:' + srv.address().port;
  const browser = await chromium.launch({ headless: true, executablePath: '/opt/pw-browsers/chromium' });
  return { srv, base, browser, close: async () => { await browser.close(); srv.close(); } };
}

// A fresh context (fresh save) unless `ctx` is passed.
async function bootMine(env, seed, opts = {}) {
  const ctx = opts.ctx || await env.browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = opts.page || await ctx.newPage();
  const errs = [], cons = [];
  if (!opts.page) {
    page.on('pageerror', (e) => errs.push(String(e && e.message)));
    page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') cons.push(m.type() + ': ' + m.text()); });
    await page.addInitScript(() => { window.MYCELIUM_SUPABASE = { url: '', anonKey: '' }; });
  }
  await page.goto(env.base + '/index.html#mine,' + seed, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#loadscreen.ld-ready', { timeout: 60000 }).catch(() => {});
  await page.click('#loadscreen', { timeout: 5000 }).catch(() => {});
  await page.waitForFunction(() => !!(window.__game && window.__game.mine && window.__game.state
    && window.__game.state.substrate && window.__game.state.substrate.mine), { timeout: 60000 });
  await page.waitForFunction(() => !!window.__game.state.substrate._fineSolid, { timeout: 30000 });
  await sleep(1200);
  await injectBot(page);
  return { ctx, page, errs, cons };
}

// In-page bot: BFS over the fine mask from the living colony, target visible rewards, else the deepest
// reachable frontier. Digs with growFrom (the exact call fireAim makes). Returns a step record.
async function injectBot(page) {
  await page.evaluate(() => {
    const W = window;
    W.__qa = W.__qa || {};
    const Q = W.__qa;
    Q.live = () => W.__game.state.active.nodes.filter((n) => !n.infected);
    // Flood the fine mask from every living node. Returns {dist (Int32Array), par, fc, fr, fs, surfaceY}.
    // Clearance: a fine cell is passable only if it and its 4-neighbours are open (a strand needs a
    // gap wider than a hairline; the dodge fan samples every 0.7 fine cell along a 25.5-unit step).
    Q.flood = (maxCells) => {
      const s = W.__game.state, sub = s.substrate;
      const fs = sub._fineSize, fc = sub._fineCols, fr = sub._fineRows, sol = sub._fineSolid;
      const topRow = 1; // y must be > surfaceY + 2
      const floorRow = Math.floor((sub.growFloorY - 2 - sub.surfaceY) / fs);
      const N = fc * fr;
      const dist = new Int32Array(N).fill(-1);
      const par = new Int32Array(N).fill(-1);
      // Only the generated chunks (+ half a chunk): ungenerated ground is bare soil and would flood the world.
      const cis = W.__game.mine.chunks(), cc = s.config.mine.chunkCols;
      const x0 = Math.max(1, (Math.min(...cis) * cc - 12) * 4), x1 = Math.min(fc - 1, ((Math.max(...cis) + 1) * cc + 12) * 4);
      const open = (x, y) => x >= x0 && y >= topRow && x < x1 && y < floorRow && !sol[y * fc + x];
      const pass = (x, y) => open(x, y) && open(x + 1, y) && open(x - 1, y) && open(x, y + 1) && open(x, y - 1);
      const q = new Int32Array(N); let qh = 0, qt = 0;
      for (const n of Q.live()) {
        const x = Math.floor(n.x / fs), y = Math.floor((n.y - sub.surfaceY) / fs);
        if (x < 0 || y < 0 || x >= fc || y >= fr) continue;
        const i = y * fc + x; if (dist[i] >= 0) continue; dist[i] = 0; q[qt++] = i;
      }
      const lim = maxCells || 1500000;
      while (qh < qt && qt < lim) {
        const i = q[qh++], x = i % fc, y = (i / fc) | 0, d = dist[i];
        for (let k = 0; k < 8; k++) {
          const dx = [1, -1, 0, 0, 1, 1, -1, -1][k], dy = [0, 0, 1, -1, 1, -1, 1, -1][k];
          const nx = x + dx, ny = y + dy; if (!pass(nx, ny)) continue;
          if (k >= 4 && (!pass(x + dx, y) || !pass(x, y + dy))) continue;
          const j = ny * fc + nx; if (dist[j] >= 0) continue;
          dist[j] = d + 1; par[j] = i; q[qt++] = j;
        }
      }
      return { dist, par, fc, fr, fs, sy: sub.surfaceY, reached: qt };
    };
    Q.cellOf = (F, x, y) => { const cx = Math.floor(x / F.fs), cy = Math.floor((y - F.sy) / F.fs); return cy * F.fc + cx; };
    Q.xyOf = (F, i) => ({ x: (i % F.fc + 0.5) * F.fs, y: F.sy + (((i / F.fc) | 0) + 0.5) * F.fs });
    // Best reachable fine cell within `r` world units of a point (for a pile/pocket, whose own cells are solid/claimed).
    Q.nearReach = (F, x, y, r) => {
      const cx = Math.floor(x / F.fs), cy = Math.floor((y - F.sy) / F.fs), R = Math.ceil(r / F.fs);
      let best = -1, bd = Infinity;
      for (let dy = -R; dy <= R; dy++) for (let dx = -R; dx <= R; dx++) {
        if (dx * dx + dy * dy > R * R) continue;
        const X = cx + dx, Y = cy + dy; if (X < 0 || Y < 0 || X >= F.fc || Y >= F.fr) continue;
        const i = Y * F.fc + X; const d = F.dist[i]; if (d < 0) continue;
        if (d < bd) { bd = d; best = i; }
      }
      return best < 0 ? null : { i: best, d: bd };
    };
    // Distance (world) from a point to the nearest living node.
    Q.nodeDist = (x, y) => { let b = Infinity; for (const n of Q.live()) { const d = Math.hypot(n.x - x, n.y - y); if (d < b) b = d; } return b; };
    Q.targets = (F, visR) => {
      const s = W.__game.state, sub = s.substrate, out = [];
      const tapped = s._tappedWater || new Set();
      for (const p of (sub.foodPiles || [])) {
        if (p.rewarded) continue;
        let sx = 0, sy = 0, k = 0;
        for (const idx of p.cells) { const c = idx % sub.cols, r = (idx / sub.cols) | 0; sx += (c + 0.5) * sub.cellSize; sy += sub.surfaceY + (r + 0.5) * sub.cellSize; k++; }
        if (!k) continue; const x = sx / k, y = sy / k;
        if (Q.nodeDist(x, y) > visR) continue;
        const nr = Q.nearReach(F, x, y, sub.cellSize * 1.6);
        out.push({ kind: 'ore', mat: p.mineMat || 'phosphorus', x, y, reach: nr, pile: p });
      }
      for (const r of (sub.reservoirs || [])) {
        if (tapped.has(r.id)) continue;
        const x = r.cx, y = r.cy;
        if (Q.nodeDist(x, y) > visR) continue;
        const nr = Q.nearReach(F, x, y, (r.rad || sub.cellSize) + sub.cellSize * 1.2);
        out.push({ kind: 'water', x, y, reach: nr, res: r });
      }
      return out;
    };
    // Walk the BFS parents back from target cell to the colony; return the path (array of cell idx, colony-first).
    Q.pathTo = (F, i) => { const p = []; let c = i; let g = 0; while (c >= 0 && g++ < 200000) { p.push(c); if (F.dist[c] === 0) break; c = F.par[c]; } return p.reverse(); };
    // One dig toward target cell along the BFS path. Picks the living node nearest the path's origin
    // then aims at the path point ~`ahead` world units further along.
    Q.digAlong = (F, ti, ahead) => {
      const path = Q.pathTo(F, ti);
      if (!path.length) return { ok: false, message: 'no path' };
      const o = Q.xyOf(F, path[0]);
      // Find the path point furthest along that is still within 30 units of some node: that is where we are.
      let startK = 0;
      const nodes = Q.live();
      for (let k = 0; k < path.length; k += 2) {
        const p = Q.xyOf(F, path[k]);
        let near = false; for (const n of nodes) { if ((n.x - p.x) ** 2 + (n.y - p.y) ** 2 < 30 * 30) { near = true; break; } }
        if (near) startK = k;
      }
      const sp = Q.xyOf(F, path[startK]);
      let src = null, sd = Infinity;
      for (const n of nodes) { const d = (n.x - sp.x) ** 2 + (n.y - sp.y) ** 2; if (d < sd) { sd = d; src = n; } }
      const steps = Math.max(2, Math.round((ahead || 120) / F.fs));
      const tk = Math.min(path.length - 1, startK + steps);
      const tp = Q.xyOf(F, path[tk]);
      const r = W.__game.mine.growFrom(src.x, src.y, tp.x, tp.y);
      return Object.assign({ src: { x: src.x, y: src.y }, aim: tp, remaining: path.length - 1 - startK }, r);
    };
    Q.snapshot = () => {
      const g = W.__game, s = g.state;
      return { water: s.active ? s.active.water : null, depth: g.mine.depth(), ore: g.mine.ore(), mats: g.mine.mats(),
               over: !!s.runOver, nodes: s.active ? s.active.nodes.length : 0, worms: (s.nematodes || []).length,
               attached: g.mine.attached(), infect: g.mine.infect(), items: g.mine.items(), cost: g.mine.costHere(),
               cheapest: g.mine.cheapest(), drained: g.mine.drained(), cause: s.runResult && s.runResult.cause };
    };
    Q.bad = new Map();   // target key -> digs spent
    Q.pileClaimed = (p) => { const sub = W.__game.state.substrate; return p.cells.some((i) => sub.cells[i] && sub.cells[i].colonized > 0); };
    // One decision + one dig. opts: {visR, useItems, lambda, greedyOre}
    Q.step = (opts) => {
      opts = opts || {};
      const g = W.__game, s = g.state, sub = s.substrate;
      if (s.runOver) return { over: true };
      const out = { acts: [] };
      if (opts.useItems !== false) {
        const it = g.mine.items();
        if (g.mine.attached() >= (opts.flaskAt || 1) && it.excrete > 0) out.acts.push(['excrete', g.mine.useExcrete().message]);
        const inf = g.mine.infect();
        if (inf.on && it.amputate > 0 && inf.left < (opts.cutWhenLeft || 18)) {
          const bad = s.active.nodes.filter((n) => n.infected);
          const R = (s.config.mine.cutRadius || 220);
          let best = null, bn = -1;
          for (const c of bad) { let k = 0; for (const o of bad) if ((o.x - c.x) ** 2 + (o.y - c.y) ** 2 < R * R * 0.8) k++; if (k > bn) { bn = k; best = c; } }
          if (best) out.acts.push(['amputate', g.mine.useAmputate(best.x, best.y).message || 'ok', bn, bad.length]);
        }
      }
      const F = Q.flood();
      const nodes = Q.live(); if (!nodes.length) return Object.assign(out, { stuck: true, why: 'no live nodes' });
      let deep = nodes[0]; for (const n of nodes) if (n.y > deep.y) deep = n;
      const water = s.active.water;
      const tg = Q.targets(F, opts.visR || 650).filter((t) => t.reach && !(t.kind === 'ore' && Q.pileClaimed(t.pile)));
      let best = null, bs = Infinity;
      for (const t of tg) {
        if (opts.maxDepthM != null && (t.y - sub.surfaceY) / 36 > opts.maxDepthM + 3) continue;
        const key = t.kind + ':' + Math.round(t.x) + ',' + Math.round(t.y);
        if ((Q.bad.get(key) || 0) > 7) continue;
        let score = t.reach.d * F.fs;               // path length, world units
        if (t.kind === 'water') score *= water < 24 ? 0.4 : 0.8;
        if (t.kind === 'ore' && t.mat !== 'phosphorus') score *= 0.8;
        if (score < bs) { bs = score; best = Object.assign(t, { key }); }
      }
      // ...but only detour if it is worth it: a target further than `maxDetour` path units is ignored.
      if (best && bs > (opts.maxDetour || 900)) best = null;
      if (best) {
        Q.bad.set(best.key, (Q.bad.get(best.key) || 0) + 1);
        const r = Q.digAlong(F, best.reach.i, opts.ahead || 130);
        return Object.assign(out, { mode: 'target', kind: best.kind, mat: best.mat, pathLen: Math.round(bs), ok: r.ok, msg: r.message });
      }
      // explore: deepest-reaching frontier, penalised by path length
      const lam = opts.lambda == null ? 0.45 : opts.lambda;
      let bi = -1, bsc = -Infinity, frontier = 0;
      const gap = Math.ceil(60 / F.fs);
      for (let i = 0; i < F.dist.length; i++) {
        const d = F.dist[i]; if (d < gap) continue;
        frontier++;
        const y = F.sy + (((i / F.fc) | 0) + 0.5) * F.fs, x = (i % F.fc + 0.5) * F.fs;
        if (opts.maxDepthM != null && (y - F.sy) / 36 > opts.maxDepthM) continue;
        if (!opts.lateral && Math.abs(x - deep.x) > 1400) continue;
        const sc = opts.lateral ? Math.abs(x - s.active.nodes[0].x) - lam * d * F.fs : y - lam * d * F.fs;
        if (sc > bsc) { bsc = sc; bi = i; }
      }
      if (bi < 0) return Object.assign(out, { stuck: true, why: 'boxed: no frontier', frontier });
      const r = Q.digAlong(F, bi, opts.ahead || 130);
      const tp = Q.xyOf(F, bi);
      return Object.assign(out, { mode: 'explore', frontier, goalM: Math.round((tp.y - F.sy) / 36), ok: r.ok, msg: r.message });
    };
    // Is the colony boxed in? No reachable open fine cell further than `gap` world units from every living node.
    Q.boxed = (F, gap) => {
      const s = W.__game.state, sub = s.substrate; let frontier = 0, deepest = -1;
      const nodes = Q.live();
      // coarse grid of node presence to test distance cheaply
      const cs = 36, occ = new Map();
      for (const n of nodes) { const k = Math.floor(n.x / cs) + ',' + Math.floor(n.y / cs); occ.set(k, 1); }
      const G = Math.ceil(gap / cs);
      for (let i = 0; i < F.dist.length; i++) {
        if (F.dist[i] < 0) continue;
        const p = Q.xyOf(F, i);
        const X = Math.floor(p.x / cs), Y = Math.floor(p.y / cs);
        let near = false;
        for (let dy = -G; dy <= G && !near; dy++) for (let dx = -G; dx <= G; dx++) if (occ.has((X + dx) + ',' + (Y + dy))) { near = true; break; }
        if (!near) { frontier++; if (p.y > deepest) deepest = p.y; }
      }
      return { frontier, deepestFrontierM: deepest < 0 ? null : Math.round((deepest - sub.surfaceY) / 36) };
    };
  });
}

module.exports = { ROOT, OUT, sleep, launch, bootMine, injectBot };
