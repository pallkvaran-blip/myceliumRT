/* Frames of the level card — the story line, the campaign counter and the flavour quote — at four
 * viewports, with the pool's LONGEST quote pinned in two of them.
 *
 *   node tests/level-card-shot.cjs        -> tests/.artifacts/level-card-*.png
 *
 * A TOOL, not a check: it prints and never fails, and it is not in the runner. campaign-check
 * asserts the quote's presence, source and styling; this is how you see whether the block READS
 * right, which is the half a headless assertion cannot reach. It also measures overflow, which is
 * the one way the quote can actually break the screen — a long line on a short viewport.
 *
 * Two traps it exists to carry, both of which cost a debug cycle:
 *   - THE LOAD SCREEN MUST BE CLICKED THROUGH or `window.__game` never arrives, and the wait then
 *     reads as "the build does not boot" while boot-check is green.
 *   - SERVE IT THREADED. python's http.server is single-threaded and the asset preload starves it,
 *     which presents the same way — a page that never finishes booting, with no error anywhere.
 */
const http = require('http'), fs = require('fs'), path = require('path');
fs.mkdirSync(path.join(__dirname, '.artifacts'), { recursive: true });
const { chromium } = require('playwright');
const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(__dirname, '.artifacts', 'level-card-');
const T = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.webp': 'image/webp',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg', '.svg': 'image/svg+xml' };
(async () => {
  const srv = await new Promise((res) => { const s = http.createServer((rq, rs) => {
    let p = decodeURIComponent(rq.url.split('?')[0].split('#')[0]); if (p === '/') p = '/index.html';
    const fp = path.join(ROOT, p);
    if (!fp.startsWith(ROOT) || !fs.existsSync(fp) || fs.statSync(fp).isDirectory()) { rs.writeHead(404); rs.end('nf'); return; }
    rs.writeHead(200, { 'Content-Type': T[path.extname(fp)] || 'application/octet-stream' });
    fs.createReadStream(fp).pipe(rs); }); s.listen(0, () => res(s)); });
  const base = 'http://localhost:' + srv.address().port;
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  // 'longest' pins whatever the pool's longest line currently is, rather than an id that goes stale.
  const shots = [['desktop', 1280, 720], ['longest', 1280, 720], ['narrow', 1366, 640], ['longest-phone', 390, 844]];
  for (const [name, w, h] of shots) {
    const p = await b.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 2 });
    p.on('pageerror', (e) => console.log('PAGEERROR', name, String(e)));
    await p.addInitScript(() => { window.MYCELIUM_SUPABASE = { url: '', anonKey: '' }; });
    await p.goto(base + '/index.html#dev,turn', { waitUntil: 'domcontentloaded' });
    await p.waitForSelector('#loadscreen.ld-ready', { timeout: 25000 }).catch(() => {});
    await p.click('#loadscreen', { timeout: 5000 }).catch(() => {});
    await p.waitForFunction(() => !!(window.__game && window.__game.state && window.__game.state.active), { timeout: 30000 });
    await p.evaluate(({ longest }) => {
      const g = window.__game, qs = g.levelQuotes || [];
      const q = longest ? qs.slice().sort((a, b) => b.text.length - a.text.length)[0] : qs[0];
      g.showLevelIntro({ level: 9, of: 10,
        threats: [{ slug: 'trichoderma', label: 'Trichoderma', count: 4 }, { slug: 'nematode', label: 'Nematodes', count: 3 }],
        note: 'The calm before the storm.', storyNote: true, quote: q });
    }, { longest: name.startsWith('longest') });
    await p.waitForSelector('#levelIntro .li-quote', { timeout: 10000 });
    await p.waitForTimeout(1400);
    const m = await p.evaluate(() => {
      const r = document.querySelector('#levelIntro .li-inner').getBoundingClientRect();
      return { overflow: Math.max(0, Math.round(r.bottom - window.innerHeight)) + Math.max(0, Math.round(-r.top)),
               chars: document.querySelector('.li-quote-t').textContent.length,
               qh: Math.round(document.querySelector('.li-quote').getBoundingClientRect().height) };
    });
    console.log(name.padEnd(14), JSON.stringify(m));
    await p.screenshot({ path: OUT + name + '.png', animations: 'disabled', timeout: 15000 }).catch(() => {});
    await p.close();
  }
  await b.close(); srv.close();
})();
