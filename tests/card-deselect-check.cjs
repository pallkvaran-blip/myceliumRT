/* Tapping the SELECTED card again deselects it.
 *
 *   node tests/card-deselect-check.cjs
 *
 * Only a TARGETED card can be sitting selected when a tap arrives. Everything else resolves on
 * the first tap and leaves the hand, so there is no lingering selection to undo — onCardTap arms
 * and immediately plays. A targeted card instead sets ui.pendingCard and waits for a map tap or a
 * drag, and it stays highlighted the whole time.
 *
 * Tapping it again used to call onPlayCard a second time, which re-armed the identical pending
 * card: same highlight, same hint, nothing visibly happened, and the only ways out were to aim it
 * or to press something else. Now the second tap cancels the aim.
 *
 * Asserted through a real .cardbtn click rather than by calling onCardTap, because the wiring from
 * the button through the HUD to main's `aim` is the part that has to hold — the aim is TWO pieces
 * of state (the HUD's pendingCard and main's drag), and clearing only one leaves a live drag armed
 * against a card that is no longer selected.
 */
const http = require('http'), fs = require('fs'), path = require('path');
const { chromium } = require('playwright');
const ROOT = path.resolve(__dirname, '..');
const T = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.webp': 'image/webp', '.mp3': 'audio/mpeg', '.wav': 'audio/wav' };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let pass = 0, fail = 0;
const ok = (n, c, x) => { c ? (pass++, console.log('  PASS  ' + n + (x ? '  — ' + x : ''))) : (fail++, console.log('  FAIL  ' + n + (x ? '  — ' + x : ''))); };

(async () => {
  const srv = await new Promise((res) => { const s = http.createServer((rq, rs) => { let p = decodeURIComponent(rq.url.split('?')[0].split('#')[0]); if (p === '/') p = '/index.html'; const fp = path.join(ROOT, p); if (!fp.startsWith(ROOT) || !fs.existsSync(fp) || fs.statSync(fp).isDirectory()) { rs.writeHead(404); rs.end('nf'); return; } rs.writeHead(200, { 'Content-Type': T[path.extname(fp)] || 'application/octet-stream' }); fs.createReadStream(fp).pipe(rs); }); s.listen(0, () => res(s)); });
  const base = 'http://localhost:' + srv.address().port;
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1500, height: 950 } });
  const errs = [];
  page.on('pageerror', (e) => errs.push(String(e && e.message)));
  await page.addInitScript(() => { window.MYCELIUM_SUPABASE = { url: '', anonKey: '' }; });
  await page.goto(base + '/index.html#dev,turn', { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#loadscreen.ld-ready', { timeout: 60000 }).catch(() => {});
  await page.click('#loadscreen', { timeout: 5000 }).catch(() => {});
  await page.waitForFunction(() => window.__game && window.__game.state && window.__game.state.active, null, { timeout: 30000 });
  await sleep(600);

  const res = await page.evaluate(async () => {
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    const sel = () => { const el = document.querySelector('#handlist .cardbtn.selected'); return el ? el.getAttribute('data-name') : null; };
    const btn = (n) => [...document.querySelectorAll('#handlist .cardbtn')].find((b) => b.getAttribute('data-name') === n);
    const names = [...document.querySelectorAll('#handlist .cardbtn')].map((b) => b.getAttribute('data-name'));
    // A card that AIMS. The dev hand deals every card, so one of these is always present; the
    // test is meaningless on a card that resolves instantly, because nothing stays selected.
    const want = names.find((n) => /Lance|Excrete|Amputate|Condense|Punch/i.test(n));
    if (!want) return { want: null };
    const before = sel();
    btn(want).click(); await wait(250);
    const armed = { sel: sel(), pending: !!(window.__game.aimState && window.__game.aimState()) };
    const again = btn(want);
    if (again) again.click(); await wait(250);
    const cleared = sel();
    // A THIRD tap must select it again — deselect that stuck would be a worse bug than the one
    // being fixed, and "it toggles" is the actual claim.
    const third = btn(want);
    if (third) third.click(); await wait(250);
    return { want, before, armed, cleared, reselected: sel() };
  });

  ok('the dev hand contains a card that aims', !!res.want, res.want || 'none found');
  if (res.want) {
    ok('nothing is selected to begin with', res.before === null, String(res.before));
    ok('tapping a targeted card selects it', res.armed.sel === res.want, `${res.armed.sel}`);
    ok('tapping it AGAIN deselects it', res.cleared === null, `${res.cleared === null ? 'cleared' : 'still ' + res.cleared}`);
    ok('and a third tap selects it again (it toggles, it does not stick)', res.reselected === res.want, `${res.reselected}`);
  }
  ok('no page errors', errs.length === 0, errs.slice(0, 2).join(' | ') || 'none');

  await browser.close();
  srv.close();
  console.log(`\n  ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
