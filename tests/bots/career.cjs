// A multi-run career on ONE fresh save: bot plays, real end screen -> "To the store" -> buy -> "Descend".
const fs = require('fs');
const { OUT, sleep, launch, bootMine, injectBot } = require('./lib.cjs');
const { playDescent } = require('./botrun.cjs');
(async () => {
  const seed = +(process.argv[2] || 4242);
  const runs = +(process.argv[3] || 10);
  const strat = process.argv[4] || 'cheapest';
  const tag = process.argv[5] || ('career-' + strat + '-' + seed);
  const env = await launch();
  const m = await bootMine(env, seed);
  const page = m.page;
  const log = [];
  for (let r = 1; r <= runs; r++) {
    await page.evaluate(() => { window.__qa.bad = new Map(); });
    const res = await playDescent(page, { label: `${tag}-r${r}`, shots: r === 1 || r === runs || r % 4 === 0, shotEvery: 30,
      bot: { useItems: true } });
    // To the store
    const done = await page.$('#ssMineDone');
    if (!done) { console.log('no end screen; run state', JSON.stringify(res.end)); }
    else await done.click();
    await page.waitForSelector('#ssDescend', { timeout: 20000 }).catch(() => {});
    await sleep(800);
    const before = await page.evaluate(() => ({ P: window.__game.store.balance(), mats: window.__game.store.mats() }));
    // shop
    const bought = await page.evaluate((strat) => {
      // THE TRACK IDS COME FROM THE PAGE (M5: `__game.store.ids()`), so a renamed, added or cut track
      // cannot leave the bot buying nothing. A track the progressive reveal still hides is skipped —
      // a player cannot see it, and `buy` refuses it.
      const S = window.__game.store, ids = S.ids('mine');
      // Buy orders. 'cheapest': the cheapest affordable rung. 'power': dig power first (grow, water,
      // heat, then the kit). 'knowledge': what tells you about the ground first — the compasses when
      // they exist (M10), else heat, the kit, then power. Any other value is a '+'-joined id list.
      const ORDERS = {
        power: ['growSteps', 'water', 'heatTolerance', 'excreteCharges', 'amputateCharges'],
        knowledge: ids.filter((id) => /compass/i.test(id)).concat(['heatTolerance', 'excreteCharges', 'amputateCharges', 'water', 'growSteps']),
      };
      const pri = (strat === 'cheapest' ? ids : (ORDERS[strat] || strat.split('+'))).filter((id) => ids.indexOf(id) >= 0);
      const got = [];
      for (let k = 0; k < 40; k++) {
        const bal = S.mats();
        let pick = null, pc = Infinity;
        for (const id of pri) {
          if (!S.inGame(id, 'mine')) continue;
          const c = S.nextCost(id); if (c == null) continue;
          const m = typeof c === 'number' ? 'phosphorus' : c.m, n = typeof c === 'number' ? c : c.n;
          if ((bal[m] | 0) < n) continue;
          const eff = m === 'phosphorus' ? n : n * 5;   // treat a deep material as ~5 P for ordering
          if (strat === 'cheapest' ? eff < pc : pick == null) { pc = eff; pick = id; }
        }
        if (!pick) break;
        const r = S.buy(pick); if (!r.ok) break;
        got.push(pick + '@' + r.level);
      }
      return got;
    }, strat);
    const after = await page.evaluate(() => ({ P: window.__game.store.balance(), mats: window.__game.store.mats(),
      levels: Object.fromEntries(window.__game.store.ids('mine').map((id) => [id, window.__game.store.level(id)])) }));
    const row = { run: r, seed: res.seed, seconds: res.seconds, digs: res.digs, depth: res.end.depth, maxDepth: res.maxDepth,
      ore: res.end.ore, mats: res.end.mats, cause: res.end.cause, drained: res.end.drained, boxed: res.boxedAt, sat: res.sat && { w0: res.sat.before.water, w1: res.sat.after.water, over: res.sat.after.over, rec: res.sat.recovery, forced: !!res.sat.forcedEnd },
      itemsUsed: res.steps.flatMap((s) => s.acts || []).map((a) => a.join(' ')).slice(0, 12),
      startWater: res.start.water, walletBefore: before, bought, walletAfter: after };
    log.push(row);
    console.log(`R${r} seed=${res.seed} ${res.seconds}s digs=${res.digs} depth=${res.end.depth}/${res.maxDepth} start=${res.start.water}W ore=${res.end.ore} mats=${JSON.stringify(res.end.mats)} cause=${res.end.cause} drained=${res.end.drained} boxed=${res.boxedAt ? res.boxedAt.why + '@' + res.boxedAt.depth + 'm w=' + res.boxedAt.water + ' ' + JSON.stringify(row.sat) : '-'} items=${JSON.stringify(row.itemsUsed)} | bought ${bought.join(',')} | left P=${after.P} ${JSON.stringify(after.mats)}`);
    fs.writeFileSync(`${OUT}/${tag}.json`, JSON.stringify(log, null, 1));
    // Descend
    const dsc = await page.$('#ssDescend');
    if (!dsc) { console.log('no descend button'); break; }
    await dsc.click();
    await page.waitForFunction(() => { const s = window.__game.state; return s && s.substrate && s.substrate.mine && !s.runOver && s.substrate._fineSolid && !document.getElementById('speciesSelect'); }, { timeout: 40000 });
    await sleep(1500);
    await injectBot(page);
  }
  console.log('errors', m.errs.slice(0, 5));
  await env.close();
})();
