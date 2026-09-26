// THE ECONOMY ACCEPTANCE — the finishing plan's M5 acceptance 1-4, played by the bots.
//
//   node tests/bots/econ.cjs run1   [--naive] [--pace N] [seed ...]   # acc. 1 (and 4 with --pace 1700)
//   node tests/bots/econ.cjs career [--strat cheapest|power|knowledge] [--runs N] [seed ...]   # acc. 2
//   node tests/bots/econ.cjs diver  [seed ...]                          # acc. 3
//
// run1: one fresh save per seed; ONE descent (the sensible route bot, or --naive: lib.cjs's
//   `naiveStep`, played until the run ends by itself), then the REAL end screen -> Store -> the Water
//   tank tile's Buy button. Asserts: banked >= 5 P and Water I bought, on every seed. With --pace it
//   also prints the median run length (acceptance 4 wants 45-65 s at 1700 ms a dig).
// career: `career.cjs`'s loop on one save per seed (default 4242 909 11, 12 runs), asserting 0 dead
//   store visits in runs 1-5, at most 1 in runs 1-10, and mean P of runs 10-12 >= 1.4x runs 1-3.
// diver: no upgrades; per seed one fresh-save descent by the diver (the sensible bot) and one by the
//   shallow farmer ({maxDepthM: 40, lateral: true}); asserts diver P >= 1.2x farmer P (summed).
//
// Prints PASS/FAIL lines and a `==== N passed, M failed ====` tally, like the checks.
const fs = require('fs');
const { OUT, sleep, launch, bootMine, injectBot } = require('./lib.cjs');
const { playDescent } = require('./botrun.cjs');

const argv = process.argv.slice(2);
const mode = argv[0] || 'run1';
const flag = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d; };
const has = (k) => argv.includes(k);
const seedArgs = argv.slice(1).filter((a, i, all) => /^\d+$/.test(a) && !/^--/.test(all[i - 1] || ''));
let pass = 0, fail = 0;
const ok = (n, c, x) => { c ? (pass++, console.log('  PASS  ' + n + (x ? '  — ' + x : ''))) : (fail++, console.log('  FAIL  ' + n + (x ? '  — ' + x : ''))); };
const median = (a) => { const s = a.slice().sort((x, y) => x - y); return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2; };

// One NAIVE descent, to its end (the M1 rules end it by themselves). Returns {seconds, digs}.
async function naiveDescent(page, paceMs) {
  const t0 = Date.now(); let digs = 0, consec = 0;
  for (let i = 0; i < 400; i++) {
    const at = Date.now();
    const r = await page.evaluate(() => window.__qa.naiveStep({}));
    if (r.over) break;
    consec = r.ok ? 0 : consec + 1;
    if (r.ok) digs++;
    if (consec > 30) break;
    await sleep(Math.max(0, paceMs - (Date.now() - at)));
  }
  for (let k = 0; k < 40; k++) { if (await page.evaluate(() => !!window.__game.state.runOver)) break; await sleep(500); }
  return { seconds: Math.round((Date.now() - t0) / 1000), digs };
}
// After the run: wait for the end screen, read what it banked, go to the store, press the Water tank's Buy.
async function bankAndBuyWater(page) {
  await page.waitForSelector('#ssMineEnd', { timeout: 30000 }).catch(() => {});
  await sleep(1200);
  const end = await page.evaluate(() => { const r = window.__game.state.runResult || {};
    return { over: !!window.__game.state.runOver, cause: r.cause, ore: r.ore | 0, reach: r.reach | 0, seams: r.seams | 0, depth: r.depth | 0, P: window.__game.store.balance() }; });
  const done = await page.$('#ssMineDone');
  if (done) await done.click();
  await page.waitForSelector('#ssDescend', { timeout: 20000 }).catch(() => {});
  await sleep(600);
  const btn = await page.$('.ss-upg[data-track="water"] .ss-upg-btn:not([disabled])');
  if (btn) await btn.click();
  await sleep(300);
  const after = await page.evaluate(() => ({ water: window.__game.store.level('water'), P: window.__game.store.balance(),
    tiles: Array.from(document.querySelectorAll('#ssUpg .ss-upg')).map((t) => t.dataset.track) }));
  return { end, after };
}

(async () => {
  const env = await launch();
  try {
    if (mode === 'run1') {
      const naive = has('--naive');
      const pace = +flag('--pace', naive ? 900 : 900);
      const SEEDS = seedArgs.length ? seedArgs.map(Number)
        : naive ? [4242, 909, 11, 5, 31337, 2024, 7, 99] : [4242, 909, 11, 5, 31337, 2024, 7, 99, 13, 21, 77, 123];
      const rows = [];
      for (const seed of SEEDS) {
        const b = await bootMine(env, seed);
        let dur;
        if (naive) dur = Object.assign(await naiveDescent(b.page, pace));
        else { const res = await playDescent(b.page, { label: `econ-run1-${seed}`, paceMs: pace, periodic: true, bot: { useItems: true } }); dur = { seconds: res.seconds, digs: res.digs }; }
        // THE RUN'S OWN LENGTH (runResult.ms: first frame -> ending), not the bot's wall clock, which
        // also counts its wait for the end screen and the settle after it (~10 s).
        dur.botSeconds = dur.seconds;
        dur.seconds = Math.round((await b.page.evaluate(() => (window.__game.state.runResult || {}).ms | 0)) / 1000);
        const r = await bankAndBuyWater(b.page);
        rows.push({ seed, ...dur, ...r.end, waterLvl: r.after.water, left: r.after.P, tiles: r.after.tiles });
        console.log(`seed ${seed}: ${dur.seconds}s (bot ${dur.botSeconds}s) ${dur.digs} digs, ${r.end.depth} m, ${r.end.cause}, banked ${r.end.ore} P (reach ${r.end.reach} + seams ${r.end.seams}), Water ${r.after.water}, left ${r.after.P} P, shelf ${r.after.tiles.join(',')}`);
        await b.ctx.close();
      }
      fs.writeFileSync(`${OUT}/econ-run1-${naive ? 'naive' : 'sensible'}-${pace}.json`, JSON.stringify(rows, null, 1));
      const who = naive ? 'naive' : 'sensible';
      ok(`${who}: run 1 banks >= 5 P on ${rows.length}/${SEEDS.length}`, rows.every((r) => r.ore >= 5), rows.map((r) => r.ore).join(' '));
      ok(`${who}: run 1 buys Water I on ${rows.filter((r) => r.waterLvl === 1).length}/${SEEDS.length}`, rows.every((r) => r.waterLvl === 1), rows.map((r) => r.waterLvl).join(' '));
      // The sensible bot's `playDescent` force-ends a run it judges boxed after its recovery digs
      // (cause 'abandon'), so "ended by itself" is only asserted for the naive loop, which never does.
      if (naive) ok(`${who}: every run 1 ended by itself`, rows.every((r) => r.over && r.cause !== 'abandon'), rows.map((r) => r.cause).join(' '));
      else console.log(`  note   causes: ${rows.map((r) => r.cause).join(' ')} ('abandon' = the bot's forced End after recovery)`);
      const med = median(rows.map((r) => r.seconds));
      console.log(`run 1 duration at pace ${pace} ms: median ${med} s (${rows.map((r) => r.seconds).join(' ')})`);
      if (has('--pace')) ok(`run 1 median length 45-65 s at pace ${pace}`, med >= 45 && med <= 65, `median ${med} s`);
    } else if (mode === 'career') {
      const strat = flag('--strat', 'cheapest');
      const runs = +flag('--runs', 12);
      const SEEDS = seedArgs.length ? seedArgs.map(Number) : [4242, 909, 11];
      for (const seed of SEEDS) {
        const { execFileSync } = require('child_process');
        const tag = `econ-career-${strat}-${seed}`;
        execFileSync(process.execPath, [require('path').join(__dirname, 'career.cjs'), String(seed), String(runs), strat, tag],
          { stdio: 'inherit', env: process.env, timeout: 3 * 3600 * 1000 });
        const log = JSON.parse(fs.readFileSync(`${OUT}/${tag}.json`, 'utf8'));
        const dead = (lo, hi) => log.filter((r) => r.run >= lo && r.run <= hi && !r.bought.length).length;
        // P BANKED per run, off the wallet: what the store held on arrival minus what the last visit
        // left (`ore` in the log is the seams' P alone — the reach payout lands at the bank).
        log.forEach((r, i) => { r.banked = (r.walletBefore.P | 0) - (i ? (log[i - 1].walletAfter.P | 0) : 0); });
        const P = (lo, hi) => { const xs = log.filter((r) => r.run >= lo && r.run <= hi).map((r) => r.banked | 0); return xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length); };
        console.log(`  banked per run: ${log.map((r) => r.banked).join(' ')}; buys per visit: ${log.map((r) => r.bought.length).join(' ')}`);
        ok(`career ${strat} seed ${seed}: 0 dead visits in runs 1-5`, log.length >= 5 && dead(1, 5) === 0, `${dead(1, 5)} (${log.slice(0, 5).map((r) => r.bought.length).join(' ')} buys)`);
        ok(`career ${strat} seed ${seed}: at most 1 dead visit in runs 1-10`, log.length >= 10 && dead(1, 10) <= 1, `${dead(1, 10)} (${log.slice(0, 10).map((r) => r.bought.length).join(' ')} buys)`);
        if (runs >= 12) ok(`career ${strat} seed ${seed}: mean P runs 10-12 >= 1.4x runs 1-3`, P(10, 12) >= 1.4 * P(1, 3), `${P(10, 12).toFixed(1)} vs ${P(1, 3).toFixed(1)} (x${(P(10, 12) / Math.max(1e-9, P(1, 3))).toFixed(2)})`);
      }
    } else if (mode === 'diver') {
      const SEEDS = seedArgs.length ? seedArgs.map(Number) : [909, 4242, 11];
      let dP = 0, fP = 0;
      for (const seed of SEEDS) {
        for (const who of ['diver', 'farmer']) {
          const b = await bootMine(env, seed);
          const bot = who === 'farmer' ? { useItems: true, maxDepthM: 40, lateral: true } : { useItems: true };
          const res = await playDescent(b.page, { label: `econ-${who}-${seed}`, paceMs: 900, bot });
          const r = await b.page.evaluate(() => window.__game.state.runResult || {});
          console.log(`seed ${seed} ${who}: ${r.depth} m, ${r.cause}, banked ${r.ore | 0} P (reach ${r.reach | 0} + seams ${r.seams | 0}), ${res.digs} digs, ${res.seconds}s`);
          if (who === 'diver') dP += r.ore | 0; else fP += r.ore | 0;
          await b.ctx.close();
        }
      }
      ok('no upgrades: the diver banks >= 1.2x the farmer\'s P', dP >= 1.2 * fP, `${dP} vs ${fP} (x${(dP / Math.max(1, fP)).toFixed(2)})`);
    }
  } finally { await env.close(); }
  console.log(`\n==== ${pass} passed, ${fail} failed ====`);
  process.exit(fail ? 1 : 0);
})();
