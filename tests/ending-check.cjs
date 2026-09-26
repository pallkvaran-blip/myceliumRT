/* EVERY RUN ENDS, AND NO EXIT LOSES A HAUL — the finishing plan's M1, as assertions.
 *
 * The defects this pins, all measured on `claude/deep-mine-finish` before the fix:
 *   - THE DRY-FOR-DEEP SOFT LOCK. `mineFuelCheck` asks whether the SHALLOWEST strand is affordable
 *     (always 2) while the working front costs 4-16, so 14 of 39 bot runs and 5 of 12 playtest runs
 *     sat live and idle for 30-60 s. The stuck rule fruits the colony 6 s after the tank cannot pay
 *     the price where the player is working, and FRUIT NOW makes it one tap.
 *   - 'Save & exit' threw the haul away; 'End run' said the colony was eaten; 'Replay tutorial'
 *     restarted the descent. Both exits now bank through `mineBank`.
 *   - An infected ending reported the depth of the deepest CLEAN strand at the end (99 m after
 *     reaching 107). The run pays and records its running maximum.
 *   - The shared 6000-node cap refused every dig as 'Solid rock' with the run live.
 *   - Closing the tab mid-descent lost the haul.
 *   - The end screen's P icon rendered 55-170 px and the SPORED wordmark clipped at 390 px.
 *   - `run_end` carried no duration and no cause detail.
 *
 * Every block runs on a FRESH context (fresh save), and every "stuck" state is made the way a
 * player reaches it: the navigator (mine-check's own) digs to depth, then the tank is set one short
 * of the price there and nothing else is touched.
 */
const path = require('path');
const H = require('./mine-harness.cjs');
const { sleep } = H;
let pass = 0, fail = 0;
const ok = (n, c, x) => { c ? (pass++, console.log('  PASS  ' + n + (x ? '  — ' + x : ''))) : (fail++, console.log('  FAIL  ' + n + (x ? '  — ' + x : ''))); };
const ART = path.join(H.ROOT, 'tests', '.artifacts');
require('fs').mkdirSync(ART, { recursive: true });

// A quiet shaft: no worms, no drain, no mould, nothing respawning — so the only thing moving the
// tank is what the block does to it.
const QUIET = () => {
  const s = window.__game.state;
  s.nematodes.length = 0; s.clouds.length = 0;
  s.config.nematodes.respawnChance = 0; s.config.trichoderma.respawnChance = 0;
  if (s.config.mine.worms) s.config.mine.worms.waterPerSec = 0;
};
const progress = () => JSON.parse(localStorage.getItem('mycelium.progress.v2') || '{}');

(async () => {
  const E = await H.start();
  // Dig to `m` metres with a bottomless tank, let the reveal finish, then leave the tank one short of
  // the price at the strand the player is working. Returns the state it left.
  // `settle`: wait for the last dig's reveal to finish first. Block 1 does NOT (the plan's probe sets
  // the tank straight after the dig, reveal in flight); blocks that time the countdown mid-way do,
  // since a reveal holds it for up to `stuckRevealHoldMs`.
  const toStuck = async (page, m, settle = true) => page.evaluate(async ({ m, QUIET, settle }) => {
    // eslint-disable-next-line no-new-func
    new Function('return (' + QUIET + ')')()();
    const g = window.__game, s = g.state;
    s.active.water = 100000;
    const r = await window.__navDig({ targetM: m, maxIters: 700 });
    if (settle) {
      await new Promise((res) => setTimeout(res, 600));
      for (let i = 0; i < 200 && g.mine.revealing(); i++) await new Promise((res) => setTimeout(res, 50));
    }
    // NO POCKET MAY REFILL THE TANK UNDER THE COUNTDOWN. A pocket pays once the touching strand has
    // GROWN IN (M4 verifier round 2), so one the navigator's last digs reached pays AFTER the tank is
    // set one short — correctly un-sticking the run ('still live after 12 s'). This block measures the
    // countdown, not pockets: every pocket that exists is marked tapped.
    { const T = s._tappedWater || (s._tappedWater = new Set()); for (const q of (s.substrate.reservoirs || [])) T.add(q.id); }
    const revealingAtT0 = g.mine.revealing();
    // A HAUL TO BANK, so "minerals rise by exactly the run's ore" cannot pass as 0 === 0.
    s.mineOre = (s.mineOre | 0) + 11; s.active.phosphorus = (s.active.phosphorus | 0) + 11;
    const cost = g.mine.costHere();
    s.active.water = cost - 1;
    return { depth: r.depth, cost, water: s.active.water, cheapest: g.mine.cheapest(),
             ore: g.mine.ore(), over: s.runOver, t0: performance.now(), revealingAtT0 };
  }, { m, QUIET: QUIET.toString(), settle });

  // =========================================================================================
  // 1. THE STUCK RULE — the tank cannot pay here, and nobody touches anything
  // =========================================================================================
  console.log('--- the soft lock ends itself');
  for (const seed of [5, 2024]) {
    const b = await E.bootMine(seed);
    const before = await b.page.evaluate(() => (JSON.parse(localStorage.getItem('mycelium.progress.v2') || '{}').minerals | 0));
    await b.page.evaluate(() => { window.__runEnd = []; window.__telemetry.tap((row) => { if (row.kind === 'run_end') window.__runEnd.push(row); }); });
    // NO SETTLE: the tank goes one short straight after the navigator's last dig, as the plan's probe
    // says. Before the reveal hold was capped this read 8.56 s (seed 5) and 9.75 s (seed 2024).
    const st = await toStuck(b.page, 67, false);
    ok(`seed ${seed}: the navigator reached 67 m`, st.depth >= 67 && !st.over,
       `${st.depth} m, tank ${st.water} against ${st.cost} here (cheapest ${st.cheapest}), reveal in flight at the change: ${st.revealingAtT0}`);
    // Not the old rule: the cheapest ground is still affordable, so only the new rule can end this.
    ok('...where the cheapest ground is still affordable', st.water >= st.cheapest, `${st.water} >= ${st.cheapest}`);
    const seen = await b.page.evaluate(async (t0) => {
      const out = { pillAt: null, overAt: null, pillText: '', left: [] };
      for (;;) {
        const now = performance.now() - t0;
        const p = document.getElementById('fruitnow');
        const vis = !!(p && !p.hidden && p.getBoundingClientRect().width > 0);
        if (vis && out.pillAt == null) { out.pillAt = now; out.pillText = p.textContent.replace(/\s+/g, ' ').trim(); }
        if (out.left.length < 40) out.left.push([Math.round(now), window.__game.mine.stuck().leftMs]);
        if (window.__game.state.runOver) { out.overAt = now; break; }
        if (now > 12000) break;
        await new Promise((r) => setTimeout(r, 50));
      }
      out.res = window.__game.state.runResult;
      return out;
    }, st.t0);
    ok('...#fruitnow is visible within 500 ms', seen.pillAt != null && seen.pillAt <= 500,
       `${seen.pillAt == null ? 'never' : Math.round(seen.pillAt) + ' ms'} — "${seen.pillText}"`);
    ok('...reading FRUIT NOW and what it banks', /FRUIT NOW · \+\d+ P/.test(seen.pillText) && seen.pillText.includes('+' + st.ore + ' P'),
       `"${seen.pillText}", ore ${st.ore}`);
    // Within 7.0 s (the plan) and not before ~5.5 s: an instant end would be the 1.6 s fuel rule or
    // a bug, and this block exists to measure the 6 s countdown.
    ok('...and the run is over within 7.0 s of the tank change, on the countdown', seen.overAt != null && seen.overAt <= 7000 && seen.overAt >= 5500,
       `${seen.overAt == null ? 'still live after 12 s' : (seen.overAt / 1000).toFixed(2) + ' s'}` +
       (seen.overAt != null && seen.overAt > 7000 ? '  trace ' + seen.left.filter((_, i) => i % 5 === 0).map((x) => x.join(':')).join(' ') : ''));
    ok('...with cause dry, as a fruiting', seen.res && seen.res.cause === 'dry' && seen.res.died === false,
       JSON.stringify(seen.res && { cause: seen.res.cause, died: seen.res.died }));
    await b.page.waitForSelector('#ssMineEnd', { timeout: 20000 }).catch(() => {});
    const after = await b.page.evaluate(() => ({ minerals: JSON.parse(localStorage.getItem('mycelium.progress.v2') || '{}').minerals | 0,
      ore: window.__game.state.runResult.ore, text: (document.getElementById('ssMineEnd') || {}).innerText || '',
      rows: window.__runEnd }));
    ok('...and p.minerals rises by exactly the run\'s ore', after.ore > 0 && after.minerals - before === after.ore,
       `${before} -> ${after.minerals}, ore ${after.ore}`);
    ok('...the end screen says it ran out of water here', /Out of water at \d+ m/.test(after.text), after.text.split('\n').slice(0, 4).join(' | '));
    // 10. TELEMETRY: the run_end row carries the duration and the cause.
    const row = after.rows[0] || {};
    ok('...and run_end carries ms and the cause', after.rows.length === 1 && row.ms > 0 && row.detail === 'dry' && row.cause === 'dry',
       `${after.rows.length} row(s): ms=${row.ms} detail=${row.detail} cause=${row.cause}`);
    ok('no page errors', b.errs.length === 0, b.errs.slice(0, 2).join(' | ') || 'clean');
    await b.ctx.close();
  }

  // =========================================================================================
  // 2. ...AND ONE AFFORDABLE DIG RESETS IT — the recovery play the old rule was written for
  // =========================================================================================
  console.log('--- a cheap dig resets the countdown');
  {
    const b = await E.bootMine(5);
    const st = await toStuck(b.page, 67);
    const r = await b.page.evaluate(async (t0) => {
      const g = window.__game, s = g.state, sub = s.substrate;
      while (performance.now() - t0 < 3000) await new Promise((res) => setTimeout(res, 25));
      const leftBefore = g.mine.stuck().leftMs;
      // A refused dig at the working front names FRUIT NOW and what it banks.
      let deep = null;
      for (const n of s.active.nodes) if (!n.infected && (!deep || n.y > deep.y)) deep = n;
      const refusal = g.mine.growFrom(deep.x, deep.y, deep.x, deep.y + 200).message;
      // One dig from a SHALLOWER strand, priced 2 against a tank of 3.
      const cands = s.active.nodes.filter((n) => !n.infected && (n.y - sub.surfaceY) / sub.cellSize < 38)
        .sort((a, b2) => b2.y - a.y);
      let dug = null;
      for (const n of cands.slice(0, 80)) {
        for (const [dx, dy] of [[160, 0], [-160, 0], [0, 160], [120, 120], [-120, 120]]) {
          if (sub.solidAtWorld(n.x + dx * 0.5, n.y + dy * 0.5)) continue;
          const w0 = s.active.water;
          const res = g.mine.growFrom(n.x, n.y, n.x + dx, n.y + dy);
          if (res.ok) { dug = { from: Math.round((n.y - sub.surfaceY) / sub.cellSize), paid: w0 - s.active.water }; break; }
        }
        if (dug) break;
      }
      const leftAfter = g.mine.stuck().leftMs;
      await new Promise((res) => requestAnimationFrame(() => requestAnimationFrame(res)));
      return { leftBefore, leftAfter, leftFrame: g.mine.stuck().leftMs, dug, over: s.runOver, on: g.mine.stuck().on, refusal, ore: g.mine.ore() };
    }, st.t0);
    ok('the countdown was running at 3 s', r.leftBefore > 2500 && r.leftBefore < 3500, `${r.leftBefore} ms left`);
    ok('a refused dig says the price and what fruiting now banks',
       new RegExp('^Not enough water — a dig here costs \\d+\\. Fruit now to bank \\+' + r.ore + ' P\\.$').test(r.refusal || ''), `"${r.refusal}"`);
    ok('a dig from a shallower strand succeeded, for 2', !!r.dug && r.dug.paid === 2, JSON.stringify(r.dug));
    ok('...and stuck().leftMs returns to 6000 ±100', Math.abs(r.leftAfter - 6000) <= 100 && Math.abs(r.leftFrame - 6000) <= 100,
       `${r.leftAfter} ms at once, ${r.leftFrame} ms a frame later (run over: ${r.over})`);
    await b.ctx.close();
  }

  // =========================================================================================
  // 3. FRUIT NOW — one tap ends it, and the end screen says who called it
  // =========================================================================================
  console.log('--- FRUIT NOW');
  {
    const b = await E.bootMine(2024);
    await b.page.evaluate(() => { window.__runEnd = []; window.__telemetry.tap((row) => { if (row.kind === 'run_end') window.__runEnd.push(row); }); });
    const st = await toStuck(b.page, 67);
    await b.page.waitForFunction(() => { const p = document.getElementById('fruitnow'); return p && !p.hidden; }, { timeout: 3000 }).catch(() => {});
    await sleep(900);
    const pill = await b.page.evaluate(() => {
      const r = document.getElementById('fruitnow').getBoundingClientRect();
      return { x0: r.left, x1: r.right, y0: r.top, y1: r.bottom, vw: innerWidth, vh: innerHeight,
               chipHidden: document.getElementById('hud-digcost').hidden,
               ring: getComputedStyle(document.getElementById('fruitnow-ring')).getPropertyValue('--fn').trim() };
    });
    await b.page.screenshot({ path: path.join(ART, 'm1-fruitnow.png') });
    ok('the price chip gives way to the pill, which is on screen', pill.chipHidden && pill.x0 >= 0 && pill.x1 <= pill.vw && pill.y0 >= 0 && pill.y1 <= pill.vh,
       `x ${Math.round(pill.x0)}-${Math.round(pill.x1)} of ${pill.vw}, y ${Math.round(pill.y0)}-${Math.round(pill.y1)}`);
    ok('...with its ring counting down', +pill.ring > 0.5 && +pill.ring < 1, `--fn ${pill.ring}`);
    await b.page.click('#fruitnow');
    await b.page.waitForSelector('#ssMineEnd', { timeout: 20000 }).catch(() => {});
    const end = await b.page.evaluate(() => ({ res: window.__game.state.runResult, text: (document.getElementById('ssMineEnd') || {}).innerText || '',
      rows: window.__runEnd }));
    ok('clicking #fruitnow ends the run with cause fruit', end.res && end.res.cause === 'fruit' && end.res.died === false,
       JSON.stringify(end.res && { cause: end.res.cause, died: end.res.died, depth: end.res.depth }));
    ok('...and #ssMineEnd says "You called it"', /You called it at \d+ m/.test(end.text), end.text.split('\n').slice(0, 4).join(' | '));
    const row = end.rows[0] || {};
    ok('...and run_end has ms > 0 and detail = the cause', end.rows.length === 1 && row.ms > 0 && row.detail === 'fruit',
       `ms=${row.ms} detail=${row.detail}`);
    ok('no page errors', b.errs.length === 0, b.errs.slice(0, 2).join(' | ') || 'clean');
    await b.ctx.close();
  }

  // =========================================================================================
  // 3b. FRUIT NOW ON A PHONE, IN THE STATE IT EXISTS FOR — a worm on the colony and the rot clock
  //     up, NOT the quiet shaft. In the resource row the pill overflowed here: one worm chip put
  //     '+23 P' off a 390 px screen, a worm plus the rot clock left 'FRU' (x 348-508). It has its
  //     own fixed slot now; it must lie inside the viewport and be what a tap at its centre hits.
  // =========================================================================================
  console.log('--- FRUIT NOW on a phone, with a worm on and the rot clock up');
  for (const [vw, vh] of [[390, 844], [360, 640]]) {
    const b = await E.bootMine(5, vw, vh);
    const m = await b.page.evaluate(async () => {
      const g = window.__game, s = g.state;
      // Nothing respawns (so the setup is the one worm and the one cloud), but nothing is removed.
      s.config.nematodes.respawnChance = 0; s.config.trichoderma.respawnChance = 0;
      s.nematodes.length = 0; s.clouds.length = 0;
      s.active.water = 100000;
      const nav = await window.__navDig({ targetM: 67, maxIters: 700 });
      s.mineOre = (s.mineOre | 0) + 23; s.active.phosphorus = (s.active.phosphorus | 0) + 23;
      s.mineMats = Object.assign({}, s.mineMats, { anthracite: 2 });
      const R = (id) => { const e = document.getElementById(id); if (!e || e.hidden) return null; const q = e.getBoundingClientRect();
        return q.width > 0 ? { x0: q.left, x1: q.right, y0: q.top, y1: q.bottom } : null; };
      const hitAt = (r, id) => { if (!r) return false; const h = document.elementFromPoint((r.x0 + r.x1) / 2, (r.y0 + r.y1) / 2);
        return !!(h && h.closest && h.closest('#' + id)); };
      const frames = () => new Promise((res) => requestAnimationFrame(() => requestAnimationFrame(res)));
      // FIRST, the ordinary stuck state below 42 m: one deep material held, no worm, no rot. The gear
      // was on screen here before M1 (x 302-334) and off it with the pill in the row (x 389-421).
      s.active.water = g.mine.costHere() - 1;
      await frames(); await new Promise((res) => setTimeout(res, 100));
      const gear0 = R('gearbtn'), gear0Hit = hitAt(gear0, 'gearbtn'), pill0 = !!R('fruitnow');
      s.active.water = 100000;
      await frames();
      let tip = null;
      for (const n of s.active.nodes) if (!n.infected && (!tip || n.y > tip.y)) tip = n;
      // The worm first (it takes a moment to latch on), then the tank one short here (the cheapest
      // ground still affordable), then the rot — measured as soon as its clock shows, because along
      // a single shaft the rot overruns the colony within seconds, and that ends the run.
      g.mine.spawnWorm(tip.x + 8, tip.y);
      for (let i = 0; i < 120 && !((s.mineAttached | 0) > 0); i++) await new Promise((res) => setTimeout(res, 100));
      s.active.water = g.mine.costHere() - 1;
      s.config.mine.infectionMs = 60000;             // the deadline is not under test; the chip is
      // AT THE DEEPEST TIP, as block 5 does: a breach claims `freshGrowthRings` of just-dug strands,
      // and near the surface of a single freshly dug shaft that is the whole colony (it overran 252
      // of 252 strands at once and ended the run 'infected' before the clock could show).
      g.mine.spawnCloud(tip.x, tip.y);
      for (let i = 0; i < 200; i++) {
        const ic = document.getElementById('hud-infect'), fn = document.getElementById('fruitnow');
        if (s.runOver || (ic && !ic.hidden && fn && !fn.hidden)) break;
        await new Promise((res) => setTimeout(res, 25));
      }
      await frames();
      const pill = R('fruitnow'), gear = R('gearbtn');
      return { depth: nav.depth, attached: s.mineAttached | 0, rot: !!s.mineInfect, stuck: g.mine.stuck(), over: s.runOver,
               worms: R('hud-worms'), inf: R('hud-infect'), pill, gear, pillHit: hitAt(pill, 'fruitnow'), gearHit: hitAt(gear, 'gearbtn'),
               gear0, gear0Hit, pill0,
               text: (document.getElementById('fruitnow') || {}).textContent || '', vw: innerWidth, vh: innerHeight };
    });
    await b.page.screenshot({ path: path.join(ART, `m1-fruitnow-busy-${vw}.png`) });
    const f = (r) => r ? `x ${Math.round(r.x0)}-${Math.round(r.x1)}, y ${Math.round(r.y0)}-${Math.round(r.y1)}` : 'not shown';
    ok(`${vw}x${vh}: stuck with a worm attached and the rot clock up`, m.stuck.on && !m.over && m.attached >= 1 && m.rot && !!m.worms && !!m.inf,
       `${m.depth} m, ${m.attached} worm(s), rot ${m.rot}, worm chip ${f(m.worms)}, rot chip ${f(m.inf)}`);
    ok('...#fruitnow lies fully on screen', !!m.pill && m.pill.x0 >= 0 && m.pill.x1 <= m.vw && m.pill.y0 >= 0 && m.pill.y1 <= m.vh,
       `${f(m.pill)} of ${m.vw}x${m.vh} — "${m.text.replace(/\s+/g, ' ').trim()}"`);
    ok('...and a tap at its centre hits it', m.pillHit, String(m.pillHit));
    ok('...and it is thumb-sized (>= 40 px tall)', !!m.pill && m.pill.y1 - m.pill.y0 >= 40, m.pill ? `${(m.pill.y1 - m.pill.y0).toFixed(1)} px` : '-');
    // THE GEAR stays reachable at 390 while the pill is up in the ordinary stuck state (one material,
    // no worm, no rot): the price chip gives the row its width back. With a worm AND the rot chip
    // the row still overruns — M3's position:fixed gear, tracked there by name.
    if (vw === 390) {
      ok('...and at 390, stuck holding one material, Settings is on screen and hit-tests', m.pill0 && !!m.gear0 && m.gear0.x1 <= m.vw && m.gear0Hit,
         `gear ${f(m.gear0)} with the pill up`);
      // M3: the gear is position:fixed outside the rows, so the worm chip and the rot banner can no
      // longer push it off (before M3 it sat at x 379-411 here).
      ok('...and with the worm and rot chips up too (M3)', !!m.gear && m.gear.x1 <= m.vw && m.gearHit,
         `gear ${f(m.gear)}`);
    } else {
      await b.page.click('#fruitnow').catch(() => {});
      await b.page.waitForSelector('#ssMineEnd', { timeout: 20000 }).catch(() => {});
      const c = await b.page.evaluate(() => window.__game.state.runResult && window.__game.state.runResult.cause);
      ok('...and clicking it there ends the run as fruit', c === 'fruit', String(c));
    }
    ok('no page errors', b.errs.length === 0, b.errs.slice(0, 2).join(' | ') || 'clean');
    await b.ctx.close();
  }

  // =========================================================================================
  // 4. THE TWO EXITS BANK EVERYTHING
  // =========================================================================================
  console.log('--- the exits');
  const toHolding = async (page) => page.evaluate(async ({ QUIET }) => {
    new Function('return (' + QUIET + ')')()();
    const g = window.__game, s = g.state;
    s.active.water = 100000;
    const r = await window.__navDig({ targetM: 45, maxIters: 500 });
    s.mineOre = 9; s.active.phosphorus = 9;       // "holding 9 P"
    s.active.water = 100000;
    await new Promise((res) => setTimeout(res, 1200));
    return { depth: r.depth, minerals: JSON.parse(localStorage.getItem('mycelium.progress.v2') || '{}').minerals | 0 };
  }, { QUIET: QUIET.toString() });
  {
    const b = await E.bootMine(4242);
    const h = await toHolding(b.page);
    const menu = await b.page.evaluate(() => {
      const t = document.getElementById('set-tutorial'), f = document.getElementById('set-forcefruit'), x = document.getElementById('set-saveexit');
      return { tut: !!(t && t.getClientRects().length && !t.hidden), ff: f ? f.textContent.trim() : null, se: x ? x.textContent.trim() : null };
    });
    ok('#set-tutorial is not offered in the mine', menu.tut === false, String(menu.tut));
    ok('the exits say what they bank', menu.ff === 'End descent (banks everything)' && menu.se === 'Exit to title (banks everything)',
       `"${menu.ff}" / "${menu.se}"`);
    await b.page.evaluate(() => { document.getElementById('gearbtn').click(); });
    await sleep(300);
    await b.page.evaluate(() => { document.getElementById('set-forcefruit').click(); });
    await b.page.waitForSelector('#ssMineEnd', { timeout: 20000 }).catch(() => {});
    const e = await b.page.evaluate(() => ({ res: window.__game.state.runResult, text: (document.getElementById('ssMineEnd') || {}).innerText || '',
      minerals: JSON.parse(localStorage.getItem('mycelium.progress.v2') || '{}').minerals | 0 }));
    ok(`End descent at ${h.depth} m holding 9 P ends it as 'abandon'`, h.depth >= 45 && e.res && e.res.cause === 'abandon' && e.res.died === false,
       JSON.stringify(e.res && { cause: e.res.cause, died: e.res.died, depth: e.res.depth }));
    ok('...#ssMineEnd says nothing about being eaten', !!e.text && !/eaten/i.test(e.text) && /You ended the descent at \d+ m/.test(e.text),
       e.text.split('\n').slice(0, 4).join(' | '));
    ok('...and minerals rise by 9', e.minerals - h.minerals === 9, `${h.minerals} -> ${e.minerals}`);
    ok('no page errors', b.errs.length === 0, b.errs.slice(0, 2).join(' | ') || 'clean');
    await b.ctx.close();
  }
  {
    const b = await E.bootMine(4242);
    const h = await toHolding(b.page);
    await b.page.evaluate(() => { document.getElementById('gearbtn').click(); });
    await sleep(300);
    await b.page.evaluate(() => { document.getElementById('set-saveexit').click(); });
    await b.page.waitForSelector('#titleScreen', { timeout: 20000 }).catch(() => {});
    await sleep(2500);
    const t = await b.page.evaluate(() => {
      const p = JSON.parse(localStorage.getItem('mycelium.progress.v2') || '{}');
      const ts = document.getElementById('titleScreen'), bk = document.getElementById('tsBanked');
      return { title: !!(ts && ts.getClientRects().length), banked: bk ? bk.textContent.trim() : null,
               minerals: p.minerals | 0, best: p.mineBest | 0, endScreen: !!document.getElementById('ssMineEnd'),
               cause: window.__game.state.runResult && window.__game.state.runResult.cause };
    });
    await b.page.screenshot({ path: path.join(ART, 'm1-exit-title.png') });
    ok(`Exit to title at ${h.depth} m holding 9 P shows the title`, t.title && !t.endScreen, `title ${t.title}, end screen ${t.endScreen}`);
    ok('...with minerals up by 9', t.minerals - h.minerals === 9, `${h.minerals} -> ${t.minerals}`);
    ok('...p.mineBest >= 45', t.best >= 45, `${t.best} m`);
    // Was t.banked === '+9 P banked': the line now also names the deep materials the descent banked
    // (the navigator digs anthracite on its way to 45 m on this seed).
    ok('...cause quit, and the title says what was banked', t.cause === 'quit' && /^\+9 P(, \+\d+ [A-Z][a-z]+)* banked$/.test(t.banked || ''), `${t.cause}, "${t.banked}"`);
    ok('no page errors', b.errs.length === 0, b.errs.slice(0, 2).join(' | ') || 'clean');
    await b.ctx.close();
  }

  // =========================================================================================
  // 5. AN INFECTED ENDING PAYS AND RECORDS THE RUNNING MAXIMUM
  // =========================================================================================
  console.log('--- the rot does not unmake depth');
  {
    const b = await E.bootMine(4242);
    const inf = await b.page.evaluate(async ({ QUIET }) => {
      new Function('return (' + QUIET + ')')()();
      const g = window.__game, s = g.state;
      s.active.water = 100000;
      const r = await window.__navDig({ targetM: 107, maxIters: 900 });
      await new Promise((res) => setTimeout(res, 2000));
      const reached = g.mine.maxDepth();
      s.config.mine.infectionMs = 6000;             // the deadline is not under test; the depth is
      let tip = null;
      for (const n of s.active.nodes) if (!n.infected && (!tip || n.y > tip.y)) tip = n;
      g.mine.spawnCloud(tip.x, tip.y);
      let cleanAtEnd = null;
      for (let i = 0; i < 400 && !s.runOver; i++) {
        cleanAtEnd = g.mine.depth();
        await new Promise((res) => setTimeout(res, 50));
      }
      return { navDepth: r.depth, reached, cleanAtEnd, over: s.runOver, res: s.runResult };
    }, { QUIET: QUIET.toString() });
    await b.page.waitForSelector('#ssMineEnd', { timeout: 20000 }).catch(() => {});
    const e = await b.page.evaluate(() => ({ shown: ((document.querySelector('#ssMineEnd .ss-mineend-depth') || {}).textContent || '').replace(/\D/g, ''),
      best: JSON.parse(localStorage.getItem('mycelium.progress.v2') || '{}').mineBest | 0,
      text: (document.getElementById('ssMineEnd') || {}).innerText || '' }));
    ok('the navigator reached 107 m', inf.reached >= 107, `${inf.reached} m`);
    // Not vacuous: the rot must actually have taken the deepest strands, or the running maximum and
    // the live reading agree and this proves nothing.
    ok('...the rot took the deepest strands before the end', inf.over && inf.cleanAtEnd < inf.reached,
       `clean depth ${inf.cleanAtEnd} m at the end, against ${inf.reached} m reached`);
    ok('...the run ended infected', inf.res && inf.res.cause === 'infected', inf.res && inf.res.cause);
    ok('...and the end screen reads the depth reached', +e.shown === inf.reached, `"${e.shown}" vs ${inf.reached} m`);
    ok('...and so does p.mineBest', e.best === inf.reached, `${e.best} vs ${inf.reached}`);
    ok('...with the rot\'s own line', /The rot took the colony at \d+ m/.test(e.text), e.text.split('\n').slice(0, 4).join(' | '));
    await b.ctx.close();
  }

  // =========================================================================================
  // 6. THE NODE CAP IS AN ENDING, NOT A WALL
  // =========================================================================================
  console.log('--- the node cap');
  {
    const b = await E.bootMine(909);
    const cap = await b.page.evaluate(async ({ QUIET }) => {
      new Function('return (' + QUIET + ')')()();
      const g = window.__game, s = g.state;
      s.active.water = 100000;
      await window.__navDig({ targetM: 20, maxIters: 200 });
      await new Promise((res) => setTimeout(res, 1500));
      const live = !s.runOver, mineCap = s.config.growth.maxNodes;
      s.config.growth.maxNodes = s.active.nodes.length + 10;
      const t0 = performance.now();
      while (!s.runOver && performance.now() - t0 < 4000) await new Promise((res) => setTimeout(res, 20));
      return { live, mineCap, over: s.runOver, ms: performance.now() - t0, cause: s.runResult && s.runResult.cause };
    }, { QUIET: QUIET.toString() });
    ok('the mine runs on its own node cap', cap.mineCap === 9000, String(cap.mineCap));
    ok('with maxNodes forced to nodes + 10, the run ends as full', cap.live && cap.over && cap.cause === 'full', `${cap.cause}`);
    ok('...within 2 s of reaching the cap', cap.ms <= 2000, `${Math.round(cap.ms)} ms`);
    await b.page.waitForSelector('#ssMineEnd', { timeout: 20000 }).catch(() => {});
    const t = await b.page.evaluate(() => (document.getElementById('ssMineEnd') || {}).innerText || '');
    ok('...with its own line', /fills every passage/.test(t), t.split('\n').slice(0, 4).join(' | '));
    await b.ctx.close();
  }

  // =========================================================================================
  // 7. A CLOSED TAB BANKS ONCE
  // =========================================================================================
  console.log('--- a hidden tab');
  {
    const b = await E.bootMine(5);
    const h = await b.page.evaluate(async ({ QUIET }) => {
      new Function('return (' + QUIET + ')')()();
      const g = window.__game, s = g.state;
      s.active.water = 100000;
      await window.__navDig({ targetM: 30, maxIters: 300 });
      s.mineOre = 13; s.active.phosphorus = 13; s.mineMats = Object.assign({}, s.mineMats, { anthracite: 2 });
      const p0 = JSON.parse(localStorage.getItem('mycelium.progress.v2') || '{}');
      // Visible -> hidden -> visible first: coming back clears the pending copy.
      Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
      document.dispatchEvent(new Event('visibilitychange'));
      // One record, keyed by this page's run (the map shape came with the two-tab fix).
      const map = JSON.parse(localStorage.getItem('mycelium.progress.v2') || '{}').minePending || {};
      const wrote = Object.keys(map).length === 1 ? Object.values(map)[0] : null;
      Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' });
      document.dispatchEvent(new Event('visibilitychange'));
      const cleared = JSON.parse(localStorage.getItem('mycelium.progress.v2') || '{}').minePending || null;
      Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
      document.dispatchEvent(new Event('visibilitychange'));
      return { minerals: p0.minerals | 0, anth: (p0.mats && p0.mats.anthracite) | 0, wrote, cleared,
               depth: g.mine.maxDepth(), pending: JSON.parse(localStorage.getItem('mycelium.progress.v2') || '{}').minePending };
    }, { QUIET: QUIET.toString() });
    ok('hidden writes the would-be payout', h.wrote && h.wrote.P === 13 && h.wrote.mats.anthracite === 2 && h.wrote.depth === h.depth,
       JSON.stringify(h.wrote));
    ok('...and visible again clears it', h.cleared === null, JSON.stringify(h.cleared));
    // Reload to the plain title: the leftover is banked once, at boot.
    await b.page.goto(E.base + '/index.html', { waitUntil: 'domcontentloaded' });
    await b.page.waitForSelector('#loadscreen.ld-ready', { timeout: 40000 }).catch(() => {});
    await b.page.click('#loadscreen', { timeout: 5000 }).catch(() => {});
    await b.page.waitForSelector('#titleScreen', { timeout: 20000 }).catch(() => {});
    await sleep(1500);
    const r1 = await b.page.evaluate(() => { const p = JSON.parse(localStorage.getItem('mycelium.progress.v2') || '{}');
      const bk = document.getElementById('tsBanked');
      return { minerals: p.minerals | 0, anth: (p.mats && p.mats.anthracite) | 0, best: p.mineBest | 0, pending: p.minePending || null, note: bk ? bk.textContent.trim() : null }; });
    ok('a reload banks the pending payout', r1.minerals - h.minerals === 13 && r1.anth - h.anth === 2 && r1.pending === null,
       `P ${h.minerals} -> ${r1.minerals}, anthracite ${h.anth} -> ${r1.anth}, pending ${JSON.stringify(r1.pending)}`);
    ok('...records its depth', r1.best >= h.depth && h.depth > 0, `${r1.best} m`);
    // Was 'Your last descent spored +13 P': the note now names the materials it banked as well.
    ok('...and the title says so', r1.note === 'Your last descent spored +13 P, +2 Anthracite', `"${r1.note}"`);
    await b.page.screenshot({ path: path.join(ART, 'm1-title-pending.png') });
    await b.page.goto(E.base + '/index.html', { waitUntil: 'domcontentloaded' });
    await b.page.waitForSelector('#loadscreen.ld-ready', { timeout: 40000 }).catch(() => {});
    await b.page.click('#loadscreen', { timeout: 5000 }).catch(() => {});
    await b.page.waitForSelector('#titleScreen', { timeout: 20000 }).catch(() => {});
    await sleep(1200);
    const r2 = await b.page.evaluate(() => { const p = JSON.parse(localStorage.getItem('mycelium.progress.v2') || '{}');
      return { minerals: p.minerals | 0, note: !!document.getElementById('tsBanked') }; });
    ok('...and a second reload adds nothing', r2.minerals === r1.minerals && r2.note === false, `${r1.minerals} -> ${r2.minerals}, note ${r2.note}`);
    ok('no page errors', b.errs.length === 0, b.errs.slice(0, 2).join(' | ') || 'clean');
    await b.ctx.close();
  }

  // =========================================================================================
  // 7b. TWO TABS OF ONE PROFILE — the pending record is stamped with its run. Before: tab A hidden
  //     wrote {P}, tab B's boot banked it, A came back and ended, and `mineBank` paid the whole run
  //     again (0 -> 17 for a haul of 10); and B becoming visible deleted A's record outright.
  // =========================================================================================
  console.log('--- two tabs of one profile');
  {
    const ctx = await E.browser.newContext({ viewport: { width: 390, height: 844 } });
    const a = await E.bootMine(5, 390, 844, { ctx });
    const hide = (page, v) => page.evaluate((v) => {
      Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => v });
      document.dispatchEvent(new Event('visibilitychange'));
    }, v);
    const prog = (page) => page.evaluate(() => JSON.parse(localStorage.getItem('mycelium.progress.v2') || '{}'));
    const a0 = await a.page.evaluate(async ({ QUIET }) => {
      new Function('return (' + QUIET + ')')()();
      const g = window.__game, s = g.state;
      s.active.water = 100000;
      await window.__navDig({ targetM: 20, maxIters: 200 });
      s.mineOre = 20; s.active.phosphorus = 20; s.mineMats = Object.assign({}, s.mineMats, { anthracite: 1 });
      return { minerals: JSON.parse(localStorage.getItem('mycelium.progress.v2') || '{}').minerals | 0,
               anth: ((JSON.parse(localStorage.getItem('mycelium.progress.v2') || '{}').mats || {}).anthracite) | 0 };
    }, { QUIET: QUIET.toString() });
    await hide(a.page, 'hidden');                                  // A writes its record
    const pw = (await prog(a.page)).minePending || {};
    // Tab B opens the game (the title) and its boot banks A's record.
    const bb = await E.boot('', 390, 844, { ctx });
    await bb.page.waitForSelector('#titleScreen', { timeout: 20000 }).catch(() => {});
    await sleep(1200);
    const p1 = await prog(bb.page);
    const note = await bb.page.evaluate(() => { const e = document.getElementById('tsBanked'); return e ? e.textContent.trim() : null; });
    ok('tab B\'s boot banks tab A\'s pending payout, once', Object.keys(pw).length === 1 && (p1.minerals | 0) - a0.minerals === 20 && !p1.minePending,
       `record ${JSON.stringify(pw)}; P ${a0.minerals} -> ${p1.minerals | 0}, pending ${JSON.stringify(p1.minePending || null)}`);
    ok('...its title names what it banked, materials by name', note === 'Your last descent spored +20 P, +1 Anthracite', `"${note}"`);
    // A comes back, digs 3 more P, and goes hidden again: its new record is only what B did not bank.
    await hide(a.page, 'visible');
    await a.page.evaluate(() => { const s = window.__game.state; s.mineOre = 23; s.active.phosphorus = 23; });
    await hide(a.page, 'hidden');
    const pw2 = (await prog(a.page)).minePending || {};
    const rec2 = Object.values(pw2)[0] || null;
    ok('...A\'s next record is only the rest of the haul', Object.keys(pw2).length === 1 && rec2 && rec2.P === 3 && !(rec2.mats && rec2.mats.anthracite),
       JSON.stringify(pw2));
    // B becoming visible must not delete A's record (it is not B's run).
    await bb.page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
    const pw3 = (await prog(a.page)).minePending || {};
    ok('...and tab B becoming visible leaves A\'s record alone', Object.keys(pw3).length === 1, JSON.stringify(pw3));
    // A comes back and ends the descent: it pays only what B did not.
    await hide(a.page, 'visible');
    await a.page.evaluate(() => window.__game.mine.end());
    await a.page.waitForSelector('#ssMineEnd', { timeout: 20000 }).catch(() => {});
    await sleep(500);
    const p2 = await prog(a.page);
    ok('...A\'s own ending pays the rest, so the run pays its haul exactly once',
       (p2.minerals | 0) - a0.minerals === 23 && ((p2.mats || {}).anthracite | 0) - a0.anth === 1 && !p2.minePending && !p2.mineTaken,
       `P ${a0.minerals} -> ${p2.minerals | 0} (haul 23), anthracite ${a0.anth} -> ${(p2.mats || {}).anthracite | 0}, pending ${JSON.stringify(p2.minePending || null)}, taken ${JSON.stringify(p2.mineTaken || null)}`);
    ok('no page errors', a.errs.length === 0 && bb.errs.length === 0, a.errs.concat(bb.errs).slice(0, 2).join(' | ') || 'clean');
    await ctx.close();
  }

  // =========================================================================================
  // 7c. ROT OVERRUNNING EVERY STRAND BEFORE THE CLOCK is the mine's 'infected' ending, not the
  //     campaign's death: before, tickWorld built {died:true, cause:'infected'} with no depth or ore,
  //     logged 'The colony has been consumed. Run over.', and `minePendingWrite` skipped it.
  // =========================================================================================
  console.log('--- the rot takes every strand before its clock');
  {
    const b = await E.bootMine(4242);
    const r = await b.page.evaluate(async ({ QUIET }) => {
      new Function('return (' + QUIET + ')')()();
      const g = window.__game, s = g.state;
      s.active.water = 100000;
      await window.__navDig({ targetM: 9, maxIters: 120 });
      await new Promise((res) => setTimeout(res, 800));
      s.mineOre = 5; s.active.phosphorus = 5;
      s.config.mine.infectionMs = 60000;             // so only the overrun, not the clock, can end it
      const reached = g.mine.maxDepth();
      const nodes = s.active.nodes.slice();
      for (let i = 0; i < nodes.length; i += 3) g.mine.spawnCloud(nodes[i].x, nodes[i].y);
      const t0 = performance.now();
      while (!s.runOver && performance.now() - t0 < 20000) await new Promise((res) => setTimeout(res, 20));
      const res = s.runResult || {};
      const logs = (s.logEntries || []).map((e) => e.message);
      return { reached, ms: performance.now() - t0, over: s.runOver,
               res: { mine: res.mine, died: res.died, cause: res.cause, depth: res.depth, ore: res.ore, ms: res.ms },
               consumed: logs.some((m) => /consumed/.test(m)), rotLine: logs.some((m) => /^The infection took the colony at \d+ m/.test(m)) };
    }, { QUIET: QUIET.toString() });
    ok('the rot overran the colony before its clock', r.over && r.ms < 20000, `${Math.round(r.ms)} ms, reached ${r.reached} m`);
    ok('...and it ends as the mine\'s infected fruiting', r.res.mine === true && r.res.died === false && r.res.cause === 'infected'
       && r.res.depth >= r.reached && r.res.ore === 5 && r.res.ms > 0, JSON.stringify(r.res));
    ok('...with the mine\'s log line, not the campaign\'s', r.rotLine && !r.consumed, `rot line ${r.rotLine}, 'consumed' ${r.consumed}`);
    await b.page.waitForSelector('#ssMineEnd', { timeout: 20000 }).catch(() => {});
    const t = await b.page.evaluate(() => (document.getElementById('ssMineEnd') || {}).innerText || '');
    ok('...and the end screen reads the rot\'s line', /The rot took the colony at \d+ m/.test(t), t.split('\n').slice(0, 4).join(' | '));
    ok('no page errors', b.errs.length === 0, b.errs.slice(0, 2).join(' | ') || 'clean');
    await b.ctx.close();
  }

  // =========================================================================================
  // 8. THE END SCREEN AT 390 x 844
  // =========================================================================================
  console.log('--- the end screen on a phone');
  {
    const b = await E.bootMine(5, 390, 844);
    await b.page.evaluate(async ({ QUIET }) => {
      new Function('return (' + QUIET + ')')()();
      const g = window.__game, s = g.state;
      s.active.water = 100000;
      await window.__navDig({ targetM: 30, maxIters: 300 });
      s.mineOre = 23; s.active.phosphorus = 23; s.mineMats = Object.assign({}, s.mineMats, { anthracite: 4 });
      await new Promise((res) => setTimeout(res, 800));
      g.mine.end();
    }, { QUIET: QUIET.toString() });
    await b.page.waitForSelector('#ssMineEnd', { timeout: 20000 }).catch(() => {});
    await sleep(3500);   // let the wordmark grow in
    const m = await b.page.evaluate(() => {
      const root = document.getElementById('ssMineEnd');
      const earned = root.querySelector('.ss-win-earned'), icon = earned && earned.querySelector('.ss-ri');
      const cs = getComputedStyle(earned);
      const lh = cs.lineHeight === 'normal' ? parseFloat(cs.fontSize) * 1.2 : parseFloat(cs.lineHeight);
      const tr = root.querySelector('.ss-win-title').getBoundingClientRect();
      // THE INK, not only the box: a word that overruns its canvas is clipped inside a box that fits.
      const cv = root.querySelector('.ss-win-title canvas');
      let ink = null;
      if (cv) {
        const c2 = cv.getContext('2d'), d = c2.getImageData(0, 0, cv.width, cv.height).data;
        let x0 = Infinity, x1 = -1;
        for (let y = 0; y < cv.height; y += 2) for (let x = 0; x < cv.width; x++) {
          if (d[(y * cv.width + x) * 4 + 3] > 40) { if (x < x0) x0 = x; if (x > x1) x1 = x; }
        }
        ink = { x0, x1, w: cv.width, scale: cv.width / tr.width };
      }
      return { iconH: icon ? icon.getBoundingClientRect().height : null, lh, title: { x0: tr.left, x1: tr.right },
               ink, text: root.innerText };
    });
    await b.page.screenshot({ path: path.join(ART, 'm1-end-390.png') });
    ok('the P icon is at most 1.3x its line height', m.iconH != null && m.iconH <= 1.3 * m.lh, `${m.iconH && m.iconH.toFixed(1)} px against a ${m.lh.toFixed(1)} px line`);
    ok('the wordmark rect lies within x 16-374', m.title.x0 >= 16 - 0.5 && m.title.x1 <= 374 + 0.5, `${m.title.x0.toFixed(1)}-${m.title.x1.toFixed(1)}`);
    ok('...and its ink is not clipped at either edge', m.ink && m.ink.x0 > 2 && m.ink.x1 < m.ink.w - 3,
       m.ink ? `ink ${m.ink.x0}-${m.ink.x1} of ${m.ink.w} canvas px` : 'no canvas');
    ok("'Anthracite' is named when any was dug", /\+4\s*Anthracite/.test(m.text), m.text.split('\n').filter((l) => /\+/.test(l)).join(' | '));
    ok('no page errors', b.errs.length === 0, b.errs.slice(0, 2).join(' | ') || 'clean');
    await b.ctx.close();
  }

  await E.close();
  console.log(`\n==== ${pass} passed, ${fail} failed ====`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('HARNESS ERROR', e); process.exit(1); });
