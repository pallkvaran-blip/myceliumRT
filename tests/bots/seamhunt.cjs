/* SEAMHUNT — the finishing plan's M10 acceptance 6b: does the garnet compass (rung 2: bearing + metres)
 * find the first garnet seam in 0.6x the digs of a hunter without it? A bot run (prints PASS/FAIL and the
 * runner's `====` fence; slow, not in --mine).
 *
 *   NODE_PATH=/opt/node22/lib/node_modules node tests/bots/seamhunt.cjs [--seeds 4242,909,11,5,2024] [--cap 250]
 *
 * Both hunters play the FREE layout ('#mine,<seed>': every chunk carries all four bands, so garnet sits at
 * 84-126 m under the hill), one run per seed each, the tank topped up before every dig (the water spent is
 * counted, not rationed), grow 3, no threats — so the only difference between them is WHERE they aim.
 * "Reached" = a garnet seam claimed by clean tissue (a cell colonised) or paid.
 *
 * THE HUNT STARTS AT 88 m, AFTER THE FIRST GARNET: a material compass is only sold once the save has dug a
 * seam of that material, so the question it answers is "where is the NEXT one?". Both hunters take the
 * harness navigator to 88 m, every garnet seam within 20 m of the colony then counts as found (marked
 * paid), and digs are counted from there.
 *
 * Both see the same ground: lib.cjs's flood of the fine mask over the GENERATED chunks (the rock is on
 * screen for a player too), dug along its BFS path (`digAlong`), and either digs straight for a garnet seam
 * it can SEE (on a 390x844 screen at the resting zoom: +-325 x +-700 units of the focus strand — seams are
 * tinted). The difference is what they aim at
 * otherwise:
 *   - BLIND (no compass): what the tile says — garnet is found at 84-126 m. Dive toward 105 m (the frontier
 *     cell deepest, less 0.45 x its path length) until a strand is past 86 m; then sweep the band outward
 *     from the hill (the frontier cell in 84-126 m farthest from the root, less 0.45 x path).
 *   - COMPASS (rung 2): the needle's bearing and metres from the focus strand name a point T; dig toward the
 *     frontier cell nearest T (less 0.45 x path) — through rock the needle is a straight line, the flood
 *     finds the corridor. A needle that has not got closer in 12 digs points at a walled-off seam: the
 *     hunter stops chasing it and sweeps like the blind one until the needle points elsewhere.
 * A hunt that never reaches garnet counts at the cap in the median.
 */
const H = require('../mine-harness.cjs');
const { injectBot } = require('./lib.cjs');
const argv = process.argv.slice(2);
const arg = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d; };
const SEEDS = String(arg('--seeds', '4242,909,11,5,2024')).split(',').map((x) => +x);
const CAP = +arg('--cap', 200);

async function hunt(page, useCompass, cap) {
  await injectBot(page);
  return page.evaluate(async ({ useCompass, cap }) => {
    const g = window.__game, s = g.state, sub = s.substrate, net = s.active, cs = sub.cellSize, Q = window.__qa;
    s.nematodes.length = 0; s.clouds.length = 0;
    s.config.nematodes.respawnChance = 0; s.config.trichoderma.respawnChance = 0;
    if (s.config.mine.worms) s.config.mine.worms.waterPerSec = 0;
    s.config.mine.threatBands = s.config.mine.threatBands.map(() => ({ worms: 0, clouds: 0 }));
    s.config.mine.growSteps = 3;
    s.config.mine.stuckFruitMs = 1e9;
    s.config.mine.compass = { island: 0, mats: { garnet: useCompass ? 2 : 0 } };
    const raf = () => new Promise((q) => requestAnimationFrame(q));
    // THE HUNT STARTS IN THE BAND, AFTER THE FIRST GARNET (a material compass is only on the shelf once the
    // save has dug its first seam of that material, so "find the NEXT one" is the question it answers).
    // Both hunters: the harness navigator down to 88 m, then every garnet seam within 20 m of the colony
    // counts as already found (marked paid), and the digs are counted from there.
    net.water = 100000;
    await window.__navDig({ targetM: 88, maxIters: 400 });
    for (let k = 0; k < 90 && g.mine.revealing(); k++) await raf();
    const startDepth = g.mine.maxDepth();
    let found0 = 0; const pre = new Set();
    for (const p of sub.foodPiles) {
      if (p.mineMat !== 'garnet' || p.rewarded) continue;
      const c = { x: 0, y: 0 }; for (const k of p.cells) { c.x += (k % sub.cols + 0.5) * cs; c.y += sub.surfaceY + ((k / sub.cols | 0) + 0.5) * cs; }
      c.x /= p.cells.length; c.y /= p.cells.length;
      if (Q.nodeDist(c.x, c.y) < 20 * cs || p.cells.some((k) => sub.cells[k] && sub.cells[k].colonized > 0)) { p.rewarded = true; pre.add(p); found0++; }
    }
    const reached = () => sub.foodPiles.some((p) => p.mineMat === 'garnet' && !pre.has(p) && (p.rewarded || p.cells.some((k) => sub.cells[k] && sub.cells[k].colonized > 0)));
    const rootX = net.nodes[0].x, lam = 0.45, gap = Math.ceil(60 / sub._fineSize);
    let digs = 0, refused = 0, spent = 0, tries = 0, seen = 0, mode = '';
    const nd = { key: null, best: Infinity, stall: 0 }, walled = new Set();
    const modes = {};
    while (tries++ < cap * 2 && digs < cap && !s.runOver && !reached()) {
      net.water = 999;
      const F = Q.flood();
      // A GARNET SEAM ON SCREEN (within 650 units of the colony, the same view either hunter has) is
      // dug for directly — the seams are tinted and visible; the compass is about the ones off screen.
      // ON SCREEN = inside a 390x844 phone's view at the resting zoom around the strand being worked
      // (camera-follow puts it near the middle): +-325 x +-700 world units.
      const fN = s._mineFocus && net.byId.get(s._mineFocus.id) || Q.live().reduce((a, n) => (n.y > a.y ? n : a));
      const vis = Q.targets(F, 1e9).filter((t) => t.kind === 'ore' && t.mat === 'garnet' && t.reach && !Q.pileClaimed(t.pile)
        && Math.abs(t.x - fN.x) < 325 && Math.abs(t.y - fN.y) < 700).sort((a, b) => a.reach.d - b.reach.d)[0];
      let ti = -1;
      if (vis) { ti = vis.reach.i; mode = 'seen'; seen++; }
      else {
        let T = null;
        if (useCompass) {
          const e = g.mine.compass().find((q) => q.mat === 'garnet');
          if (e) { const b = e.bearing * Math.PI / 180; T = { x: e.fx + Math.cos(b) * e.dist * cs, y: e.fy + Math.sin(b) * e.dist * cs }; }
          // A needle that has not got closer in 12 digs points at a seam the maze walls off (some are, by
          // design): a player stops chasing it and sweeps like the blind hunter until it points elsewhere.
          if (T) {
            const key = Math.round(T.x / cs) + ',' + Math.round(T.y / cs);
            let dN = Infinity; for (const n of Q.live()) dN = Math.min(dN, Math.hypot(n.x - T.x, n.y - T.y));
            if (key !== nd.key) { nd.key = key; nd.best = dN; nd.stall = 0; }
            else if (dN < nd.best - 8) { nd.best = dN; nd.stall = 0; } else nd.stall++;
            if (walled.has(key) || nd.stall >= 12) { walled.add(key); T = null; }
          }
        }
        let deepM = 0; for (const n of Q.live()) deepM = Math.max(deepM, (n.y - sub.surfaceY) / cs);
        mode = T ? 'needle' : deepM < 86 ? 'dive' : 'sweep';
        void deepM;
        let bsc = -Infinity;
        for (let i = 0; i < F.dist.length; i++) {
          const d = F.dist[i]; if (d < gap) continue;
          const x = (i % F.fc + 0.5) * F.fs, y = F.sy + (((i / F.fc) | 0) + 0.5) * F.fs, m = (y - sub.surfaceY) / cs;
          let sc;
          if (mode === 'needle') sc = -Math.hypot(x - T.x, y - T.y) - lam * d * F.fs;
          else if (mode === 'dive') sc = Math.min(y, sub.surfaceY + 105 * cs) - lam * d * F.fs;
          else { if (m < 84 || m > 126) continue; sc = Math.abs(x - rootX) - lam * d * F.fs; }
          if (sc > bsc) { bsc = sc; ti = i; }
        }
      }
      modes[mode] = (modes[mode] | 0) + 1;
      if (ti < 0) break;
      const w0 = net.water;
      const r = Q.digAlong(F, ti);
      if (r && r.ok) { digs++; spent += w0 - net.water; } else refused++;
      for (let k = 0; k < 90 && g.mine.revealing(); k++) await raf();
      for (let k = 0; k < 2; k++) await raf();
    }
    return { reached: reached(), digs, refused, spent, depth: g.mine.maxDepth(), modes, startDepth, found0, walled: walled.size };
  }, { useCompass, cap });
}

(async () => {
  const E = await H.start();
  let np = 0, nf = 0; const rows = [];
  try {
    for (const seed of SEEDS) {
      const row = { seed };
      for (const use of [false, true]) {
        const b = await E.bootMine(seed);  // the harness injects the navigator
        row[use ? 'compass' : 'blind'] = await hunt(b.page, use, CAP);
        await b.ctx.close();
      }
      rows.push(row);
      const f = (x) => `${x.reached ? 'reached' : 'NOT reached'} in ${x.digs} digs (${x.refused} refused, ${x.spent} water, from ${x.startDepth} to ${x.depth} m, ${x.found0} found first; ${JSON.stringify(x.modes)}${x.walled ? ', ' + x.walled + ' walled' : ''})`;
      console.log(`seed ${seed}: blind ${f(row.blind)} | compass ${f(row.compass)}`);
    }
    // A hunt that never reached garnet counts at the cap (so it can only flatter the side that missed).
    const d = (x) => (x.reached ? x.digs : CAP);
    const med = (a) => { const b = a.slice().sort((p, q) => p - q); return b.length % 2 ? b[b.length >> 1] : (b[b.length / 2 - 1] + b[b.length / 2]) / 2; };
    const mb = med(rows.map((r) => d(r.blind))), mc = med(rows.map((r) => d(r.compass)));
    const okR = mc <= 0.6 * mb && rows.every((r) => r.compass.reached);
    console.log(`  ${okR ? 'PASS' : 'FAIL'}  the garnet compass (rung 2) reaches the first garnet seam in <= 0.6x the digs  — median ${mc} vs ${mb} digs (x${(mc / mb).toFixed(2)}); per seed ${rows.map((r) => d(r.compass) + '/' + d(r.blind)).join(', ')}`);
    okR ? np++ : nf++;
  } catch (e) { nf++; console.log('  FAIL  harness error: ' + (e && e.stack || e)); }
  console.log(`\n==== ${np} passed, ${nf} failed ====`);
  await E.close();
  process.exit(nf ? 1 : 0);
})();
