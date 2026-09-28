/* HOW MANY TIMES A FRAME WALKS THE WHOLE COLONY (M9 verify 2) — a tool: prints, never fails, not in the
 * runner. `mine.passes()` counts only the walks the mine's own frame code declares; this counts every
 * indexed read of `net.nodes` (legprobe's `censusInstall`, a Proxy: for-of, the array methods and plain
 * index loops alike) as EQUIVALENT PASSES (reads / length), per rAF frame, split by whether a world tick ran
 * in the frame, with the caller of each pass. The state is legs-check's perf state (leg 8, 4,200 strands,
 * threats put back, optionally a rotten patch).
 *
 *   node tests/nodepass-probe.cjs [nodes=4200] [rot=0]      (SECS=4)
 */
const H = require('./mine-harness.cjs');
const LP = require('./bots/legprobe.cjs');
const NODES = +(process.argv[2] || 4200), ROT = +(process.argv[3] || 0), SECS = +(process.env.SECS || 4);
(async () => {
  const E = await H.start();
  try {
    const b = await LP.openLeg(E, 8, 0);
    await LP.measure(b.page);
    const st = await LP.perfState(b.page, { want: NODES, threats: true, rot: ROT });
    console.log('state:', JSON.stringify(st.fill));
    await H.sleep(2500);
    await LP.censusInstall(b.page);
    const c = await LP.censusRead(b.page, SECS * 1000);
    const f = (x) => `${x.frames} frames, equivalent passes median ${x.median} p95 ${x.p95} max ${x.max}\n      per frame by caller ${JSON.stringify(x.whyPerFrame)}`;
    console.log('  no-tick frames: ' + f(c.noTick));
    console.log('  tick frames:    ' + f(c.tick));
    console.log('  mine.passes():  ' + JSON.stringify(await b.page.evaluate(() => window.__game.mine.passes())));
  } catch (e) { console.log('probe error: ' + (e && e.stack || e)); }
  await E.close();
})();
