/* Turn-based smoke test: a whole run, played to a win, driven purely by actions. */
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
  const page = await browser.newPage({ viewport: { width: 1280, height: 860 } });
  const errs = []; page.on('pageerror', (e) => errs.push(String(e && e.message)));
  page.on('console', (m) => { if (m.type() === 'error') errs.push('console:' + m.text()); });
  await page.goto(base + '/index.html#dev,turn', { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#loadscreen.ld-ready', { timeout: 20000 }).catch(() => {});
  await page.click('#loadscreen', { timeout: 5000 }).catch(() => {});
  await page.waitForFunction(() => window.__game && window.__game.state && window.__game.state.active, null, { timeout: 20000 });
  for (let i = 0; i < 4 && await page.$('#levelIntro'); i++) { await page.mouse.click(640, 400); await sleep(1200); }

  // A card draft freezes nothing in turn-based (there is no clock), but it must still be
  // possible to draw, be offered cards, and pick one.
  const drew = await page.evaluate(() => {
    const g = window.__game, s = g.state;
    s.active.energy = 300;
    const h0 = s.cards.hand.length;
    const r = g.draw();
    return { h0, h1: s.cards.hand.length, offers: (s.cards.pendingOffers || []).length };
  });
  ok('drawing works in turn-based', drew.h1 > drew.h0 || drew.offers > 0, JSON.stringify(drew));

  // A long scripted session: every action must advance the world exactly ONE step (the
  // defining turn-based property), and the run must stay coherent throughout.
  const session = await page.evaluate(() => {
    const g = window.__game, s = g.state, sub = s.substrate, net = s.active;
    // CLEAR THE THREATS FIRST. This probe is about the ACTION LOOP — one world step per play,
    // 30+ plays, most of them growing — and not about surviving level 1. With them in, the run
    // occasionally ended inside the loop (`over: true, alive: false` at ~25 acts) and the check
    // failed on a map roll rather than on a regression; it fired in two consecutive sweeps and
    // ~1 run in 3 standalone, which is loud enough to hide a real break. Respawns are off too,
    // or the ones that arrive mid-loop put the flake straight back.
    s.nematodes.length = 0; s.clouds.length = 0; s.ants.length = 0;
    if (s.config.nematodes) s.config.nematodes.respawnChance = 0;
    if (s.config.trichoderma) { s.config.trichoderma.respawnChance = 0; s.config.trichoderma.spreadChance = 0; }
    if (s.config.ants) s.config.ants.respawnChance = 0;
    let acts = 0, offBy = 0, grew = 0;
    for (let k = 0; k < 120 && !s.runOver; k++) {
      net.energy = Math.max(net.energy, 300); net.water = 99; net.phosphorus = 99;
      const fp = net.frontierPoint(); if (!fp) break;
      const tcol = Math.min(sub.cols - 1, sub.colAtX(fp.x) + 3);
      let tr = -1;
      for (let r = 0; r < sub.rows; r++) { const c = sub.cellAt(tcol, r); if (c && !c.rock && !c.water) { tr = r; break; } }
      const target = tr >= 0 ? sub.cellCenter(tcol, tr) : { x: fp.x + 100, y: fp.y };
      let idx = s.cards.hand.findIndex((h) => h.name === 'Rhizomorph Lance');
      if (idx < 0) { s.cards.hand.push({ id: s.cards.seq++, name: 'Rhizomorph Lance' }); idx = s.cards.hand.length - 1; }
      const t0 = s.turn, n0 = net.nodes.length;
      g.play(idx, { x: target.x, y: target.y });   // (the debug hook returns nothing — read the state)
      if (s.turn === t0) continue;                  // the play was blocked; nothing happened
      acts++;
      if (s.turn !== t0 + 1) offBy++;               // ONE step per action, never more
      if (net.nodes.length > n0) grew++;
      // A pile draft freezes the game until it's picked — take the first offer and carry on.
      // `choices`, NOT `cards`: an offer is { choices: [name, ...], kind }, so `off.cards[0]`
      // was always undefined and the draft was never actually taken. (CLAUDE.md lists this
      // exact trap.) A pending offer blocks further plays, so on a map where a pile finished
      // early the session stalled with every later play refused.
      const off = s.cards.pendingOffers && s.cards.pendingOffers[0];
      const pick = off && off.choices && off.choices[0];
      if (pick) g.chooseCard(pick.name || pick);
    }
    return { acts, offBy, grew, turn: s.turn, over: !!s.runOver, alive: !!net.alive, nodes: net.nodes.length };
  });
  ok('a long turn-based session plays out', session.acts >= 30, JSON.stringify(session));
  ok('EVERY action advances the world exactly one step', session.offBy === 0, `${session.offBy} of ${session.acts} were off`);
  ok('the colony actually grew', session.grew > session.acts * 0.5, `${session.grew}/${session.acts} plays added strands`);
  ok('no page errors across a long turn-based session', errs.length === 0, errs.slice(0, 3).join(' | '));

  console.log(`\n==== ${pass} passed, ${fail} failed ====`);
  await browser.close(); srv.close();
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('HARNESS ERROR', e); process.exit(2); });
