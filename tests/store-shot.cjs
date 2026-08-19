/* The UPGRADE SHELF, in both games → tests/.artifacts/store-shelf-{campaign,survival}.png
 *
 *     node tests/store-shot.cjs
 *
 * Not a check — it asserts nothing and the runner does not call it. It exists because the shelf
 * is now the one screen whose CONTENT differs between the two games, and that difference is a
 * count of tiles: the campaign shows seven, survival six, because "Starting level" is
 * `campaignOnly` (owner: "survival mode should not have the starting level option at all").
 * `store-check` asserts the count; this is how you see that six tiles still LAY OUT as two rows
 * of three rather than leaving a hole where the seventh was.
 *
 * It also dresses the save so the SELL button is in frame. That button only exists on a
 * `sellable` track with something bought, so a shelf photographed at zero cannot show it — and
 * this screen has form for silent CSS collisions that a diff cannot catch (`.ss-hint` and
 * `.li-count` were both found by looking at a frame, not by reading code).
 *
 * Traps, all of them already paid for elsewhere in tests/:
 *   • `#dev` IS SURVIVAL. A dev boot never calls setGame, so CONFIG.game sits at its default —
 *     which is why each pass sets `__cfg.game` explicitly rather than inheriting the boot's.
 *   • `S.clearLevel` is needed before Starting level does anything: the track is held down by
 *     what has been CLEARED, so buying it on a fresh save moves the tile's number not at all.
 *   • Every screenshot is timed out and `.catch()`ed. Playwright's default waits for animations
 *     to settle, and against a live rAF loop that wait has no end (CLAUDE.md).
 */
const http = require('http'); const fs = require('fs'); const path = require('path');
const { chromium } = require('playwright');
const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(__dirname, '.artifacts');
const TYPES = { '.html':'text/html','.js':'text/javascript','.json':'application/json','.png':'image/png',
  '.jpg':'image/jpeg','.jpeg':'image/jpeg','.svg':'image/svg+xml','.webp':'image/webp','.mp3':'audio/mpeg','.wav':'audio/wav','.css':'text/css' };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const srv = await new Promise((res) => { const s = http.createServer((rq, rs) => {
    let p = decodeURIComponent(rq.url.split('?')[0].split('#')[0]); if (p === '/') p = '/index.html';
    const fp = path.join(ROOT, p);
    if (!fp.startsWith(ROOT) || !fs.existsSync(fp) || fs.statSync(fp).isDirectory()) { rs.writeHead(404); rs.end('nf'); return; }
    rs.writeHead(200, { 'Content-Type': TYPES[path.extname(fp)] || 'application/octet-stream' });
    fs.createReadStream(fp).pipe(rs); }); s.listen(0, () => res(s)); });
  const base = 'http://localhost:' + srv.address().port;
  // deviceScaleFactor 2 for a readable frame; NEVER 4 — it OOMs (CLAUDE.md).
  const browser = await chromium.launch({ headless: true, executablePath: '/opt/pw-browsers/chromium' });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 2 });
  await page.addInitScript(() => { window.MYCELIUM_SUPABASE = { url: '', anonKey: '' }; });
  await page.goto(base + '/index.html#dev', { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#loadscreen.ld-ready', { timeout: 30000 }).catch(() => {});
  await page.click('#loadscreen', { timeout: 5000 }).catch(() => {});
  await page.waitForFunction(() => window.__game && window.__game.store, null, { timeout: 30000 });
  for (let i = 0; i < 4 && await page.$('#levelIntro'); i++) { await page.mouse.click(720, 450); await sleep(900); }

  for (const [game, tag] of [['campaign', 'campaign'], ['survival', 'survival']]) {
    await page.evaluate((g) => {
      const S = window.__game.store;
      S.reset(); S.credit(9000);
      // Clears first: Starting level is capped by the highest level cleared, so without this the
      // three purchases below buy a number the tile will not show.
      S.clearLevel(9);
      S.buy('energy'); S.buy('water'); S.buy('lives');
      for (let i = 0; i < 3; i++) S.buy('startLevel');   // ...so Sell has something to sell
      window.__cfg.game = g;                             // `#dev` is survival; say which shop this is
      document.querySelectorAll('#speciesSelect, #loadoutSelect').forEach((n) => n.remove());
      window.__game.showPicker();
    }, game);
    await page.waitForSelector('#ssUpg .ss-upg', { timeout: 15000 });
    await sleep(1200);
    await page.evaluate(() => document.querySelector('#ssUpg').scrollIntoView({ block: 'center' }));
    await sleep(500);
    // Clipped to the shelf itself — the tiles are the subject, and a full-page frame buries them
    // under the colony rows.
    const clip = await page.evaluate(() => {
      const r = document.querySelector('#ssUpg').getBoundingClientRect();
      return { x: Math.max(0, r.x - 16), y: Math.max(0, r.y - 40),
               width: Math.min(innerWidth, r.width + 32), height: Math.min(innerHeight, r.height + 56) };
    });
    await page.screenshot({ path: path.join(OUT, 'store-shelf-' + tag + '.png'), clip,
      animations: 'disabled', timeout: 15000 })
      .then(() => console.log('  → tests/.artifacts/store-shelf-' + tag + '.png'))
      .catch((e) => console.log('  ×  ' + tag + ': ' + e.message));
  }

  await browser.close(); srv.close();
})();
