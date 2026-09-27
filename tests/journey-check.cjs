/* JOURNEY I, PART 1: FIXED LEG WORLDS WITH A TAPROOT IN THE EAST — the finishing plan's M7, as assertions.
 *
 *   layout   '#leg,1,1': the hill at column 36 (chunk 1), the island span inside chunk 5, the taproot
 *            96 m east / 24 m deep (within a cell), the island's surface is soil, both hills drawn, the
 *            knot and its filaments drawn; the plain DIG (`mine.play`) is still the free layout; the save's
 *            `p.mineJourney` defaults to leg 1 and `playJourney` follows it.
 *   determ   two boots of '#leg,1,2' — the second generating chunks 3-8 in REVERSE order — give identical
 *            chunk records for chunks 0-8, the same taproot, the same seam stitches and the same rock
 *            (a hash of every sprite in chunks 0-8, sorted, since the stitch's owner depends on order).
 *   free     '#mine,4242' chunk records 8-12 are byte-identical to the pre-M7 snapshot
 *            (tests/fixtures/m7-pre-chunks-4242.json, from be20b64).
 *   legs     legs 1-3 through tests/bots/legprobe.cjs's `measure`, on the GROWTH LATTICE (growth's own
 *            point/segment rule — hairlines count, which the first version's clearance model did not):
 *            the fine-mask flood and the lattice reach the taproot, the shortest path is 1.3-2.0x the
 *            straight line on the lattice AND on the plain fine mask, a rows 0-2 flood never passes column
 *            66, legs 2-3 spend >= 50% of the cheapest-water route's east metres below 42 m and growth held
 *            above 42 m cannot reach the island, no straight lateral channel 3 cells tall runs more than 36
 *            cells, no seam carries a vertical hairline longer than a band, no sealed side leaks (the
 *            floor-strip exemption went with the floor gallery, verifier round 2), and no creature sits
 *            above row 42; leg 1 ('calm') seeds none, leg 3 ('dry') no
 *            pocket above 42 m. Then REAL growth (mine.growFrom) follows the cheapest route and must land
 *            at the taproot — on legs 2-3 with >= 50% of the landing strand's east travel below 42 m.
 *            Each row's `E` agrees with its `eastM`. Resting-zoom screenshots: one per leg around a sealed
 *            seam (tests/.artifacts/m7-leg<N>-seam-390.png) and nine per leg at seams 2-4 x rows 45, 70
 *            and 120 (m7-leg<N>-c<k>-r<row>-390.png) — the verifier's own framing.
 *   world    (M7 verifier round 2) EVERY chunk of legs 1-3 (legprobe `world`): every ore seam and every
 *            water pocket is reachable on the fine mask from the colony's root, no straight lateral
 *            channel 3 cells tall runs more than 36 cells anywhere in the leg world, and the ground within
 *            a cell of a chunk seam is no more than 0.2 more solid than the ground 6+ cells from one (the
 *            first stitch: 0.87 against 0.64, a dense line), and the seam line is not a column (rows of
 *            dense stripe down the line in runs >= 6: <= 10 per seam; 12.5-15.8 before round 2's fix,
 *            ~1 on an interior line). Controls: the free layout '#mine,4242'
 *            reaches every reward too; and leg 2 with the reward repair switched off
 *            (`MYCELIUM_NO_REWARD_REPAIR`) strands some, so the assertion can fail.
 *   island   on candidate seeds that were NOT curated, the taproot chamber's growth-lattice flood (held
 *            inside the island chunk) reaches the chunk's own seam column: the repair's guarantee
 *            survives the seal boulders and the stitch whatever the seed.
 *
 * `JOURNEY_ONLY=layout,determ,free,legs,world,stream,island` runs a subset.
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

const chunkRecs = (page, list, reverse) => page.evaluate(async ([list, reverse]) => {
  const g = window.__game, s = g.state, sub = s.substrate, cs = sub.cellSize, cw = s.config.mine.chunkCols;
  // REVERSE: one chunk at a time from the east end, so the chunks of a seam arrive in the other order
  // and each stitch is owned by the other chunk. `pre` is what existed before (the boot's own chunks;
  // the reverse boot turns the idle lookahead off so it cannot make the rest forwards first).
  const pre = g.mine.chunks();
  if (reverse) for (const ci of list.slice().reverse()) g.mine.ensureChunks((ci + 0.3) * cw * cs, (ci + 0.7) * cw * cs);
  g.mine.ensureChunks(Math.min(...list) * cw * cs, ((Math.max(...list) + 1) * cw - 1) * cs);
  const out = {};
  for (const ci of list) out[ci] = s.mineChunks[ci] ? JSON.stringify(s.mineChunks[ci]) : null;
  const xMax = (Math.max(...list) + 1) * cw * cs - 1;
  const sp = sub.levelSprites.filter((q) => q.x < xMax).map((q) => [q.key, q.x, q.y, q.w, q.h].join(',')).sort();
  let h = 2166136261; for (const t of sp) for (let i = 0; i < t.length; i++) { h ^= t.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
  const st = {}; for (let k = Math.min(...list) + 1; k <= Math.max(...list); k++) st[k] = sub.mineJourney._stitched ? sub.mineJourney._stitched[k] : null;
  return { out, sprites: sp.length, hash: h, stitched: JSON.stringify(st), pre };
}, [list, !!reverse]);

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
        const b = k === 1 ? await E.boot('#leg,1,2', 390, 844, { before: (page) => page.addInitScript(() => { window.MYCELIUM_NO_LOOKAHEAD = true; }) })
                          : await LP.openLeg(E, 2);
        if (k === 1) await b.page.waitForFunction(() => !!(window.__game && window.__game.mine && window.__game.mine.leg && window.__game.mine.leg()
          && window.__game.state.substrate._fineSolid), { timeout: 40000 });
        await sleep(1500);   // idle frames: on the first boot the lookahead runs, on the second it must not
        const rr = await chunkRecs(b.page, list, k === 1), recs = rr.out;
        const tap = await b.page.evaluate(() => { const t = window.__game.mine.taproot(); const L = window.__game.mine.leg();
          return { x: t.x, y: t.y, seed: L.seed, rec: JSON.stringify(window.__game.state.mineChunks[Math.floor(L.layout.taproot.col / 24)].taproot) }; });
        reads.push({ recs, tap, errs: b.errs.length, hash: rr.hash, sprites: rr.sprites, stitched: rr.stitched, pre: rr.pre });
        await b.ctx.close();
      }
      const same = list.filter((ci) => reads[0].recs[ci] && reads[0].recs[ci] === reads[1].recs[ci]);
      ok('two boots give identical chunk records for chunks 0-8', same.length === list.length,
         `${same.length}/${list.length} identical${same.length < list.length ? ', differ: ' + list.filter((c) => !same.includes(c)).join(',') : ''}`);
      ok('...and the same taproot', JSON.stringify(reads[0].tap) === JSON.stringify(reads[1].tap), JSON.stringify(reads[0].tap));
      ok('...and the same rock, sprite for sprite, although the second boot generated chunks 3-8 in reverse order',
         reads[0].hash === reads[1].hash && reads[0].sprites === reads[1].sprites && reads[0].sprites > 1000
         && reads[1].pre.every((c) => c <= 2) && reads[0].pre.some((c) => c > 2),
         `${reads[0].sprites} / ${reads[1].sprites} sprites, hash ${reads[0].hash} / ${reads[1].hash}; before the reverse walk: [${reads[1].pre}] (first boot, lookahead on: [${reads[0].pre}])`);
      ok('...and the same seam stitches', reads[0].stitched === reads[1].stitched && !/null/.test(reads[0].stitched), reads[0].stitched);
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
      // CONTROL for the legs block's seam-hairline reading: the free layout has no stitch (its records
      // are pinned; the slit there is the owner's call), so the same reading must SEE a slit there — or a
      // "no hairline" pass on a leg would say nothing about the reading.
      const fr = await b.page.evaluate(async () => {
        const g = window.__game, s = g.state, sub = s.substrate, cs = sub.cellSize, cw = s.config.mine.chunkCols;
        for (let i = 0; i < 100 && !((sub._solidFrom | 0) === sub.levelSprites.length && sub._mineDirtyC0 == null); i++) await new Promise((r) => setTimeout(r, 100));
        const fsz = sub._fineSize, W = sub._fineCols, H = sub._fineRows, fs = sub._fineSolid, K = Math.round(cs / fsz);
        const cis = g.mine.chunks().sort((a, b) => a - b); let best = 0, n = 0;
        for (const ci of cis) { if (!cis.includes(ci - 1)) continue; n++;
          const sF = ci * cw * K; let run = 0;
          for (let y = 0; y < H; y++) { let o = false; for (let x = sF - 2; x <= sF + 1 && !o; x++) if (!fs[y * W + x]) o = true;
            if (o) { run++; if (run > best) best = run; } else run = 0; } }
        return { rows: +(best / K).toFixed(1), seams: n, depth: sub.rows };
      });
      ok('control: the same seam reading sees the unstitched free layout\'s slit', fr.seams > 0 && fr.rows > 42,
         `longest ${fr.rows} of ${fr.depth} rows over ${fr.seams} seams`);
      await b.ctx.close();
    }

    // ======================================================================================
    if (want('legs')) {
      for (const leg of [1, 2, 3]) {
        console.log(`--- leg ${leg}`);
        const b = await LP.openLeg(E, leg);
        const m = await LP.measure(b.page, { route: true });
        const route = m.route; delete m.route;
        const extra = await b.page.evaluate((leg) => {
          const g = window.__game, s = g.state, sub = s.substrate, cw = s.config.mine.chunkCols;
          const pockets = (sub.reservoirs || []).map((r) => r.r0);
          const row = g.mine.legRow(leg), lay = g.mine.leg().layout;
          const jc = s.config.mine.journey.homeChunk;
          return { pockets, worms: s.nematodes.length, clouds: s.clouds.length, E: row.E,
                   Eof: Math.floor((lay.homeCol + Math.round(row.eastM)) / cw) - jc,
                   ic0: Math.floor(lay.islandC0 / cw), ic1: Math.floor(lay.islandC1 / cw), rows: sub.rows };
        }, leg);
        ok(`leg ${leg}: the fine-mask flood AND the growth lattice from the home head reach the taproot chamber`, m.reach && m.reachLat,
           `plain ${m.reach}, lattice ${m.reachLat} (seed ${m.seed})`);
        ok(`leg ${leg}: the shortest path is 1.3-2.0x the straight line, on the growth lattice and on the plain fine mask`,
           m.ratio >= 1.3 && m.ratio <= 2.0 && m.ratioFine >= 1.3 && m.ratioFine <= 2.0, `lattice ${m.ratio}x, fine ${m.ratioFine}x`);
        ok(`leg ${leg}: a flood held to rows 0-2 never passes column 66`, m.crustMaxCol <= m.homeCol + 30, `farthest column ${m.crustMaxCol}`);
        if (leg >= 2) {
          ok(`leg ${leg}: the cheapest-water growth route spends >= 50% of its east metres below 42 m`, m.east42 >= 0.5,
             `${(m.east42 * 100).toFixed(1)}% below 42 m, ${(m.east84 * 100).toFixed(1)}% below 84 m, ${m.water} water (fine mask ${(m.east42Fine * 100).toFixed(1)}%)`);
          ok(`leg ${leg}: growth held above 42 m cannot reach the island`, m.shallowMaxCol < m.islandC0,
             `farthest column ${m.shallowMaxCol}, island from ${m.islandC0}`);
        }
        ok(`leg ${leg}: no straight lateral channel 3 cells tall runs more than 36 cells`, m.lateral <= 36,
           `longest ${m.lateral} (row ${m.latAt && m.latAt.row}, ending col ${m.latAt && m.latAt.endCol})`);
        ok(`leg ${leg}: no chunk seam carries a vertical hairline longer than a band (the seam slit is stitched)`, m.seamRunRows <= 42,
           `longest ${m.seamRunRows} rows (chunk ${m.seamAt && m.seamAt.ci}, ending row ${m.seamAt && m.seamAt.endRow})`);
        // (verifier round 2) No floor-strip exemption any more: a journey leg carves no gallery in the
        // floor strip, so every sealed side is one the rock can seal.
        ok(`leg ${leg}: no sealed seam side is crossable within 8 columns and 5 rows`,
           m.sealN > 0 && m.sealLeak === 0 && !(m.leaks || []).length,
           `${m.sealLeak} of ${m.sealN} sides leak${m.leaks.length ? ' at ' + JSON.stringify(m.leaks) : ''}`);
        ok(`leg ${leg}: the row's E agrees with its eastM (island chunk ${extra.ic0})`, extra.E === extra.Eof && extra.ic0 === extra.ic1 && extra.ic0 === 1 + extra.E,
           `E ${extra.E}, from eastM ${extra.Eof}, island chunks ${extra.ic0}..${extra.ic1}`);
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
        // ...and the verifier's own framing: seams 2-4 at rows 45, 70 and 120, whatever is there.
        let framed = 0;
        for (const c of [2, 3, 4]) for (const r of [45, 70, 120]) {
          const z = await b.page.evaluate(async ([c, r]) => {
            const g = window.__game, s = g.state, sub = s.substrate, cs = sub.cellSize, cw = s.config.mine.chunkCols;
            g.mine.lookAt(c * cw * cs, sub.surfaceY + (r + 0.5) * cs);
            await new Promise((q) => setTimeout(q, 500));
            return g.camera.zoom;
          }, [c, r]);
          if (seam && Math.abs(z - seam.z0) < 1e-6) framed++;
          await b.page.screenshot({ path: path.join(ART, `m7-leg${leg}-c${c}-r${r}-390.png`), animations: 'disabled', timeout: 8000 }).catch(() => {});
        }
        // NOT COUNTED (verifier round 3): the frames are for eyes; the zoom they were taken at said nothing
        // about the seams. What they show is asserted over every seam in the `world` block.
        console.log(`  info  leg ${leg}: nine seam frames written (seams 2-4 x rows 45/70/120), ${framed} of 9 at the resting zoom`);
        // Last: it grows the colony across the leg (threats removed, tank topped up).
        const f = await LP.follow(b.page, route);
        ok(`leg ${leg}: real growth (mine.growFrom) following the cheapest route lands at the taproot`, f.landed,
           `${f.digs} digs, ${f.refused} refused, route ${Math.round(f.routeFrac * 100)}% walked, strand chain ${f.chainRatio}x`);
        if (leg >= 2) ok(`leg ${leg}: ...and the landing strand spent >= 50% of its east travel below 42 m`, f.landed && f.east42 >= 0.5,
           `${f.landed ? (f.east42 * 100).toFixed(1) + '% below 42 m, deepest ' + f.maxDepthM + ' m' : 'did not land'}`);
        ok(`no page errors (leg ${leg})`, !b.errs.length, b.errs.slice(0, 2).join(' | '));
        await b.ctx.close();
      }
    }
    // ======================================================================================
    if (want('world')) {
      console.log('--- the whole leg world: rewards, lateral channels, and the seams against an interior line');
      // (verifier round 3) EVERY SEAM GATE IS DERIVED FROM THE INTERIOR — an interior line (6, 8, 12, 16 or
      // 18 cells into a chunk) measured the same way — rather than set between an old build and a new one.
      // Negative control, measured on the round-2 build (d6bb921, same seeds): closed-ground density
      // +0.14 / +0.17 / +0.15 over the chunk's own, drawn solidity by column +0.28 / +0.32 / +0.29 at the
      // seam over the chunk's middle — both gates below fail there. (Its spine, 6.0-7.3 per seam, sits
      // inside 2x an interior line's 90th percentile on legs 1-2; the density gates are what see it.)
      for (const leg of [1, 2, 3]) {
        const b = await LP.openLeg(E, leg);
        const w = await LP.world(b.page);
        // Rewards: the leg joins its CROSSING (head, trunks, taproot) and leaves the rewards to the maze,
        // so some are walled in — the owner's gated content — and most are not (was: every one, round 2).
        ok(`leg ${leg}: >= 85% of ore seams and of water pockets in all ${w.chunks} chunks are reachable from the root (the rest are gated)`,
           w.piles > 0 && w.pilesOk >= 0.85 * w.piles && w.pocketsOk >= 0.85 * w.pockets,
           `seams ${w.pilesOk}/${w.piles}, pockets ${w.pocketsOk}/${w.pockets}${w.strandedAt.length ? ' stranded e.g. ' + JSON.stringify(w.strandedAt.slice(0, 3)) : ''}`);
        ok(`leg ${leg}: every anchor pass (e) joins (head, trunks, taproot) is joined in its own model`, w.unjoined === 0, `${w.unjoined} unjoined`);
        ok(`leg ${leg}: no straight lateral channel 3 cells tall runs more than 36 cells anywhere in the leg world`, w.lateral <= 36,
           `longest ${w.lateral} (row ${w.latAt && w.latAt.row}, ending col ${w.latAt && w.latAt.endCol}); 2 cells tall: ${w.lateral2} (row ${w.lat2At && w.lat2At.row}) — information, acceptance 7 is written at 3`);
        ok(`leg ${leg}: the closed ground at a chunk seam is no denser than the chunk's own (+0.05 at most; was +0.2)`,
           w.seamSolid != null && w.seamSolid - w.midSolid <= 0.05, `closed-ground solidity ${w.seamSolid} within a cell of a seam, ${w.midSolid} 6+ cells in (${(w.seamSolid - w.midSolid).toFixed(3)})`);
        ok(`leg ${leg}: drawn rock at the seam (columns -2..+1) is within 0.15 of the chunk's middle (columns 6-17)`,
           w.bandSol != null && w.bandSol - w.inSol <= 0.15, `${w.bandSol} at the seam, ${w.inSol} in the middle (+${(w.bandSol - w.inSol).toFixed(3)})`);
        ok(`leg ${leg}: a chunk seam is no more a stripe than an interior line (spine rows per seam <= 2x an interior line's 90th percentile; was <= 10)`,
           w.spineSeam != null && w.spineSeam <= 2 * w.spineMid90, `${w.spineSeam} per seam, interior mean ${w.spineMid}, 90th percentile ${w.spineMid90}`);
        ok(`leg ${leg}: no seam carries a longer vertical open run than the longest interior line`,
           w.hairSeam != null && w.hairSeam <= w.hairMid, `seam ${w.hairSeam} rows, interior max ${w.hairMid} (90th percentile ${w.hairMid90})`);
        ok(`no page errors (world, leg ${leg})`, !b.errs.length, b.errs.slice(0, 2).join(' | '));
        await b.ctx.close();
      }
      {
        // INFORMATION ONLY (verifier round 3): the free layout reaches every reward through the seam
        // SLITS it still has — with the four fine columns at every seam forced solid the same flood
        // reaches 4 of 168 — so as a control for the flood it proves nothing, and it is not counted.
        const b = await E.boot('#mine,4242');
        await b.page.waitForFunction(() => !!(window.__game && window.__game.state && window.__game.state.substrate
          && window.__game.state.substrate._fineSolid), { timeout: 40000 });
        const w = await LP.world(b.page);
        console.log(`  info  free layout '#mine,4242': seams ${w.pilesOk}/${w.piles}, pockets ${w.pocketsOk}/${w.pockets} (through the seam slits), lateral ${w.lateral}, 2-tall ${w.lateral2}`);
        await b.ctx.close();
      }
      {
        const b = await E.boot('#leg,1,2', 390, 844, { before: (page) => page.addInitScript(() => { window.MYCELIUM_NO_REWARD_REPAIR = true; }) });
        await b.page.waitForFunction(() => !!(window.__game && window.__game.mine && window.__game.mine.leg && window.__game.mine.leg()
          && window.__game.state.substrate._fineSolid), { timeout: 40000 });
        const w = await LP.world(b.page);
        // (Round 3: not "strands rewards" any more — rewards are no longer pass (e)'s job — and not "does
        // not reach the taproot" either: measured, leg 2 still crosses on the lattice without it, through
        // porous rock the carve's model calls closed. What pass (e) promises is the crossing IN THAT MODEL.)
        ok('negative control: leg 2 with pass (e) switched off (`MYCELIUM_NO_REWARD_REPAIR`) leaves anchors unjoined in the carve\'s model (the assertion above can fail)',
           w.unjoined > 0, `${w.unjoined} unjoined`);
        await b.ctx.close();
      }
    }
    // ======================================================================================
    if (want('stream')) {
      console.log('--- streaming on a leg: one chunk a frame, and a visible chunk always has its neighbour');
      // (verifier round 3) Generation is synchronous (tests/chunkgen-probe.cjs: ~9 ms a chunk on the free
      // layout, 15-25 ms on a leg, headless desktop), so the frame loop makes at most ONE chunk a frame,
      // plus an idle lookahead; and on a leg the view is widened by 5 columns, because a chunk's seam
      // band is bare soil until its neighbour exists (the stitch fills it).
      const b = await E.boot('#leg,1,2', 390, 844, { before: (page) => page.addInitScript(() => { window.MYCELIUM_NO_LOOKAHEAD = true; }) });
      await b.page.waitForFunction(() => !!(window.__game && window.__game.mine && window.__game.mine.leg && window.__game.mine.leg()
        && window.__game.state.substrate._fineSolid), { timeout: 40000 });
      const r = await b.page.evaluate(async () => {
        const g = window.__game, s = g.state, sub = s.substrate, cs = sub.cellSize, cw = s.config.mine.chunkCols;
        const sleep = (ms) => new Promise((q) => setTimeout(q, ms));
        await sleep(800);
        const k = Math.max(...g.mine.chunks());
        // Park the view so its east edge rests 2 columns inside chunk k's east seam.
        const half = (g.camera.viewW || 390) / 2 / g.camera.zoom;
        const edge = ((k + 1) * cw - 2) * cs;
        g.mine.lookAt(edge - half, sub.surfaceY + 20 * cs);
        await sleep(900);
        const had = g.mine.chunks().includes(k + 1);
        return { k, had, log: g.mine.genLog() };
      });
      ok('the neighbour of a chunk whose seam band is on screen is generated (lookahead off, view widened on a leg)', r.had,
         `view's east edge 2 columns inside chunk ${r.k}'s seam: chunk ${r.k + 1} ${r.had ? 'exists' : 'missing'}`);
      ok('...and no frame generated more than one chunk', r.log.length > 0 && r.log.every((e) => e.made <= 1),
         `${r.log.length} generating frames: ${r.log.map((e) => e.made + '@' + e.ms + 'ms').join(' ')}`);
      ok('no page errors (stream)', !b.errs.length, b.errs.slice(0, 2).join(' | '));
      await b.ctx.close();
    }
    // ======================================================================================
    if (want('island')) {
      console.log('--- the taproot repair holds on seeds nobody curated');
      const b = await LP.openLeg(E, 1);
      const res = [];
      for (const leg of [1, 2, 3]) for (let k = 0; k < 4; k++) {
        const sd = ((leg * 7919 + (41 + k) * 104729 + 12345) % 2147483000) + 1;
        await LP.playLeg(b.page, leg, sd);
        const r = await b.page.evaluate(async () => {
          const g = window.__game, s = g.state, sub = s.substrate, cs = sub.cellSize, cw = s.config.mine.chunkCols;
          const lay = g.mine.leg().layout, ic = Math.floor(lay.taproot.col / cw);
          g.mine.ensureChunks((ic - 1) * cw * cs, ((ic + 2) * cw - 1) * cs);
          for (let i = 0; i < 150 && !((sub._solidFrom | 0) === sub.levelSprites.length && sub._mineDirtyC0 == null); i++) await new Promise((q) => setTimeout(q, 100));
          const fsz = sub._fineSize, W = sub._fineCols, fs = sub._fineSolid, K = Math.round(cs / fsz);
          const c0 = ic * cw, c1 = c0 + cw - 1, x0 = c0 * K, x1 = (c1 + 1) * K - 1, H = sub._fineRows;
          const open = (x, y) => x >= x0 && x <= x1 && y >= 0 && y < H && !fs[y * W + x];
          const cx = (x) => (x + 0.5) * fsz, cy = (y) => sub.surfaceY + (y + 0.5) * fsz;
          const seg = (a, bb, c, d) => { const ax = cx(a), ay = cy(bb), dx = cx(c) - ax, dy = cy(d) - ay, n = Math.max(1, Math.ceil(Math.hypot(dx, dy) / (fsz * 0.7)));
            for (let i = 1; i <= n; i++) { const t = i / n, px = ax + dx * t, py = ay + dy * t; if (py <= sub.surfaceY + 2) return false;
              const fc = Math.floor(px / fsz), fr = Math.floor((py - sub.surfaceY) / fsz); if (!open(fc, fr)) return false; } return true; };
          const E8 = []; for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (dx || dy) E8.push([dx, dy]);
          for (const [a, bb] of [[3, 0], [3, 1], [2, 2], [1, 3]]) for (const [sa, sb] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) { E8.push([a * sa, bb * sb]); E8.push([bb * sa, a * sb]); }
          const tx = Math.floor((lay.taproot.col + 0.5) * K), ty = Math.floor((lay.taproot.row + 0.5) * K);
          const seen = new Uint8Array(W * H), st = [];
          if (open(tx, ty)) { seen[ty * W + tx] = 1; st.push([tx, ty]); }
          let west = false, east = false;
          while (st.length) {
            const [x, y] = st.pop();
            if (x < x0 + K) west = true; if (x > x1 - K) east = true;
            for (const [dx, dy] of E8) { const nx = x + dx, ny = y + dy; if (!open(nx, ny) || seen[ny * W + nx] || !seg(x, y, nx, ny)) continue; seen[ny * W + nx] = 1; st.push([nx, ny]); }
          }
          const rec = s.mineChunks[ic] || {};
          return { chamberOpen: st.length === 0 && seen[ty * W + tx] === 1, west, east, repairs: rec.taproot && rec.taproot.repairs, dropped: rec.sealsDropped | 0 };
        });
        res.push(Object.assign({ leg, seed: sd }, r));
      }
      const good = res.filter((r) => r.chamberOpen && (r.west || r.east));
      ok('on 12 uncurated seeds (4 per leg) the chamber is open and its flood reaches the island chunk\'s own seam column',
         good.length === res.length, res.map((r) => `L${r.leg}/${r.seed}: ${r.chamberOpen ? '' : 'CLOSED '}${r.west ? 'W' : ''}${r.east ? 'E' : ''}${r.west || r.east ? '' : 'none'} rep ${r.repairs}`).join(' · '));
      ok('no page errors (island)', !b.errs.length, b.errs.slice(0, 2).join(' | '));
      await b.ctx.close();
    }
  } catch (e) {
    fail++; console.log('  FAIL  harness: ' + (e && e.stack || e));
  } finally { await E.close(); }
  console.log(`\n==== ${pass} passed, ${fail} failed ====`);
  process.exit(fail ? 1 : 0);
})();
