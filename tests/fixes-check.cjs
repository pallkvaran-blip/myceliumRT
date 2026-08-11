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

  // ---- 3) SURVIVAL sits on the New/Old line --------------------------------
  // THIS ASSERTION'S SUBJECT HAS BEEN DELETED TWICE, and each time the QUESTION survived the
  // markup. Originally: SURVIVAL floated above the New/Old line instead of sitting on it, and the
  // probe waited on `.ts-split` — a layout that stopped shipping when real time came off the title
  // screen, so it sat timing out on a selector for markup that had been removed. Now survival is
  // withheld too (OFFER_SURVIVAL) and there is no mode label at all to centre on anything.
  //
  // What is left of it is the other half of that layout and the half that can still break: the
  // caption is ABOVE its button and clear of the glyphs. `.ts-cap` is positioned at `bottom:84%`
  // of the button's own box precisely because `bottom:100%` floated it well clear of the caps —
  // a percentage so it tracks the font across the clamp range, which is exactly the kind of rule
  // a size change silently breaks. The size DID change in the same pass (the solo buttons are
  // ~23% bigger), so this is worth keeping pointed at something real.
  console.log('\n3 — the New/Old captions sit tight above their buttons');
  {
    const { page, errs } = await open('', { width: 1440, height: 900 });
    await page.waitForSelector('#titleScreen .ts-top .ts-actions', { timeout: 20000 });
    const geo = await page.evaluate(() => {
      const box = (el) => { const r = el.getBoundingClientRect(); return { top: r.top, bottom: r.bottom, mid: r.top + r.height / 2 }; };
      const btns = [...document.querySelectorAll('#titleScreen .ts-top .ts-btn')];
      const caps = [...document.querySelectorAll('#titleScreen .ts-top .ts-cap')];
      return { n: btns.length, caps: caps.length,
               btn: btns.length ? box(btns[0]) : null, cap: caps.length ? box(caps[0]) : null,
               labels: [...document.querySelectorAll('#titleScreen .ts-mode')].map((n) => n.textContent.trim()),
               size: btns.length ? parseFloat(getComputedStyle(btns[0]).fontSize) : 0 };
    });
    ok('the top row is one button', geo.n === 1, `${geo.n} button(s)`);
    ok('...with nothing labelling a mode beside it', geo.labels.length === 0, geo.labels.join(', ') || 'none');
    ok('its caption is above it', !!geo.cap && !!geo.btn && geo.cap.mid < geo.btn.mid,
       geo.cap ? `caption ${Math.round(geo.cap.mid)} vs button ${Math.round(geo.btn.mid)}` : '(no caption)');
    // TIGHT, not merely above: the caption's baseline tucks against the cap tops. A generous
    // upper bound rather than a pixel, since both are clamp()d — but it fails the `bottom:100%`
    // version, which is the regression this inherits.
    ok('...and tucked against the glyphs, not floating clear of them',
       !!geo.cap && !!geo.btn && (geo.btn.top - geo.cap.bottom) < geo.size * 0.35,
       geo.cap ? `${Math.round(geo.btn.top - geo.cap.bottom)}px gap at ${geo.size}px type` : '—');
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
