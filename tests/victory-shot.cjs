/* Frames of the VICTORY screen, for looking at. A tool, not a check — it writes files and never
 * asserts. `victory-check` owns the behaviour; this is how you judge whether the ending READS
 * right, which no assertion can tell you.
 *
 *   node tests/victory-shot.cjs        -> tests/.artifacts/victory-{mid,settled}.png
 *
 * TWO TRAPS, both of which cost real time on this screen:
 *
 *   - `page.screenshot({animations:'disabled'})` JUMPS every transition to its end state AND fires
 *     `transitionend`. So it cannot capture a fade — and on this screen the capture itself opened
 *     the card early, which then read as the fade being instant. The mid-fade frame here is taken
 *     WITHOUT that option and with a short timeout, because against a live rAF loop the default
 *     screenshot wait has no end.
 *   - The wordmark is grown mycelium and takes a beat. Poll for its canvas rather than sleeping;
 *     `openCard` is armed off a plain timer with a hard ceiling so it always arrives, but "always"
 *     on a busy page can be several seconds.
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(__dirname, '.artifacts');
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.svg': 'image/svg+xml',
  '.webp': 'image/webp', '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.css': 'text/css' };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const srv = await new Promise((res) => {
    const s = http.createServer((rq, rs) => {
      let p = decodeURIComponent(rq.url.split('?')[0].split('#')[0]);
      if (p === '/') p = '/index.html';
      const fp = path.join(ROOT, p);
      if (!fp.startsWith(ROOT) || !fs.existsSync(fp) || fs.statSync(fp).isDirectory()) {
        rs.writeHead(404); rs.end('nf'); return;
      }
      rs.writeHead(200, { 'Content-Type': TYPES[path.extname(fp)] || 'application/octet-stream' });
      fs.createReadStream(fp).pipe(rs);
    });
    s.listen(0, () => res(s));
  });
  const browser = await chromium.launch({ headless: true, executablePath: '/opt/pw-browsers/chromium' });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await page.addInitScript(() => { window.MYCELIUM_SUPABASE = { url: '', anonKey: '' }; });

  await page.goto('http://localhost:' + srv.address().port + '/index.html#dev', { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#loadscreen.ld-ready', { timeout: 30000 }).catch(() => {});
  await page.click('#loadscreen', { timeout: 8000 }).catch(() => {});
  await page.waitForFunction(() => !!(window.__game && window.__game.victory), null, { timeout: 40000 });
  for (let i = 0; i < 4 && await page.$('#levelIntro'); i++) { await page.mouse.click(720, 450); await sleep(800); }
  await page.evaluate(() => {
    document.querySelectorAll('#speciesSelect, #tutorial, #levelIntro').forEach((n) => n.remove());
  });

  await page.evaluate(() => window.__game.victory());
  // Mid-fade: the map still showing through. No `animations:'disabled'` — see the header.
  await sleep(900);
  await page.screenshot({ path: path.join(OUT, 'victory-mid.png'), timeout: 6000 }).catch(() => {});

  // Settled: poll for the wordmark's canvas, then let the staged reveal finish.
  for (let i = 0; i < 100 && !(await page.$('#levelIntro.li-vict .li-level canvas')); i++) await sleep(200);
  await sleep(3200);
  await page.screenshot({ path: path.join(OUT, 'victory-settled.png'), timeout: 6000 }).catch(() => {});

  console.log(JSON.stringify(await page.evaluate(() => ({
    red: (document.querySelector('.li-vict-line') || {}).textContent,
    say: (document.querySelector('.li-vict-say .li-story-p') || {}).textContent,
    by: (document.querySelector('.li-vict-quote .li-quote-by') || {}).textContent,
    lines: ((document.querySelector('.li-vict-quote .li-quote-t') || {}).textContent || '').split('\n').length,
  })), null, 1));
  console.log('  shots -> tests/.artifacts/victory-mid.png, victory-settled.png');
  await browser.close(); srv.close();
})();
