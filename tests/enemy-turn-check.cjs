/* THE PHASED, ANIMATED ENEMY TURN (turn-based only).
 *
 *     node tests/enemy-turn-check.cjs
 *
 * The player's action used to resolve the whole world inline, so the creatures had already
 * moved and eaten by the time the growth they were reacting to had finished animating in —
 * "enemies are still moving at the same time I do". An action now QUEUES a step and the frame
 * loop plays it out: wait for the grow reveal, tickWorld('move'), hold ~2s while the renderer
 * slides everything to its new spot, tickWorld('attack').
 *
 * Three separate things have to hold, and each fails differently:
 *
 *  1. THE SPLIT IS REAL. tickWorld(s,'move') must move creatures and take nothing; 'attack'
 *     must take things and move nobody. This is asserted straight through the engine, with a
 *     planted worm and a planted cloud, because a half-applied split is silent — a phase that
 *     quietly still eats looks exactly like a phase that doesn't, from the outside.
 *  2. THE ORDER IS REAL. Sampled every frame across a live card play: no sample may ever show
 *     a creature moving while the player's growth is still revealing. Asserted as ORDER over a
 *     log rather than as timing, which headless cannot measure (see tests/README.md).
 *  3. ONE STEP PER ACTION SURVIVES IT. The animation is skippable by acting again, but the
 *     step behind it is not: N synchronous plays must still be N world steps once settled.
 *
 * And the negative: REAL TIME must not have grown an enemyTurn. Its clock ticks twice a second
 * and already tweens between ticks; phasing it would halve its threat rate.
 */
const http = require('http'), fs = require('fs'), path = require('path');
const { chromium } = require('playwright');
const ROOT = path.resolve(__dirname, '..');
const T = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json',
            '.png': 'image/png', '.webp': 'image/webp', '.mp3': 'audio/mpeg', '.wav': 'audio/wav' };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let PASS = 0, FAIL = 0;
const ok = (n, c, x) => { c ? PASS++ : FAIL++; console.log((c ? '  PASS  ' : '  FAIL  ') + n + (x ? '  — ' + x : '')); };

const boot = async (ctx, url) => {
  const p = await ctx.newPage();
  p.on('pageerror', (e) => console.log('PAGEERROR:', String(e.stack || e).slice(0, 300)));
  // An explicitly-empty key genuinely disables the score backend; a missing one falls back
  // to the live project (see CLAUDE.md).
  await p.addInitScript(() => { window.MYCELIUM_SUPABASE = { url: '', anonKey: '' }; });
  await p.goto(url, { waitUntil: 'domcontentloaded' });
  await p.waitForSelector('#loadscreen.ld-ready', { timeout: 60000 }).catch(() => {});
  await p.click('#loadscreen', { timeout: 5000 }).catch(() => {});
  await p.waitForFunction(() => window.__game && window.__game.state && window.__game.state.active,
                          null, { timeout: 60000 }).catch(() => {});
  for (let i = 0; i < 6 && await p.$('#levelIntro'); i++) { await p.mouse.click(1100, 300); await sleep(400); }
  return p;
};

// Clear a block of soil around the colony root and fill it with food, then grow into it —
// the shared setup for every measurement below. Returns via the page.
const PREP = `(function () {
  const G = window.__game, s = G.state, sub = s.substrate, net = s.active;
  net.energy = 99999; net.water = 999;
  const nd = net.nodes[0], c0 = sub.colAtX(nd.x), r0 = sub.rowAtY(nd.y);
  for (let c = c0 - 4; c <= c0 + 4; c++) for (let r = r0; r <= r0 + 6; r++) {
    if (!sub.inBounds(c, r)) continue;
    const cell = sub.cells[sub.index(c, r)];
    cell.rock = 0; cell.hazard = 0; cell.nutrient = 60; cell.maxNutrient = 60;
  }
  for (let i = 0; i < 16; i++) G.performAction(s, 'grow', {});
  G.settleEnemyTurn();                      // the grows queued steps — settle before measuring
  s.nematodes.length = 0;
  if (s.clouds) s.clouds.length = 0;
  net.energy = 99999;
})()`;

// A spot to drop a worm that is further than one step from the colony but still inside its
// sight, with the whole first step provably clear — otherwise the crawl measurement is really
// measuring the clamp to the gap, or a slide along rock. Lifted from threat-check, which
// found all three failure modes the hard way.
const SPOT_HELPER = `window.__spotOutOfReach = function (step) {
  const s = window.__game.state, sub = s.substrate, net = s.active, cs = sub.cellSize;
  const inB = (x, y) => x >= cs && x <= sub.worldWidth - cs
                     && y >= sub.surfaceY + cs && y <= sub.worldHeight - cs;
  const pathOk = (x0, y0, x1, y1) => {                    // exactly what moveWorm tests
    const dx = x1 - x0, dy = y1 - y0;
    const n = Math.max(1, Math.ceil(Math.hypot(dx, dy) / (cs * 0.5)));
    for (let i = 1; i <= n; i++) {
      const x = x0 + dx * (i / n), y = y0 + dy * (i / n);
      if (!inB(x, y)) return false;
      const c = sub.cellAtWorld(x, y);
      if (c && c.rock) return false;
    }
    return true;
  };
  const deep = net.nodes.slice().sort((a, b) => b.y - a.y).slice(0, 12);
  const sight = Math.max(cs * 4, s.config.nematodes.sightRadius || 500);
  for (const mult of [1.15, 1.3, 1.5, 1.7, 1.4]) {
    const D = step * mult;
    if (D >= sight) continue;
    for (let k = 0; k < 16; k++) {
      const ang = k * Math.PI / 8;
      for (const T of deep) {
        const x = T.x + Math.cos(ang) * D, y = T.y + Math.sin(ang) * D;
        if (!inB(x, y) || sub.solidAtWorld(x, y)) continue;
        let best = null, bd = Infinity;
        for (const nd of net.nodes) { const d = Math.hypot(nd.x - x, nd.y - y); if (d < bd) { bd = d; best = nd; } }
        if (!best || bd <= step * 1.05) continue;               // would clamp to the gap
        if (bd >= sight) continue;                              // out of sensing range
        if (!sub.segmentClear(x, y, best.x, best.y)) continue;  // can't sense through rock
        const ux = (best.x - x) / bd, uy = (best.y - y) / bd;
        if (!pathOk(x, y, x + ux * step, y + uy * step)) continue;   // would slide, not step
        return { x, y, gap: bd / cs };
      }
    }
  }
  return null;
};`;

(async () => {
const srv = await new Promise((res) => { const s = http.createServer((rq, rs) => {
  let p = decodeURIComponent(rq.url.split('?')[0].split('#')[0]); if (p === '/') p = '/index.html';
  const fp = path.join(ROOT, p);
  if (!fp.startsWith(ROOT) || !fs.existsSync(fp) || fs.statSync(fp).isDirectory()) { rs.writeHead(404); rs.end('nf'); return; }
  rs.writeHead(200, { 'Content-Type': T[path.extname(fp)] || 'application/octet-stream' });
  fs.createReadStream(fp).pipe(rs); }); s.listen(0, () => res(s)); });
const base = 'http://localhost:' + srv.address().port;
const b = await chromium.launch({ headless: true, executablePath: '/opt/pw-browsers/chromium' });

// =============================================================================
// 1. THE SPLIT — a worm moves in one phase and bites in the other, never both
// =============================================================================
{
const p = await boot(b, base + '/index.html#dev,turn');
await p.evaluate(PREP);
await p.evaluate(SPOT_HELPER);

// A worm parked ON the densest part of the colony: it has nowhere to crawl (it is already
// inside `reach`), so the MOVE phase must leave the strand count alone and the ATTACK phase
// must take strandsPerBite of them. Sat on the densest node for the same reason threat-check
// does — otherwise the bite is limited by how many strands are physically that close.
const bite = await p.evaluate(() => {
  const G = window.__game, s = G.state, sub = s.substrate, net = s.active, cs = sub.cellSize;
  const reach = s.config.nematodes.reach * cs;
  let tgt = net.nodes[0], dense = -1;
  for (const a of net.nodes) {
    let k = 0;
    for (const bn of net.nodes) if (Math.hypot(bn.x - a.x, bn.y - a.y) <= reach) k++;
    if (k > dense) { dense = k; tgt = a; }
  }
  s.nematodes.push({ x: tgt.x, y: tgt.y, heading: 0, phase: 0, stuck: 0, feedCd: 0, hp: 0,
                     sees: false, feeding: false, trailing: false, targetId: null });
  const before = net.nodes.length, t0 = s.turn;
  G.tickWorld(s, 'move');
  const midNodes = net.nodes.length, midTurn = s.turn, midWorms = s.nematodes.length;
  G.tickWorld(s, 'attack');
  return { before, midNodes, midTurn, midWorms, t0,
           after: net.nodes.length, turn: s.turn, worms: s.nematodes.length,
           want: s.config.nematodes.strandsPerBite, inReach: dense };
});
ok('a dense enough colony to bite into', bite.before > 60 && bite.inReach > bite.want,
   `${bite.before} strands, ${bite.inReach} within reach, bite is ${bite.want}`);
ok('the MOVE phase eats no strands', bite.midNodes === bite.before,
   `${bite.before} → ${bite.midNodes}`);
ok('the MOVE phase breeds no worms', bite.midWorms === 1, `${bite.midWorms} worms`);
ok('the MOVE phase does not advance the step counter', bite.midTurn === bite.t0,
   `turn ${bite.t0} → ${bite.midTurn}`);
ok('the ATTACK phase eats strandsPerBite strands', bite.before - bite.after === bite.want,
   `ate ${bite.before - bite.after}, want ${bite.want}`);
ok('the ATTACK phase advances the step counter exactly once', bite.turn === bite.t0 + 1,
   `turn ${bite.t0} → ${bite.turn}`);

// And the mirror: a worm with ground to cover crawls in the MOVE phase and does not crawl
// again in the ATTACK phase. Two full steps of movement per action would double every
// threat rate in the game, silently.
const crawl = await p.evaluate(() => {
  const G = window.__game, s = G.state, sub = s.substrate, cs = sub.cellSize;
  s.nematodes.length = 0;
  const want = s.config.nematodes.crawlSpeed;
  const spot = window.__spotOutOfReach(want * cs);
  if (!spot) return { err: 'no clear spot to measure a crawl from' };
  s.nematodes.push({ x: spot.x, y: spot.y, heading: 0, phase: 0, stuck: 0, feedCd: 0, hp: 0,
                     sees: false, feeding: false, trailing: false, targetId: null });
  const w = s.nematodes[0], x0 = w.x, y0 = w.y;
  G.tickWorld(s, 'move');
  const moved = Math.hypot(w.x - x0, w.y - y0) / cs, x1 = w.x, y1 = w.y;
  G.tickWorld(s, 'attack');
  return { moved, want, saw: !!w.sees, gap: spot.gap,
           movedInAttack: Math.hypot(w.x - x1, w.y - y1) / cs };
});
ok('the worm could see the colony, from beyond one step',
   !crawl.err && crawl.saw === true && crawl.gap > crawl.want,
   crawl.err || `nearest strand ${crawl.gap.toFixed(1)} cells, one step is ${crawl.want}`);
ok('the MOVE phase crawls the full crawlSpeed', !crawl.err && Math.abs(crawl.moved - crawl.want) < 0.05,
   crawl.err || `moved ${crawl.moved.toFixed(3)} cells, table says ${crawl.want}`);
ok('the ATTACK phase moves the worm not at all', !crawl.err && crawl.movedInAttack < 1e-6,
   crawl.err || `moved a further ${crawl.movedInAttack.toFixed(4)} cells`);

// The same split for a mould cloud: creep, then devour. A cloud has no drawn form of its own
// — it IS the stamped field — so "did it move?" is read off cx/cy.
const cloud = await p.evaluate(() => {
  const G = window.__game, s = G.state, sub = s.substrate, net = s.active, cs = sub.cellSize;
  s.nematodes.length = 0; s.clouds.length = 0;
  const totalFood = () => { let t = 0; for (const cell of sub.cells) t += cell.nutrient; return t; };
  // Further than one step from the colony but inside its sight, with the first step provably
  // clear — the cloud's sight radius is the worm's, so the same finder serves. Parked any
  // closer and the creep clamps to the gap; parked in a pocket and it slides instead.
  const spot = window.__spotOutOfReach(s.config.trichoderma.moveSpeed * cs);
  if (!spot) return { err: 'no clear spot to measure a creep from' };
  // Lay food across the whole corridor the cloud will creep along, so "the attack phase
  // devours food" is measuring the phase and not whether this map happened to put a pile
  // where the finder landed. Without it the assertion passes or fails on the seed.
  const c0 = sub.colAtX(spot.x), r0 = sub.rowAtY(spot.y);
  for (let col = c0 - 5; col <= c0 + 5; col++) for (let row = r0 - 5; row <= r0 + 5; row++) {
    if (!sub.inBounds(col, row)) continue;
    const cell = sub.cells[sub.index(col, row)];
    if (cell.rock) continue;
    cell.nutrient = 60; cell.maxNutrient = 60;
  }
  s.clouds.push({ cx: spot.x, cy: spot.y, r: 1.0, strength: 1, heading: 0,
                  dying: false, vanishNext: false, sees: false, _budget: 0 });
  const c = s.clouds[0], x0 = c.cx, y0 = c.cy, f0 = totalFood();
  G.tickWorld(s, 'move');
  const movedCells = Math.hypot(c.cx - x0, c.cy - y0) / cs, f1 = totalFood(), x1 = c.cx, y1 = c.cy;
  G.tickWorld(s, 'attack');
  return { movedCells, want: s.config.trichoderma.moveSpeed,
           ateInMove: f0 - f1, ateInAttack: f1 - totalFood(),
           movedInAttack: Math.hypot(c.cx - x1, c.cy - y1) / cs };
});
ok('the MOVE phase creeps the cloud moveSpeed cells',
   !cloud.err && Math.abs(cloud.movedCells - cloud.want) < 0.05,
   cloud.err || `crept ${cloud.movedCells.toFixed(3)} cells, table says ${cloud.want}`);
ok('the MOVE phase devours no food at all', !cloud.err && cloud.ateInMove === 0,
   cloud.err || `${cloud.ateInMove} nutrient gone`);
ok('the ATTACK phase devours food', !cloud.err && cloud.ateInAttack > 0,
   cloud.err || `${cloud.ateInAttack.toFixed(1)} nutrient gone`);
ok('the ATTACK phase creeps the cloud not at all', !cloud.err && cloud.movedInAttack < 1e-6,
   cloud.err || `crept a further ${cloud.movedInAttack.toFixed(4)} cells`);

// The rot is an attack too: an established infection must not race a single ring while the
// creatures are only walking. (This is the one that would let a limb rot away during the
// slide, before anything had visibly arrived.)
const rot = await p.evaluate(() => {
  const G = window.__game, s = G.state, net = s.active;
  s.nematodes.length = 0; s.clouds.length = 0;
  for (const n of net.nodes) { n.infected = false; n.rotAge = 0; }
  net.nodes[0].infected = true; net.nodes[0].rotAge = 0;
  net._spreadAccum = 0;
  const count = () => net.nodes.filter((n) => n.infected).length;
  const c0 = count();
  G.tickWorld(s, 'move');
  const c1 = count();
  G.tickWorld(s, 'attack');
  return { c0, c1, c2: count() };
});
ok('the MOVE phase advances the rot not one ring', rot.c1 === rot.c0, `${rot.c0} → ${rot.c1} infected`);
ok('the ATTACK phase races the rot', rot.c2 > rot.c1, `${rot.c1} → ${rot.c2} infected`);

await p.close();
}

// =============================================================================
// 2. THE ORDER — nothing moves until the player's growth has finished revealing
// =============================================================================
{
const p = await boot(b, base + '/index.html#dev,turn');
await p.evaluate(PREP);
await p.evaluate(SPOT_HELPER);

// Play a real card, plant a worm with ground to cover, then sample EVERY frame until the
// queued turn resolves. Order, not timing: the log is what is asserted, so a throttled
// headless rAF costs sample density and nothing else.
//
// The worm goes down AFTER the play and before any frame — which is the only way to be sure
// it has somewhere to crawl. Placed first, the grow that follows can land tissue right beside
// it, and a worm already inside `reach` correctly does not move at all, so the "the creatures
// have moved" assertion would fail on a game that was working perfectly.
const log = await p.evaluate(() => new Promise((resolve) => {
  const G = window.__game, s = G.state, sub = s.substrate, net = s.active, cs = sub.cellSize;
  s.nematodes.length = 0; s.clouds.length = 0;

  // A long grow, so the reveal is long enough to be sampled. Aimed the way turn-play aims —
  // three columns right of the frontier, first clear row — which is the targeting that
  // survives a whole 120-play session on a procedural map.
  const fp = net.frontierPoint();
  const tcol = Math.min(sub.cols - 1, sub.colAtX(fp.x) + 3);
  let tr = -1;
  for (let r = 0; r < sub.rows; r++) { const c = sub.cellAt(tcol, r); if (c && !c.rock && !c.water) { tr = r; break; } }
  const target = tr >= 0 ? sub.cellCenter(tcol, tr) : { x: fp.x + 100, y: fp.y };
  net.energy = 99999; net.water = 999; net.phosphorus = 99;
  let idx = s.cards.hand.findIndex((h) => h.name === 'Rhizomorph Lance');
  if (idx < 0) { s.cards.hand.push({ id: s.cards.seq++, name: 'Rhizomorph Lance' }); idx = s.cards.hand.length - 1; }
  const t0 = s.turn, n0 = net.nodes.length;
  G.play(idx, { x: target.x, y: target.y });

  const queuedAtOnce = !!G.enemyTurn, phaseAtOnce = G.enemyTurn && G.enemyTurn.phase;
  const turnAtOnce = s.turn;
  // Measured HERE, not at the end: the enemy turn about to play out will eat strands, and a
  // grow whose strands were then bitten away still had a reveal to wait for.
  const grew = net.nodes.length > n0;

  const spot = window.__spotOutOfReach(s.config.nematodes.crawlSpeed * cs);
  if (!spot) { resolve({ err: 'no clear spot to plant a worm' }); return; }
  s.nematodes.push({ x: spot.x, y: spot.y, heading: 0, phase: 0, stuck: 0, feedCd: 0, hp: 0,
                     sees: false, feeding: false, trailing: false, targetId: null });
  const pos0 = s.nematodes.map((w) => ({ x: w.x, y: w.y }));
  const wormsMoved = () => s.nematodes.some((w, i) =>
    !pos0[i] || Math.hypot(w.x - pos0[i].x, w.y - pos0[i].y) > 0.5);

  const samples = [];
  const start = performance.now();
  let movedAt = 0;
  (function step() {
    const now = performance.now();
    const et = G.enemyTurn;
    const phase = et ? et.phase : 'done';
    const rev = !!(G.netRenderer() && G.netRenderer().isRevealing(now));
    const moved = wormsMoved();
    samples.push({ phase, rev, moved, turn: s.turn, alpha: G.renderAlpha ? G.renderAlpha() : null });
    if (phase === 'hold' && !movedAt) movedAt = et.movedAt;
    if (phase === 'done' || now - start > 20000) {
      // The slide is timed from the machine's own stamp to the frame that saw it finish, not
      // between two sampled frames: headless gives 2-4 frames across two seconds, so a
      // frame-to-frame span reads about half the real duration.
      resolve({ t0, n0, queuedAtOnce, phaseAtOnce, turnAtOnce, samples, grew, turn: s.turn,
                holdMs: movedAt ? now - movedAt : 0,
                totalMs: now - start, frames: samples.length });
      return;
    }
    requestAnimationFrame(step);
  })();
}));

ok('a worm was planted with ground to cover', !log.err, log.err || '');
ok('the play grew the colony (so there was a reveal to wait for)', log.grew === true);
ok('the action QUEUES the step instead of resolving it inline',
   log.queuedAtOnce === true && log.phaseAtOnce === 'wait' && log.turnAtOnce === log.t0,
   `queued=${log.queuedAtOnce} phase=${log.phaseAtOnce} turn ${log.t0} → ${log.turnAtOnce}`);

const revFrames = log.samples.filter((s) => s.rev).length;
const movedWhileRevealing = log.samples.filter((s) => s.rev && s.moved).length;
ok('the growth was still revealing for part of the wait', revFrames > 0,
   `${revFrames} of ${log.frames} sampled frames were revealing`);
ok('NO creature moved while the player\'s growth was still revealing', movedWhileRevealing === 0,
   `${movedWhileRevealing} of ${revFrames} revealing frames had a worm already moved`);

const holdFrames = log.samples.filter((s) => s.phase === 'hold');
ok('there is a distinct MOVE-then-slide phase', holdFrames.length > 0,
   `${holdFrames.length} of ${log.frames} frames in \'hold\'`);
ok('the creatures have moved by the time the slide starts',
   holdFrames.length > 0 && holdFrames[holdFrames.length - 1].moved === true);
ok('the step counter does NOT advance during the slide',
   holdFrames.every((s) => s.turn === log.t0),
   `turns seen while sliding: ${[...new Set(holdFrames.map((s) => s.turn))].join(',')}`);

// The slide is the visible part of the ask ("~2 seconds"). Bounded loosely on both sides:
// headless can lose frames at the edges, so this is "roughly two seconds", not a stopwatch.
const slideMs = await p.evaluate(() => window.__game.enemySlideMs());
ok('the slide runs for about the configured duration',
   log.holdMs >= slideMs && log.holdMs <= slideMs * 2.5,
   `held ${Math.round(log.holdMs)}ms against a configured ${slideMs}ms (${holdFrames.length} frames)`);

// renderAlpha is what actually draws the creature partway along: it must sweep 0→1 across the
// slide and sit at 1 the rest of the time (a stale alpha below 1 pins every creature at where
// it stood an action ago). Asserted as "starts at 0 and only ever rises", NOT as "a sample
// landed near 1" — headless throttles rAF to a few Hz, so the last frame before the turn
// closes can be most of a second short of the end. The endpoint is the next assertion.
const alphas = holdFrames.map((s) => s.alpha).filter((a) => a != null);
const rising = alphas.every((a, i) => i === 0 || a >= alphas[i - 1] - 1e-9);
ok('the slide tween starts at 0 and only ever advances',
   alphas.length > 1 && alphas[0] < 0.35 && rising && alphas[alphas.length - 1] > 0.4,
   `alpha ${alphas.map((a) => a.toFixed(2)).join(' → ') || 'no samples'}`);
const settled = await p.evaluate(() => ({ alpha: window.__game.renderAlpha(), et: !!window.__game.enemyTurn }));
ok('the tween sits at 1 once the turn is over', settled.et === false && settled.alpha === 1,
   `alpha ${settled.alpha}, enemyTurn ${settled.et}`);

ok('the whole action is exactly one world step', log.turn === log.t0 + 1,
   `turn ${log.t0} → ${log.turn}`);

await p.close();
}

// =============================================================================
// 3. ONE STEP PER ACTION, however fast the player acts
// =============================================================================
{
const p = await boot(b, base + '/index.html#dev,turn');
await p.evaluate(PREP);

// A synchronous burst: no frame runs between these, so nothing can animate. Each action must
// still resolve the step the one before it owed, leaving exactly one outstanding. Queueing
// always installs a NEW machine object, so identity is the exact test for "did this action
// take a step?" — a blocked action queues nothing and leaves the previous one in place.
const burst = await p.evaluate(() => {
  const G = window.__game, s = G.state, net = s.active;
  const sub = s.substrate, t0 = s.turn;
  let acts = 0, dropped = 0, byAction = 0, byCard = 0;
  for (let k = 0; k < 20; k++) {
    net.energy = 99999; net.water = 999; net.phosphorus = 99;
    const et0 = G.enemyTurn, before = s.turn;
    // Alternate the two paths into a world step: performAction (a basic action) and
    // resolveCardOp (a card play). Both have to queue, and both have to flush.
    if (k % 2) {
      // Lay UNCLAIMED food just ahead of the frontier first: a basic grow is blocked with "no
      // food within sensing range", a sprawling colony outruns the map's own piles, and
      // already-colonised cells don't lure — so without the `colonized = 0` this path stays
      // blocked and the burst quietly only exercises the card path.
      const fp = net.frontierPoint();
      if (fp) {
        const fc = sub.colAtX(fp.x), fr = sub.rowAtY(fp.y);
        for (let col = fc; col <= fc + 3; col++) for (let row = fr - 1; row <= fr + 2; row++) {
          if (!sub.inBounds(col, row)) continue;
          const cell = sub.cells[sub.index(col, row)];
          if (cell.rock) continue;
          cell.hazard = 0; cell.colonized = 0; cell.nutrient = 50; cell.maxNutrient = 50;
        }
      }
      G.performAction(s, 'grow', {});
    } else {
      let idx = s.cards.hand.findIndex((h) => h.name === 'Rhizomorph Lance');
      if (idx < 0) { s.cards.hand.push({ id: s.cards.seq++, name: 'Rhizomorph Lance' }); idx = s.cards.hand.length - 1; }
      const fp = net.frontierPoint(); if (!fp) break;
      const tcol = Math.min(sub.cols - 1, sub.colAtX(fp.x) + 3);
      let tr = -1;
      for (let r = 0; r < sub.rows; r++) { const c = sub.cellAt(tcol, r); if (c && !c.rock && !c.water) { tr = r; break; } }
      const target = tr >= 0 ? sub.cellCenter(tcol, tr) : { x: fp.x + 100, y: fp.y };
      G.play(idx, { x: target.x, y: target.y });
    }
    if (G.enemyTurn === et0) continue;               // blocked — nothing queued, nothing owed
    acts++; if (k % 2) byAction++; else byCard++;
    if (et0 && s.turn !== before + 1) dropped++;     // the owed step must have landed
    const off = s.cards.pendingOffers && s.cards.pendingOffers[0];
    if (off && off.choices && off.choices[0]) G.chooseCard(off.choices[0]);
  }
  const mid = s.turn, owedAtEnd = !!G.enemyTurn;
  G.settleEnemyTurn();
  return { t0, acts, byAction, byCard, dropped, mid, owedAtEnd, end: s.turn, settledOwed: !!G.enemyTurn };
});
ok('the burst actually took actions, on both paths',
   burst.acts >= 10 && burst.byAction > 0 && burst.byCard > 0,
   `${burst.acts} actions — ${burst.byAction} via performAction, ${burst.byCard} via a card`);
ok('acting again resolves the step the last action owed', burst.dropped === 0,
   `${burst.dropped} of ${burst.acts} dropped their owed step`);
ok('a burst of N actions leaves exactly one step outstanding',
   burst.owedAtEnd === true && burst.mid === burst.t0 + burst.acts - 1,
   `turn ${burst.t0} → ${burst.mid} after ${burst.acts} actions, owed=${burst.owedAtEnd}`);
ok('settling gives exactly one world step per action', burst.end === burst.t0 + burst.acts,
   `turn ${burst.t0} → ${burst.end} for ${burst.acts} actions`);
ok('settling leaves nothing owed', burst.settledOwed === false);

await p.close();
}

// =============================================================================
// 4. REAL TIME IS UNTOUCHED
// =============================================================================
{
const p = await boot(b, base + '/index.html#dev');
const rt = await p.evaluate(() => {
  const G = window.__game, s = G.state;
  const t0 = s.turn;
  G.performAction(s, 'grow', {});
  return { rtMode: !!s.config.realtime.enabled, queued: !!G.enemyTurn, t0, turn: s.turn };
});
ok('real time is what booted', rt.rtMode === true);
ok('a real-time action queues NO enemy turn', rt.queued === false);
await sleep(2500);
const ticked = await p.evaluate(() => ({ turn: window.__game.state.turn, queued: !!window.__game.enemyTurn }));
ok('the real-time clock still advances the world on its own', ticked.turn > rt.turn,
   `turn ${rt.turn} → ${ticked.turn} over 2.5s`);
ok('real time never grows an enemyTurn', ticked.queued === false);
await p.close();
}

console.log(`\n==== ${PASS} passed, ${FAIL} failed ====`);
await b.close(); srv.close();
process.exit(FAIL ? 1 : 0);
})().catch((e) => { console.error('HARNESS ERROR', e); process.exit(2); });
