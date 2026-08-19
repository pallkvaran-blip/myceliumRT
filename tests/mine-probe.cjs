// MEASURING TOOL for THE DEEP MINE's streamed world. Prints numbers, never fails, NOT in the runner
// — `mine-check` is the gate. This is for the questions that decide tuning rather than pass/fail:
//
//   · how OPEN is a chunk, how much of it the rock loop bbox-covered, and how solid the drawn mask
//     came out — the three numbers that turned out to be the whole density story;
//   · whether the streamed world stays CONNECTED once a run has crossed several seams, and whether
//     every ore seam and water pocket is still reachable;
//   · what a straight dive costs, and whether the colony can dig on from its deepest tip at all;
//   · renderFrame on the wide world.
//
// WHY IT EXISTS. Three findings came out of it that no assertion would have surfaced, because each
// looked fine from the outside:
//
//   1. THE CARVE IS THE DENSITY CEILING. A boulder's alpha fills ~35% of its bounding box, so at 53%
//      open the most solid ground a chunk can show is ~16% — and the shaft measured 12% with the
//      rock loop already covering 72% of everything left. Two rounds went on better PLACEMENT before
//      that was measured rather than estimated. If the mine ever reads too open again, print these
//      three numbers before touching the placement.
//   2. NO REWARDS WERE BEING PLACED AT ALL. "Open, and off the route" is the empty set — every carve
//      is route-marked with a wider brush — so the first chunked generator placed 0 ore seams and 0
//      water pockets on every chunk of every seed. Invisible: a shaft with no reward in it looks
//      exactly like a shaft.
//   3. A COLONY THAT LOOKS STUCK USUALLY ISN'T. `mine-check`'s camera probe read `44 -> 44 m` over 60
//      digs and the suspicion was a sealed pocket; this tool measured **0 refusals of 40** and 126 m
//      on a fresh page. The run on the shared page had simply ENDED (out of fuel), and a dead run
//      refuses every dig with the camera working perfectly.
//
// Usage:
//   node tests/mine-probe.cjs                 # seed 4242, phone viewport
//   node tests/mine-probe.cjs 909             # another seed
//   node tests/mine-probe.cjs 4242 1280 720   # desktop viewport
//
// The seed pins the shaft — `mineChunkRng(seed, ci)` is deterministic and order-independent, so the
// same seed gives the same chunks whether they were generated first or fifth.

const { chromium } = require('playwright');
const path = require('path'), fs = require('fs'), http = require('http');

const ROOT = path.resolve(__dirname, '..');
const SEED = parseInt(process.argv[2] || '4242', 10) || 4242;
const VW = parseInt(process.argv[3] || '390', 10) || 390;
const VH = parseInt(process.argv[4] || '844', 10) || 844;
const T = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript',
  '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp',
  '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.ogg': 'audio/ogg', '.svg': 'image/svg+xml', '.css': 'text/css' };
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
  const ctx = await browser.newContext({ viewport: { width: VW, height: VH } });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => console.log('PAGE ERROR:', e.message));
  await page.addInitScript(() => { window.MYCELIUM_SUPABASE = { url: '', anonKey: '' }; });
  await page.goto(base + '/index.html#mine,' + SEED, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#loadscreen.ld-ready', { timeout: 40000 }).catch(() => {});
  await page.click('#loadscreen', { timeout: 5000 }).catch(() => {});
  // The FINE MASK is stamped during RENDER, so nothing that reads collision is answerable until a
  // frame has run — and the incremental stamp for a streamed chunk lands a frame after that.
  await page.waitForFunction(() => !!(window.__game && window.__game.mine && window.__game.state
    && window.__game.state.substrate && window.__game.state.substrate._fineSolid), { timeout: 40000 });
  await sleep(1500);

  console.log(`\n=== THE DEEP MINE, seed ${SEED}, ${VW}x${VH} ===`);

  const shape = await page.evaluate(() => {
    const g = window.__game, s = g.state, sub = s.substrate, M = s.config.mine;
    return { cols: sub.cols, rows: sub.rows, width: Math.round(sub.worldWidth),
             chunkCols: M.chunkCols, chunks: g.mine.chunkCount(), home: g.mine.homeChunk(),
             at: g.mine.chunks(), bands: M.bands.map((b) => b.theme).join(' / ') };
  });
  console.log(`world      ${shape.cols}x${shape.rows} cells, ${shape.width} units wide`);
  console.log(`chunks     ${shape.chunks} of ${shape.chunkCols} cols, home ${shape.home}; generated at boot: [${shape.at}]`);
  console.log(`bands      ${shape.bands}`);

  // ---- 1. can it dig at all, from its own deepest tip? ---------------------------------------
  // The cheapest sanity check there is, and the one that stops a dead run being read as a sealed
  // map: 40 digs straight down from the deepest tip, counting refusals.
  const dive = await page.evaluate(async () => {
    const g = window.__game, s = g.state;
    let refused = 0;
    const d0 = g.mine.depth();
    for (let i = 0; i < 40; i++) {
      s.active.water = 9999;
      if (!g.mine.grow(0, 1).ok) refused++;
      await new Promise((r) => setTimeout(r, 90));
    }
    return { d0, d1: g.mine.depth(), refused, over: !!s.runOver, alive: !!(s.active && s.active.alive) };
  });
  console.log(`\ndig down   ${dive.d0} -> ${dive.d1} m over 40 digs, ${dive.refused} refused` +
              `  (run ${dive.over ? 'OVER' : 'live'}, colony ${dive.alive ? 'alive' : 'DEAD'})`);
  if (dive.refused > 30) console.log('  !! nearly every dig refused — check `runOver` BEFORE suspecting the map');

  // ---- 2. stream sideways, both ways ---------------------------------------------------------
  const digSide = async (dir, n) => {
    for (let i = 0; i < n; i++) {
      const ok = await page.evaluate((d) => {
        const g = window.__game, s = g.state;
        s.active.water = 9999;
        let best = null;
        for (const nd of s.active.nodes) {
          if (nd.infected) continue;
          const sc = nd.x * d;
          if (!best || sc > best.sc) best = { n: nd, sc };
        }
        if (!best) return false;
        const t = best.n, R = 200;
        return g.mine.growFrom(t.x, t.y, t.x + d * R, t.y + 0.2 * R).ok;
      }, dir);
      if (!ok) break;
      await sleep(300);
    }
  };
  await digSide(1, 22);
  await digSide(-1, 34);

  const st = await page.evaluate(() => {
    const g = window.__game, s = g.state, sub = s.substrate;
    const xs = s.active.nodes.map((n) => n.x);
    return { stats: g.mine.stats(), chunks: g.mine.chunks(),
             cols: [sub.colAtX(Math.min(...xs)), sub.colAtX(Math.max(...xs))],
             sprites: sub.levelSprites.length, solidFrom: sub._solidFrom,
             worms: s.nematodes.length, clouds: s.clouds.length, ore: s.mineOre | 0 };
  });
  console.log(`\nstreamed   [${st.chunks}] — colony spans cols ${st.cols[0]}..${st.cols[1]}`);
  console.log(`content    ${st.stats.rocks} rocks, ${st.stats.piles} ore seams, ${st.stats.pockets} pockets, ` +
              `${st.worms} worms, ${st.clouds} clouds`);
  console.log(`collision  ${st.solidFrom} of ${st.sprites} sprites stamped` +
              (st.solidFrom === st.sprites ? '' : '   !! a sprite is uncollided — a wall you can grow through'));

  // ---- 3. THE DENSITY, the three numbers that matter ----------------------------------------
  console.log(`\nopen       ${(st.stats.openFrac * 100).toFixed(1)}%  (the CEILING on solid ground is about (1-open) x 0.35)`);
  console.log(`bbox       ${st.stats.cover.map((c) => (c * 100).toFixed(0) + '%').join(' / ')} of each band's CLOSED ground` +
              `   [targets hit: ${st.stats.hit.map((h) => h.toFixed(2)).join(' / ')}]`);

  const solid = await page.evaluate(() => {
    const g = window.__game, s = g.state, sub = s.substrate, cs = sub.cellSize, M = s.config.mine;
    const out = [];
    for (const ci of g.mine.chunks()) {
      const c0 = ci * M.chunkCols, c1 = c0 + M.chunkCols - 1;
      const per = [];
      for (let b = 0; b < M.bands.length; b++) {
        let sol = 0, n = 0;
        for (let r = b * M.bandRows; r < (b + 1) * M.bandRows; r++)
          for (let c = c0; c <= c1; c++) {
            if (!sub.cellAt(c, r)) continue; n++;
            if (sub.solidAtWorld((c + 0.5) * cs, sub.surfaceY + (r + 0.5) * cs)) sol++;
          }
        per.push(n ? sol / n : 0);
      }
      out.push({ ci, per, all: per.reduce((a, v) => a + v, 0) / per.length });
    }
    return out;
  });
  const meanAll = solid.reduce((a, c) => a + c.all, 0) / Math.max(1, solid.length);
  console.log(`solid      ${(meanAll * 100).toFixed(1)}% mean over ${solid.length} chunks ` +
              `(the traced campaign maps run 23-53%)`);
  for (const c of solid)
    console.log(`  chunk ${String(c.ci).padStart(2)}  ${c.per.map((v) => (v * 100).toFixed(0).padStart(3) + '%').join(' ')}` +
                `   all ${(c.all * 100).toFixed(1)}%`);

  // ---- 4. REACHABILITY over the real fine mask ----------------------------------------------
  // Scoped to the chunks that EXIST: ungenerated ground is bare soil, so a flood over the whole
  // 504-column grid walks into it and reports ~90% of the mask reachable for the wrong reason.
  const reach = await page.evaluate(() => {
    const g = window.__game, s = g.state, sub = s.substrate, cs = sub.cellSize;
    const step = sub._fineSize, W = sub._fineCols, H = sub._fineRows, solid = sub._fineSolid;
    const cw = s.config.mine.chunkCols, K = Math.round(cs / step);
    const cis = g.mine.chunks();
    const fx0 = cis[0] * cw * K, fx1 = Math.min(W - 1, (cis[cis.length - 1] + 1) * cw * K - 1);
    const seen = new Uint8Array(W * H), q = [];
    const push = (x, y) => { if (x < fx0 || x > fx1 || y < 0 || y >= H) return;
      const i = y * W + x; if (seen[i] || solid[i]) return; seen[i] = 1; q.push(i); };
    const root = s.active.nodes[0];
    push(Math.floor(root.x / step), Math.max(0, Math.floor((root.y - sub.surfaceY) / step)));
    let reached = 0, deepest = 0;
    while (q.length) { const i = q.pop(); reached++;
      const y = (i / W) | 0, x = i % W; if (y > deepest) deepest = y;
      push(x + 1, y); push(x - 1, y); push(x, y + 1); push(x, y - 1); }
    let openF = 0;
    for (let y = 0; y < H; y++) for (let x = fx0; x <= fx1; x++) if (!solid[y * W + x]) openF++;
    const cellSeen = (col, row) => {
      for (let a = 0; a < K; a++) for (let b = 0; b < K; b++)
        if (seen[(row * K + a) * W + (col * K + b)]) return true;
      return false;
    };
    let piles = 0, pilesOk = 0;
    for (const p of (sub.foodPiles || [])) { piles++;
      if (p.cells.some((idx) => cellSeen(idx % sub.cols, (idx / sub.cols) | 0))) pilesOk++; }
    let pockets = 0, pocketsOk = 0;
    for (const rv of (sub.reservoirs || [])) { pockets++;
      let near = false;
      for (let row = rv.r0 - 2; row <= rv.r1 + 2 && !near; row++)
        for (let col = rv.c0 - 2; col <= rv.c1 + 2 && !near; col++) {
          const c = sub.cellAt(col, row);
          if (c && !c.water && cellSeen(col, row)) near = true;
        }
      if (near) pocketsOk++; }
    return { connected: reached / Math.max(1, openF), deepestM: Math.floor(deepest * step / cs),
             rows: sub.rows, piles, pilesOk, pockets, pocketsOk };
  });
  console.log(`\nconnected  ${(reach.connected * 100).toFixed(1)}% of the open ground, from the colony's own root`);
  console.log(`deepest    ${reach.deepestM} m of ${reach.rows} reachable`);
  console.log(`rewards    ${reach.pilesOk}/${reach.piles} ore seams and ${reach.pocketsOk}/${reach.pockets} water pockets reachable` +
              (reach.pilesOk === reach.piles && reach.pocketsOk === reach.pockets ? '' : '   !! something is walled in'));

  // ---- 5. renderFrame on the wide world -----------------------------------------------------
  // `__game.renderFrame` draws one frame SYNCHRONOUSLY, which is the only way to time a render
  // here: headless throttles rAF toward 1-2 Hz, so a stopwatch on the real loop measures the
  // throttle. Headless is also a SOFTWARE rasteriser, so these are not phone numbers — they are
  // useful as a before/after on the same harness and nothing else.
  const perf = await page.evaluate(() => {
    const g = window.__game, t = [];
    for (let i = 0; i < 30; i++) { const a = performance.now(); g.renderFrame(); t.push(performance.now() - a); }
    t.sort((a, b) => a - b);
    return { median: t[15], p90: t[27] };
  });
  console.log(`\nrenderFrame ${perf.median.toFixed(1)} ms median, ${perf.p90.toFixed(1)} p90 ` +
              `(software raster — a before/after number, not a phone one)`);

  const shot = path.join(ROOT, 'tests', '.artifacts', `mine-${SEED}.png`);
  fs.mkdirSync(path.dirname(shot), { recursive: true });
  await page.screenshot({ path: shot, timeout: 8000, animations: 'disabled' })
    .then(() => console.log(`\nframe      ${path.relative(ROOT, shot)}`))
    .catch((e) => console.log('\nframe      not captured:', e.message));

  await ctx.close(); await browser.close(); srv.close();
})().catch((e) => { console.error('PROBE ERROR', e); process.exit(2); });
