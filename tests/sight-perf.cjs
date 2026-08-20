/* WHAT THE MINE'S ALWAYS-ON SENSING RINGS COST PER FRAME. A measuring TOOL, not a check: it prints
 * and never fails, and it is not in the runner.
 *
 * It exists because this overlay has now been re-costed three times and every version of it looked
 * cheap in a diff. The rings are the one thing in the mine drawn once PER CREATURE per frame, at a
 * radius wider than a phone viewport, so the cap of 16 worms is a real worst case rather than a
 * hypothetical one — and each rewrite has been settled by this number rather than by argument:
 *
 *   full-disc radial gradient (the campaign's treatment)   +36.6 ms   35.4 / 36.3 / 38.0
 *   clipped double-width rim stroke                        +20.2 ms
 *   2 px boundary line (shipped)                            +7.4 ms   7.5 / 7.7 / 6.9
 *
 * ...against a 26.8 ms frame with them off, at 390x844 dpr 3. Splitting that middle number is what
 * picked the shipped one: with the rim disabled the wash alone was +12.6 and with the wash disabled
 * the rim alone was +18.2, i.e. the band cost more than the wash it decorated. If you change
 * `drawOccludedSight`, re-run this — and take THREE runs, per CLAUDE.md, since a single render
 * delta here is noise.
 *
 * A/B IN ONE PAGE: same map, same camera, same colony, only `showSight` moves. Two boots would be
 * comparing two maps. And `renderFrame` is called directly because headless throttles rAF toward
 * 1-2 Hz — a stopwatch on the real loop measures the throttle.
 *
 * Note the absolute times are a SOFTWARE rasteriser and are not a phone; what transfers is the
 * ratio between the treatments, and that a full-disc fill is destination-pixel work, which is
 * exactly what a mobile GPU is short of.
 *
 *   NODE_PATH=/opt/node22/lib/node_modules node tests/sight-perf.cjs
 */
const http = require('http'), fs = require('fs'), path = require('path');
const { chromium } = require('playwright');
const ROOT = path.resolve(__dirname, '..');
const T = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.png': 'image/png',
  '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.webp': 'image/webp', '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav', '.css': 'text/css' };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const srv = http.createServer((rq, rs) => {
    const u = decodeURIComponent(rq.url.split('?')[0]);
    const f = path.join(ROOT, u === '/' ? 'index.html' : u);
    fs.readFile(f, (e, d) => e ? (rs.writeHead(404), rs.end())
      : (rs.writeHead(200, { 'Content-Type': T[path.extname(f)] || 'application/octet-stream' }), rs.end(d)));
  }).listen(0);
  const port = srv.address().port;
  const br = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const ctx = await br.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3 });
  const page = await ctx.newPage();
  await page.addInitScript(() => { window.MYCELIUM_SUPABASE = { url: '', anonKey: '' }; });
  await page.goto(`http://127.0.0.1:${port}/index.html#mine,4242`);
  await page.waitForSelector('#loadscreen.ld-ready', { timeout: 40000 }).catch(() => {});
  await page.click('#loadscreen', { timeout: 5000 }).catch(() => {});
  await page.waitForFunction(() => !!(window.__game && window.__game.state
    && window.__game.state.substrate && window.__game.state.substrate.mine), { timeout: 40000 });
  await page.waitForFunction(() => !!window.__game.state.substrate._fineSolid, { timeout: 20000 });
  await sleep(1400);

  const r = await page.evaluate(async () => {
    const g = window.__game, s = g.state;
    s.active.water = 99999;
    for (let i = 0; i < 10; i++) { g.mine.grow(0, 1); await new Promise((x) => setTimeout(x, 110)); }
    await new Promise((x) => setTimeout(x, 900));
    s.nematodes.length = 0; s.clouds.length = 0;
    s.config.nematodes.respawnChance = 0; s.config.trichoderma.respawnChance = 0;
    let tip = null;
    for (const n of s.active.nodes) if (!n.infected && (!tip || n.y > tip.y)) tip = n;
    // THE LOAD CASE, not a typical one: the population cap is 16 worms, and the point of the
    // measurement is the worst frame the mine can actually produce.
    for (let i = 0; i < 16; i++) g.mine.spawnWorm(tip.x + ((i % 8) - 4) * 55, tip.y - 40 - (i > 7 ? 60 : 0));
    await new Promise((x) => setTimeout(x, 400));
    // `renderFrame` draws one frame SYNCHRONOUSLY — headless throttles rAF toward 1-2 Hz, so a
    // stopwatch on the real loop measures the throttle instead of the frame.
    const med = (a) => { a = a.slice().sort((x, y) => x - y); return a[a.length >> 1]; };
    const run = (on) => {
      s.config.mine.showSight = on;
      const t = [];
      for (let i = 0; i < 45; i++) { const t0 = performance.now(); g.renderFrame(performance.now()); t.push(performance.now() - t0); }
      return { med: +med(t).toFixed(2), rings: g.mine.countSight() };
    };
    run(true);                                     // warm the caches, discard
    const off = run(false);
    const on = run(true);

    s.config.mine.showSight = true;
    return { off, on, worms: s.nematodes.length };
  });
  console.log(`worms ${r.worms} | rings off: ${r.off.med} ms | rings on: ${r.on.med} ms (${r.on.rings} drawn) | delta ${(r.on.med - r.off.med).toFixed(2)} ms`);
  await br.close(); srv.close();
})();
