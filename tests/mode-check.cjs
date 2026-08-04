/* Both games in one build: the title screen's entries, and each mode's core rules.
 *
 * Real time is no longer offered from the title screen (owner: "not this next release"), so TEST 1
 * asserts the door is shut and TEST 3 drives the variant through `#dev`, which is now its only way
 * in. The MODE itself is untouched — MODE_TUNING, setMode and every mode-gated rule are unchanged,
 * and everything TEST 3 asserts about real time still has to hold. */
const http = require('http'); const fs = require('fs'); const path = require('path');
const { chromium } = require('playwright');
const ROOT = path.resolve(__dirname, '..');   // the repo root — served as-is
const TYPES = { '.html':'text/html','.js':'text/javascript','.json':'application/json','.png':'image/png',
  '.jpg':'image/jpeg','.jpeg':'image/jpeg','.svg':'image/svg+xml','.webp':'image/webp','.mp3':'audio/mpeg','.wav':'audio/wav','.css':'text/css' };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let pass = 0, fail = 0;
const ok = (n, c, x) => { c ? (pass++, console.log('  PASS  ' + n + (x ? '  — ' + x : ''))) : (fail++, console.log('  FAIL  ' + n + (x ? '  — ' + x : ''))); };

(async () => {
  const srv = await new Promise((res) => { const s = http.createServer((rq, rs) => {
    let p = decodeURIComponent(rq.url.split('?')[0].split('#')[0]); if (p === '/') p = '/index.html';
    const fp = path.join(ROOT, p);
    if (!fp.startsWith(ROOT) || !fs.existsSync(fp) || fs.statSync(fp).isDirectory()) { rs.writeHead(404); rs.end('nf'); return; }
    rs.writeHead(200, { 'Content-Type': TYPES[path.extname(fp)] || 'application/octet-stream' });
    fs.createReadStream(fp).pipe(rs); }); s.listen(0, () => res(s)); });
  const base = 'http://localhost:' + srv.address().port;
  const browser = await chromium.launch({ headless: true });

  const openPage = async (hash) => {
    const page = await browser.newPage({ viewport: { width: 1280, height: 860 } });
    const errs = []; page.on('pageerror', (e) => errs.push(String(e && e.message)));
    page.on('console', (m) => { if (m.type() === 'error') errs.push('console:' + m.text()); });
    await page.goto(base + '/index.html' + hash, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('#loadscreen.ld-ready', { timeout: 20000 }).catch(() => {});
    await page.click('#loadscreen', { timeout: 5000 }).catch(() => {});
    return { page, errs };
  };
  const enterGame = async (page) => {
    await page.waitForFunction(() => window.__game && window.__game.state && window.__game.state.active, null, { timeout: 20000 });
    for (let i = 0; i < 4 && await page.$('#levelIntro'); i++) { await page.mouse.click(640, 400); await sleep(1200); }
  };

  // ---------------------------------------------------------------- TITLE SCREEN
  console.log('\nTEST 1 — the title screen offers both games');
  //
  // REAL TIME IS OFF THE TITLE SCREEN for this release (owner: "not this next release"), so the
  // Survival row is a single New/Old pair like the Campaign row and there is no three-column
  // split, no Turn-based / Real time kind labels and no tsNewRt / tsContRt. The VARIANT is
  // untouched — TEST 3 below still drives it, via #dev, which is now its only door. What is
  // asserted here is the shape of the two rows and that the withdrawn door stays shut.
  {
    const { page, errs } = await openPage('');
    await page.waitForSelector('#titleScreen .ts-top .ts-actions', { timeout: 20000 });
    const ids = await page.$$eval('#titleScreen .ts-top .ts-btn', (bs) => bs.map((b) => b.id));
    ok('the Survival row is one New/Old pair', ids.join(',') === 'tsNew,tsCont', ids.join(','));
    ok('real time is not offered from the title screen',
       (await page.$('#tsNewRt')) === null && (await page.$('#tsContRt')) === null);
    ok('nothing is left labelling a mode that has no button',
       (await page.$$('#titleScreen .ts-kind')).length === 0);
    const caps = await page.$$eval('#titleScreen .ts-top .ts-cap', (cs) => cs.map((c) => c.textContent));
    ok('every button keeps its caption', caps.join(' | ') === 'start a new game | continue last game', caps.join(' | '));

    // The two rows are the same control at the same size — that is what makes them read as two
    // entries in one menu rather than a main option and an afterthought.
    const sizes = await page.evaluate(() => {
      const btn = document.querySelector('#titleScreen .ts-top .ts-btn');
      const cap = document.querySelector('#titleScreen .ts-top .ts-cap');
      const camp = document.querySelector('#titleScreen .ts-bottom .ts-btn');
      return { btn: parseFloat(getComputedStyle(btn).fontSize), cap: parseFloat(getComputedStyle(cap).fontSize),
               camp: parseFloat(getComputedStyle(camp).fontSize) };
    });
    ok('New/Old stay at the small size (was 84px before the split)', sizes.btn > 26 && sizes.btn < 60, `${sizes.btn}px`);
    ok('captions match it', sizes.cap < 11, `${sizes.cap}px`);
    ok('the Campaign row is the same size', Math.abs(sizes.camp - sizes.btn) < 0.6, `${sizes.camp}px`);

    // Both rows clear of the title, and nothing runs off the screen.
    const geo = await page.evaluate(() => {
      const t = document.querySelector('#titleScreen .ts-top').getBoundingClientRect();
      const b = document.querySelector('#titleScreen .ts-bottom').getBoundingClientRect();
      return { t: { top: t.top, bottom: t.bottom, left: t.left, right: t.right }, b: { top: b.top, bottom: b.bottom },
               vw: innerWidth, vh: innerHeight };
    });
    ok('the Survival row sits above the Campaign row', geo.t.bottom < geo.b.top, `${Math.round(geo.t.bottom)} < ${Math.round(geo.b.top)}`);
    ok('both rows are on screen', geo.t.top > 0 && geo.b.bottom < geo.vh, `top=${Math.round(geo.t.top)} bottom=${Math.round(geo.b.bottom)} vh=${geo.vh}`);
    ok('the Survival row fits the width', geo.t.left >= 0 && geo.t.right <= geo.vw, `${Math.round(geo.t.left)}..${Math.round(geo.t.right)} of ${geo.vw}`);

    // HIGH SCORES top-centre, CREDITS bottom-centre (owner). They used to sit side by side at
    // the foot. Asserted as GEOMETRY, not as "the element exists": both are the same .ts-foot-btn
    // in the same kind of centred bar, so only where they land tells them apart — and the header
    // has to clear the Survival row, which starts ~180px down.
    const links = await page.evaluate(() => {
      const box = (s) => { const n = document.querySelector(s); if (!n) return null;
        const r = n.getBoundingClientRect(); return { top: r.top, bottom: r.bottom, mid: (r.left + r.right) / 2 }; };
      return { hs: box('#tsHighScores'), cr: box('#tsCredits'),
               rowTop: document.querySelector('#titleScreen .ts-top').getBoundingClientRect().top,
               vw: innerWidth, vh: innerHeight };
    });
    ok('High Scores sits at the TOP', !!links.hs && links.hs.top < links.vh * 0.15,
       links.hs ? `top ${Math.round(links.hs.top)} of ${links.vh}` : 'missing');
    ok('...centred', !!links.hs && Math.abs(links.hs.mid - links.vw / 2) < 2,
       links.hs ? `mid ${Math.round(links.hs.mid)} vs ${links.vw / 2}` : 'missing');
    ok('...and clear of the New/Old rows', !!links.hs && links.hs.bottom < links.rowTop,
       links.hs ? `${Math.round(links.hs.bottom)} < ${Math.round(links.rowTop)}` : 'missing');
    ok('Credits stays at the BOTTOM', !!links.cr && links.cr.bottom > links.vh * 0.9,
       links.cr ? `bottom ${Math.round(links.cr.bottom)} of ${links.vh}` : 'missing');
    ok('...centred too', !!links.cr && Math.abs(links.cr.mid - links.vw / 2) < 2,
       links.cr ? `mid ${Math.round(links.cr.mid)} vs ${links.vw / 2}` : 'missing');
    ok('they are no longer a pair (the dash between them is gone)',
       (await page.$$('#titleScreen .ts-foot-sep')).length === 0);

    ok('no page errors on the title screen', errs.length === 0, errs.slice(0, 2).join(' | '));
    await page.close();
  }
  {
    const { page } = await openPage('');
    await page.waitForSelector('#tsNew', { timeout: 20000 });
    await page.click('#tsNew');
    await page.waitForSelector('#tsNameStart', { timeout: 5000 });
    await page.click('#tsNameStart');
    await page.waitForFunction(() => document.getElementById('speciesSelect'), null, { timeout: 20000 });
    // Compared against MODE_TUNING itself, not against pinned numbers. This assertion used to
    // hard-code worm=3 ants=40 rot=6, so every balance retune broke it under a name describing
    // a retune from several sessions earlier. threat-check owns the absolute values; what
    // belongs HERE is that coming back from real time re-applies the TURN table, whatever it
    // currently says — and that the two tables genuinely differ, or the check is vacuous.
    const m2 = await page.evaluate(() => {
      const T = window.__modeTuning, C = window.__cfg;
      const read = (p) => p.split('.').reduce((o, k) => (o == null ? o : o[k]), C);
      const mism = [];
      for (const k in T.turn) if (read(k) !== T.turn[k]) mism.push(`${k}=${read(k)} want ${T.turn[k]}`);
      let differ = 0;
      for (const k in T.turn) if (T.turn[k] !== T.realtime[k]) differ++;
      return { mode: C.mode, rt: C.realtime.enabled, mism, differ, keys: Object.keys(T.turn).length,
               worm: C.nematodes.crawlSpeed, ants: C.ants.harvestRate,
               rot: C.trichoderma.spreadDepthPerTurn };
    });
    ok('turn-based "New" starts the turn-based game', m2.mode === 'turn' && m2.rt === false, JSON.stringify({ mode: m2.mode, rt: m2.rt }));
    ok('the two tuning tables actually differ (so the next assertion means something)',
       m2.differ >= 5, `${m2.differ} of ${m2.keys} keys differ between the modes`);
    ok('turn-based restores EVERY per-action value from MODE_TUNING.turn', m2.mism.length === 0,
       m2.mism.length ? m2.mism.join(', ') : `worm=${m2.worm} ants=${m2.ants} rot=${m2.rot}`);
    await page.close();
  }

  // ---------------------------------------------------------------- TURN-BASED
  console.log('\nTEST 2 — turn-based: the world moves only when the player acts');
  {
    const { page, errs } = await openPage('#dev,turn');
    await enterGame(page);
    const cfg = await page.evaluate(() => ({ mode: window.__game.state.config.mode, rt: window.__game.state.config.realtime.enabled }));
    ok('the run is turn-based', cfg.mode === 'turn' && cfg.rt === false, JSON.stringify(cfg));

    // Let a full second of wall clock pass: nothing may move.
    const before = await page.evaluate(() => {
      const s = window.__game.state;
      return { turn: s.turn, worms: (s.nematodes || []).map((w) => [w.x, w.y]),
               clouds: (s.clouds || []).map((c) => [c.cx, c.cy]),
               nutrient: s.substrate.cells.reduce((a, c) => a + (c.nutrient || 0), 0) };
    });
    await sleep(1600);
    const after = await page.evaluate(() => {
      const s = window.__game.state;
      return { worms: (s.nematodes || []).map((w) => [w.x, w.y]),
               clouds: (s.clouds || []).map((c) => [c.cx, c.cy]),
               nutrient: s.substrate.cells.reduce((a, c) => a + (c.nutrient || 0), 0) };
    });
    ok('worms hold still with no action played', JSON.stringify(before.worms) === JSON.stringify(after.worms),
       `${before.worms.length} worms`);
    ok('mould clouds hold still too', JSON.stringify(before.clouds) === JSON.stringify(after.clouds), `${before.clouds.length} clouds`);
    ok('no substrate is eaten while idle', Math.abs(before.nutrient - after.nutrient) < 1e-6,
       `${before.nutrient.toFixed(1)} → ${after.nutrient.toFixed(1)}`);

    // An ACTION advances the world exactly one step, and its growth lands at once.
    // The step is now PHASED: the action QUEUES it and the frame loop plays it out (wait for
    // the grow reveal → move → a ~2s slide → attack), so the counter moves when the step
    // lands, not when the action is taken. `settleEnemyTurn` is how a synchronous probe gets
    // the world it used to get for free. Both halves are asserted — that it was deferred, and
    // that deferring it still costs exactly one step.
    const stepped = await page.evaluate(() => {
      const g = window.__game, s = g.state, sub = s.substrate, net = s.active;
      s.active.water = 99; s.active.energy = 500;
      // Lay food just inside sensing range so "Grow" has somewhere to go.
      const nd = net.nodes[0];
      const c0 = sub.colAtX(nd.x), r0 = sub.rowAtY(nd.y);
      for (let c = c0 + 1; c <= c0 + 2; c++) for (let r = r0; r <= r0 + 1; r++) {
        if (!sub.inBounds(c, r)) continue;
        const cell = sub.cells[sub.index(c, r)];
        cell.rock = 0; cell.hazard = 0; cell.nutrient = 50; cell.maxNutrient = 50;
      }
      const t0 = s.turn, n0 = net.nodes.length;
      const r = g.performAction(s, 'grow', {});
      const queued = !!g.enemyTurn, tMid = s.turn, n1 = net.nodes.length;
      g.settleEnemyTurn();
      return { ok: !!(r && r.ok), msg: r && r.message, t0, tMid, queued, t1: s.turn, n0, n1 };
    });
    ok('a basic action still works', stepped.ok, stepped.msg);
    ok('the action QUEUES its world step rather than resolving it inline',
       stepped.queued === true && stepped.tMid === stepped.t0, `queued=${stepped.queued}, turn ${stepped.t0} → ${stepped.tMid}`);
    ok('the action advanced the world one turn', stepped.t1 === stepped.t0 + 1, `${stepped.t0} → ${stepped.t1}`);
    ok('the grow landed strands immediately (no arrival delay)', stepped.n1 > stepped.n0, `${stepped.n0} → ${stepped.n1}`);

    // The colony claims and then DRAINS a pile over turns (the original tempo), rather than
    // banking it whole the moment it grows in.
    const drip = await page.evaluate(() => {
      const g = window.__game, s = g.state, sub = s.substrate, net = s.active;
      // Plant a pile right beside the colony and grow into it.
      const nd = net.nodes[0];
      const col = sub.colAtX(nd.x) + 2, row = sub.rowAtY(nd.y);
      const idx = [];
      for (let c = col; c < col + 2; c++) for (let r = row; r < row + 2; r++) {
        if (!sub.inBounds(c, r)) continue;
        const i = sub.index(c, r), cell = sub.cells[i];
        cell.rock = 0; cell.hazard = 0; cell.nutrient = 50; cell.maxNutrient = 50; cell.colonized = 0;
        idx.push(i);
      }
      net.water = 99; net.energy = 500;
      const e0 = net.energy;
      net.colonizeReachablePiles(sub, s.rng);
      const claimed = idx.filter((i) => sub.cells[i].colonized >= 1).length;
      const left = idx.reduce((a, i) => a + sub.cells[i].nutrient, 0);
      const gained = net.energy - e0;
      return { claimed, of: idx.length, left, gained };
    });
    ok('claiming a pile does not instantly bank it', drip.claimed > 0 && drip.left > 0 && drip.gained === 0,
       `claimed ${drip.claimed}/${drip.of}, ${drip.left} nutrient left, +${drip.gained}⚡`);

    // Card cadences count in ROUNDS, and one action = one round.
    const cad = await page.evaluate(() => {
      const g = window.__game, s = g.state;
      s.cards.engines = [{ name: 'T', energy: 2, every: 3, _et: 0 }];
      s.cards.actions = [];
      s.cards._engTick = 0;
      s.active.energy = 100; s.active.water = 99;
      // Silence every other source of Energy so the only movement is the engine payout.
      for (const cell of s.substrate.cells) cell.nutrient = 0;
      s.clouds = []; s.nematodes = []; s.ants = [];
      const seen = [];
      for (let i = 0; i < 3; i++) {
        const e0 = s.active.energy;
        g.tickWorld(s);
        seen.push(+(s.active.energy - e0).toFixed(2));
      }
      return seen;
    });
    ok('an "every 3 rounds" engine pays on the 3rd action', cad[0] === 0 && cad[1] === 0 && cad[2] === 2, `[${cad.join(', ')}]`);

    const txt = await page.evaluate(() => window.__game.modeInfo());
    ok('card text stays in rounds when turn-based', /6 rounds/.test(txt.timeified) && txt.rounds === '4 rounds',
       `${txt.timeified} / ${txt.rounds}`);

    const skip = await page.evaluate(() => {
      const s = window.__game.state, t0 = s.turn;
      const chip = document.getElementById('skipchip');
      return { shown: !!chip && getComputedStyle(chip).display !== 'none', t0 };
    });
    ok('the Skip chip is available in turn-based', skip.shown, `display=${skip.shown}`);
    ok('no page errors in a turn-based run', errs.length === 0, errs.slice(0, 3).join(' | '));
    await page.close();
  }

  // ---------------------------------------------------------------- REAL TIME
  console.log('\nTEST 3 — real time: the world moves on the wall clock');
  {
    const { page, errs } = await openPage('#dev');
    await enterGame(page);
    const cfg = await page.evaluate(() => ({ mode: window.__game.state.config.mode, rt: window.__game.state.config.realtime.enabled }));
    ok('the run is real-time', cfg.mode === 'realtime' && cfg.rt === true, JSON.stringify(cfg));

    const t0 = await page.evaluate(() => window.__game.state.turn);
    await sleep(2200);
    const t1 = await page.evaluate(() => window.__game.state.turn);
    ok('the world ticks on its own', t1 - t0 >= 3, `${t0} → ${t1} in 2.2s`);

    const acted = await page.evaluate(() => {
      const g = window.__game, s = g.state;
      s.active.water = 99; s.active.energy = 500;
      const sub = s.substrate, net = s.active, nd = net.nodes[0];
      const c0 = sub.colAtX(nd.x), r0 = sub.rowAtY(nd.y);
      for (let c = c0 + 1; c <= c0 + 2; c++) for (let r = r0; r <= r0 + 1; r++) {
        if (!sub.inBounds(c, r)) continue;
        const cell = sub.cells[sub.index(c, r)];
        cell.rock = 0; cell.hazard = 0; cell.nutrient = 50; cell.maxNutrient = 50;
      }
      const t = s.turn;
      const r = g.performAction(s, 'grow', {});
      return { ok: !!(r && r.ok), msg: r && r.message, same: s.turn === t };
    });
    ok('an action does NOT advance the world itself', acted.ok && acted.same, JSON.stringify(acted));

    const rtTxt = await page.evaluate(() => window.__game.modeInfo());
    ok('card text reads in seconds in real time', /60s/.test(rtTxt.timeified) && rtTxt.rounds === '40s',
       `${rtTxt.timeified} / ${rtTxt.rounds}`);

    const chip = await page.evaluate(() => {
      const c = document.getElementById('skipchip');
      return !c ? 'missing' : getComputedStyle(c).display;
    });
    ok('the Skip chip is hidden in real time', chip === 'none' || chip === 'missing', chip);
    ok('no page errors in a real-time run', errs.length === 0, errs.slice(0, 3).join(' | '));
    await page.close();
  }

  console.log(`\n==== ${pass} passed, ${fail} failed ====`);
  await browser.close(); srv.close();
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('HARNESS ERROR', e); process.exit(2); });
