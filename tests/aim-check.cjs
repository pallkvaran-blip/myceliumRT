/* Focused check of the forgiving grow-aim radius, repeated several times in one page. */
const http = require('http'); const fs = require('fs'); const path = require('path');
const { chromium } = require('playwright');
const ROOT = path.resolve(__dirname, '..');   // the repo root — served as-is
const TYPES = { '.html':'text/html','.js':'text/javascript','.json':'application/json','.png':'image/png',
  '.jpg':'image/jpeg','.jpeg':'image/jpeg','.svg':'image/svg+xml','.webp':'image/webp','.mp3':'audio/mpeg','.wav':'audio/wav','.css':'text/css' };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  const srv = await new Promise((res) => { const s = http.createServer((rq, rs) => {
    let p = decodeURIComponent(rq.url.split('?')[0].split('#')[0]); if (p === '/') p = '/index.html';
    const fp = path.join(ROOT, p);
    if (!fp.startsWith(ROOT) || !fs.existsSync(fp) || fs.statSync(fp).isDirectory()) { rs.writeHead(404); rs.end('nf'); return; }
    rs.writeHead(200, { 'Content-Type': TYPES[path.extname(fp)] || 'application/octet-stream' });
    fs.createReadStream(fp).pipe(rs); }); s.listen(0, () => res(s)); });
  const base = 'http://localhost:' + srv.address().port;
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  const errs = [];
  page.on('pageerror', (e) => errs.push(String(e && e.message)));
  await page.goto(base + '/index.html#dev', { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#loadscreen.ld-ready', { timeout: 15000 }).catch(() => {});
  await page.click('#loadscreen', { timeout: 5000 }).catch(() => {});
  await page.waitForFunction(() => window.__game && window.__game.state && window.__game.state.active, null, { timeout: 15000 });
  // Dismiss the level intro if present.
  for (let i = 0; i < 3 && await page.$('#levelIntro'); i++) { await page.mouse.click(400, 300); await sleep(2000); }

  let pass = 0, fail = 0;
  const check = (n, c, x) => { c ? (pass++, console.log('  PASS  ' + n + (x ? '  — ' + x : ''))) : (fail++, console.log('  FAIL  ' + n + (x ? '  — ' + x : ''))); };

  // Press at a given screen offset from a freshly-placed strand; report the aim state.
  // The probe plays a real card each press, so the run can genuinely END mid-probe (a win, a
  // cleared level, the colony dying). Whatever screen follows — the species picker, the
  // "species unlocked" card, a level intro — covers the canvas and swallows the press. That's
  // the run finishing, not the aim rule breaking, so stop rather than report bogus failures.
  const overlaid = () => page.evaluate(() => {
    const o = document.querySelector('#speciesSelect,#levelIntro,#loadoutSelect,#titleScreen,'
      + '#ssSpeciesUnlocked,#ssLevelComplete,#ssGameWon,#hsOverlay,.ss-wrap,.lo-wrap');
    return o ? (o.id || o.className) : null;
  });

  const press = async (dx, dy) => {
    const setup = await page.evaluate(() => {
      const g = window.__game, st = g.state, net = st.active;
      st.runOver = false; st.winPending = false; st.won = false; net.alive = true;
      st.clouds = []; st.nematodes = []; st.cards.pendingOffers.length = 0;
      // Quiet the world for the probe: with food on the map, growth from an earlier press
      // colonises a pile mid-gesture, which queues a card DRAFT — and opening the draft panel
      // cancels aiming, so the press under test would fail for an unrelated reason.
      for (const cell of st.substrate.cells) { cell.nutrient = 0; cell.maxNutrient = 0; }
      st.ants = [];
      net.energy = 1e6; net.water = 999; net.phosphorus = 999;
      const px = Math.round(g.camera.viewW / 2), py = Math.round(g.camera.viewH * 0.45);
      const w = g.camera.screenToWorld(px, py);
      const nd = net.addNode(w.x, w.y, net.nodes[0]);
      nd._revSeen = true; nd._liveAt = 0; nd.infected = false;
      const armedOk = g.armAim('Apical Drive');
      const back = g.camera.worldToScreen(nd.x, nd.y);   // where that strand actually is on screen
      return { armedOk, px, py, bx: back.x, by: back.y,
               radius: Math.max(170, Math.min(420, 260 * g.camera.zoom)), zoom: g.camera.zoom };
    });
    await page.mouse.move(setup.px + dx, setup.py + dy);
    await page.mouse.down();
    await page.mouse.move(setup.px + dx + 70, setup.py + dy + 45);
    const st = await page.evaluate(([x, y]) => {
      const el = document.elementFromPoint(x, y);
      const s = window.__game.state;
      return Object.assign(window.__game.aimState(), {
        under: el ? (el.id || (el.tagName + '.' + el.className)) : 'none',
        over: !!s.runOver, won: !!s.won, offers: (s.cards.pendingOffers || []).length,
      });
    }, [setup.px + dx, setup.py + dy]);
    await page.mouse.up();
    return { setup, st };
  };

  let stopped = null;
  for (let round = 1; round <= 3 && !stopped; round++) {
    for (const label of ['on', 'near', 'edge']) {
      const o = await overlaid();
      if (o) { stopped = `${o} (round ${round}, before the "${label}" press)`; break; }
      if (label === 'on') var on = await press(0, 0);
      else if (label === 'near') var near = await press(120, 0);
      else var edge = await press(Math.round(on.setup.radius * 0.85), 0);
    }
    if (stopped) { console.log(`  [info] the run ended and ${stopped} covers the map — stopping here`); break; }
    check(`round ${round}: pressing ON a strand aims`, !!on.st.armed, `armedOk=${on.setup.armedOk} under=${on.st.under} over=${on.st.over} won=${on.st.won} offers=${on.st.offers}`);
    check(`round ${round}: pressing 120px off still aims`, !!near.st.armed, `radius=${Math.round(near.setup.radius)}px under=${near.st.under} over=${near.st.over} offers=${near.st.offers}`);
    check(`round ${round}: pressing just inside the radius aims`, !!edge.st.armed, `at ${Math.round(on.setup.radius * 0.85)}px of ${Math.round(on.setup.radius)}px under=${edge.st.under} over=${edge.st.over} offers=${edge.st.offers}`);
  }
  console.log(`\n==== ${pass} passed, ${fail} failed ====  pageerrors: ${errs.length ? errs.slice(0,2).join(' | ') : 'none'}`);
  await browser.close(); srv.close();
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('HARNESS ERROR', e); process.exit(2); });
