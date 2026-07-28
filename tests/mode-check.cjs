/* Both games in one build: the title screen's four buttons, and each mode's core rules. */
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
  {
    const { page, errs } = await openPage('');
    await page.waitForSelector('#titleScreen .ts-split', { timeout: 20000 });
    const ids = await page.$$eval('#titleScreen .ts-split .ts-btn', (bs) => bs.map((b) => b.id));
    ok('four New/Old buttons on the Survival row', ids.join(',') === 'tsNew,tsCont,tsNewRt,tsContRt', ids.join(','));
    const kinds = await page.$$eval('#titleScreen .ts-kind:not(.ts-kind-ghost)', (ks) => ks.map((k) => k.textContent));
    ok('left is turn-based, right is real time', kinds.join(' | ') === 'Turn-based | Real time', kinds.join(' | '));
    const caps = await page.$$eval('#titleScreen .ts-split .ts-cap', (cs) => cs.map((c) => c.textContent));
    ok('every button keeps its caption', caps.length === 4
      && caps.filter((c) => c === 'start a new game').length === 2
      && caps.filter((c) => c === 'continue last game').length === 2, caps.join(' | '));

    // Smaller than the old single-pair row (which was clamp(40px,7vw,84px) → 84px at this width).
    const sizes = await page.evaluate(() => {
      const btn = document.querySelector('#titleScreen .ts-split .ts-btn');
      const cap = document.querySelector('#titleScreen .ts-split .ts-cap');
      const loc = document.querySelector('#titleScreen .ts-bottom .ts-btn');
      return { btn: parseFloat(getComputedStyle(btn).fontSize), cap: parseFloat(getComputedStyle(cap).fontSize),
               locked: parseFloat(getComputedStyle(loc).fontSize) };
    });
    ok('New/Old are smaller than before (was 84px here)', sizes.btn > 26 && sizes.btn < 60, `${sizes.btn}px`);
    ok('captions shrank to match (was 11px)', sizes.cap < 11, `${sizes.cap}px`);
    ok('the locked Campaign row matches the new size', Math.abs(sizes.locked - sizes.btn) < 0.6, `${sizes.locked}px`);

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

    // Clicking a New opens the name dialog, and starting it sets THAT mode.
    await page.click('#tsNewRt');
    await page.waitForSelector('#tsNameStart', { timeout: 5000 });
    await page.click('#tsNameStart');
    await page.waitForFunction(() => document.getElementById('speciesSelect'), null, { timeout: 20000 });
    const m1 = await page.evaluate(() => ({ mode: window.__cfg.mode, rt: window.__cfg.realtime.enabled }));
    ok('real time "New" starts the real-time game', m1.mode === 'realtime' && m1.rt === true, JSON.stringify(m1));
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
    const m2 = await page.evaluate(() => ({
      mode: window.__cfg.mode, rt: window.__cfg.realtime.enabled,
      worm: window.__cfg.nematodes.crawlSpeed, ants: window.__cfg.ants.harvestRate,
      rot: window.__cfg.trichoderma.spreadDepthPerTurn,
    }));
    ok('turn-based "New" starts the turn-based game', m2.mode === 'turn' && m2.rt === false, JSON.stringify({ mode: m2.mode, rt: m2.rt }));
    ok('turn-based restores the original per-action tuning', m2.worm === 3 && m2.ants === 40 && m2.rot === 6,
       `worm=${m2.worm} ants=${m2.ants} rot=${m2.rot}`);
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
      return { ok: !!(r && r.ok), msg: r && r.message, t0, t1: s.turn, n0, n1: net.nodes.length };
    });
    ok('a basic action still works', stepped.ok, stepped.msg);
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
