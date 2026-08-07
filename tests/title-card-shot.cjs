/* Export docs/title-card.html as a flat still. A TOOL, not a check — it writes a file and never
 * asserts. This is what produced docs/title-card-630x500.png (itch's cover size) and its 2x.
 *
 *   node tests/title-card-shot.cjs docs/title-card-630x500.png 1
 *   node tests/title-card-shot.cjs docs/title-card-1260x1000.png 2
 *
 * The viewport is ALWAYS 630x500 and the second argument is the device scale factor, so both files
 * are the same composition at two resolutions. Sizing the viewport up instead would re-run the
 * `clamp()`/`vw` type and the `min(1240px, 94vw)` wordmark box and give a different LAYOUT.
 *
 * It waits for `#lines.in` rather than sleeping a guessed amount: the line fades in on the
 * wordmark's BLOOM (activity falling off a peak), which is about a second before `g.done` and is
 * not a fixed duration. `#hint` is removed before the capture — it is never in a recorded frame.
 */
const http = require('http');
const fs = require('fs');
const { chromium } = require('playwright');

const ROOT = '/home/user/myceliumRT';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const OUT = process.argv[2];
const DSF = +(process.argv[3] || 1);

if (!OUT) { console.error('usage: node tests/title-card-shot.cjs <out.png> [dsf]'); process.exit(2); }

(async () => {
  const srv = await new Promise((r) => {
    const s = http.createServer((rq, rs) => {
      rs.writeHead(200, { 'Content-Type': 'text/html' });
      rs.end(fs.readFileSync(ROOT + '/docs/title-card.html'));
    });
    s.listen(0, () => r(s));
  });
  const browser = await chromium.launch({ headless: true, executablePath: '/opt/pw-browsers/chromium' });
  const page = await (await browser.newContext({
    viewport: { width: 630, height: 500 }, deviceScaleFactor: DSF, reducedMotion: 'no-preference',
  })).newPage();

  await page.goto('http://localhost:' + srv.address().port + '/', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => document.getElementById('lines').classList.contains('in'),
                             { timeout: 30000 });
  await sleep(1600);                              // the line's 900ms fade, plus the growth's tail
  await page.evaluate(() => { document.getElementById('hint').remove(); });
  await sleep(250);
  await page.screenshot({ path: OUT });
  console.log(OUT, '630x500 at dsf ' + DSF);

  await browser.close(); srv.close();
})();
