/* THE ITCH RATING ASK, at the foot of the species-selection screen, and the boon it pays.
 *
 * What this guards, and why each one is here rather than obvious:
 *   - THE PROMISE IS KEPT ONCE. Pressing the button IS the rating as far as the game can tell —
 *     itch tells us nothing back — so the only defence against farming it is that a second press
 *     arms nothing. A check that only looked at the copy would miss that entirely.
 *   - IT SURVIVES A RELOAD. The boon is two fields (`rated`, `rateBonus: armed|active|null`)
 *     precisely so a player who presses Rate, starts a run and closes the tab comes back to a run
 *     that still pays double. One boolean consumed at run start loses it silently.
 *   - IT IS ONE RUN, WIN OR LOSE, and every ending funnels through `runEndThen`.
 *   - THE ARITHMETIC IS SHOWN (owner: "+x * 2 = 200"). A doubled number that simply appears is
 *     indistinguishable from the game having always paid that.
 *
 * Drives the real screen through `__game.showPicker`, and the model through `__game.rate`.
 */
const http = require('http'), fs = require('fs'), path = require('path');
const { chromium } = require('playwright');
const ROOT = path.resolve(__dirname, '..');
const T = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.png': 'image/png',
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.svg': 'image/svg+xml', '.webp': 'image/webp',
  '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.css': 'text/css' };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let pass = 0, fail = 0;
const ok = (n, c, x) => { c ? (pass++, console.log('  PASS  ' + n + (x ? '  — ' + x : ''))) : (fail++, console.log('  FAIL  ' + n + (x ? '  — ' + x : ''))); };

(async () => {
  const srv = await new Promise((res) => { const s = http.createServer((rq, rs) => {
    let p = decodeURIComponent(rq.url.split('?')[0].split('#')[0]); if (p === '/') p = '/index.html';
    const fp = path.join(ROOT, p);
    if (!fp.startsWith(ROOT) || !fs.existsSync(fp) || fs.statSync(fp).isDirectory()) { rs.writeHead(404); rs.end('nf'); return; }
    rs.writeHead(200, { 'Content-Type': T[path.extname(fp)] || 'application/octet-stream' });
    fs.createReadStream(fp).pipe(rs); }); s.listen(0, () => res(s)); });
  const base = 'http://localhost:' + srv.address().port;
  const browser = await chromium.launch({ headless: true, executablePath: '/opt/pw-browsers/chromium' });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 950 } });
  const page = await ctx.newPage();
  const errs = []; page.on('pageerror', (e) => errs.push(String(e && e.message)));
  page.on('console', (m) => { if (m.type() === 'error') errs.push('console:' + m.text()); });
  await page.addInitScript(() => { window.MYCELIUM_SUPABASE = { url: '', anonKey: '' }; });
  await page.goto(base + '/index.html#dev', { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#loadscreen.ld-ready', { timeout: 25000 }).catch(() => {});
  await page.click('#loadscreen', { timeout: 5000 }).catch(() => {});
  await page.waitForFunction(() => !!(window.__game && window.__game.rate), { timeout: 25000 });

  const openPicker = async () => {
    await page.evaluate(() => {
      document.querySelectorAll('#speciesSelect, #levelIntro, #tutorial').forEach((n) => n.remove());
      window.__game.showPicker();
    });
    await page.waitForSelector('#ssRate', { timeout: 10000 });
    await sleep(250);
  };
  const readBanner = () => page.evaluate(() => {
    const box = document.getElementById('ssRate');
    if (!box) return null;
    const btn = box.querySelector('#ssRateBtn');
    const link = box.querySelector('#ssRateLink');
    const msg = box.querySelector('.ss-rate-msg');
    const console_ = document.querySelector('#speciesSelect .ss-body');
    return { text: msg ? msg.textContent.trim() : null,
             btn: btn ? btn.textContent.trim() : null,
             btnHref: btn ? btn.getAttribute('href') : null,
             btnTarget: btn ? btn.getAttribute('target') : null,
             btnRel: btn ? btn.getAttribute('rel') : null,
             btnBg: btn ? getComputedStyle(btn).backgroundColor : null,
             btnSize: btn ? parseFloat(getComputedStyle(btn).fontSize) : null,
             no: (() => { const n = box.querySelector('#ssRateNo'); return n ? n.textContent.trim() : null; })(),
             noSize: (() => { const n = box.querySelector('#ssRateNo');
               return n ? parseFloat(getComputedStyle(n).fontSize) : null; })(),
             hidden: box.hidden || getComputedStyle(box).display === 'none',
             link: link ? link.textContent.trim() : null,
             linkHref: link ? link.getAttribute('href') : null,
             // It must be the LAST thing on the screen (owner: "the bottom of the species
             // selection screen"). Asserted as position, not as source order.
             last: console_ ? console_.lastElementChild === box : null };
  });

  // ---- state A: never rated ---------------------------------------------------
  await page.evaluate(() => window.__game.rate.forget());
  await openPicker();
  let b = await readBanner();
  ok('the ask is at the foot of the selection screen', b && b.last === true, b && `last child = ${b.last}`);
  ok('...and reads as the owner wrote it',
     /Are you enjoying Mycelium\?/.test(b.text || '')
     && /rating us on itch\.io/.test(b.text || '')
     && /double the spores you get from your next run/.test(b.text || ''), b.text);
  ok('...with a Rate button', b.btn === 'Rate', b.btn || '(none)');
  const URL_WANT = 'https://pallkvaran.itch.io/mycelium/rate?source=game';
  ok('...pointing at the rate page', b.btnHref === URL_WANT, b.btnHref || '(none)');
  // A new tab, and `noopener` — the linked page must not get a handle on the game's window.
  ok('...opening in a new tab, safely',
     b.btnTarget === '_blank' && /noopener/.test(b.btnRel || ''), `${b.btnTarget} ${b.btnRel}`);
  // WHITE, NOT MINT (owner). Mint is the colony's own colour and made this the loudest thing on a
  // screen full of things to buy. Read as channels, which is what says "white" for any white.
  const wrgb = (b.btnBg || '').match(/\d+/g) || [];
  ok('...on a white button', wrgb.length >= 3 && wrgb.slice(0, 3).every((v) => +v > 240), b.btnBg);
  ok('...and a smaller one than it was', b.btnSize > 0 && b.btnSize <= 12.5, `${b.btnSize}px (was 13)`);
  // The decline has to be findable and must not compete — an equally-weighted "No thanks" turns an
  // aside into a decision the player has to make.
  ok('...beside a quiet "No thanks"',
     b.no === 'No thanks' && b.noSize > 0 && b.noSize < b.btnSize, `${b.no} at ${b.noSize}px`);
  ok('nothing is owed before it is pressed',
     await page.evaluate(() => window.__game.rate.state()) === null);

  // ---- declining -------------------------------------------------------------
  // Asserted BEFORE the accept path, and on a fresh state, because "No thanks" and "Rate" are
  // mutually exclusive answers and testing one after the other would be testing the second one's
  // effect on the first.
  await page.evaluate(() => window.__game.rate.forget());
  await openPicker();
  await page.click('#ssRateNo');
  await sleep(250);
  let d = await readBanner();
  ok('"No thanks" makes the ask disappear', d.hidden === true && d.text === null,
     `hidden=${d.hidden} text=${d.text}`);
  ok('...and it is recorded', await page.evaluate(() => window.__game.rate.dismissed()) === true);
  await openPicker();
  d = await readBanner();
  ok('...and it never comes back', d.hidden === true, `hidden=${d.hidden}`);
  ok('...having cost the player no boon they had already earned',
     await page.evaluate(() => window.__game.rate.state()) === null);
  await page.evaluate(() => window.__game.rate.forget());
  await openPicker();

  // ---- state B: pressed, this visit -------------------------------------------
  await page.click('#ssRateBtn');
  await sleep(250);
  b = await readBanner();
  ok('pressing Rate thanks the player where they pressed it',
     /Thank you! Your spores will be doubled\./.test(b.text || ''), b.text);
  ok('...and arms the boon', await page.evaluate(() => window.__game.rate.state()) === 'armed');
  ok('...and the button is gone', b.btn === null, b.btn || '(gone)');

  // ---- state C: a later visit --------------------------------------------------
  await openPicker();
  b = await readBanner();
  ok('a later visit says "Thank you for rating"',
     /^Thank you for rating$/.test((b.text || '').replace(/\s+/g, ' ').trim()), b.text);
  ok('...with "rating" itself the link', b.link === 'rating' && b.linkHref === URL_WANT,
     `${b.link} -> ${b.linkHref}`);
  ok('...and the boon is still owed, not spent by looking at the screen',
     await page.evaluate(() => window.__game.rate.state()) === 'armed');
  // THE ONE THAT MATTERS: a second trip to the rating page must not arm a second doubling.
  const second = await page.evaluate(() => {
    const before = window.__game.rate.state();
    const armedAgain = window.__game.rate.press();
    return { before, armedAgain, after: window.__game.rate.state() };
  });
  ok('following the link again does not arm a second doubling',
     second.armedAgain === false && second.after === 'armed', JSON.stringify(second));

  // ---- the boon, across a run --------------------------------------------------
  const run = await page.evaluate(async () => {
    const g = window.__game;
    const out = { before: g.rate.state() };
    // CLEAR THE PICKER FIRST. `showPicker` leaves `#speciesSelect` over the game, and starting a
    // run underneath it left the win screen never arriving — the first version of this block read
    // "banked 0" on a build that pays correctly.
    document.querySelectorAll('#speciesSelect, #levelIntro, #tutorial, #ssLevelComplete, #ssGameWon')
      .forEach((n) => n.remove());
    g.campaign.play('marasmius', 1);            // a run begins
    await new Promise((r) => setTimeout(r, 300));
    out.onRun = g.rate.state();
    out.mult = g.rate.mult();
    const bal0 = g.store.balance();
    g.winLevel();
    for (let i = 0; i < 80; i++) {
      await new Promise((r) => setTimeout(r, 200));
      if (document.getElementById('ssLevelComplete') || document.getElementById('ssGameWon')) break;
    }
    const p = document.querySelector('.ss-win-earned');
    out.earnedText = p ? p.textContent.replace(/\s+/g, ' ').trim() : null;
    out.x = !!document.querySelector('.ss-win-earned .ss-win-x');
    out.gained = g.store.balance() - bal0;
    document.querySelectorAll('#ssLevelComplete, #ssGameWon').forEach((n) => n.remove());
    return out;
  });
  ok('starting a run moves the boon onto it', run.onRun === 'active', `${run.before} -> ${run.onRun}`);
  ok('...and that run pays double', run.mult === 2 && run.gained === 200,
     `mult ${run.mult}, banked ${run.gained}`);
  // The working, not just the total.
  ok('...and the win screen shows the arithmetic', run.x === true && /100/.test(run.earnedText || '')
     && /200/.test(run.earnedText || ''), run.earnedText || '(none)');

  // ---- it is ONE run ------------------------------------------------------------
  const after = await page.evaluate(async () => {
    const g = window.__game;
    g.showPicker();                    // ...via the ending funnel the death card and keep screen use
    await new Promise((r) => setTimeout(r, 200));
    const mid = g.rate.state();
    document.querySelectorAll('#speciesSelect, #levelIntro, #tutorial, #ssLevelComplete, #ssGameWon')
      .forEach((n) => n.remove());
    g.campaign.play('marasmius', 1);
    await new Promise((r) => setTimeout(r, 300));
    const bal0 = g.store.balance();
    g.winLevel();
    for (let i = 0; i < 80; i++) {
      await new Promise((r) => setTimeout(r, 200));
      if (document.getElementById('ssLevelComplete') || document.getElementById('ssGameWon')) break;
    }
    const gained = g.store.balance() - bal0;
    const x = !!document.querySelector('.ss-win-earned .ss-win-x');
    document.querySelectorAll('#ssLevelComplete, #ssGameWon').forEach((n) => n.remove());
    return { mid, gained, x, state: g.rate.state() };
  });
  ok('the boon is released when the run ends', after.mid === null && after.state === null,
     `after the run: ${after.mid}`);
  ok('...so the NEXT run pays normally again', after.gained === 100 && after.x === false,
     `banked ${after.gained}, working shown = ${after.x}`);

  // ---- and it survives a reload ---------------------------------------------------
  // The reason the boon is two fields. Arm it, begin a run, RELOAD, and the run must still be the
  // doubled one — a single flag consumed at run start would have been spent with nothing left to
  // say so.
  await page.evaluate(async () => {
    const g = window.__game;
    g.rate.forget(); g.rate.press();
    g.campaign.play('marasmius', 1);
    await new Promise((r) => setTimeout(r, 300));
  });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#loadscreen.ld-ready', { timeout: 25000 }).catch(() => {});
  await page.click('#loadscreen', { timeout: 5000 }).catch(() => {});
  await page.waitForFunction(() => !!(window.__game && window.__game.rate), { timeout: 25000 });
  const reloaded = await page.evaluate(() => ({ state: window.__game.rate.state(), mult: window.__game.rate.mult() }));
  ok('a reload mid-run does not cost the player the boon',
     reloaded.state === 'active' && reloaded.mult === 2, JSON.stringify(reloaded));

  await page.screenshot({ path: path.join(__dirname, '.artifacts', 'rate-ask.png'), animations: 'disabled', timeout: 15000 }).catch(() => {});
  ok('no page errors', errs.length === 0, errs.slice(0, 2).join(' | '));
  console.log(`\n==== ${pass} passed, ${fail} failed ====`);
  await browser.close(); srv.close(); process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('HARNESS ERROR', e); process.exit(2); });
