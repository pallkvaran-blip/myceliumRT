/* The phone build: does the game hand a phone a phone-shaped layout, and does it keep its hands off
 * the browser's zoom?
 *
 * WHY THIS EXISTS. Reported on the itch build: "when the enter your name pops up, the browser zooms
 * in on that and after that the zoom is all wrong... cards are tiny, they zoom in and out along with
 * the map". Four symptoms, one cause — the New Game dialog called `input.focus()` unconditionally,
 * so on a phone the game handed focus to a native <input> the player had not touched. iOS Safari
 * answers a focused control by zooming to it, and INSIDE ITCH THAT ZOOM CANNOT BE UNDONE FROM HERE:
 * the scale belongs to itch's page, and our own viewport meta governs only our iframe. Everything
 * after that is the one stuck scale being described from different angles — the map and the HUD
 * magnify together because the whole page is a single scaled surface, and the cards look tiny at
 * whatever scale the player pinches back to.
 *
 * So the assertions come in two halves:
 *   1. WE DO NOT FOCUS FOR THEM on a coarse pointer — and we still do on a desktop, because losing
 *      that nicety is the obvious over-correction. The tap-safe half is asserted too: the field is
 *      >= 16px, the size at and above which iOS does not zoom to a control the player CHOSE to tap.
 *   2. The phone layout is actually the phone one. `max-width: 760px` decides the whole HUD, and it
 *      is measured against the frame the game is in, not the device — which is why the numbers, not
 *      just the media query, are asserted, and why nothing may overflow sideways.
 *
 * NOT COVERED, because a headless Chromium cannot show it: whether iOS zooms on a deliberate tap.
 * The 16px rule is asserted as the property that makes it safe, which is the closest a harness here
 * can get.
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
  const base = 'http://localhost:' + srv.address().port;
  const browser = await chromium.launch({ headless: true, executablePath: '/opt/pw-browsers/chromium' });

  // One browser per case is the house rule; these two differ only in whether the pointer is coarse.
  const boot = async (phone) => {
    const page = await browser.newPage(phone
      ? { viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true }
      : { viewport: { width: 1280, height: 720 } });
    page.on('pageerror', (e) => { fail++; console.log('  FAIL  page error — ' + e.message); });
    await page.addInitScript(() => { window.MYCELIUM_SUPABASE = { url: '', anonKey: '' }; });
    await page.goto(base + '/index.html', { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('#loadscreen.ld-ready', { timeout: 120000 }).catch(() => {});
    await page.click('#loadscreen', { timeout: 8000 }).catch(() => {});
    await page.waitForSelector('#titleScreen', { timeout: 60000 }).catch(() => {});
    return page;
  };
  // The dialog focuses (or doesn't) on a 60ms timer, so give it room before reading the answer.
  const openNameDialog = async (page) => {
    await page.click('#tsNewCamp', { timeout: 8000 }).catch(() => {});
    await page.waitForSelector('#tsNameInput', { timeout: 10000 }).catch(() => {});
    await sleep(500);
    return page.evaluate(() => {
      const i = document.getElementById('tsNameInput');
      if (!i) return null;
      const cs = getComputedStyle(i);
      return { focused: document.activeElement === i, fontSize: parseFloat(cs.fontSize),
               coarse: matchMedia('(pointer: coarse)').matches };
    });
  };

  try {
    // ---- 1. the phone: we must not focus for them ---------------------------------------------
    console.log('\nphone — the New Game dialog must not grab focus');
    const phone = await boot(true);
    const pv = await phone.evaluate(() => ({
      innerWidth: window.innerWidth,
      coarse: matchMedia('(pointer: coarse)').matches,
      phoneCSS: matchMedia('(max-width: 760px)').matches,
      meta: (document.querySelector('meta[name=viewport]') || {}).content || '',
    }));
    // THE PRECONDITION, ASSERTED. If emulation stopped reporting a coarse pointer the focus
    // assertion below would pass against the desktop branch and prove nothing.
    ok('the phone context really is a coarse pointer', pv.coarse === true, JSON.stringify(pv.coarse));
    ok('the viewport meta asks for device-width', /width=device-width/.test(pv.meta), pv.meta);
    ok('...and the phone stylesheet is the one in force', pv.phoneCSS === true, `innerWidth ${pv.innerWidth}`);

    const pn = await openNameDialog(phone);
    ok('the name dialog opens', !!pn, JSON.stringify(pn));
    // THE REGRESSION. `input.focus()` here is what summoned the keyboard and the browser zoom.
    ok('...and does NOT focus the name field on a phone', pn && pn.focused === false,
       pn ? `focused=${pn.focused}` : 'no dialog');
    // Which is only safe to leave to a tap because a tap on a >=16px field does not zoom either.
    ok('...and the field is >= 16px, so a deliberate tap does not zoom either',
       pn && pn.fontSize >= 16, pn ? pn.fontSize + 'px' : 'n/a');

    // The HUD, at the size a phone actually gets it. Guards the "cards are tiny" family: if the
    // game is ever laid out for a frame wider than the screen these go wrong together.
    console.log('\nphone — the HUD is laid out for the phone, and nothing overflows sideways');
    const nb = await phone.$('#tsNameInput');
    if (nb) { await nb.fill('P'); await phone.click('#tsNameStart', { timeout: 5000 }).catch(() => {}); }
    for (let i = 0; i < 60; i++) {
      const at = await phone.evaluate(() => {
        if (document.getElementById('speciesSelect')) return true;
        const st = document.querySelector('.li-story'); if (st) st.click();
        return false;
      });
      if (at) break;
      await sleep(500);
    }
    await phone.evaluate(() => { const b = document.querySelector('#ssAvail .ss-selbtn'); if (b) b.click(); });
    for (let i = 0; i < 40; i++) {
      const gone = await phone.evaluate(() => {
        const n = document.getElementById('levelIntro'); if (!n) return true; n.click(); return false;
      });
      if (gone) break;
      await sleep(500);
    }
    await phone.waitForFunction(() => {
      const g = window.__game; return !!(g && g.state && g.state.net && g.state.net.nodes.length);
    }, null, { timeout: 60000 }).catch(() => {});
    await phone.evaluate(() => {
      const t = document.getElementById('handtoggle'), bar = document.querySelector('.handbar');
      if (bar && !bar.classList.contains('open') && t) t.click();
    });
    await sleep(1500);
    const hud = await phone.evaluate(() => {
      const c = document.querySelector('#handlist .cardbtn');
      const cv = document.getElementById('game') || document.querySelector('canvas');
      return { card: c ? Math.round(c.getBoundingClientRect().width) : null,
               cards: document.querySelectorAll('#handlist .cardbtn').length,
               canvasW: cv ? cv.style.width : null,
               scrollW: document.documentElement.scrollWidth, innerWidth: window.innerWidth };
    });
    ok('the carousel has cards on a phone', hud.cards > 0, `${hud.cards} card(s)`);
    // 46vw of 390 is 179, capped at 172 — a THIRD of the screen or more. The reported bug had them
    // at 51-80 device px, which is what a desktop or 640-wide layout shrunk to fit looks like.
    ok('...and a card is a usable share of the screen, not a shrunken desktop card',
       hud.card !== null && hud.card >= 120, `${hud.card}px of ${hud.innerWidth}px`);
    ok('the canvas is sized to the phone viewport', hud.canvasW === hud.innerWidth + 'px',
       `canvas ${hud.canvasW}, viewport ${hud.innerWidth}px`);
    // Sideways overflow is what makes a mobile browser shrink the whole page to fit — the state in
    // which the HUD and the map magnify together.
    ok('...and nothing overflows sideways', hud.scrollW <= hud.innerWidth,
       `scrollWidth ${hud.scrollW} vs ${hud.innerWidth}`);
    await phone.close();

    // ---- 2. the desktop keeps its autofocus ----------------------------------------------------
    // The over-correction to guard against: dropping the convenience everywhere to fix a phone.
    console.log('\ndesktop — the autofocus is still there');
    const desk = await boot(false);
    const dv = await desk.evaluate(() => matchMedia('(pointer: coarse)').matches);
    ok('the desktop context is a fine pointer', dv === false, String(dv));
    const dn = await openNameDialog(desk);
    ok('...and the name field IS focused, ready to type', dn && dn.focused === true,
       dn ? `focused=${dn.focused}` : 'no dialog');
    await desk.close();
  } catch (e) {
    fail++; console.log('  HARNESS ERROR — ' + (e && e.stack || e));
  }

  await browser.close(); srv.close();
  console.log(`\n==== ${pass} passed, ${fail} failed ====`);
  process.exit(fail ? 1 : 0);
})();
