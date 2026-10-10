/* LEG1PICK (M14) — re-pick leg 1, the tutorial leg, for a NEW player: the naive journey policies (lib.cjs
 * `naiveStep`, `lean: 'east'` and the original down-east) must land it. A tool: prints, never fails.
 *
 *   NODE_PATH=/opt/node22/lib/node_modules node tests/bots/leg1pick.cjs [--from 0] [--to 60] [--E 3] [--depth 18]
 *                                           [--seal 0.12] [--ratio 1.0] [--grow 2] [--cap 160] [--seed N]
 *
 * Each candidate (legprobe's leg-1 sequence, or `--seed N`) is played with the leg row overridden on the live
 * CONFIG (`E`, `eastM` = 24 x E, `depthM`, band-0 `sealByBand`), gated with legprobe's PASS with the path-ratio
 * floor relaxed to `--ratio` (leg 1 is the tutorial leg: a straighter shallow road is the point) plus WPASS,
 * and then SCREENED with both naive policies the way legnaive.cjs does (one run, tank topped up, the water spent
 * counted, threats off) — at grow `--grow` (a new player's first runs: 2). Landed + water spent is printed per
 * policy; a seed whose worse policy lands under ~60-80 water is a run-1-to-3 landing on a fresh save.
 */
const H = require('../mine-harness.cjs');
const LP = require('./legprobe.cjs');
const { screen } = require('./legnaive.cjs');
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const E_ = +arg('--E', 4), depth = +arg('--depth', 24), seal = +arg('--seal', 0.12), rmin = +arg('--ratio', 1.0), grow = +arg('--grow', 2);
const setRow = (page) => page.evaluate(([E_, depth, seal]) => {
  const r = window.__cfg.mine.journey.legs[0];
  r.E = E_; r.eastM = 24 * E_; r.depthM = depth; r.sealByBand = [seal, 0.12, 0.12];
}, [E_, depth, seal]);
const passRelaxed = (m) => m.reach && m.reachLat && m.ratio >= rmin && m.ratio <= 2.0 && m.ratioFine >= rmin && m.ratioFine <= 2.0
  && m.crustMaxCol <= m.homeCol + 30 && m.lateral <= 36 && m.seamRunRows <= 42 && m.sealLeak === 0 && m.shallowMaxCol >= m.islandC0;
(async () => {
  const E = await H.start();
  const both = async (sd) => {
    const out = {};
    for (const lean of ['east', null]) {
      const b = await LP.openLeg(E, 1, 0);
      await setRow(b.page); await LP.playLeg(b.page, 1, sd);
      out[lean || 'downeast'] = await screen(b.page, lean, grow);
      await b.ctx.close();
    }
    return out;
  };
  try {
    const seeds = arg('--seed', null) != null ? [[-1, +arg('--seed')]]
      : Array.from({ length: +arg('--to', 60) - +arg('--from', 0) }, (_, i) => { const k = +arg('--from', 0) + i; return [k, ((1 * 7919 + k * 104729 + 12345) % 2147483000) + 1]; });
    let b = await LP.openLeg(E, 1, 0); let n = 0;
    for (const [k, sd] of seeds) {
      try {
        if (n++ % 6 === 0) { await b.ctx.close().catch(() => {}); b = await LP.openLeg(E, 1, 0); }
        await setRow(b.page); await LP.playLeg(b.page, 1, sd);
        const m = await LP.measure(b.page);
        let ok = passRelaxed(m), w = null;
        if (ok) { w = await LP.world(b.page); ok = LP.WPASS(w); }
        let sc = '';
        if (ok) { const r = await both(sd); sc = ' | ' + JSON.stringify(r); }
        console.log(`k ${k} seed ${sd}: ${ok ? 'PASS' : '    '} ratio ${m.ratio}/${m.ratioFine} shallow ${m.shallowMaxCol}/${m.islandC0} crust ${m.crustMaxCol} lat ${m.lateral} water ${m.water}${w ? ` world lat ${w.lateral} ore ${w.pilesOk}/${w.piles}` : ''}${sc}`);
      } catch (e) { console.log(`k ${k} seed ${sd}: ERROR ${String(e && e.message || e).slice(0, 120)}`); await b.ctx.close().catch(() => {}); b = await LP.openLeg(E, 1, 0); }
    }
    await b.ctx.close().catch(() => {});
  } finally { await E.close(); }
})();
