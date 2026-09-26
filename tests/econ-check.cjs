/* EVERY RUN PAYS, EVERY STORE VISIT BUYS — the finishing plan's M5, acceptance 5-9, as assertions.
 * (Acceptance 1-4 are bot runs: `node tests/bots/econ.cjs run1|career|diver`.)
 *
 *   reach    depth pays 1 P per 5 m (running max), floored at 5 when banked; the HUD counts the raw
 *            figure and pops '+1 P' at the tip; FRUIT NOW / the bank read `bankable`.
 *   reveal   a fresh save's first store shows exactly Water tank and Grow strength (Water highlighted);
 *            a scripted 45 m dive reveals Heat tolerance with NEW (for one visit); a worm attach
 *            reveals Mucus flasks.
 *   heat     tolerance maxed: lines [98, 140], price 8 at 150 m, 4 at 120 m, 2 at 90 m; bare is
 *            [42, 84, 126]; the store note says so in words.
 *   migrate  a v1 ledger (water 4, oreYield 3, pocketWater 2, heatTolerance 2, excreteCharges 1) loads
 *            with p.mineUpgrades {} and minerals up by exactly 345, material rungs refunded in their
 *            material, a toast on the title; a reload adds nothing.
 *   rich     3 seeds x 6 chunks: 20-30% of deep seams rich; a rich seam pays 6 (control: 2); the
 *            '#mine,4242' chunk records 8-12 are identical to a pre-M5 snapshot (tests/fixtures).
 *   end      the end screen's Depth / Phosphorus seams / material rows and the records line; Buy then
 *            Descend reaches a live run in 2 clicks.
 *   title    the Upgrades button: shown for a bought rung with an empty wallet, hidden on a bare save.
 *
 * `ECON_ONLY=reach,reveal,...` runs a subset.
 */
const path = require('path'), fs = require('fs');
const H = require('./mine-harness.cjs');
const { sleep } = H;
let pass = 0, fail = 0;
const ok = (n, c, x) => { c ? (pass++, console.log('  PASS  ' + n + (x ? '  — ' + x : ''))) : (fail++, console.log('  FAIL  ' + n + (x ? '  — ' + x : ''))); };
const ART = path.join(H.ROOT, 'tests', '.artifacts');
fs.mkdirSync(ART, { recursive: true });
const ONLY = (process.env.ECON_ONLY || '').split(',').filter(Boolean);
const want = (k) => !ONLY.length || ONLY.includes(k);
const QUIET = () => {
  const s = window.__game.state;
  s.nematodes.length = 0; s.clouds.length = 0;
  s.config.nematodes.respawnChance = 0; s.config.trichoderma.respawnChance = 0;
  if (s.config.mine.worms) s.config.mine.worms.waterPerSec = 0;
};
const Q = QUIET.toString();
const tiles = (page) => page.evaluate(() => Array.from(document.querySelectorAll('#ssUpg .ss-upg')).map((t) => ({
  id: t.dataset.track, isNew: !!t.querySelector('.ss-upg-new'), hl: t.classList.contains('ss-upg-hl') })));
const openStore = async (page) => {
  // One store at a time: a second showPicker over an open one would stack two screens.
  await page.evaluate(() => { for (const e of document.querySelectorAll('#speciesSelect')) e.remove(); window.__menu.showPicker(); });
  await page.waitForSelector('#speciesSelect.ss-mine', { timeout: 20000 }).catch(() => {});
  await sleep(700);
};

(async () => {
  const E = await H.start();
  try {
    // ======================================================================================
    if (want('reach')) {
      console.log('--- depth pays');
      const b = await E.bootMine(4242);
      const r = await b.page.evaluate(async (Q) => {
        new Function('return (' + Q + ')')()();
        const g = window.__game, s = g.state;
        const at0 = { raw: g.mine.reachRaw(), reach: g.mine.reach(), bank: g.mine.bankable(),
                      hud: document.getElementById('hud-phosphorus').textContent };
        s.active.water = 100000;
        const seen = new Set();
        const watch = setInterval(() => { for (const f of g.mine.floaters()) if (/^\+\d+ P$/.test(f.text)) seen.add(f.text); }, 60);
        await window.__navDig({ targetM: 24, maxIters: 200 });
        await new Promise((res) => setTimeout(res, 800));
        clearInterval(watch);
        const d = g.mine.maxDepth();
        s.mineOre = 6;               // two P seams' worth, so the split is visible
        await new Promise((res) => setTimeout(res, 700));
        return { at0, d, raw: g.mine.reachRaw(), reach: g.mine.reach(), bank: g.mine.bankable(),
                 quit: g.mine.reach('quit'), abandon: g.mine.reach('abandon'), pending: g.mine.bankable('pending'),
                 hud: +document.getElementById('hud-phosphorus').textContent, floaters: [...seen],
                 ticks: (window.__sfx && window.__sfx.counts.reach) | 0 };
      }, Q);
      // M5 verifier fix: was `reach === 5 && bank === 5` at the surface. The floor is paid only for a
      // descent that dug and ran its course, so a colony that has not dug banks nothing.
      ok('at the surface, before any dig: nothing raw and nothing to bank (no floor without a dig)', r.at0.raw === 0 && r.at0.reach === 0 && r.at0.bank === 0, JSON.stringify(r.at0));
      ok(`at ${r.d} m the raw reach is floor(depth / 5)`, r.d >= 20 && r.raw === Math.floor(r.d / 5), `raw ${r.raw} at ${r.d} m`);
      ok('...and the HUD counts seams + raw reach', r.hud === 6 + r.raw, `HUD ${r.hud} = 6 + ${r.raw}`);
      ok('...what ends now banks max(5, reach) + seams', r.reach === Math.max(5, r.raw) && r.bank === r.reach + 6, `bank ${r.bank} = ${r.reach} + 6`);
      ok('...but a voluntary exit (End descent, Exit to title, a hidden tab) banks the RAW reach', r.quit === r.raw && r.abandon === r.raw && r.pending === r.raw + 6,
         `quit ${r.quit}, abandon ${r.abandon}, pending ${r.pending} (raw ${r.raw})`);
      ok("'+1 P' popped at the tip as depth paid", r.floaters.includes('+1 P'), r.floaters.join(' ') || 'none');
      ok('no page errors', b.errs.length === 0, b.errs.slice(0, 2).join(' | ') || 'clean');
      await b.ctx.close();
    }

    // ======================================================================================
    // NO FARMING (M5 verifier fix). The 5 P floor was paid for every ending, so a fresh save banked
    // 5 P a loop from 'Descend -> gear -> End descent' with no dig at all (~130 P a minute against
    // 24-42 P for a real minute). Played through the real buttons on the release flag.
    if (want('farm')) {
      console.log('--- no zero-dig farming');
      const b = await E.boot('', 390, 844, { file: '/index-nodev.html' });
      await H.waitMine(b.page);
      const prog = () => b.page.evaluate(() => JSON.parse(localStorage.getItem('mycelium.progress.v2') || '{}'));
      const live = () => b.page.waitForFunction(() => { const s = window.__game && window.__game.state;
        return !!(s && s.substrate && s.substrate.mine && !s.runOver && s.substrate._rockSolidified && !document.getElementById('ssMineEnd')); }, null, { timeout: 60000 });
      const endVia = async (id) => {
        await b.page.click('#gearbtn'); await sleep(250);
        await b.page.click('#' + id);
      };
      const quiet = () => b.page.evaluate((Q) => { new Function('return (' + Q + ')')()(); }, Q);
      const loops = [];
      for (let i = 0; i < 3; i++) {
        await live(); await sleep(300);
        await endVia('set-forcefruit');
        await b.page.waitForSelector('#ssMineDescend', { timeout: 20000 });
        await sleep(300);
        loops.push(await b.page.evaluate(() => ({ P: window.__game.store.balance(), ore: (window.__game.state.runResult || {}).ore,
          cause: (window.__game.state.runResult || {}).cause, digs: window.__game.state.mineDigs | 0 })));
        await b.page.click('#ssMineDescend');
      }
      const p0 = await prog();
      ok('three zero-dig End descents bank nothing (was +5 P each)', loops.every((x) => x.ore === 0 && x.cause === 'abandon' && x.digs === 0) && loops[2].P === 0,
         JSON.stringify(loops));
      ok('...and count as no descent (p.mineRuns)', !(p0.mineRuns > 0), String(p0.mineRuns));
      // Two digs, then End descent: the raw reach, not the floor.
      await live(); await quiet();
      const two = await b.page.evaluate(async () => {
        const g = window.__game;
        for (let i = 0; i < 2; i++) { g.mine.grow(0, 1); await new Promise((r) => setTimeout(r, 400)); }
        for (let i = 0; i < 60 && g.mine.revealing(); i++) await new Promise((r) => setTimeout(r, 100));
        await new Promise((r) => setTimeout(r, 400));
        return { digs: g.state.mineDigs | 0, raw: g.mine.reachRaw(), seams: g.mine.ore(), P: g.store.balance() };
      });
      await endVia('set-forcefruit');
      await b.page.waitForSelector('#ssMineDescend', { timeout: 20000 });
      await sleep(300);
      const r2 = await b.page.evaluate(() => ({ ore: window.__game.state.runResult.ore, P: window.__game.store.balance() }));
      ok(`End descent after ${two.digs} digs banks the raw reach + seams (${two.raw} + ${two.seams}), not the 5 P floor`,
         two.digs === 2 && two.raw < 5 && r2.ore === two.raw + two.seams && r2.P - two.P === r2.ore, `${JSON.stringify(two)} -> ${JSON.stringify(r2)}`);
      await b.page.click('#ssMineDescend');
      // A live run's pending record (a hidden tab) at 0 digs is worth nothing either.
      await live(); await quiet();
      const pend = await b.page.evaluate(() => { const g = window.__game; g.mine.pendingWrite();
        const m = JSON.parse(localStorage.getItem('mycelium.progress.v2') || '{}').minePending || {};
        const rec = Object.values(m)[0] || null;
        const p = JSON.parse(localStorage.getItem('mycelium.progress.v2')); delete p.minePending; localStorage.setItem('mycelium.progress.v2', JSON.stringify(p));
        return rec; });
      ok('a hidden tab at 0 digs records P 0', pend && pend.P === 0 && pend.digs === 0, JSON.stringify(pend));
      // THE CONTROL: the floor is still paid for a descent that ran its course — a few digs, then dry.
      const dry = await b.page.evaluate(async () => {
        const g = window.__game, s = g.state;
        for (let i = 0; i < 3; i++) { g.mine.grow(0, 1); await new Promise((r) => setTimeout(r, 400)); }
        for (let i = 0; i < 60 && g.mine.revealing(); i++) await new Promise((r) => setTimeout(r, 100));
        { const T = s._tappedWater || (s._tappedWater = new Set()); for (const q of (s.substrate.reservoirs || [])) T.add(q.id); }
        const raw = g.mine.reachRaw(), seams = g.mine.ore(), P = g.store.balance();
        s.active.water = 0;
        for (let i = 0; i < 80 && !s.runOver; i++) await new Promise((r) => setTimeout(r, 100));
        return { raw, seams, P, over: s.runOver, cause: s.runResult && s.runResult.cause, ore: s.runResult && s.runResult.ore };
      });
      await b.page.waitForSelector('#ssMineDescend', { timeout: 20000 }).catch(() => {});
      await sleep(400);
      const pd = await prog();
      ok('...while a descent that dug and ran dry still banks the 5 P floor (control)', dry.cause === 'dry' && dry.ore === Math.max(5, dry.raw) + dry.seams && (pd.minerals | 0) - dry.P === dry.ore,
         `${JSON.stringify(dry)}, wallet ${dry.P} -> ${pd.minerals | 0}`);
      ok('...and the two descents that dug are the only ones counted', pd.mineRuns === 2, String(pd.mineRuns));
      // Exit to title at 0 digs: nothing banked, nothing announced.
      await b.page.click('#ssMineDescend');
      await live(); await sleep(300);
      const pq = (await prog()).minerals | 0;
      await endVia('set-saveexit');
      await b.page.waitForSelector('#titleScreen', { timeout: 20000 }).catch(() => {});
      await sleep(1500);
      const t = await b.page.evaluate(() => ({ note: (document.getElementById('tsBanked') || {}).textContent || null,
        P: JSON.parse(localStorage.getItem('mycelium.progress.v2') || '{}').minerals | 0 }));
      ok('Exit to title at 0 digs banks nothing and says nothing', t.P === pq && !t.note, JSON.stringify(t));
      ok('no page errors', b.errs.length === 0, b.errs.slice(0, 2).join(' | ') || 'clean');
      await b.ctx.close();
    }

    // ======================================================================================
    if (want('reveal')) {
      // THE REAL FIRST STORE (M5 verifier fix). The old block opened the store BEFORE any run
      // (credit(5) + showPicker), a screen no new player can reach: the first visit skips the title,
      // the title's Upgrades button is hidden at 0 P, so the first store comes after run 1 — and on
      // 60 water run 1 passes 42 m on essentially every seed, which put Heat tolerance on it (12/12).
      // Now: the release flag, a fresh save, run 1 dives past the line and runs dry by itself, and
      // the store is reached from its end screen. Then runs 2 and 3 on the same save.
      console.log('--- the progressive store');
      const b = await E.boot('', 390, 844, { file: '/index-nodev.html' });
      await H.waitMine(b.page);
      await H.injectNav(b.page);
      const prog = () => b.page.evaluate(() => JSON.parse(localStorage.getItem('mycelium.progress.v2') || '{}'));
      const card = () => b.page.evaluate(() => { const e = document.getElementById('ssMineGoal');
        return { goal: e && e.dataset.goal, text: e ? e.innerText.replace(/\s+/g, ' ').trim() : '', buy: !!document.getElementById('ssMineBuy') }; });
      const fmt = (t) => t.map((x) => x.id + (x.isNew ? '*' : '') + (x.hl ? '^' : '')).join(',');
      const toStore = async () => { await b.page.click('#ssMineDone');
        await b.page.waitForSelector('#speciesSelect.ss-mine', { timeout: 20000 }).catch(() => {}); await sleep(700); };
      const descendFromStore = async () => { await b.page.click('#ssDescend');
        await b.page.waitForFunction(() => { const s = window.__game.state; return s && s.substrate && s.substrate.mine && !s.runOver && s.substrate._fineSolid && !document.getElementById('speciesSelect'); }, null, { timeout: 40000 });
        await sleep(1500); };
      await b.page.evaluate(() => { window.__upg = []; window.__telemetry.tap((row) => { if (row.kind === 'upgrade') window.__upg.push({ detail: row.detail, n: row.n }); }); });
      // RUN 1: a dive past 42 m, then the tank runs out and the run ends by itself.
      const r1 = await b.page.evaluate(async (Q) => {
        new Function('return (' + Q + ')')()();
        const g = window.__game, s = g.state;
        const water0 = s.active.water;
        s.active.water = 100000;
        await window.__navDig({ targetM: 46, maxIters: 400 });
        for (let i = 0; i < 60 && g.mine.revealing(); i++) await new Promise((r) => setTimeout(r, 100));
        await new Promise((r) => setTimeout(r, 800));
        { const T = s._tappedWater || (s._tappedWater = new Set()); for (const q of (s.substrate.reservoirs || [])) T.add(q.id); }
        const mid = g.store.seen();
        s.active.water = 0;
        for (let i = 0; i < 100 && !s.runOver; i++) await new Promise((r) => setTimeout(r, 100));
        return { water0, depth: g.mine.maxDepth(), line42: !!mid.line42, cause: s.runResult && s.runResult.cause, ore: s.runResult && s.runResult.ore,
                 seams: s.runResult && s.runResult.seamCount };
      }, Q);
      await b.page.waitForSelector('#ssMineEnd', { timeout: 20000 }).catch(() => {});
      await sleep(900);
      const e1 = await b.page.evaluate(() => {
        const r = document.getElementById('ssMineEnd');
        const ui = document.getElementById('ui');
        return { rows: Array.from(r.querySelectorAll('.ss-me-row')).map((x) => x.innerText.replace(/\s+/g, ' ').trim()),
                 hud: ui ? getComputedStyle(ui).visibility : 'none', p: JSON.parse(localStorage.getItem('mycelium.progress.v2') || '{}') };
      });
      ok(`run 1 (fresh save, release flag, ${r1.water0} water) dives to ${r1.depth} m past the line and runs dry by itself`,
         r1.water0 === 60 && r1.depth > 42 && r1.line42 && r1.cause === 'dry' && e1.p.mineRuns === 1, JSON.stringify({ r1, runs: e1.p.mineRuns }));
      ok("...its end screen has a 'Phosphorus seams' row even unforced (×N, or ×0 +0)", e1.rows.some((x) => /^Phosphorus seams ×\d+ \+\d+/.test(x)), e1.rows.join(' | '));
      ok('...and the run\'s HUD is not drawn over the end screen', e1.hud === 'hidden', e1.hud);
      const c1 = await card();
      ok("...the next-goal card is Water tank at 5 P with a Buy (not Heat tolerance, not Grow strength)",
         c1.goal === 'water' && /Water tank/.test(c1.text) && /\b5 P\b/.test(c1.text) && c1.buy && !/NEW/i.test(c1.text), `${c1.goal}: ${c1.text}`);
      await toStore();
      const t = await tiles(b.page);
      ok("the first store (after run 1) shows exactly Water tank and Grow strength, though run 1 crossed 42 m", fmt(t).replace(/[*^]/g, '') === 'water,growSteps', fmt(t));
      ok('...Water tank highlighted (the next goal), no NEW badges', t[0] && t[0].hl && !t[1].hl && !t.some((x) => x.isNew), JSON.stringify(t));
      const nm = await b.page.evaluate(() => { const e = document.querySelector('.ss-upg[data-track="water"] .ss-upg-nm'); return e ? e.textContent : ''; });
      ok("...named 'Water tank' in the mine", nm === 'Water tank', nm);
      const w0 = await b.page.evaluate(() => window.__game.store.balance());
      await b.page.click('.ss-upg[data-track="water"] .ss-upg-btn');
      await sleep(300);
      const lv = await b.page.evaluate(() => ({ lv: window.__game.store.level('water'), P: window.__game.store.balance(), start: window.__game.store.start().water }));
      ok('...and 5 P buys Water I: +12 water (60 -> 72)', lv.lv === 1 && w0 - lv.P === 5 && lv.start === 72, JSON.stringify(Object.assign({ was: w0 }, lv)));
      ok('...and a revealed-by-the-world track stays hidden to the buy hook too', await b.page.evaluate(() => {
        const S = window.__game.store; return S.inGame('heatTolerance', 'mine') === false && S.buy('heatTolerance').ok === false; }), 'refused');
      // RUN 2: what run 1 met (the line) now appears, NEW.
      await descendFromStore();
      await b.page.evaluate(async (Q) => { new Function('return (' + Q + ')')()();
        const g = window.__game; g.mine.grow(0, 1); await new Promise((r) => setTimeout(r, 500));
        // Enough that every revealed rung is affordable, so the card's pick is the priority's first.
        g.store.credit(40); g.mine.end(); }, Q);
      await b.page.waitForSelector('#ssMineEnd', { timeout: 20000 }).catch(() => {});
      await sleep(900);
      const c2 = await card();
      ok("after run 2 the end screen's next goal is Heat tolerance, marked NEW", c2.goal === 'heatTolerance' && /NEW/i.test(c2.text), `${c2.goal}: ${c2.text}`);
      await toStore();
      const t1 = await tiles(b.page);
      const heat = t1.find((x) => x.id === 'heatTolerance');
      ok('...and the store shows it with NEW, highlighted as the next goal', !!heat && heat.isNew && heat.hl && t1.filter((x) => x.hl).length === 1, fmt(t1));
      ok('...but not Mucus flasks, before any worm has attached', !t1.some((x) => x.id === 'excreteCharges'), fmt(t1));
      await b.page.screenshot({ path: path.join(ART, 'm5-store-new-390.png') });
      // RUN 3, straight from that store visit: a worm attaches. Heat tolerance (shown, unbought,
      // affordable) must NOT come back NEW on the card — the stale-NEW defect: the visit counter only
      // moves when the store next opens, so the card read "shown on this visit" as still true and put
      // Heat tolerance, NEW again, ahead of the genuinely new tile.
      await descendFromStore();
      const w = await b.page.evaluate(async () => {
        const g = window.__game, s = g.state;
        s.config.nematodes.respawnChance = 0;
        let tip = null; for (const n of s.active.nodes) if (!n.infected && (!tip || n.y > tip.y)) tip = n;
        g.mine.spawnWorm(tip.x, tip.y);
        let att = 0;
        for (let i = 0; i < 80 && !(att = g.mine.attached()); i++) await new Promise((res) => setTimeout(res, 100));
        await new Promise((res) => setTimeout(res, 500));
        const seen = g.store.seen();
        g.store.credit(60);
        g.mine.end();
        return { att, worm: !!seen.worm };
      });
      ok('a worm attaches and the save records it (p.mineSeen.worm)', w.att > 0 && w.worm, JSON.stringify(w));
      await b.page.waitForSelector('#ssMineEnd', { timeout: 20000 }).catch(() => {});
      await sleep(900);
      const c3 = await card();
      ok('...the card offers Mucus flasks NEW, not the already-shown Heat tolerance', c3.goal === 'excreteCharges' && /NEW/i.test(c3.text), `${c3.goal}: ${c3.text}`);
      // Bought from the card: the store must not badge a bought track NEW.
      await b.page.click('#ssMineBuy'); await sleep(300);
      await toStore();
      const t3 = await tiles(b.page);
      const fl = t3.find((x) => x.id === 'excreteCharges');
      const bought = await b.page.evaluate(() => window.__game.store.level('excreteCharges'));
      ok('...and once bought there, the store shows Mucus flasks without NEW', bought === 1 && !!fl && !fl.isNew, `level ${bought}; ${fmt(t3)}`);
      const heat3 = t3.find((x) => x.id === 'heatTolerance');
      ok('NEW lasts one visit: this visit shows Heat tolerance without it', !!heat3 && !heat3.isNew, fmt(t3));
      ok('...and a hidden track cannot be bought through the hook either', await b.page.evaluate(() => {
        const S = window.__game.store; S.credit(1000); return S.inGame('amputateCharges', 'mine') === false && S.buy('amputateCharges').ok === false; }), 'refused');
      // TELEMETRY: an `upgrade` row's `n` is the PHOSPHORUS spent (M5 verifier fix) — a rung priced in
      // a deep material sends 0, or '30 Anthracite' is netted as 30 P by the analytics page (and the
      // store tile used to send the cost object itself).
      await b.page.evaluate(() => { const S = window.__game.store; for (let i = 0; i < 4; i++) S.buy('water'); S.creditMat('anthracite', 30); });
      await openStore(b.page);
      const nextW = await b.page.evaluate(() => window.__game.store.nextCost('water'));
      await b.page.click('.ss-upg[data-track="water"] .ss-upg-btn'); await sleep(300);
      const upg = await b.page.evaluate(() => window.__upg);
      const byId = (id) => upg.filter((u) => u.detail === id).map((u) => u.n);
      ok("telemetry: a P rung logs the P spent (Water I 5 via the tile, Mucus flasks I 10 via the card); a material rung logs 0",
         JSON.stringify(nextW) === JSON.stringify({ m: 'anthracite', n: 30 }) && byId('water').join(',') === '5,0' && byId('excreteCharges').join(',') === '10',
         JSON.stringify({ nextW, upg }));
      ok('no page errors', b.errs.length === 0, b.errs.slice(0, 2).join(' | ') || 'clean');
      await b.ctx.close();
    }

    // ======================================================================================
    if (want('heat')) {
      console.log('--- heat tolerance, maxed');
      const b = await E.bootMine(4242);
      const h = await b.page.evaluate(async () => {
        const g = window.__game, st = g.store;
        const bare = { lines: g.mine.heatLines(), words: st.heatWords() };
        st.credit(1000); st.revealAll();
        let n = 0;
        for (let i = 0; i < 6; i++) {
          const c = st.nextCost('heatTolerance'); if (c == null) break;
          if (typeof c === 'object') st.creditMat(c.m, c.n);
          if (st.buy('heatTolerance').ok) n++;
        }
        g.mine.playSeed(4242);
        for (let i = 0; i < 120 && !(g.state.substrate && g.state.substrate._fineSolid); i++) await new Promise((r) => setTimeout(r, 100));
        return { bare, n, lines: g.mine.heatLines(), c150: g.mine.cost(150), c120: g.mine.cost(120), c90: g.mine.cost(90),
                 c98: g.mine.cost(98), c140: g.mine.cost(140), c168: g.mine.cost(168), words: st.heatWords(), max: st.nextCost('heatTolerance') };
      });
      ok('bare: lines at 42 / 84 / 126 m, and the note says 2, then 4 / 8 / 16', h.bare.lines.join(',') === '42,84,126'
         && h.bare.words === 'digs cost 2, then 4 / 8 / 16 past 42 / 84 / 126 m', `${h.bare.lines} | ${h.bare.words}`);
      ok('the track is 4 rungs and maxes out', h.n === 4 && h.max === null, `${h.n} bought, next ${JSON.stringify(h.max)}`);
      ok('maxed: mineHeatLines returns [98, 140]', h.lines.join(',') === '98,140', JSON.stringify(h.lines));
      ok('maxed: a dig costs 8 at 150 m, 4 at 120 m, 2 at 90 m', h.c150 === 8 && h.c120 === 4 && h.c90 === 2, `${h.c150} / ${h.c120} / ${h.c90}`);
      ok('...standing on a line is the cheap side, and the floor never reaches x16', h.c98 === 2 && h.c140 === 4 && h.c168 === 8, `${h.c98} / ${h.c140} / ${h.c168}`);
      ok('...and the store note says 2, then 4 / 8 past 98 / 140 m', h.words === 'digs cost 2, then 4 / 8 past 98 / 140 m', h.words);
      await b.ctx.close();
    }

    // ======================================================================================
    if (want('migrate')) {
      console.log('--- the shelf v2 migration');
      const seed = (led, extra) => async (page) => page.addInitScript(({ led, extra }) => {
        try { if (!localStorage.getItem('mycelium.progress.v2'))
          localStorage.setItem('mycelium.progress.v2', JSON.stringify(Object.assign({ runsDone: 1, mineBest: 30, minerals: 10, mineUpgrades: led }, extra || {}))); } catch (_) {}
      }, { led, extra });
      const prog = (page) => page.evaluate(() => JSON.parse(localStorage.getItem('mycelium.progress.v2') || '{}'));
      {
        const b = await E.boot('', 390, 844, { before: seed({ water: 4, oreYield: 3, pocketWater: 2, heatTolerance: 2, excreteCharges: 1 }) });
        await b.page.waitForSelector('#titleScreen', { timeout: 30000 }).catch(() => {});
        await sleep(1500);
        const p1 = await prog(b.page);
        const note = await b.page.evaluate(() => { const e = document.getElementById('tsBanked'); return e ? e.textContent.trim() : null; });
        const ref = await b.page.evaluate(() => window.__game ? null : null);
        ok('a v1 ledger loads with p.mineUpgrades {} and the flag set', p1.migratedMineShelfV2 === true && Object.keys(p1.mineUpgrades || {}).length === 0,
           JSON.stringify({ flag: p1.migratedMineShelfV2, led: p1.mineUpgrades }));
        ok('...and minerals raised by exactly 345 (10 -> 355)', (p1.minerals | 0) === 355, String(p1.minerals));
        ok("...with the toast 'The store was restocked — your Phosphorus is back' on the title", !!note && note.includes('The store was restocked — your Phosphorus is back'), `"${note}"`);
        await b.page.screenshot({ path: path.join(ART, 'm5-restock-title-390.png') });
        await b.page.reload({ waitUntil: 'domcontentloaded' });
        await b.page.waitForSelector('#loadscreen.ld-ready', { timeout: 40000 }).catch(() => {});
        await b.page.click('#loadscreen', { timeout: 5000 }).catch(() => {});
        await b.page.waitForSelector('#titleScreen', { timeout: 30000 }).catch(() => {});
        await sleep(1200);
        const p2 = await prog(b.page);
        const note2 = await b.page.evaluate(() => { const e = document.getElementById('tsBanked'); return e ? e.textContent.trim() : null; });
        ok('a reload adds nothing, and says nothing', (p2.minerals | 0) === 355 && !note2, `${p2.minerals}, note ${JSON.stringify(note2)}`);
        ok('no page errors', b.errs.length === 0, b.errs.slice(0, 2).join(' | ') || 'clean');
        void ref;
        await b.ctx.close();
      }
      {
        // MATERIAL RUNGS COME BACK AS MATERIAL: amputate 3 = 20 + 44 P + 5 Anthracite; grow 4 = 12 + 30 + 60 P + 8 Garnet.
        const b = await E.boot('', 390, 844, { before: seed({ amputateCharges: 3, growSteps: 4 }, { minerals: 0, mats: { garnet: 1 } }) });
        await b.page.waitForSelector('#titleScreen', { timeout: 30000 }).catch(() => {});
        await sleep(1000);
        const p = await prog(b.page);
        ok('material rungs are refunded in their material (166 P, +5 Anthracite, +8 Garnet)',
           (p.minerals | 0) === 166 && ((p.mats || {}).anthracite | 0) === 5 && ((p.mats || {}).garnet | 0) === 9 && Object.keys(p.mineUpgrades || {}).length === 0,
           JSON.stringify({ P: p.minerals, mats: p.mats, led: p.mineUpgrades }));
        await b.ctx.close();
      }
      {
        // A BOOT THAT NEVER SHOWS THE TITLE DOES NOT SWALLOW THE LINE (M5 verifier fix): it used to be
        // deleted at boot, so a '#mine,<seed>' link (or the first-visit gate) lost it for good. It
        // waits for the first screen that shows it — here, the store reached from the end screen.
        const b = await E.bootMine(4242, 390, 844, { before: seed({ water: 2 }) });
        const mid = await prog(b.page);
        await b.page.evaluate(() => window.__game.mine.end());
        await b.page.waitForSelector('#ssMineEnd', { timeout: 20000 }).catch(() => {});
        await sleep(600);
        await b.page.click('#ssMineDone');
        await b.page.waitForSelector('#speciesSelect.ss-mine', { timeout: 20000 }).catch(() => {});
        await sleep(700);
        const note = await b.page.evaluate(() => (document.getElementById('ssMineNote') || {}).textContent || '');
        const after = await prog(b.page);
        ok('a deep-linked boot keeps the restock line until a screen shows it — the store does', !!mid.mineRestocked && note.includes('The store was restocked') && !after.mineRestocked,
           JSON.stringify({ heldAtRun: !!mid.mineRestocked, note, after: !!after.mineRestocked }));
        await b.ctx.close();
      }
      {
        // A save that bought nothing is flagged and paid nothing (and shows no toast).
        const b = await E.boot('', 390, 844, { before: seed({}, { minerals: 7 }) });
        await b.page.waitForSelector('#titleScreen', { timeout: 30000 }).catch(() => {});
        await sleep(1000);
        const p = await prog(b.page);
        const note = await b.page.evaluate(() => { const e = document.getElementById('tsBanked'); return e ? e.textContent.trim() : null; });
        ok('...and an empty ledger is flagged, paid nothing and shown nothing', p.migratedMineShelfV2 === true && (p.minerals | 0) === 7 && !note, JSON.stringify({ P: p.minerals, note }));
        await b.ctx.close();
      }
    }

    // ======================================================================================
    if (want('rich')) {
      console.log('--- rich seams');
      let deep = 0, rich = 0; const per = [];
      for (const seed of [4242, 909, 11]) {
        const b = await E.bootMine(seed);
        const r = await b.page.evaluate(async () => {
          const g = window.__game, s = g.state, cs = s.substrate.cellSize, cc = s.config.mine.chunkCols, home = g.mine.homeChunk();
          g.mine.ensureChunks((home - 3) * cc * cs + 1, (home + 3) * cc * cs - 1);    // chunks home-3 .. home+2: six
          const chunks = g.mine.chunks();
          const ids = [];
          for (let ci = home - 3; ci <= home + 2; ci++) ids.push(ci);
          let d = 0, rc = 0, drawn = 0;
          for (const p of s.substrate.foodPiles) {
            if (!p.mineMat || p.mineMat === 'phosphorus') continue;
            const c = p.cells[0] % s.substrate.cols, ci = Math.floor(c / cc);
            if (ids.indexOf(ci) < 0) continue;
            d++; if (p.rich) { rc++; if (p.cells.every((i) => s.substrate.cells[i].mineRich === 1)) drawn++; }
          }
          return { chunks: ids.filter((ci) => chunks.indexOf(ci) >= 0).length, d, rc, drawn };
        });
        per.push(`${seed}: ${r.rc}/${r.d} over ${r.chunks} chunks`);
        deep += r.d; rich += r.rc;
        ok(`seed ${seed}: six chunks generated, and every rich seam's cells are flagged for the 1.3x draw`, r.chunks === 6 && r.drawn === r.rc, `${r.chunks} chunks, ${r.drawn}/${r.rc}`);
        await b.ctx.close();
      }
      const frac = rich / Math.max(1, deep);
      ok('20-30% of deep seams are rich (3 seeds x 6 chunks)', deep >= 40 && frac >= 0.2 && frac <= 0.3, `${rich} of ${deep} = ${(frac * 100).toFixed(1)}% (${per.join('; ')})`);
      // A RICH SEAM PAYS 6, and the same seam not rich pays 2 (the control).
      const pays = [];
      for (const rch of [true, false]) {
        const b = await E.bootMine(4242);
        pays.push(await b.page.evaluate(async ({ Q, rch }) => {
          new Function('return (' + Q + ')')()();
          const g = window.__game, s = g.state, sub = s.substrate;
          s.active.water = 999999;
          let pile = null, best = Infinity;
          for (const p of sub.foodPiles) {
            const idx = p.cells[0], c = idx % sub.cols, r = (idx - c) / sub.cols;
            const px = (c + 0.5) * sub.cellSize, py = sub.surfaceY + (r + 0.5) * sub.cellSize;
            for (const n of s.active.nodes) { const d = (n.x - px) ** 2 + (n.y - py) ** 2; if (d < best) { best = d; pile = p; } }
          }
          pile.mineMat = 'anthracite'; pile.mineBand = 1; pile.rich = rch;
          const idx = pile.cells[0], c = idx % sub.cols, r = (idx - c) / sub.cols;
          const tx = (c + 0.5) * sub.cellSize, ty = sub.surfaceY + (r + 0.5) * sub.cellSize;
          for (let i = 0; i < 90 && !pile.rewarded; i++) {
            let nb = null, bd = Infinity;
            for (const n of s.active.nodes) { if (n.infected) continue; const d = (n.x - tx) ** 2 + (n.y - ty) ** 2; if (d < bd) { bd = d; nb = n; } }
            if (!nb) break;
            if (Math.sqrt(bd) >= 40 && !g.mine.growFrom(nb.x, nb.y, tx, ty).ok && !g.mine.growFrom(nb.x, nb.y, tx + 120, ty).ok) break;
            await new Promise((x) => setTimeout(x, 160));
          }
          for (let i = 0; i < 40 && !pile.rewarded; i++) await new Promise((x) => setTimeout(x, 150));
          return { rich: rch, rewarded: !!pile.rewarded, anth: g.mine.mats().anthracite | 0 };
        }, { Q, rch }));
        await b.ctx.close();
      }
      ok('a rich seam pays 6 of its material, the same seam not rich pays 2', pays[0].rewarded && pays[0].anth === 6 && pays[1].rewarded && pays[1].anth === 2, JSON.stringify(pays));
      // DETERMINISM: richness is a hash outside the chunk rng, so the chunk records are the pre-M5 ones.
      const b = await E.bootMine(4242);
      const rec = await b.page.evaluate(async () => {
        const g = window.__game, s = g.state, cs = s.substrate.cellSize, cc = s.config.mine.chunkCols;
        // The same camera-driven streaming the snapshot was taken with.
        for (const ci of [8, 12]) {
          g.mine.lookAt((ci + 0.5) * cc * cs, s.substrate.surfaceY + 300);
          for (let i = 0; i < 40 && !s.mineChunks[ci]; i++) await new Promise((r) => setTimeout(r, 100));
        }
        const out = {};
        for (const ci of [8, 9, 10, 11, 12]) out[ci] = s.mineChunks[ci] ? JSON.parse(JSON.stringify(s.mineChunks[ci])) : null;
        return out;
      });
      const snap = JSON.parse(fs.readFileSync(path.join(H.ROOT, 'tests', 'fixtures', 'm5-pre-chunks-4242.json'), 'utf8'));
      const diff = [8, 9, 10, 11, 12].filter((ci) => JSON.stringify(rec[ci]) !== JSON.stringify(snap[ci]));
      ok("'#mine,4242' chunk records 8-12 are identical to the pre-M5 snapshot", diff.length === 0 && [8, 9, 10, 11, 12].every((ci) => rec[ci]),
         diff.length ? 'differ: ' + diff.join(',') : 'all five identical');
      await b.ctx.close();
    }

    // ======================================================================================
    if (want('end')) {
      console.log('--- the end screen');
      const b = await E.bootMine(5);
      const pre = await b.page.evaluate(async (Q) => {
        new Function('return (' + Q + ')')()();
        const g = window.__game, s = g.state;
        s.active.water = 100000;
        await window.__navDig({ targetM: 30, maxIters: 300 });
        s.mineOre = 6; s.active.phosphorus = 6;
        s.mineSeams = { phosphorus: 2, anthracite: 2 };
        s.mineMats = { phosphorus: 6, anthracite: 4 };
        await new Promise((res) => setTimeout(res, 800));
        const bank = g.mine.bankable();
        g.mine.end();
        return { bank, depth: g.mine.maxDepth(), steps: g.mine.steps() };
      }, Q);
      await b.page.waitForSelector('#ssMineEnd', { timeout: 20000 }).catch(() => {});
      await sleep(2600);
      const e = await b.page.evaluate(() => {
        const r = document.getElementById('ssMineEnd');
        const rows = Array.from(r.querySelectorAll('.ss-me-row')).map((x) => x.innerText.replace(/\s+/g, ' ').trim());
        const g = document.getElementById('ssMineGoal');
        const rect = (sel) => { const q = r.querySelector(sel); if (!q) return null; const b = q.getBoundingClientRect(); return { top: b.top, bottom: b.bottom, left: b.left, right: b.right }; };
        return { rows, text: r.innerText, goal: g && g.dataset.goal, goalText: g ? g.innerText : '', buy: !!document.getElementById('ssMineBuy'),
                 descend: rect('#ssMineDescend'), store: rect('#ssMineDone'), vh: innerHeight, vw: innerWidth };
      });
      await b.page.screenshot({ path: path.join(ART, 'm5-end-390.png') });
      ok("the end screen shows a 'Depth' row paying the reach", e.rows.some((x) => new RegExp('^Depth ' + pre.depth + ' m \\+' + (pre.bank - 6)).test(x)), e.rows.join(' | '));
      ok("...a 'Phosphorus seams' row", e.rows.some((x) => /^Phosphorus seams ×2 \+6/.test(x)), e.rows.join(' | '));
      ok('...and the material by name', e.rows.some((x) => /^Anthracite seams ×2 \+4.*Anthracite/.test(x)) && /\+4 Anthracite/.test(e.text), e.rows.join(' | '));
      ok("...with the first run's records line", /Your first descent/i.test(e.text), e.text.split('\n').slice(0, 6).join(' | '));
      // M5 verifier fix: was Grow strength (12 P, the first affordable in the priority). An unbought
      // Water tank now heads the card, as the plan's first-minute script has it.
      ok('...a next-goal card with an inline Buy (Water tank, 5 P: the goal until Water I is bought)', e.goal === 'water' && e.buy, `${e.goal}: ${e.goalText}`);
      ok('...and Descend (primary) and Store both on a 390 x 844 screen', !!e.descend && !!e.store && e.descend.bottom <= e.vh && e.store.bottom <= e.vh && e.descend.left >= 0 && e.store.right <= e.vw,
         JSON.stringify({ d: e.descend, s: e.store }));
      // TWO CLICKS: Buy, then Descend, and a live run is going.
      let clicks = 0;
      await b.page.click('#ssMineBuy'); clicks++;
      await sleep(250);
      await b.page.click('#ssMineDescend'); clicks++;
      const live = await b.page.waitForFunction(() => { const s = window.__game.state;
        return !!(s && s.substrate && s.substrate.mine && !s.runOver && s.substrate._rockSolidified && !document.getElementById('ssMineEnd') && !document.getElementById('speciesSelect')); },
        null, { timeout: 40000 }).then(() => true).catch(() => false);
      const run2 = await b.page.evaluate(() => ({ lvl: window.__game.store.level('water'), start: window.__game.store.start().water, water: window.__game.state.active.water }));
      ok('Buy then Descend reaches a live run in 2 clicks, with the rung bought', live && clicks === 2 && run2.lvl === 1 && run2.start === 72 && run2.water >= 70, JSON.stringify(run2));
      // The records line on a shallower second run.
      await sleep(1500);
      await b.page.evaluate(() => window.__game.mine.end());
      await b.page.waitForSelector('#ssMineEnd', { timeout: 20000 }).catch(() => {});
      await sleep(900);
      const t2 = await b.page.evaluate(() => document.getElementById('ssMineEnd').innerText);
      ok("a shallower run's records line reads 'Deepest N m — K m to go'", /Deepest \d+ m — \d+ m to go/.test(t2), t2.split('\n').slice(0, 5).join(' | '));
      ok('no page errors', b.errs.length === 0, b.errs.slice(0, 2).join(' | ') || 'clean');
      await b.ctx.close();
    }

    // ======================================================================================
    // THE END SCREEN FITS SHORT SCREENS (M5 verifier fix). With four seam rows, the records line and
    // the goal card, `.ss-win`'s centring pushed SPORED off the TOP at 640x360 (y -50..-7) and 320x568.
    if (want('fit')) {
      console.log('--- the end screen on short screens');
      for (const [w, h] of [[390, 844], [360, 640], [320, 568], [640, 360]]) {
        const b = await E.bootMine(5, w, h);
        await b.page.evaluate(async (Q) => {
          new Function('return (' + Q + ')')()();
          const g = window.__game, s = g.state;
          s.active.water = 100000; await window.__navDig({ targetM: 30, maxIters: 300 });
          s.mineOre = 9; s.mineSeams = { phosphorus: 3, anthracite: 2, garnet: 1, hematite: 1 };
          s.mineMats = { phosphorus: 9, anthracite: 4, garnet: 2, hematite: 2 };
          await new Promise((r) => setTimeout(r, 500)); g.store.credit(3); g.mine.end();
        }, Q);
        await b.page.waitForSelector('#ssMineEnd', { timeout: 20000 }).catch(() => {});
        await sleep(2500);
        const r = await b.page.evaluate(() => {
          const box = (sel) => { const e = document.querySelector(sel); if (!e) return null; const q = e.getBoundingClientRect(); return { top: Math.round(q.top), bottom: Math.round(q.bottom), cx: q.left + q.width / 2, cy: q.top + q.height / 2 }; };
          const hit = (bx) => { if (!bx) return null; const e = document.elementFromPoint(bx.cx, bx.cy); return e && (e.id || e.className); };
          const d = box('#ssMineDescend'), st = box('#ssMineDone');
          return { vh: innerHeight, title: box('#ssMineEnd .ss-win-title'), depth: box('#ssMineEnd .ss-mineend-depth'), d, st,
                   hitD: hit(d), hitS: hit(st), scroll: document.getElementById('ssMineEnd').scrollTop };
        });
        await b.page.screenshot({ path: path.join(ART, `m5-end-${w}x${h}.png`) });
        const inView = (x) => x && x.top >= 0 && x.bottom <= r.vh;
        ok(`${w}x${h}: SPORED and the depth are on screen, and Descend and Store are tappable`,
           inView(r.title) && inView(r.depth) && inView(r.d) && inView(r.st) && r.hitD === 'ssMineDescend' && r.hitS === 'ssMineDone',
           JSON.stringify({ title: r.title && [r.title.top, r.title.bottom], depth: r.depth && [r.depth.top, r.depth.bottom], d: r.d && [r.d.top, r.d.bottom], s: r.st && [r.st.top, r.st.bottom], hit: [r.hitD, r.hitS] }));
        await b.ctx.close();
      }
    }

    // ======================================================================================
    if (want('title')) {
      console.log('--- the title\'s Upgrades button');
      const boot = async (save) => {
        const b = await E.boot('', 390, 844, { before: async (page) => page.addInitScript((sv) => {
          try { if (!localStorage.getItem('mycelium.progress.v2')) localStorage.setItem('mycelium.progress.v2', JSON.stringify(sv)); } catch (_) {}
        }, save) });
        await b.page.waitForSelector('#titleScreen', { timeout: 30000 }).catch(() => {});
        await sleep(1200);
        const has = await b.page.evaluate(() => !!document.getElementById('tsStore'));
        await b.ctx.close();
        return has;
      };
      const base = { runsDone: 1, mineBest: 20, migratedMineShelfV2: true };
      const bare = await boot(Object.assign({ minerals: 0 }, base));
      const bought = await boot(Object.assign({ minerals: 0, mineUpgrades: { water: 1 } }, base));
      const mat = await boot(Object.assign({ minerals: 0, mats: { garnet: 3 } }, base));
      const wal = await boot(Object.assign({ minerals: 4 }, base));
      ok('Upgrades is hidden on a save with nothing to spend and nothing bought', bare === false, String(bare));
      ok('...shown for a bought rung with an empty wallet, a deep material held, or Phosphorus held', bought && mat && wal, JSON.stringify({ bought, mat, wal }));
    }
  } finally { await E.close(); }
  console.log(`\n==== ${pass} passed, ${fail} failed ====`);
  process.exit(fail ? 1 : 0);
})();
