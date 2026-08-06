/* Frames of the CAMPAIGN level card — grown wordmark, the rock name, the story line, the quote,
 * "3/10" at the foot and the tiny "click" — plus the survival ladder's card as a control.
 *
 *   node tests/level-card-shot.cjs        -> tests/.artifacts/level-card-*.png
 *
 * A TOOL, not a check: it prints and never fails, and it is not in the runner. campaign-check
 * asserts what is on the card and how it is styled; this is how you see whether the card READS
 * right, which is the half a headless assertion cannot reach. It also measures overflow, which is
 * the one way the content can actually break the screen — a long quote on a short viewport.
 *
 * It captures the card MID-REVEAL as well as settled, because the staged fade is the part most
 * likely to be wrong in a way no assertion notices: a stagger that never starts leaves a card
 * holding nothing but a title, and that looks identical to a card that is still growing.
 *
 * Three traps it exists to carry, each of which cost a debug cycle:
 *   - THE LOAD SCREEN MUST BE CLICKED THROUGH or `window.__game` never arrives, and the wait then
 *     reads as "the build does not boot" while boot-check is green.
 *   - SERVE IT THREADED. python's http.server is single-threaded and the asset preload starves it,
 *     which presents the same way — a page that never finishes booting, with no error anywhere.
 *   - HEADLESS DEFAULTS TO prefers-reduced-motion: reduce, which collapses the staged transitions.
 *     The pages here force 'no-preference' so what is captured is what a player sees.
 */
const http = require('http'), fs = require('fs'), path = require('path');
const { chromium } = require('playwright');
const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(__dirname, '.artifacts', 'level-card-');
fs.mkdirSync(path.join(__dirname, '.artifacts'), { recursive: true });
const T = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.webp': 'image/webp',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg', '.svg': 'image/svg+xml' };

const CARD = {
  level: 7, of: 10, campaign: true, rock: 'Garnet',
  threats: [{ slug: 'trichoderma', label: 'Trichoderma', count: 4 }, { slug: 'nematode', label: 'Nematodes', count: 3 }],
  note: 'Garnet is what they cut steel with. The walls turn you until you are out of corners.',
  storyNote: true,
};

(async () => {
  const srv = await new Promise((res) => { const s = http.createServer((rq, rs) => {
    let p = decodeURIComponent(rq.url.split('?')[0].split('#')[0]); if (p === '/') p = '/index.html';
    const fp = path.join(ROOT, p);
    if (!fp.startsWith(ROOT) || !fs.existsSync(fp) || fs.statSync(fp).isDirectory()) { rs.writeHead(404); rs.end('nf'); return; }
    rs.writeHead(200, { 'Content-Type': T[path.extname(fp)] || 'application/octet-stream' });
    fs.createReadStream(fp).pipe(rs); }); s.listen(0, () => res(s)); });
  const base = 'http://localhost:' + srv.address().port;
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });

  // name, width, height, wait-before-shot (ms), card overrides
  const SHOTS = [
    ['campaign', 1280, 720, 5200, {}],
    ['campaign-mid', 1280, 720, 1500, {}],                     // caught part-way through the reveal
    ['campaign-longest', 1280, 720, 5200, { longest: true }],
    ['campaign-phone', 390, 844, 5200, { longest: true }],
    ['ladder', 1280, 720, 3000, { campaign: false, rock: null, of: 0,
                                  note: "You're doing well. Time to die.", storyNote: false }],
  ];
  for (const [name, w, h, wait, over] of SHOTS) {
    const p = await b.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 2,
                                reducedMotion: 'no-preference' });
    p.on('pageerror', (e) => console.log('PAGEERROR', name, String(e)));
    await p.addInitScript(() => { window.MYCELIUM_SUPABASE = { url: '', anonKey: '' }; });
    await p.goto(base + '/index.html#dev,turn', { waitUntil: 'domcontentloaded' });
    await p.waitForSelector('#loadscreen.ld-ready', { timeout: 25000 }).catch(() => {});
    await p.click('#loadscreen', { timeout: 5000 }).catch(() => {});
    await p.waitForFunction(() => !!(window.__game && window.__game.state && window.__game.state.active), { timeout: 30000 });
    await p.evaluate(({ over, card }) => {
      document.querySelectorAll('#levelIntro').forEach((n) => n.remove());
      const g = window.__game, qs = g.levelQuotes || [];
      const opts = Object.assign({}, card, over);
      if (opts.longest) { opts.quote = qs.slice().sort((a, b) => b.text.length - a.text.length)[0]; delete opts.longest; }
      else if (opts.campaign !== false) opts.quote = qs[0];
      g.showLevelIntro(opts);
    }, { over, card: CARD });
    await p.waitForSelector('#levelIntro', { timeout: 10000 });
    // A TIMELINE, not a frame, is the honest record of the staged reveal: `animations: 'disabled'`
    // on the screenshot finishes every transition instantly, so a "mid-reveal" capture comes back
    // looking exactly like the settled one. Sample the live opacities instead and print the order.
    if (name === 'campaign') {
      const line = await p.evaluate(async () => {
        const SEL = ['.li-rock', '.li-sub', '.li-quote', '.li-of--foot', '.li-hint'];
        const t0 = performance.now(), rows = [];
        for (let i = 0; i < 26; i++) {
          rows.push([Math.round(performance.now() - t0),
                     SEL.map((s) => { const n = document.querySelector(s); return n && +getComputedStyle(n).opacity > 0.5 ? 1 : 0; }).join('')]);
          await new Promise((r) => setTimeout(r, 250));
        }
        // Collapse to the moment each pattern first appears — 26 identical rows say nothing.
        return rows.filter((r, i) => i === 0 || r[1] !== rows[i - 1][1]).map((r) => r[0] + 'ms ' + r[1]).join('  ');
      });
      console.log('  reveal (rock/story/quote/foot/hint):', line);
    }
    await p.waitForTimeout(wait);
    const m = await p.evaluate(() => {
      const r = document.querySelector('#levelIntro .li-inner').getBoundingClientRect();
      const seen = (sel) => { const n = document.querySelector(sel); return !!n && +getComputedStyle(n).opacity > 0.9; };
      return { overflow: Math.max(0, Math.round(r.bottom - window.innerHeight)) + Math.max(0, Math.round(-r.top)),
               rock: (document.querySelector('.li-rock') || {}).textContent || null,
               of: (document.querySelector('.li-of') || {}).textContent || null,
               hint: (document.querySelector('.li-hint') || {}).textContent || null,
               portraits: document.querySelectorAll('.li-threat').length,
               shown: ['.li-rock', '.li-sub', '.li-quote', '.li-of--foot', '.li-hint'].filter(seen).length };
    });
    console.log(name.padEnd(17), JSON.stringify(m));
    await p.screenshot({ path: OUT + name + '.png', animations: 'disabled', timeout: 15000 }).catch(() => {});
    await p.close();
  }
  await b.close(); srv.close();
})();
