/* JOURNEYKIT — do the New Journey rules bite a full kit? (M13's risk: "run legprobe margins on J2").
 * A tool: prints, never fails. Not in the runner.
 *
 *   NODE_PATH=/opt/node22/lib/node_modules node tests/bots/journeykit.cjs [--journey 2] [--legs 1,...,8]
 *
 * For each leg it takes journey J's curated table seed and runs legprobe's `kitWater` (the re-planning
 * navigator, real growth, the dig prices of the run's config) with the FULL kit (KIT[8]: water 8, grow 4,
 * heat 4, flasks and doses — what a player who finished Journey I carries) TWICE ON THE SAME MAP: once under
 * Journey I's rules and once under journey J's. Same map, same kit, so the difference is the rules alone.
 * `frac` = water spent / supply (start water + 5 x the route's pockets); the calibration rule's bar is 0.70.
 * Thirsty (III+) shrinks the supply by 12: it is applied to the supply here because `kitWater` reads
 * CONFIG's base start water.
 */
const H = require('../mine-harness.cjs');
const LP = require('./legprobe.cjs');

(async () => {
  const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
  const J = +arg('--journey', 2);
  const legs = arg('--legs', '1,2,3,4,5,6,7,8').split(',').map(Number);
  const E = await H.start();
  const rows = [];
  try {
    for (const leg of legs) {
      LP.setJourney(J);
      let b = await LP.openLeg(E, leg, 0);
      const seed = await b.page.evaluate(() => window.__game.mine.leg().seed);
      const out = { leg, seed };
      for (const jj of [1, J]) {
        try {
          LP.setJourney(jj);
          const k = await LP.kitWater(b.page, leg, seed, LP.KIT[8]);
          const thirsty = jj >= 3 ? 12 : 0;
          const supply = k.supply - thirsty;
          out['J' + jj] = { spent: k.spent, supply, frac: +(k.spent / supply).toFixed(3), landed: k.landed, digs: k.digs };
        } catch (e) {
          out['J' + jj] = { error: String(e && e.message || e).slice(0, 100) };
          await b.ctx.close().catch(() => {}); b = await LP.openLeg(E, leg, 0);
        }
      }
      rows.push(out);
      console.log(JSON.stringify(out));
      await b.ctx.close().catch(() => {});
    }
  } finally { await E.close(); }
  console.log('RESULT ' + JSON.stringify(rows));
})();
