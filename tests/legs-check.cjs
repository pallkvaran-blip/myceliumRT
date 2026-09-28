/* JOURNEY I, PART 3: LEGS 4-8, ESCALATION, THE PROMISED LAND, LONG-RUN PERFORMANCE — the finishing
 * plan's M9, as assertions.
 *
 *   rules    each leg's one rule lands on the run's config clone as the table row says: leg 7's
 *            `threatBands` equals its row, leg 4's mould band and leg 8's extra creatures likewise, leg 5's
 *            `richChance` 0.5, and legs 1 / 3 keep their M7 rules (calm = no creature, dry = no pocket
 *            above 42 m). On leg 6 `mineHeatLines` is [36, 78, 120] and with one tolerance step [50, 92,
 *            134]; a strand past 36 m fires the small '36 m / Digs now cost 4' beat and past 42 m the band
 *            beat names ANTHRACITE with 'Digs still cost 4' (the beat reads the run's config, not the
 *            literal's). The resting zoom reads the run's config too (a change to state.config moves it).
 *   legs     legs 1-8 through tests/bots/legprobe.cjs's `measure` on the REAL fine mask: the flood from the
 *            home head reaches the taproot (fine mask and growth lattice), the taproot sits within 1 cell of
 *            the table (the generator's record), and the shortest growth-lattice path is 1.3-2.0x the
 *            straight line. `LEGS=4,5` narrows it.
 *   finale   a save on leg 8 (Journey I, legs 1-7 landed): the title reads Leg 8 of 8 · The Promised Land;
 *            DIG plays leg 8 owing its 150 bonus on the double-width island (24 columns, trees drawn); a
 *            scripted landfall (`plantAtTaproot`) ends the run 'promised' and the wallet has risen by the
 *            run's whole payout BEFORE anything animates (the finale has not started; when it does it
 *            records the same wallet); p.mineJourney is {journey 2, leg 1, done [1]} with Journey I's leg
 *            records kept in `past`; ROOTED says the Promised Land and has one button; Continue plays the
 *            finale — the camera pulls back (zoom falls), eight island bursts 300 ms apart, the line, the
 *            credits — and closing the credits lands on the title with the 'Journey I' badge and 'Begin
 *            Journey II', whose DIG plays Journey II leg 1 on Journey I's leg-1 seed. A tap on the finale
 *            overlay skips to the credits (second boot).
 *   perf     a leg-8 state grown to >= 4,000 strands (legprobe's navigator toward the knot, the tank topped
 *            up), 390x844, headless: `renderFrame` median <= 20 ms and p95 <= 33 ms over 60 synchronous
 *            frames at the resting zoom; `mineFrame` (timed in advanceSim) median <= 2 ms over live frames;
 *            and the mine's own frame code walks the whole colony at most twice in any frame
 *            (`mine.passes()`, counted by `mineNodePass`).
 *
 * `LEGS_ONLY=rules,legs,finale,perf` runs a subset. Screens: tests/.artifacts/m9-*-390.png.
 */
const path = require('path'), fs = require('fs');
const H = require('./mine-harness.cjs');
const LP = require('./bots/legprobe.cjs');
const { sleep } = H;
let pass = 0, fail = 0;
const ok = (n, c, x) => { c ? (pass++, console.log('  PASS  ' + n + (x ? '  — ' + x : ''))) : (fail++, console.log('  FAIL  ' + n + (x ? '  — ' + x : ''))); };
const ART = path.join(H.ROOT, 'tests', '.artifacts');
fs.mkdirSync(ART, { recursive: true });
const ONLY = (process.env.LEGS_ONLY || '').split(',').filter(Boolean);
const want = (k) => !ONLY.length || ONLY.includes(k);
const shot = (page, name) => page.screenshot({ path: path.join(ART, name), animations: 'disabled', timeout: 8000 }).catch(() => {});
const save = (page) => page.evaluate(() => JSON.parse(localStorage.getItem('mycelium.progress.v2') || '{}'));
const waitLeg = (page, leg) => page.waitForFunction((leg) => { const g = window.__game, s = g && g.state;
  return !!(g && g.mine && g.mine.leg && g.mine.leg() && (!leg || g.mine.leg().leg === leg) && s.substrate._fineSolid && !s.runOver && s._mineFrameN > 2); },
  leg || 0, { timeout: 40000, polling: 100 });
const med = (a) => { const b = a.slice().sort((x, y) => x - y); return b.length ? b[Math.floor(b.length / 2)] : NaN; };
const pct = (a, q) => { const b = a.slice().sort((x, y) => x - y); return b.length ? b[Math.min(b.length - 1, Math.floor(q * b.length))] : NaN; };
// A save standing on leg 8 of Journey I: legs 1-7 landed, the store's intro shelf open.
const LEG8_SAVE = { runsDone: 30, mineRuns: 30, mineBest: 140, migratedMineShelfV2: true, minerals: 7,
  mineJourney: { journey: 1, leg: 8, legs: { 1: { runs: 2, landed: true, bestEast: 96 }, 2: { runs: 4, landed: true }, 3: { runs: 4, landed: true },
    4: { runs: 4, landed: true }, 5: { runs: 4, landed: true }, 6: { runs: 4, landed: true }, 7: { runs: 5, landed: true } } } };
const seeded = (obj) => ({ before: async (page) => page.addInitScript((o) => {
  if (!localStorage.getItem('mycelium.progress.v2')) localStorage.setItem('mycelium.progress.v2', JSON.stringify(o)); }, obj) });

(async () => {
  const E = await H.start();
  try {
    // ======================================================================================
    if (want('rules')) {
      console.log('— each leg\'s one rule, on the run\'s config');
      const b = await E.boot('#leg,1,7', 390, 844);
      await waitLeg(b.page, 7);
      const r = {};
      for (const leg of [7, 4, 8, 5, 1, 3, 6]) {
        if (leg !== 7) { await b.page.evaluate((l) => window.__game.mine.playLeg(1, l), leg); await waitLeg(b.page, leg); }
        r[leg] = await b.page.evaluate(() => { const g = window.__game, s = g.state, L = g.mine.leg();
          return { leg: L.leg, row: g.mine.legRow(L.leg), tb: s.config.mine.threatBands, rich: s.config.mine.richChance,
                   res: s.config.mine.reservoirsPerBand, safe: s.config.mine.heat.safeDepth, lines: g.mine.heatLines(),
                   islandCols: L.layout.islandC1 - L.layout.islandC0 + 1 }; });
      }
      const eq = (a, b2) => JSON.stringify(a) === JSON.stringify(b2);
      ok('leg 7: state.config.mine.threatBands equals the table row (worms x2 below 42 m)', eq(r[7].tb, r[7].row.threatBands) && r[7].tb[1].worms === 2 && r[7].tb[3].worms === 4,
         JSON.stringify(r[7].tb));
      ok('leg 4: mould from 42 m (band 1 carries a cloud); leg 8: +1 worm and +1 cloud per chunk below 84 m',
         eq(r[4].tb, r[4].row.threatBands) && r[4].tb[1].clouds === 1 && eq(r[8].tb, r[8].row.threatBands) && r[8].tb[2].worms === 2 && r[8].tb[2].clouds === 2 && r[8].tb[3].worms === 3,
         JSON.stringify({ 4: r[4].tb, 8: r[8].tb }));
      ok('leg 5: one deep seam in two is rich (richChance 0.5); leg 8\'s island is double width (24 columns)', r[5].rich === 0.5 && r[8].islandCols === 24 && r[7].islandCols === 12,
         JSON.stringify({ rich: r[5].rich, i8: r[8].islandCols, i7: r[7].islandCols }));
      ok('legs 1 and 3 keep their rules (calm: no creature; dry: no pocket above 42 m)', r[1].tb.every((t) => !t.worms && !t.clouds) && Array.isArray(r[3].res) && r[3].res[0] === 0 && r[3].res[1] > 0,
         JSON.stringify({ 1: r[1].tb, 3: r[3].res }));
      ok('leg 6: safeDepth 36 and mineHeatLines [36, 78, 120] (bare [42, 84, 126] elsewhere)', r[6].safe === 36 && eq(r[6].lines, [36, 78, 120]) && eq(r[5].lines, [42, 84, 126]),
         JSON.stringify({ 6: r[6].lines, 5: r[5].lines }));
      // ...shifted by tolerance, and the beat.
      const t6 = await b.page.evaluate(async () => {
        const g = window.__game, s = g.state, net = s.active, sub = s.substrate, cs = sub.cellSize;
        const shifted = (() => { const was = s.config.mine.heatBonus; s.config.mine.heatBonus = 14; const L = g.mine.heatLines(); s.config.mine.heatBonus = was; return L; })();
        s.nematodes.length = 0; s.clouds.length = 0;
        // Move one strand down to 38 m, then 44 m; a world tick rebuilds the colony summary each time.
        const n = net.nodes[net.nodes.length - 1];
        const beats0 = g.mine.beats().length;
        n.y = sub.surfaceY + 38.5 * cs;
        await new Promise((r) => setTimeout(r, 1500));
        const cost38 = g.mine.cost(38);
        n.y = sub.surfaceY + 44.5 * cs;
        await new Promise((r) => setTimeout(r, 1500));
        return { shifted, cost38, beats: g.mine.beats().slice(beats0), depth: g.mine.depth(), band1: s.config.mine.bands[1].name };
      });
      const small = t6.beats.find((x) => x.d === '36 m'), band = t6.beats.find((x) => x.d === '42 m');
      ok('leg 6: one tolerance step shifts the lines to [50, 92, 134]', eq(t6.shifted, [50, 92, 134]), JSON.stringify(t6.shifted));
      ok("leg 6: past 36 m the small beat says 'Digs now cost 4', and past 42 m the band beat names the band with 'Digs still cost 4'",
         !!small && small.c === 'Digs now cost 4' && !!band && band.n === t6.band1 && band.c === 'Digs still cost 4' && t6.cost38 === 4,
         JSON.stringify({ beats: t6.beats.map((x) => [x.d, x.n, x.c]), depth: t6.depth, cost38: t6.cost38 }));
      const z = await b.page.evaluate(() => { const g = window.__game, s = g.state; const z0 = g.mine.zoomRest(), was = s.config.mine.zoom;
        s.config.mine.zoom = was * 1.5; const z1 = g.mine.zoomRest(); s.config.mine.zoom = was; return { z0, z1 }; });
      ok('the resting zoom reads the run\'s config (x1.5 on state.config.mine.zoom -> x1.5 at rest)', Math.abs(z.z1 / z.z0 - 1.5) < 0.01, JSON.stringify(z));
      ok('no page errors (rules)', !b.errs.length, b.errs.slice(0, 2).join(' | '));
      await b.ctx.close();
    }
    // ======================================================================================
    if (want('legs')) {
      const legs = (process.env.LEGS || '1,2,3,4,5,6,7,8').split(',').map(Number);
      console.log('— legs ' + legs.join(', ') + ': reachable, taproot where the table says, path ratio 1.3-2.0');
      const res = [];
      for (const leg of legs) {
        const b = await LP.openLeg(E, leg, 0);
        const m = await LP.measure(b.page);
        const row = await b.page.evaluate((l) => window.__game.mine.legRow(l), leg);
        const t = m.tapRec || {};
        const inCell = Math.abs((t.col | 0) - (m.homeCol + row.eastM)) <= 1 && Math.abs((t.row | 0) - row.depthM) <= 1;
        const good = m.reach && m.reachLat && inCell && m.ratio >= 1.3 && m.ratio <= 2.0;
        res.push({ leg, seed: m.seed, good, reach: m.reach, lat: m.reachLat, tap: [t.col, t.row], want: [m.homeCol + row.eastM, row.depthM], ratio: m.ratio, e42: m.east42, e84: m.east84, water: m.water });
        ok(`leg ${leg} (seed ${m.seed}): the taproot is flood-reachable, within 1 cell of the table, path ratio ${m.ratio} in 1.3-2.0`, good,
           JSON.stringify(res[res.length - 1]));
        if (b.errs.length) ok(`no page errors (leg ${leg})`, false, b.errs.slice(0, 2).join(' | '));
        await b.ctx.close();
      }
      if (legs.length === 8) ok('legs 1-8: 8 of 8 reachable with the taproot in place and the ratio in band', res.every((x) => x.good), res.filter((x) => x.good).length + ' / 8');
    }
    // ======================================================================================
    if (want('finale')) {
      console.log('— the Promised Land');
      const b = await E.boot('', 390, 844, seeded(LEG8_SAVE));
      await b.page.waitForSelector('#tsNewMine', { timeout: 20000 }).catch(() => {});
      await sleep(2600);
      const t0 = await b.page.evaluate(() => ({ cap: (document.getElementById('tsJourneyCap') || {}).textContent,
        badge: !!document.getElementById('tsJourneyBadge') }));
      ok("the title reads 'Continue · Leg 8 of 8 · The Promised Land' with no badge yet", t0.cap === 'Continue · Leg 8 of 8 · The Promised Land' && !t0.badge, JSON.stringify(t0));
      await b.page.click('#tsNewMine');
      await waitLeg(b.page, 8);
      await sleep(900);
      const L0 = await b.page.evaluate(() => { const g = window.__game, s = g.state, L = g.mine.leg();
        return { leg: L.leg, journey: L.journey, bonus: s.config.mine.islandBonus, cols: L.layout.islandC1 - L.layout.islandC0 + 1, wallet: g.store.balance() }; });
      // Frame the island, to see the trees (camera released by the look).
      await b.page.evaluate(() => { const g = window.__game, L = g.mine.leg(), cs = g.state.substrate.cellSize;
        g.mine.lookAt(((L.layout.islandC0 + L.layout.islandC1 + 1) / 2) * cs, g.state.substrate.surfaceY + cs * 3); });
      await sleep(700);
      await shot(b.page, 'm9-promised-island-390.png');
      ok('the double-width island draws its trees (the Promised Land)', await b.page.evaluate(() => window.__game.mine.islandTrees() >= 2),
         String(await b.page.evaluate(() => window.__game.mine.islandTrees())));
      // THE SCRIPTED LANDFALL. The wallet is read on the frame the run ends, before the end screen.
      const land = await b.page.evaluate(async () => {
        const g = window.__game, s = g.state;
        // One real dig first: a descent that never dug is not recorded on its leg (M5), and no landfall
        // can be made without digging.
        s.active.water = 999; const d = g.mine.grow(0, 1);
        await new Promise((r) => setTimeout(r, 200));
        g.mine.plantAtTaproot();
        for (let k = 0; k < 60 && !s.runOver; k++) await new Promise((r) => setTimeout(r, 25));
        const r = s.runResult || {};
        return { over: !!s.runOver, cause: r.cause, ore: r.ore, bonus: r.bonus, paid: !!r._minePaid, wallet: g.store.balance(),
                 finale: g.mine.finale(), save: g.mine.journeySave() };
      });
      ok("a leg-8 landfall ends the run 'promised', paying the 150 bonus", land.over && land.cause === 'promised' && land.bonus === 150 && L0.bonus === 150 && L0.cols === 24,
         JSON.stringify({ L0, cause: land.cause, bonus: land.bonus }));
      ok('the wallet rises by the whole payout before the finale animates (banked on the landfall frame)', land.paid && land.wallet - L0.wallet === land.ore && !land.finale,
         `wallet ${L0.wallet} -> ${land.wallet} (ore ${land.ore}), finale ${JSON.stringify(land.finale)}`);
      ok('p.mineJourney becomes {journey: 2, leg: 1, done: [1]}, Journey I\'s leg records kept', land.save && land.save.journey === 2 && land.save.leg === 1
         && JSON.stringify(land.save.done) === '[1]' && land.save.past && land.save.past[1] && land.save.past[1].legs[8] && land.save.past[1].legs[8].landed,
         JSON.stringify(land.save && { journey: land.save.journey, leg: land.save.leg, done: land.save.done, past8: land.save.past && land.save.past[1] && land.save.past[1].legs[8] }));
      await b.page.waitForSelector('#ssMineEnd', { timeout: 30000 }).catch(() => {});
      await sleep(1400);
      const end = await b.page.evaluate(() => ({ word: (document.querySelector('#ssMineEnd .ss-win-title') || {}).getAttribute && document.querySelector('#ssMineEnd .ss-win-title').getAttribute('aria-label'),
        why: (document.querySelector('#ssMineEnd .ss-mineend-why') || {}).textContent, btns: Array.from(document.querySelectorAll('#ssMineEnd button')).map((x) => x.id),
        bonus: Array.from(document.querySelectorAll('#ssMineEnd .ss-me-row')).map((r) => r.textContent).find((x) => /Island bonus/.test(x)) || '' }));
      await shot(b.page, 'm9-promised-rooted-390.png');
      ok('ROOTED says the Promised Land, carries the island bonus row, and has one button (Continue)', end.word === 'Rooted' && end.why === 'Your colony took root on the Promised Land.'
         && JSON.stringify(end.btns) === '["ssMineFinale"]' && /150/.test(end.bonus), JSON.stringify(end));
      await b.page.click('#ssMineFinale').catch(() => {});
      // Sample the finale.
      const shotP = b.page.waitForFunction(() => { const f = window.__game.mine.finale(); return f && f.bursts >= 6; }, { timeout: 9000, polling: 40 })
        .then(() => shot(b.page, 'm9-promised-strip-390.png')).catch(() => {});
      const tl = await b.page.evaluate(async () => {
        const g = window.__game, out = [], t0 = performance.now();
        while (performance.now() - t0 < 9000) {
          const f = g.mine.finale();
          out.push({ t: Math.round(performance.now() - t0), ph: f && f.phase, b: f && f.bursts, z: f && f.zoomNow, cr: f && f.creditsOpen });
          if (f && f.creditsOpen) break;
          await new Promise((r) => setTimeout(r, 60));
        }
        return { out, f: g.mine.finale(), sfx: (window.__sfx && window.__sfx.counts.finale) | 0 };
      });
      await shotP;
      const f = tl.f || {};
      const zs = tl.out.filter((x) => x.ph === 'pull' && x.z).map((x) => x.z);
      const gaps = (f.burstAt || []).slice(1).map((v, i) => v - f.burstAt[i]);
      ok('the camera pulls back first (zoom falls during the pull)', zs.length >= 3 && zs[zs.length - 1] < zs[0] * 0.9 && f.z1 < f.z0, `zoom ${zs[0]} -> ${zs[zs.length - 1]} (target ${f.z1})`);
      // Timers only fire late, never early, and each burst is scheduled at i x 300 ms from the first: the
      // mean gap is the schedule, a single gap carries two timers' lateness.
      const meanGap = gaps.length ? (f.burstAt[7] - f.burstAt[0]) / 7 : 0;
      ok('then the journey strip fruits island by island: 8 bursts, 300 ms apart', f.bursts === 8 && gaps.length === 7 && meanGap >= 285 && meanGap <= 340 && gaps.every((d) => d >= 180 && d <= 450),
         JSON.stringify({ bursts: f.bursts, gaps, meanGap: +meanGap.toFixed(1) }));
      ok("then the line 'The Promised Land. Your colony spans the world.', then the credits", f.text && f.creditsOpen && !f.skipped
         && await b.page.evaluate(() => /The Promised Land\. ?Your colony spans the world\./.test((document.querySelector('#mineFinale .mf-line') || {}).textContent || '')),
         JSON.stringify({ text: f.text, credits: f.creditsOpen, skipped: f.skipped }));
      ok('the finale started with the wallet already paid', f.wallet === land.wallet && f.bankedBefore === true, JSON.stringify({ at: f.wallet, landed: land.wallet, banked: f.bankedBefore }));
      await shot(b.page, 'm9-promised-credits-390.png');
      await b.page.click('#crClose').catch(() => {});
      await b.page.waitForSelector('#tsNewMine', { timeout: 20000 }).catch(() => {});
      await sleep(2600);
      const t1 = await b.page.evaluate(() => ({ cap: (document.getElementById('tsJourneyCap') || {}).textContent,
        badge: ((document.getElementById('tsJourneyBadge') || {}).textContent || ''), lit: document.querySelectorAll('#titleScreen .mj-dot.lit').length }));
      await shot(b.page, 'm9-journey2-title-390.png');
      ok("the title shows the 'Journey I' badge and 'Begin Journey II' (a fresh strip)", t1.badge === 'Journey I' && t1.cap === 'Begin Journey II' && t1.lit === 0, JSON.stringify(t1));
      await b.page.click('#tsNewMine');
      await waitLeg(b.page, 1);
      await sleep(600);
      const j2 = await b.page.evaluate(() => { const g = window.__game, L = g.mine.leg(); return { journey: L.journey, leg: L.leg, seed: L.seed, want: g.mine.legRow(1).seed, bonus: g.state.config.mine.islandBonus }; });
      ok("'Begin Journey II' plays Journey II leg 1 on Journey I's seed, its island bonus owed again", j2.journey === 2 && j2.leg === 1 && j2.seed === j2.want && j2.bonus === 20, JSON.stringify(j2));
      ok('no page errors (finale)', !b.errs.length, b.errs.slice(0, 2).join(' | '));
      await b.ctx.close();
      // THE SKIP: a tap on the finale overlay goes straight to the credits.
      const b2 = await E.boot('#leg,1,8', 390, 844, seeded(LEG8_SAVE));
      await waitLeg(b2.page, 8);
      await b2.page.evaluate(async () => { const g = window.__game; g.state.active.water = 999; g.mine.grow(0, 1);
        await new Promise((r) => setTimeout(r, 200)); g.mine.plantAtTaproot(); });
      await b2.page.waitForSelector('#ssMineFinale', { timeout: 30000 }).catch(() => {});
      await sleep(500);
      await b2.page.click('#ssMineFinale').catch(() => {});
      await b2.page.waitForSelector('#mineFinale', { timeout: 6000 }).catch(() => {});
      await sleep(250);
      await b2.page.click('#mineFinale', { position: { x: 30, y: 100 } }).catch(() => {});
      await sleep(400);
      const sk = await b2.page.evaluate(() => window.__game.mine.finale());
      ok('a tap on the finale skips to the credits', !!sk && sk.credits && sk.skipped && sk.creditsOpen && sk.bursts < 8, JSON.stringify(sk && { b: sk.bursts, credits: sk.credits, skipped: sk.skipped }));
      ok('no page errors (skip)', !b2.errs.length, b2.errs.slice(0, 2).join(' | '));
      await b2.ctx.close();
    }
    // ======================================================================================
    if (want('perf')) {
      console.log('— a leg-8 state at 4,000 strands, 390x844');
      const b = await LP.openLeg(E, 8, 0);
      await LP.measure(b.page);
      // Toward the knot, stopping short of it (a landfall would end the run), then filled out to 4,000
      // strands by digs from strands spread over the colony, away from the knot.
      const nav = await LP.navigate(b.page, { maxDigs: 400, stopWithin: 900 });
      nav.fill = await b.page.evaluate(async () => {
        const g = window.__game, s = g.state, net = s.active, t = g.mine.taproot();
        let digs = 0, k = 0;
        while (net.nodes.length < 4200 && k < 900 && !s.runOver) {
          k++;
          const live = net.nodes.filter((n) => !n.infected && Math.hypot(n.x - t.x, n.y - t.y) > 700);
          const src = live[(k * 7919) % live.length];
          const a = (k * 2.39996) % (Math.PI * 2);
          net.water = 9999;
          const r = g.mine.growFrom(src.x, src.y, src.x + Math.cos(a) * 200, src.y + Math.sin(a) * 200);
          if (r && r.ok) digs++;
          if (k % 10 === 0) await new Promise((q) => setTimeout(q, 0));
        }
        return { digs, tries: k, nodes: net.nodes.length, over: s.runOver };
      });
      await b.page.evaluate(() => { const g = window.__game; g.state.active.water = 9999; g.mine.passesReset(); });
      await sleep(3000);          // live frames, the camera following the colony
      const live = await b.page.evaluate(() => ({ passes: window.__game.mine.passes(), mf: window.__game.mine.frameMs(), nodes: window.__game.state.active.nodes.length }));
      const rf = await b.page.evaluate(() => {
        const g = window.__game, out = []; let t = performance.now();
        for (let i = 0; i < 64; i++) { t += 16.7; const a = performance.now(); g.renderFrame(t, 1); out.push(performance.now() - a); }
        return out.slice(4);
      });
      await shot(b.page, 'm9-perf-4000-390.png');
      const mfs = live.mf.map((x) => x[0]), mfNoTick = live.mf.filter((x) => !x[1]).map((x) => x[0]);
      ok(`the state holds >= 4,000 strands (${live.nodes})`, live.nodes >= 4000, JSON.stringify({ digs: nav.digs, landed: nav.landed }));
      ok('renderFrame median <= 20 ms and p95 <= 33 ms', med(rf) <= 20 && pct(rf, 0.95) <= 33, `median ${med(rf).toFixed(2)} ms, p95 ${pct(rf, 0.95).toFixed(2)} ms over ${rf.length} frames`);
      ok('mineFrame <= 2 ms (median over live frames; p95 printed)', mfs.length >= 20 && med(mfs) <= 2,
         `median ${med(mfs).toFixed(3)} ms, p95 ${pct(mfs, 0.95).toFixed(3)}, max ${Math.max(...mfs).toFixed(3)} over ${mfs.length} frames (no-tick median ${med(mfNoTick).toFixed(3)})`);
      ok('at most 2 whole-colony passes in any frame (mine.passes)', live.passes && live.passes.frames >= 20 && live.passes.max <= 2,
         JSON.stringify(live.passes));
      ok('no page errors (perf)', !b.errs.length, b.errs.slice(0, 2).join(' | '));
      await b.ctx.close();
    }
  } catch (e) { fail++; console.log('  FAIL  harness error: ' + (e && e.stack || e)); }
  await E.close();
  console.log(`\n==== ${pass} passed, ${fail} failed ====`);
  process.exit(fail ? 1 : 0);
})();
