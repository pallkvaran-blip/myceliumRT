/* BREACH SIZE IN REAL PLAY (mine, M6 verifier's probe). Prints, never fails; not in the runner.
 *   node tests/breach-real-probe.cjs creep|into
 * creep: a cloud at the mine's own speed, 150 u from the deepest tip, while the colony digs toward
 *   it every 700 ms. into: a parked cloud 75 u away, dug into. Per seed: strands infected at first
 *   contact, one tick later, and what one dose at the centroid cut. It found the rot-before-harvest
 *   pass in colonizeReachablePiles claiming the whole subtree under a strand caught in mould
 *   (21-104 at first contact); counter-check's `digbreach` block is the assertion.
 */
const H = require('/home/user/myceliumRT/tests/mine-harness.cjs');
const QUIET = () => { const s = window.__game.state; s.nematodes.length = 0; s.clouds.length = 0; s.config.nematodes.respawnChance = 0; s.config.trichoderma.respawnChance = 0; };
const COLONY = async ({ n, maxM, QUIET }) => {
  new Function('return (' + QUIET + ')')()();
  const g = window.__game, s = g.state; s.active.water = 1e6;
  await window.__navDig({ targetM: maxM, maxIters: 300 });
  const dirs = [[1.4, 0.3], [-1.4, 0.3], [1, 0.8], [-1, 0.8], [0.3, 1], [1.6, -0.2], [-1.6, -0.2]];
  for (let i = 0; i < 80 && s.active.nodes.length < n; i++) {
    const d = dirs[i % dirs.length]; const cs = s.substrate.cellSize, top = s.substrate.surfaceY;
    const live = s.active.nodes.filter((q) => !q.infected && (q.y - top) / cs <= maxM); if (!live.length) break;
    const src = live[(i * 7919) % live.length]; g.mine.growFrom(src.x, src.y, src.x + d[0] * 80, src.y + d[1] * 80);
    if (i % 3 === 2) await new Promise((r) => setTimeout(r, 60));
  }
  await new Promise((r) => setTimeout(r, 600));
  for (let i = 0; i < 200 && g.mine.revealing(); i++) await new Promise((r) => setTimeout(r, 50));
  await new Promise((r) => setTimeout(r, 700));
  new Function('return (' + QUIET + ')')()();
  const T = s._tappedWater || (s._tappedWater = new Set()); for (const q of (s.substrate.reservoirs || [])) T.add(q.id);
  s.active.water = 1e6; return s.active.nodes.length;
};
const mode = process.argv[2] || 'creep';
(async () => {
  const E = await H.start();
  for (const seed of [4242, 909, 11, 5, 2024]) {
    const b = await E.bootMine(seed);
    const cn = await b.page.evaluate(COLONY, { n: 150, maxM: 30, QUIET: QUIET.toString() });
    const r = await b.page.evaluate(async (mode) => {
      const g = window.__game, s = g.state, sub = s.substrate;
      const clean = () => s.active.nodes.filter((q) => !q.infected);
      const tip = clean().sort((a, b) => b.y - a.y)[0];
      // spot: open, LOS, at distance D from tip
      const D = mode === 'creep' ? 150 : 75;
      let spot = null;
      for (let k = 0; k < 400 && !spot; k++) { const a = k * 2.399; const x = tip.x + Math.cos(a) * D, y = tip.y + Math.sin(a) * D;
        if (y < sub.surfaceY + 30 || sub.solidAtWorld(x, y) || !sub.segmentClear(tip.x, tip.y, x, y)) continue;
        let m = 1e9; for (const q of clean()) m = Math.min(m, Math.hypot(q.x - x, q.y - y)); if (m < D - 20) continue; spot = { x, y }; }
      if (!spot) return { err: 'no spot' };
      if (mode === 'into') s.config.trichoderma.moveSpeed = 0;
      g.mine.spawnCloud(spot.x, spot.y);
      await new Promise((r) => setTimeout(r, 300));
      let first = null, t0 = performance.now(), grows = 0;
      while (performance.now() - t0 < 20000) {
        const inf = s.active.nodes.filter((q) => q.infected).length;
        if (inf) { first = { inf, nodes: s.active.nodes.length, turn: s.turn }; break; }
        if (grows < 10) { const c = clean().sort((a, b) => Math.hypot(a.x - spot.x, a.y - spot.y) - Math.hypot(b.x - spot.x, b.y - spot.y))[0];
          const res = g.mine.growFrom(c.x, c.y, spot.x, spot.y); grows++; }
        await new Promise((r) => setTimeout(r, mode === 'creep' ? 700 : 900));
      }
      if (!first) return { err: 'no contact', grows };
      // wait 1 tick and re-read (spread), then the dose at centroid
      const t1 = s.turn; for (let i = 0; i < 40 && s.turn === t1; i++) await new Promise((r) => setTimeout(r, 25));
      const rot = s.active.nodes.filter((q) => q.infected); let x = 0, y = 0; for (const q of rot) { x += q.x; y += q.y; }
      const cb = clean().length;
      s.mineItems = Object.assign({}, s.mineItems, { amputate: 1 });
      const d = g.mine.useAmputate(x / rot.length, y / rot.length);
      const t2 = s.turn; for (let i = 0; i < 40 && s.turn === t2; i++) await new Promise((r) => setTimeout(r, 25));
      return { grows, first, rotNextTick: rot.length, ok: d.ok, msg: d.message, cleanRemoved: cb - clean().length,
               rottenAfter: s.active.nodes.filter((q) => q.infected).length, infect: s.mineInfect, over: !!s.runOver };
    }, mode);
    console.log(mode, seed, 'colony', cn, JSON.stringify(r));
    await b.ctx.close();
  }
  await E.close();
})().catch((e) => { console.error(e); process.exit(2); });
