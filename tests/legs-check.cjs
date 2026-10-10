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
 *            credits; when the line is up the knot and the colony dug around it are on screen above the
 *            strip — and closing the credits lands on the title with the 'Journey I' badge and 'Begin
 *            Journey II', whose DIG plays Journey II leg 1 on Journey I's leg-1 seed. A tap on the finale
 *            overlay skips to the credits (second boot).
 *   perf     a leg-8 state grown to >= 4,000 strands (legprobe `perfState`: the navigator toward the knot, the
 *            tank topped up, its worms and clouds PUT BACK and a 20-strand rotten patch with the clock running),
 *            390x844, headless, at dsf 1 AND dsf 2 (a phone's backing store): `renderFrame` median <= 20 ms
 *            and p95 <= 33 ms over 60 synchronous frames at the resting zoom (pans printed); a zoom that moves
 *            every frame builds no memo buffer and costs no more than drawing live (3 interleaved on/off
 *            pairs); the three memos draw the live frame, and a seam emptied under a standing leaf buffer
 *            leaves it; `mineFrame` (timed in advanceSim) median AND p95 <= 2 ms once settled; the mine's own
 *            frame code walks the colony at most twice a frame (`mine.passes()`); and counting EVERY read of
 *            the strand array (legprobe `censusInstall`, removed again before the timings), a frame with no
 *            world tick walks it at most twice — settled AND while digging every 350 ms — and a world-tick
 *            frame at most 18 times (not once per creature).
 *
 *   stale    (M9 verify) two tabs on Journey I leg 8: the second landfall, after the first rolled the save to
 *            Journey II, pays no second bonus and leaves Journey II untouched (its record goes to `past`).
 *   store6   (M9 verify) the store on a leg-6 save quotes leg 6's price lines (36 m), not the literal's 42.
 *
 * `LEGS_ONLY=rules,legs,finale,stale,store6,perf` runs a subset. Screens: tests/.artifacts/m9-*-390.png.
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
        const good = m.reach && m.reachLat && inCell && m.ratio >= (leg === 1 ? 1.0 : 1.3) && m.ratio <= 2.0;   // M14: leg 1 (the tutorial leg) 1.0
        res.push({ leg, seed: m.seed, good, reach: m.reach, lat: m.reachLat, tap: [t.col, t.row], want: [m.homeCol + row.eastM, row.depthM], ratio: m.ratio, e42: m.east42, e84: m.east84, water: m.water });
        ok(`leg ${leg} (seed ${m.seed}): the taproot is flood-reachable, within 1 cell of the table, path ratio ${m.ratio} in ${leg === 1 ? '1.0' : '1.3'}-2.0`, good,
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
        // A COLONY AT THE KNOT (M9 verify 3), so the finale's frame has something to hold: the deepest strand is
        // carried into the taproot chamber 2.2 cells west of the knot (outside the 1.5-cell landfall) and digs
        // there, away from the knot, before the landing strand is planted.
        const sub = s.substrate, cs = sub.cellSize, k = g.mine.taproot();
        let deep = null; for (const n of s.active.nodes) if (!n.infected && (!deep || n.y > deep.y)) deep = n;
        deep.x = k.x - 2.2 * cs; deep.y = k.y; g.mine.aggInvalidate();
        let near = 0;
        for (const a of [Math.PI, Math.PI * 0.8, Math.PI * 1.2, Math.PI * 0.6, Math.PI * 1.4]) {
          s.active.water = 999;
          const r = g.mine.growFrom(deep.x, deep.y, deep.x + Math.cos(a) * 150, deep.y + Math.sin(a) * 150);
          if (r && r.ok) near++;
          await new Promise((q) => setTimeout(q, 120));
        }
        window.__nearDigs = near;
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
      // THE STRIP UNDER ROOTED IS THE JOURNEY JUST FINISHED (M9 verify): the bank has already rolled the save
      // to Journey II, and the live strip was eight dark dots with leg 1 ringed.
      const strip = await b.page.evaluate(() => { const el = document.querySelector('#ssMineEnd .mj-strip');
        return el ? { lit: el.querySelectorAll('.mj-dot.lit').length, cur: el.querySelectorAll('.mj-dot.cur').length, aria: el.getAttribute('aria-label') } : null; });
      ok("ROOTED's journey strip is Journey I finished: 8 of 8 lit, none ringed next", !!strip && strip.lit === 8 && strip.cur === 0 && /8 of 8 islands rooted, journey complete/.test(strip.aria),
         JSON.stringify(strip));
      ok('ROOTED says the Promised Land, carries the island bonus row, and has one button (Continue)', end.word === 'Rooted' && end.why === 'Your colony took root on the Promised Land.'
         && JSON.stringify(end.btns) === '["ssMineFinale"]' && /150/.test(end.bonus), JSON.stringify(end));
      await b.page.click('#ssMineFinale').catch(() => {});
      // Sample the finale.
      const shotP = b.page.waitForFunction(() => { const f = window.__game.mine.finale(); return f && f.bursts >= 6; }, { timeout: 9000, polling: 40 })
        .then(() => shot(b.page, 'm9-promised-strip-390.png'))
        .then(() => b.page.waitForFunction(() => { const f = window.__game.mine.finale(); return f && f.text; }, { timeout: 9000, polling: 40 }))
        .then(() => shot(b.page, 'm9-promised-line-390.png')).catch(() => {});
      const tl = await b.page.evaluate(async () => {
        const g = window.__game, out = [], t0 = performance.now(); let lineView = null;
        while (performance.now() - t0 < 9000) {
          const f = g.mine.finale();
          out.push({ t: Math.round(performance.now() - t0), ph: f && f.phase, b: f && f.bursts, z: f && f.zoomNow, cr: f && f.creditsOpen });
          if (f && f.text && !lineView) lineView = f.view;
          if (f && f.creditsOpen) break;
          await new Promise((r) => setTimeout(r, 60));
        }
        return { out, f: g.mine.finale(), sfx: (window.__sfx && window.__sfx.counts.finale) | 0, lineView, nearDigs: window.__nearDigs };
      });
      await shotP;
      const f = tl.f || {};
      const zs = tl.out.filter((x) => x.ph === 'pull' && x.z).map((x) => x.z);
      const gaps = (f.burstAt || []).slice(1).map((v, i) => v - f.burstAt[i]);
      ok('the camera pulls back first (zoom falls during the pull)', zs.length >= 3 && zs[zs.length - 1] < zs[0] * 0.9 && f.z1 < f.z0, `zoom ${zs[0]} -> ${zs[zs.length - 1]} (target ${f.z1})`);
      // THE PULL-BACK FRAMES THE COLONY (M9 verify 3): the first version framed the island's hill, 140 m above
      // the knot, and the line 'Your colony spans the world' stood over bare rock with no strand on screen.
      // When the line is up: the knot is on screen in the view's upper 55% (above the strip), with the strands
      // grown around it there too.
      const lineView = tl.lineView || {};
      ok('when the line appears, the knot and the colony around it are on screen above the strip', !!lineView.knotX && lineView.knotX >= 0 && lineView.knotX <= lineView.vw
         && lineView.knotY >= 0 && lineView.knotY <= lineView.vh * 0.55 && lineView.strandsUp >= 10,
         JSON.stringify({ frame: f.frame, lineView, nearDigs: tl.nearDigs }));
      // Timers only fire late, never early, and each burst is scheduled at i x 300 ms from the first: the
      // mean gap is the schedule, a single gap carries two timers' lateness.
      const meanGap = gaps.length ? (f.burstAt[7] - f.burstAt[0]) / 7 : 0;
      ok('then the journey strip fruits island by island: 8 bursts, 300 ms apart', f.bursts === 8 && gaps.length === 7 && meanGap >= 285 && meanGap <= 340 && gaps.every((d) => d >= 180 && d <= 450),
         JSON.stringify({ bursts: f.bursts, gaps, meanGap: +meanGap.toFixed(1) }));
      ok("then the line 'The Promised Land. Your colony spans the world.', then the credits", f.text && f.creditsOpen && !f.skipped
         && await b.page.evaluate(() => /The Promised Land\. ?Your colony spans the world\./.test((document.querySelector('#mineFinale .mf-line') || {}).textContent || '')),
         JSON.stringify({ text: f.text, credits: f.creditsOpen, skipped: f.skipped }));
      ok('the finale started with the wallet already paid', f.wallet === land.wallet && f.bankedBefore === true, JSON.stringify({ at: f.wallet, landed: land.wallet, banked: f.bankedBefore }));
      const dn0 = await b.page.evaluate(() => window.__game.mine.finale().drawN);
      await sleep(900);
      const dn1 = await b.page.evaluate(() => window.__game.mine.finale().drawN);
      ok('the strip stops drawing under the credits (no frames drawn over 900 ms of credits)', dn1 === dn0 && dn0 > 0, `drawN ${dn0} -> ${dn1}`);
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
    if (want('stale')) {
      // TWO TABS ON JOURNEY I LEG 8 (M9 verify). Tab A lands the Promised Land and the save rolls to Journey
      // II; tab B, still on Journey I, lands after it. Before the fix B's result was applied to the CURRENT
      // journey: Journey II's leg 8 marked landed, Journey II moved to leg 8, and the 150 bonus paid again
      // (the bank's re-check read Journey II's empty leg 8).
      console.log('— a stale Journey I tab landing after the Promised Land');
      const ctx = await E.browser.newContext({ viewport: { width: 390, height: 844 } });
      const init = { before: async (page) => page.addInitScript((o) => {
        if (!localStorage.getItem('mycelium.progress.v2')) localStorage.setItem('mycelium.progress.v2', JSON.stringify(o)); }, LEG8_SAVE), ctx };
      const a = await E.boot('#leg,1,8', 390, 844, init);
      await waitLeg(a.page, 8);
      const bb = await E.boot('#leg,1,8', 390, 844, init);
      await waitLeg(bb.page, 8);
      const land = (page) => page.evaluate(async () => {
        const g = window.__game, s = g.state;
        s.active.water = 999; g.mine.grow(0, 1);
        await new Promise((r) => setTimeout(r, 200));
        const w0 = g.store.balance(), bonusCfg = s.config.mine.islandBonus;
        g.mine.plantAtTaproot();
        for (let k = 0; k < 80 && !s.runOver; k++) await new Promise((r) => setTimeout(r, 25));
        await new Promise((r) => setTimeout(r, 300));
        const r = s.runResult || {};
        return { cause: r.cause, ore: r.ore, bonus: r.bonus, reach: r.reach, seams: r.seams, w0, w1: g.store.balance(), bonusCfg };
      });
      const A = await land(a.page);
      const sA = await save(a.page);
      const B = await land(bb.page);
      const sB = await save(bb.page);
      const mj = sB.mineJourney || {};
      ok("tab A's landfall finishes Journey I (save {journey 2, leg 1}), paying the 150 bonus", A.cause === 'promised' && A.bonus === 150
         && sA.mineJourney.journey === 2 && sA.mineJourney.leg === 1, JSON.stringify({ A, j: sA.mineJourney && { journey: sA.mineJourney.journey, leg: sA.mineJourney.leg } }));
      ok("tab B (still Journey I) lands later: no second bonus — its wallet rises by reach + seams only", B.cause === 'promised' && B.bonusCfg === 150 && B.bonus === 0
         && B.w1 - B.w0 === (B.reach | 0) + (B.seams | 0), JSON.stringify(B));
      ok("...and Journey II is untouched: leg 1, no leg records, Journey I once in `done`, its leg 8 landed in `past` (runs 2)",
         mj.journey === 2 && mj.leg === 1 && Object.keys(mj.legs || {}).length === 0 && JSON.stringify(mj.done) === '[1]'
         && mj.past && mj.past[1] && mj.past[1].legs[8] && mj.past[1].legs[8].landed && mj.past[1].legs[8].runs === 2,
         JSON.stringify({ journey: mj.journey, leg: mj.leg, legs: mj.legs, done: mj.done, past8: mj.past && mj.past[1] && mj.past[1].legs[8] }));
      // ...AND TAB B'S SCREEN SAYS SO (M9 verify 2): it replayed the whole finale over Journey II's empty strip
      // (the bank had been fixed and the screen had not). Now the ordinary end screen: Descend / Store, no
      // finale, a line naming the journey the next descent plays, and the finished journey's strip.
      await bb.page.waitForSelector('#ssMineEnd', { timeout: 30000 }).catch(() => {});
      await sleep(400);
      const scr = await bb.page.evaluate(() => { const r = document.getElementById('ssMineEnd'); if (!r) return null;
        const st = r.querySelector('.mj-strip');
        return { btns: Array.from(r.querySelectorAll('button')).map((x) => x.id).filter(Boolean), why: (r.querySelector('.ss-mineend-why') || {}).textContent,
                 stale: (r.querySelector('#ssMineStale') || {}).textContent || '', lit: st ? st.querySelectorAll('.mj-dot.lit').length : -1,
                 cur: st ? st.querySelectorAll('.mj-dot.cur').length : -1, bonus: /Island bonus/.test(r.textContent), finale: !!document.getElementById('mineFinale') }; });
      await shot(bb.page, 'm9-stale-rooted-390.png');
      ok("tab B's end screen: no finale, Descend + Store, 'Journey I was already finished in another tab — the next descent is Journey II, Leg 1', Journey I's strip (8 lit)",
         !!scr && !scr.btns.includes('ssMineFinale') && scr.btns.includes('ssMineDescend') && scr.btns.includes('ssMineDone') && !scr.bonus
         && /^Journey I was already finished in another tab — the next descent is Journey II, Leg 1\b/.test(scr.stale)
         && scr.lit === 8 && scr.cur === 0 && !/starts there/.test(scr.why || ''), JSON.stringify(scr));
      await sleep(6800);
      ok("...and nothing starts the finale on its own (6.8 s later: no #mineFinale, still the end screen)",
         await bb.page.evaluate(() => !document.getElementById('mineFinale') && !!document.getElementById('ssMineEnd')));
      ok('no page errors (stale)', !a.errs.length && !bb.errs.length, a.errs.concat(bb.errs).slice(0, 2).join(' | '));
      await ctx.close();
    }
    // ======================================================================================
    if (want('store6')) {
      // THE STORE QUOTES THE NEXT DESCENT'S HEAT (M9 verify): between runs a save on leg 6 digs from 36 m at
      // the base price, and the store's note and Heat tolerance tile said 42 m (the CONFIG literal).
      console.log('— the store on a leg-6 save quotes leg 6\'s price lines');
      const legs = {}; for (let l = 1; l <= 5; l++) legs[l] = { runs: 3, landed: true };
      const b = await E.boot('#leg,1,6', 390, 844, seeded(Object.assign({}, LEG8_SAVE, { mineJourney: { journey: 1, leg: 6, legs } })));
      await waitLeg(b.page, 6);
      const r = await b.page.evaluate(async () => {
        const g = window.__game;
        g.store.revealAll();
        const w6 = g.store.heatWords();
        const p = JSON.parse(localStorage.getItem('mycelium.progress.v2'));
        const run = g.mine.heatLines();
        p.mineJourney.leg = 5; localStorage.setItem('mycelium.progress.v2', JSON.stringify(p));
        const w5 = g.store.heatWords();
        p.mineJourney.leg = 6; localStorage.setItem('mycelium.progress.v2', JSON.stringify(p));
        g.showPicker();
        await new Promise((q) => setTimeout(q, 900));
        const tile = Array.from(document.querySelectorAll('.ss-upg-now')).map((e) => e.textContent).find((t) => /^line /.test(t)) || null;
        const note = (document.querySelector('#ssMineNote, .ss-mine-note') || {}).textContent || '';
        return { w6, w5, run, tile, note };
      });
      await shot(b.page, 'm9-store-leg6-390.png');
      ok("on a leg-6 save the store's note, heat words and tile say 36 m (the run's lines), on leg 5 42 m",
         /past 36 \/ 78 \/ 120 m$/.test(r.w6) && JSON.stringify(r.run) === '[36,78,120]' && /past 42 \/ 84 \/ 126 m$/.test(r.w5) && r.tile === 'line 36 m' && /past 36 \/ 78 \/ 120 m/.test(r.note),
         JSON.stringify(r));
      ok('no page errors (store6)', !b.errs.length, b.errs.slice(0, 2).join(' | '));
      await b.ctx.close();
    }
    // ======================================================================================
    if (want('perf')) {
      // TWICE (M9 verify 3): at dsf 1, and at dsf 2 — a phone's backing store (renderScale caps the DPR at 2:
      // 780x1688 for this viewport), where the frame has a fraction of the dsf-1 headroom and a regression
      // there was invisible to the dsf-1-only gate. The pass census and the mineFrame gates are run once
      // (at dsf 1: they count walks and time the sim, neither depends on the backing store).
      for (const dsf of [1, 2]) await perfBlock(dsf);
    }
    async function perfBlock(dsf) {
      const D = dsf === 1 ? '' : ` [dsf ${dsf}]`;
      console.log(`— a leg-8 state at 4,000 strands, 390x844 dsf ${dsf}, its worms and clouds put back and a rotten patch`);
      const b = await LP.openLeg(E, 8, 0, 390, 844, undefined, { dsf });
      await LP.measure(b.page);
      // THE STATE (legprobe `perfState`): the navigator toward the knot, stopping short of it, then digs from
      // strands spread over the colony to 4,200. M9 verify 2: the navigator removes every creature, so the
      // first version of this block measured a leg 8 with 0 worms and 0 clouds — `threats` puts them back
      // (a real leg 8 carries dozens), and `rot` infects a 20-strand patch far west (the rot clock running,
      // the off-screen rot chevron: the busy late-game state), its deadline pushed out past the block.
      const st = await LP.perfState(b.page, { want: 4200, threats: true, rot: 20 });
      const nav = st.nav;
      await b.page.evaluate(() => { const g = window.__game; g.state.active.water = 9999; });
      await sleep(3000);          // the fill's reveal lands, the camera settles
      let live = null, cen = null;
      if (dsf === 1) {
        await b.page.evaluate(() => { const g = window.__game; g.state.active.water = 9999; g.mine.passesReset(); g.state._mineFrameMs = []; });
        await sleep(3000);          // SETTLED live frames, the camera following the colony
        live = await b.page.evaluate(() => ({ passes: window.__game.mine.passes(), mf: window.__game.mine.frameMs(), nodes: window.__game.state.active.nodes.length,
          worms: window.__game.state.nematodes.length, clouds: window.__game.state.clouds.length, rot: window.__game.state.active.nodes.filter((n) => n.infected).length,
          clock: !!window.__game.state.mineInfect }));
        // EVERY WHOLE-COLONY WALK, NOT ONLY THE DECLARED ONES (M9 verify 2): `mine.passes()` counts the walks the
        // mine's frame code declares; the census (legprobe `censusInstall`) wraps `net.nodes` in a Proxy and counts
        // every indexed read by anyone — renderer, world tick, for-of and index loops alike — as equivalent passes
        // (reads / length) per frame. A frame with no world tick must walk the colony at most twice; a world-tick
        // frame (2 Hz) is the shared engine's step and is printed, with a regression bound that fails if a walk
        // per CREATURE comes back (the contact pass walked the colony once per cloud: 90 on this state).
        // AND WHILE DIGGING (M9 verify 3): the census used to run on a SETTLED colony only, so it never saw the
        // frame after a dig — the renderer's structure rebuild, the summary's fold and whatever the dig threw
        // away — which a verifier measured at 4-6 walks. `digEvery` digs every 350 ms through the census window.
        await LP.censusInstall(b.page);
        const settled = await LP.censusRead(b.page, 3000);
        const digging = await LP.censusRead(b.page, 6000, { digEvery: 350 });
        await LP.censusRemove(b.page);   // the Proxy comes off before anything below is timed (M9 verify 3)
        cen = { settled, digging };
      }
      // A SYNCHRONOUS renderFrame ONLY RECORDS: the raster is deferred until the canvas flushes, which in
      // a loop of synchronous frames lands on every ~15th (400-590 ms there, the rest ~5 ms). Each frame
      // is therefore closed with a 1-pixel readback, which forces its raster inside the timing.
      //   mode 'rest'  the camera still;   'pan'  3 px a frame back and forth;   'fast'  12 px a frame;
      //   'zoom'  the zoom easing 1 -> 0.72 -> 1 of rest over the run (what follows every dig after a look,
      //           and the finale's pull-back).
      const rfRun = (mode) => b.page.evaluate((mode) => {
        const g = window.__game, cam = g.camera, c = document.getElementById('game').getContext('2d'), out = [];
        const z0 = cam.zoom, st0 = g.mine.memoStats(), bAt = [];
        const bsum = () => { const q = g.mine.memoStats(); return ['earth', 'rock', 'leaf'].reduce((n, k) => n + (q[k] ? q[k].builds : 0), 0); };
        let t = performance.now();
        for (let i = 0; i < 64; i++) {
          t += 16.7;
          if (mode === 'pan') { cam.x += (i % 40 < 20 ? 3 : -3); cam.clamp(); }
          if (mode === 'fast') { cam.x += (i % 32 < 16 ? 12 : -12); cam.clamp(); }
          if (mode === 'zoom') { cam.zoom = z0 * (1 - 0.28 * (0.5 - 0.5 * Math.cos(i / 63 * Math.PI * 2))); }
          const sb = mode === 'zoom' ? bsum() : 0;
          const a = performance.now(); g.renderFrame(t, 1); c.getImageData(0, 0, 1, 1); out.push(performance.now() - a);
          if (mode === 'zoom' && bsum() > sb) bAt.push(i);   // frames 0 and 63 are at the RESTING zoom (cos 0 = cos 2pi)
        }
        cam.zoom = z0;
        const st1 = g.mine.memoStats(), d = (k, f) => (st1[k] ? (st1[k][f] - (st0[k] ? st0[k][f] : 0)) : 0);
        const sum3 = (f) => d('earth', f) + d('rock', f) + d('leaf', f);
        return { ms: out.slice(4), builds: sum3('builds'), live: sum3('live'), hits: sum3('hits'), bAt };
      }, mode);
      const memoKnob = (off) => b.page.evaluate((off) => { window.MYCELIUM_NO_EARTH_MEMO = off; window.MYCELIUM_NO_ROCK_MEMO = off; window.MYCELIUM_NO_LEAF_MEMO = off; }, off);
      await b.page.evaluate(() => { const g = window.__game; g.mine.lookAt(g.camera.x, g.camera.y); });
      const rest = await rfRun('rest'), pan = await rfRun('pan'), fast = await rfRun('fast');
      // THE ZOOM A/B IS INTERLEAVED, THREE PAIRS (M9 verify 3): one run on then one run off measured the host
      // drifting between them as much as the memos (on/off 33.6/33.9, 36.0/33.5, 39.2/34.0 in three runs of the
      // old build). On, off, on, off, on, off, and the medians of all on frames against all off frames.
      const zOn = [], zOff = [], zAt = []; let zb = 0, zl = 0;
      for (let k = 0; k < 3; k++) {
        const on = await rfRun('zoom'); zOn.push(...on.ms); zb += on.builds; zl += on.live; zAt.push(...on.bAt.map((i) => k + ':' + i));
        await memoKnob(true); const off = await rfRun('zoom'); zOff.push(...off.ms); await memoKnob(false);
      }
      const rf = rest.ms;
      // The memo draws the same picture: one frame with the earth and rock memos on, one with them off.
      const same = await b.page.evaluate(() => {
        const g = window.__game, cv = document.getElementById('game'), c = cv.getContext('2d'), t = performance.now();
        const grab = () => { g.renderFrame(t, 1); return c.getImageData(0, 0, cv.width, cv.height).data; };
        g.mine.memoReset();          // built at THIS camera, so the comparison is the content, not a sub-pixel offset
        const on = grab();
        window.MYCELIUM_NO_EARTH_MEMO = true; window.MYCELIUM_NO_ROCK_MEMO = true; window.MYCELIUM_NO_LEAF_MEMO = true;
        const off = grab();
        window.MYCELIUM_NO_EARTH_MEMO = false; window.MYCELIUM_NO_ROCK_MEMO = false; window.MYCELIUM_NO_LEAF_MEMO = false;
        let sum = 0, big = 0; for (let i = 0; i < on.length; i += 4) { const d = Math.abs(on[i] - off[i]) + Math.abs(on[i + 1] - off[i + 1]) + Math.abs(on[i + 2] - off[i + 2]); sum += d; if (d > 48) big++; }
        return { mean: +(sum / (on.length / 4) / 3).toFixed(3), big, px: on.length / 4, stats: g.mine.memoStats() };
      });
      // A SEAM EMPTIED UNDER A STANDING LEAF BUFFER (M9 verify 3): the leaf memo must not keep drawing a heap
      // the colony has eaten. The nearest on-screen unpaid seam is emptied (its cells' nutrient to 0, as a claim
      // does) while the buffer holds it; frames run on past the leaves' fade, and the frame with the memos on
      // must match the frame drawn live, AND differ from the frame before the claim where the heap stood.
      const claim = await b.page.evaluate(() => {
        const g = window.__game, s = g.state, sub = s.substrate, cam = g.camera, cv = document.getElementById('game'), c = cv.getContext('2d');
        let t = performance.now();
        const onScreen = (p) => { const q = p.cells[0], x = ((q % sub.cols) + 0.5) * sub.cellSize, y = sub.surfaceY + (((q / sub.cols) | 0) + 0.5) * sub.cellSize;
          const w = cam.worldToScreen(x, y); return w.x > 40 && w.x < cam.viewW - 40 && w.y > 120 && w.y < cam.viewH - 120; };
        const full = (p) => !p.rewarded && p.cells.some((i) => sub.cells[i].nutrient > 0);
        // An unpaid seam on screen, or the camera taken to the nearest one (the view the block happens to have
        // may hold none: one --mine run read {"none":true}).
        let pile = sub.foodPiles.find((p) => full(p) && onScreen(p));
        let moved = false;
        if (!pile) {
          let bd = Infinity;
          for (const p of sub.foodPiles) { if (!full(p)) continue; const q = p.cells[0], x = ((q % sub.cols) + 0.5) * sub.cellSize, y = sub.surfaceY + (((q / sub.cols) | 0) + 0.5) * sub.cellSize;
            const d = Math.hypot(x - cam.x, y - cam.y); if (d < bd) { bd = d; pile = p; } }
          if (pile) { const q = pile.cells[0]; g.mine.lookAt(((q % sub.cols) + 0.5) * sub.cellSize, sub.surfaceY + (((q / sub.cols) | 0) + 0.5) * sub.cellSize); moved = true; }
        }
        if (!pile) return { none: true };
        const frames = (n) => { for (let i = 0; i < n; i++) { t += 16.7; g.renderFrame(t, 1); } };
        const grab = () => { t += 16.7; g.renderFrame(t, 1); return c.getImageData(0, 0, cv.width, cv.height).data; };
        const diff = (a, b2) => { let n = 0; for (let i = 0; i < a.length; i += 4) if (Math.abs(a[i] - b2[i]) + Math.abs(a[i + 1] - b2[i + 1]) + Math.abs(a[i + 2] - b2[i + 2]) > 48) n++; return n; };
        frames(8);
        const st0 = g.mine.memoStats().leaf;
        const before = grab();
        const st1 = g.mine.memoStats().leaf;
        for (const i of pile.cells) sub.cells[i].nutrient = 0;
        frames(3); t += 700; frames(8);      // past LEAF_FADE_MS (460) on the frame clock
        const on = grab();
        window.MYCELIUM_NO_LEAF_MEMO = true; g.renderFrame(t, 1); const off = c.getImageData(0, 0, cv.width, cv.height).data; window.MYCELIUM_NO_LEAF_MEMO = false;   // the SAME clock as `on`
        return { heldHit: st1.hits > st0.hits, vsLive: diff(on, off), vsBefore: diff(on, before), px: on.length / 4, moved, onScreen: onScreen(pile) };
      });
      await shot(b.page, dsf === 1 ? 'm9-perf-4000-390.png' : `m9-perf-4000-390-dsf${dsf}.png`);
      const f2 = (a) => `median ${med(a).toFixed(2)}, p95 ${pct(a, 0.95).toFixed(2)}`;
      const nodes = await b.page.evaluate(() => window.__game.state.active.nodes.length);
      if (live) {
        ok(`the state holds >= 4,000 strands with its creatures and a rotten patch (${live.nodes})`, live.nodes >= 4000 && live.worms >= 20 && live.clouds >= 10 && live.rot >= 10 && live.clock,
           JSON.stringify({ digs: nav.digs, landed: nav.landed, worms: live.worms, clouds: live.clouds, rot: live.rot, clock: live.clock, kept: st.kept }));
      } else ok(`the state holds >= 4,000 strands${D} (${nodes})`, nodes >= 4000, JSON.stringify({ digs: nav.digs, kept: st.kept }));
      ok(`renderFrame median <= 20 ms and p95 <= 33 ms (camera at rest, raster forced per frame)${D}`, med(rf) <= 20 && pct(rf, 0.95) <= 33,
         `rest ${f2(rf)} over ${rf.length} frames; printed, not gated: pan 3 px ${f2(pan.ms)}, pan 12 px ${f2(fast.ms)} (memo builds ${fast.builds}, live ${fast.live}, hits ${fast.hits})`);
      // A ZOOM THAT MOVES EVERY FRAME BUILDS NO BUFFER (M9 verify 2): with "build on the second stale frame" a
      // zoom tween alternated live frames with 1.69x builds, for both layers, and cost more than no memo at all.
      // COUNTED ON THE 62 FRAMES WHOSE ZOOM MOVED (M12 verify 2): frames 0 and 63 sit at the resting zoom, and
      // the page's own rAF loop draws there between runs — a world tick in between (a claim, a chunk) makes the
      // z0 buffer stale, and two rAF misses plus frame 0 are three consecutive misses under ONE key, i.e. the
      // settle rule doing its job (--mine read 'builds 1, live 558': 558 = 62 moving frames x 3 layers x 3 runs,
      // so the build had replaced a resting-zoom hit). Old: builds over all 64 frames === 0.
      const zbMoving = zAt.filter((s) => { const i = +s.split(':')[1]; return i >= 1 && i <= 62; }).length;
      ok(`while the zoom moves every frame the memos build nothing and draw live, and the tween costs no more than with the memos off (median within 15%, 3 interleaved pairs)${D}`,
         zbMoving === 0 && zl >= 450 && med(zOn) <= med(zOff) * 1.15,
         `zoom tween memos on ${f2(zOn)} (builds on moving frames ${zbMoving}, all ${zb}${zAt.length ? ' at run:frame ' + zAt.join(' ') : ''}, live ${zl}), off ${f2(zOff)}, on/off ${(med(zOn) / med(zOff)).toFixed(3)}`);
      ok(`the earth, leaf and rock memos draw the same frame as drawing live (mean channel diff < 1, < 0.5% of pixels off by > 16)${D}`, same.mean < 1 && same.big < same.px * 0.005, JSON.stringify(same));
      ok(`a seam emptied under a standing leaf buffer leaves the frame as drawing live does (the heap goes)${D}`,
         !claim.none && claim.heldHit && claim.vsLive < claim.px * 0.0005 && claim.vsBefore > 40, JSON.stringify(claim));
      if (live) {
        const mfs = live.mf.map((x) => x[0]), mfNoTick = live.mf.filter((x) => !x[1]).map((x) => x[0]);
        ok('mineFrame <= 2 ms once settled: median AND p95 over the live frames (max printed)', mfs.length >= 20 && med(mfs) <= 2 && pct(mfs, 0.95) <= 2,
           `median ${med(mfs).toFixed(3)} ms, p95 ${pct(mfs, 0.95).toFixed(3)}, max ${Math.max(...mfs).toFixed(3)} over ${mfs.length} frames (no-tick median ${med(mfNoTick).toFixed(3)})`);
        ok('at most 2 whole-colony passes in any frame of the mine\'s own frame code (mine.passes)', live.passes && live.passes.frames >= 20 && live.passes.max <= 2,
           JSON.stringify(live.passes));
        const { settled, digging } = cen;
        ok('at most 2 whole-colony walks in any frame without a world tick on a SETTLED colony, counting EVERY read of the strand array (census)', settled.noTick.frames >= 20 && settled.noTick.max <= 2,
           JSON.stringify(settled.noTick));
        // 4.01 on every frame after a dig before M9 verify 3 (mineAgg's rebuild 1, _rebuildCaches 2, _scheduleInfection 1).
        ok('...and WHILE DIGGING (a dig every 350 ms): every frame without a world tick, the frames after a dig among them, at most 2',
           digging.digOk >= 8 && digging.digFrames.frames >= 5 && digging.noTick.frames >= 20 && digging.noTick.max <= 2,
           `digs ${digging.digOk}/${digging.digs}; after a dig ${JSON.stringify({ frames: digging.digFrames.frames, max: digging.digFrames.max, worst: digging.digFrames.worst })}; all no-tick ${JSON.stringify({ frames: digging.noTick.frames, max: digging.noTick.max, over2: digging.noTick.over2 })}`);
        // 18-21 before M9 verify 3 (healthyCount x4, mineAgg/_scheduleInfection on every tick); 16 after.
        ok('a world-tick frame walks the colony a bounded number of times, not once per creature (census <= 18, settled and digging; printed by caller)',
           settled.tick.frames >= 2 && digging.tick.frames >= 2 && settled.tick.max <= 18 && digging.tick.max <= 18,
           `settled max ${settled.tick.max}, digging max ${digging.tick.max}; digging by caller ${JSON.stringify(digging.tick.whyPerFrame)}; heaviest digging tick frame ${JSON.stringify(digging.tick.worst)}`);
      }
      ok(`no page errors (perf)${D}`, !b.errs.length, b.errs.slice(0, 2).join(' | '));
      await b.ctx.close();
    }
  } catch (e) { fail++; console.log('  FAIL  harness error: ' + (e && e.stack || e)); }
  await E.close();
  console.log(`\n==== ${pass} passed, ${fail} failed ====`);
  process.exit(fail ? 1 : 0);
})();
