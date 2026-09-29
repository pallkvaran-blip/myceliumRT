/* SEAMHUNT — the finishing plan's M10 acceptance 6b: does the garnet compass (rung 2: bearing + metres)
 * find the first garnet seam in 0.6x the digs of a hunter without it? A bot run (prints PASS/FAIL and the
 * runner's `====` fence; slow, not in --mine).
 *
 *   NODE_PATH=/opt/node22/lib/node_modules node tests/bots/seamhunt.cjs [--seeds 4242,909,...] [--reps 3] [--cap 200]
 *
 * POOLED (M10 verify): ten seeds x three reps by default (~40-60 min), gated on the pooled median ratio,
 * with a bootstrap-over-seeds spread and per-rep ratios printed. A single 5-seed pass read x0.40, x0.46,
 * x0.77 and x0.74 on the same build — the dive to 88 m is real time, so each rep starts a different colony.
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
const SEEDS = String(arg('--seeds', '4242,909,11,5,2024,7,33,101,555,8080')).split(',').map((x) => +x);
const CAP = +arg('--cap', 200);
const REPS = +arg('--reps', 3);
// --skip-walled: a MEASUREMENT of one option the owner may pick (M14), not the game — the compass hunter
// aims at the nearest unclaimed garnet seam CONNECTED to the colony on its flood of open ground (what a
// needle that skipped walled-in seams would point at) instead of the game's needle. --sides compass|blind
// runs one hunter only (the other side's numbers are then not printed as a ratio).
const SKIPW = argv.includes('--skip-walled');
const SIDES = String(arg('--sides', 'blind,compass')).split(',');

async function hunt(page, useCompass, cap) {
  await injectBot(page);
  return page.evaluate(async ({ useCompass, cap, SKIPW }) => {
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
          if (e && !SKIPW) { const b = e.bearing * Math.PI / 180; T = { x: e.fx + Math.cos(b) * e.dist * cs, y: e.fy + Math.sin(b) * e.dist * cs }; }
          if (e && SKIPW) {
            const cand = Q.targets(F, 1e9).filter((t) => t.kind === 'ore' && t.mat === 'garnet' && t.reach && !pre.has(t.pile) && !Q.pileClaimed(t.pile));
            let bd = Infinity; for (const t of cand) { const dd = Math.hypot(t.x - e.fx, t.y - e.fy); if (dd < bd) { bd = dd; T = { x: t.x, y: t.y }; } }
          }
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
  }, { useCompass, cap, SKIPW });
}

(async () => {
  const E = await H.start();
  let np = 0, nf = 0; const rows = [];
  // A hunt that never reached garnet counts at the cap (so it can only flatter the side that missed).
  const d = (x) => (x.reached ? x.digs : CAP);
  const med = (a) => { const b = a.slice().sort((p, q) => p - q); return b.length % 2 ? b[b.length >> 1] : (b[b.length / 2 - 1] + b[b.length / 2]) / 2; };
  const q = (a, f) => { const b = a.slice().sort((p, q2) => p - q2); return b[Math.min(b.length - 1, Math.max(0, Math.round(f * (b.length - 1))))]; };
  try {
    for (let rep = 0; rep < REPS; rep++) {
      for (const seed of SEEDS) {
        const row = { seed, rep };
        for (const use of (rep % 2 ? [true, false] : [false, true]).filter((u) => SIDES.includes(u ? 'compass' : 'blind'))) {   // alternate which hunter boots first
          const b = await E.bootMine(seed);  // the harness injects the navigator
          row[use ? 'compass' : 'blind'] = await hunt(b.page, use, CAP);
          await b.ctx.close();
        }
        rows.push(row);
        const f = (x) => !x ? '-' : `${x.reached ? 'reached' : 'NOT reached'} in ${x.digs} digs (${x.refused} refused, ${x.spent} water, from ${x.startDepth} to ${x.depth} m, ${x.found0} found first; ${JSON.stringify(x.modes)}${x.walled ? ', ' + x.walled + ' walled' : ''})`;
        console.log(`rep ${rep} seed ${seed}: blind ${f(row.blind)} | compass ${f(row.compass)}`);
      }
    }
    // POOLED over every seed x rep (M10 verify: one 5-seed sample decided nothing — the same seed's digs
    // swing ~2x run to run, because the real-time navigator's dive to 88 m leaves a different colony).
    if (SIDES.length < 2) {
      const side = SIDES[0], V = rows.map((r) => d(r[side]));
      console.log(`  ${side}${SKIPW ? ' (skip-walled)' : ''} only, ${rows.length} hunts: median ${med(V)} (p25 ${q(V, 0.25)}, p75 ${q(V, 0.75)}); reached ${rows.filter((r) => r[side].reached).length} of ${rows.length}; per seed ${SEEDS.map((sd) => sd + ':' + med(rows.filter((r) => r.seed === sd).map((r) => d(r[side])))).join(', ')}`);
      console.log(`\n==== 0 passed, 0 failed ====`); await E.close(); process.exit(0);
    }
    const C = rows.map((r) => d(r.compass)), B = rows.map((r) => d(r.blind));
    const mc = med(C), mb = med(B), ratio = mc / mb;
    // Spread: the ratio of medians re-drawn by SEED (bootstrap over seeds, each seed keeping all its reps).
    let bs = 0x9E3779B9 >>> 0; const rnd = () => ((bs = (Math.imul(bs ^ (bs >>> 15), 0x2C1B3C6D) + 0x6D2B79F5) >>> 0) / 4294967296);
    const boot = [];
    for (let k = 0; k < 2000; k++) {
      const pick = []; for (let j = 0; j < SEEDS.length; j++) { const sd = SEEDS[(rnd() * SEEDS.length) | 0]; for (const r of rows) if (r.seed === sd) pick.push(r); }
      boot.push(med(pick.map((r) => d(r.compass))) / med(pick.map((r) => d(r.blind))));
    }
    const perSeed = SEEDS.map((sd) => { const rs = rows.filter((r) => r.seed === sd); return sd + ':' + med(rs.map((r) => d(r.compass))) + '/' + med(rs.map((r) => d(r.blind))); });
    const perRep = []; for (let rep = 0; rep < REPS; rep++) { const rs = rows.filter((r) => r.rep === rep); perRep.push((med(rs.map((r) => d(r.compass))) / med(rs.map((r) => d(r.blind)))).toFixed(2)); }
    const reachedC = C.filter((x, i) => rows[i].compass.reached).length, reachedB = rows.filter((r) => r.blind.reached).length;
    const okR = ratio <= 0.6 && reachedC === rows.length;
    console.log(`  pooled ${rows.length} hunts a side: compass median ${mc} (p25 ${q(C, 0.25)}, p75 ${q(C, 0.75)}), blind median ${mb} (p25 ${q(B, 0.25)}, p75 ${q(B, 0.75)}); reached ${reachedC} / ${reachedB} of ${rows.length}`);
    console.log(`  ratio of medians x${ratio.toFixed(2)}; bootstrap over seeds p5-p95 x${q(boot, 0.05).toFixed(2)}-x${q(boot, 0.95).toFixed(2)}; per rep ${perRep.join(', ')}; per seed (compass/blind medians) ${perSeed.join(', ')}`);
    console.log(`  ${okR ? 'PASS' : 'FAIL'}  the garnet compass (rung 2) reaches the next garnet seam in <= 0.6x the digs (pooled median, and every compass hunt reaches one)  — x${ratio.toFixed(2)} (${mc} vs ${mb})`);
    okR ? np++ : nf++;
  } catch (e) { nf++; console.log('  FAIL  harness error: ' + (e && e.stack || e)); }
  console.log(`\n==== ${np} passed, ${nf} failed ====`);
  await E.close();
  process.exit(nf ? 1 : 0);
})();
