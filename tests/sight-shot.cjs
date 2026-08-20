/* LOOK AT THE MINE'S ALWAYS-ON SENSING RINGS IN A RENDERED FRAME. A tool, not a check — it writes
 * tests/.artifacts/sight-rings.png (ambient) and sight-tapped.png (one worm tapped, for the
 * comparison the owner is making) and asserts nothing.
 *
 * Whether an overlay reads is not a thing a diff or an assertion can answer, and this one is an
 * owner ask about how it LOOKS: fainter than the campaign's, red rather than green, and with the
 * boundary legible. `mine-check` can pin the colour as a pixel difference and the count as a draw
 * tally; only a frame says whether the edge is findable.
 *
 * THREE WORMS SPREAD ~210 UNITS APART on purpose. Overlapping rings are the case the wash has to
 * survive — a single ring looks fine under any treatment, and it was twenty of them composing into
 * a veil that got the previous version rewritten.
 *
 *   NODE_PATH=/opt/node22/lib/node_modules node tests/sight-shot.cjs
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
  const ctx = await br.newContext({ viewport: { width: 900, height: 620 }, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  await page.addInitScript(() => { window.MYCELIUM_SUPABASE = { url: '', anonKey: '' }; });
  page.on('pageerror', (e) => console.log('PAGEERROR:', e.message));
  page.on('console', (m) => { if (m.type() === 'error') console.log('CONSOLE:', m.text()); });
  await page.goto(`http://127.0.0.1:${port}/index.html#mine,4242`);
  await page.waitForSelector('#loadscreen.ld-ready', { timeout: 40000 }).catch(() => {});
  await page.click('#loadscreen', { timeout: 5000 }).catch(() => {});
  await page.waitForFunction(() => !!(window.__game && window.__game.state
    && window.__game.state.substrate && window.__game.state.substrate.mine), { timeout: 40000 });
  await page.waitForFunction(() => !!window.__game.state.substrate._fineSolid, { timeout: 20000 });
  await sleep(1400);

  const info = await page.evaluate(async () => {
    const g = window.__game, s = g.state;
    s.active.water = 99999;
    for (let i = 0; i < 10; i++) { g.mine.grow(0, 1); await new Promise((r) => setTimeout(r, 120)); }
    await new Promise((r) => setTimeout(r, 900));
    s.nematodes.length = 0; s.clouds.length = 0;
    s.config.nematodes.respawnChance = 0; s.config.trichoderma.respawnChance = 0;
    let tip = null;
    for (const n of s.active.nodes) if (!n.infected && (!tip || n.y > tip.y)) tip = n;
    // Three worms spread out, so overlapping rings are visible — that is the case the wash has to
    // survive, and the one an earlier version was rebuilt for.
    for (let i = 0; i < 3; i++) g.mine.spawnWorm(tip.x + (i - 1) * 210, tip.y - 30);
    await new Promise((r) => setTimeout(r, 500));
    return { worms: s.nematodes.length, drawn: g.mine.countSight() };
  });
  console.log('worms', info.worms, 'rings drawn', info.drawn);

  const out = path.join(ROOT, 'tests', '.artifacts');
  fs.mkdirSync(out, { recursive: true });
  await page.screenshot({ path: path.join(out, 'sight-rings.png'), timeout: 8000, animations: 'disabled' })
    .catch((e) => console.log('shot failed', e.message));

  // A tapped ring, for the comparison the owner is making: it should be the same shape, brighter.
  await page.evaluate(() => { window.__game.state.nematodes[0].showSight = true; });
  await sleep(400);
  await page.screenshot({ path: path.join(out, 'sight-tapped.png'), timeout: 8000, animations: 'disabled' })
    .catch((e) => console.log('shot failed', e.message));

  await br.close(); srv.close();
})();
