/* THE TOP BAND ON A PORTRAIT PHONE — the resource pill and the Actions pill must not overlap.
 *
 *     node tests/hudtop-check.cjs
 *
 * Reported as "the top of the phone screen on portrait gets messed up when I have both left and
 * right pill engines installed — things start overlapping", and that is exactly the condition:
 * BOTH kinds of card installed, because each side is what makes the other's half wider.
 *
 *   - the left cluster (.hud → .hudtop → resource pill + gear) is absolute against `left`,
 *     shrink-to-fit, with no max-width anywhere on it;
 *   - the Actions dock is absolute against `right`, same z-index, appended later — so it paints
 *     OVER whatever the left cluster has grown into;
 *   - an installed INCOME engine adds a "+N–M" to every resource on the pill (~35px each), and an
 *     installed ABILITY is what puts the red Actions pill on the right at all.
 *
 * Measured before the fix, 844 tall: at 390 the gear sat 20px under the Actions pill; at 360 the
 * pill itself 10px under it and the gear 32px; 414 fit with room to spare. So it is not "phones"
 * — it is a width budget, which is why `_syncTopRow()` measures the gap and steps the row through
 * `.compact` (drop the income deltas, which the ledger repeats in full) and then `.tight`
 * (smaller numerals, cap the row and let it wrap) instead of a media query.
 *
 * What is asserted, therefore: no overlap at three portrait widths; the tiers fire ONLY where
 * they are needed (a 480 screen keeps its income deltas — otherwise "no overlap" could
 * be won by compacting everyone); a NEGATIVE CONTROL that strips the tier back off and confirms the overlap
 * returns, so a green run cannot mean the probe is measuring nothing; and the rotation case,
 * where landscape leaves both drop-downs pinned open and portrait cannot fit them.
 *
 * Section 4 (finishing plan M3) is THE MINE'S band, which has its own HUD: two rows, a rot banner
 * and a fixed gear, at 390/360/320 with every entry up, against a control that rebuilds the old
 * single row (measured there: the row runs to x 683 and the gear to 723 on a 390 screen).
 */
const http = require('http'), fs = require('fs'), path = require('path');
const { chromium } = require('playwright');
const ROOT = path.resolve(__dirname, '..');
const T = { '.html':'text/html', '.js':'text/javascript', '.json':'application/json', '.png':'image/png',
  '.webp':'image/webp', '.mp3':'audio/mpeg', '.wav':'audio/wav', '.svg':'image/svg+xml' };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let pass = 0, fail = 0;
const ok = (n, c, x) => { c ? (pass++, console.log('  PASS  ' + n + (x ? '  — ' + x : '')))
                            : (fail++, console.log('  FAIL  ' + n + (x ? '  — ' + x : ''))); };

const boot = async (ctx, url) => {
  const p = await ctx.newPage();
  p.on('pageerror', (e) => console.log('PAGEERROR:', String(e.message).slice(0, 200)));
  await p.goto(url, { waitUntil: 'domcontentloaded' });
  await p.waitForSelector('#loadscreen.ld-ready', { timeout: 60000 }).catch(() => {});
  await p.click('#loadscreen', { timeout: 5000 }).catch(() => {});
  await p.waitForFunction(() => window.__game && window.__game.state && window.__game.state.active, null, { timeout: 60000 }).catch(() => {});
  for (let i = 0; i < 6 && await p.$('#levelIntro'); i++) { await p.mouse.click(120, 300); await sleep(400); }
  return p;
};

// Install both kinds of card and WAIT FOR THE HUD TO SAY SO before measuring. The HUD refreshes
// on a world tick, so a fixed number of ticks measures the state from before the mutation — the
// first version of this probe read every configuration one step late and reported the income
// deltas against the wrong row.
const setUp = (p, eng, act) => p.evaluate(async ({ eng, act }) => {
  const g = window.__game, st = g.state, net = st.active, C = st.cards;
  st.runOver = false; st.winPending = false; net.alive = true;
  net.energy = 1234; net.water = 88; net.phosphorus = 42;
  st.clouds = []; st.nematodes = []; C.pendingOffers.length = 0;
  const ENG = [{ name: 'Aquifer Tap', water: 2, every: 6, _et: 1 },
               { name: 'Dew Traps', water: 1, every: 4, _et: 1 },
               { name: 'Cord Capillary', energy: 3, every: 5, _et: 1 }];
  const ACT = [{ name: 'Constricting Ring', cd: 0, used: 0, every: 3 },
               { name: 'Sinker Rhizomorph', cd: 0, used: 0, every: 4 },
               { name: 'Saprotrophic Digest', cd: 0, used: 0, every: 2 }];
  C.engines = ENG.slice(0, eng); C.actions = ACT.slice(0, act); C._engTick = 0;
  const dockWanted = act > 0;
  for (let i = 0; i < 120; i++) {
    st.runOver = false; net.alive = true; g.tickWorld(st);
    await new Promise((r) => requestAnimationFrame(r));
    const dock = document.querySelector('.actionsdock');
    const shown = !!dock && !dock.classList.contains('hidden');
    if (shown === dockWanted) return true;
  }
  return false;
}, { eng, act });

// The three things in the band, plus how far the left cluster runs under the right pill.
const band = (p) => p.evaluate(() => {
  const R = (sel) => { const e = document.querySelector(sel); if (!e) return null;
    if (getComputedStyle(e).display === 'none') return { gone: true };
    const q = e.getBoundingClientRect();
    return { x: Math.round(q.x), right: Math.round(q.right), y: Math.round(q.y), bottom: Math.round(q.bottom) }; };
  const res = R('.resrow'), gear = R('.gearbtn'), act = R('.actbtn');
  const over = (a, b) => (!a || !b || a.gone || b.gone) ? 0
    : Math.max(0, Math.min(a.right, b.right) - Math.max(a.x, b.x));
  const topEl = document.querySelector('.hudtop');
  return { res, gear, act,
           resVsAct: over(res, act), gearVsAct: over(gear, act),
           cls: topEl ? topEl.className : '',
           // The income deltas are what `.compact` gives up first; empty means either no engine
           // or the tier fired, and the caller knows which it set up. VISIBLE ones only. `.compact` hides them with display:none, which leaves the text in
           // place — reading textContent alone reported the deltas as present on a compacted
           // row and made the "it did not have to compact" control pass vacuously.
           inc: [...document.querySelectorAll('.resrow .rd')]
                  .filter((n) => n.offsetParent !== null && n.getBoundingClientRect().width > 0)
                  .map((n) => n.textContent.trim()).filter(Boolean),
           phoneCSS: matchMedia('(max-width: 760px)').matches };
});

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

// ---- 1. the reported case, at three portrait widths --------------------------------------
// 390 is an iPhone 12/13/14, 360 the commonest Android, 320 an SE — one browser per case is the
// house rule here, so each gets its own context.
for (const W of [390, 360, 320]) {
  const ctx = await b.newContext({ viewport: { width: W, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  await ctx.addInitScript(() => { window.MYCELIUM_SUPABASE = { url: '', anonKey: '' }; });
  const p = await boot(ctx, base + '/index.html#dev');
  console.log(`\nportrait ${W}x844 — both kinds installed`);
  const ready = await setUp(p, 3, 3);
  const r = await band(p);
  ok('the phone stylesheet is in force', r.phoneCSS === true, `innerWidth ${W}`);
  ok('both pills are on screen', ready === true && !!r.act && !r.act.gone && !!r.res,
     r.act ? `actions pill ${r.act.x}..${r.act.right}` : 'no actions pill');
  ok('the resource pill does not run under the Actions pill', r.resVsAct === 0,
     `pill ${r.res.x}..${r.res.right} vs actions ${r.act.x}..${r.act.right} → ${r.resVsAct}px`);
  ok('...and neither does the gear', r.gearVsAct === 0,
     `gear ${r.gear.x}..${r.gear.right} vs actions ${r.act.x}..${r.act.right} → ${r.gearVsAct}px`);
  ok('the row compacted to make that true', /compact|tight/.test(r.cls), `.hudtop class "${r.cls}"`);

  // NEGATIVE CONTROL. Strip the tier back off and the overlap must come back — otherwise these
  // assertions would pass on a build where the row simply never got wide, and prove nothing.
  const ctrl = await p.evaluate(() => {
    const t = document.querySelector('.hudtop');
    const keep = t.className, keepW = t.style.maxWidth;
    t.className = 'hudtop'; t.style.maxWidth = '';
    const R = (s) => { const e = document.querySelector(s); const q = e.getBoundingClientRect();
      return { x: Math.round(q.x), right: Math.round(q.right) }; };
    const res = R('.resrow'), gear = R('.gearbtn'), act = R('.actbtn');
    const over = (a, c) => Math.max(0, Math.min(a.right, c.right) - Math.max(a.x, c.x));
    const out = { res: over(res, act), gear: over(gear, act) };
    t.className = keep; t.style.maxWidth = keepW;
    return out;
  });
  ok('control: without the compaction they DO overlap', (ctrl.res + ctrl.gear) > 0,
     `pill ${ctrl.res}px + gear ${ctrl.gear}px under the Actions pill`);

  // A BEFORE/AFTER PAIR at the reported width, because this is a layout bug and a frame is the
  // only honest report of one. The dev shortcuts are hidden for both: they sit in the same
  // top-right corner and a release build has none of them, so leaving them in would show a
  // collision the player never sees and hide the one they do.
  if (W === 390) {
    const hideDev = () => p.evaluate(() => {
      for (const id of ['devWin', 'devMapBtn', 'devMapPanel', 'devEditBtn', 'devEditPanel'])
        { const n = document.getElementById(id); if (n) n.style.display = 'none'; }
    });
    await hideDev();
    await p.screenshot({ path: path.join(__dirname, '.artifacts', 'hudtop-phone-after.png'),
      animations: 'disabled', timeout: 8000 }).catch(() => {});
    const keep = await p.evaluate(() => {
      const t = document.querySelector('.hudtop');
      const had = { cls: t.className, w: t.style.maxWidth };
      t.className = 'hudtop'; t.style.maxWidth = '';
      return had;
    });
    await p.screenshot({ path: path.join(__dirname, '.artifacts', 'hudtop-phone-before.png'),
      animations: 'disabled', timeout: 8000 }).catch(() => {});
    await p.evaluate((had) => { const t = document.querySelector('.hudtop');
      t.className = had.cls; t.style.maxWidth = had.w; }, keep);
  }
  await ctx.close();
}

// ---- 2. ...and a screen with room keeps everything ----------------------------------------
// The tiers must be a response to the measurement, not a phone-wide tax. Without this, "no
// overlap" could be won by compacting every phone, which is a different (and worse) product.
//
// 480, not 414: measured with a four-digit energy stock the row wants 321px at 414 against 317
// of gap, so the biggest phone in the range misses by FOUR PIXELS and compacts — correctly, but
// it makes a poor control. 480 is still inside the phone stylesheet (<=760).
{
  const ctx = await b.newContext({ viewport: { width: 480, height: 900 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  await ctx.addInitScript(() => { window.MYCELIUM_SUPABASE = { url: '', anonKey: '' }; });
  const p = await boot(ctx, base + '/index.html#dev');
  console.log('\nportrait 480x900 — a screen with room pays nothing');
  await setUp(p, 3, 3);
  const r = await band(p);
  ok('no overlap here either', r.resVsAct === 0 && r.gearVsAct === 0,
     `pill/actions ${r.resVsAct}px, gear/actions ${r.gearVsAct}px`);
  ok('...and it did NOT need to compact', !/compact|tight/.test(r.cls), `.hudtop class "${r.cls}"`);
  ok('...so the pill still shows its per-round income', r.inc.length > 0, r.inc.join(' ') || '(none)');
  await ctx.close();
}

// ---- 3. rotation: landscape pins both drop-downs open, portrait cannot hold them ----------
// The "one drop-down at a time" rule tested the width at CLICK time only, while the initial
// open state is decided once at build — so a phone turned from landscape (innerWidth 844, both
// panels pinned) to portrait arrived with both open. The ledger is min(80vw,260px) and the
// Actions menu 266px: they cannot both fit under ~1330px of screen.
{
  const ctx = await b.newContext({ viewport: { width: 844, height: 390 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  await ctx.addInitScript(() => { window.MYCELIUM_SUPABASE = { url: '', anonKey: '' }; });
  const p = await boot(ctx, base + '/index.html#dev');
  console.log('\nlandscape 844x390 → portrait 390x844');
  await setUp(p, 3, 3);
  const before = await p.evaluate(() => ({
    led: !document.querySelector('.engledger').classList.contains('hidden'),
    menu: !document.querySelector('.actmenu').classList.contains('hidden'),
  }));
  ok('landscape (844 wide) has both drop-downs open — the state that has to be handled',
     before.led === true && before.menu === true, JSON.stringify(before));
  await p.setViewportSize({ width: 390, height: 844 });
  await sleep(600);
  await setUp(p, 3, 3);
  const after = await p.evaluate(() => {
    const R = (s) => { const e = document.querySelector(s);
      if (!e || getComputedStyle(e).display === 'none') return null;
      const q = e.getBoundingClientRect();
      return { x: Math.round(q.x), right: Math.round(q.right), y: Math.round(q.y), bottom: Math.round(q.bottom) }; };
    const led = R('.engledger'), menu = R('.actmenu');
    const overlap = (led && menu)
      ? Math.max(0, Math.min(led.right, menu.right) - Math.max(led.x, menu.x))
        * (Math.min(led.bottom, menu.bottom) > Math.max(led.y, menu.y) ? 1 : 0)
      : 0;
    return { led: !!led, menu: !!menu, overlap };
  });
  ok('rotating to portrait does not leave both open', !(after.led && after.menu),
     `ledger ${after.led}, actions menu ${after.menu}`);
  ok('...so the two drop-downs cannot overlap', after.overlap === 0, `${after.overlap}px`);
  const r = await band(p);
  ok('and the band is still clear after the rotation', r.resVsAct === 0 && r.gearVsAct === 0,
     `pill/actions ${r.resVsAct}px, gear/actions ${r.gearVsAct}px`);
  await ctx.close();
}

// ---- 4. THE MINE'S TOP BAND (finishing plan M3) ---------------------------------------------
// The mine has its own HUD and the same failure: one row carried water, P, depth, worms, the rot
// clock, the price and the materials, and at 390 it ran to x ~480 with the gear (x 448-480) off the
// screen. It is two rows now (row 2 only when it has content), the rot clock is a banner of its own
// and the gear is position:fixed. Asserted at the same three widths as above, with every entry that
// can be shown SHOWN, plus the same kind of negative control: take the stacking class away and the
// rows must run into the gear or off the screen again, or this is measuring nothing.
for (const W of [390, 360, 320]) {
  const ctx = await b.newContext({ viewport: { width: W, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  await ctx.addInitScript(() => { window.MYCELIUM_SUPABASE = { url: '', anonKey: '' }; });
  const p = await boot(ctx, base + '/index.html#mine,4242');
  await p.waitForFunction(() => window.__game && window.__game.mine && window.__game.state.substrate._fineSolid, null, { timeout: 30000 }).catch(() => {});
  console.log(`\nthe mine at ${W}x844 — every HUD entry up`);
  const m = await p.evaluate(async () => {
    const g = window.__game, s = g.state;
    s.config.nematodes.respawnChance = 0; s.config.trichoderma.respawnChance = 0;
    s.active.water = 1234; s.active.phosphorus = 327; s.mineOre = 327;
    s.mineMats = { anthracite: 16, garnet: 13, hematite: 12 };
    const live = s.active.nodes.filter((n) => !n.infected);
    for (let k = 0; k < 3; k++) { const n = live[k % live.length]; g.mine.spawnWorm(n.x + 3, n.y); }
    for (let i = 0; i < 100 && (s.mineAttached | 0) < 1; i++) await new Promise((r) => setTimeout(r, 100));
    await new Promise((r) => setTimeout(r, 700));
    // THE ROT BANNER, shown in the DOM: a real breach on a 3-strand colony at the surface rots all of
    // it at once and ends the run (tests/phone-check.cjs shows a real one on a 45 m colony).
    const ic = document.getElementById('hud-infect'); ic.hidden = false;
    document.getElementById('hud-infectn').textContent = '20';
    const R = (e) => { if (!e || getComputedStyle(e).display === 'none') return null; const q = e.getBoundingClientRect();
      return q.width > 0 ? { x0: q.left, x1: q.right, y0: q.top, y1: q.bottom } : null; };
    const over = (a, c) => !!(a && c) && Math.min(a.x1, c.x1) > Math.max(a.x0, c.x0) && Math.min(a.y1, c.y1) > Math.max(a.y0, c.y0);
    const meas = () => {
      const gear = R(document.getElementById('gearbtn')), r1 = R(document.querySelector('.minehud .hudtop .resrow')),
            r2 = R(document.getElementById('hudrow2')), bn = R(ic);
      const hit = gear ? document.elementFromPoint((gear.x0 + gear.x1) / 2, (gear.y0 + gear.y1) / 2) : null;
      const offScreen = [r1, r2, bn, gear].some((r) => r && (r.x0 < 0 || r.x1 > innerWidth + 0.5));
      return { gear, r1, r2, bn, gearHit: !!(hit && hit.closest && hit.closest('#gearbtn')), offScreen,
               clash: over(r1, gear) || over(r2, gear) || over(bn, gear) || over(bn, r1) || over(bn, r2) || over(r1, r2) };
    };
    const hud = document.querySelector('.hud.minehud');
    const now = meas(), two = hud.classList.contains('two');
    // CONTROL: the pre-M3 shape — every entry in ONE row (row 2's entries and the rot clock moved into
    // row 1, as they were), then put back. (Just dropping `.two` is not a control: the rows then sit
    // side by side and wrap, which also fits.)
    // The M3 CSS goes too (`.minehud` caps the row and fixes the gear), and the gear goes back into
    // the row's own flow, after the resource pill, where it was.
    const row1 = document.querySelector('.minehud .hudtop .resrow'), r2 = document.getElementById('hudrow2');
    const gearEl = document.getElementById('gearbtn');
    const moved = [...r2.children, ic, gearEl].map((e) => ({ e, parent: e.parentNode, next: e.nextSibling }));
    for (const { e } of moved) if (e !== gearEl) row1.appendChild(e);
    row1.parentNode.appendChild(gearEl);
    hud.classList.remove('minehud', 'two');
    const q1 = row1.getBoundingClientRect(), gq = gearEl.getBoundingClientRect();
    const ctrl = { r1: { x0: q1.left, x1: q1.right, y0: q1.top, y1: q1.bottom }, gear: { x0: gq.left, x1: gq.right },
                   offScreen: q1.right > innerWidth + 0.5 || gq.right > innerWidth + 0.5,
                   clash: Math.min(q1.right, gq.right) > Math.max(q1.left, gq.left) && Math.min(q1.bottom, gq.bottom) > Math.max(q1.top, gq.top) };
    for (const { e, parent, next } of moved.reverse()) parent.insertBefore(e, next);
    hud.classList.add('minehud'); hud.classList.toggle('two', two);
    return { now, ctrl, two, worms: s.mineAttached | 0, tags: document.querySelectorAll('#matrow .matchip').length,
             wormChip: !document.getElementById('hud-worms').hidden };
  });
  const f = (r) => r ? `${Math.round(r.x0)}..${Math.round(r.x1)}` : '-';
  ok('the rows carry P, three material tags and the worm chip', m.tags === 3 && m.wormChip, `${m.tags} tags, ${m.worms} worm(s) attached`);
  ok('the rows are stacked', m.two === true);
  ok('the gear is on screen and a tap at its centre hits it', !!m.now.gear && m.now.gearHit && m.now.gear.x1 <= W, `gear ${f(m.now.gear)}`);
  ok('nothing runs off the screen and nothing overlaps (rows, banner, gear)', !m.now.offScreen && !m.now.clash,
     `row1 ${f(m.now.r1)}, row2 ${f(m.now.r2)}, banner ${f(m.now.bn)}, gear ${f(m.now.gear)}`);
  ok('control: in the old single row, the entries run into the gear or off the screen', m.ctrl.offScreen || m.ctrl.clash,
     `one row ${f(m.ctrl.r1)}, gear ${f(m.ctrl.gear)} (screen ${W})`);
  if (W === 390) await p.screenshot({ path: path.join(__dirname, '.artifacts', 'hudtop-mine-390.png'), animations: 'disabled', timeout: 8000 }).catch(() => {});
  await ctx.close();
}

await b.close(); srv.close();
console.log(`\n==== ${pass} passed, ${fail} failed ====`);
process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('HARNESS ERROR', e); process.exit(2); });
