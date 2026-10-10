/* COME BACK TOMORROW — the finishing plan's M13 (fossil, Daily Dig, New Journey, strains), as assertions.
 *
 *   fossil   a failed attempt on leg 2 saves its colony on the leg (p.mineJourney.legs[2].fossil, the save
 *            growing by <= 3 KB); the next run on leg 2 has fossil() at 20-300 points; a frame with the
 *            fossil drawn differs from the same frame without it by more than 150 px (an on/on control
 *            reads 0); a landfall on the leg clears it.
 *   seed     two contexts with the same mocked UTC date get the same daily seed and byte-identical chunk
 *            records for the home chunk and its neighbours; the next date's seed and records differ; the
 *            kit (water 108, grow 4, tolerance 2 = 28 m, 1 flask, 1 dose, no vial, no compass) is the same
 *            on a bare save and on one with every rung bought. The title's button reads 'Daily dig · 25 Sep'.
 *   payout   the day's first run banks exactly seams + floor(floor(depth/5)/2) (and its materials); 'Dig
 *            again' is 'practice' and banks 0 P and no material; the best moves only on a deeper run; across
 *            mocked days the streak goes 1, 2, 3 and a skipped day resets it to 1; Copy result writes
 *            'Deep Mine daily 25 Sep: <best> m · streak 1'; one 'daily' event per banked run.
 *   board    MYCELIUM_SUPABASE blank: 0 requests leave localhost, 0 console errors, the board reads 'local'.
 *            A stub backend that answers the mine_daily probe and accepts POSTs: exactly 1 POST to
 *            /rest/v1/scores per PAID daily run (the practice run after it sends none), mode 'mine-daily',
 *            and the board reads 'global'. A stub whose probe 404s (no migration): 0 POSTs, 'local'.
 *   journey  'Begin Journey II' plays a leg-1 seed different from Journey I's (the J2 table's), with the
 *            first heat line at 32 m, and at 32 + 20 = 52 m with one tolerance rung (M14: 14 -> 20 a rung); the stacking rules land
 *            on the run's config (III start water -12, IV worms x2 at 0.3/s, V mould from 42 m and a 15 s
 *            clock, VI pockets +7, VII the island two chunks east); the leg banner names the rules.
 *   strains  the store has no Strains section before the Promised Land and has one after (with the Gold
 *            journey strain owned); buying Amber debits 150 P and the next descent wears it; on that run a
 *            sampled strand pixel's hue moves >= 30 degrees from the cream render.
 *   title    the returning title at 390x844: Continue · Leg N, Daily dig, Store, the records line and the
 *            near-goal line, all on screen and none overlapping (screenshot m13-title-390.png); on a COLD
 *            boot the near goal quotes the store's own Water tank price and the Phosphorus wallet (7 P ready,
 *            3 P short); the fullest returning save (badge, daily, gap, goal, a closed tab's banked note) fits
 *            above Credits at 390x844, 1280x720, 360x640, 320x568, 640x360 and 844x390 with the banked note
 *            and the Daily dig button kept.
 *   tabs     (M13 verify) two tabs start the day's paid run, one banks it, the other's closed-tab record banks
 *            0 at the next boot; a paid run partly banked by another page's boot stays paid and banks the
 *            rest; a run from an older UTC day leaves the newer day's record alone.
 *   journey  also: V Rotten measured on leg 2 against Journey I (and leg 1 stays calm); Journey III's Thirsty
 *            in the store note and the Water tile.
 *
 * Screens: tests/.artifacts/m13-{title,daily-end,strains,fossil,practice}-390.png, m13-title-{1280x720,640x360}.png.
 * `RETURN_ONLY=fossil,seed,payout,board,journey,strains,title,tabs` runs a subset.
 */
const path = require('path'), fs = require('fs');
const H = require('./mine-harness.cjs');
const { sleep } = H;
let pass = 0, fail = 0;
const ok = (n, c, x) => { c ? (pass++, console.log('  PASS  ' + n + (x ? '  — ' + x : ''))) : (fail++, console.log('  FAIL  ' + n + (x ? '  — ' + x : ''))); };
const ART = path.join(H.ROOT, 'tests', '.artifacts');
fs.mkdirSync(ART, { recursive: true });
const ONLY = (process.env.RETURN_ONLY || '').split(',').filter(Boolean);
const want = (k) => !ONLY.length || ONLY.includes(k);
const shot = (page, name) => page.screenshot({ path: path.join(ART, name), animations: 'disabled', timeout: 8000 }).catch(() => {});
const save = (page) => page.evaluate(() => JSON.parse(localStorage.getItem('mycelium.progress.v2') || '{}'));
const tapTele = (page) => page.evaluate(() => { window.__rows = window.__rows || []; window.__telemetry.tap((r) => window.__rows.push(Object.assign({}, r))); });
const DAY = 86400000;
const D25 = Date.UTC(2026, 8, 25, 12, 0, 0);      // 25 Sep 2026, noon UTC
// A save that has landed island 1 (the Daily Dig's unlock) and is on leg 2.
const LANDED = { runsDone: 4, mineRuns: 4, mineBest: 40, migratedMineShelfV2: true, mineStoreVisits: 3,
  mineJourney: { journey: 1, leg: 2, legs: { 1: { runs: 2, bestDepth: 30, bestEast: 96, landed: true } } }, mineSeen: { leg: 2, line42: true } };
// Every page: a mocked clock (Date.now only; `window.__dayOff` moves it whole days) and a seeded save.
const prep = (o) => async (page, ctx) => {
  if (o.clock != null) await page.addInitScript((b) => {
    const real = Date.now.bind(Date), t0 = real(); window.__dayOff = window.__dayOff || 0;
    Date.now = () => b + (real() - t0) + (window.__dayOff || 0);
  }, o.clock);
  if (o.save) await page.addInitScript((sv) => { try { if (!localStorage.getItem('mycelium.progress.v2')) localStorage.setItem('mycelium.progress.v2', JSON.stringify(sv)); } catch (_) {} }, o.save);
  if (o.before) await o.before(page, ctx);
};
const waitRun = (page, pred) => page.waitForFunction((pred) => { const g = window.__game, s = g && g.state;
  if (!(s && s.substrate && s.substrate.mine && !s.runOver && s.substrate._rockSolidified && (s._mineFrameN | 0) > 2)) return false;
  return pred ? !!eval(pred) : true; }, pred || null, { timeout: 40000, polling: 100 }).then(() => true).catch(() => false);
// Dig down to `m` metres with the harness's navigator (mine-check's `__digTo`: it looks before digging,
// travels along walls, and keeps the tank topped up — the pay depends on depth and seams only).
const digDown = async (page, m) => {
  await H.injectNav(page);
  return page.evaluate(async (m) => { const g = window.__game; const d = await window.__digTo(m, 200);
    await new Promise((q) => setTimeout(q, 600)); return { depth: d, max: g.mine.maxDepth() }; }, m);
};
const endRun = async (page) => {
  await page.evaluate(() => { const s = window.__game.state; s.nematodes.length = 0; window.__game.mine.end(); });
  await page.waitForSelector('#ssMineEnd', { timeout: 30000 }).catch(() => {});
  await sleep(900);
  return page.evaluate(() => Object.assign({}, window.__game.state.runResult || {}));
};

(async () => {
  const E = await H.start();
  try {
    // ------------------------------------------------------------------ fossil
    if (want('fossil')) {
      console.log('--- the fossil');
      const b = await E.boot('#leg,1,2', 390, 844, { before: prep({ save: LANDED }) });
      const p = b.page;
      await waitRun(p);
      const sz0 = (await p.evaluate(() => (localStorage.getItem('mycelium.progress.v2') || '').length));
      await digDown(p, 30);
      const nodes = await p.evaluate(() => window.__game.state.active.nodes.length);
      const r1 = await endRun(p);
      const sv1 = await save(p);
      const sz1 = (await p.evaluate(() => (localStorage.getItem('mycelium.progress.v2') || '').length));
      const f = sv1.mineJourney.legs[2] && sv1.mineJourney.legs[2].fossil;
      ok('a failed attempt saves its colony on the leg, in <= 3 KB', typeof f === 'string' && f.length > 0 && f.length <= 3072,
         JSON.stringify({ cause: r1.cause, nodes, bytes: f && f.length }));
      ok('...and the save grows by <= 3 KB for the leg', sz1 - sz0 <= 3072, `save ${sz0} -> ${sz1} bytes (+${sz1 - sz0})`);
      await p.click('#ssMineDescend');
      await waitRun(p, "s._mineFossil && s._mineFossil.pts.length >= 0 && window.__game.mine.leg().leg === 2");
      await sleep(800);
      const F = await p.evaluate(() => window.__game.mine.fossil());
      ok('the next run on that leg has fossil() at 20-300 points', F && F.points >= 20 && F.points <= 300, JSON.stringify(F && { points: F.points, bytes: F.bytes, drawn: F.drawn }));
      // The pixel A/B: the same frame (same clock) with and without the fossil, and an on/on control.
      const px = await p.evaluate(() => {
        const g = window.__game, cv = document.getElementById('game'), cx = cv.getContext('2d');
        const t = performance.now();
        const grab = () => { g.renderFrame(t, 0); return cx.getImageData(0, 0, cv.width, cv.height).data; };
        g.mine.fossilOn(true); const a = grab(); const a2 = grab();
        g.mine.fossilOn(false); const bb = grab();
        g.mine.fossilOn(true);
        let diff = 0, ctl = 0;
        for (let i = 0; i < a.length; i += 4) {
          if (Math.abs(a[i] - bb[i]) + Math.abs(a[i + 1] - bb[i + 1]) + Math.abs(a[i + 2] - bb[i + 2]) > 6) diff++;
          if (Math.abs(a[i] - a2[i]) + Math.abs(a[i + 1] - a2[i + 1]) + Math.abs(a[i + 2] - a2[i + 2]) > 6) ctl++;
        }
        return { diff, ctl, drawn: g.mine.fossil().drawn };
      });
      ok('the fossil is drawn: on against off differs by > 150 px, on/on by < 20', px.diff > 150 && px.ctl < 20, JSON.stringify(px));
      await shot(p, 'm13-fossil-390.png');
      // A landfall on the leg clears it.
      await p.evaluate(async () => { const g = window.__game; g.state.active.water = 999; g.mine.grow(0, 1);
        await new Promise((r) => setTimeout(r, 250)); g.mine.plantAtTaproot(); });
      await p.waitForFunction(() => window.__game.state.runOver, { timeout: 8000 }).catch(() => {});
      await sleep(600);
      const sv2 = await save(p);
      const rr = await p.evaluate(() => (window.__game.state.runResult || {}).cause);
      ok('a landfall on the leg clears its fossil', rr === 'island' && sv2.mineJourney.legs[2] && sv2.mineJourney.legs[2].landed && !('fossil' in sv2.mineJourney.legs[2]),
         JSON.stringify({ cause: rr, rec: sv2.mineJourney.legs[2] && Object.keys(sv2.mineJourney.legs[2]) }));
      // A TAB CLOSED MID-ATTEMPT LEAVES A FOSSIL TOO (M13 verify): the pending record carries it and the
      // next boot's bank puts it on the leg (it used to keep the previous attempt's, or none).
      await p.evaluate(() => window.__game.mine.playLeg(1, 3));
      await waitRun(p, 'window.__game.mine.leg() && window.__game.mine.leg().leg === 3');
      await digDown(p, 20);
      const pf = await p.evaluate(() => { window.__game.mine.pendingWrite(); const sv = JSON.parse(localStorage.getItem('mycelium.progress.v2'));
        const r = Object.values(sv.minePending || {})[0] || {}; return { leg: r.leg, fossil: typeof r.fossil === 'string' ? r.fossil.length : 0, had: !!(sv.mineJourney.legs[3] && sv.mineJourney.legs[3].fossil) }; });
      await p.close();
      const b2 = await E.boot('', 390, 844, { ctx: b.ctx, before: prep({ save: LANDED }) });
      await b2.page.waitForSelector('#tsNewMine', { timeout: 20000 }).catch(() => {});
      const sv3 = await save(b2.page);
      const f3 = sv3.mineJourney.legs[3] && sv3.mineJourney.legs[3].fossil;
      ok('a tab closed mid-attempt leaves its fossil on the leg (via the pending record and the boot bank)',
         pf.leg === 3 && pf.fossil > 0 && !pf.had && typeof f3 === 'string' && f3.length === pf.fossil && !sv3.minePending,
         JSON.stringify({ pf, saved: f3 ? f3.length : 0 }));
      ok('no page errors (fossil)', !b.errs.length && !b2.errs.length, b.errs.concat(b2.errs).slice(0, 2).join(' | '));
      await b.ctx.close();
    }

    // ------------------------------------------------------------------ seed
    if (want('seed')) {
      console.log('--- the daily seed and kit');
      const ALL = { water: 8, growSteps: 4, heatTolerance: 4, excreteCharges: 3, amputateCharges: 3, oxalicVial: 3, compassIsland: 2,
                    compass_anthracite: 3, compass_garnet: 3, compass_hematite: 3 };
      const one = async (clock, extra, viaTitle) => {
        const b = await E.boot('', 390, 844, { before: prep({ clock, save: Object.assign({}, LANDED, extra || {}) }) });
        let label = null;
        if (viaTitle) {
          await b.page.waitForSelector('#tsDaily', { timeout: 20000 }).catch(() => {});
          await sleep(2400);
          label = await b.page.evaluate(() => (document.getElementById('tsDaily') || {}).textContent || null);
          await b.page.click('#tsDaily').catch(() => {});
        } else {
          await b.page.waitForSelector('#tsNewMine', { timeout: 20000 }).catch(() => {});
          await b.page.evaluate(() => window.__menu && window.__menu.playDaily ? window.__menu.playDaily() : null);
        }
        await waitRun(b.page, 's.config.mine.daily');
        const r = await b.page.evaluate(() => {
          const g = window.__game, s = g.state, M = s.config.mine, sub = s.substrate, cw = M.chunkCols;
          const home = Math.floor(sub.cols / 2 / cw);
          g.mine.ensureChunks((home - 1) * cw * sub.cellSize, ((home + 2) * cw - 1) * sub.cellSize);
          const rec = (ci) => { const c = s.mineChunks[ci]; return c ? JSON.stringify({ rocks: c.rocks, ore: c.ore, water: c.water, open: c.open, bbox: c.bbox, spots: c.spots }) : null; };
          let h = 0; const str = [home - 1, home, home + 1].map(rec).join('|');
          for (let i = 0; i < str.length; i++) h = (Math.imul(h, 31) + str.charCodeAt(i)) | 0;
          return { d: g.mine.daily(), leg: g.mine.leg(), kit: { water: M.startWater, net: s.active.water, grow: M.growSteps, heat: M.heatBonus, items: M.items, compass: M.compass,
            first: g.mine.heatLines()[0] }, hash: h, recs: !str.includes('null') };
        });
        r.label = label; r.errs = b.errs.slice(0, 2);
        await b.ctx.close();
        return r;
      };
      const A = await one(D25, null, true), B = await one(D25 + 3600000, { mineUpgrades: ALL, minerals: 0 }, false), C = await one(D25 + DAY, null, false);
      ok("the title's button reads 'Daily dig · 25 Sep' after the first landfall", A.label === 'Daily dig · 25 Sep', JSON.stringify(A.label));
      ok('two contexts on the same UTC date get the same seed', A.d.key === '20260925' && B.d.key === '20260925' && A.d.seed === B.d.seed && A.d.cfg && B.d.cfg,
         JSON.stringify({ A: [A.d.key, A.d.seed], B: [B.d.key, B.d.seed] }));
      ok('...and the same chunk records (home chunk and both neighbours)', A.recs && A.hash === B.hash, JSON.stringify({ A: A.hash, B: B.hash }));
      ok('the next date has another seed and other chunks', C.d.key === '20260926' && C.d.seed !== A.d.seed && C.hash !== A.hash, JSON.stringify({ C: [C.d.key, C.d.seed, C.hash] }));
      ok('it plays the free layout (no leg)', A.leg === null && C.leg === null, JSON.stringify([A.leg, C.leg]));
      const kitOf = (r) => JSON.stringify(r.kit);
      // M14: heat tolerance 14 -> 20 m a rung, so the daily's two rungs put the first line at 82 m (was 70).
      ok('the kit is 108 water, grow 4, tolerance 2 (first line 82 m), 1 flask, 1 dose, no vial, no compass',
         A.kit.water === 108 && A.kit.net === 108 && A.kit.grow === 4 && A.kit.heat === 40 && A.kit.first === 82 && A.kit.items.excrete === 1 && A.kit.items.amputate === 1
         && A.kit.items.vial === 0 && A.kit.compass.island === 0 && Object.values(A.kit.compass.mats).every((v) => v === 0), kitOf(A));
      ok('...and identical with every store rung bought', kitOf(A) === kitOf(B), kitOf(B));
      ok('no page errors (seed)', !A.errs.length && !B.errs.length && !C.errs.length, [A.errs, B.errs, C.errs].flat().join(' | '));
    }

    // ------------------------------------------------------------------ payout
    if (want('payout')) {
      console.log('--- the daily payout, best and streak, Copy result');
      const b = await E.boot('', 390, 844, { before: prep({ clock: D25, save: LANDED,
        before: async (page, ctx) => { await ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: E.base }); } }) });
      const p = b.page;
      await tapTele(p);
      await p.waitForSelector('#tsDaily', { timeout: 20000 }).catch(() => {});
      await sleep(2400);
      await p.click('#tsDaily');
      await waitRun(p, 's.config.mine.daily');
      await tapTele(p);
      const sv0 = await save(p);
      const d1 = await digDown(p, 24);
      // A SEAM, claimed, so the formula is tested with seams > 0 (the navigator's straight dive passes none):
      // stamped on a strand's own cell, digested and colonised — `mineOreRewards` pays it on a frame.
      const seam = await p.evaluate(async () => {
        const g = window.__game, s = g.state, sub = s.substrate, ns = s.active.nodes.filter((n) => !n.infected);
        const n = ns[Math.floor(ns.length * 0.6)];
        const pi = g.mine.stampSeam(n.x, n.y, 'phosphorus');
        if (pi < 0) return { ok: false };
        const pile = sub.foodPiles[pi];
        for (const idx of pile.cells) { const c = sub.cells[idx]; c.nutrient = 0; c.colonized = 1; }
        for (let k = 0; k < 40 && !pile.rewarded; k++) await new Promise((q) => setTimeout(q, 100));
        return { ok: !!pile.rewarded, ore: s.mineOre | 0 };
      });
      // A DAILY DOES NOT SPEND THE JOURNEY'S FIRST-ROT GRACE (M13 verify 2): meeting rot on a daily persists no
      // `mineSeen.rot` (the daily ran the 20 s clock; the save keeps its 30 s first breach for the journey).
      // Control: the same flag on the same page's frame loop does persist `cloud`.
      const rot = await p.evaluate(async () => { const s = window.__game.state; s.mineSeenNow = s.mineSeenNow || {};
        s.mineSeenNow.rot = true; s.mineSeenNow.cloud = true;
        await new Promise((q) => setTimeout(q, 700)); const sv = JSON.parse(localStorage.getItem('mycelium.progress.v2'));
        return { rot: !!(sv.mineSeen && sv.mineSeen.rot), cloud: !!(sv.mineSeen && sv.mineSeen.cloud), firstRot: s.config.mine.firstRot }; });
      ok("a daily that meets rot leaves the save's first-rot grace for the journey (mineSeen.rot unset; control: cloud is saved)",
         !rot.rot && rot.cloud && rot.firstRot === false, JSON.stringify(rot));
      const r1 = await endRun(p);
      const sv1 = await save(p);
      const exp1 = (r1.seams | 0) + Math.floor(Math.floor((r1.depth | 0) / 5) / 2);
      const dP1 = (sv1.minerals | 0) - (sv0.minerals | 0);
      ok("the day's first run banks seams + floor(reach/2)", r1.daily && !r1.daily.practice && dP1 === exp1 && (r1.ore | 0) === exp1 && Math.floor((r1.depth | 0) / 5) >= 2
         && seam.ok && (r1.seams | 0) > 0, JSON.stringify({ depth: r1.depth, seams: r1.seams, reachRaw: r1.reachRaw, ore: r1.ore, banked: dP1, want: exp1, seam }));
      const tag1 = await p.evaluate(() => ({ tag: (document.getElementById('ssDailyTag') || {}).textContent, board: (document.getElementById('ssDailyBoard') || {}).dataset }));
      ok("...and its screen says 'paid run'", /paid run/.test(tag1.tag || ''), JSON.stringify(tag1));
      await shot(p, 'm13-daily-end-390.png');
      // Copy result (a real click: the clipboard API wants the gesture).
      await p.click('#ssDailyCopy');
      await sleep(400);
      const clip = await p.evaluate(() => navigator.clipboard.readText().catch((e) => 'ERR ' + e));
      const best1 = (await save(p)).mineDaily.best;
      ok("Copy result writes 'Deep Mine daily 25 Sep: <best> m · streak 1'", clip === `Deep Mine daily 25 Sep: ${best1} m · streak 1`, JSON.stringify(clip));
      // Practice: shallower.
      await p.click('#ssMineDescend');
      await waitRun(p, 's.config.mine.daily && s.config.mine.daily.practice');
      const m0 = await save(p);
      await digDown(p, 8);
      const r2 = await endRun(p);
      const m1 = await save(p);
      const mats0 = JSON.stringify(m0.mats || {}), mats1 = JSON.stringify(m1.mats || {});
      const tag2 = await p.evaluate(() => (document.getElementById('ssDailyTag') || {}).textContent || '');
      ok("the second run of the day is 'practice' and banks 0 (P and materials)", r2.daily && r2.daily.practice && (m1.minerals | 0) === (m0.minerals | 0) && mats0 === mats1 && (r2.ore | 0) === 0 && /practice/.test(tag2),
         JSON.stringify({ depth: r2.depth, ore: r2.ore, P: [m0.minerals, m1.minerals], tag: tag2 }));
      await shot(p, 'm13-practice-390.png');
      ok('a shallower run leaves the best alone', m1.mineDaily.best === best1 && (r2.depth | 0) < best1, JSON.stringify({ best: m1.mineDaily.best, run: r2.depth }));
      await p.click('#ssMineDescend');
      await waitRun(p, 's.config.mine.daily && s.config.mine.daily.practice');
      await digDown(p, 42);
      const r3 = await endRun(p);
      const m3 = await save(p);
      ok('a deeper run moves the best (still practice, still unpaid)', (r3.depth | 0) > best1 && m3.mineDaily.best === (r3.depth | 0) && (m3.minerals | 0) === (m1.minerals | 0)
         && JSON.stringify(m3.mats || {}) === mats1, JSON.stringify({ best: m3.mineDaily.best, run: r3.depth, P: m3.minerals, mats: m3.mats, dug: r3.seamCount }));
      // The streak across mocked days: 26th -> 2, 27th -> 3, then the 29th (a gap) -> 1.
      const streaks = [];
      for (const off of [1, 2, 4]) {
        await p.evaluate((o) => { window.__dayOff = o * 86400000; }, off);
        await p.click('#ssMineDescend');
        await waitRun(p, 's.config.mine.daily && !s.config.mine.daily.practice');
        await digDown(p, 8);
        const r = await endRun(p);
        const sv = await save(p);
        streaks.push({ date: r.daily && r.daily.date, streak: sv.mineDaily.streak, paid: r.daily && !r.daily.practice });
      }
      ok('across mocked days the streak goes 1, 2, 3 and a gap resets it to 1',
         sv1.mineDaily.streak === 1 && streaks.map((x) => x.streak).join(',') === '2,3,1' && streaks.map((x) => x.date).join(',') === '20260926,20260927,20260929' && streaks.every((x) => x.paid),
         JSON.stringify({ first: sv1.mineDaily.streak, streaks }));
      const ev = await p.evaluate(() => (window.__rows || []).filter((r) => r.kind === 'daily').map((r) => r.detail));
      ok("one 'daily' event per banked run, naming paid / practice and the streak",
         ev.join(',') === '20260925:paid:s1,20260925:practice:s1,20260925:practice:s1,20260926:paid:s2,20260927:paid:s3,20260929:paid:s1', JSON.stringify(ev));
      ok('no page errors (payout)', !b.errs.length, b.errs.slice(0, 2).join(' | '));
      await b.ctx.close();
    }

    // ------------------------------------------------------------------ board
    if (want('board')) {
      console.log('--- the board: local, global, and an un-migrated backend');
      const run = async (supabase, route) => {
        const reqs = [], posts = [], cerr = [];
        const b = await E.boot('', 390, 844, { supabase, before: prep({ clock: D25, save: LANDED, before: async (page) => {
          page.on('request', (rq) => { if (!rq.url().startsWith(E.base)) reqs.push(rq.method() + ' ' + rq.url()); });
          page.on('console', (m) => { if (m.type() === 'error') cerr.push(m.text()); });
          if (route) await page.route('https://board.test/**', (rt) => {
            const u = rt.request().url(), m = rt.request().method();
            if (m === 'POST' && u.includes('/rest/v1/scores')) { posts.push(rt.request().postData() || ''); return rt.fulfill({ status: 201, body: '' }); }
            if (m === 'POST') return rt.fulfill({ status: 201, body: '' });
            if (u.includes('/rest/v1/mine_daily')) return route === 'migrated'
              ? rt.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([{ name: 'Pal', level: 120, created_at: '2026-09-25T10:00:00Z' }]) })
              : rt.fulfill({ status: 404, contentType: 'application/json', body: '{"message":"relation does not exist"}' });
            return rt.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
          });
        } }) });
        const p = b.page;
        await p.waitForSelector('#tsDaily', { timeout: 20000 }).catch(() => {});
        await sleep(2400);
        await p.click('#tsDaily');
        await waitRun(p, 's.config.mine.daily');
        await digDown(p, 12);
        await endRun(p);
        await sleep(1500);
        const paid = { posts: posts.length, board: await p.evaluate(() => { const e = document.getElementById('ssDailyBoard'); return e ? { kind: e.dataset.board, text: e.textContent } : null; }) };
        await p.click('#ssMineDescend');
        await waitRun(p, 's.config.mine.daily && s.config.mine.daily.practice');
        await digDown(p, 8);
        await endRun(p);
        await sleep(1500);
        const out = { paid, afterPractice: posts.length, body: posts[0] || '', reqs, cerr, errs: b.errs.slice(0, 2) };
        await b.ctx.close();
        return out;
      };
      const L = await run(null, null);
      ok("blank MYCELIUM_SUPABASE: 0 requests leave localhost", L.reqs.length === 0, JSON.stringify(L.reqs.slice(0, 3)));
      ok('...0 console errors', L.cerr.length === 0 && !L.errs.length, JSON.stringify(L.cerr.slice(0, 3)));
      ok("...and the board is labelled 'local'", L.paid.board && L.paid.board.kind === 'local' && /local/.test(L.paid.board.text), JSON.stringify(L.paid.board));
      const G = await run({ url: 'https://board.test', anonKey: 'k' }, 'migrated');
      let body = {}; try { body = JSON.parse(G.body); } catch (_) {}
      ok('a stub that answers the probe and accepts POSTs: exactly 1 submission for the paid run, 0 for the practice run',
         G.paid.posts === 1 && G.afterPractice === 1, JSON.stringify({ paid: G.paid.posts, total: G.afterPractice }));
      ok("...mode 'mine-daily', the depth as the level and the UTC date", body.mode === 'mine-daily' && body.species === '20260925' && (body.level | 0) > 0, G.body);
      ok("...and the board reads 'global'", G.paid.board && G.paid.board.kind === 'global' && /global/.test(G.paid.board.text) && /Pal/.test(G.paid.board.text), JSON.stringify(G.paid.board));
      const U = await run({ url: 'https://board.test', anonKey: 'k' }, 'unmigrated');
      ok('a backend without the migration (probe 404s): 0 submissions, still local', U.afterPractice === 0 && U.paid.board && U.paid.board.kind === 'local',
         JSON.stringify({ posts: U.afterPractice, board: U.paid.board }));
    }

    // ------------------------------------------------------------------ journey
    if (want('journey')) {
      console.log('--- New Journey');
      const J2SAVE = { runsDone: 40, mineRuns: 40, mineBest: 150, migratedMineShelfV2: true, mineStoreVisits: 30, minerals: 0,
        mineJourney: { journey: 2, leg: 1, done: [1], past: { 1: { runs: 38, legs: { 8: { runs: 3, landed: true } } } }, legs: {} }, mineSeen: { leg: 8, line42: true } };
      const b = await E.boot('', 390, 844, { before: prep({ save: J2SAVE }) });
      const p = b.page;
      await p.waitForSelector('#tsNewMine', { timeout: 20000 }).catch(() => {});
      await sleep(2400);
      const cap = await p.evaluate(() => (document.getElementById('tsJourneyCap') || {}).textContent);
      await p.click('#tsNewMine');
      await waitRun(p, 'window.__game.mine.leg()');
      await sleep(400);
      const r = await p.evaluate(() => { const g = window.__game, L = g.mine.leg();
        return { leg: [L.journey, L.leg, L.seed], j1: window.__cfg.mine.journey.legs[0].seed, j2: (window.__cfg.mine.journey.tables || {})[2], first: g.mine.heatLines()[0],
                 beats: (g.mine.beats ? g.mine.beats() : []).slice(-3) }; });
      ok("'Begin Journey II' plays a leg-1 seed different from Journey I's (the J2 table's)", cap === 'Begin Journey II' && r.leg[0] === 2 && r.leg[1] === 1
         && r.leg[2] !== r.j1 && r.j2 && r.leg[2] === r.j2[0].seed, JSON.stringify({ cap, leg: r.leg, j1: r.j1, table: r.j2 && r.j2[0] }));
      ok('...with the first heat line at 32 m', r.first === 32, JSON.stringify(r.first));
      const banner = JSON.stringify(r.beats);
      ok("...and the leg banner names the journey's rule", /Journey II: Hotter/.test(banner), banner);
      // One tolerance rung: 32 + 14.
      await p.evaluate(() => { const s = JSON.parse(localStorage.getItem('mycelium.progress.v2')); s.mineUpgrades = { heatTolerance: 1 }; localStorage.setItem('mycelium.progress.v2', JSON.stringify(s)); window.__game.mine.playJourney(); });
      await waitRun(p, 's.config.mine.heatBonus === 20');
      const first1 = await p.evaluate(() => window.__game.mine.heatLines()[0]);
      ok('...and at 32 + 20 = 52 m with one tolerance rung (M14: 20 m a rung)', first1 === 52, JSON.stringify(first1));
      // The stacking rules, journey by journey, on the run's config.
      const rules = {};
      // V is measured on LEG 2 (M13 verify): leg 4's own row already has mould in bands 1-3, so on leg 4 the
      // cloud half of Rotten held whether or not the rule existed. Leg 2's band 1 has none under Journey I.
      // '5c' is V on leg 1, whose 'calm' rule keeps it clear of creatures.
      for (const [j, l, k] of [[1, 2], [3, 2], [4, 2], [5, 2], [5, 1, '5c'], [6, 3], [7, 8]]) {
        await p.evaluate(([j, l]) => { const s = JSON.parse(localStorage.getItem('mycelium.progress.v2')); s.mineUpgrades = {}; localStorage.setItem('mycelium.progress.v2', JSON.stringify(s)); window.__game.mine.playLeg(j, l); }, [j, l]);
        await waitRun(p, `window.__game.mine.leg() && window.__game.mine.leg().journey === ${j} && window.__game.mine.leg().leg === ${l}`);
        rules[k || j] = await p.evaluate(() => { const g = window.__game, s = g.state, M = s.config.mine, L = g.mine.leg();
          return { sw: M.startWater, wps: M.worms.waterPerSec, tb: M.threatBands.map((b) => [b.worms, b.clouds]), inf: M.infectionMs, rw: M.reservoirWater,
                   ids: M.journeyRules, c0: L.layout.islandC0, col: L.layout.taproot.col, chunk: Math.floor(L.layout.taproot.col / M.chunkCols), seed: L.seed }; });
      }
      ok('III Thirsty: start water 60 - 12 = 48', rules[3].sw === 48 && rules[1].sw === 60, JSON.stringify([rules[1].sw, rules[3].sw]));
      ok('IV Hungry: worms x2 (leg 2: 0/2/2/4 against 0/1/1/2) at 0.3/s', JSON.stringify(rules[4].tb.map((x) => x[0])) === JSON.stringify(rules[1].tb.map((x) => x[0] * 2)) && rules[4].wps === 0.3 && rules[1].wps === 0.15,   // M14: the mine's worm drain 0.2 -> 0.15/s (Hungry stays 0.3)
         JSON.stringify({ J1: rules[1].tb, J4: rules[4].tb, wps: rules[4].wps }));
      ok('V Rotten: mould in every band from 42 m (leg 2\'s band 1 goes 0 -> 1 against Journey I), a 15 s rot clock',
         rules[1].tb[1][1] === 0 && rules[5].tb[1][1] >= 1 && rules[5].tb.slice(1).every((x) => x[1] >= 1) && rules[5].inf === 15000,
         JSON.stringify({ J1: rules[1].tb, J5: rules[5].tb, inf: rules[5].inf }));
      ok('...and leg 1 stays calm under V (no creature in any band)', rules['5c'].tb.every((x) => x[0] === 0 && x[1] === 0), JSON.stringify(rules['5c'].tb));
      // THIRSTY IN THE STORE (M13 verify): a Journey III save with Water II — the note and the Water tile quote
      // what the next descent actually starts with (60 + 30 - 12 = 78 since M14's +15 step; was 60 + 24 - 12 = 72), not 90.
      await p.evaluate(() => { const s = JSON.parse(localStorage.getItem('mycelium.progress.v2'));
        s.mineJourney = { journey: 3, leg: 2, done: [1, 2], past: s.mineJourney.past || {}, legs: { 1: { runs: 1, landed: true } } }; s.mineUpgrades = { water: 2 };
        localStorage.setItem('mycelium.progress.v2', JSON.stringify(s)); window.__game.mine.playJourney(); });
      await waitRun(p, 'window.__game.mine.leg() && window.__game.mine.leg().journey === 3');
      const sw3 = await p.evaluate(() => window.__game.state.config.mine.startWater);
      await p.evaluate(() => { window.__cfg.game = 'mine'; window.__game.showPicker(); });
      await p.waitForSelector('#ssMineNote', { timeout: 8000 }).catch(() => {});
      const st3 = await p.evaluate(() => { const n = document.getElementById('ssMineNote'); const t = document.querySelector('[data-upg="water"]');
        const tile = t && t.closest('.ss-upg'); const now = tile && tile.querySelector('.ss-upg-now');
        return { note: n && n.textContent, now: now && now.textContent }; });
      ok("Journey III's Thirsty in the store: the note and the Water tile quote the descent's own start water",
         sw3 === 78 && new RegExp('(^|· )' + sw3 + ' water').test(st3.note || '') && String(st3.now || '').indexOf(String(sw3)) >= 0, JSON.stringify({ run: sw3, st3 }));
      ok('VI Stingy: a pocket gives +7', rules[6].rw === 7, JSON.stringify(rules[6].rw));
      ok('VII Far: leg 8\'s island two chunks east (chunk 18, at most 19), on the J4 table\'s seed', rules[7].chunk === 18 && rules[7].ids.length === 6,
         JSON.stringify({ col: rules[7].col, chunk: rules[7].chunk, ids: rules[7].ids, seed: rules[7].seed }));
      ok('no page errors (journey)', !b.errs.length, b.errs.slice(0, 2).join(' | '));
      await b.ctx.close();
    }

    // ------------------------------------------------------------------ strains
    if (want('strains')) {
      console.log('--- strains');
      const openStore = async (sv) => {
        const b = await E.boot('', 390, 844, { before: prep({ save: sv }) });
        await b.page.waitForSelector('#tsStore', { timeout: 20000 }).catch(() => {});
        await sleep(2400);
        await b.page.click('#tsStore');
        await b.page.waitForSelector('#ssDescend', { timeout: 15000 }).catch(() => {});
        await sleep(500);
        return b;
      };
      const before = await openStore(Object.assign({}, LANDED, { minerals: 1000 }));
      const sec0 = await before.page.evaluate(() => ({ sec: !!document.getElementById('ssStrainSec'), store: !!document.getElementById('ssDescend') }));
      ok('the store has no Strains section before the Promised Land', sec0.store && !sec0.sec, JSON.stringify(sec0));
      await before.ctx.close();
      const AFTER = { runsDone: 40, mineRuns: 40, mineBest: 150, migratedMineShelfV2: true, mineStoreVisits: 30, minerals: 1000,
        mineJourney: { journey: 2, leg: 1, done: [1], past: { 1: { runs: 38, legs: {} } }, legs: {} }, mineSeen: { leg: 8, line42: true } };
      const b = await openStore(AFTER);
      const p = b.page;
      const sec1 = await p.evaluate(() => ({ sec: !!document.getElementById('ssStrainSec'), tiles: Array.from(document.querySelectorAll('[data-strain-tile]')).map((e) => e.dataset.strainTile) }));
      ok('...and has one after it, the Gold journey strain owned', sec1.sec && ['cream', 'amber', 'violet', 'ghost', 'coal', 'gold'].every((t) => sec1.tiles.includes(t))
         && await p.evaluate(() => !!document.querySelector('[data-strain-tile="gold"] [data-wear]')), JSON.stringify(sec1));
      const heat = await p.evaluate(() => ({ tile: ((document.querySelector('[data-track="heatTolerance"] .ss-upg-now') || {}).textContent || ''),
        note: ((document.getElementById('ssMineNote') || {}).textContent || '') }));
      ok("the store quotes Journey II's heat: 'line 32 m' and 'past 32 / 74 / 116 m'", /line 32 m/i.test(heat.tile) && /past 32 \/ 74 \/ 116 m/.test(heat.note), JSON.stringify(heat));
      await p.evaluate(() => document.getElementById('ssStrainSec').scrollIntoView());
      await sleep(300);
      await shot(p, 'm13-strains-390.png');
      await p.click('[data-strain="amber"]');
      await sleep(400);
      const sv = await save(p);
      ok('buying Amber debits 150 P and wears it', (sv.minerals | 0) === 850 && sv.mineStrains && sv.mineStrains.cur === 'amber', JSON.stringify({ P: sv.minerals, st: sv.mineStrains }));
      await p.click('#ssDescend');
      await waitRun(p);
      await digDown(p, 20);
      await sleep(1500);
      const hue = await p.evaluate(() => {
        const g = window.__game, s = g.state, cv = document.getElementById('game'), cx = cv.getContext('2d');
        const t = performance.now(), tint = s.config.mine.tint;
        const grab = () => { g.renderFrame(t, 0); return cx.getImageData(0, 0, cv.width, cv.height).data; };
        const A = grab();
        s.config.mine.tint = ''; const C = grab();
        s.config.mine.tint = tint;
        const h = (r, gg, b) => { const mx = Math.max(r, gg, b), mn = Math.min(r, gg, b), d = mx - mn; if (!d) return null;
          let x = mx === r ? ((gg - b) / d) % 6 : mx === gg ? (b - r) / d + 2 : (r - gg) / d + 4; x *= 60; return x < 0 ? x + 360 : x; };
        const shifts = [];
        for (let i = 0; i < A.length; i += 4) {
          const dd = Math.abs(A[i] - C[i]) + Math.abs(A[i + 1] - C[i + 1]) + Math.abs(A[i + 2] - C[i + 2]);
          if (dd < 40) continue;
          // A STRAND pixel: bright in the cream render (a strand's core; the anti-aliased rim blends into the
          // warm soil, whose own hue sits close to amber's and would measure the soil rather than the strain).
          if (Math.max(C[i], C[i + 1], C[i + 2]) < 150) continue;
          const ha = h(A[i], A[i + 1], A[i + 2]), hc = h(C[i], C[i + 1], C[i + 2]);
          if (ha == null || hc == null) continue;
          let dh = Math.abs(ha - hc); if (dh > 180) dh = 360 - dh; shifts.push(dh);
        }
        shifts.sort((a, b) => a - b);
        return { tint, n: shifts.length, median: shifts.length ? +shifts[shifts.length >> 1].toFixed(1) : 0 };
      });
      await shot(p, 'm13-amber-390.png');
      ok("the next descent wears it, and a strand pixel's hue moves >= 30 degrees from cream", hue.tint === '#f2b45a' && hue.n >= 50 && hue.median >= 30, JSON.stringify(hue));
      ok('no page errors (strains)', !b.errs.length, b.errs.slice(0, 2).join(' | '));
      await b.ctx.close();
    }

    // ------------------------------------------------------------------ title
    if (want('title')) {
      console.log('--- the returning title');
      const SV = Object.assign({}, LANDED, { minerals: 7, mineDaily: { date: '20260925', best: 64, streak: 2, lastDate: '20260925', paid: '20260925' },
        mineJourney: { journey: 1, leg: 2, legs: { 1: { runs: 2, bestDepth: 30, bestEast: 96, landed: true }, 2: { runs: 3, bestDepth: 60, bestEast: 80 } } } });
      const IDS = ['tsJourneyCap', 'tsNewMine', 'tsDaily', 'tsDailySub', 'tsStore', 'tsRecords', 'tsJourneyBadge', 'tsGap', 'tsGoal', 'tsBanked', 'tsCredits'];
      const readTitle = (p) => p.evaluate((ids) => {
        const out = {};
        for (const id of ids) { const e = document.getElementById(id); if (!e) { out[id] = null; continue; } const r = e.getBoundingClientRect();
          out[id] = { t: e.textContent, vis: r.height > 0, x0: Math.round(r.left), x1: Math.round(r.right), y0: Math.round(r.top), y1: Math.round(r.bottom) }; }
        const strip = document.querySelector('#titleScreen .mj-strip'); if (strip) { const r = strip.getBoundingClientRect(); out.strip = { vis: r.height > 0, x0: r.left, x1: r.right, y0: r.top, y1: r.bottom }; }
        return out;
      }, IDS);
      // Laid out: every row that is shown is on screen, and no two (Credits included) overlap.
      const layout = (T, w, h) => {
        const all = Object.entries(T).filter(([, v]) => v && v.vis);
        const off = all.filter(([, v]) => !(v.x0 >= 0 && v.x1 <= w && v.y0 >= 0 && v.y1 <= h)).map(([k]) => k);
        let overlap = null;
        const boxes = all.filter(([k]) => !['tsNewMine', 'tsJourneyCap'].includes(k));
        for (let i = 0; i < boxes.length && !overlap; i++) for (let j = i + 1; j < boxes.length; j++) {
          const [ka, a] = boxes[i], [kb, c] = boxes[j];
          if (a.x0 < c.x1 - 1 && c.x0 < a.x1 - 1 && a.y0 < c.y1 - 1 && c.y0 < a.y1 - 1) { overlap = [ka, kb]; break; }
        }
        return { off, overlap };
      };
      // 1. 390x844, a Journey I save: every line, and the near goal PRICED IN THE MINE'S ECONOMY on a cold boot
      //    (M13 verify: it read the card game's ladder and wallet — '25 P, 25 P short' over 7 P). Read against
      //    the store's own Water tank tile and wallet, with 7 P (ready) and 3 P (2 short).
      for (const P of [7, 3]) {
        const b = await E.boot('', 390, 844, { before: prep({ clock: D25, save: Object.assign({}, SV, { minerals: P }) }) });
        const p = b.page;
        await p.waitForSelector('#tsDaily', { timeout: 20000 }).catch(() => {});
        await sleep(3000);
        const T = await readTitle(p);
        if (P === 7) {
          ok('the returning title carries Continue · Leg N, Daily dig, Store, the records line and the near-goal line',
             T.tsJourneyCap && /^Continue · Leg 2 of 8/.test(T.tsJourneyCap.t) && T.tsDaily && T.tsDaily.t === 'Daily dig · 25 Sep' && T.tsStore && T.tsStore.t === 'Store'
             && T.tsRecords && /deepest descent 40 m/.test(T.tsRecords.t) && T.tsGoal && /^Next: /.test(T.tsGoal.t) && T.tsDailySub && /best 64 m · streak 2/.test(T.tsDailySub.t),
             JSON.stringify(Object.fromEntries(Object.entries(T).map(([k, v]) => [k, v && v.t]))));
          const L = layout(T, 390, 844);
          ok('...all on screen at 390x844 and none overlapping', !L.off.length && !L.overlap, JSON.stringify(L));
          await shot(p, 'm13-title-390.png');
        }
        const goal = T.tsGoal && T.tsGoal.t;
        await p.click('#tsStore');
        await p.waitForSelector('[data-upg="water"]', { timeout: 10000 }).catch(() => {});
        await sleep(400);
        const st = await p.evaluate(() => { const bt = document.querySelector('[data-upg="water"]'), w = document.querySelector('#ssWallet');
          return { price: bt ? +(bt.querySelector('.ss-buyn') || {}).textContent : null, wallet: w ? parseInt(w.textContent.replace(/[^0-9]/g, ''), 10) : null }; });
        const want = st.price != null && st.wallet != null
          ? 'Next: Water tank \u2014 ' + st.price + ' P, ' + (st.wallet >= st.price ? 'ready to buy' : (st.price - st.wallet) + ' P short') : null;
        ok(`a cold-boot title's near goal quotes the store's price and the Phosphorus wallet (${P} P)`, want && goal === want && st.wallet === P,
           JSON.stringify({ title: goal, want, store: st }));
        ok(`no page errors (title, ${P} P)`, !b.errs.length, b.errs.slice(0, 2).join(' | '));
        await b.ctx.close();
      }
      // 2. Every size a store embeds or a phone holds, on the FULLEST returning save: a finished journey's
      //    badge, the daily played, the gap, the goal and a closed tab's banked note. The bottom block fits
      //    above Credits by tightening and then dropping its lowest rows; the banked note and the Daily Dig
      //    button are never dropped (M13 verify: at 1280x720 the goal printed under CREDITS, at 360x640 /
      //    320x568 the banked note did, and at 640x360 everything from the strip down was below the fold).
      const FULL = Object.assign({}, SV, { runsDone: 9, mineRuns: 9, mineBest: 70,
        mineJourney: { journey: 2, leg: 2, done: [1], past: { 1: { runs: 14, legs: {} } }, legs: { 1: { runs: 2, bestDepth: 30, bestEast: 96, landed: true }, 2: { runs: 3, bestDepth: 60, bestEast: 80 } } },
        minePending: { k1: { P: 13, mats: { anthracite: 2 }, depth: 30, digs: 5, at: D25 } } });
      for (const [w, h] of [[390, 844], [1280, 720], [360, 640], [320, 568], [640, 360], [844, 390]]) {
        const b = await E.boot('', w, h, { before: prep({ clock: D25, save: FULL }) });
        const p = b.page;
        await p.waitForSelector('#tsDaily', { timeout: 20000 }).catch(() => {});
        await sleep(2600);
        const T = await readTitle(p);
        const L = layout(T, w, h);
        const kept = T.tsBanked && T.tsBanked.vis && /spored \+13 P/.test(T.tsBanked.t) && T.tsDaily && T.tsDaily.vis && T.tsCredits && T.tsCredits.vis && T.tsJourneyBadge;
        ok(`${w}x${h}: the fullest returning title fits — nothing off screen, nothing overlapping (Credits included), banked note and Daily dig kept`,
           kept && !L.off.length && !L.overlap,
           JSON.stringify({ off: L.off, overlap: L.overlap, shown: Object.keys(T).filter((k) => T[k] && T[k].vis), banked: T.tsBanked && [T.tsBanked.y0, T.tsBanked.y1], credits: T.tsCredits && [T.tsCredits.y0, T.tsCredits.y1] }));
        if (w === 1280 || w === 640) await shot(p, `m13-title-${w}x${h}.png`);
        ok(`no page errors (title ${w}x${h})`, !b.errs.length, b.errs.slice(0, 2).join(' | '));
        await b.ctx.close();
      }
      // 3. A PHONE (touch, coarse pointer), M13 verify 2: the title's text links are 44 px tap targets (a 44 px box
      //    where the screen is tall; on a landscape phone a tap area grown toward the screen edge, hit-tested 10 px
      //    outside the box), nothing overlaps, and a dropped daily sub-line hands 'practice' to the button.
      for (const [w, h] of [[390, 844], [640, 360], [844, 390]]) {
        const ctx = await E.browser.newContext({ viewport: { width: w, height: h }, hasTouch: true, isMobile: true });
        const b = await E.boot('', w, h, { ctx, before: prep({ clock: D25, save: FULL }) });
        const p = b.page;
        await p.waitForSelector('#tsDaily', { timeout: 20000 }).catch(() => {});
        await sleep(2600);
        const T = await readTitle(p);
        const L = layout(T, w, h);
        const tap = await p.evaluate(() => { const hit = (id, dy) => { const e = document.getElementById(id); const r = e.getBoundingClientRect();
            const x = (r.left + r.right) / 2, y = dy < 0 ? r.top + dy : r.bottom + dy; const q = document.elementFromPoint(x, y); return { h: Math.round(r.height), hit: !!(q && (q === e || e.contains(q))) }; };
          return { store: hit('tsStore', -10), credits: hit('tsCredits', 10) }; });
        const tall = h > 420;
        const tapOk = tall ? tap.store.h >= 44 && tap.credits.h >= 44 : tap.store.hit && tap.credits.hit;
        const subGone = !(T.tsDailySub && T.tsDailySub.vis);
        const practiceOk = subGone ? /practice/.test(T.tsDaily && T.tsDaily.t) : !/practice/.test(T.tsDaily && T.tsDaily.t);
        ok(`${w}x${h} touch: Store and Credits are 44 px tap targets, nothing overlaps, and the 'practice' word survives the fit`,
           tapOk && !L.off.length && !L.overlap && practiceOk && T.tsDaily && T.tsDaily.vis,
           JSON.stringify({ tap, off: L.off, overlap: L.overlap, subGone, daily: T.tsDaily && T.tsDaily.t }));
        ok(`no page errors (title ${w}x${h} touch)`, !b.errs.length, b.errs.slice(0, 2).join(' | '));
        await ctx.close();
      }
    }

    // ------------------------------------------------------------------ tabs
    // THE DAILY DIG ACROSS TABS (M13 verify), one context = one profile.
    //  (a) two tabs both start the 25th's paid run; A banks it; B goes hidden (its pending record says P > 0)
    //      and is closed; the next boot banks B's record as PRACTICE — 0 P (it paid 2 on the M13 build).
    //  (b) a paid run partly banked by another page's boot keeps the rest of its pay and stays paid.
    //  (c) a paid run from an older UTC day that banks after the next day's paid run is paid, leaves today's
    //      record in place and bridges the streak (fresh profile, two tabs across midnight).
    //  (d) a daily hidden before its first dig, banked empty by a boot, then the day paid elsewhere: one paid run.
    if (want('tabs')) {
      console.log('--- the Daily Dig across tabs');
      const ctx = await E.browser.newContext({ viewport: { width: 390, height: 844 } });
      const open = async (opts) => {
        const b = await E.boot('', 390, 844, Object.assign({ ctx, before: prep({ clock: D25, save: LANDED }) }, opts || {}));
        await b.page.waitForSelector('#tsDaily', { timeout: 20000 }).catch(() => {});
        await sleep(2200);
        return b;
      };
      const startDaily = async (p) => { await p.click('#tsDaily'); return waitRun(p, 's.config.mine.daily'); };
      // (a)
      const A = await open(), B = await open();
      await startDaily(A.page); await startDaily(B.page);
      const pr = await Promise.all([A.page, B.page].map((p) => p.evaluate(() => window.__game.state.config.mine.daily.practice)));
      await digDown(A.page, 24);
      const rA = await endRun(A.page);
      const s1 = await save(A.page);
      await digDown(B.page, 24);
      const pendB = await B.page.evaluate(() => { window.__game.mine.pendingWrite(); const sv = JSON.parse(localStorage.getItem('mycelium.progress.v2'));
        return Object.values(sv.minePending || {}).map((r) => ({ P: r.P, daily: r.daily })); });
      await B.page.close();
      const C = await open();
      const s2 = await save(C.page);
      const note = await C.page.evaluate(() => (document.getElementById('tsBanked') || {}).textContent || '');
      ok('(a) both tabs started the paid run, A banked it, and B\'s closed-tab record (P > 0) banks 0 at the next boot',
         pr[0] === false && pr[1] === false && rA.daily && !rA.daily.practice && pendB.length === 1 && pendB[0].P > 0 && !pendB[0].daily.practice
         && (s2.minerals | 0) === (s1.minerals | 0) && !s2.minePending && s2.mineDaily.paid === '20260925' && !/spored \+\d+ P/.test(note),
         JSON.stringify({ practiceAtStart: pr, A: rA.ore, minerals: [s1.minerals, s2.minerals], pendB, note, daily: s2.mineDaily }));
      await A.page.close(); await C.page.close();
      // (b) a fresh day (the 26th) on the same profile: A starts the paid run and digs; its pending record is
      //     banked by a boot elsewhere (setting the day's paid flag); A digs on and ends — still paid, paid the rest.
      await ctx.addInitScript(() => { window.__dayOff = 86400000; });
      const A2 = await open();
      await startDaily(A2.page);
      const day2 = await A2.page.evaluate(() => window.__game.state.config.mine.daily);
      await digDown(A2.page, 20);
      const pend2 = await A2.page.evaluate(() => { window.__game.mine.pendingWrite(); const sv = JSON.parse(localStorage.getItem('mycelium.progress.v2'));
        return { min: sv.minerals | 0, recs: Object.values(sv.minePending || {}).map((r) => r.P) }; });
      const B2 = await open();
      const sB = await save(B2.page);
      await B2.page.close();
      await digDown(A2.page, 44);
      const rA2 = await endRun(A2.page);
      const sA = await save(A2.page);
      ok('(b) a paid daily partly banked by another page\'s boot stays paid and banks the rest (the boot\'s share + the rest = its ore)',
         day2 && day2.date === '20260926' && !day2.practice && sB.mineDaily.paid === '20260926' && rA2.daily && !rA2.daily.practice
         && (sA.minerals | 0) - pend2.min === (rA2.ore | 0) && (rA2.ore | 0) > (pend2.recs[0] | 0) && (pend2.recs[0] | 0) > 0,
         JSON.stringify({ day2, bootBanked: (sB.minerals | 0) - pend2.min, ore: rA2.ore, total: (sA.minerals | 0) - pend2.min, practice: rA2.daily && rA2.daily.practice }));
      await A2.page.close();
      // (c) TWO TABS ACROSS MIDNIGHT, on a FRESH profile (M13 verify 2): a run started on the 25th (paid —
      //     the 25th was never paid on this profile) is still open when another tab plays the 26th's paid run;
      //     the 25th's run then banks. It is PAID (it was that day's first), both days are in paidDays, the
      //     26th keeps lastDate / paid, the streak bridges 25 -> 26 (2, not 1), and the panel names its own day.
      //     The old (c) reused the profile from (a), so its 25th run started as practice and never reached the
      //     paid older-day path at all.
      const ctxC = await E.browser.newContext({ viewport: { width: 390, height: 844 } });
      const openC = async () => { const b = await E.boot('', 390, 844, { ctx: ctxC, before: prep({ clock: D25, save: LANDED }) });
        await b.page.waitForSelector('#tsDaily', { timeout: 20000 }).catch(() => {}); await sleep(2200); return b; };
      const A3 = await openC();
      await startDaily(A3.page);
      const d3 = await A3.page.evaluate(() => window.__game.state.config.mine.daily);
      await digDown(A3.page, 20);
      await ctxC.addInitScript(() => { window.__dayOff = 86400000; });
      const B3 = await openC();
      await startDaily(B3.page);
      const d3b = await B3.page.evaluate(() => window.__game.state.config.mine.daily);
      await digDown(B3.page, 20);
      const rB3 = await endRun(B3.page);
      const mid = await save(B3.page);
      await A3.page.evaluate(() => { window.__dayOff = 0; });
      const rA3 = await endRun(A3.page);
      const after = await save(A3.page);
      const m1 = after.mineDaily || {};
      const panel = await A3.page.evaluate(() => (document.getElementById('ssDailyStats') || {}).textContent || '');
      ok('(c) a paid 25th run banking after the 26th\'s paid run is paid, both days are paid, the 26th keeps lastDate/paid, the streak bridges to 2',
         d3 && d3.date === '20260925' && !d3.practice && d3b && d3b.date === '20260926' && !d3b.practice && rB3.daily && !rB3.daily.practice
         && rA3.daily && !rA3.daily.practice && (rA3.ore | 0) > 0 && (after.minerals | 0) - (mid.minerals | 0) === (rA3.ore | 0)
         && Array.isArray(m1.paidDays) && m1.paidDays.includes('20260925') && m1.paidDays.includes('20260926')
         && m1.lastDate === '20260926' && m1.paid === '20260926' && m1.date === '20260926' && (m1.streak | 0) === 2,
         JSON.stringify({ d3, d3b, A: { ore: rA3.ore, practice: rA3.daily && rA3.daily.practice }, minerals: [mid.minerals, after.minerals], mid: mid.mineDaily, after: m1 }));
      ok("...and its end-screen panel names its own day ('25 Sep: N m'), not 'Today's best'",
         /25 Sep/.test(panel) && !/Today/.test(panel), JSON.stringify(panel));
      await ctxC.close();
      // (d) HIDDEN BEFORE THE FIRST DIG (M13 verify 2): tab A starts the paid daily and its pending record is
      //     written at 0 digs; a boot elsewhere banks that empty record; tab C then plays the day's paid run; A digs
      //     and ends. Exactly ONE paid run and ONE board submission for the day, and both descents counted
      //     (mineRuns 4 -> 6). On the first verify build the boot left a 'paid' marker without claiming the day,
      //     so C and A were both paid (2 POSTs) and A's descent went uncounted.
      const ctxD = await E.browser.newContext({ viewport: { width: 390, height: 844 } });
      const postsD = [];
      await ctxD.route('https://board.test/**', (rt) => {
        const u = rt.request().url(), m = rt.request().method();
        if (m === 'POST' && u.includes('/rest/v1/scores')) { postsD.push(rt.request().postData() || ''); return rt.fulfill({ status: 201, body: '' }); }
        if (m === 'POST') return rt.fulfill({ status: 201, body: '' });
        if (u.includes('/rest/v1/mine_daily')) return rt.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
        return rt.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
      });
      const openD = async () => { const b = await E.boot('', 390, 844, { ctx: ctxD, supabase: { url: 'https://board.test', anonKey: 'k' }, before: prep({ clock: D25, save: LANDED }) });
        await b.page.waitForSelector('#tsDaily', { timeout: 20000 }).catch(() => {}); await sleep(2200); return b; };
      const A4 = await openD();
      await startDaily(A4.page);
      const pend4 = await A4.page.evaluate(() => { window.__game.mine.pendingWrite(); const sv = JSON.parse(localStorage.getItem('mycelium.progress.v2'));
        return Object.values(sv.minePending || {}).map((r) => ({ P: r.P, digs: r.digs, daily: r.daily })); });
      const C4 = await openD();
      const sBoot = await save(C4.page);
      await startDaily(C4.page);
      const dC = await C4.page.evaluate(() => window.__game.state.config.mine.daily);
      await digDown(C4.page, 24);
      const rC4 = await endRun(C4.page);
      const sC = await save(C4.page);
      await digDown(A4.page, 24);
      const rA4 = await endRun(A4.page);
      await sleep(1500);
      const sA4 = await save(A4.page);
      const tagA = await A4.page.evaluate(() => (document.getElementById('ssDailyTag') || {}).textContent || '');
      const paidRuns = [rC4, rA4].filter((r) => r.daily && !r.daily.practice).length;
      ok('(d) a daily hidden before its first dig: the boot leaves no marker and claims no day, C is paid, A banks as practice',
         pend4.length === 1 && (pend4[0].digs | 0) === 0 && !pend4[0].daily.practice && !(sBoot.mineTaken && Object.keys(sBoot.mineTaken).length)
         && !(sBoot.mineDaily && sBoot.mineDaily.paid) && dC && !dC.practice && rC4.daily && !rC4.daily.practice
         && rA4.daily && rA4.daily.practice && (sA4.minerals | 0) === (sC.minerals | 0) && paidRuns === 1 && /practice/.test(tagA),
         JSON.stringify({ pend4, taken: sBoot.mineTaken, dailyAtBoot: sBoot.mineDaily, C: { ore: rC4.ore, practice: dC && dC.practice }, A: { ore: rA4.ore, practice: rA4.daily && rA4.daily.practice }, minerals: [sBoot.minerals, sC.minerals, sA4.minerals], tagA }));
      ok('...exactly one board submission for the day, and both descents counted (mineRuns 4 -> 6)',
         postsD.length === 1 && (sA4.mineRuns | 0) === 6, JSON.stringify({ posts: postsD.length, mineRuns: [LANDED.mineRuns, sC.mineRuns, sA4.mineRuns] }));
      await ctxD.close();
      ok('no page errors (tabs)', ![A, B, C, A2, B2, A3, B3, A4, C4].some((x) => x.errs.length), [A, B, C, A2, B2, A3, B3, A4, C4].map((x) => x.errs).flat().slice(0, 2).join(' | '));
      await ctx.close();
    }
  } catch (e) { fail++; console.log('  FAIL  harness error: ' + (e && e.stack || e)); }
  await E.close();
  console.log(`\n==== ${pass} passed, ${fail} failed ====`);
  process.exit(fail ? 1 : 0);
})();
