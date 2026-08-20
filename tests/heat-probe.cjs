/* THE HEAT STAIRCASE AND THE WHOLE-NUMBER TANK, PRINTED. A measuring tool, not a check — it prints
 * and never fails, and it is not in the runner.
 *
 * Two things it answers that an assertion cannot, both of which cost a round here:
 *
 *   1. WHERE THE LINES ACTUALLY FALL. `mine-check` pins three boundaries by name; this prints the
 *      whole ladder in one column, which is how the `floor`/`ceil` inconsistency was caught — 42 m
 *      stayed at 2 while 84 m had already doubled, uniform at the first line and not at the second.
 *      Reading the table is one glance; asserting your way to it is several.
 *   2. WHETHER THE TANK EVER GOES FRACTIONAL. Sampled while worms drain, because "it was whole at
 *      the start and whole at the end" is not the question — the rule is about every moment in
 *      between, and the drain rate is deliberately a fraction (0.2/worm/s) that accumulates in
 *      `state.mineDrainDebt`.
 *
 * Run it after touching `mineGrowCost`, `CONFIG.mine.heat`, or anything that spends water:
 *
 *   NODE_PATH=/opt/node22/lib/node_modules node tests/heat-probe.cjs
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
  const ctx = await br.newContext({ viewport: { width: 390, height: 844 } });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => console.log('PAGEERROR:', e.message));
  await page.addInitScript(() => { window.MYCELIUM_SUPABASE = { url: '', anonKey: '' }; });
  await page.goto(`http://127.0.0.1:${port}/index.html#mine,4242`);
  await page.waitForSelector('#loadscreen.ld-ready', { timeout: 40000 }).catch(() => {});
  await page.click('#loadscreen', { timeout: 5000 }).catch(() => {});
  await page.waitForFunction(() => !!(window.__game && window.__game.state
    && window.__game.state.substrate && window.__game.state.substrate.mine), { timeout: 40000 });
  await page.waitForFunction(() => !!window.__game.state.substrate._fineSolid, { timeout: 20000 });
  await sleep(1200);

  const r = await page.evaluate(async () => {
    const g = window.__game, s = g.state;
    const ladder = [];
    for (const d of [0, 20, 41, 42, 43, 60, 83, 84, 85, 120, 126, 127, 168, 200, 400]) {
      ladder.push([d, g.mine.cost(d), g.mine.heat(d).nextLine]);
    }
    const h = g.mine.heat(0);
    // The tank must stay whole while worms drain a fraction a tick.
    s.clouds.length = 0; s.config.trichoderma.respawnChance = 0; s.config.nematodes.respawnChance = 0;
    s.active.water = 60;
    let tip = null;
    for (const n of s.active.nodes) if (!n.infected && (!tip || n.y > tip.y)) tip = n;
    s.nematodes.length = 0;
    for (let i = 0; i < 3; i++) g.mine.spawnWorm(tip.x + (i - 1) * 40, tip.y - 20);
    const seen = new Set();
    for (let i = 0; i < 24; i++) { seen.add(s.active.water); await new Promise((x) => setTimeout(x, 250)); }
    const frac = [...seen].filter((w) => w !== Math.floor(w));
    return { ladder, h, zoom: s.config.mine.zoom, camZoom: +g.camera.zoom.toFixed(3),
             waters: [...seen], frac, attached: g.mine.attached(), drained: +(s.mineDrained || 0).toFixed(2) };
  });
  console.log('heat lines: first', r.h.safe, 'every', r.h.every, '| config zoom', r.zoom, '| live camera zoom', r.camZoom);
  console.log('depth -> cost (next line)');
  for (const [d, c, n] of r.ladder) console.log(`  ${String(d).padStart(4)} m -> ${String(c).padStart(3)}  ${n == null ? '(capped)' : '(next at ' + n + ')'}`);
  console.log('tank readings over 6 s with', r.attached, 'attached:', r.waters.join(' '));
  console.log('  fractional readings:', r.frac.length ? r.frac.join(' ') : 'NONE', '| owed so far', r.drained);
  await br.close(); srv.close();
})();
