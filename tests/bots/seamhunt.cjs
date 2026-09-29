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
 *   - BLIND (no compass): what the tile says — garnet is found at 84-126 m. Dive from the deepest clean tip
 *     along the most open downward ray until a tip is past 86 m; then sweep the band east and west from the
 *     farthest tip in the sweep direction (turning after 8 digs that do not extend it).
 *   - COMPASS (rung 2): the needle's bearing and metres from the focus strand name a point; dig from the
 *     clean tip nearest that point, along the most open of 9 rays fanned about the direction to it.
 *
 * Shared by both: 9 rays scored on `solidAtWorld` (the ghost finger's free look), a dead-end memory (a
 * 2x2-cell region where a dig was refused or took under 2 new cells is not dug from again).
 */
const H = require('../mine-harness.cjs');
const argv = process.argv.slice(2);
const arg = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d; };
const SEEDS = String(arg('--seeds', '4242,909,11,5,2024')).split(',').map((x) => +x);
const CAP = +arg('--cap', 250);

async function hunt(page, useCompass, cap) {
  return page.evaluate(async ({ useCompass, cap }) => {
    const g = window.__game, s = g.state, sub = s.substrate, net = s.active, cs = sub.cellSize;
    s.nematodes.length = 0; s.clouds.length = 0;
    s.config.nematodes.respawnChance = 0; s.config.trichoderma.respawnChance = 0;
    if (s.config.mine.worms) s.config.mine.worms.waterPerSec = 0;
    s.config.mine.threatBands = s.config.mine.threatBands.map(() => ({ worms: 0, clouds: 0 }));
    s.config.mine.growSteps = 3;
    s.config.mine.stuckFruitMs = 1e9;
    s.config.mine.compass = { island: 0, mats: { garnet: useCompass ? 2 : 0 } };
    const raf = () => new Promise((q) => requestAnimationFrame(q));
    const R = s.config.growth.segmentLength * 3 * 3;
    const reached = () => sub.foodPiles.some((p) => p.mineMat === 'garnet' && (p.rewarded || p.cells.some((k) => sub.cells[k] && sub.cells[k].colonized > 0)));
    const live = () => net.nodes.filter((n) => !n.infected && !n.colon);
    const dead = new Set(), rk = (n) => Math.floor(n.x / 72) + ',' + Math.floor(n.y / 72);
    const depthM = (y) => (y - sub.surfaceY) / cs;
    const clear = (x, y, a) => { let c = 0; for (let d = 12; d <= R; d += 12) { const px = x + Math.cos(a) * d, py = y + Math.sin(a) * d;
      if (py <= sub.surfaceY + 2 || sub.solidAtWorld(px, py)) break; c = d; } return c; };
    const bestRay = (x, y, base, spread) => { let bA = base, bS = -Infinity;
      for (let k = -4; k <= 4; k++) { const a = base + k * spread; const c = clear(x, y, a); const sc = c - Math.abs(k) * 6; if (sc > bS) { bS = sc; bA = a; } }
      return { a: bA, c: bS }; };
    let digs = 0, refused = 0, spent = 0, tries = 0, dir = 1, sweepBest = -Infinity, sweepStall = 0, phase = 'dive';
    const t0 = performance.now();
    while (tries++ < cap * 3 && digs < cap && !s.runOver && !reached()) {
      net.water = 999;
      const L = live().filter((n) => !dead.has(rk(n)));
      if (!L.length) break;
      let tip = null, ang = Math.PI / 2;
      if (useCompass) {
        const e = g.mine.compass().find((q) => q.mat === 'garnet');
        if (!e) break;
        const b = e.bearing * Math.PI / 180, T = { x: e.fx + Math.cos(b) * e.dist * cs, y: e.fy + Math.sin(b) * e.dist * cs };
        let bd = Infinity; for (const n of L) { const d = Math.hypot(n.x - T.x, n.y - T.y); if (d < bd) { bd = d; tip = n; } }
        ang = bestRay(tip.x, tip.y, Math.atan2(T.y - tip.y, T.x - tip.x), 0.3).a;
      } else {
        const deep = L.reduce((a, n) => (n.y > a.y ? n : a), L[0]);
        if (phase === 'dive' && depthM(deep.y) >= 86) phase = 'sweep';
        if (phase === 'dive') { tip = deep; ang = bestRay(tip.x, tip.y, Math.PI / 2, 0.3).a; }
        else {
          const band = L.filter((n) => depthM(n.y) >= 84 && depthM(n.y) <= 126);
          const pool = band.length ? band : [deep];
          tip = pool.reduce((a, n) => (n.x * dir > a.x * dir ? n : a), pool[0]);
          if (tip.x * dir > sweepBest + 8) { sweepBest = tip.x * dir; sweepStall = 0; } else if (++sweepStall >= 8) { dir = -dir; sweepBest = -Infinity; sweepStall = 0; }
          ang = bestRay(tip.x, tip.y, dir > 0 ? 0 : Math.PI, 0.3).a;
        }
      }
      const w0 = net.water;
      const r = g.mine.growFrom(tip.x, tip.y, tip.x + Math.cos(ang) * R, tip.y + Math.sin(ang) * R);
      if (r && r.ok) { digs++; spent += w0 - net.water; } else refused++;
      if (!r || !r.ok || (r.newCells | 0) < 2) dead.add(rk(tip));
      for (let k = 0; k < 90 && g.mine.revealing(); k++) await raf();
      for (let k = 0; k < 2; k++) await raf();
    }
    return { reached: reached(), digs, refused, spent, depth: g.mine.maxDepth(), phase, ms: Math.round(performance.now() - t0) };
  }, { useCompass, cap });
}

(async () => {
  const E = await H.start();
  let np = 0, nf = 0; const rows = [];
  try {
    for (const seed of SEEDS) {
      const row = { seed };
      for (const use of [false, true]) {
        const b = await E.bootMine(seed);
        row[use ? 'compass' : 'blind'] = await hunt(b.page, use, CAP);
        await b.ctx.close();
      }
      rows.push(row);
      const f = (x) => `${x.reached ? 'reached' : 'NOT reached'} in ${x.digs} digs (${x.refused} refused, ${x.spent} water, ${x.depth} m)`;
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
