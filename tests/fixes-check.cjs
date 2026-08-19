/* The four follow-up fixes: shared surface-only win, no free grow when the tutorial ends,
   SURVIVAL on the New/Old line, and dots for turn-based / bars for real time. */
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
  const open = async (hash, vp) => {
    const page = await browser.newPage({ viewport: vp || { width: 1280, height: 860 } });
    const errs = []; page.on('pageerror', (e) => errs.push(String(e && e.message)));
    page.on('console', (m) => { if (m.type() === 'error') errs.push('console:' + m.text()); });
    await page.goto(base + '/index.html' + hash, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('#loadscreen.ld-ready', { timeout: 20000 }).catch(() => {});
    await page.click('#loadscreen', { timeout: 5000 }).catch(() => {});
    return { page, errs };
  };
  const enter = async (page) => {
    await page.waitForFunction(() => window.__game && window.__game.state && window.__game.state.active, null, { timeout: 20000 });
    for (let i = 0; i < 4 && await page.$('#levelIntro'); i++) { await page.mouse.click(640, 400); await sleep(1200); }
  };

  // ---- 1) The win needs the SURFACE in both modes ---------------------------
  // Plant a strand deep inside the goal column: within the Fruit action's forgiving
  // reachDepth but nowhere near the soil line. Neither mode may win off that.
  console.log('\n1 — fruiting needs the actual surface, in both modes');
  for (const [hash, label] of [['#dev,turn', 'turn-based'], ['#dev', 'real time']]) {
    const { page, errs } = await open(hash);
    await enter(page);
    const r = await page.evaluate(() => {
      const g = window.__game, s = g.state, sub = s.substrate, net = s.active;
      s.runOver = false; s.winPending = false; s.won = false; net.alive = true;
      s.clouds = []; s.nematodes = []; s.ants = []; s.cards.pendingOffers.length = 0;
      net.energy = 1e6; net.water = 999;
      for (const n of net.nodes) n.infected = false;
      // AND KEEP THE MOULD OUT OF IT. Emptying `clouds` once is not enough: a tickWorld can
      // RESPAWN one, and checkGoalReached runs infectStrandsInMould before it tests the surface,
      // so a cloud that happens to seed near the goal infects the very strand this is about and
      // the win never fires. That is the mould rule doing its job, not the surface rule failing —
      // but it reads as `won=false`, which is indistinguishable from the bug this probe exists to
      // catch. Seen once in about ten runs before this.
      s.config.trichoderma.respawnChance = 0;
      s.config.nematodes.respawnChance = 0;
      for (const c of sub.cells) c.trich = 0;
      // Find a goal column.
      let gx = null;
      for (let c = sub.cols - 1; c >= 0; c--) {
        const ctr = sub.cellCenter(c, 2), col = sub.surfaceColumnAtX(ctr.x);
        if (col && col.goal) { gx = ctr.x; break; }
      }
      if (gx == null) return { skip: 'no goal column' };
      const reachDepth = s.config.actions.fruit.reachDepth;
      const goalDepth = s.config.cards.goalSurfaceDepth;
      // DEEP: well inside reachDepth, far below the surface band.
      const deep = net.addNode(gx, sub.surfaceY + Math.min(reachDepth - 4, 120), net.nodes[0]);
      deep._revSeen = true; deep._liveAt = 0; deep.infected = false;
      g.tickWorld(s);
      const deepWon = !!s.won;
      // AT the surface.
      s.won = false; s.runOver = false; net.alive = true;
      s.clouds = []; s.nematodes = [];
      for (const c of sub.cells) c.trich = 0;
      const top = net.addNode(gx, sub.surfaceY + 4, net.nodes[0]);
      top._revSeen = true; top._liveAt = 0; top.infected = false;
      g.tickWorld(s);
      // Everything that can swallow a win, reported — so a future failure says WHY instead of
      // leaving the next reader to re-derive it from `won=false`.
      return { reachDepth, goalDepth, deepDepth: deep.y - sub.surfaceY, deepWon, surfWon: !!s.won,
               topInfected: !!top.infected, topGone: !net.byId.has(top.id),
               winPending: !!s.winPending, runOver: !!s.runOver, alive: !!net.alive,
               clouds: s.clouds.length, trich: sub.cells.reduce((a2, c) => a2 + c.trich, 0) };
    });
    if (r.skip) { ok(`${label}: surface rule`, true, `SKIP (${r.skip})`); }
    else {
      ok(`${label}: a strand deep in the goal does NOT win`, r.deepWon === false,
         `depth ${Math.round(r.deepDepth)} (goal limit ${r.goalDepth}, fruit reach ${r.reachDepth}) → won=${r.deepWon}`);
      ok(`${label}: touching the surface DOES win`, r.surfWon === true,
         `won=${r.surfWon}` + (r.surfWon ? '' : ` — topInfected=${r.topInfected}, topGone=${r.topGone}, ` +
          `winPending=${r.winPending}, runOver=${r.runOver}, alive=${r.alive}, ` +
          `${r.clouds} cloud(s), trich ${Math.round(r.trich * 100) / 100}`));
    }
    ok(`${label}: no page errors`, errs.length === 0, errs.slice(0, 2).join(' | '));
    await page.close();
  }

  // ---- 2) Ending the tutorial must not grow anything ------------------------
  console.log('\n2 — ending the tutorial does not grow the colony into a pile');
  {
    const { page, errs } = await open('#dev');
    await enter(page);
    const r = await page.evaluate(async () => {
      const g = window.__game, s = g.state, sub = s.substrate, net = s.active;
      s.clouds = []; s.nematodes = []; s.ants = []; s.cards.pendingOffers.length = 0;
      s.runOver = false; s.won = false; net.alive = true; net.energy = 500; net.water = 99;
      // A pile sitting well inside sensing range but NOT grown into — exactly the tutorial's
      // duff pile beside the starting colony.
      const nd = net.nodes[0];
      const c0 = sub.colAtX(nd.x), r0 = sub.rowAtY(nd.y);
      const pile = [];
      for (let c = c0 + 2; c <= c0 + 3; c++) for (let r = r0; r <= r0 + 1; r++) {
        if (!sub.inBounds(c, r)) continue;
        const i = sub.index(c, r), cell = sub.cells[i];
        cell.rock = 0; cell.hazard = 0; cell.nutrient = 50; cell.maxNutrient = 50; cell.colonized = 0;
        pile.push(i);
      }
      const n0 = net.nodes.length, e0 = net.energy;
      const food0 = pile.reduce((a, i) => a + sub.cells[i].nutrient, 0);
      // Let the clock run for several seconds with the player doing nothing at all.
      await new Promise((res) => setTimeout(res, 3000));
      return { n0, n1: net.nodes.length, e0, e1: net.energy,
               food0, food1: pile.reduce((a, i) => a + sub.cells[i].nutrient, 0),
               claimed: pile.filter((i) => sub.cells[i].colonized >= 1).length, of: pile.length,
               ticked: s.turn };
    });
    ok('an untouched pile in range is NOT claimed while idle', r.claimed === 0, `${r.claimed}/${r.of} cells claimed`);
    ok('...and NOT eaten', Math.abs(r.food1 - r.food0) < 1e-6, `${r.food0} → ${r.food1} nutrient`);
    ok('...and no strands grew on their own', r.n1 === r.n0, `${r.n0} → ${r.n1} strands`);
    ok('the world really was ticking during that', r.ticked > 2, `turn ${r.ticked}`);

    // But a real grow must STILL claim and consume the pile as its front arrives.
    const grew = await page.evaluate(async () => {
      const g = window.__game, s = g.state, sub = s.substrate, net = s.active;
      const nd = net.nodes[0];
      const c0 = sub.colAtX(nd.x), r0 = sub.rowAtY(nd.y);
      const pile = [];
      for (let c = c0 + 2; c <= c0 + 3; c++) for (let r = r0; r <= r0 + 1; r++) {
        if (!sub.inBounds(c, r)) continue;
        const i = sub.index(c, r), cell = sub.cells[i];
        cell.rock = 0; cell.hazard = 0; cell.nutrient = 50; cell.maxNutrient = 50; cell.colonized = 0;
        pile.push(i);
      }
      net.energy = 500; net.water = 99; net.phosphorus = 99;
      g.performAction(s, 'grow', {});                      // a grow the player actually played
      await new Promise((res) => setTimeout(res, 3000));   // let the front arrive
      return { claimed: pile.filter((i) => sub.cells[i].colonized >= 1).length, of: pile.length,
               food: pile.reduce((a, i) => a + sub.cells[i].nutrient, 0) };
    });
    ok('a grow the player DID play still claims the pile', grew.claimed > 0, `${grew.claimed}/${grew.of} cells claimed`);
    ok('...and banks it as the front arrives', grew.food === 0, `${grew.food} nutrient left`);
    ok('no page errors', errs.length === 0, errs.slice(0, 2).join(' | '));
    await page.close();
  }

  {
    // A FRESH page: the probes above leave the colony sprawling, and a pile within sensing
    // range of tissue that has ALREADY grown in gets claimed at play time — which would
    // hide what this is actually testing.
    const { page, errs } = await open('#dev');
    await enter(page);
    // Growth that ARRIVES while the clock is frozen (a draft) must still land once time
    // resumes. The reveal runs on the raw frame clock, so by the time the player picks a card
    // the front has long since "arrived" — the sim has to notice it anyway. Set up a strand
    // that is still on its way, beside a fresh pile, then freeze right past its arrival.
    const paused = await page.evaluate(async () => {
      const g = window.__game, s = g.state, sub = s.substrate, net = s.active;
      s.cards.pendingOffers.length = 0;
      s.runOver = false; s.won = false; s.winPending = false; net.alive = true;
      s.clouds = []; s.nematodes = []; s.ants = [];
      net.energy = 1e6; net.water = 999;
      const anchor = net.nodes[0];
      const c0 = sub.colAtX(anchor.x) + 3, r0 = sub.rowAtY(anchor.y);
      const pile = [];
      for (let c = c0; c <= c0 + 1; c++) for (let r = r0; r <= r0 + 1; r++) {
        if (!sub.inBounds(c, r)) continue;
        const i = sub.index(c, r), cell = sub.cells[i];
        cell.rock = 0; cell.hazard = 0; cell.nutrient = 50; cell.maxNutrient = 50; cell.colonized = 0;
        pile.push(i);
      }
      if (!pile.length) return { skip: 'no room for the pile' };
      // A strand right beside the pile that has NOT arrived yet — a grow still in flight.
      const edge = sub.cellCenter(c0 - 1, r0);
      const tip = net.addNode(edge.x, edge.y, anchor);
      tip.infected = false; tip._revSeen = true;
      tip._liveAt = (net._nowMs || 0) + 700;
      net._arriveUntil = tip._liveAt;
      net._colonizePending = true;
      s.winPending = true;                                   // freeze the sim the way a draft does
      await new Promise((res) => setTimeout(res, 2500));      // ...right past the arrival moment
      const frozen = pile.filter((i) => sub.cells[i].colonized >= 1).length;
      const arrived = (net._nowMs || 0) >= tip._liveAt;
      s.winPending = false;                                  // and let it go again
      await new Promise((res) => setTimeout(res, 1200));
      return { frozen, arrived, after: pile.filter((i) => sub.cells[i].colonized >= 1).length,
               of: pile.length, food: pile.reduce((a, i) => a + sub.cells[i].nutrient, 0) };
    });
    if (paused.skip) ok('a grow that arrives while frozen', true, `SKIP (${paused.skip})`);
    else {
      ok('nothing is claimed while the clock is frozen', paused.frozen === 0 && paused.arrived,
         `${paused.frozen}/${paused.of} cells, front already past its arrival: ${paused.arrived}`);
      ok('...but it lands the moment time resumes', paused.after === paused.of && paused.food === 0,
         `${paused.after}/${paused.of} cells claimed, ${paused.food} nutrient left`);
    }
    ok('no page errors', errs.length === 0, errs.slice(0, 2).join(' | '));
    await page.close();
  }

  // ---- 3) the mode label sits ON the New/Old line, and the caption under its word ----------
  // THIS ASSERTION'S SUBJECT HAS BEEN DELETED AND RESTORED, and the QUESTION survived every
  // rewrite of the markup. Originally: SURVIVAL floated above the New/Old line instead of sitting
  // on it, and the probe waited on `.ts-split` — a layout that stopped shipping when real time
  // came off the title screen, so it sat timing out on a selector for markup that had been
  // removed. Then survival was withheld too and there was no mode label left to centre on
  // anything, so only the caption half of it could be asked. Survival is back (OFFER_SURVIVAL),
  // so BOTH halves are live again, and neither is pinned to a selector that names a layout: the
  // label is found per row, and the captions are found per `.ts-act`.
  //
  // The caption half: it once floated ABOVE the button at `bottom:84%` of the button's own box — a
  // percentage chosen so its baseline tucked against the CAP TOPS and tracked the font across the
  // clamp range. The owner moved it UNDER the word, where that trick has no equivalent (the box
  // carries descender space the caps never use, so any `top:%` right at 64px is wrong at 34px), so
  // `.ts-act` lays it out in FLOW with `column-reverse` — button first, caption after, a real gap
  // and no number to re-tune. That rule was `.ts-act.ts-solo` while there was one game, so
  // restoring the two-row screen is exactly the change that could have put three of these four
  // captions back above their words.
  console.log('\n3 — the mode labels sit on the New/Old line, captions under their words');
  {
    const { page, errs } = await open('', { width: 1440, height: 900 });
    await page.waitForSelector('#titleScreen .ts-top .ts-actions', { timeout: 20000 });
    const geo = await page.evaluate(() => {
      const box = (el) => { const r = el.getBoundingClientRect(); return { top: r.top, bottom: r.bottom, mid: r.top + r.height / 2 }; };
      const row = (sel) => {
        const r = document.querySelector(sel);
        const btns = [...r.querySelectorAll('.ts-btn')], lab = r.querySelector('.ts-mode');
        return { n: btns.length, label: lab ? lab.textContent.trim() : null,
                 labMid: lab ? box(lab).mid : null, btnMid: btns.length ? box(btns[0]).mid : null };
      };
      const acts = [...document.querySelectorAll('#titleScreen .ts-act')].map((a) => ({
        btn: box(a.querySelector('.ts-btn')), cap: box(a.querySelector('.ts-cap')),
        size: parseFloat(getComputedStyle(a.querySelector('.ts-btn')).fontSize),
      }));
      // THE DEEP MINE'S ROW is a third block under the other two, and it is a New with no Old —
      // a descent is one sitting, and what persists between them is the store. Its label has to sit
      // on the same line as its word like every other row's, which is the rule this block owns.
      return { top: row('#titleScreen .ts-top'), bot: row('#titleScreen .ts-bottom'),
               third: document.querySelector('#titleScreen .ts-third') ? row('#titleScreen .ts-third') : null,
               acts };
    });
    for (const r of [geo.top, geo.bot]) {
      ok(`the ${r.label} row is a New/Old pair`, r.n === 2, `${r.n} button(s)`);
      // ON the line, not floating above it. A few px of tolerance: the label and the words are
      // different sizes, so their optical centres never agree exactly.
      ok(`...with ${r.label} centred on it`, r.labMid != null && Math.abs(r.labMid - r.btnMid) <= 6,
         r.labMid == null ? '(no label)' : `label ${Math.round(r.labMid)} vs words ${Math.round(r.btnMid)}`);
    }
    if (geo.third) {
      ok('the Deep Mine row is a New on its own', geo.third.n === 1, `${geo.third.n} button(s)`);
      ok('...with Deep Mine centred on it',
         geo.third.labMid != null && Math.abs(geo.third.labMid - geo.third.btnMid) <= 6,
         geo.third.labMid == null ? '(no label)' : `label ${Math.round(geo.third.labMid)} vs word ${Math.round(geo.third.btnMid)}`);
    }
    // FIVE with three games, and DERIVED so a fourth does not turn a correct screen red. What is
    // pinned is that every word has one and every one of them reads as its subtitle.
    const wantCaps = 2 + 2 + (geo.third ? geo.third.n : 0);
    ok('every word carries a caption', geo.acts.length === wantCaps, `${geo.acts.length} of ${wantCaps}`);
    ok('...and every one of them is below its word', geo.acts.every((a) => a.cap.mid > a.btn.mid),
       geo.acts.map((a) => Math.round(a.cap.mid - a.btn.mid)).join(', ') + ' px');
    // CLOSE, not merely below: the caption belongs to that word and has to read as its subtitle
    // rather than as a line of its own. A generous bound rather than a pixel, since both are
    // clamp()d — but it fails an absolutely-positioned caption, which lands on top of the glyphs
    // or well clear of them depending on the size.
    ok('...close enough to read as a subtitle',
       geo.acts.every((a) => (a.cap.top - a.btn.bottom) < a.size * 0.35 && a.cap.top >= a.btn.bottom - 1),
       geo.acts.map((a) => `${Math.round(a.cap.top - a.btn.bottom)}px@${a.size}`).join(', '));
    ok('no page errors', errs.length === 0, errs.slice(0, 2).join(' | '));
    await page.close();
  }

  // ---- 4) Dots for turn-based, bars for real time ---------------------------
  console.log('\n4 — cadence dots in turn-based, time bars in real time');
  for (const [hash, label, wantDots] of [['#dev,turn', 'turn-based', true], ['#dev', 'real time', false]]) {
    const { page, errs } = await open(hash);
    await enter(page);
    // Install a cadenced producer so a meter is drawn, and open the ledger pill.
    await page.evaluate(() => {
      const g = window.__game, s = g.state;
      s.cards.engines = [{ name: 'Aquaporin Bloom', water: 1, every: 4, _et: 0 }];
      s.cards.actions = [];
      s.active.energy = 1e6;
      // Turn-based only refreshes the HUD when the world ticks — i.e. when the player acts —
      // so drive one real action rather than calling tickWorld directly.
      g.draw();
      g.tickWorld(s);
    });
    await sleep(900);
    const led = await page.$('#ledger');
    if (led) await page.evaluate(() => { const l = document.getElementById('ledger'); if (l) l.classList.remove('hidden'); });
    await sleep(700);
    const meters = await page.evaluate(() => ({
      dots: document.querySelectorAll('.ecad.cad .clight').length,
      lit: document.querySelectorAll('.ecad.cad .clight.on').length,
      bars: document.querySelectorAll('.ecad.cad .cbar').length,
    }));
    if (wantDots) {
      ok(`${label}: draws DOTS`, meters.dots > 0, `${meters.dots} dot(s), ${meters.lit} lit`);
      ok(`${label}: no time bars`, meters.bars === 0, `${meters.bars} bar(s)`);
    } else {
      ok(`${label}: draws a time BAR`, meters.bars > 0, `${meters.bars} bar(s)`);
      ok(`${label}: no dots`, meters.dots === 0, `${meters.dots} dot(s)`);
    }
    ok(`${label}: no page errors`, errs.length === 0, errs.slice(0, 2).join(' | '));
    await page.close();
  }

  console.log(`\n==== ${pass} passed, ${fail} failed ====`);
  await browser.close(); srv.close();
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('HARNESS ERROR', e); process.exit(2); });
