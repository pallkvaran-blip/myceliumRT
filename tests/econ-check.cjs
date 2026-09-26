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
                 hud: +document.getElementById('hud-phosphorus').textContent, floaters: [...seen],
                 ticks: (window.__sfx && window.__sfx.counts.reach) | 0 };
      }, Q);
      ok('at the surface: nothing raw, and the bank is the 5 P floor', r.at0.raw === 0 && r.at0.reach === 5 && r.at0.bank === 5, JSON.stringify(r.at0));
      ok(`at ${r.d} m the raw reach is floor(depth / 5)`, r.d >= 20 && r.raw === Math.floor(r.d / 5), `raw ${r.raw} at ${r.d} m`);
      ok('...and the HUD counts seams + raw reach', r.hud === 6 + r.raw, `HUD ${r.hud} = 6 + ${r.raw}`);
      ok('...what ends now banks max(5, reach) + seams', r.reach === Math.max(5, r.raw) && r.bank === r.reach + 6, `bank ${r.bank} = ${r.reach} + 6`);
      ok("'+1 P' popped at the tip as depth paid", r.floaters.includes('+1 P'), r.floaters.join(' ') || 'none');
      ok('no page errors', b.errs.length === 0, b.errs.slice(0, 2).join(' | ') || 'clean');
      await b.ctx.close();
    }

    // ======================================================================================
    if (want('reveal')) {
      console.log('--- the progressive store');
      {
        const b = await E.bootMine(4242);
        await b.page.evaluate(() => window.__game.store.credit(5));
        await openStore(b.page);
        const t = await tiles(b.page);
        ok('a fresh save\'s first store shows exactly Water tank and Grow strength', t.map((x) => x.id).join(',') === 'water,growSteps', t.map((x) => x.id).join(','));
        ok('...Water tank highlighted (the next goal, affordable at 5 P), no NEW badges', t[0] && t[0].hl && !t[1].hl && !t.some((x) => x.isNew), JSON.stringify(t));
        const nm = await b.page.evaluate(() => { const e = document.querySelector('.ss-upg[data-track="water"] .ss-upg-nm'); return e ? e.textContent : ''; });
        ok("...named 'Water tank' in the mine", nm === 'Water tank', nm);
        await b.page.click('.ss-upg[data-track="water"] .ss-upg-btn');
        await sleep(300);
        const lv = await b.page.evaluate(() => ({ lv: window.__game.store.level('water'), P: window.__game.store.balance(), start: window.__game.store.start().water }));
        ok('...and 5 P buys Water I: +12 water (60 -> 72)', lv.lv === 1 && lv.P === 0 && lv.start === 72, JSON.stringify(lv));
        ok('no page errors', b.errs.length === 0, b.errs.slice(0, 2).join(' | ') || 'clean');
        await b.ctx.close();
      }
      {
        const b = await E.bootMine(909);
        const d = await b.page.evaluate(async (Q) => {
          new Function('return (' + Q + ')')()();
          const g = window.__game, s = g.state;
          s.active.water = 100000;
          const pre = g.store.seen();
          await window.__navDig({ targetM: 46, maxIters: 400 });
          await new Promise((res) => setTimeout(res, 800));
          const mid = g.store.seen();
          // Enough in the wallet that every revealed rung is affordable, so the card's pick is the
          // priority's first — the NEW tile — rather than whatever the haul happens to reach.
          g.store.credit(40);
          g.mine.end();
          return { pre, mid, depth: g.mine.maxDepth() };
        }, Q);
        ok(`a scripted dive to ${d.depth} m records the line (p.mineSeen.line42)`, d.depth > 42 && !d.pre.line42 && d.mid.line42 === true, JSON.stringify(d));
        await b.page.waitForSelector('#ssMineEnd', { timeout: 20000 }).catch(() => {});
        await sleep(900);
        const card = await b.page.evaluate(() => { const e = document.getElementById('ssMineGoal'); return { goal: e && e.dataset.goal, text: e ? e.innerText : '' }; });
        ok('...the end screen\'s next goal is the new tile, Heat tolerance, marked NEW', card.goal === 'heatTolerance' && /NEW/i.test(card.text), `${card.goal}: ${card.text}`);
        await b.page.click('#ssMineDone');
        await b.page.waitForSelector('#speciesSelect.ss-mine', { timeout: 20000 }).catch(() => {});
        await sleep(700);
        const t1 = await tiles(b.page);
        const heat = t1.find((x) => x.id === 'heatTolerance');
        ok('...and the store shows Heat tolerance with NEW, highlighted as the next goal', !!heat && heat.isNew && heat.hl && t1.filter((x) => x.hl).length === 1,
           t1.map((x) => x.id + (x.isNew ? '*' : '') + (x.hl ? '^' : '')).join(','));
        ok('...but not Mucus flasks, before any worm has attached', !t1.some((x) => x.id === 'excreteCharges'), t1.map((x) => x.id).join(','));
        await b.page.screenshot({ path: path.join(ART, 'm5-store-new-390.png') });
        await openStore(b.page);
        const t2 = await tiles(b.page);
        const heat2 = t2.find((x) => x.id === 'heatTolerance');
        ok('NEW lasts one visit: the next visit shows Heat tolerance without it', !!heat2 && !heat2.isNew, t2.map((x) => x.id + (x.isNew ? '*' : '')).join(','));
        // Descend from the store, and let a worm attach.
        await b.page.click('#ssDescend');
        await b.page.waitForFunction(() => { const s = window.__game.state; return s && s.substrate && s.substrate.mine && !s.runOver && s.substrate._fineSolid && !document.getElementById('speciesSelect'); }, { timeout: 40000 });
        await sleep(1500);
        const w = await b.page.evaluate(async () => {
          const g = window.__game, s = g.state;
          s.config.nematodes.respawnChance = 0;
          let tip = null; for (const n of s.active.nodes) if (!n.infected && (!tip || n.y > tip.y)) tip = n;
          g.mine.spawnWorm(tip.x, tip.y);
          let att = 0;
          for (let i = 0; i < 80 && !(att = g.mine.attached()); i++) await new Promise((res) => setTimeout(res, 100));
          await new Promise((res) => setTimeout(res, 500));
          const seen = g.store.seen();
          g.mine.end();
          return { att, worm: !!seen.worm };
        });
        ok('a worm attaches and the save records it (p.mineSeen.worm)', w.att > 0 && w.worm, JSON.stringify(w));
        await b.page.waitForSelector('#ssMineEnd', { timeout: 20000 }).catch(() => {});
        await sleep(700);
        await b.page.click('#ssMineDone');
        await b.page.waitForSelector('#speciesSelect.ss-mine', { timeout: 20000 }).catch(() => {});
        await sleep(700);
        const t3 = await tiles(b.page);
        const fl = t3.find((x) => x.id === 'excreteCharges');
        ok('...after which the store shows Mucus flasks, with NEW', !!fl && fl.isNew, t3.map((x) => x.id + (x.isNew ? '*' : '')).join(','));
        ok('...and a hidden track cannot be bought through the hook either', await b.page.evaluate(() => {
          const S = window.__game.store; S.credit(1000); return S.inGame('amputateCharges', 'mine') === false && S.buy('amputateCharges').ok === false; }), 'refused');
        ok('no page errors', b.errs.length === 0, b.errs.slice(0, 2).join(' | ') || 'clean');
        await b.ctx.close();
      }
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
      ok('...a next-goal card with an inline Buy (Grow strength, 12 P, affordable)', e.goal === 'growSteps' && e.buy, `${e.goal}: ${e.goalText}`);
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
      const run2 = await b.page.evaluate(() => ({ steps: window.__game.mine.steps(), grow: window.__game.store.level('growSteps'), water: window.__game.state.active.water }));
      ok('Buy then Descend reaches a live run in 2 clicks, with the rung bought', live && clicks === 2 && run2.grow === 1 && run2.steps === 3, JSON.stringify(run2));
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
