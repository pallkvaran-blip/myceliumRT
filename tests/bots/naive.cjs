// THE NAIVE NEW PLAYER — the finishing plan's M4 acceptance 7.
//
//     node tests/bots/naive.cjs [--baseline] [seed ...]
//
// One fresh-save first descent per seed (default 4242 909 11 5 31337 2024 7 99), played by lib.cjs's
// `naiveStep`: ALWAYS from the deepest clean tip (refused or not) toward the most open downward ray, one dig every
// `NAIVE_PACE` ms (900), and — unless --baseline — digging from a glowing tip while the dead-end
// nudge has tips lit. The run is played until it ends by itself (the M1 stuck rule ends a dry run).
// Asserts: median max depth >= 40 m, and the nudge fired in every run that STALLED (3 or more
// successful digs in a row that raised the max depth by nothing). --baseline prints only.
const { launch, bootMine, sleep } = require('./lib.cjs');
const argv = process.argv.slice(2);
const BASE = argv.includes('--baseline');
const seeds = argv.filter((a) => /^\d+$/.test(a)).map(Number);
const SEEDS = seeds.length ? seeds : [4242, 909, 11, 5, 31337, 2024, 7, 99];
const PACE = +process.env.NAIVE_PACE || 900;
let pass = 0, fail = 0;
const ok = (n, c, x) => { c ? (pass++, console.log('  PASS  ' + n + (x ? '  — ' + x : ''))) : (fail++, console.log('  FAIL  ' + n + (x ? '  — ' + x : ''))); };

(async () => {
  const env = await launch();
  const runs = [];
  try {
    for (const seed of SEEDS) {
      const b = await bootMine(env, seed);
      const t0 = Date.now();
      let digs = 0, refused = 0, flat = 0, stalled = false, maxD = 0, lastMax = 0, i = 0, consecRef = 0, gaveUp = false; const msgs = {};
      const trace = [];
      for (; i < 400; i++) {
        const r = await b.page.evaluate((o) => window.__qa.naiveStep(o), { followGlow: !BASE });
        if (r.over) break;
        consecRef = r.ok ? 0 : consecRef + 1;
        if (!r.ok) msgs[r.msg] = (msgs[r.msg] || 0) + 1;
        // A player refused 30 times in a row has left; the run is still judged by where it got to.
        if (consecRef > 30) { gaveUp = true; break; }
        if (r.ok) {
          digs++;
          if (r.maxDepth > lastMax) { flat = 0; lastMax = r.maxDepth; } else if (++flat >= 3) stalled = true;
        } else refused++;
        maxD = Math.max(maxD, r.maxDepth | 0);
        trace.push((r.mode === 'glow' ? 'g' : '') + (r.ok ? r.newCells + '@' + r.maxDepth : 'x'));
        await sleep(PACE);
      }
      // Let the run end by itself (stuck rule 6 s, fuel grace) — at most 20 s.
      for (let k = 0; k < 40; k++) { if (await b.page.evaluate(() => !!window.__game.state.runOver)) break; await sleep(500); }
      const end = await b.page.evaluate(() => ({ over: !!window.__game.state.runOver, cause: window.__game.state.runResult && window.__game.state.runResult.cause,
        max: window.__game.mine.maxDepth(), nudges: window.__game.mine.glow().nudges, ore: window.__game.state.mineOre | 0 }));
      const rec = { seed, max: end.max, digs, refused, stalled, nudges: end.nudges, over: end.over, cause: end.cause, ore: end.ore, gaveUp, s: Math.round((Date.now() - t0) / 1000) };
      runs.push(rec);
      console.log(`seed ${seed}: ${end.max} m, ${digs} digs (${refused} refused), stalled ${stalled}, nudges ${end.nudges}, ${end.cause || (gaveUp ? 'LIVE, gave up' : 'LIVE')}, ore ${end.ore}, ${rec.s} s`);
      if (process.env.NAIVE_TRACE) console.log('   ' + trace.join(' ') + '\n   refusals ' + JSON.stringify(msgs));
      await b.ctx.close();
    }
  } finally { await env.close(); }
  const ds = runs.map((r) => r.max).sort((a, b) => a - b);
  const med = ds.length % 2 ? ds[(ds.length - 1) / 2] : (ds[ds.length / 2 - 1] + ds[ds.length / 2]) / 2;
  console.log(`${BASE ? 'BASELINE (no glow-following)' : 'naive + nudge'}: median ${med} m, depths ${ds.join(' ')}`);
  if (!BASE) {
    ok('naive policy median depth >= 40 m over ' + runs.length + ' seeds', med >= 40, `median ${med} m (${ds.join(' ')})`);
    const st = runs.filter((r) => r.stalled);
    ok('the nudge fired in every run that stalled', st.length > 0 && st.every((r) => r.nudges > 0),
       `${st.filter((r) => r.nudges > 0).length} of ${st.length} stalled runs nudged`);
    ok('every run ended by itself', runs.every((r) => r.over), runs.filter((r) => !r.over).map((r) => r.seed).join(' ') || 'all');
  }
  console.log(`\n==== ${pass} passed, ${fail} failed ====`);
  process.exit(fail ? 1 : 0);
})();
