// THE ENDING SWEEP (finishing plan M1, acceptance 4): does every descent end by itself?
//
// One descent per seed, each on a FRESH save, played by the route-planning bot (lib.cjs) at a
// human-ish pace through `botrun.cjs`'s `playDescent`. That function already detects the two stall
// shapes the phase-1 playtests found (the dry-for-deep soft lock, and "no frontier") and then SITS
// for `sitMs` to see whether anything ends the run; if nothing does it tries a recovery and finally
// presses Settings > End run. So the two properties M1 promises are read straight off its record:
//   - every run reaches runOver by itself: over, with no forced End run;
//   - every stall ends while sitting.
// Before M1 this measured 14 of 39 runs sitting live and idle for 30-60 s.
//
//   NODE_PATH=/opt/node22/lib/node_modules node tests/bots/sweep.cjs [seed ...]
//
// Slow (~1-2 min a seed); registered in run.mjs as the slow 'sweep' check, not in --mine.
const fs = require('fs');
const { OUT, launch, bootMine } = require('./lib.cjs');
const { playDescent } = require('./botrun.cjs');
const SEEDS = process.argv.slice(2).map(Number).filter((n) => n > 0);
const seeds = SEEDS.length ? SEEDS : [4242, 909, 11, 1234, 777, 31337, 5, 2024, 7, 99, 123, 2026];
let pass = 0, fail = 0;
const ok = (n, c, x) => { c ? (pass++, console.log('  PASS  ' + n + (x ? '  — ' + x : ''))) : (fail++, console.log('  FAIL  ' + n + (x ? '  — ' + x : ''))); };

(async () => {
  const env = await launch();
  const rows = [];
  for (const seed of seeds) {
    const m = await bootMine(env, seed);
    const res = await playDescent(m.page, { label: 'sweep-' + seed, paceMs: 900, bot: { useItems: true }, sitMs: 8000 });
    const forced = !!(res.sat && res.sat.forcedEnd);
    const recovered = !!(res.sat && res.sat.recovery);
    const row = { seed, seconds: res.seconds, digs: res.digs, depth: res.end.depth, maxDepth: res.maxDepth,
      over: res.end.over, cause: res.end.cause, stalled: res.boxedAt ? res.boxedAt.why : null,
      stallAt: res.boxedAt ? res.boxedAt.t : null,
      endedWhileSitting: res.sat ? !!res.sat.endedWhileSitting : null, recovered, forced,
      screen: res.screen ? res.screen.slice(0, 90) : null, errs: m.errs.slice(0, 3) };
    rows.push(row);
    console.log(`seed ${seed}: ${row.seconds}s ${row.digs} digs ${row.depth}/${row.maxDepth} m, over=${row.over} cause=${row.cause}`
      + (row.stalled ? ` | stalled (${row.stalled}) at ${row.stallAt.toFixed(1)} s, ended while sitting: ${row.endedWhileSitting}` : ' | no stall')
      + (forced ? ' | FORCED End run' : '') + (recovered ? ' | needed recovery digs' : ''));
    await m.ctx.close();
  }
  fs.writeFileSync(`${OUT}/sweep.json`, JSON.stringify(rows, null, 1));
  console.log('');
  for (const r of rows) {
    ok(`seed ${r.seed}: the descent reached runOver by itself`, r.over && !r.forced && !r.recovered,
       `${r.cause}, ${r.depth} m after ${r.digs} digs / ${r.seconds} s${r.forced ? ', forced' : ''}`);
    ok(`seed ${r.seed}: no page errors`, r.errs.length === 0, r.errs.join(' | ') || 'clean');
  }
  const stalls = rows.filter((r) => r.stalled);
  ok('every stall ended while sitting', stalls.every((r) => r.endedWhileSitting === true),
     `${stalls.filter((r) => r.endedWhileSitting).length} of ${stalls.length} stalls` + (stalls.length ? ': ' + stalls.map((r) => r.seed + ' ' + r.stalled).join('; ') : ''));
  const causes = {};
  for (const r of rows) causes[r.cause] = (causes[r.cause] || 0) + 1;
  console.log('causes', JSON.stringify(causes), '| trace', `${OUT}/sweep.json`);
  await env.close();
  console.log(`\n==== ${pass} passed, ${fail} failed ====`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('HARNESS ERROR', e); process.exit(1); });
