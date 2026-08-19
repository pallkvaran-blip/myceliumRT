/* Both games in one build: the title screen's entries, and each mode's core rules.
 *
 * TEST 1 owns the title screen's SHAPE — two rows again, campaign on top and survival below it,
 * Old on the left of each and New on the right (owner). Survival was withheld for one release and
 * is back; REAL TIME's door is still shut (owner: "not this next release"), which is why TEST 3
 * drives that variant through `#dev` instead. The MODE itself is untouched either way —
 * MODE_TUNING, setMode and every mode-gated rule are unchanged, and everything TEST 3 asserts
 * about real time still has to hold. */
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
  console.log('\nTEST 1 — the title screen offers BOTH games, campaign on top');
  //
  // SURVIVAL IS BACK (owner: "let's add survival back, but put that on the bottom half on the
  // title screen while the campaign sits on the top half. put the new buttons on the right and
  // the old buttons on the left"). It had been withheld for one release — "the retention rate is
  // too low. we may add it back sometime later, so lets keep that option" — and the option was
  // `OFFER_SURVIVAL` in __m_config, so coming back is that one constant.
  //
  // REAL TIME'S door is still shut (owner: "not this next release"), which is a SECOND constant
  // and the control for this block: the two flags are the same mechanism, so a screen that
  // brought survival back and real time with it would mean the two had been confused. TEST 3
  // below still drives the real-time variant via #dev.
  //
  // What is asserted here is the SHAPE — which game is which row, which word is which side, and
  // that the door real time was withheld by is still withheld.
  {
    const { page, errs } = await openPage('');
    await page.waitForSelector('#titleScreen .ts-top .ts-actions', { timeout: 20000 });
    const top = await page.$$eval('#titleScreen .ts-top .ts-btn', (bs) => bs.map((b) => b.id));
    const bot = await page.$$eval('#titleScreen .ts-bottom .ts-btn', (bs) => bs.map((b) => b.id));
    // DOM ORDER, which is what decides the columns — see .ts-actions in the stylesheet. The
    // geometric assertion below is the one that would catch a CSS change reversing them anyway;
    // this one says which pair belongs to which game.
    ok('the CAMPAIGN pair is the top row', top.join(',') === 'tsContCamp,tsNewCamp', top.join(',') || '(none)');
    ok('...and the SURVIVAL pair is the bottom row', bot.join(',') === 'tsCont,tsNew', bot.join(',') || '(none)');
    ok('real time is still not offered from the title screen',
       (await page.$('#tsNewRt')) === null && (await page.$('#tsContRt')) === null);
    // THREE games now, each with its own row and its own label, campaign on top. The Deep Mine's
    // row is APPENDED under the other two rather than swapped into either of them — the two that
    // straddle the wordmark had their gaps to its ink solved per side against the rendered canvas,
    // and a third game either goes outside that pair or re-opens all of it.
    const modes = await page.$$eval('#titleScreen .ts-mode', (ns) => ns.map((n) => n.textContent.trim()));
    ok('each row names its game, campaign first', modes.join(',') === 'Campaign,Survival,Deep Mine', modes.join(',') || '(none)');
    // THE MINE HAS A NEW AND NO OLD: a descent is one sitting (the run ends when the fuel does) and
    // what persists between them is the STORE, not a half-finished shaft.
    ok('the Deep Mine offers New and not Old',
       (await page.$('#tsNewMine')) !== null && (await page.$('#tsContMine')) === null);
    ok('nothing is left labelling a mode that has no button',
       (await page.$$('#titleScreen .ts-kind')).length === 0);
    // `.ts-soon` is the sub-line slot under a game's label — "Chapter 1" for the campaign, "dig
    // down" for the mine. Asserted as the PAIR, in row order, so a sub-line landing under the wrong
    // game (which is how "coming soon" used to sit under Campaign) still fails.
    const soon = await page.$$eval('#titleScreen .ts-soon', (ns) => ns.map((n) => n.textContent.trim()));
    ok('the sub-lines sit under their own games', soon.join(',') === 'Chapter 1,dig down', soon.join(',') || '(none)');
    const caps = await page.$$eval('#titleScreen .ts-cap', (cs) => cs.map((c) => c.textContent));
    ok('every button keeps its caption',
       caps.join(' | ') === 'continue last game | start a new game | continue last game | start a new game | start a new descent',
       caps.join(' | '));

    // OLD LEFT, NEW RIGHT, IN BOTH ROWS (owner) — measured, because the ids above only say what
    // order they were WRITTEN in and `.ts-actions` is a grid whose columns could be reassigned
    // from the stylesheet without touching the markup. Also that the two rows AGREE: New over New
    // and Old over Old is the whole point of the equal 1fr side columns.
    const side = await page.evaluate(() => {
      const mid = (s) => { const n = document.querySelector(s); if (!n) return null;
        const r = n.getBoundingClientRect(); return r.left + r.width / 2; };
      return { campOld: mid('#tsContCamp'), campNew: mid('#tsNewCamp'),
               survOld: mid('#tsCont'), survNew: mid('#tsNew'), vw: innerWidth };
    });
    ok('Campaign: Old is left of New', side.campOld < side.campNew,
       `Old ${Math.round(side.campOld)} < New ${Math.round(side.campNew)}`);
    ok('Survival: Old is left of New', side.survOld < side.survNew,
       `Old ${Math.round(side.survOld)} < New ${Math.round(side.survNew)}`);
    ok('...and the two rows line up with each other',
       Math.abs(side.campOld - side.survOld) < 40 && Math.abs(side.campNew - side.survNew) < 40,
       `Old ${Math.round(side.campOld)}/${Math.round(side.survOld)}, New ${Math.round(side.campNew)}/${Math.round(side.survNew)}`);

    // UNDER the word (owner), in EVERY row. The rule used to be `.ts-act.ts-solo` only, so
    // restoring the two-row screen would have silently put three of these four back above their
    // words — asserted on all four for exactly that reason.
    const capSide = await page.evaluate(() => [...document.querySelectorAll('#titleScreen .ts-act')].map((a) => {
      const b = a.querySelector('.ts-btn').getBoundingClientRect(), c = a.querySelector('.ts-cap').getBoundingClientRect();
      return Math.round((c.top + c.height / 2) - (b.top + b.height / 2));
    }));
    // DERIVED, not five: the count follows however many New/Old buttons the screen offers, so a
    // fourth game does not turn a correct screen into a red line. What is pinned is that EVERY one
    // of them is under its word — the rule was `.ts-act.ts-solo` only at one point, so restoring a
    // multi-row screen silently put most of them back above.
    const nAct = await page.$$eval('#titleScreen .ts-act', (as) => as.length);
    ok('every caption sits UNDER its word',
       capSide.length === nAct && nAct >= 5 && capSide.every((d) => d > 0), capSide.join(', ') + ' px below');

    // The two-row PAIR size, and the same on both rows. A band rather than a number (it is a
    // clamp() and a 1280-wide page lands mid-range); the floor that matters is ~26px, below which
    // the consume animation's strand step stalls — its first attractor lands inside the kill
    // radius and the word never grows.
    const sizes = await page.evaluate(() => {
      const f = (s) => parseFloat(getComputedStyle(document.querySelector(s)).fontSize);
      return { camp: f('#tsNewCamp'), surv: f('#tsNew'), cap: f('#titleScreen .ts-top .ts-cap') };
    });
    ok('the words are big enough for the consume animation', sizes.camp > 26 && sizes.camp <= 52, `${sizes.camp}px`);
    ok('both rows are set at the same size', Math.abs(sizes.camp - sizes.surv) < 0.6, `${sizes.surv}px`);
    ok('captions stay quiet beside them', sizes.cap <= 9, `${sizes.cap}px`);

    // Campaign above Survival, and nothing running off the screen.
    const geo = await page.evaluate(() => {
      const t = document.querySelector('#titleScreen .ts-top').getBoundingClientRect();
      const b = document.querySelector('#titleScreen .ts-bottom').getBoundingClientRect();
      return { t: { top: t.top, bottom: t.bottom, left: t.left, right: t.right }, b: { top: b.top, bottom: b.bottom },
               vw: innerWidth, vh: innerHeight };
    });
    ok('Campaign sits above Survival', geo.t.bottom < geo.b.top, `${Math.round(geo.t.bottom)} < ${Math.round(geo.b.top)}`);

    // EQUIDISTANT FROM THE INK, NOT FROM `titleY` (owner: "the top of the old and the bottom of
    // the 'start a new game' should be roughly equally distance from the title"). `seedTitle`
    // draws with `textBaseline: 'middle'`, which centres the EM box — and MYCELIUM is all caps and
    // uses none of the descender space, so a symmetric half-height reserved ~45px of empty air
    // under the letters and the gap below read nearly twice the gap above (63 vs 122 at 1400x900).
    //
    // Measured off the CANVAS, which is the only place the answer lives — the wordmark is drawn,
    // not laid out, so no DOM box describes it. Polled until three reads agree, because the
    // letters grow in and a snapshot mid-bloom measures a silhouette that is still arriving.
    const sym = await page.evaluate(async () => {
      const inkRows = () => {
        const c = document.getElementById('tsCanvas'), cx = c.getContext('2d');
        const dpr = c.width / c.getBoundingClientRect().width;
        const d = cx.getImageData(0, 0, c.width, c.height).data;
        let top = -1, bot = -1;
        for (let y = 0; y < c.height; y++) {
          let hit = false;
          for (let x = 0; x < c.width; x += 3) { const i = (y * c.width + x) * 4; if (d[i + 3] > 40 && d[i] > 120) { hit = true; break; } }
          if (hit) { if (top < 0) top = y; bot = y; }
        }
        return { top: Math.round(top / dpr), bot: Math.round(bot / dpr) };
      };
      let last = null, agree = 0, r = null;
      for (let i = 0; i < 60; i++) {
        await new Promise((res) => setTimeout(res, 400));
        r = inkRows();
        if (last && Math.abs(r.top - last.top) <= 2 && Math.abs(r.bot - last.bot) <= 2) { if (++agree >= 2) break; }
        else agree = 0;
        last = r;
      }
      // THE ROWS' OWN BOXES, not one button inside them, because which element is nearest the
      // wordmark depends on where the caption sits — and the caption has now moved to the far
      // side of its word once already. A row's rect ends at its last IN-FLOW child, so "Chapter
      // 1" (absolute) is excluded here exactly as it is from the `offsetHeight` positionMenu
      // places the row by; it lands level with the captions beside it.
      const b = (s) => { const n = document.querySelector(s); const q = n.getBoundingClientRect(); return { t: q.top, b: q.bottom }; };
      return { ink: r, top: b('#titleScreen .ts-top'), bot: b('#titleScreen .ts-bottom'), settled: agree >= 2 };
    });
    const above = Math.round(sym.ink.top - sym.top.b);
    const below = Math.round(sym.bot.t - sym.ink.bot);
    ok('the wordmark was measured, not guessed at mid-bloom', sym.settled && sym.ink.bot > sym.ink.top,
       `ink ${sym.ink.top}..${sym.ink.bot}${sym.settled ? '' : ' (never settled)'}`);
    // A generous tolerance on purpose: the fringe tendrils are random, so the silhouette differs
    // by ~10px between boots of the same build. It still fails the symmetric model, which was out
    // by 59px in the same measurement.
    ok('...and the two rows are the same distance from it',
       above > 0 && below > 0 && Math.abs(above - below) <= Math.max(20, 0.2 * Math.max(above, below)),
       `${above}px above, ${below}px below`);
    ok('both are on screen', geo.t.top > 0 && geo.b.bottom < geo.vh, `top=${Math.round(geo.t.top)} bottom=${Math.round(geo.b.bottom)} vh=${geo.vh}`);
    ok('the Campaign row fits the width', geo.t.left >= 0 && geo.t.right <= geo.vw, `${Math.round(geo.t.left)}..${Math.round(geo.t.right)} of ${geo.vw}`);

    // HIGH SCORES COMES BACK WITH SURVIVAL, and that coupling is the point rather than a
    // side-effect: the board ranks how DEEP a run got and `checkHighScore` is gated on
    // `!isCampaignGame()`, so with survival withheld nothing could ever file a score and the link
    // opened an empty ladder ("remove the high scores as that is not relevant anymore"). Both
    // read the one `OFFER_SURVIVAL` for that reason, and asserting the link HERE is what stops
    // them drifting apart. CREDITS at the foot is the control — "the link is there" would also
    // pass on a screen that had grown a second footer.
    const links = await page.evaluate(() => {
      const box = (s) => { const n = document.querySelector(s); if (!n) return null;
        const r = n.getBoundingClientRect(); return { top: r.top, bottom: r.bottom, mid: (r.left + r.right) / 2 }; };
      return { hs: box('#tsHighScores'), cr: box('#tsCredits'), header: !!document.querySelector('#titleScreen .ts-header'),
               vw: innerWidth, vh: innerHeight };
    });
    ok('High Scores is back, at the TOP', !!links.hs && !!links.header && links.hs.top < links.vh * 0.1,
       links.hs ? `top ${Math.round(links.hs.top)} of ${links.vh}` : 'missing');
    ok('...centred', !!links.hs && Math.abs(links.hs.mid - links.vw / 2) < 2,
       links.hs ? `mid ${Math.round(links.hs.mid)} vs ${links.vw / 2}` : 'missing');
    ok('Credits stays at the BOTTOM', !!links.cr && links.cr.bottom > links.vh * 0.9,
       links.cr ? `bottom ${Math.round(links.cr.bottom)} of ${links.vh}` : 'missing');
    ok('...centred', !!links.cr && Math.abs(links.cr.mid - links.vw / 2) < 2,
       links.cr ? `mid ${Math.round(links.cr.mid)} vs ${links.vw / 2}` : 'missing');
    ok('they are no longer a pair (the dash between them is gone)',
       (await page.$$('#titleScreen .ts-foot-sep')).length === 0);

    ok('no page errors on the title screen', errs.length === 0, errs.slice(0, 2).join(' | '));
    await page.close();
  }
  {
    const { page } = await openPage('');
    await page.waitForSelector('#tsNewCamp', { timeout: 20000 });
    await page.click('#tsNewCamp');
    await page.waitForSelector('#tsNameStart', { timeout: 5000 });
    await page.click('#tsNameStart');
    // THE CAMPAIGN OPENING SITS BETWEEN NEW AND THE PICKER (survival never had it), so this block
    // has one more screen to get through than it did when it entered by the Survival row. Clicked
    // away rather than removed: it owns the handover to `showPicker`, and deleting the node would
    // leave nothing to hand over.
    for (let i = 0; i < 20 && !(await page.$('#speciesSelect')); i++) {
      await page.evaluate(() => { const st = document.querySelector('.li-story'); if (st) st.click(); });
      await new Promise((r) => setTimeout(r, 400));
    }
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
