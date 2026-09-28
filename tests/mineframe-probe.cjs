/* WHAT A MINE FRAME COSTS, BY STEP, ON A LATE LEG (M9 verify) — a tool: prints, never fails, not in the
 * runner. legs-check gates `mineFrame` on its MEDIAN (<= 2 ms at 4,000 strands); this says what the
 * p95 and the max are made of. It builds the same leg-8 state as legs-check's perf block (legprobe's
 * navigator toward the knot, then digs from spread strands to >= 4,000), lets the real frame loop run
 * for `SECS` (default 6), and CPU-profiles it: the inclusive time of each function called directly by
 * `mineFrame`, and the per-frame distribution (`mine.frameMs()`, split by whether a world tick ran).
 *
 *   node tests/mineframe-probe.cjs [leg=8] [nodes=4200]     (SECS=6, SETTLE=2500 ms before profiling)
 */
const H = require('./mine-harness.cjs');
const LP = require('./bots/legprobe.cjs');
const LEG = +(process.argv[2] || 8), NODES = +(process.argv[3] || 4200), SECS = +(process.env.SECS || 6);
const pct = (a, q) => { const b = a.slice().sort((x, y) => x - y); return b.length ? b[Math.min(b.length - 1, Math.floor(q * b.length))] : NaN; };
(async () => {
  const E = await H.start();
  try {
    const b = await LP.openLeg(E, LEG, 0);
    await LP.measure(b.page);
    await LP.navigate(b.page, { maxDigs: 400, stopWithin: 900 });
    const fill = await b.page.evaluate(async (want) => {
      const g = window.__game, s = g.state, net = s.active, t = g.mine.taproot();
      let k = 0;
      while (net.nodes.length < want && k < 900 && !s.runOver) {
        k++;
        const live = net.nodes.filter((n) => !n.infected && Math.hypot(n.x - t.x, n.y - t.y) > 700);
        const src = live[(k * 7919) % live.length], a = (k * 2.39996) % (Math.PI * 2);
        net.water = 9999;
        g.mine.growFrom(src.x, src.y, src.x + Math.cos(a) * 200, src.y + Math.sin(a) * 200);
        if (k % 10 === 0) await new Promise((q) => setTimeout(q, 0));
      }
      s.active.water = 9999;
      return { nodes: net.nodes.length, over: s.runOver };
    }, NODES);
    console.log('state:', JSON.stringify(fill));
    await H.sleep(+(process.env.SETTLE != null ? process.env.SETTLE : 2500));   // SETTLE=0: profile the reveal the fill left in flight
    const cdp = await b.ctx.newCDPSession(b.page);
    await cdp.send('Profiler.enable'); await cdp.send('Profiler.setSamplingInterval', { interval: 100 }); await cdp.send('Profiler.start');
    await b.page.evaluate(() => { window.__game.state._mineFrameMs = []; });
    await H.sleep(SECS * 1000);
    const { profile } = await cdp.send('Profiler.stop');
    const mf = await b.page.evaluate(() => ({ mf: window.__game.mine.frameMs(), gen: (window.__game.mine.genLog ? window.__game.mine.genLog() : []).length }));
    const all = mf.mf.map((x) => x[0]), tick = mf.mf.filter((x) => x[1]).map((x) => x[0]), noTick = mf.mf.filter((x) => !x[1]).map((x) => x[0]);
    const f = (a) => `n ${a.length} med ${pct(a, 0.5)} p90 ${pct(a, 0.9)} p95 ${pct(a, 0.95)} max ${Math.max(...a)}`;
    console.log('mineFrame all:     ' + f(all));
    console.log('  with a tick:     ' + f(tick));
    console.log('  without a tick:  ' + f(noTick));
    console.log('  slowest frames:  ' + mf.mf.slice().sort((a, c) => c[0] - a[0]).slice(0, 8).map((x) => x[0] + (x[1] ? 't' : '')).join(' '));
    const byId = new Map(profile.nodes.map((n) => [n.id, n])), parent = new Map();
    for (const n of profile.nodes) for (const c of (n.children || [])) parent.set(c, n.id);
    const dt = profile.timeDeltas, counts = new Map();
    profile.samples.forEach((id, k) => counts.set(id, (counts.get(id) || 0) + (dt[k] || 0)));
    // Inclusive time of each DIRECT child of mineFrame (and of mineFrame itself).
    const incl = new Map(); let tot = 0;
    for (const [id, us] of counts) {
      let p = id, child = byId.get(id).callFrame.functionName || '(anon)';
      while (p != null) {
        const nm = byId.get(p).callFrame.functionName;
        if (nm === 'mineFrame') { tot += us; if (p !== id) incl.set(child, (incl.get(child) || 0) + us); else incl.set('(self)', (incl.get('(self)') || 0) + us); break; }
        child = nm || '(anon)'; p = parent.get(p);
      }
    }
    console.log(`profiled mineFrame inclusive: ${(tot / 1000).toFixed(1)} ms over ${SECS} s`);
    [...incl.entries()].sort((a, c) => c[1] - a[1]).slice(0, 16).forEach(([k, us]) => console.log(`   ${(us / 1000).toFixed(2).padStart(7)} ms  ${k}`));
    await b.ctx.close();
  } catch (e) { console.log('probe error: ' + (e && e.stack || e)); }
  await E.close();
})();
