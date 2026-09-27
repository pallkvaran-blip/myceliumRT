/* JOURNEY I, PART 1: FIXED LEG WORLDS WITH A TAPROOT IN THE EAST — the finishing plan's M7, as assertions.
 *
 *   layout   '#leg,1,1': the hill at column 36 (chunk 1), the island span inside chunk 5, the taproot
 *            96 m east / 24 m deep (within a cell), the island's surface is soil, both hills drawn, the
 *            knot and its filaments drawn; the plain DIG (`mine.play`) is still the free layout; the save's
 *            `p.mineJourney` defaults to leg 1 and `playJourney` follows it.
 *   determ   two boots of '#leg,1,2' give identical chunk records for chunks 0-8 and the same taproot.
 *   free     '#mine,4242' chunk records 8-12 are byte-identical to the pre-M7 snapshot
 *            (tests/fixtures/m7-pre-chunks-4242.json, from be20b64).
 *   legs     legs 1-3 through tests/bots/legprobe.cjs's `measure`: the fine-mask flood from the home head
 *            reaches the taproot, the path is 1.3-2.0x the straight line, a rows 0-2 flood never passes
 *            column 66, legs 2-3 spend >= 50% of the cheapest-water route's east metres below 42 m, no
 *            straight lateral channel 3 cells tall runs more than 36 cells, and no creature sits above
 *            row 42; leg 1 ('calm') seeds none, leg 3 ('dry') no pocket above 42 m. One resting-zoom
 *            screenshot per leg around a sealed seam goes to tests/.artifacts/m7-leg<N>-seam-390.png.
 *
 * `JOURNEY_ONLY=layout,determ,free,legs` runs a subset.
 */
const path = require('path'), fs = require('fs');
const H = require('./mine-harness.cjs');
const LP = require('./bots/legprobe.cjs');
const { sleep } = H;
let pass = 0, fail = 0;
const ok = (n, c, x) => { c ? (pass++, console.log('  PASS  ' + n + (x ? '  — ' + x : ''))) : (fail++, console.log('  FAIL  ' + n + (x ? '  — ' + x : ''))); };
const ART = path.join(H.ROOT, 'tests', '.artifacts');
fs.mkdirSync(ART, { recursive: true });
const ONLY = (process.env.JOURNEY_ONLY || '').split(',').filter(Boolean);
const want = (k) => !ONLY.length || ONLY.includes(k);

const chunkRecs = (page, list) => page.evaluate(async (list) => {
  const g = window.__game, s = g.state, cs = s.substrate.cellSize, cw = s.config.mine.chunkCols;
  g.mine.ensureChunks(Math.min(...list) * cw * cs, ((Math.max(...list) + 1) * cw - 1) * cs);
  const out = {};
  for (const ci of list) out[ci] = s.mineChunks[ci] ? JSON.stringify(s.mineChunks[ci]) : null;
  return out;
}, list);

(async () => {
  const E = await H.start();
  try {
    // ======================================================================================
    if (want('layout')) {
      console.log('--- leg 1 layout');
      const b = await LP.openLeg(E, 1);
      const r = await b.page.evaluate(async () => {
        const g = window.__game, s = g.state, sub = s.substrate, cs = sub.cellSize, cw = s.config.mine.chunkCols;
        const L = g.mine.leg(), lay = L.layout, t = g.mine.taproot();
        const homeX = (sub.mineHomeCol + 0.5) * cs;
        const soil = []; for (let c = lay.islandC0; c <= lay.islandC1; c++) soil.push(!!sub.surface[c].soil && !sub.surface[c].barrier);
        const outside = [lay.islandC0 - 1, lay.islandC1 + 1].map((c) => !!sub.surface[c].soil);
        // Look at the island and let a frame draw it.
        g.mine.lookAt((t.x0 + t.x1) / 2, t.y - 480);
        await new Promise((r) => setTimeout(r, 900));
        const drawnIsland = g.mine.taproot().drawn;
        return { home: sub.mineHomeCol, homeChunk: g.mine.homeChunk(), chunkOfI0: Math.floor(lay.islandC0 / cw), chunkOfI1: Math.floor(lay.islandC1 / cw),
                 eastM: (t.x - homeX) / cs, depthM: Math.floor((t.y - sub.surfaceY) / cs),
                 root: [Math.floor(s.active.nodes[0].x / cs)], seed: L.seed, curated: g.mine.legRow(1).seed,
                 soil, outside, hills: g.mine.hills(), drawnIsland, id: s.levelDef && s.levelDef.id };
      });
      ok("'#leg,1,1' puts the hill at column 36, in chunk 1", r.home === 36 && r.homeChunk === 1 && r.root[0] === 36,
         `home ${r.home}, home chunk ${r.homeChunk}, root col ${r.root[0]}`);
      ok('...the island span is inside chunk 5', r.chunkOfI0 === 5 && r.chunkOfI1 === 5, `island chunks ${r.chunkOfI0}..${r.chunkOfI1}`);
      ok('...and the taproot is within 1 cell of 96 m east / 24 m deep', Math.abs(r.eastM - 96) <= 1 && Math.abs(r.depthM - 24) <= 1,
         `${r.eastM.toFixed(2)} m east, ${r.depthM} m deep`);
      ok('...on the curated seed', r.seed === r.curated && r.id === 'leg-1-1', `seed ${r.seed} (row ${r.curated}), map ${r.id}`);
      ok("...the island's surface columns are soil, and the ground beside it is not", r.soil.every(Boolean) && !r.outside.some(Boolean),
         `${r.soil.filter(Boolean).length}/${r.soil.length} soil`);
      ok('...both hills are drawn, the second over the island', r.hills.length === 2 && r.hills[1].island,
         JSON.stringify(r.hills.map((h) => [Math.round(h.x0), Math.round(h.x1), h.island])));
      ok('...and the taproot knot and its filaments draw', r.drawnIsland && r.drawnIsland.knot && r.drawnIsland.filaments >= 3,
         JSON.stringify(r.drawnIsland));
      await b.page.screenshot({ path: path.join(ART, 'm7-leg1-island-390.png'), animations: 'disabled', timeout: 8000 }).catch(() => {});
      // The plain DIG is still the free layout until M8; the save's journey leg drives playJourney.
      const f = await b.page.evaluate(async () => {
        const g = window.__game;
        const p0 = JSON.parse(localStorage.getItem('mycelium.progress.v2') || '{}').mineJourney || null;
        g.mine.play();
        await new Promise((r) => setTimeout(r, 300));
        const free = { leg: g.mine.leg(), home: g.state.substrate.mineHomeCol, J: g.state.substrate.mineJourney };
        const p = JSON.parse(localStorage.getItem('mycelium.progress.v2') || '{}');
        p.mineJourney = { journey: 1, leg: 3, legs: {} }; localStorage.setItem('mycelium.progress.v2', JSON.stringify(p));
        g.mine.playJourney();
        await new Promise((r) => setTimeout(r, 300));
        const L = g.mine.leg();
        return { p0, free, jl: L && L.leg, jseed: L && L.seed, curated3: g.mine.legRow(3).seed, jhome: g.state.substrate.mineHomeCol };
      });
      ok('the plain DIG still starts the free layout', f.free.leg === null && f.free.home === 252 && !f.free.J,
         `leg ${JSON.stringify(f.free.leg)}, home ${f.free.home}`);
      ok('...the save carries p.mineJourney, defaulted to journey 1 leg 1', f.p0 && f.p0.journey === 1 && f.p0.leg === 1 && f.p0.legs,
         JSON.stringify(f.p0));
      ok('...and a journey descent follows the save to its leg, on that leg\'s curated seed',
         f.jl === 3 && f.jseed === f.curated3 && f.jhome === 36, `leg ${f.jl}, seed ${f.jseed} (row ${f.curated3}), home ${f.jhome}`);
      ok('no page errors (layout)', !b.errs.length, b.errs.slice(0, 2).join(' | '));
      await b.ctx.close();
    }

    // ======================================================================================
    if (want('determ')) {
      console.log("--- '#leg,1,2' is the same world twice");
      const list = [0, 1, 2, 3, 4, 5, 6, 7, 8];
      const reads = [];
      for (let k = 0; k < 2; k++) {
        const b = await LP.openLeg(E, 2);
        const recs = await chunkRecs(b.page, list);
        const tap = await b.page.evaluate(() => { const t = window.__game.mine.taproot(); const L = window.__game.mine.leg();
          return { x: t.x, y: t.y, seed: L.seed, rec: JSON.stringify(window.__game.state.mineChunks[Math.floor(L.layout.taproot.col / 24)].taproot) }; });
        reads.push({ recs, tap, errs: b.errs.length });
        await b.ctx.close();
      }
      const same = list.filter((ci) => reads[0].recs[ci] && reads[0].recs[ci] === reads[1].recs[ci]);
      ok('two boots give identical chunk records for chunks 0-8', same.length === list.length,
         `${same.length}/${list.length} identical${same.length < list.length ? ', differ: ' + list.filter((c) => !same.includes(c)).join(',') : ''}`);
      ok('...and the same taproot', JSON.stringify(reads[0].tap) === JSON.stringify(reads[1].tap), JSON.stringify(reads[0].tap));
      ok('no page errors (determinism)', !reads[0].errs && !reads[1].errs);
    }

    // ======================================================================================
    if (want('free')) {
      console.log("--- '#mine,4242' is untouched");
      const b = await E.bootMine(4242);
      const rec = await b.page.evaluate(async () => {
        const g = window.__game, s = g.state, cs = s.substrate.cellSize, cc = s.config.mine.chunkCols;
        for (const ci of [8, 12]) {
          g.mine.lookAt((ci + 0.5) * cc * cs, s.substrate.surfaceY + 300);
          for (let i = 0; i < 40 && !s.mineChunks[ci]; i++) await new Promise((r) => setTimeout(r, 100));
        }
        const out = {};
        for (const ci of [8, 9, 10, 11, 12]) out[ci] = s.mineChunks[ci] ? JSON.parse(JSON.stringify(s.mineChunks[ci])) : null;
        return { out, J: s.substrate.mineJourney, home: s.substrate.mineHomeCol };
      });
      const snap = JSON.parse(fs.readFileSync(path.join(H.ROOT, 'tests', 'fixtures', 'm7-pre-chunks-4242.json'), 'utf8')).chunks;
      const diff = [8, 9, 10, 11, 12].filter((ci) => JSON.stringify(rec.out[ci]) !== JSON.stringify(snap[ci]));
      ok("'#mine,4242' chunk records 8-12 are byte-identical to the pre-M7 snapshot", !diff.length && [8, 9, 10, 11, 12].every((c) => rec.out[c]),
         diff.length ? 'differ: ' + diff.join(',') : '5/5 identical');
      ok('...on the free layout (no journey, centre hill)', !rec.J && rec.home === 252, `home ${rec.home}`);
      await b.ctx.close();
    }

    // ======================================================================================
    if (want('legs')) {
      for (const leg of [1, 2, 3]) {
        console.log(`--- leg ${leg}`);
        const b = await LP.openLeg(E, leg);
        const m = await LP.measure(b.page);
        const extra = await b.page.evaluate(() => {
          const s = window.__game.state, sub = s.substrate;
          const pockets = (sub.reservoirs || []).map((r) => r.r0);
          return { pockets, worms: s.nematodes.length, clouds: s.clouds.length };
        });
        ok(`leg ${leg}: the fine-mask flood from the home head reaches the taproot chamber`, m.reach && m.reachClr,
           `plain ${m.reach}, with clearance ${m.reachClr} (seed ${m.seed})`);
        ok(`leg ${leg}: the shortest path is 1.3-2.0x the straight line`, m.ratio >= 1.3 && m.ratio <= 2.0, `${m.ratio}x`);
        ok(`leg ${leg}: a flood held to rows 0-2 never passes column 66`, m.crustMaxCol <= m.homeCol + 30, `farthest column ${m.crustMaxCol}`);
        if (leg >= 2) ok(`leg ${leg}: the cheapest-water route spends >= 50% of its east metres below 42 m`, m.east42 >= 0.5,
           `${(m.east42 * 100).toFixed(1)}% below 42 m, ${(m.east84 * 100).toFixed(1)}% below 84 m, ${m.water} water`);
        ok(`leg ${leg}: no straight lateral channel 3 cells tall runs more than 36 cells`, m.lateral <= 36,
           `longest ${m.lateral} (row ${m.latAt && m.latAt.row}, ending col ${m.latAt && m.latAt.endCol})`);
        ok(`leg ${leg}: no creature is placed above row 42`, m.shallowestRow >= 42, `shallowest creature row ${m.shallowestRow === 999 ? 'none' : m.shallowestRow}`);
        if (leg === 1) ok("leg 1 ('calm') seeds no creature at all", extra.worms === 0 && extra.clouds === 0 && m.shallowestRow === 999,
           `${extra.worms} worms, ${extra.clouds} clouds`);
        if (leg === 3) ok("leg 3 ('dry') has no water pocket above 42 m", extra.pockets.length > 0 && extra.pockets.every((r) => r >= 42),
           `${extra.pockets.length} pockets, shallowest row ${Math.min(...extra.pockets)}`);
        // Acceptance 9: a resting-zoom frame around a sealed seam. The generator records which seams it
        // walled on a journey leg (`mineJourney._sealed`); frame the shallowest one inside the window.
        const seam = await b.page.evaluate(async () => {
          const g = window.__game, s = g.state, sub = s.substrate, cs = sub.cellSize, cw = s.config.mine.chunkCols;
          const cis = g.mine.chunks();
          const list = (sub.mineJourney._sealed || []).filter((x) => cis.includes(x.ci) && x.ci > 0 && x.row > 3)
            .sort((a, b) => a.row - b.row);
          const sd = list[0];
          if (!sd) return null;
          const col = sd.L ? sd.ci * cw : (sd.ci + 1) * cw;
          // The zoom the run opened at IS the resting zoom (nothing here has zoomed); park the camera.
          const z0 = g.camera.zoom;
          g.mine.lookAt(col * cs, sub.surfaceY + (sd.row + 0.5) * cs);
          await new Promise((r) => setTimeout(r, 900));
          return { col, row: sd.row, z0, zoom: g.camera.zoom, n: list.length };
        });
        ok(`leg ${leg}: a sealed seam exists to frame, at the resting zoom`, !!seam && Math.abs(seam.zoom - seam.z0) < 1e-6,
           seam ? `seam col ${seam.col}, row ${seam.row} (${seam.n} sealed in the window), zoom ${seam.zoom.toFixed(3)}` : 'none');
        await b.page.screenshot({ path: path.join(ART, `m7-leg${leg}-seam-390.png`), animations: 'disabled', timeout: 8000 }).catch(() => {});
        ok(`no page errors (leg ${leg})`, !b.errs.length, b.errs.slice(0, 2).join(' | '));
        await b.ctx.close();
      }
    }
  } catch (e) {
    fail++; console.log('  FAIL  harness: ' + (e && e.stack || e));
  } finally { await E.close(); }
  console.log(`\n==== ${pass} passed, ${fail} failed ====`);
  process.exit(fail ? 1 : 0);
})();
