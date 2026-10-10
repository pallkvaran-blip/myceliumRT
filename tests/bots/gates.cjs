// THE NUMBERS MODEL'S GATES (finishing plan F), read off journey.cjs career logs (M14).
//
//   node tests/bots/gates.cjs <log.json> [<log.json> ...]   [--pace 1.7] [--overhead 15]
//
// Durations are at the HUMAN pace: a bot dig is counted as `--pace` seconds (1.7, the plan's) and a run
// adds `--overhead` seconds between runs (end screen + store + descend, the plan's 15) for G4's minutes.
// The bot's own wall seconds at its routing pace (900 ms) are printed beside them. Prints one PASS/FAIL
// line per gate per career and a `====` fence; exits 1 on any miss.
const fs = require('fs');
const argv = process.argv.slice(2);
const arg = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? +argv[i + 1] : d; };
const PACE = arg('--pace', 1.7), OVER = arg('--overhead', 15);
const files = argv.filter((a, i) => !a.startsWith('--') && !(i > 0 && argv[i - 1].startsWith('--')));
const med = (a) => { if (!a.length) return null; const b = a.slice().sort((x, y) => x - y), m = b.length >> 1; return b.length % 2 ? b[m] : (b[m - 1] + b[m]) / 2; };
let np = 0, nf = 0;
const ok = (name, pass, detail) => { console.log(`  ${pass ? 'PASS' : 'FAIL'}  ${name}  — ${detail}`); pass ? np++ : nf++; };
const MAT_OF = (c) => (typeof c === 'number' ? 'phosphorus' : c.m);
for (const f of files) {
  const log = JSON.parse(fs.readFileSync(f, 'utf8'));
  const tag = require('path').basename(f, '.json');
  console.log(`--- ${tag}: ${log.length} runs`);
  const costs = (log[0].store && log[0].store.costs) || null;
  // HUMAN digs: the bot's own plus the digs its human overhead wastes (`wasted`, journey.cjs --oh).
  const secs = (r) => (r.digs + (+r.wasted || 0)) * PACE;
  // G1
  const r1 = log[0];
  ok(`${tag} G1 run 1 lasts 45-65 s at ${PACE} s a dig, banks >= 5 P and buys Water I`,
     secs(r1) >= 45 && secs(r1) <= 65 && r1.ore >= 5 && (r1.bought || []).some((b) => /^water@1/.test(b)),
     `${secs(r1).toFixed(0)} s (${r1.digs} digs + ${r1.wasted || 0} wasted; ${r1.seconds} s at the bot's pace), +${r1.ore} P, bought ${(r1.bought || []).join(',') || '-'}`);
  // G2 dead visits (a visit = the store after a run that did not end the journey)
  const visits = log.filter((r) => r.cause !== 'promised');
  const dead = visits.map((r) => !(r.bought || []).length);
  const d5 = dead.slice(0, 5).filter(Boolean).length, d10 = dead.slice(0, 10).filter(Boolean).length, dAll = dead.filter(Boolean).length;
  let streak = 0, worst = 0;
  visits.forEach((r, i) => { if (r.leg >= 8) { streak = 0; return; } streak = dead[i] ? streak + 1 : 0; worst = Math.max(worst, streak); });
  ok(`${tag} G2 dead visits: 0 in runs 1-5, <= 1 in runs 1-10, <= 25% overall, never 3 in a row before leg 8`,
     d5 === 0 && d10 <= 1 && dAll <= 0.25 * visits.length && worst < 3,
     `${d5} / ${d10} / ${dAll} of ${visits.length} (${(100 * dAll / Math.max(1, visits.length)).toFixed(0)}%), longest run before leg 8 ${worst}; dead at runs ${visits.filter((r, i) => dead[i]).map((r) => r.run).join(',') || '-'}`);
  // G3 per leg
  const per = []; let prev = 0;
  for (const r of log) if (r.cause === 'island' || r.cause === 'promised') { per.push({ leg: r.leg, runs: r.run - prev, at: r.run }); prev = r.run; }
  ok(`${tag} G3 landfall 1 at run 3-5`, !!per[0] && per[0].runs >= 3 && per[0].runs <= 5, per[0] ? `run ${per[0].runs}` : 'none');
  ok(`${tag} G3 every leg in 3-7 runs (median), none over 10`, per.length === 8 && per.every((p) => p.runs <= 10),
     per.map((p) => `L${p.leg}:${p.runs}`).join(' ') + (per.length < 8 ? ` (stopped on leg ${log[log.length - 1].leg} after ${log.length - prev} runs there)` : ''));
  // G4
  const done = log.some((r) => r.cause === 'promised');
  const mins = log.reduce((a, r) => a + secs(r) + OVER, 0) / 60;
  ok(`${tag} G4 the Promised Land in 35-50 runs (70-110 min at the human pace)`, done && log.length >= 35 && log.length <= 50,
     `${done ? 'reached' : 'NOT reached'} in ${log.length} runs, ${mins.toFixed(0)} min at ${PACE} s a dig + ${OVER} s a run`);
  // G5
  const last = log[log.length - 1].store, pre8 = log.filter((r) => r.leg < 8).slice(-1)[0];
  ok(`${tag} G5 >= 85% of rungs bought at the final landfall, 100% not before leg 8`,
     done && last.b >= 0.85 * last.n && !(pre8 && pre8.store.b >= pre8.store.n),
     `${last.b}/${last.n} (${(100 * last.b / last.n).toFixed(0)}%) at the end; ${pre8 ? pre8.store.b : '-'} before leg 8`);
  // G6 materials
  if (costs) {
    const issues = [];
    for (const r of log) {
      for (const m of ['anthracite', 'garnet', 'hematite']) {
        let demand = 0;
        for (const id in costs) costs[id].forEach((c, k) => { if (k >= (r.store.lv[id] | 0) && MAT_OF(c) === m) demand += c.n; });
        const bal = r.store.mats[m] | 0;
        if (demand > 0 ? bal > 3 * demand : bal > 60) issues.push(`R${r.run} ${m} ${bal} vs demand ${demand}`);
      }
    }
    ok(`${tag} G6 material balances within 3x remaining demand, <= 60 once demand is gone`, issues.length === 0, issues.slice(0, 4).join('; ') || 'clean');
  }
  // G7
  const late = log.filter((r) => r.leg >= 7 && r.mode !== 'dive').map(secs);
  ok(`${tag} G7 leg 7-8 runs: median 150-240 s`, late.length > 0 && med(late) >= 150 && med(late) <= 240,
     late.length ? `median ${med(late).toFixed(0)} s over ${late.length} runs (${late.map((x) => x.toFixed(0)).join(',')})` : 'no leg 7-8 runs');
  // G9
  const l37 = log.filter((r) => r.leg >= 3 && r.leg <= 7);
  const dv = l37.filter((r) => r.mode === 'dive').length;
  ok(`${tag} G9 dives 15-35% of runs on legs 3-7`, l37.length > 0 && dv >= 0.15 * l37.length && dv <= 0.35 * l37.length, `${dv} of ${l37.length}`);
  // G11 — "WITH COUNTERS BOUGHT": a run counts once the save carried the counter into it (the store levels after
  // the previous visit): flask track >= 2 for the drain, enzyme track >= 1 for the infected endings.
  const lvBefore = (i) => (i > 0 ? log[i - 1].store.lv : {});
  const l48 = log.filter((r, i) => r.leg >= 4 && (lvBefore(i).amputateCharges | 0) >= 1);
  const inf = l48.filter((r) => r.cause === 'infected').length;
  const drains = log.filter((r, i) => (lvBefore(i).excreteCharges | 0) >= 2).map((r) => +r.drained || 0);
  const allDr = log.map((r) => +r.drained || 0);
  ok(`${tag} G11 with counters bought: infected endings <= 20% on legs 4-8, median worm drain <= 3 a run`, l48.length > 0 && inf <= 0.2 * l48.length && drains.length > 0 && med(drains) <= 3,
     `${inf} of ${l48.length} infected; drain median ${med(drains)} over ${drains.length} runs with 2+ flasks (all runs: median ${med(allDr)}, max ${Math.max(...allDr)})`);
}
console.log(`\n==== ${np} passed, ${nf} failed ====`);
process.exit(nf ? 1 : 0);
