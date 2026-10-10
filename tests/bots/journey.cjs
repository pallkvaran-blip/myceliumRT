// THE JOURNEY BOT (finishing plan M8, acceptance 3). career.cjs with the TAPROOT as the goal: a fresh
// save boots the plain URL (a first visit goes straight into Leg 1), the bot plays each descent with
// `Q.step({goal: 'island'})` (or the naive journey policy), and then follows the REAL end screen ->
// Store -> buy -> Descend, which starts whichever leg the save is on. Landfalls are read off the save.
//
//   node tests/bots/journey.cjs <save-label> [--naive [--compass] [--lean east|downeast]] [--pace 900] [--legs 3] [--runs 19]
//                                          [--scout] [--island-compass]   (M10: see scoutRun / islandCompass)
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
  // WHERE THE ROUTE STOPPED (M8 verify 3): the furthest route point a clean strand reached, as metres east /
  // metres down, so a leg's stall points can be read off repeated careers.
  const reached = await page.evaluate(() => { const J = window.__jb, s = window.__game.state, sub = s.substrate, cs = sub.cellSize;
    const p = J.route[J.best], hx = (sub.mineHomeCol + 0.5) * cs;
    return { frac: +(J.best / (J.route.length - 1)).toFixed(3), east: Math.round((p[0] - hx) / cs), down: Math.round((p[1] - sub.surfaceY) / cs) }; });
  return { digs, seconds: Math.round((Date.now() - t0) / 1000), start, mode, kit, reached };
}

// THE SCOUT (M10 acceptance 6a): a player who READS THE GROUND (lib.cjs's flood over the generated fine
// mask — the rock is on screen) but does NOT know where the island's root is. Without a compass it knows
// what the game tells it — the island is east and its root lies under the green hill (`taproot().x0..x1`,
// the hill span) — and aims east at 20 m toward the hill, then under it, 10 m below its deepest strand
// already under the span; with the
// island compass (both rungs) it aims at the point the needle's bearing and metres name. Either way it
// digs toward the flood's frontier cell nearest that point (less 0.35 x path length), and goes straight
// for the knot once it is ON SCREEN (+-325 x +-700 units of the strand being worked) and reachable.
// Kit use as followRun. `--scout` swaps it in for the route follower.
async function scoutRun(page, paceMs) {
  const t0 = Date.now(); let digs = 0, steps = 0;
  const kit = { flask: 0, cut: 0, cutMsgs: [], rotSeen: 0 };
  const start = await page.evaluate(() => window.__qa.snapshot());
  const modes = {};
  while (steps++ < 600) {
    const r = await page.evaluate(() => {
      const W = window, g = W.__game, s = g.state, net = s.active, sub = s.substrate, Q = W.__qa, cs = sub.cellSize;
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
      const F = Q.flood(), tap = g.mine.taproot(), live = Q.live();
      if (!live.length) return { stuck: true, acts, rot };
      const fN = (s._mineFocus && net.byId.get(s._mineFocus.id)) || live.reduce((a, n) => (n.y > a.y ? n : a));
      const land = (s.config.mine.journey.landfallCells || 1.5) * cs;
      const onScr = Math.abs(tap.x - fN.x) < 325 && Math.abs(tap.y - fN.y) < 700;
      const nr = onScr ? Q.nearReach(F, tap.x, tap.y, land * 0.9) : null;
      let ti = -1, mode;
      if (nr) { ti = nr.i; mode = 'knot'; }
      else {
        let T = null;
        const e = g.mine.compass().find((q) => q.kind === 'island');
        if (e && e.dist != null) { const b = e.bearing * Math.PI / 180; T = { x: e.fx + Math.cos(b) * e.dist * cs, y: e.fy + Math.sin(b) * e.dist * cs }; mode = 'needle'; }
        else {
          // East along the shallow ground toward the hill, then DOWN under it: the aim deepens only with
          // the deepest strand already under the hill's span.
          let deepU = -Infinity; for (const n of live) if (n.x >= tap.x0 && n.x <= tap.x1) deepU = Math.max(deepU, n.y);
          T = { x: (tap.x0 + tap.x1) / 2, y: deepU > -Infinity ? deepU + 10 * cs : sub.surfaceY + 20 * cs }; mode = deepU > -Infinity ? 'under' : 'hill';
        }
        let bsc = -Infinity; const gap = Math.ceil(60 / F.fs);
        for (let i = 0; i < F.dist.length; i++) {
          const d = F.dist[i]; if (d < gap) continue;
          const x = (i % F.fc + 0.5) * F.fs, y = F.sy + (((i / F.fc) | 0) + 0.5) * F.fs;
          const sc = -Math.hypot(x - T.x, y - T.y) - 0.35 * d * F.fs;
          if (sc > bsc) { bsc = sc; ti = i; }
        }
      }
      if (ti < 0) return { stuck: true, acts, rot, mode };
      const res = Q.digAlong(F, ti);
      return { ok: res && res.ok, msg: res && res.message, acts, rot, mode };
    });
    if (r.acts) for (const m of r.acts) { if (/Mucus/.test(m)) kit.flask++; else { kit.cut++; if (kit.cutMsgs.length < 4) kit.cutMsgs.push(String(m).slice(0, 60)); } }
    if (r.rot) kit.rotSeen = Math.max(kit.rotSeen, r.rot);
    if (r.mode) modes[r.mode] = (modes[r.mode] | 0) + 1;
    if (r.over || r.stuck) break;
    if (r.ok) digs++;
    await sleep(paceMs);
  }
  for (let k = 0; k < 20; k++) { if (await page.evaluate(() => !!window.__game.state.runOver)) break; await sleep(300); }
  if (!(await page.evaluate(() => !!window.__game.state.runOver))) {
    await page.evaluate(() => { const b = document.getElementById('set-forcefruit'); if (b) b.click(); });
    await sleep(800);
  }
  return { digs, seconds: Math.round((Date.now() - t0) / 1000), start, mode: JSON.stringify(modes), kit };
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
// M14: buy every track (compasses and vial too) unless `--no-buy-all` (the pre-M14 shelf, M10 6a's baseline).
const buyAll = !argv.includes('--no-buy-all') && !islandCompassFlag();
function islandCompassFlag() { return argv.includes('--island-compass'); }
// `--island-compass` (M10 acceptance 6a): buy both island-compass rungs as soon as the store shows them
// (ahead of anything else), and read the needle (`__game.mine.compass()`) as the naive `--compass`
// player's bearing. Without it the bot buys NO compass at all (the M10 shelf would otherwise put them in
// the cheapest buyer's reach and change the no-compass baseline).
const islandCompass = argv.includes('--island-compass');
const scout = argv.includes('--scout');
// M14 DIVES (plan F G9, the model's rule): after 2 failed attempts on a leg, once per leg, a run whose next
// POWER rung (grow, heat, water — in that order, the first revealed and not maxed) waits on a deep material
// this leg's route has not been paying (0 of it earned on the last run here) is spent DIVING for it: lib.cjs's
// free bot (`Q.step`, ore and pockets in sight, deepest frontier), capped one band below the material's own.
// `--no-dives` turns it off.
// `--avoid F` (M14, default 1 = off): the route costs F times as much inside a live cloud's sight (worms half that),
// so the sensible player routes round the green washes as the plan says a player does. 1 = the cheapest route.
const avoid = +arg('--avoid', 1);   // M14: 4 made leg 4 a wall (13 runs dry at ~89 m / 190 m east); off, it landed on attempt 4
// `--oh plan|<number>` (M14, default 'plan'): THE HUMAN OVERHEAD. The bot replays a known cheapest route; the
// plan's numbers model assumes a human spends 2.0x the navigator's digs on a leg's first attempt, 0.15 less
// each attempt after, floor 1.4, and 0.08 less per island-compass rung (floor 1.3). Emulated by taxing every
// accepted dig (oh - 1) x its price in WATER (whole units, the fraction carried) — the water a human spends on
// the digs that go nowhere — and counting (oh - 1) WASTED digs for the human-time clock. `--oh 1` is the pure bot.
const ohArg = arg('--oh', (argv.includes('--naive') || argv.includes('--scout')) ? '1' : 'plan');   // the naive and scout players ARE the human model
const ohFor = (att, ic) => ohArg === 'plan' ? Math.max(1.3, Math.max(1.4, 2.0 - 0.15 * att) - 0.08 * Math.min(2, ic | 0)) : +ohArg;
// `--from <log.json>:<run>` (M14): start from the SAVE a career had after that run (each row carries it), so a
// late leg can be measured without replaying the journey before it.
const fromArg = arg('--from', null);
const dives = !argv.includes('--no-dives') && !naive && !scout;
const tag = 'journey-' + (naive ? (compass ? 'naive-compass-' : 'naive-' + (lean === 'east' ? '' : lean + '-')) : '') + (scout ? 'scout-' : '') + (islandCompass ? 'icompass-' : '') + (strat !== 'cheapest' ? strat + '-' : '') + (dives ? '' : 'nodive-') + (ohArg === 'plan' ? 'h-' : ohArg === '1' ? '' : 'oh' + ohArg + '-') + label;

(async () => {
  const env = await launch();
  const ctx = await env.browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', (e) => errs.push(String(e && e.message)));
  await page.addInitScript(() => { window.MYCELIUM_SUPABASE = { url: '', anonKey: '' }; });
  if (fromArg) {
    const [fp, fr] = fromArg.split(':'); const src = JSON.parse(fs.readFileSync(fp, 'utf8')).find((r) => r.run === +fr);
    if (!src || !src.save) throw new Error('no save at ' + fromArg);
    await page.addInitScript((sv) => { try { if (!sessionStorage.getItem('jbSeeded')) { localStorage.setItem('mycelium.progress.v2', sv); sessionStorage.setItem('jbSeeded', '1'); } } catch (_) {} }, src.save);
  }
  // A FRESH SAVE ON THE PLAIN URL: the gate tap goes straight into Leg 1, run 1 (M4 + M8).
  await page.goto(env.base + '/index.html', { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#loadscreen.ld-ready', { timeout: 60000 }).catch(() => {});
  await page.click('#loadscreen', { timeout: 5000 }).catch(() => {});
  if (fromArg) { await page.waitForSelector('#tsNewMine, #titleScreen', { timeout: 20000 }).catch(() => {}); await sleep(2500);
    await page.evaluate(() => { const b = document.getElementById('tsNewMine') || Array.from(document.querySelectorAll('#titleScreen .ts-btn')).find((x) => /dig|continue|begin/i.test(x.textContent)); if (b) b.click(); }); }
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
    // Attempts on this leg so far, off the SAVE (so a --from start counts the career's earlier runs too).
    const attNow = await page.evaluate((leg) => { const j = window.__game.mine.journeySave && window.__game.mine.journeySave();
      const r = j && j.legs && j.legs[leg]; return r ? (r.runs | 0) : 0; }, leg0);
    const icNow = await page.evaluate(() => window.__game.store.level('compassIsland') | 0);
    const oh = ohFor(attNow, icNow);
    await page.evaluate((oh) => {
      const W = window, g = W.__game;
      W.__ohTax = { oh, debt: 0, wasted: 0 };
      if (!g.mine.__ohWrapped) {
        const orig = g.mine.growFrom; g.mine.__ohWrapped = true;
        g.mine.growFrom = function () { const r = orig.apply(this, arguments); const T = W.__ohTax, net = g.state.active;
          if (r && r.ok && T && T.oh > 1 && net && !g.state.runOver) { T.debt += (T.oh - 1) * (r.cost || 0); T.wasted += T.oh - 1;
            const k = Math.floor(T.debt); if (k > 0) { net.water = Math.max(0, net.water - k); T.debt -= k; } }
          return r; };
      }
    }, oh);
    let res, mode = 'leg';
    if (dives) {
      const att = log.filter((r) => r.leg === leg0 && !/island|promised/.test(r.cause)).length;
      const dived = log.some((r) => r.leg === leg0 && r.mode === 'dive');
      const last = log.filter((r) => r.leg === leg0).slice(-1)[0];
      if (att >= 2 && !dived) {
        const want = await page.evaluate(() => {
          const S = window.__game.store, bands = window.__game.state.config.mine.materials;
          for (const id of ['growSteps', 'heatTolerance', 'water']) {
            if (!S.inGame(id, 'mine')) continue;
            const c = S.nextCost(id); if (c == null) continue;
            if (typeof c === 'number') return null;
            if ((S.mats()[c.m] | 0) >= c.n) return null;
            const mat = bands.find((m) => m.id === c.m);
            return { m: c.m, band: mat ? mat.band : null };
          }
          return null;
        });
        if (want && want.band != null && !(last && last.mats && (last.mats[want.m] | 0) > 0)) mode = 'dive', res = null, log.diveFor = want;
      }
    }
    if (mode === 'dive') {
      const cap = (log.diveFor.band + 1) * 42 - 4;
      res = await playDescent(page, { label: `${tag}-r${run}-dive`, paceMs, maxSteps: 500, shots: false, bot: { useItems: true, maxDepthM: cap } });
      res.kit = null; res.mode = 'dive:' + log.diveFor.m;
    } else if (naive) res = await playDescent(page, { label: `${tag}-r${run}`, paceMs, maxSteps: 500, shots: false, bot: { policy: 'naive', goal: 'island', compass, lean: lean === 'east' ? 'east' : null } });
    else if (scout) res = await scoutRun(page, paceMs);
    else {
      // The route is planned on a snapshot of the leg's own world (every chunk to the island generated,
      // which is order-independent), then dug in THIS run with its real tank.
      const m = await LP.measure(page, { route: true, avoid });
      res = await followRun(page, m.route, paceMs);
    }
    // The ROOTED celebration plays ~5 s before the end screen.
    await page.waitForSelector('#ssMineDone', { timeout: 20000 }).catch(() => {});
    const rr = await page.evaluate(() => { const g = window.__game, r = g.state.runResult || {}; return { cause: r.cause, ore: r.ore | 0, east: r.east | 0, depth: r.depth | 0, bonus: r.bonus | 0, mats: Object.assign({}, r.mats || {}), drained: g.mine.drained(), seams: r.seams | 0, reach: r.reach | 0, ms: r.ms | 0 }; });
    const jn = await page.evaluate(() => window.__game.mine.journey());
    if (rr.cause === 'island' || rr.cause === 'promised') landAt.push({ leg: leg0, run });
    // The Promised Land shows its finale (no Store button): the journey is over, so is the career.
    if (rr.cause === 'promised') { log.push({ run, leg: leg0, cause: rr.cause, depth: rr.depth, east: rr.east, ore: rr.ore, bonus: rr.bonus, digs: res.digs, seconds: res.seconds, gameMs: rr.ms, start: res.start.water, drained: rr.drained, mats: rr.mats, mode, bought: [], oh, wasted: await page.evaluate(() => +((window.__ohTax || {}).wasted || 0).toFixed(1)), store: await page.evaluate(() => { const S = window.__game.store; let n = 0, b = 0; for (const id of S.ids('mine')) { n += S.costs(id, 'mine').length; b += S.level(id); } return { n, b, P: S.balance(), mats: S.mats() }; }) });
      console.log(`R${run} leg ${leg0} PROMISED ${rr.depth} m / ${rr.east} m east, ${res.digs} digs, +${rr.ore} P (bonus ${rr.bonus})`);
      fs.writeFileSync(`${OUT}/${tag}.json`, JSON.stringify(log, null, 1)); break; }
    await page.click('#ssMineDone').catch(() => {});
    await page.waitForSelector('#ssDescend', { timeout: 20000 }).catch(() => {});
    await sleep(600);
    const bought = await page.evaluate(({ strat, islandCompass, buyAll }) => {
      // No compass (M10, see above) and NO OXALIC VIAL (M11 tidy): no bot ever arms one, so a cheapest buyer
      // reaching its 50 P / 12 G / 12 H rungs on leg 3 would spend a career's ore on nothing and read every
      // leg-3 baseline slower for a reason that is not the game.
      // M14 (`--buy-all`, the default for the three M14 buyers): EVERY track is bought, compasses and vial
      // included — a player buys the whole shelf over a journey (G5), and a buyer that skips 14 of 36 rungs
      // can never measure it. The bot still never USES a compass or the vial, so they are spent ore.
      const S = window.__game.store, allIds = S.ids('mine'), got = [];
      const ids = buyAll ? allIds : allIds.filter((id) => !/compass|oxalicVial/i.test(id));
      if (islandCompass) for (let k = 0; k < 2; k++) {
        if (!S.inGame('compassIsland', 'mine') || S.nextCost('compassIsland') == null) break;
        const r = S.buy('compassIsland'); if (!r.ok) break; got.push('compassIsland@' + r.level);
      }
      // ...and SAVE UP for it while it is on the shelf and not yet bought out.
      if (islandCompass && S.inGame('compassIsland', 'mine') && S.nextCost('compassIsland') != null) return got.concat(['(saving for compassIsland)']);
      // THE THREE M14 BUYERS (plan F): 'cheapest' — the cheapest affordable rung (a deep material at ~5 P);
      // 'power' — the plan model's greedy priority (Water I, grow, heat, water, flask, enzyme, island
      // compass, the A / G compasses, the vial, the H compass): the first track in that order with an
      // affordable rung; 'knowledge' — the compasses first (island, then by band), then heat, the kit,
      // water, grow, the vial.
      const comp = allIds.filter((id) => /compass/i.test(id));
      const ORDERS = {
        power: ['growSteps', 'heatTolerance', 'water', 'excreteCharges', 'amputateCharges'].concat(comp, ['oxalicVial']),
        knowledge: comp.concat(['heatTolerance', 'excreteCharges', 'amputateCharges', 'water', 'growSteps', 'oxalicVial']),
      };
      // Water I first, for every buyer: it is 5 P, priced at the minimum payout so a first run always buys it.
      if (S.inGame('water', 'mine') && S.level('water') === 0) { const r = S.buy('water'); if (r.ok) got.push('water@' + r.level); }
      const order = strat === 'cheapest' ? ids : (ORDERS[strat] || strat.split('+')).filter((id) => ids.indexOf(id) >= 0);
      for (let k = 0; k < 40; k++) {
        const bal = S.mats(); let pick = null, pc = Infinity;
        for (const id of order) {
          if (!S.inGame(id, 'mine')) continue;
          const c = S.nextCost(id); if (c == null) continue;
          const m = typeof c === 'number' ? 'phosphorus' : c.m, n = typeof c === 'number' ? c : c.n;
          if ((bal[m] | 0) < n) continue;
          const eff = m === 'phosphorus' ? n : n * 5;
          if (strat === 'cheapest' ? eff < pc : pick == null) { pc = eff; pick = id; }
        }
        if (!pick) break;
        const r = S.buy(pick); if (!r.ok) break; got.push(pick + '@' + r.level);
      }
      return got;
    }, { strat, islandCompass, buyAll });
    const store = await page.evaluate(() => { const S = window.__game.store; let n = 0, b = 0; const lv = {};
      for (const id of S.ids('mine')) { n += S.costs(id, 'mine').length; b += S.level(id); lv[id] = S.level(id); } return { n, b, P: S.balance(), mats: S.mats(), lv }; });
    if (run === 1) store.costs = await page.evaluate(() => { const S = window.__game.store, o = {}; for (const id of S.ids('mine')) o[id] = S.costs(id, 'mine'); return o; });
    const row = { run, leg: leg0, cause: rr.cause, depth: rr.depth, east: rr.east, ore: rr.ore, bonus: rr.bonus, digs: res.digs,
                  seconds: res.seconds, gameMs: rr.ms, start: res.start.water, islands: jn.islands, nextLeg: jn.leg, bought, mode,
                  drained: rr.drained, mats: rr.mats, seams: rr.seams, reach: rr.reach, kit: res.kit || null, store,
                  oh, wasted: await page.evaluate(() => +((window.__ohTax || {}).wasted || 0).toFixed(1)),
                  save: await page.evaluate(() => localStorage.getItem('mycelium.progress.v2')) };
    log.push(row);
    console.log(`R${run} oh${oh.toFixed(2)} leg ${leg0}${mode !== 'leg' ? ' [' + res.mode + ']' : ''} ${rr.cause} ${rr.depth} m / ${rr.east} m east, ${res.digs} digs, ${res.seconds}s, start ${res.start.water}W, +${rr.ore} P${rr.bonus ? ' (bonus ' + rr.bonus + ')' : ''}${Object.keys(rr.mats).length ? ' ' + JSON.stringify(rr.mats) : ''} drain ${rr.drained} | wallet ${store.P} P ${JSON.stringify(store.mats)} store ${store.b}/${store.n} | islands ${jn.islands}, next leg ${jn.leg} | bought ${bought.join(',') || '-'}${res.kit ? ` | kit: flask x${res.kit.flask}, cut x${res.kit.cut}${res.kit.cutMsgs.length ? ' [' + res.kit.cutMsgs.join(' / ') + ']' : ''}, most rot ${res.kit.rotSeen}` : ''}${res.reached ? ` | route ${res.reached.frac} to ${res.reached.east} m east / ${res.reached.down} m, ended in ${res.mode}` : ''}${scout ? ' | ' + res.mode : ''}`);
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
