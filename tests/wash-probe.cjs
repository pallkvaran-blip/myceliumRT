/* WHAT THE SENSING-RANGE WASH ACTUALLY DOES TO THE SOIL, swept over candidate colour+alpha pairs.
 * A measuring tool, not a check — it prints and never fails, and it is not in the runner.
 *
 * It exists because "darken the red a bit" is not a change you can make by eye in a diff, and the
 * first attempt at it was wrong in a way a screenshot only half-showed: the wash is drawn at about
 * `sightAlpha * 0.55` over soil that is ITSELF dark and red-biased, so darkening the colour costs
 * CONTRAST as well as brightness. Measured on one ring over bare soil:
 *
 *   rgb(208,66,52) @0.13   soil 60,44,26 -> 70,45,28   delta r+10   luminance +3     (the old look)
 *   rgb(165,44,36) @0.13   soil 60,44,26 -> 67,43,27   delta r+7    luminance +0.8   (half-deleted)
 *   rgb(165,44,36) @0.20   soil 60,44,26 -> 71,44,27   delta r+11   luminance +2.4   (shipped)
 *   rgb(165,44,36) @0.26   soil 60,44,26 -> 74,43,27   delta r+14   luminance +2.3
 *   rgb(150,38,30) @0.32   soil 60,44,26 -> 75,43,26   delta r+15   luminance +2.5
 *
 * So the shipped pair keeps the red delta where the bright version had it — as findable as before —
 * while dropping the luminance lift, which is the part that reads as "darker". Darkening alone at a
 * fixed alpha is what makes the range vanish; the two knobs have to move together.
 *
 * ONE WORM, deliberately: the rings COMPOSE, and three overlapping put the effective alpha near
 * double. Sampling an overlap measures the swarm rather than the setting.
 *
 *   NODE_PATH=/opt/node22/lib/node_modules node tests/wash-probe.cjs
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
    for (let i = 0; i < 8; i++) { g.mine.grow(0, 1); await new Promise((x) => setTimeout(x, 120)); }
    await new Promise((x) => setTimeout(x, 900));
    s.nematodes.length = 0; s.clouds.length = 0;
    s.config.nematodes.respawnChance = 0; s.config.trichoderma.respawnChance = 0;
    let tip = null;
    for (const n of s.active.nodes) if (!n.infected && (!tip || n.y > tip.y)) tip = n;
    g.mine.spawnWorm(tip.x, tip.y - 30);                 // ONE worm, so no rings compose
    await new Promise((x) => setTimeout(x, 400));
    const cv = document.getElementById('game'), c2 = cv.getContext('2d');
    const dpr = cv.width / cv.clientWidth;
    const w = s.nematodes[0];
    const p = g.camera.worldToScreen(w.x, w.y);
    const px = Math.round(p.x * dpr), py = Math.round((p.y + s.config.nematodes.sightRadius * g.camera.zoom * 0.33) * dpr);
    const read = (on) => { s.config.mine.showSight = on; g.renderFrame(performance.now());
                           const d = c2.getImageData(px, py, 1, 1).data; return [d[0], d[1], d[2]]; };
    const lum = (c) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
    const out = [];
    for (const [rgbv, a] of [['208,66,52', 0.13], ['165,44,36', 0.13], ['165,44,36', 0.20],
                             ['165,44,36', 0.26], ['150,38,30', 0.26], ['150,38,30', 0.32]]) {
      s.config.mine.sightRgb = rgbv; s.config.mine.sightAlpha = a;
      const off = read(false), on = read(true);
      out.push({ rgbv, a, off, on, d: [on[0] - off[0], on[1] - off[1], on[2] - off[2]],
                 dl: +(lum(on) - lum(off)).toFixed(1) });
    }
    return out;
  });
  for (const o of r) {
    console.log(`rgb(${o.rgbv}) @${o.a}  soil ${o.off.join(',')} -> ${o.on.join(',')}  `
      + `delta r${o.d[0]} g${o.d[1]} b${o.d[2]}  luminance ${o.dl > 0 ? '+' : ''}${o.dl}`);
  }
  await br.close(); srv.close();
})();
