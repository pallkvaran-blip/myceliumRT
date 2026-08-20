/* IS THE HEAT-LINE MARKING ACTUALLY VISIBLE? A measuring tool, not a check — it prints a colour
 * profile down a column across a price line, plus a frame spanning two of them
 * (tests/.artifacts/heat-lines.png), and asserts nothing.
 *
 * It reads BOTH the model colour (`_earthColorAt`) and the DRAWN pixels, because those answer
 * different questions and the second one is where this feature nearly died: the earth is one
 * linear gradient with 24 uniform stops across the visible band, i.e. ~58 world units apart, and
 * the bump's sharp side falls off over 34 — so the marking existed perfectly in the model and the
 * canvas interpolated straight past it on screen. `_drawLive` now inserts explicit stops at each
 * line. If you touch either the bump or that stop list, read the PIXEL profile, not the model one.
 *
 * Shipped profile, model, relative to 220u above the line: a slow warm climb to r+12 ON the line,
 * then a break to r-3 within 30u below it. The asymmetry is the design — symmetric reads as a
 * stripe painted on the wall, where a slow warming that breaks sharply says the ground CHANGED.
 *
 * TWO TRAPS IT CARRIES: the sight-range wash tints everything, so `showSight` goes off first; and
 * the camera CLAMPS to streamed ground, so it has to dig down before it can look at 84 m — a shot
 * taken without digging is a picture of the surface.
 *
 *   NODE_PATH=/opt/node22/lib/node_modules node tests/bump-probe.cjs
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
  await sleep(1400);

  const r = await page.evaluate(async () => {
    const g = window.__game, s = g.state, sub = s.substrate;
    s.config.mine.showSight = false;                       // the wash would colour the reading
    const lines = g.mine.heatLines();
    // Park the camera on the first line so it is mid-frame, and read the MODEL colour down a
    // column — the model rather than pixels, because rock, food and the mottle all land on pixels
    // and this question is about the ramp.
    const ly = sub.surfaceY + lines[0] * sub.cellSize;
    
    const prof = [];
    for (let d = -220; d <= 90; d += 10) {
      const c = g.mine.earthColorAt(ly + d).match(/\d+/g).map(Number);
      prof.push([d, c]);
    }
    // ...and the pixels too, since the gradient's own sampling is the thing most likely to lose it.
    g.camera.y = ly; g.camera.clamp(); g.renderFrame(performance.now());
    const cv = document.getElementById('game'), c2 = cv.getContext('2d');
    const dpr = cv.width / cv.clientWidth;
    const px = [];
    for (let d = -220; d <= 90; d += 10) {
      const sy2 = Math.round(((ly + d - g.camera.y) * g.camera.zoom + g.camera.viewH / 2) * dpr);
      if (sy2 < 0 || sy2 >= cv.height) continue;
      const q = c2.getImageData(Math.round(cv.width * 0.5), sy2, 1, 1).data;
      px.push([d, [q[0], q[1], q[2]]]);
    }
    return { lines, prof, px, zoom: g.camera.zoom };
  });
  console.log('heat lines (m):', r.lines.join(', '), '| zoom', r.zoom.toFixed(2));
  const show = (label, rows) => {
    console.log(label);
    let base = rows[0][1];
    for (const [d, c] of rows) {
      const dr = c[0] - base[0];
      console.log(`  ${String(d).padStart(5)}u  rgb(${c.join(',')})  r${dr >= 0 ? '+' : ''}${dr}`
        + (d === 0 ? '   <- the line' : ''));
    }
  };
  show('model colour (_earthColorAt), relative to 220u above the line:', r.prof);
  show('drawn pixels down the middle of the frame:', r.px);
  // DIG DOWN FIRST, or `camera.clamp()` pulls the view back to the surface: the world is streamed
  // per chunk near the colony, so ground nobody has been to does not exist to look at yet.
  await page.evaluate(async () => {
    const g = window.__game, s = g.state;
    s.active.water = 999999;
    s.nematodes.length = 0; s.clouds.length = 0;
    s.config.nematodes.respawnChance = 0; s.config.trichoderma.respawnChance = 0;
    for (let i = 0; i < 60 && g.mine.depth() < 110; i++) {
      if (!g.mine.grow(0, 1).ok) g.mine.grow(i % 2 ? 0.5 : -0.5, 1);
      await new Promise((r) => setTimeout(r, 90));
    }
    await new Promise((r) => setTimeout(r, 1200));
  });
  // A frame spanning two lines, zoomed out a little so both are in shot.
  await page.evaluate(() => {
    const g = window.__game, sub = g.state.substrate, ls = g.mine.heatLines();
    g.camera.y = sub.surfaceY + ((ls[0] + ls[1]) / 2) * sub.cellSize;
    g.camera.zoom = 0.34; g.camera.clamp();
    g.renderFrame(performance.now());
  });
  await sleep(300);
  const out = path.join(ROOT, 'tests', '.artifacts');
  fs.mkdirSync(out, { recursive: true });
  await page.screenshot({ path: path.join(out, 'heat-lines.png'), timeout: 8000, animations: 'disabled' }).catch(() => {});
  await br.close(); srv.close();
})();
