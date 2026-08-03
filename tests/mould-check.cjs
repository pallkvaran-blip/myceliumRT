/* THE BREACH IS A DISC, THE ROT IS SHORT-LIVED, AND BOTH THE CLOUD AND THE DEAD STRAND FADE.
 *
 *     node tests/mould-check.cjs
 *
 * Three owner requests, measured through the real sim:
 *
 *   1. "have the trych infect all mycelium within a small radius, not just one contact point
 *      strand" — every clean strand inside `firstTouchRadius` (floored at the cloud's own reach)
 *      is seeded on contact, each seeding its own firstTouchRings walk. The negative control is
 *      the whole point of the first block: with the radius at 0 a cloud must still infect
 *      everything it VISIBLY COVERS, and one nearest-strand-only breach must leave clean strands
 *      lying inside the green.
 *   2. "have the infected strands take 1 less turn to die off" — rotLifeTurns 3 -> 2, asserted as
 *      the number of steps a strand actually survives, not as the config number.
 *      "when they do die off, have it fade away" — the removed strand's geometry is handed to the
 *      renderer as a ghost (`_rotGhosts`) which fades it over render.rotFadeMs.
 *   3. "have the trych disappear on the same turn that it infects. but have it fade away" — the
 *      cloud is spent on contact and its `strength` runs down on the WALL CLOCK, so it goes
 *      without waiting for another world step. Asserted in turn-based, where "another world step"
 *      means another player action: the cloud has to be gone with no action taken.
 *
 * Turn-based throughout, because a turn-based tick is one call to tickWorld with nothing racing
 * it — and because item 3 is only meaningfully broken there.
 */
const http = require('http'), fs = require('fs'), path = require('path');
const { chromium } = require('playwright');
const ROOT = process.env.MYC_ROOT || '/home/user/myceliumRT';
const T = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.png': 'image/png', '.webp': 'image/webp', '.mp3': 'audio/mpeg', '.wav': 'audio/wav' };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  PASS ' + m); } else { fail++; console.log('  FAIL ' + m); } };

(async () => {
  const srv = await new Promise((r) => { const s = http.createServer((rq, rs) => { let p = decodeURIComponent(rq.url.split('?')[0].split('#')[0]); if (p === '/') p = '/index.html'; const fp = path.join(ROOT, p); if (!fs.existsSync(fp) || fs.statSync(fp).isDirectory()) { rs.writeHead(404); rs.end('nf'); return; } rs.writeHead(200, { 'Content-Type': T[path.extname(fp)] || 'application/octet-stream' }); fs.createReadStream(fp).pipe(rs); }); s.listen(0, () => r(s)); });
  const b = await chromium.launch({ headless: true, executablePath: '/opt/pw-browsers/chromium' });
  const ctx = await b.newContext({ viewport: { width: 1400, height: 800 } });
  await ctx.addInitScript(() => { window.MYCELIUM_SUPABASE = { url: '', anonKey: '' }; });
  const p = await ctx.newPage();
  p.on('pageerror', (e) => console.log('PAGEERROR:', String(e).slice(0, 300)));
  await p.goto('http://localhost:' + srv.address().port + '/index.html#dev,turn', { waitUntil: 'domcontentloaded' });
  await p.waitForSelector('#loadscreen.ld-ready', { timeout: 60000 }).catch(() => {});
  await p.click('#loadscreen', { timeout: 5000 }).catch(() => {});
  await p.waitForFunction(() => window.__game && window.__game.state && window.__game.state.active, null, { timeout: 60000 }).catch(() => {});
  for (let i = 0; i < 6 && await p.$('#levelIntro'); i++) { await p.mouse.click(1100, 300); await sleep(300); }

  // ===== 1 + 2: the disc breach and the rot lifespan (synchronous, one page.evaluate) =====
  const R = await p.evaluate(() => {
    const G = window.__game, s = G.state, sub = s.substrate, net = s.active, cs = sub.cellSize;
    const t = s.config.trichoderma, cfgT = window.__cfg.trichoderma;
    const out = { cfg: { rotLifeTurns: cfgT.rotLifeTurns, firstTouchRadius: cfgT.firstTouchRadius, fadeMs: cfgT.fadeMs, rotFadeMs: window.__cfg.render.rotFadeMs } };

    // A FAN of separate filaments through one spot. The defect only shows on a shape where
    // several strands pass close together WITHOUT being neighbours in the graph: a breach that
    // seeds one strand and then walks rings from it claims that strand's own filament and
    // nothing else, so the neighbouring filaments 20-odd units away stay cream. On a single
    // chain, rings and geometry coincide and the bug is invisible — the same trap spread-probe's
    // linear chain sets for infectDescendants.
    const build = (arms, len, spread) => {
      s.clouds.length = 0; s.nematodes.length = 0; if (s.ants) s.ants.length = 0;
      for (const c of sub.cells) { c.trich = 0; c.mouldProof = 0; c.reinfectGrace = 0; c.nutrient = 0; c.maxNutrient = 0; c.colonized = 0; }
      sub.foodPiles = [];
      net.nodes.length = 0; net.byId.clear(); net.nextNodeId = 0;
      net._spreadAccum = 0; net.alive = true; net._rotGhosts = [];
      s.runOver = false; s.winPending = false;
      // ENERGY, OR NOTHING AGES. At 0 Energy tickWorld starves the colony, sets state.runOver,
      // and every later call returns at its first line — so a lifespan measured over 12 steps
      // read `rotAge` frozen at 1 for all 12 and looked like a broken countdown.
      net.energy = 5000; net.water = 999; net.phosphorus = 999;
      const hub = { x: sub.worldWidth / 2, y: sub.surfaceY + cs * 4 };
      const tips = [];
      for (let a = 0; a < arms; a++) {
        // Each arm is its OWN root: no shared parent, so no graph path between arms at all.
        const ang = -Math.PI / 2 + (a - (arms - 1) / 2) * spread;
        let par = null;
        for (let i = 1; i <= len; i++) {
          const n = net.addNode(hub.x + Math.cos(ang) * i * 6, hub.y + Math.sin(ang) * i * 6, par);
          n._liveAt = 0; par = n;
        }
        tips.push(par);
      }
      return hub;
    };
    // A cloud pinned in place (moveSpeed 0): tickWorld CREEPS THE CLOUDS BEFORE THE CONTACT PASS,
    // so a cloud dropped exactly on a strand has already drifted by the time it infects anything.
    const speed = t.moveSpeed;
    const drop = (at, r) => { s.clouds.push({ cx: at.x, cy: at.y, r, strength: 1, dying: false, heading: null }); };
    const inf = () => net.nodes.filter((n) => n.infected).length;
    // Clean strands lying INSIDE the cloud's own disc after the breach — the reported symptom.
    const cleanInside = (at, r) => net.nodes.filter((n) => !n.infected &&
      Math.hypot(n.x - at.x, n.y - at.y) <= r * cs).length;

    t.moveSpeed = 0;
    const life = t.rotLifeTurns;
    t.rotLifeTurns = 999;                  // hold the strands so the breach size is what's measured
    const rings = t.firstTouchRings;
    t.firstTouchRings = 0;                 // ATTRIBUTION: no ring walk, so what dies is the DISC alone

    // 1a) With the radius at its config value, every strand under the cloud goes.
    {
      const hub = build(7, 14, 0.22);
      const R0 = 1.2;
      drop(hub, R0);
      G.tickWorld(s);
      out.disc = { infected: inf(), of: net.nodes.length, cleanInsideCloud: cleanInside(hub, R0),
                   radiusCells: t.firstTouchRadius };
    }
    // 1b) NEGATIVE CONTROL: radius 0. The floor at the cloud's own reach must still take
    //     everything the mould visibly covers — 0 does not mean "one strand".
    {
      const rad = t.firstTouchRadius; t.firstTouchRadius = 0;
      const hub = build(7, 14, 0.22);
      const R0 = 1.2;
      drop(hub, R0);
      G.tickWorld(s);
      out.discZero = { infected: inf(), cleanInsideCloud: cleanInside(hub, R0) };
      t.firstTouchRadius = rad;
    }
    // 1c) THE OLD BEHAVIOUR, reproduced by hand on the same shape: seed only the nearest clean
    //     strand. This is the control that says the assertions above measure the disc and not
    //     something the map would have given us anyway.
    {
      const hub = build(7, 14, 0.22);
      const R0 = 1.2;
      let best = Infinity, hit = null;
      for (const n of net.nodes) { const d = Math.hypot(n.x - hub.x, n.y - hub.y); if (d < best) { best = d; hit = n; } }
      hit.infected = true;                 // no ring walk (firstTouchRings is 0 here anyway)
      out.pointBreach = { infected: inf(), cleanInsideCloud: cleanInside(hub, R0) };
    }

    // 1d) EACH CONTACT POINT OWNS ITS OWN WAVE. The renderer's creep has to start at the strand
    //     the rot came in on (`_infSeed`), and a disc breach has several — so every one of them
    //     must be marked and every one must start at `now`, or the green travels out from
    //     whichever single strand won and the rest of the contact face lags behind it.
    {
      const hub = build(7, 14, 0.22);
      drop(hub, 1.2);
      G.tickWorld(s);
      const marked = net.nodes.filter((n) => n._infSeed);
      const R = G.netRenderer(), now = 1e6;
      for (const n of net.nodes) { n._infAt = null; }
      R._scheduleInfection(now);
      out.wave = {
        marked: marked.length,
        rotten: net.nodes.filter((n) => n.infected).length,
        allMarkedStartAtNow: marked.every((n) => n._infAt === now),
        distinctStarts: new Set(net.nodes.filter((n) => n.infected && n._infAt != null).map((n) => n._infAt)).size,
      };
    }

    t.firstTouchRings = rings;
    t.rotLifeTurns = life;

    // 2) HOW MANY STEPS DOES A ROTTEN STRAND SURVIVE? Counted, not read off the config. One arm,
    //    one strand infected by hand, no cloud — so nothing re-infects what falls away.
    //
    //    THE RACE IS OFF FOR THIS BLOCK, and it has to be. Turn-based spreadDepthPerTurn is 12
    //    rings, which claims a short probe chain ENTIRELY on the first step — healthyCount hits 0,
    //    the run ends, and `runOver` makes every later tickWorld return at its first line. The
    //    lifespan then reads its first value forever: measured as `rotAge` stuck at 1 for all 12
    //    steps, which looks exactly like a broken countdown rather than a dead run.
    {
      const depth = t.spreadDepthPerTurn; t.spreadDepthPerTurn = 0;
      build(1, 8, 0);
      const target = net.nodes[3];
      target.infected = true; target.rotAge = 0;
      const id = target.id;
      let steps = 0;
      const seen = [];
      for (let i = 0; i < 12 && net.byId.has(id); i++) { G.tickWorld(s); steps++; seen.push(net.byId.has(id) ? (net.byId.get(id).rotAge | 0) : -1); }
      out.lifespan = { steps, rotAgeSeen: seen, config: t.rotLifeTurns, ghosts: (net._rotGhosts || []).length,
                       runOver: !!s.runOver, healthy: net.healthyCount(), nodes: net.nodes.length };
      t.spreadDepthPerTurn = depth;
    }

    t.moveSpeed = speed;
    return out;
  });

  if (R.fatal) { console.log('FATAL: ' + R.fatal); await b.close(); srv.close(); process.exit(1); }
  console.log(JSON.stringify(R, null, 1));

  console.log('\n1) the breach is a disc, not a point');
  ok(R.cfg.firstTouchRadius > 0, `firstTouchRadius is set (${R.cfg.firstTouchRadius} cells)`);
  ok(R.disc.infected > 1, `contact infects more than one strand with the ring walk OFF (${R.disc.infected} of ${R.disc.of})`);
  ok(R.disc.cleanInsideCloud === 0, `no clean strand is left inside the mould (${R.disc.cleanInsideCloud})`);
  ok(R.discZero.cleanInsideCloud === 0, `radius 0 still clears the cloud's own disc (${R.discZero.cleanInsideCloud} clean inside)`);
  ok(R.pointBreach.cleanInsideCloud > 0,
     `CONTROL: a nearest-strand-only breach DOES leave clean strands inside the mould (${R.pointBreach.cleanInsideCloud})`);
  ok(R.disc.infected > R.pointBreach.infected,
     `the disc claims more than the point did (${R.disc.infected} vs ${R.pointBreach.infected})`);

  ok(R.wave.marked > 1, `every strand of the contact face is marked as a breach (${R.wave.marked} of ${R.wave.rotten} rotten)`);
  ok(R.wave.allMarkedStartAtNow === true, 'and the creep starts at all of them at once, not at whichever one won');

  console.log('\n2) the rot dies one step sooner, and leaves a fading ghost');
  ok(R.cfg.rotLifeTurns === 2, `rotLifeTurns is 2, was 3 (${R.cfg.rotLifeTurns})`);
  ok(R.lifespan.runOver === false, `the run is still going, so the steps were really taken (healthy ${R.lifespan.healthy} of ${R.lifespan.nodes})`);
  ok(R.lifespan.steps === 2, `a rotten strand survives exactly 2 steps (${R.lifespan.steps}, ages seen ${JSON.stringify(R.lifespan.rotAgeSeen)})`);
  ok(R.cfg.rotFadeMs > 0, `render.rotFadeMs is set (${R.cfg.rotFadeMs} ms)`);
  ok(R.lifespan.ghosts > 0, `falling away left ghost strands for the renderer to fade (${R.lifespan.ghosts})`);

  // ===== the ghost actually fades and is then dropped (needs real frames) =====
  const ghost = await p.evaluate(async () => {
    const G = window.__game, net = G.state.active;
    const before = (net._rotGhosts || []).length;
    // Two rAFs is not enough to prove a fade: headless throttles the loop, so wait on RENDERS
    // advancing (paceInfo) and read the ghost list, which _strokeFalling drains as it draws.
    const t0 = performance.now();
    let drained = -1;
    while (performance.now() - t0 < 4000) {
      await new Promise((r) => requestAnimationFrame(r));
      drained = (net._rotGhosts || []).length;
      if (drained === 0) break;
    }
    return { before, after: drained, stampedAt: null };
  });
  console.log('\n   ghost fade: ' + JSON.stringify(ghost));
  ok(ghost.before > 0 && ghost.after === 0, `the ghosts faded out and were dropped (${ghost.before} -> ${ghost.after})`);

  // ===== 3: the cloud goes on the SAME turn, fading, with no further action =====
  const cloud = await p.evaluate(async () => {
    const G = window.__game, s = G.state, sub = s.substrate, net = s.active, cs = sub.cellSize;
    const t = s.config.trichoderma;
    s.clouds.length = 0; s.nematodes.length = 0; if (s.ants) s.ants.length = 0;
    for (const c of sub.cells) { c.trich = 0; c.mouldProof = 0; c.reinfectGrace = 0; }
    net.nodes.length = 0; net.byId.clear(); net.nextNodeId = 0; net.alive = true;
    s.runOver = false; s.winPending = false;
    net.energy = 5000; net.water = 999; net.phosphorus = 999;   // see the note in build()
    const speed = t.moveSpeed; t.moveSpeed = 0;
    const respawn = t.respawnChance; t.respawnChance = 0;   // a fresh cloud would be counted as "still there"
    const hub = { x: sub.worldWidth / 2, y: sub.surfaceY + cs * 4 };
    let par = null;
    for (let i = 1; i <= 10; i++) { par = net.addNode(hub.x, hub.y + i * 6, par); par._liveAt = 0; }
    const c0 = { cx: hub.x, cy: hub.y + 6 * 3, r: 1.2, strength: 1, dying: false, heading: null };
    s.clouds.push(c0);
    G.tickWorld(s);                                  // the breach
    const spentAtOnce = { spent: !!c0.spent, strength: c0.strength, clouds: s.clouds.length };
    // NOT ANOTHER WORLD STEP. This is the whole assertion: in turn-based the world only advances
    // when the player acts, so if the cloud needed a step to leave it would still be here.
    const turn0 = s.turn;
    const t0 = performance.now();
    while (performance.now() - t0 < 4000 && s.clouds.length) {
      await new Promise((r) => requestAnimationFrame(r));
    }
    const out = {
      spentAtOnce, gone: s.clouds.length === 0, tookMs: Math.round(performance.now() - t0),
      turnAdvanced: s.turn - turn0,
      trichLeft: sub.cells.reduce((a, c) => a + c.trich, 0),
    };
    t.moveSpeed = speed; t.respawnChance = respawn;
    return out;
  });
  console.log('\n' + JSON.stringify(cloud, null, 1));

  console.log('\n3) the cloud is spent on contact and fades away that same turn');
  ok(cloud.spentAtOnce.spent === true, 'contact marks the cloud spent');
  ok(cloud.spentAtOnce.strength > 0.5, `it is still drawn at full strength at that instant, not gone (${cloud.spentAtOnce.strength})`);
  ok(cloud.turnAdvanced === 0, `no further world step was taken (turn advanced by ${cloud.turnAdvanced})`);
  ok(cloud.gone === true, `it left on its own, on the wall clock (${cloud.tookMs} ms)`);
  ok(cloud.tookMs > 120, `and it FADED rather than blinking out (${cloud.tookMs} ms, fadeMs ${R.cfg.fadeMs})`);
  ok(cloud.trichLeft < 1e-6, `its mould field went with it (${cloud.trichLeft} total trich)`);

  console.log(`\n==== ${pass} passed, ${fail} failed ====`);
  await b.close(); srv.close();
  process.exit(fail ? 1 : 0);
})();
