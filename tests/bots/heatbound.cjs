// THE HEAT BOUND IN REAL PLAY (finishing plan M2, acceptance 5c): does any dig grow a node farther than
// `fallDist` + one reach from the strand it pressed?
//
// ship-check's heat block asks that of a synthetic dive + walled presses. This asks it of the
// route-planning bot (lib.cjs) playing ordinary descents on the REAL tank, water pockets in, because
// that is where the M2 verifier found the overshoot the probe missed: on seed 22 a dig made chain
// nodes 254-323 u from the press (a water-seek runner carried on from the dig's new tip) against a
// 243 u bound, and side twigs reached 251-288 u.
//
// Every `growFrom` is audited: its new nodes are split into grown (chain, side twig, water runner) and
// pile-claim mat nodes (`.colon`, which mineGrow deliberately leaves unbounded). Also counts the
// 'Solid rock' refusals, the rate the M2 fall-through cap moved.
//
//   NODE_PATH=/opt/node22/lib/node_modules node tests/bots/heatbound.cjs [seed ...]
//
// ~1 min a seed. Prints a `====` line; fails if any grown node lands past the bound.
const fs = require('fs');
const { OUT, launch, bootMine } = require('./lib.cjs');
const { playDescent } = require('./botrun.cjs');
const SEEDS = process.argv.slice(2).map(Number).filter((n) => n > 0);
const seeds = SEEDS.length ? SEEDS : [22, 4242, 909, 11, 5];
let pass = 0, fail = 0;
const ok = (n, c, x) => { c ? (pass++, console.log('  PASS  ' + n + (x ? '  — ' + x : ''))) : (fail++, console.log('  FAIL  ' + n + (x ? '  — ' + x : ''))); };

const AUDIT = () => {
  const g = window.__game, s = g.state, net = s.active;
  const R = s.config.mine.fallDist + g.mine.steps() * 3 * s.config.growth.segmentLength;
  const A = window.__heat = { R, digs: 0, refusals: 0, solidRock: 0, nodes: 0, side: 0, runner: 0, over: [], maxGrown: 0,
                              colon: 0, colonFar: 0, runnerMade: 0 };
  const rfw = net.reachForWater;
  let inDig = false;
  net.reachForWater = function (...a) { const m = rfw.apply(this, a); if (inDig) A.runnerMade += m; return m; };
  const orig = g.mine.growFrom;
  g.mine.growFrom = function (...a) {
    const before = net.nextNodeId;
    inDig = true;
    let res;
    try { res = orig.apply(this, a); } finally { inDig = false; }
    if (!res || !res.ok) {
      A.refusals++;
      if (res && /Solid rock/.test(res.message || '')) A.solidRock++;
      return res;
    }
    if (!res.pressed) return res;
    A.digs++;
    for (const q of net.nodes) {
      if (q.id < before) continue;
      const d = Math.hypot(q.x - res.pressed.x, q.y - res.pressed.y);
      if (q.colon) { A.colon++; if (d > R) A.colonFar++; continue; }
      A.nodes++;
      if (d > A.maxGrown) A.maxGrown = d;
      if (d > R) {
        const kind = q.side ? 'side' : 'runner';
        A[kind]++;
        if (A.over.length < 8) A.over.push(`${kind} ${Math.round(d)}u`);
      }
    }
    return res;
  };
};

(async () => {
  const env = await launch();
  const rows = [];
  for (const seed of seeds) {
    const m = await bootMine(env, seed);
    await m.page.evaluate(AUDIT);
    const res = await playDescent(m.page, { label: 'heat-' + seed, paceMs: 600, bot: { useItems: true }, sitMs: 3000 });
    const A = await m.page.evaluate(() => window.__heat);
    rows.push({ seed, depth: res.end.depth, cause: res.end.cause, ...A, errs: m.errs.slice(0, 3) });
    console.log(`seed ${seed}: ${res.end.depth} m (${res.end.cause}); ${A.digs} digs, ${A.refusals} refused (${A.solidRock} 'Solid rock'); `
      + `${A.nodes} grown nodes, farthest ${Math.round(A.maxGrown)} u of ${Math.round(A.R)}; past it: ${A.side} twig, ${A.runner} chain/runner`
      + `${A.over.length ? ' (' + A.over.join(', ') + ')' : ''}; ${A.runnerMade} water-runner nodes; ${A.colon} mat nodes, ${A.colonFar} past R`);
    await m.ctx.close();
  }
  fs.writeFileSync(`${OUT}/heatbound.json`, JSON.stringify(rows, null, 1));
  console.log('');
  for (const r of rows) {
    ok(`seed ${r.seed}: no grown node past fallDist + one reach (${Math.round(r.R)} u)`, r.digs > 10 && r.side === 0 && r.runner === 0,
       `${r.digs} digs, ${r.nodes} nodes, farthest ${Math.round(r.maxGrown)} u`);
    ok(`seed ${r.seed}: no page errors`, r.errs.length === 0, r.errs.join(' | ') || 'clean');
  }
  const t = rows.reduce((a, r) => ({ digs: a.digs + r.digs, refusals: a.refusals + r.refusals, solidRock: a.solidRock + r.solidRock,
    runnerMade: a.runnerMade + r.runnerMade }), { digs: 0, refusals: 0, solidRock: 0, runnerMade: 0 });
  console.log(`totals: ${t.digs} digs, ${t.refusals} refused, ${t.solidRock} 'Solid rock' (${(100 * t.solidRock / Math.max(1, t.digs + t.refusals)).toFixed(1)}% of attempts), ${t.runnerMade} water-runner nodes | trace ${OUT}/heatbound.json`);
  await env.close();
  console.log(`\n==== ${pass} passed, ${fail} failed ====`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('HARNESS ERROR', e); process.exit(1); });
