// STORESIM (M14) — replay a career's INCOME against a candidate price table. A tool: prints, never fails.
//
//   node tests/bots/storesim.cjs <career.json> [--costs table.json] [--strat cheapest|power|knowledge] [--scale-mat m=f ...]
//
// The career log (journey.cjs) gives, per run, what was EARNED (ore = the P banked; mats) and when each track
// became visible (the run the real buyer first bought it, or for a material compass the first run that earned
// its material). The tool re-runs the buyer against `--costs` (default: the log's own `store.costs`), and reports
// what the plan's gates read off the store: dead visits (G2), the share bought by the end and before leg 8 (G5),
// and material balances against remaining demand (G6). It ignores the feedback a different shelf would have on
// the runs themselves (more water -> farther), so it is a first-order screen for a price table, not a career.
const fs = require('fs');
const argv = process.argv.slice(2);
const arg = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d; };
const log = JSON.parse(fs.readFileSync(argv[0], 'utf8'));
const costs = arg('--costs', null) ? JSON.parse(fs.readFileSync(arg('--costs'), 'utf8')) : log[0].store.costs;
const strat = arg('--strat', 'cheapest');
const scale = {}; argv.forEach((a, i) => { if (a === '--scale-mat') { const [m, f] = argv[i + 1].split('='); scale[m] = +f; } });
const MAT = (c) => (typeof c === 'number' ? 'phosphorus' : c.m), N = (c) => (typeof c === 'number' ? c : c.n);
// When each track became visible in the source career.
const seenAt = {};
for (const r of log) for (const b of (r.bought || [])) { const id = b.split('@')[0]; if (seenAt[id] == null) seenAt[id] = r.run; }
for (const r of log) for (const m of Object.keys(r.mats || {})) { const id = 'compass_' + m; if ((r.mats[m] | 0) > 0 && seenAt[id] == null) seenAt[id] = r.run; }
const ids = Object.keys(costs);
const lv = Object.fromEntries(ids.map((id) => [id, 0]));
const bal = { phosphorus: 0, anthracite: 0, garnet: 0, hematite: 0 };
const comp = ids.filter((id) => /compass/.test(id));
const ORDER = { power: ['growSteps', 'heatTolerance', 'water', 'excreteCharges', 'amputateCharges'].concat(comp, ['oxalicVial']),
  knowledge: comp.concat(['heatTolerance', 'excreteCharges', 'amputateCharges', 'water', 'growSteps', 'oxalicVial']) };
let dead = 0, dead10 = 0, streak = 0, worst = 0, pre8 = null, issues = [];
const rows = [];
for (const r of log) {
  if (r.cause === 'promised') break;
  bal.phosphorus += r.ore | 0;
  for (const m of ['anthracite', 'garnet', 'hematite']) bal[m] += Math.round((r.mats && r.mats[m] | 0) * (scale[m] || 1));
  const got = [];
  for (let k = 0; k < 40; k++) {
    let pick = null, pc = Infinity;
    const order = strat === 'cheapest' ? ids : ORDER[strat];
    if (!lv.water && costs.water) { pick = 'water'; }
    else for (const id of order) {
      if (seenAt[id] == null || seenAt[id] > r.run) continue;
      const c = costs[id][lv[id]]; if (c == null) continue;
      if (bal[MAT(c)] < N(c)) continue;
      const eff = MAT(c) === 'phosphorus' ? N(c) : N(c) * 5;
      if (strat === 'cheapest' ? eff < pc : pick == null) { pc = eff; pick = id; }
    }
    if (!pick) break;
    const c = costs[pick][lv[pick]]; if (c == null || bal[MAT(c)] < N(c)) break;
    bal[MAT(c)] -= N(c); lv[pick]++; got.push(pick + '@' + lv[pick]);
  }
  const isDead = !got.length;
  if (isDead) { dead++; if (r.run <= 10) dead10++; }
  streak = isDead && r.leg < 8 ? streak + 1 : 0; worst = Math.max(worst, streak);
  for (const m of ['anthracite', 'garnet', 'hematite']) {
    let demand = 0; for (const id of ids) costs[id].forEach((c, k) => { if (k >= lv[id] && MAT(c) === m) demand += N(c); });
    if (demand > 0 ? bal[m] > 3 * demand : bal[m] > 60) issues.push(`R${r.run} ${m} ${bal[m]} vs ${demand}`);
  }
  const total = ids.reduce((a, id) => a + costs[id].length, 0), b = ids.reduce((a, id) => a + lv[id], 0);
  if (r.leg < 8) pre8 = b + '/' + total;
  rows.push(`R${r.run} L${r.leg} +${r.ore}P ${JSON.stringify(r.mats || {})} -> ${got.join(' ') || '-'} | ${b}/${total} wallet ${JSON.stringify(bal)}`);
}
if (argv.includes('--rows')) console.log(rows.join('\n'));
const total = ids.reduce((a, id) => a + costs[id].length, 0), b = ids.reduce((a, id) => a + lv[id], 0);
const visits = rows.length;
console.log(`visits ${visits}, dead ${dead} (${(100 * dead / visits).toFixed(0)}%), in runs 1-10 ${dead10}, longest dead streak before leg 8 ${worst}; bought ${b}/${total} (${(100 * b / total).toFixed(0)}%), ${pre8} before leg 8; end wallet ${JSON.stringify(bal)}`);
console.log(`G6 issues: ${issues.length ? issues.slice(0, 6).join('; ') : 'none'}`);
console.log(`unbought: ${ids.filter((id) => lv[id] < costs[id].length).map((id) => id + ' ' + JSON.stringify(costs[id].slice(lv[id]))).join(', ')}`);
