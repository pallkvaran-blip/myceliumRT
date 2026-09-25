/* Shared harness for the checks that play the mine: a static server, a fresh-context boot of
 * `#mine,<seed>`, and mine-check's NAVIGATOR (`__navDig` / `__digTo`), copied verbatim from
 * tests/mine-check.cjs so the new checks descend the same way the 190 pinned assertions do.
 * mine-check keeps its own inline copy; do not "unify" them without re-running it.
 */
const http = require('http'), fs = require('fs'), path = require('path');
const { chromium } = require('playwright');
const ROOT = path.resolve(__dirname, '..');
const T = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.png': 'image/png',
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.svg': 'image/svg+xml', '.webp': 'image/webp',
  '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.ogg': 'audio/ogg', '.css': 'text/css' };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function start() {
  const srv = await new Promise((res) => { const s = http.createServer((rq, rs) => {
    let p = decodeURIComponent(rq.url.split('?')[0].split('#')[0]); if (p === '/') p = '/index.html';
    const fp = path.join(ROOT, p);
    if (!fp.startsWith(ROOT) || !fs.existsSync(fp) || fs.statSync(fp).isDirectory()) { rs.writeHead(404); rs.end('nf'); return; }
    rs.writeHead(200, { 'Content-Type': T[path.extname(fp)] || 'application/octet-stream' });
    fs.createReadStream(fp).pipe(rs); }); s.listen(0, () => res(s)); });
  const base = 'http://localhost:' + srv.address().port;
  const browser = await chromium.launch({ headless: true, executablePath: '/opt/pw-browsers/chromium' });
  const boot = async (hash, vw = 390, vh = 844, opts = {}) => {
    const ctx = opts.ctx || await browser.newContext({ viewport: { width: vw, height: vh } });
    const page = await ctx.newPage();
    const errs = []; page.on('pageerror', (e) => errs.push(String(e && e.message)));
    await page.addInitScript(() => { window.MYCELIUM_SUPABASE = { url: '', anonKey: '' }; });
    await page.goto(base + '/index.html' + hash, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('#loadscreen.ld-ready', { timeout: 40000 }).catch(() => {});
    await page.click('#loadscreen', { timeout: 5000 }).catch(() => {});
    return { ctx, page, errs };
  };
  const bootMine = async (seed, vw, vh, opts) => {
    const b = await boot('#mine,' + seed, vw, vh, opts);
    await waitMine(b.page);
    await injectNav(b.page);
    return b;
  };
  return { srv, base, browser, boot, bootMine,
           close: async () => { await browser.close(); srv.close(); } };
}
async function waitMine(page) {
  await page.waitForFunction(() => !!(window.__game && window.__game.mine
    && window.__game.state && window.__game.state.substrate && window.__game.state.substrate.mine
    && !window.__game.state.runOver), { timeout: 40000 });
  await page.waitForFunction(() => !!window.__game.state.substrate._fineSolid, { timeout: 20000 });
  await sleep(1200);
}
async function injectNav(page) {
  await page.evaluate(() => {
      // LOOK BEFORE DIGGING — one dig per step, never a fan of paid attempts. Trying seven angles and
      // keeping whichever gained depth costs SEVEN DIGS a step, which empties the tank probing: the
      // tolerance dive read `26 m on 22 digs` (the whole opening tank for 1.2 m a dig) while the fuel
      // probe managed 45 m on 19. `solidAtWorld` is free, so the aim is chosen against the mask and
      // then paid for once.
      window.__aimDown = () => {
        const g = window.__game, s = g.state, sub = s.substrate;
        let tip = null;
        for (const n of s.active.nodes) if (!n.infected && (!tip || n.y > tip.y)) tip = n;
        if (!tip) return 0;
        const reach = (s.config.growth.segmentLength || 25.5) * 3;
        let best = 0, bestGain = -1;
        for (const dx of [0, 0.35, -0.35, 0.7, -0.7, 1.1, -1.1, 1.6, -1.6]) {
          const nrm = Math.hypot(dx, 1);
          // Walk the ray and score how far down it stays clear — the aim that buys the most depth,
          // not merely one that is legal.
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
      // THE NAVIGATOR — a path through the FINE MASK, followed from whichever strand is nearest the
      // path's frontier. It replaced a greedy dive that only ever dug from the DEEPEST tip, and that
      // one-grow lookahead from one tip walked into dead ends a player routes straight past: it
      // stalled at 28 m and 78 m and made four assertions fail about depth while the game was fine
      // (the "colony boxes itself in" conclusion drawn from it was wrong — see CLAUDE.md). Written by
      // the test-audit agent (tests/bots/navdive.cjs), which reached the floor from the exact states
      // this one stalled in.
      //
      // `plan()` floods from every living strand over `_fineSolid`, with a cost that prefers the middle
      // of a corridor (a cell against a wall is 9x a cell with 3+ cells of clearance), then walks back
      // from the cheapest cell at the target depth, or the deepest reachable one.
      const navPlan = (TARGET) => {
        const g = window.__game, s = g.state, sub = s.substrate;
        const step = sub._fineSize, W = sub._fineCols, H = sub._fineRows;
        const cw = s.config.mine.chunkCols, K = Math.round(sub.cellSize / step);
        const fxOf = (x) => Math.floor(x / step), fyOf = (y) => Math.floor((y - sub.surfaceY) / step);
        const solid = sub._fineSolid;
        const cis = g.mine.chunks();
        const fx0 = cis[0] * cw * K, fx1 = Math.min(W - 1, (cis[cis.length - 1] + 1) * cw * K - 1);
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
        let goal = best;
        { let bd = Infinity; for (let x = fx0; x <= fx1; x++) { const i = targetFy * W + x; if (dist[i] < bd) { bd = dist[i]; goal = i; } } }
        const idx = [];
        for (let i = goal; i !== -1; i = prev[i]) idx.push(i);
        idx.reverse();
        return idx.map((i) => ({ x: ((i % W) + 0.5) * step, y: sub.surfaceY + (((i / W) | 0) + 0.5) * step }));
      };
      // `tank: true` digs until the fuel says stop (a refusal that names water, or the run ending)
      // rather than until a target depth — which is what a fuel-curve or tolerance measurement wants.
      window.__navDig = async ({ targetM = 999, maxIters = 500, tank = false } = {}) => {
        const g = window.__game, s = g.state;
        let P = navPlan(targetM), prog = 0, digs = 0, fails = 0;
        for (let i = 0; i < maxIters && g.mine.depth() < targetM && !s.runOver; i++) {
          if (!P.length) { P = navPlan(targetM); if (!P.length) break; }
          const live = s.active.nodes.filter((n) => !n.infected);
          if (!live.length) break;
          for (let k = P.length - 1; k > prog; k--) {
            const p = P[k];
            if (live.some((n) => (n.x - p.x) ** 2 + (n.y - p.y) ** 2 < 28 * 28)) { prog = k; break; }
          }
          const wp = P[Math.min(P.length - 1, prog + 14)], at = P[prog];
          let src = null, sd = Infinity;
          for (const n of live) { const d = (n.x - at.x) ** 2 + (n.y - at.y) ** 2; if (d < sd) { sd = d; src = n; } }
          const res = g.mine.growFrom(src.x, src.y, wp.x, wp.y);
          if (res.ok) digs++;
          else {
            fails++;
            if (tank && /water/i.test(res.message || '')) break;
          }
          if (fails > 12 || i % 60 === 59) { P = navPlan(targetM); prog = 0; fails = 0; }
          if (i % 3 === 2) await new Promise((r) => setTimeout(r, 60));
        }
        return { depth: g.mine.depth(), digs };
      };
      window.__digTo = async (targetM, iters) => (await window.__navDig({ targetM, maxIters: iters || 500 })).depth;
    });
}
module.exports = { ROOT, sleep, start, waitMine, injectNav };
