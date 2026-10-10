// THE M14 ACCEPTANCE RUNNER (finishing plan M14 / numbers-model section F). Slow: hours. Not in --mine.
//
//   node tests/bots/m14.cjs naive                 # the new-player gate: journey.cjs --naive, both leans, 5 fresh
//                                                 # saves each, leg 1 within 5 runs on >= 3 of 5 (M8 acceptance 3c)
//   node tests/bots/m14.cjs careers [labels...]   # full journeys: journey.cjs (sensible, the plan's human overhead,
//                                                 # threat-avoiding routes) for each label, then gates.cjs over them
//   node tests/bots/m14.cjs gates <log.json>...   # gates.cjs only, on existing career logs
//
// A label's buyer is read off its prefix: 'p…' power-first, 'k…' knowledge-first, anything else cheapest.
// Logs and per-run lines go to $BOT_OUT (lib.cjs's OUT). Prints PASS/FAIL lines and the `====` fence.
const { spawnSync } = require('child_process');
const path = require('path');
const { OUT } = require('./lib.cjs');
const J = path.join(__dirname, 'journey.cjs'), G = path.join(__dirname, 'gates.cjs');
const env = Object.assign({}, process.env, { NODE_PATH: process.env.NODE_PATH || '/opt/node22/lib/node_modules' });
const argv = process.argv.slice(2), mode = argv[0] || 'naive';
let np = 0, nf = 0;
const ok = (n, c, x) => { console.log(`  ${c ? 'PASS' : 'FAIL'}  ${n}${x ? '  — ' + x : ''}`); c ? np++ : nf++; };
if (mode === 'naive') {
  for (const lean of ['east', 'downeast']) {
    let landed = 0; const runs = [];
    for (const sv of ['n1', 'n2', 'n3', 'n4', 'n5']) {
      const r = spawnSync('node', [J, sv, '--naive', '--lean', lean, '--legs', '1', '--need', '5', '--runs', '5'], { env, encoding: 'utf8', timeout: 1800000 });
      const m = /landfall 1: run (\d+)/.exec(r.stdout || '');
      runs.push(m ? +m[1] : null); if (m && +m[1] <= 5) landed++;
    }
    ok(`naive --lean ${lean}: leg 1 within 5 runs on >= 3 of 5 fresh saves`, landed >= 3, `${landed} of 5 (landfall on runs ${runs.map((x) => x || '-').join(', ')})`);
  }
} else {
  const logs = [];
  if (mode === 'careers') {
    for (const lab of (argv.slice(1).length ? argv.slice(1) : ['c1', 'p1', 'k1'])) {
      const strat = lab[0] === 'p' ? 'power' : lab[0] === 'k' ? 'knowledge' : 'cheapest';
      const r = spawnSync('node', [J, lab, '--strat', strat, '--legs', '8', '--need', '15,15,15,15,15,15,15,15', '--runs', '70'], { env, encoding: 'utf8', timeout: 6 * 3600000 });
      const tag = /^(journey-[^:]+):/m.exec(r.stdout || '');
      if (tag) logs.push(path.join(OUT, tag[1] + '.json')); else ok(`career ${lab} produced a log`, false, (r.stderr || '').slice(0, 200));
    }
  } else logs.push(...argv.slice(1));
  const r = spawnSync('node', [G, ...logs], { env, encoding: 'utf8' });
  process.stdout.write(r.stdout || '');
  const t = /==== (\d+) passed, (\d+) failed ====/.exec(r.stdout || '');
  if (t) { np += +t[1]; nf += +t[2]; } else ok('gates.cjs reported', false, (r.stderr || '').slice(0, 200));
}
console.log(`\n==== ${np} passed, ${nf} failed ====`);
process.exit(nf ? 1 : 0);
