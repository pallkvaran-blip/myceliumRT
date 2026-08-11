/* Title screen: the nearest strands creep toward the pointer, slowly. */
const http = require('http'); const fs = require('fs'); const path = require('path');
const { chromium } = require('playwright');
const ROOT = path.resolve(__dirname, '..');   // the repo root — served as-is
const TYPES = { '.html':'text/html','.js':'text/javascript','.json':'application/json','.png':'image/png',
  '.jpg':'image/jpeg','.jpeg':'image/jpeg','.svg':'image/svg+xml','.webp':'image/webp','.mp3':'audio/mpeg','.wav':'audio/wav','.css':'text/css' };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let pass = 0, fail = 0;
const ok = (n, c, x) => { c ? (pass++, console.log('  PASS  ' + n + (x ? '  — ' + x : ''))) : (fail++, console.log('  FAIL  ' + n + (x ? '  — ' + x : ''))); };

(async () => {
  const srv = await new Promise((res) => { const s = http.createServer((rq, rs) => {
    let p = decodeURIComponent(rq.url.split('?')[0].split('#')[0]); if (p === '/') p = '/index.html';
    const fp = path.join(ROOT, p);
    if (!fp.startsWith(ROOT) || !fs.existsSync(fp) || fs.statSync(fp).isDirectory()) { rs.writeHead(404); rs.end('nf'); return; }
    rs.writeHead(200, { 'Content-Type': TYPES[path.extname(fp)] || 'application/octet-stream' });
    fs.createReadStream(fp).pipe(rs); }); s.listen(0, () => res(s)); });
  const base = 'http://localhost:' + srv.address().port;
  // The container has no Playwright-downloaded browser; every other check names the path and
  // this one did not, so it was one env-var away from failing for a second, unrelated reason.
  const browser = await chromium.launch({ headless: true, executablePath: '/opt/pw-browsers/chromium' });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errs = []; page.on('pageerror', (e) => errs.push(String(e && e.message)));
  page.on('console', (m) => { if (m.type() === 'error') errs.push('console:' + m.text()); });
  await page.goto(base + '/index.html', { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#loadscreen.ld-ready', { timeout: 20000 }).catch(() => {});
  await page.click('#loadscreen', { timeout: 5000 }).catch(() => {});
  // `.ts-split` ONLY EXISTS WHEN `OFFER_REALTIME` IS ON, and real time was taken off the title
  // screen — so this waited for a layout that no longer ships and the whole check died on the
  // wait, reporting nothing. `--fast` skips `lure`, which is why it sat broken unnoticed.
  // `.ts-btn` IS THE CLASS EVERY LAYOUT'S New/Old CARRY, whichever games the build offers — the
  // id moved once already when survival was withdrawn (`#tsNew` stopped existing), and this wait
  // is only asking whether the title screen is up at all. A title screen with no button is a
  // failure worth hanging on.
  await page.waitForSelector('#titleScreen .ts-btn', { timeout: 20000 });
  await sleep(6000);   // let the title finish blooming

  // Ink coverage inside a probe box, as a proxy for "strands are here".
  const inkNear = (x, y, r) => page.evaluate(([px, py, pr]) => {
    const c = document.getElementById('tsCanvas');
    const d = c.getContext('2d').getImageData(
      Math.round((px - pr) * (c.width / c.clientWidth)), Math.round((py - pr) * (c.height / c.clientHeight)),
      Math.round(2 * pr * (c.width / c.clientWidth)), Math.round(2 * pr * (c.height / c.clientHeight))).data;
    let lit = 0;
    for (let i = 0; i < d.length; i += 4) if (d[i] > 24) lit++;
    return lit;
  }, [x, y, r]);

  // A spot in clear space a little below the title's ink, straight down from its centre.
  const spot = await page.evaluate(() => ({ x: Math.round(innerWidth * 0.5), y: Math.round(innerHeight * 0.47 + 200) }));
  const before = await inkNear(spot.x, spot.y, 34);
  ok('the probe spot starts empty', before === 0, `${before} lit px at (${spot.x},${spot.y})`);

  // Park the pointer there and watch the strands creep in — poll so the test measures HOW
  // LONG it took rather than betting on one fixed wait.
  await page.mouse.move(spot.x, spot.y);
  const t0 = Date.now();
  let early = null, arrivedMs = null, lit = 0;
  for (let i = 0; i < 40; i++) {
    await sleep(400);
    lit = await inkNear(spot.x, spot.y, 34);
    if (early === null && Date.now() - t0 >= 400) early = lit;
    if (lit > 0) { arrivedMs = Date.now() - t0; break; }
  }
  ok('strands reach the pointer', arrivedMs !== null, arrivedMs === null ? 'never arrived in 16s' : `${lit} lit px after ${(arrivedMs / 1000).toFixed(1)}s`);
  ok('...and CREEP rather than snap out', arrivedMs === null || arrivedMs > 3000,
     `took ${arrivedMs === null ? '∞' : (arrivedMs / 1000).toFixed(1) + 's'}; ${early} lit px at 0.4s`);

  // Several strands, not one line — and they SIDE-BRANCH as they go.
  let peak = { tips: 0, mains: 0, branches: 0, nodes: 0 };
  for (let i = 0; i < 20; i++) {
    const t = await page.evaluate(() => (window.__tsLure ? window.__tsLure() : null));
    if (t && t.branches > peak.branches) peak = t;
    else if (t && t.nodes > peak.nodes) peak.nodes = t.nodes;
    await sleep(400);
  }
  ok('more than one strand reaches', peak.mains > 1, `${peak.mains} reaching tip(s)`);
  ok('the strands side-branch', peak.branches > 0, `${peak.branches} live branch(es) at peak, ${peak.nodes} lure nodes`);

  // Those branches trail OFF — the live count comes back down instead of doubling forever.
  const later = await page.evaluate(() => (window.__tsLure ? window.__tsLure() : null));
  ok('branches trail off rather than multiplying', later && later.tips <= 28,
     `${later ? later.tips : '?'} live tip(s) (cap 28), ${later ? later.branches : '?'} branch(es)`);

  // Leaving the screen stops it.
  const atLeave = await inkNear(spot.x, spot.y, 40);
  await page.mouse.move(spot.x, -20);           // out of the window
  await page.evaluate(() => document.getElementById('titleScreen')
    .dispatchEvent(new PointerEvent('pointerleave', { bubbles: false })));
  await sleep(2500);
  const afterLeave = await inkNear(spot.x, spot.y, 40);
  ok('growth stops when the pointer leaves', afterLeave === atLeave, `${atLeave} → ${afterLeave} lit px`);

  ok('no page errors', errs.length === 0, errs.slice(0, 3).join(' | '));
  await page.mouse.move(spot.x, spot.y); await sleep(4000);
  await page.screenshot({ path: path.join(__dirname, '.artifacts', 'lure.png') });
  console.log(`\n==== ${pass} passed, ${fail} failed ====`);
  await browser.close(); srv.close();
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('HARNESS ERROR', e); process.exit(2); });
