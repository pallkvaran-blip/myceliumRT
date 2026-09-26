/* M6 ACCEPTANCE 7 — threats in a career. Runs `career.cjs <seed> 12 kit` for each seed (the bot uses
 * its items: a flask as soon as a worm attaches, a dose on the rot; the store buys the first rung of the
 * flask and the enzyme as soon as each is offered, then the cheapest rung), then reads the logs:
 *   - infected endings in runs 4-12 are 20% or fewer (the phase-1 playtest saw about half);
 *   - the median worm drain per run (`mine.drained()`, the water owed to worms) is 3 or less.
 *
 *     node tests/bots/threatcareer.cjs [seeds=4242,909,11] [runs=12]
 *
 * Slow (~12-15 min a seed, one at a time: the bot is wall-clock sensitive). Not in the runner.
 */
const { spawnSync } = require('child_process');
const fs = require('fs'), path = require('path');
const { OUT } = require('./lib.cjs');
const seeds = (process.argv[2] || '4242,909,11').split(',').map(Number);
const runs = +(process.argv[3] || 12);
const env = Object.assign({}, process.env, { NODE_PATH: process.env.NODE_PATH || '/opt/node22/lib/node_modules' });
const rows = [];
for (const seed of seeds) {
  const tag = `threat-kit-${seed}`;
  if (!process.env.REUSE) {
    const r = spawnSync(process.execPath, [path.join(__dirname, 'career.cjs'), String(seed), String(runs), 'kit', tag], { env, encoding: 'utf8', timeout: 45 * 60000 });
    process.stdout.write((r.stdout || '').split('\n').filter((l) => /^R\d+|errors/.test(l)).join('\n') + '\n');
  }
  const log = JSON.parse(fs.readFileSync(path.join(OUT, tag + '.json'), 'utf8'));
  for (const x of log) rows.push(Object.assign({ career: seed }, x));
}
const late = rows.filter((r) => r.run >= 4);
const inf = late.filter((r) => r.cause === 'infected').length;
const drains = rows.map((r) => +r.drained || 0).sort((a, b) => a - b);
const med = drains.length ? (drains[(drains.length - 1) >> 1] + drains[drains.length >> 1]) / 2 : NaN;
const causes = {}; for (const r of rows) causes[r.cause] = (causes[r.cause] || 0) + 1;
const flasks = rows.filter((r) => (r.itemsUsed || []).some((a) => /^excrete/.test(a))).length;
const doses = rows.filter((r) => (r.itemsUsed || []).some((a) => /^amputate/.test(a))).length;
console.log(`runs ${rows.length}, causes ${JSON.stringify(causes)}, runs using a flask ${flasks}, a dose ${doses}`);
console.log('drain per run: ' + rows.map((r) => (+r.drained || 0).toFixed(1)).join(' '));
let pass = 0, fail = 0;
const ok = (n, c, x) => { c ? pass++ : fail++; console.log(`  ${c ? 'PASS' : 'FAIL'}  ${n}  — ${x}`); };
ok('infected endings in runs 4-12 are 20% or fewer', late.length && inf / late.length <= 0.2, `${inf} of ${late.length} (${(100 * inf / Math.max(1, late.length)).toFixed(0)}%)`);
ok('the median worm drain per run is 3 water or less', med <= 3, `median ${med.toFixed(2)} over ${drains.length} runs`);
console.log(`\n==== ${pass} passed, ${fail} failed ====`);
process.exit(fail ? 1 : 0);
