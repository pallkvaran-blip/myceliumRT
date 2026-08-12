/* A DROPPED IMAGE MUST NOT BE PERMANENT.
 *
 *     node tests/asset-retry-check.cjs
 *
 * Reported from a real phone: "I panned all the way to the right, zoomed in and out and there was
 * simply no end goal there. There were no cities either. I then refreshed the game and tried
 * again and it was okay on the second time around."
 *
 * That is the loader, not the camera. `loadOne`'s `img.onerror` filed the entry as
 * `{ ready: false }` and stopped there, forever — and every draw site is
 * `const hill = asset('goalhill'); if (!hill) return;`. So a single dropped request meant the
 * goal hill, the city skylines or the mountains were silently absent for the whole session, and
 * only a reload brought them back. The eager set is ~60 requests fired at once, which is why
 * several went together.
 *
 * It is worse than cosmetic on a level's rock sprite: `solidifyRock` waits for `ready` before it
 * stamps collision, so a dropped rock image is a rock the colony grows straight through.
 *
 * So: fail the request deliberately and assert the art comes back on its own. Playwright's
 * `route` is the only honest way to test this — a real network drop cannot be arranged, and
 * asserting the retry CODE rather than its effect would pass on a build that retried into the
 * same broken url forever.
 *
 * Trap worth recording: `asset()` is what repairs, so a probe that reads through it changes the
 * thing it is measuring. `__game.assetState` reads the bookkeeping without repairing; `assetAsk`
 * is the ordinary reader, which is the behaviour under test.
 */
const http = require('http'), fs = require('fs'), path = require('path');
const { chromium } = require('playwright');
const ROOT = path.resolve(__dirname, '..');
const T = { '.html':'text/html', '.js':'text/javascript', '.json':'application/json', '.png':'image/png',
  '.webp':'image/webp', '.jpg':'image/jpeg', '.jpeg':'image/jpeg', '.mp3':'audio/mpeg', '.wav':'audio/wav', '.svg':'image/svg+xml' };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let pass = 0, fail = 0;
const ok = (n, c, x) => { c ? (pass++, console.log('  PASS  ' + n + (x ? '  — ' + x : '')))
                            : (fail++, console.log('  FAIL  ' + n + (x ? '  — ' + x : ''))); };

(async () => {
const srv = await new Promise((res) => { const s = http.createServer((rq, rs) => {
  let u = decodeURIComponent(rq.url.split('?')[0].split('#')[0]); if (u === '/') u = '/index.html';
  const fp = path.join(ROOT, u);
  if (!fp.startsWith(ROOT) || !fs.existsSync(fp) || fs.statSync(fp).isDirectory()) { rs.writeHead(404); rs.end('nf'); return; }
  rs.writeHead(200, { 'Content-Type': T[path.extname(fp)] || 'application/octet-stream' });
  fs.createReadStream(fp).pipe(rs);
}); s.listen(0, () => res(s)); });
const base = 'http://localhost:' + srv.address().port;
const b = await chromium.launch({ headless: true, executablePath: '/opt/pw-browsers/chromium' });

// ---- 1. the boot ladder: the first tries fail, a later one lands ------------------------
{
  const ctx = await b.newContext({ viewport: { width: 900, height: 700 } });
  await ctx.addInitScript(() => { window.MYCELIUM_SUPABASE = { url: '', anonKey: '' }; });
  const p = await ctx.newPage();
  p.on('pageerror', (e) => console.log('PAGEERROR:', String(e.message).slice(0, 200)));
  // Kill the goal hill's first two requests, then let it through — a transient drop.
  let hits = 0;
  await p.route(/goalhill/, (route) => { hits++; if (hits <= 2) route.abort('failed'); else route.continue(); });
  await p.goto(base + '/index.html#dev', { waitUntil: 'domcontentloaded' });
  await p.waitForSelector('#loadscreen.ld-ready', { timeout: 60000 }).catch(() => {});
  await p.click('#loadscreen', { timeout: 5000 }).catch(() => {});
  await p.waitForFunction(() => window.__game && window.__game.state, null, { timeout: 60000 }).catch(() => {});
  // The ladder is 400 + 1200ms; give it room and then some.
  let st = null;
  for (let i = 0; i < 40; i++) {
    st = await p.evaluate(() => window.__game.assetState('goalhill'));
    if (st && st.ready) break;
    await sleep(300);
  }
  console.log('\ntransient drop during boot');
  ok('the request really was blocked', hits >= 2, `${hits} request(s) for goalhill`);
  ok('...and the asset came back without a reload', !!st && st.ready === true, JSON.stringify(st));
  ok('...having actually retried', !!st && st.tries >= 2, `${st ? st.tries : 0} failed tries recorded`);
  await ctx.close();
}

// ---- 2. the repair: the network stays away past the boot ladder --------------------------
// The layer that matters for the reported case. Every boot attempt fails; then the route opens,
// and the first draw that asks for the art is what brings it back.
{
  const ctx = await b.newContext({ viewport: { width: 900, height: 700 } });
  await ctx.addInitScript(() => { window.MYCELIUM_SUPABASE = { url: '', anonKey: '' }; });
  const p = await ctx.newPage();
  p.on('pageerror', (e) => console.log('PAGEERROR:', String(e.message).slice(0, 200)));
  let blocking = true, blocked = 0;
  await p.route(/goalhill/, (route) => { if (blocking) { blocked++; route.abort('failed'); } else route.continue(); });
  await p.goto(base + '/index.html#dev', { waitUntil: 'domcontentloaded' });
  await p.waitForSelector('#loadscreen.ld-ready', { timeout: 60000 }).catch(() => {});
  await p.click('#loadscreen', { timeout: 5000 }).catch(() => {});
  await p.waitForFunction(() => window.__game && window.__game.state, null, { timeout: 60000 }).catch(() => {});
  await sleep(6000);                       // outlast 400 + 1200 + 3000
  const down = await p.evaluate(() => window.__game.assetState('goalhill'));
  console.log('\nthe network is away for the whole boot');
  ok('every boot attempt failed', !!down && down.ready === false && down.tries >= 4,
     JSON.stringify(down));
  ok('...and the game is still running', await p.evaluate(() => !!(window.__game.state && window.__game.state.active)));

  blocking = false;                        // the phone comes back
  // The draw loop asks for this key every frame; drive a few asks explicitly so the check does
  // not depend on the goal being on screen at this camera.
  let back = null;
  for (let i = 0; i < 40; i++) {
    await p.evaluate(() => window.__game.assetAsk('goalhill'));
    back = await p.evaluate(() => window.__game.assetState('goalhill'));
    if (back && back.ready) break;
    await sleep(500);
  }
  ok('asking for it again repairs it — no reload', !!back && back.ready === true, JSON.stringify(back));
  ok('...and it did so with a bounded number of repairs', !!back && back.repairs <= 8,
     `${back ? back.repairs : 0} repair attempt(s) after ${blocked} blocked`);
  await ctx.close();
}

// ---- 3. a key that is genuinely missing must not spin ------------------------------------
// The cost of the repair when the file really is not there: capped, not one request per frame.
{
  const ctx = await b.newContext({ viewport: { width: 900, height: 700 } });
  await ctx.addInitScript(() => { window.MYCELIUM_SUPABASE = { url: '', anonKey: '' }; });
  const p = await ctx.newPage();
  let reqs = 0;
  await p.route(/goalbush/, (route) => { reqs++; route.abort('failed'); });
  await p.goto(base + '/index.html#dev', { waitUntil: 'domcontentloaded' });
  await p.waitForSelector('#loadscreen.ld-ready', { timeout: 60000 }).catch(() => {});
  await p.click('#loadscreen', { timeout: 5000 }).catch(() => {});
  await p.waitForFunction(() => window.__game && window.__game.state, null, { timeout: 60000 }).catch(() => {});
  await sleep(6000);
  const before = reqs;
  // 600 asks in a tight loop — what ten seconds of drawing would do.
  await p.evaluate(() => { for (let i = 0; i < 600; i++) window.__game.assetAsk('goalbush'); });
  await sleep(1500);
  console.log('\na file that is genuinely gone');
  ok('600 draw-time asks do not become 600 requests', reqs - before <= 2,
     `${reqs - before} request(s) from 600 asks (${before} during boot)`);
  await ctx.close();
}

await b.close(); srv.close();
console.log(`\n==== ${pass} passed, ${fail} failed ====`);
process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('HARNESS ERROR', e); process.exit(2); });
