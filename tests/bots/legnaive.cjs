/* LEGNAIVE — can a NAIVE journey player land leg 1 on a given seed? A tool (prints, never fails; not in
 * the runner). The finishing plan's M8 acceptance 3c, screened fast: one run, the tank topped up every
 * dig (the water it spent is counted instead), grow 3, threats off, no pacing — the naive policies'
 * choices depend on the colony's shape, not on the clock.
 *
 *   NODE_PATH=/opt/node22/lib/node_modules node tests/bots/legnaive.cjs --seed 1905387
 *   ...                                     node tests/bots/legnaive.cjs --from 36 --to 156
 *
 * `--seed N` screens one seed (0 = the curated one) with both naive policies (lib.cjs `naiveStep`,
 * `lean: 'east'` and the original down-east); `--from/--to` walks legprobe's own candidate sequence for
 * leg 1 (`(7919 + k*104729 + 12345) % 2147483000 + 1`), gates each with legprobe PASS + WPASS, and
 * screens the ones that pass.
 *
 * MEASURED (M8 verify 2): the curated 1905387 — east reaches 93 m east at 32 m deep and does not land in
 * 400 water, down-east 67 m; candidates k 36-155: 5 of 120 pass PASS + WPASS (4733070, 9864791,
 * 10597894, 11330997, 14682325) and NEITHER policy lands any of them (best 69 m east). Most candidates
 * with a shallow road fail the plan's 1.3-2.0 path-ratio gate (1.12-1.30): the maze gates and a greedy
 * player pull opposite ways, so a seed re-pick cannot close 3c on its own.
 */
const H = require('../mine-harness.cjs');
const LP = require('./legprobe.cjs');
const { injectBot } = require('./lib.cjs');
async function screen(page, lean, grow) {
  await injectBot(page);
  return page.evaluate(async ({ lean, grow }) => {
    const g = window.__game, s = g.state, Q = window.__qa, net = s.active;
    s.config.mine.growSteps = grow;
    if (s.config.mine.worms) s.config.mine.worms.waterPerSec = 0;
    Q.bad = new Map(); Q._glowUsed = new Set(); Q._nref = new Map(); Q._dead = new Set();
    let spent = 0, digs = 0, maxE = 0, tries = 0;
    const raf = () => new Promise((q) => requestAnimationFrame(q));
    while (tries++ < 400 && !s.runOver) {
      net.water = 999;
      const w0 = net.water;
      const r = Q.naiveStep({ policy: 'naive', goal: 'island', lean });
      if (r.stuck) break;
      if (r.ok) { digs++; spent += w0 - net.water; }
      for (let k = 0; k < 2; k++) await raf();
      maxE = Math.max(maxE, g.mine.east());
      if (spent > 400) break;
    }
    for (let k = 0; k < 4; k++) await raf();
    return { landed: !!(s.runOver && s.runResult && s.runResult.cause === 'island'), digs, spent, maxE, depth: g.mine.maxDepth() };
  }, { lean, grow });
}
module.exports = { screen };
if (require.main === module) (async () => {
  const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
  const E = await H.start();
  const both = async (sd) => {
    const out = {};
    for (const lean of ['east', null]) {
      const b = await LP.openLeg(E, 1, sd || 0);
      out[lean || 'downeast'] = await screen(b.page, lean, 3);
      await b.ctx.close();
    }
    return out;
  };
  try {
    if (arg('--seed', null) != null) console.log(arg('--seed'), JSON.stringify(await both(+arg('--seed'))));
    else {
      const from = +arg('--from', 36), to = +arg('--to', 156);
      let b = await LP.openLeg(E, 1, 0);
      for (let k = from; k < to; k++) {
        const sd = ((1 * 7919 + k * 104729 + 12345) % 2147483000) + 1;
        try {
          if ((k - from) % 6 === 0) { await b.ctx.close().catch(() => {}); b = await LP.openLeg(E, 1, 0); }
          await LP.playLeg(b.page, 1, sd);
          const m = await LP.measure(b.page);
          let ok = LP.PASS(m, 1);
          if (ok) ok = LP.WPASS(await LP.world(b.page));
          console.log(`k ${k} seed ${sd}: ${ok ? 'PASS' : '    '} ratio ${m.ratio} shallow ${m.shallowMaxCol}/${m.islandC0} water ${m.water}${ok ? ' | ' + JSON.stringify(await both(sd)) : ''}`);
        } catch (e) { console.log(`k ${k} seed ${sd}: ERROR ${String(e && e.message || e).slice(0, 100)}`); await b.ctx.close().catch(() => {}); b = await LP.openLeg(E, 1, 0); }
      }
      await b.ctx.close().catch(() => {});
    }
  } finally { await E.close(); }
})();
