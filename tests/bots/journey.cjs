// THE JOURNEY BOT (finishing plan M8, acceptance 3). career.cjs with the TAPROOT as the goal: a fresh
// save boots the plain URL (a first visit goes straight into Leg 1), the bot plays each descent with
// `Q.step({goal: 'island'})` (or the naive journey policy), and then follows the REAL end screen ->
// Store -> buy -> Descend, which starts whichever leg the save is on. Landfalls are read off the save.
//
//   node tests/bots/journey.cjs <save-label> [--naive [--compass] [--lean east|downeast]] [--pace 900] [--legs 3] [--runs 19]
//                                          [--strat cheapest] [--need 5,7,7]
//
// `--need a,b,c`: landfall 1 by run a, landfall 2 within b more runs, landfall 3 within c more (the
// plan's 5 / 7 / 7; naive: 8). Prints one line per run and a `====` summary; exits 1 on a miss.
const fs = require('fs');
const { OUT, sleep, launch, injectBot } = require('./lib.cjs');
const { playDescent } = require('./botrun.cjs');
const LP = require('./legprobe.cjs');

// THE SENSIBLE JOURNEY PLAYER knows the leg: a leg is one FIXED world, so a returning player learns the
// way ("a retry is mastery"). Each run it takes legprobe's cheapest-water GROWTH-LATTICE route to the
// taproot (growth's own point/segment rule) and digs along it with the REAL tank — one dig a step,
// nothing topped up — aiming from the strand nearest the furthest route point it has reached. The flask
// and the enzyme are used as in career.cjs (`useItems`). If the route stalls (25 steps without
// progress) it falls back to lib.cjs's flood bot with the taproot as its goal.
async function followRun(page, route, paceMs) {
  await page.evaluate((route) => {
    const W = window;
    const cum = [0]; for (let i = 1; i < route.length; i++) cum.push(cum[i - 1] + Math.hypot(route[i][0] - route[i - 1][0], route[i][1] - route[i - 1][1]));
    W.__jb = { route, cum, k: 0, best: 0, stall: 0 };
  }, route);
  const t0 = Date.now(); let digs = 0, steps = 0, mode = 'route';
  // THE KIT, TALLIED (M8 verify 2): leg-3 runs ended 'infected' with the enzyme bought, and the per-run
  // line said nothing about whether a dose was used, what it cut, or what was left.
  const kit = { flask: 0, cut: 0, cutMsgs: [], rotSeen: 0 };
  const start = await page.evaluate(() => window.__qa.snapshot());
  while (steps++ < 600) {
    const r = await page.evaluate((mode) => {
      const W = window, g = W.__game, s = g.state, net = s.active, J = W.__jb;
      if (s.runOver) return { over: true };
      const acts = [];
      const it = g.mine.items();
      if (g.mine.attached() >= 1 && it.excrete > 0) acts.push(g.mine.useExcrete().message);
      const inf = g.mine.infect();
      const rot = net.nodes.reduce((a, n) => a + (n.infected ? 1 : 0), 0);
      if (inf.on && it.amputate > 0) {
        const bad = net.nodes.filter((n) => n.infected); let best = null, bn = -1; const R = s.config.mine.cutRadius || 220;
        for (const c of bad) { let k = 0; for (const o of bad) if ((o.x - c.x) ** 2 + (o.y - c.y) ** 2 < R * R * 0.8) k++; if (k > bn) { bn = k; best = c; } }
        if (best) acts.push(g.mine.useAmputate(best.x, best.y).message);
      }
      if (mode === 'flood') { const a = W.__qa.step({ goal: 'island', useItems: false }); return { ok: a.ok, msg: a.msg, mode: 'flood', acts, rot, over: a.over, stuck: a.stuck }; }
      const route = J.route, near = 18;
      for (let j = Math.min(route.length - 1, J.k + 400); j > J.k; j--) {
        const [px, py] = route[j]; let okN = false;
        for (const n of net.nodes) if (!n.infected && Math.abs(n.x - px) < near && Math.abs(n.y - py) < near) { okN = true; break; }
        if (okN) { J.k = j; break; }
      }
      if (J.k > J.best) { J.best = J.k; J.stall = 0; } else J.stall++;
      const reach = s.config.growth.segmentLength * 3 * (s.config.mine.growSteps || 2);
      const a = reach * 0.9 / (1 + (J.stall % 4)), back = Math.floor(J.stall / 4) * 2;
      const ks = Math.max(0, J.k - back);
      let t = ks; while (t < route.length - 1 && J.cum[t] - J.cum[ks] < a) t++;
      let src = null, sd = Infinity;
      for (const n of net.nodes) { if (n.infected) continue; const d = (n.x - route[ks][0]) ** 2 + (n.y - route[ks][1]) ** 2; if (d < sd) { sd = d; src = n; } }
      if (!src) return { stuck: true };
      const res = g.mine.growFrom(src.x, src.y, route[t][0], route[t][1]);
      return { ok: res && res.ok, msg: res && res.message, mode: 'route', stall: J.stall, frac: +(J.best / (route.length - 1)).toFixed(3), acts, rot };
    }, mode);
    if (r.acts) for (const m of r.acts) { if (/Mucus/.test(m)) kit.flask++; else { kit.cut++; if (kit.cutMsgs.length < 4) kit.cutMsgs.push(String(m).slice(0, 60)); } }
    if (r.rot) kit.rotSeen = Math.max(kit.rotSeen, r.rot);
    if (r.over) break;
    if (r.ok) digs++;
    if (mode === 'route' && r.stall > 25) mode = 'flood';
    if (r.stuck && mode === 'flood') break;
    await sleep(paceMs);
  }
  // A walled-in run with water left does not end by itself (M4's open owner call): spend it on the
  // cheapest ground, then End descent, as career.cjs's recovery does.
  for (let k = 0; k < 20; k++) { if (await page.evaluate(() => !!window.__game.state.runOver)) break; await sleep(300); }
  if (!(await page.evaluate(() => !!window.__game.state.runOver))) {
    await page.evaluate(() => { const b = document.getElementById('set-forcefruit'); if (b) b.click(); });
    await sleep(800);
  }
  return { digs, seconds: Math.round((Date.now() - t0) / 1000), start, mode, kit };
}

const argv = process.argv.slice(2);
const arg = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d; };
const label = argv[0] && !argv[0].startsWith('--') ? argv[0] : '4242';
const naive = argv.includes('--naive');
// `--compass` (M8 verify, naive only): the naive player holding the M10 island needle (a bearing).
const compass = argv.includes('--compass');
// `--lean east|downeast` (naive only, M8 verify 2): which reading of the leg the naive player takes.
// 'east' (the default) takes the east chevron ('Island N is east'; the banner said "the island lies east" until M8 verify 3) — and digs
// from the farthest-east tip toward due east; 'downeast' is the first naive journey player (tip farthest
// down + east, rays about the down-east diagonal, depth capped one band under the knot).
const lean = arg('--lean', 'east');
const paceMs = +arg('--pace', 900);
const legsWanted = +arg('--legs', naive ? 1 : 3);
const need = String(arg('--need', naive ? '8' : '5,7,7')).split(',').map(Number);
const maxRuns = +arg('--runs', need.slice(0, legsWanted).reduce((a, b) => a + b, 0));
const strat = arg('--strat', 'cheapest');
const tag = 'journey-' + (naive ? (compass ? 'naive-compass-' : 'naive-' + (lean === 'east' ? '' : lean + '-')) : '') + label;

(async () => {
  const env = await launch();
  const ctx = await env.browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', (e) => errs.push(String(e && e.message)));
  await page.addInitScript(() => { window.MYCELIUM_SUPABASE = { url: '', anonKey: '' }; });
  // A FRESH SAVE ON THE PLAIN URL: the gate tap goes straight into Leg 1, run 1 (M4 + M8).
  await page.goto(env.base + '/index.html', { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#loadscreen.ld-ready', { timeout: 60000 }).catch(() => {});
  await page.click('#loadscreen', { timeout: 5000 }).catch(() => {});
  const waitRun = async () => {
    await page.waitForFunction(() => { const s = window.__game && window.__game.state;
      return !!(s && s.substrate && s.substrate.mine && s.substrate.mineJourney && !s.runOver && s.substrate._fineSolid && !document.getElementById('speciesSelect')); }, { timeout: 60000 });
    await sleep(1500);
    await injectBot(page);
  };
  await waitRun();
  const log = [], landAt = [];
  let run = 0;
  for (run = 1; run <= maxRuns; run++) {
    const leg0 = await page.evaluate(() => window.__game.mine.leg().leg);
    // The naive player REMEMBERS THE WALLS of a leg across its runs (a leg is one fixed world — "failure
    // reads as map knowledge"): the dead-end regions carry over until the leg changes. Node ids restart
    // every run, so the per-strand refusal count does not.
    await page.evaluate((leg) => { const Q = window.__qa; Q.bad = new Map(); Q._glowUsed = new Set(); Q._knew = false; Q._nref = new Map();
      if (Q._deadLeg !== leg) { Q._dead = new Set(); Q._deadLeg = leg; } }, leg0);
    let res;
    if (naive) res = await playDescent(page, { label: `${tag}-r${run}`, paceMs, maxSteps: 500, shots: false, bot: { policy: 'naive', goal: 'island', compass, lean: lean === 'east' ? 'east' : null } });
    else {
      // The route is planned on a snapshot of the leg's own world (every chunk to the island generated,
      // which is order-independent), then dug in THIS run with its real tank.
      const m = await LP.measure(page, { route: true });
      res = await followRun(page, m.route, paceMs);
    }
    // The ROOTED celebration plays ~5 s before the end screen.
    await page.waitForSelector('#ssMineDone', { timeout: 20000 }).catch(() => {});
    const rr = await page.evaluate(() => { const r = window.__game.state.runResult || {}; return { cause: r.cause, ore: r.ore | 0, east: r.east | 0, depth: r.depth | 0, bonus: r.bonus | 0 }; });
    const jn = await page.evaluate(() => window.__game.mine.journey());
    if (rr.cause === 'island') landAt.push({ leg: leg0, run });
    await page.click('#ssMineDone').catch(() => {});
    await page.waitForSelector('#ssDescend', { timeout: 20000 }).catch(() => {});
    await sleep(600);
    const bought = await page.evaluate((strat) => {
      const S = window.__game.store, ids = S.ids('mine'), got = [];
      for (let k = 0; k < 40; k++) {
        const bal = S.mats(); let pick = null, pc = Infinity;
        for (const id of ids) {
          if (!S.inGame(id, 'mine')) continue;
          const c = S.nextCost(id); if (c == null) continue;
          const m = typeof c === 'number' ? 'phosphorus' : c.m, n = typeof c === 'number' ? c : c.n;
          if ((bal[m] | 0) < n) continue;
          const eff = m === 'phosphorus' ? n : n * 5;
          if (eff < pc) { pc = eff; pick = id; }
        }
        if (!pick) break;
        const r = S.buy(pick); if (!r.ok) break; got.push(pick + '@' + r.level);
      }
      return got;
    }, strat);
    const row = { run, leg: leg0, cause: rr.cause, depth: rr.depth, east: rr.east, ore: rr.ore, bonus: rr.bonus, digs: res.digs,
                  seconds: res.seconds, start: res.start.water, islands: jn.islands, nextLeg: jn.leg, bought };
    log.push(row);
    console.log(`R${run} leg ${leg0} ${rr.cause} ${rr.depth} m / ${rr.east} m east, ${res.digs} digs, ${res.seconds}s, start ${res.start.water}W, +${rr.ore} P${rr.bonus ? ' (bonus ' + rr.bonus + ')' : ''} | islands ${jn.islands}, next leg ${jn.leg} | bought ${bought.join(',') || '-'}${res.kit ? ` | kit: flask x${res.kit.flask}, cut x${res.kit.cut}${res.kit.cutMsgs.length ? ' [' + res.kit.cutMsgs.join(' / ') + ']' : ''}, most rot ${res.kit.rotSeen}` : ''}`);
    fs.writeFileSync(`${OUT}/${tag}.json`, JSON.stringify(log, null, 1));
    if (landAt.length >= legsWanted) break;
    await page.click('#ssDescend').catch(() => {});
    await waitRun();
  }
  // THE GATES: landfall k at run <= sum(need[0..k]) measured from the previous landfall.
  let pass = true, prev = 0, np = 0, nf = 0; const why = [];
  for (let k = 0; k < legsWanted; k++) {
    const L = landAt[k];
    const okK = !!L && L.run - prev <= need[k];
    const w = `landfall ${k + 1}: ${L ? 'run ' + L.run + ' (' + (L.run - prev) + ' after the last, want <= ' + need[k] + ')' : 'none in ' + Math.min(run, maxRuns) + ' runs'}`;
    why.push(w);
    console.log(`  ${okK ? 'PASS' : 'FAIL'}  ${tag} ${w}`); okK ? np++ : nf++;
    if (!okK) pass = false;
    if (L) prev = L.run;
  }
  console.log(`  ${errs.length ? 'FAIL' : 'PASS'}  ${tag} no page errors  ${errs.slice(0, 2).join(' | ')}`); errs.length ? nf++ : np++;
  if (errs.length) pass = false;
  console.log(`${tag}: ${pass ? 'PASS' : 'FAIL'} — ${why.join('; ')}`);
  // The runner's fence (tests/run.mjs parses exactly this).
  console.log(`\n==== ${np} passed, ${nf} failed ====`);
  await env.close();
  process.exit(pass ? 0 : 1);
})();
