/* The victory screen's ANIMATION and its two failure modes, on a page that can actually measure
 * them. Its CONTENT and its place in the win path belong to `campaign-check`; this is the split
 * that finally made both honest.
 *
 * WHY IT IS ITS OWN FILE. `campaign-check` boots once and plays nine levels before it gets near
 * this screen, and by then the page is starved: a single `await setTimeout(0)` there was measured
 * at 9,275 ms, so a 2.6 s fade cannot be sampled at all. Two sessions were spent reading that as a
 * broken feature — first as nine assertions failing on a correct build, then as a sampler that
 * labelled its samples by sleep count. CLAUDE.md's standing rule is the answer: on a loaded page
 * assert ORDER and END STATE, and measure timing only on a page with nothing else to do. This one
 * boots and goes straight to the screen.
 *
 * The two things it guards, both of which were real defects rather than hypotheticals:
 *   1. THE FADE. It is the one #levelIntro that fades UP from the map instead of cutting to black,
 *      and the card must not open until the black has landed — growing the wordmark under a
 *      half-transparent overlay spends the one animation the screen is built around on frames
 *      nobody is looking at.
 *   2. THE SECOND SCREEN OF A SESSION. The fade used to be started from a requestAnimationFrame
 *      callback that never ran the second time, and `openCard` was scheduled inside it — so no
 *      fade, no card, and the dismiss never armed: a full-screen overlay at opacity 0 swallowing
 *      every click, forever. Reachable by winning the campaign twice in one page. Nothing else
 *      covers this, and it is the worst bug this screen has had.
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const ROOT = path.resolve(__dirname, '..');
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.svg': 'image/svg+xml',
  '.webp': 'image/webp', '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.css': 'text/css' };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let pass = 0, fail = 0;
const ok = (n, c, x) => { c ? (pass++, console.log('  PASS  ' + n + (x ? '  — ' + x : '')))
                            : (fail++, console.log('  FAIL  ' + n + (x ? '  — ' + x : ''))); };

(async () => {
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
  const errs = [];
  page.on('pageerror', (e) => errs.push(String(e && e.message)));
  await page.addInitScript(() => { window.MYCELIUM_SUPABASE = { url: '', anonKey: '' }; });

  try {
    await page.goto('http://localhost:' + srv.address().port + '/index.html#dev',
                    { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('#loadscreen.ld-ready', { timeout: 30000 }).catch(() => {});
    await page.click('#loadscreen', { timeout: 8000 }).catch(() => {});
    await page.waitForFunction(() => !!(window.__game && window.__game.victory), null, { timeout: 40000 });
    // Clear the boot's own screens so nothing else is animating while we measure.
    for (let i = 0; i < 4 && await page.$('#levelIntro'); i++) { await page.mouse.click(720, 450); await sleep(800); }
    await page.evaluate(() => {
      document.querySelectorAll('#speciesSelect, #tutorial, #levelIntro').forEach((n) => n.remove());
    });

    // One run of the screen: measure the fade, try to skip it early, then let it settle.
    // SAMPLED ON THE REAL CLOCK. Every sample carries the elapsed time it was actually taken at —
    // labelling samples by sleep count is a bet that a timer fires when it says it will, and that
    // bet is what produced two rounds of false failures.
    const run = () => page.evaluate(async () => {
      const g = window.__game;
      const root = () => document.querySelector('#levelIntro.li-vict');
      // A DISMISSED SCREEN LIVES ON FOR ITS OWN FADE-OUT, so wait it out rather than measuring it.
      for (let i = 0; i < 60 && root(); i++) await new Promise((r) => setTimeout(r, 200));
      const out = { cleanStart: !root(), fadeMs: g.ending().fadeMs, samples: [], clickAt: null };
      let done = false;
      g.victory(() => { done = true; });
      const t0 = performance.now();
      while (performance.now() - t0 < out.fadeMs + 2000) {
        await new Promise((r) => setTimeout(r, 25));
        const ms = performance.now() - t0, r = root();
        out.samples.push({ ms: Math.round(ms), op: r ? +(+getComputedStyle(r).opacity).toFixed(3) : null,
                           open: r ? r.classList.contains('li-in') : null });
        // The stray click goes in EARLY BY MEASUREMENT, not by sample index — the point is that it
        // lands while the screen is still fading, and a player who has just won is mid-click.
        if (out.clickAt == null && r && ms > 80) { r.click(); out.clickAt = Math.round(ms); }
      }
      out.survivedEarlyClick = !!root();
      // Let it finish assembling.
      for (let i = 0; i < 60 && !document.querySelector('#levelIntro.li-vict .li-level canvas'); i++) {
        await new Promise((r) => setTimeout(r, 200));
      }
      out.word = !!document.querySelector('#levelIntro.li-vict .li-level canvas');
      out.armedNow = !!root();
      // ...and can be dismissed. A screen that cannot be clicked away is the softlock this file
      // exists for, so "it appeared" is never asserted without "and it goes".
      for (let i = 0; i < 60 && root(); i++) { root().click(); await new Promise((r) => setTimeout(r, 200)); }
      out.dismissed = !root();
      out.done = done;
      return out;
    });

    for (const label of ['first', 'second']) {
      console.log(`\n-- the ${label} victory screen of this page --`);
      const r = await run();
      const mid = r.samples.filter((s) => s.op != null && s.op > 0.02 && s.op < 0.95).length;
      const trace = r.samples.filter((s, i) => i % 12 === 0)
        .map((s) => `${s.ms}:${s.op}${s.open ? '+open' : ''}`).join(' ');
      ok(`${label}: starts from a clean page`, r.cleanStart === true);
      ok(`${label}: fades UP from the map instead of cutting to black`, mid >= 3,
         `${r.samples.length} samples over ${r.samples[r.samples.length - 1].ms}ms | ${trace}`);
      // 0.98, matching `openCard`'s own threshold rather than demanding an exact 1 — a transition
      // sampled mid-flight reports 0.999 and an `=== 1` test fails on a screen that is, to the eye
      // and to the code, fully black.
      ok(`${label}: the card only opens once the black has landed`,
         r.samples.every((s) => !s.open || s.op == null || s.op >= 0.98),
         trace + ' | ' + JSON.stringify(r.samples.filter((s) => s.open && s.op != null && s.op < 0.98).slice(0, 3)));
      ok(`${label}: a click during the fade does NOT skip it`, r.survivedEarlyClick === true,
         `clicked at ${r.clickAt}ms of a ${r.fadeMs}ms fade`);
      ok(`${label}: VICTORY is grown as a mycelium wordmark`, r.word === true);
      // THE SOFTLOCK, stated as the thing a player would hit. Before the fix the second screen
      // never armed and this is the assertion that would have caught it.
      ok(`${label}: ...and it can be clicked away`, r.dismissed === true && r.done === true,
         JSON.stringify({ dismissed: r.dismissed, onDone: r.done }));
    }

    ok('no page errors', errs.length === 0, errs.slice(0, 2).join(' | '));
  } catch (e) {
    fail++; console.log('  HARNESS ERROR — ' + (e && e.stack || e));
  }

  await browser.close(); srv.close();
  console.log(`\n==== ${pass} passed, ${fail} failed ====`);
  process.exit(fail ? 1 : 0);
})();
