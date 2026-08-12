/* SURFACE DECOR in the rock editor — mountains, cities and props.
 *
 *   node tests/surface-edit-check.cjs
 *
 * These three are the odd ones out among placed objects, and the editor treated them as if they
 * were not. Everything else the editor places is a POINT: a pile, a worm, a cloud all carry an
 * x and a y and are drawn where those say. Surface decor carries no `y` at all — buildLevel turns
 * a mountain or a city into a COLUMN SPAN (spanCols, from the object's own width) and a prop into
 * a single column, and the renderers anchor all three to the soil line. So:
 *
 *   • its handle belonged ON that line, not at the shared y-less fallback of surfaceY + 40, which
 *     buried it under ground while the art it stands for was drawn in the sky above;
 *   • its WIDTH is the thing being authored — for a mountain and a city the width IS the span, so
 *     a level cannot say "this range covers nine columns" without resizing one — and editScale
 *     only ever walked `levelSprites`, so no placed object of any kind could be resized;
 *   • rotation is meaningless on a horizon, so that control was dead weight on the one type with
 *     a real choice left to make: WHICH peak, WHICH skyline (five and six of them, and the
 *     palette can only place one of each).
 *
 * Asserted through the real toolbar buttons rather than by calling the handlers, because the
 * buttons are what the owner presses and the wiring between them is exactly what broke.
 */
const http = require('http'), fs = require('fs'), path = require('path');
const { chromium } = require('playwright');
const ROOT = path.resolve(__dirname, '..');
const ART = path.join(__dirname, '.artifacts');
const T = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.webp': 'image/webp', '.mp3': 'audio/mpeg', '.wav': 'audio/wav' };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let pass = 0, fail = 0;
const ok = (n, c, x) => { c ? (pass++, console.log('  PASS  ' + n + (x ? '  — ' + x : ''))) : (fail++, console.log('  FAIL  ' + n + (x ? '  — ' + x : ''))); };

// A campaign map: its overground is generated, so it always has mountains and cities to grab.
const LEVEL = 'campaign-01-magnetite-c40';

(async () => {
  fs.mkdirSync(ART, { recursive: true });
  const srv = await new Promise((res) => { const s = http.createServer((rq, rs) => { let p = decodeURIComponent(rq.url.split('?')[0].split('#')[0]); if (p === '/') p = '/index.html'; const fp = path.join(ROOT, p); if (!fp.startsWith(ROOT) || !fs.existsSync(fp) || fs.statSync(fp).isDirectory()) { rs.writeHead(404); rs.end('nf'); return; } rs.writeHead(200, { 'Content-Type': T[path.extname(fp)] || 'application/octet-stream' }); fs.createReadStream(fp).pipe(rs); }); s.listen(0, () => res(s)); });
  const base = 'http://localhost:' + srv.address().port;
  const browser = await chromium.launch({ headless: true });
  const p = await browser.newPage({ viewport: { width: 1700, height: 1050 } });
  // setPointerCapture is filtered: the selection test SYNTHESISES a pointerdown, and the browser
  // rightly refuses to capture a pointer id that never existed. It is noise from the probe, not
  // from the editor — a real press carries a real pointer.
  const errs = [];
  p.on('pageerror', (e) => { const m = String(e && e.message); if (!/setPointerCapture/.test(m)) errs.push(m); });
  // Clicks "Dev: edit rocks", which is off by default now — see CONFIG.dev.inGameButtons.
  await p.addInitScript(() => { window.MYCELIUM_SUPABASE = { url: '', anonKey: '' }; window.MYCELIUM_DEV_BUTTONS = true; });
  await p.goto(base + '/index.html#level,' + LEVEL + ',turn', { waitUntil: 'domcontentloaded' });
  await p.waitForSelector('#loadscreen.ld-ready', { timeout: 60000 }).catch(() => {});
  await p.click('#loadscreen', { timeout: 5000 }).catch(() => {});
  await p.waitForFunction(() => window.__game && window.__game.state && window.__game.state.active, null, { timeout: 30000 });
  await p.waitForFunction(() => window.__game.state.substrate._rockSolidified === true, null, { timeout: 60000 }).catch(() => {});
  await p.click('#devEditBtn'); await sleep(400);
  ok('the rock editor opens', await p.evaluate(() => document.getElementById('devEditPanel').classList.contains('open')));

  // ---- the surface objects are there to be edited at all ------------------
  const seen = await p.evaluate(() => {
    const a = window.__game.rockEdit.added;
    const by = {};
    for (const o of a) by[o.t] = (by[o.t] || 0) + 1;
    return { by, total: a.length };
  });
  ok('the level\'s surface decor is seeded as editable markers',
     (seen.by.mountain || 0) > 0 && (seen.by.city || 0) > 0,
     `${seen.by.mountain || 0} mountain(s), ${seen.by.city || 0} city/ies of ${seen.total} objects`);

  // ---- the handle sits ON the soil line, where the art is ------------------
  // The y-less fallback used to be surfaceY + 40 for everything, which put a mountain's grab
  // point underground beneath a peak drawn in the sky. Asserted by CLICKING the point the
  // handle should now be at: if the hit test and the drawing disagree, nothing selects.
  const picked = await p.evaluate(async () => {
    const g = window.__game, sub = g.state.substrate;
    const i = g.rockEdit.added.findIndex((o) => o.t === 'mountain');
    const o = g.rockEdit.added[i];
    const c = g.camera.worldToScreen(+o.x, sub.surfaceY);       // ON the line
    const cv = document.querySelector('canvas');
    const r = cv.getBoundingClientRect();
    const ev = (t) => cv.dispatchEvent(new MouseEvent(t, { clientX: r.left + c.x, clientY: r.top + c.y, bubbles: true, button: 0 }));
    ev('pointerdown'); ev('mousedown'); ev('mouseup'); ev('pointerup'); ev('click');
    return { i, sel: [...g.rockEdit.selAdded], onLine: Math.abs(c.y - g.camera.worldToScreen(+o.x, sub.surfaceY).y) < 1 };
  });
  ok('clicking a mountain on the soil line selects it', picked.sel.includes(picked.i),
     `clicked the handle for added[${picked.i}], selected [${picked.sel.join(',')}]`);

  // ---- resize: the width IS the span --------------------------------------
  const sel = await p.evaluate((i) => { const g = window.__game; g.rockEdit.selAdded = new Set([i]); g.rockEdit.sel.clear(); return i; }, picked.i);
  const before = await p.evaluate((i) => ({ w: window.__game.rockEdit.added[i].w, key: window.__game.rockEdit.added[i].key }), sel);
  await p.evaluate(() => { for (let k = 0; k < 5; k++) document.querySelector('#eeBig').click(); }); await sleep(150);
  const bigger = await p.evaluate((i) => window.__game.rockEdit.added[i].w, sel);
  ok('Bigger widens a mountain (its width is the column span)', bigger > before.w,
     `${Math.round(before.w)} -> ${Math.round(bigger)} world units (${(before.w / 36).toFixed(1)}c -> ${(bigger / 36).toFixed(1)}c)`);
  await p.evaluate(() => { for (let k = 0; k < 5; k++) document.querySelector('#eeSml').click(); }); await sleep(150);
  const back = await p.evaluate((i) => window.__game.rockEdit.added[i].w, sel);
  ok('Smaller narrows it again', back < bigger, `${Math.round(bigger)} -> ${Math.round(back)}`);

  // ---- rotate picks the ART, which is the only choice left on a horizon ----
  await p.evaluate(() => document.querySelector('#eeRotR').click()); await sleep(120);
  const rotated = await p.evaluate((i) => window.__game.rockEdit.added[i].key, sel);
  ok('Rotate cycles which PEAK a mountain uses', rotated !== before.key, `${before.key} -> ${rotated}`);
  const cityCycle = await p.evaluate(async () => {
    const g = window.__game;
    const i = g.rockEdit.added.findIndex((o) => o.t === 'city');
    g.rockEdit.selAdded = new Set([i]); g.rockEdit.sel.clear();
    const was = g.rockEdit.added[i].key;
    document.querySelector('#eeRotR').click();
    return { was, now: g.rockEdit.added[i].key };
  });
  ok('...and which SKYLINE a city uses', cityCycle.now !== cityCycle.was, `${cityCycle.was} -> ${cityCycle.now}`);

  // ---- nudge, and the whole thing survives an export ----------------------
  const moved = await p.evaluate((i) => {
    const g = window.__game;
    g.rockEdit.selAdded = new Set([i]); g.rockEdit.sel.clear();
    const x0 = g.rockEdit.added[i].x;
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'ArrowRight', bubbles: true }));
    return { x0, x1: g.rockEdit.added[i].x, y: g.rockEdit.added[i].y };
  }, sel);
  ok('an arrow key moves a mountain along the surface', moved.x1 > moved.x0, `x ${moved.x0} -> ${moved.x1}`);
  ok('...and never invents a y for it', moved.y === undefined,
     'y stays absent, so buildLevel keeps placing it by column');

  // Through the real button. Copy JSON parks the level on window.__levelJSON as well as writing
  // the clipboard — always, not only on failure, because headless Chromium's clipboard write
  // SUCCEEDS and reading it back is not what proves the export is right.
  await p.evaluate(() => document.querySelector('#eeCopy').click()); await sleep(400);
  const exported = await p.evaluate((i) => {
    const live = window.__game.rockEdit.added[i];
    const def = JSON.parse(window.__levelJSON);
    const out = (def.objects || []).filter((o) => o.t === 'mountain');
    return { count: out.length, cities: (def.objects || []).filter((o) => o.t === 'city').length,
      match: out.some((o) => Math.round(o.x) === Math.round(live.x) && Math.round(o.w) === Math.round(live.w) && o.key === live.key) };
  }, sel);
  ok('the edited mountain is what Copy JSON writes out', exported.match,
     `${exported.count} mountain(s) + ${exported.cities} city/ies in the exported level`);

  ok('no page errors', errs.length === 0, errs.slice(0, 2).join(' | ') || 'none');
  await p.screenshot({ path: path.join(ART, 'surface-edit.png'), timeout: 15000, animations: 'disabled' }).catch(() => {});
  await browser.close();
  srv.close();
  console.log(`\n==== ${pass} passed, ${fail} failed ====`);   // the runner parses THIS form
  process.exit(fail ? 1 : 0);
})();
