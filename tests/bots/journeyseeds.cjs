/* JOURNEYSEEDS — picks the curated seed tables for Journeys II-IV (M13), and their FAR variants.
 * A tool: prints, never fails. Not in the runner.
 *
 *   NODE_PATH=/opt/node22/lib/node_modules node tests/bots/journeyseeds.cjs --journey 2 [--legs 1,2,...]
 *          [--max 80] [--far] [--from 0]
 *
 * For each leg it walks legprobe's candidate list for that journey (`--journey J` offsets the list, so
 * the seeds are fresh) and stops at the FIRST candidate that passes the map gates (PASS + WPASS, the
 * same gates Journey I's seeds passed) AND that real growth follows to the taproot (legprobe `follow`).
 * Journey J's own rules are in force while it measures ('#leg,J,<l>').
 *
 * `--far`: the E+2 variant. Journeys VII and on play the table of `mineJourneyTable(J)` with every island
 * two chunks further east, so table T is first played Far by journey VII (T = IV), VIII (II) or IX (III). It first checks the table's own seed under that journey (`--seeds`-style: same gates, same
 * follow); only if it fails does it walk candidates for a `far` seed of its own.
 *   --seed-of L=S,...  the table seeds to check (from a previous run's output)
 *   --reach            the FALLBACK gate only: the taproot reachable (fine mask + lattice) and real growth
 *                      lands on it — for a slot where no candidate met PASS + WPASS in the search.
 */
const H = require('../mine-harness.cjs');
const LP = require('./legprobe.cjs');

(async () => {
  const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
  const J = +arg('--journey', 2), far = process.argv.includes('--far'), reachOnly = process.argv.includes('--reach');
  const legs = arg('--legs', '1,2,3,4,5,6,7,8').split(',').map(Number);
  const max = +arg('--max', 80), from = +arg('--from', 0);
  const seedOf = {}; for (const kv of String(arg('--seed-of', '')).split(',').filter(Boolean)) { const [l, s] = kv.split('='); seedOf[+l] = +s; }
  // The journey that is MEASURED: the table's own, or the first Far journey that plays it (mineJourneyTable:
  // VII plays IV's table, VIII II's, IX III's).
  const JM = far ? 7 + ((J - 4 + 3) % 3) : J;
  LP.setJourney(JM);
  const E = await H.start();
  const out = {};
  try {
    for (const leg of legs) {
      let b = await LP.openLeg(E, leg, 0);
      const t0 = Date.now();
      const tryOne = async (sd) => {
        await LP.playLeg(b.page, leg, sd);
        const m = await LP.measure(b.page, { route: true });
        const route = m.route; delete m.route;
        // `--reach` (the fallback for a slot no candidate passed the full gates in): only "the taproot is
        // reachable on the fine mask and the lattice, and real growth follows the route to it".
        let ok = reachOnly ? !!(m.reach && m.reachLat) : LP.PASS(m, leg), w = null, f = null;
        if (ok && !reachOnly) { w = await LP.world(b.page); ok = LP.WPASS(w); }
        if (ok) { f = await LP.follow(b.page, route); ok = !!f.landed; }
        return { ok, m, w, f };
      };
      const report = (tag, sd, r) => console.log(`J${JM} leg ${leg} ${tag} seed ${sd}: ${r.ok ? 'OK  ' : '    '} ratio ${r.m.ratio}/${r.m.ratioFine} water ${r.m.water} e42 ${r.m.east42} e84 ${r.m.east84} shallow ${r.m.shallowMaxCol}/${r.m.islandC0} lat ${r.m.lateral} seam ${r.m.seamRunRows} leak ${r.m.sealLeak}`
        + (r.w ? ` | world ore ${r.w.pilesOk}/${r.w.piles} pk ${r.w.pocketsOk}/${r.w.pockets} pillar ${r.w.pillarSeam}/${r.w.pillarMid90}` : '')
        + (r.f ? ` | follow landed ${r.f.landed} digs ${r.f.digs} e42 ${r.f.east42}` : ''));
      let found = null;
      if (seedOf[leg]) {
        try { const r = await tryOne(seedOf[leg]); report('table', seedOf[leg], r); if (r.ok) found = { seed: seedOf[leg], same: true, r }; }
        catch (e) { console.log(`J${JM} leg ${leg} table seed ERROR ${String(e && e.message || e).slice(0, 100)}`); await b.ctx.close().catch(() => {}); b = await LP.openLeg(E, leg, 0); }
      }
      for (let k = from; !found && k < from + max; k++) {
        const sd = ((leg * 7919 + k * 104729 + 12345 + (JM - 1) * 7777777) % 2147483000) + 1;
        if (k > from && k % 6 === 0) { await b.ctx.close().catch(() => {}); b = await LP.openLeg(E, leg, 0); }
        try {
          const r = await tryOne(sd);
          report('cand ' + k, sd, r);
          if (r.ok) found = { seed: sd, cand: k, r };
        } catch (e) {
          console.log(`J${JM} leg ${leg} cand ${k} seed ${sd}: ERROR ${String(e && e.message || e).slice(0, 100)}`);
          await b.ctx.close().catch(() => {}); b = await LP.openLeg(E, leg, 0);
        }
      }
      out[leg] = found ? { seed: found.seed, same: !!found.same, ratio: found.r.m.ratio, water: found.r.m.water, digs: found.r.f.digs, e42: found.r.f.east42 } : null;
      console.log(`J${JM} leg ${leg}: ${found ? 'PICK ' + found.seed + (found.same ? ' (table seed holds)' : '') : 'NONE in ' + max} (${Math.round((Date.now() - t0) / 1000)} s)`);
      await b.ctx.close().catch(() => {});
    }
  } finally { await E.close(); }
  console.log('RESULT ' + JSON.stringify({ journey: J, far, measured: JM, legs: out }));
})();
