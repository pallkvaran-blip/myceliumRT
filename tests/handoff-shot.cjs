/* ONE FRAME FROM INSIDE THE HANDOFF, with and without the curtain.
 *
 * Not a check — it prints and writes two PNGs to tests/.artifacts/. `handoff-check.cjs` asserts
 * the model (zero exposed frames); this is the picture, which is what made the bug legible in
 * the first place. Run it whenever the reveal path changes:
 *
 *     node tests/handoff-shot.cjs          # the shipped build
 *     NOFIX=1 node tests/handoff-shot.cjs  # curtain neutralised — the negative control
 *
 * NOFIX serves a patched copy of index.html (raiseHandoff returns immediately) rather than
 * touching the tree, so the two frames come from the same working copy.
 *
 * THE TIMING IS THE FIDDLY PART. Pressing Old grows the button's word first, and only then does
 * `finishFn` start the 560 ms fade — the exposed window measured at frames 121-141 of a ~60 fps
 * capture, so ~2.0-2.35 s after the click. Hence the 2150 ms wait, and hence the `tOp` printed
 * with each frame: a shot at tOp ~0.01 is inside the window, one at tOp `null` missed it (the
 * title element is already removed) and the frame proves nothing.
 *
 * DO NOT try to widen the window by overriding `#titleScreen`'s CSS transition. The removal is a
 * fixed 560 ms `setTimeout` in `consume()`, not a transitionend, so a 4 s transition just means
 * the element is deleted while still nearly opaque — which is how the first attempt at this
 * captured a screen that had already handed over.
 *
 * Expect: NOFIX shows the previous run's resource pills, dev buttons and card-filter strip;
 * the shipped build shows flat black.
 */
const http = require('http'), fs = require('fs'), path = require('path');
const { chromium } = require('playwright');
const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(__dirname, '.artifacts');
const T = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.png': 'image/png',
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.svg': 'image/svg+xml', '.webp': 'image/webp',
  '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.css': 'text/css' };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let HTML = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
if (process.env.NOFIX) {
  const before = HTML;
  HTML = HTML.replace('function raiseHandoff() {\n  try { document.body',
                      'function raiseHandoff() {\n  if (1) return;\n  try { document.body');
  if (HTML === before) { console.error('NOFIX: raiseHandoff no longer matches — update the patch'); process.exit(1); }
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const srv = await new Promise((res) => { const s = http.createServer((rq, rs) => {
    let p = decodeURIComponent(rq.url.split('?')[0].split('#')[0]); if (p === '/') p = '/index.html';
    if (p === '/index.html') { rs.writeHead(200, { 'Content-Type': 'text/html' }); rs.end(HTML); return; }
    const fp = path.join(ROOT, p);
    if (!fp.startsWith(ROOT) || !fs.existsSync(fp) || fs.statSync(fp).isDirectory()) { rs.writeHead(404); rs.end('nf'); return; }
    rs.writeHead(200, { 'Content-Type': T[path.extname(fp)] || 'application/octet-stream' });
    fs.createReadStream(fp).pipe(rs); }); s.listen(0, () => res(s)); });
  const base = 'http://localhost:' + srv.address().port;
  const browser = await chromium.launch({ headless: true, executablePath: '/opt/pw-browsers/chromium' });
  const page = await (await browser.newContext({ viewport: { width: 1280, height: 800 } })).newPage();
  await page.addInitScript(() => { window.MYCELIUM_SUPABASE = { url: '', anonKey: '' }; });
  await page.goto(base + '/index.html#dev,turn', { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#loadscreen.ld-ready', { timeout: 25000 }).catch(() => {});
  await page.click('#loadscreen', { timeout: 5000 }).catch(() => {});
  await page.waitForFunction(() => !!(window.__game && window.__game.campaign), { timeout: 25000 });

  // Be in a run with the carousel open — the thing the fade used to reveal.
  await page.evaluate(async () => {
    document.querySelectorAll('#speciesSelect,#levelIntro,#tutorial').forEach((n) => n.remove());
    window.__game.campaign.play('marasmius', 3);
    await new Promise((r) => setTimeout(r, 1500));
    document.querySelectorAll('#levelIntro,#tutorial').forEach((n) => n.remove());
    try { window.__game.ui.setHandOpen(true); } catch (_) {}
    await new Promise((r) => setTimeout(r, 700));
  });
  await page.evaluate(() => { window.__game.showTitle(); });
  await page.waitForSelector('#tsContCamp', { timeout: 12000 });
  await sleep(1200);

  await page.click('#tsContCamp');
  await sleep(2150);
  const st = await page.evaluate(() => {
    const t = document.getElementById('titleScreen');
    return { tOp: t ? +(+getComputedStyle(t).opacity).toFixed(4) : null,
             curtain: document.body.classList.contains('handoff'),
             cards: document.querySelectorAll('#ui .cardbtn').length };
  });
  const file = path.join(OUT, 'handoff-midfade' + (process.env.NOFIX ? '-NOFIX' : '') + '.png');
  console.log('mid-fade:', JSON.stringify(st));
  if (st.tOp === null) console.log('  (tOp null — the shot landed AFTER the title was removed; it proves nothing)');
  await page.screenshot({ path: file, animations: 'disabled', timeout: 15000 }).catch((e) => console.log('  screenshot:', e.message));
  console.log('  ->', file);
  await browser.close(); srv.close();
})().catch((e) => { console.error('HARNESS ERROR', e); process.exit(1); });
