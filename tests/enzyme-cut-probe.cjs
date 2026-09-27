/* WHAT ONE ENZYME DOSE CUTS WHEN THE PLAYER DUG INTO THE MOULD (mine, M6 verify round 3).
 * Prints, never fails; not in the runner.
 *   node tests/enzyme-cut-probe.cjs [into|creep] [segment|linked|none] [seeds...]
 * A ~150-strand colony digs toward a cloud (parked for `into`, creeping at the mine's own speed
 * for `creep`) and KEEPS DIGGING after contact (3 more digs, as a player who has not noticed does),
 * then one dose at the rot's centroid. Per seed: [rot, clean] cut, rot left, and whether the clock
 * cleared. The margin mode overrides `CONFIG.mine.cutMargin` on the run's clone. The verifier's
 * reading on the 'segment' margin (a clean ring one segment wide round the patch) was 20-43 clean
 * strands a dose on these seeds against 4-14 rot; counter-check's `digcut` block is the assertion.
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
// The measurement, shared with counter-check (exported below).
const DIGCUT = async ({ mode, margin, after }) => {
  const g = window.__game, s = g.state, sub = s.substrate;
  if (margin) s.config.mine.cutMargin = margin;
  const clean = () => s.active.nodes.filter((q) => !q.infected);
  const tip = clean().sort((a, b) => b.y - a.y)[0];
  const D = mode === 'creep' ? 150 : 75;
  let spot = null;
  for (let k = 0; k < 400 && !spot; k++) {
    const a = k * 2.399, x = tip.x + Math.cos(a) * D, y = tip.y + Math.sin(a) * D;
    if (y < sub.surfaceY + 30 || sub.solidAtWorld(x, y) || !sub.segmentClear(tip.x, tip.y, x, y)) continue;
    let m = 1e9; for (const q of clean()) m = Math.min(m, Math.hypot(q.x - x, q.y - y));
    if (m >= D - 20) spot = { x, y };
  }
  if (!spot) return { err: 'no spot' };
  if (mode === 'into') s.config.trichoderma.moveSpeed = 0;
  g.mine.spawnCloud(spot.x, spot.y);
  await new Promise((r) => setTimeout(r, 300));
  const nearest = () => clean().sort((a, b) => Math.hypot(a.x - spot.x, a.y - spot.y) - Math.hypot(b.x - spot.x, b.y - spot.y))[0];
  let first = null, grows = 0; const t0 = performance.now();
  while (performance.now() - t0 < 20000) {
    const inf = s.active.nodes.filter((q) => q.infected).length;
    if (inf) { first = inf; break; }
    if (grows < 10) { const c = nearest(); g.mine.growFrom(c.x, c.y, spot.x, spot.y); grows++; }
    await new Promise((r) => setTimeout(r, mode === 'creep' ? 700 : 900));
  }
  if (first == null) return { err: 'no contact', grows };
  // ...and the player keeps digging at the spot for `after` more digs, from the clean strand
  // nearest it — the fresh fan that runs beside the rot is what a one-segment margin swept up.
  for (let i = 0; i < after; i++) {
    const c = nearest(); if (c) g.mine.growFrom(c.x, c.y, spot.x, spot.y);
    await new Promise((r) => setTimeout(r, 700));
  }
  for (let i = 0; i < 200 && g.mine.revealing(); i++) await new Promise((r) => setTimeout(r, 50));
  const t1 = s.turn; for (let i = 0; i < 40 && s.turn === t1; i++) await new Promise((r) => setTimeout(r, 25));
  const rot = s.active.nodes.filter((q) => q.infected);
  let x = 0, y = 0; for (const q of rot) { x += q.x; y += q.y; }
  const before = s.active.nodes.length;
  s.mineItems = Object.assign({}, s.mineItems, { amputate: 3 });
  const d = g.mine.useAmputate(x / rot.length, y / rot.length);
  let doses = d.ok ? 1 : 0, cleanCut = d.clean | 0, rotCut = d.rot | 0;
  // More doses only if rot is left (a patch the first dose did not reach).
  for (let k = 0; k < 2 && s.active.nodes.some((q) => q.infected); k++) {
    const r2 = s.active.nodes.filter((q) => q.infected); let a = 0, b = 0; for (const q of r2) { a += q.x; b += q.y; }
    const e = g.mine.useAmputate(a / r2.length, b / r2.length); if (!e.ok) break;
    doses++; cleanCut += e.clean | 0; rotCut += e.rot | 0;
  }
  const t2 = s.turn; for (let i = 0; i < 40 && s.turn === t2; i++) await new Promise((r) => setTimeout(r, 25));
  // Are the survivors still one network hanging off the root? (orphans keep living by design, so
  // this counts what is disconnected, it does not require zero)
  return { grows, first, rotAtDose: rot.length, colony: before, doses, rotCut, cleanCut, ok: d.ok, msg: d.message,
           rottenAfter: s.active.nodes.filter((q) => q.infected).length, clockNull: s.mineInfect === null, over: !!s.runOver };
};
module.exports = { QUIET, COLONY, DIGCUT };
if (require.main === module) {
  const mode = process.argv[2] || 'into', margin = process.argv[3] || null;
  const seeds = process.argv.slice(4).map(Number).filter(Boolean);
  (async () => {
    const E = await H.start();
    for (const seed of (seeds.length ? seeds : [7, 33, 101, 555, 8080, 12345])) {
      const b = await E.bootMine(seed);
      const cn = await b.page.evaluate(COLONY, { n: 150, maxM: 30, QUIET: QUIET.toString() });
      const r = await b.page.evaluate(DIGCUT, { mode, margin, after: 3 });
      console.log(mode, margin || '(shipped)', 'seed', seed, 'colony', cn, JSON.stringify(r));
      await b.ctx.close();
    }
    await E.close();
  })().catch((e) => { console.error(e); process.exit(2); });
}
