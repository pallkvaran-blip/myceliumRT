/* What layout does the game get at a given EMBED size? A tool, not a check — it prints and never
 * asserts.
 *
 *   node tests/embed-probe.cjs 1280x720 960x540 800x450 640x360
 *
 * WHY IT EXISTS. Every store that hosts an HTML5 game asks for embed dimensions, and the number is
 * not cosmetic: AN IFRAME IS ITS OWN VIEWPORT, so `width=device-width` inside the game resolves to
 * the FRAME's width, not the device's. The declared embed size IS the game's layout viewport, and
 * it therefore picks which of the three stylesheets the player gets. Written while answering
 * "what should Embed Width / Height be?" for Newgrounds, after the same question on itch turned out
 * to explain four separate bug reports.
 *
 * THE TRAP THIS IS FOR, and it is not the obvious one. The phone breakpoints are
 * `max-width: 760px` and `(orientation: landscape) and (max-height: 520px)` — the second has NO
 * width term, so a wide-but-short embed (say 800x450) is served the COMPACT PHONE layout on a
 * desktop, with 132px cards, purely because it is under 520 tall. Picking a height above 520 matters
 * as much as picking a width above 760, and only one of those is intuitive.
 *
 * It serves the real game in a real iframe inside a page with the ordinary
 * `width=device-width, initial-scale=1` a store page has, so the reading is what a host actually
 * produces rather than what a resized top-level window produces.
 */
const http = require('http'), fs = require('fs'), path = require('path');
const { chromium } = require('playwright');

const ROOT = path.resolve(__dirname, '..');
const SIZES = (process.argv.slice(2).length ? process.argv.slice(2) : ['1280x720', '960x540', '800x450', '640x360'])
  .map((s) => s.split('x').map(Number));
const T = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.png': 'image/png',
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.svg': 'image/svg+xml', '.webp': 'image/webp',
  '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.css': 'text/css' };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const PARENT = (w, h) => `<!doctype html><html><head>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<style>body{margin:0;background:#222}
.game_frame{width:${w}px;height:${h}px;margin:0 auto}
iframe{width:100%;height:100%;border:0}</style></head>
<body><div class="game_frame"><iframe src="/index.html"></iframe></div></body></html>`;

(async () => {
  let FW = 0, FH = 0;
  const srv = await new Promise((res) => { const s = http.createServer((rq, rs) => {
    let p = decodeURIComponent(rq.url.split('?')[0].split('#')[0]);
    if (p === '/' || p === '/parent.html') { rs.writeHead(200, { 'Content-Type': 'text/html' }); rs.end(PARENT(FW, FH)); return; }
    const fp = path.join(ROOT, p);
    if (!fp.startsWith(ROOT) || !fs.existsSync(fp) || fs.statSync(fp).isDirectory()) { rs.writeHead(404); rs.end('nf'); return; }
    rs.writeHead(200, { 'Content-Type': T[path.extname(fp)] || 'application/octet-stream' });
    fs.createReadStream(fp).pipe(rs); }); s.listen(0, () => res(s)); });
  const base = 'http://localhost:' + srv.address().port;

  console.log('embed size   layout the game gets        card    canvas        notes');
  for (const [w, h] of SIZES) {
    FW = w; FH = h;
    // One browser per case — reusing a context across cases has leaked state into later readings.
    const b = await chromium.launch({ headless: true, executablePath: '/opt/pw-browsers/chromium' });
    // A desktop-sized window, so the only thing under test is the FRAME.
    const page = await b.newPage({ viewport: { width: Math.max(w + 80, 1400), height: Math.max(h + 80, 900) } });
    await page.addInitScript(() => { window.MYCELIUM_SUPABASE = { url: '', anonKey: '' }; });
    await page.goto(base + '/parent.html', { waitUntil: 'domcontentloaded' });

    const f = () => page.frames().find((fr) => /index\.html/.test(fr.url()));
    for (let i = 0; i < 60 && !(f() && await f().evaluate(() => !!document.getElementById('loadscreen')).catch(() => false)); i++) await sleep(1000);
    const fr = f();
    if (!fr) { console.log(`${w}x${h}   no game frame`); await b.close(); continue; }

    await fr.waitForSelector('#loadscreen.ld-ready', { timeout: 120000 }).catch(() => {});
    await fr.click('#loadscreen', { timeout: 8000 }).catch(() => {});
    await fr.waitForSelector('#titleScreen', { timeout: 60000 }).catch(() => {});
    await fr.click('#tsNewCamp', { timeout: 8000 }).catch(() => {});
    await sleep(800);
    const nb = await fr.$('#tsNameInput');
    if (nb) { await nb.fill('P'); await fr.click('#tsNameStart', { timeout: 5000 }).catch(() => {}); }
    for (let i = 0; i < 60; i++) {
      const at = await fr.evaluate(() => { if (document.getElementById('speciesSelect')) return true;
        const st = document.querySelector('.li-story'); if (st) st.click(); return false; }).catch(() => false);
      if (at) break; await sleep(500);
    }
    await fr.evaluate(() => { const x = document.querySelector('#ssAvail .ss-selbtn'); if (x) x.click(); }).catch(() => {});
    for (let i = 0; i < 40; i++) {
      const gone = await fr.evaluate(() => { const n = document.getElementById('levelIntro'); if (!n) return true; n.click(); return false; }).catch(() => true);
      if (gone) break; await sleep(500);
    }
    await sleep(2500);
    await fr.evaluate(() => { const t = document.getElementById('handtoggle'), bar = document.querySelector('.handbar');
      if (bar && !bar.classList.contains('open') && t) t.click(); }).catch(() => {});
    await sleep(1200);

    const r = await fr.evaluate(() => {
      const portrait = matchMedia('(max-width: 760px)').matches;
      const landscape = matchMedia('(orientation: landscape) and (max-height: 520px)').matches;
      const c = document.querySelector('#handlist .cardbtn');
      const cv = document.getElementById('game') || document.querySelector('canvas');
      return { iw: innerWidth, ih: innerHeight, portrait, landscape,
               card: c ? Math.round(c.getBoundingClientRect().width) : null,
               canvas: cv ? cv.style.width + 'x' + cv.style.height : null,
               overflow: document.documentElement.scrollWidth > innerWidth };
    }).catch(() => null);
    await b.close();
    if (!r) { console.log(`${w}x${h}   could not read`); continue; }

    // The LATER rule wins where both match, and the compact landscape one is later in the sheet.
    const layout = r.landscape ? 'compact phone (landscape)'
                 : r.portrait  ? 'phone (portrait)'
                               : 'desktop';
    const notes = [];
    if (r.landscape) notes.push('height <= 520 forces the phone sheet');
    if (r.portrait && !r.landscape) notes.push('width <= 760 forces the phone sheet');
    if (r.overflow) notes.push('OVERFLOWS sideways');
    console.log(`${String(w + 'x' + h).padEnd(12)} ${layout.padEnd(27)} ${String(r.card + 'px').padEnd(7)} ` +
                `${String(r.canvas).padEnd(13)} ${notes.join('; ')}`);
  }
  srv.close();
})();
