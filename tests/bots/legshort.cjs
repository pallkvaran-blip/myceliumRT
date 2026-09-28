/* WHAT A SHORTER LEG WOULD COST (M9 verify 2, for M14's calibration) — a tool: prints, never fails, not in
 * the runner. Acceptance 2 (the arrival kit reaches the taproot on <= 70% of supply) fails on legs 2, 3, 6,
 * 7 and 8, and the plan's lever for legs 7-8 is to SHORTEN them rather than cheapen the rungs. This moves
 * a leg's island in chunk by chunk on the SAME seed (`E` and `eastM` on the live CONFIG row before the leg
 * is played: the chunks west of the island are the same chunks, only the island chunk moves) and runs
 * legprobe's `kitWater` with the table's arrival kit at each length. It measures the map as it is, not a
 * re-picked one: PASS/WPASS are not re-checked, so a length that reads well still needs a seed pick.
 *
 * The fractions EXCLUDE THE WORM DRAIN: `navigate` removes every creature before it digs, so a real run
 * with the leg's worms attached spends more than this.
 *
 *   node tests/bots/legshort.cjs --legs 6,7,8 [--cut 0,1,2,3,4] [--depth -6]   (depth: move the knot up N m too)
 */
const H = require('../mine-harness.cjs');
const LP = require('./legprobe.cjs');
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const legs = arg('--legs', '6,7,8').split(',').map(Number);
const cuts = arg('--cut', '0,1,2,3').split(',').map(Number);
const dDepth = +arg('--depth', 0);
(async () => {
  const E = await H.start();
  try {
    for (const leg of legs) {
      const b = await LP.openLeg(E, leg, 0);
      const row0 = await b.page.evaluate((l) => JSON.parse(JSON.stringify(window.__cfg.mine.journey.legs.find((r) => r.leg === l))), leg);
      const cw = await b.page.evaluate(() => window.__cfg.mine.chunkCols);
      for (const c of cuts) {
        const Ez = row0.E - c;
        if (Ez < 2) continue;
        await b.page.evaluate(([l, Ez, eastM, depthM]) => { const r = window.__cfg.mine.journey.legs.find((x) => x.leg === l); r.E = Ez; r.eastM = eastM; r.depthM = depthM; },
          [leg, Ez, Ez * cw, row0.depthM + dDepth]);
        let kit = null;
        try { kit = await LP.kitWater(b.page, leg, row0.seed, LP.KIT[leg] || LP.KIT[8]); } catch (e) { kit = { error: String(e && e.message || e).slice(0, 100) }; }
        console.log(`leg ${leg} E ${Ez} (${Ez * cw} m east, ${row0.depthM + dDepth} m deep): ` + (kit.error ? 'ERROR ' + kit.error
          : `frac ${kit.frac} (spent ${kit.spent} of ${kit.supply}: start ${kit.startWater} + 5 x ${kit.pockets} pockets), landed ${kit.landed}, ${kit.digs} digs, east below 84 m ${kit.east84}`));
      }
      await b.page.evaluate(([l, r0]) => { Object.assign(window.__cfg.mine.journey.legs.find((x) => x.leg === l), r0); }, [leg, row0]);
      await b.ctx.close();
    }
  } catch (e) { console.log('tool error: ' + (e && e.stack || e)); }
  await E.close();
})();
