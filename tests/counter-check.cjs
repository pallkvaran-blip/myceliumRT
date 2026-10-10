/* THREATS YOU CAN READ AND ANSWER — the finishing plan's M6, as assertions.
 *
 * What was measured on `claude/deep-mine-finish` before the change (phase-1 playtest + probes):
 *   - THE FLASK SAVED 0.1 WATER. `excrete` gave one hit (killHits 3) and a one-tick stick: 2.0 water
 *     drained in the 10 s before it, 1.9 in the 10 s after, the worm still attached.
 *   - BREEDING DEPENDED ON THE MAP'S WIDTH: the world cap of 16 stopped every worm breeding once ~4
 *     chunks existed. Now it stops at 6 ATTACHED worms, with 64 as a safety bound.
 *   - A CLOUD LUNGED IN ~1.6 s from the edge of its sight (moveSpeed 2.5 cells a tick). 0.5 now.
 *   - ONE DOSE LEFT 12 OF 55 STRANDS ROTTEN and three doses cost 32% of the colony (a radius cut).
 *     A dose now cuts out one whole connected patch of rot, and only the rot plus a one-segment
 *     margin; a breach claims ~10-25 strands (firstTouchRings 6, was 12).
 *   - Attached worms were 16 px squiggles, attached from off screen, and the chip pointed nowhere.
 *
 * Blocks (COUNTER_ONLY=flask,breed,cloud,breach,digbreach,digcut,clock,chevron,copy): each on a FRESH context.
 */
const path = require('path');
const H = require('./mine-harness.cjs');
const { sleep } = H;
let pass = 0, fail = 0;
const ok = (n, c, x) => { c ? (pass++, console.log('  PASS  ' + n + (x ? '  — ' + x : ''))) : (fail++, console.log('  FAIL  ' + n + (x ? '  — ' + x : ''))); };
const ONLY = (process.env.COUNTER_ONLY || '').split(',').filter(Boolean);
const want = (k) => !ONLY.length || ONLY.includes(k);
const ART = path.join(H.ROOT, 'tests', '.artifacts');
require('fs').mkdirSync(ART, { recursive: true });

// No creatures, nothing respawning: the block places exactly what it measures.
const QUIET = () => {
  const s = window.__game.state;
  s.nematodes.length = 0; s.clouds.length = 0;
  s.config.nematodes.respawnChance = 0; s.config.trichoderma.respawnChance = 0;
};
// Grow a colony of at least `n` strands near the surface (above band 1, so no seeded worm can see
// it), with a bottomless tank, then let every strand grow in. Pockets are marked tapped so nothing
// refills a tank a block sets.
const COLONY = async ({ n, maxM, QUIET }) => {
  new Function('return (' + QUIET + ')')()();
  const g = window.__game, s = g.state;
  s.active.water = 1e6;
  await window.__navDig({ targetM: maxM, maxIters: 300 });
  const dirs = [[1.4, 0.3], [-1.4, 0.3], [1, 0.8], [-1, 0.8], [0.3, 1], [1.6, -0.2], [-1.6, -0.2]];
  for (let i = 0; i < 80 && s.active.nodes.length < n; i++) {
    const d = dirs[i % dirs.length];
    const cs = s.substrate.cellSize, top = s.substrate.surfaceY;
    const live = s.active.nodes.filter((q) => !q.infected && (q.y - top) / cs <= maxM);
    if (!live.length) break;
    const src = live[(i * 7919) % live.length];
    g.mine.growFrom(src.x, src.y, src.x + d[0] * 80, src.y + d[1] * 80);
    if (i % 3 === 2) await new Promise((res) => setTimeout(res, 60));
  }
  await new Promise((res) => setTimeout(res, 600));
  for (let i = 0; i < 200 && g.mine.revealing(); i++) await new Promise((res) => setTimeout(res, 50));
  await new Promise((res) => setTimeout(res, 700));
  new Function('return (' + QUIET + ')')()();
  const T = s._tappedWater || (s._tappedWater = new Set()); for (const q of (s.substrate.reservoirs || [])) T.add(q.id);
  s.active.water = 1e6;
  return { nodes: s.active.nodes.length, depth: g.mine.depth() };
};

(async () => {
  const E = await H.start();
  const colony = (page, n, maxM) => page.evaluate(COLONY, { n, maxM, QUIET: QUIET.toString() });

  // =========================================================================================
  // 1. THE FLASK — three worms parked attached, one flask
  // =========================================================================================
  if (want('flask')) {
    console.log('--- the flask kills every worm on the colony');
    const b = await E.bootMine(4242);
    const c = await colony(b.page, 60, 20);
    const r = await b.page.evaluate(async () => {
      const g = window.__game, s = g.state;
      s.config.mine.worms.breedPerSec = 0;          // the three we park are the three we measure
      const clean = s.active.nodes.filter((q) => !q.infected);
      const hosts = [clean[Math.floor(clean.length * 0.3)], clean[Math.floor(clean.length * 0.6)], clean[clean.length - 1]];
      for (const h of hosts) g.mine.spawnWorm(h.x + 6, h.y);
      for (let i = 0; i < 40 && g.mine.attached() < 3; i++) await new Promise((res) => setTimeout(res, 100));
      const attachedBefore = g.mine.attached();
      // THE BEFORE WINDOW, as the probe measured it: 10 s of three worms drinking.
      const d0 = g.mine.drained(), w0 = s.active.water;
      await new Promise((res) => setTimeout(res, 10000));
      const beforeDrain = +(g.mine.drained() - d0).toFixed(2), beforeTank = w0 - s.active.water;
      s.mineItems = Object.assign({}, s.mineItems, { excrete: 1 });
      await new Promise((res) => setTimeout(res, 800));
      document.getElementById('kit-excrete').click();
      const turn0 = s.turn;
      const toast = (document.querySelector('.toast .tmsg') || {}).textContent || '';
      // WITHIN ONE TICK: read at the first world step after the burst.
      for (let i = 0; i < 40 && s.turn === turn0; i++) await new Promise((res) => setTimeout(res, 25));
      const attachedTick = g.mine.attached();
      const d1 = g.mine.drained(), w1 = s.active.water;
      await new Promise((res) => setTimeout(res, 10000));
      return { rate: s.config.mine.worms.waterPerSec, attachedBefore, beforeDrain, beforeTank, toast, attachedTick, worms: s.nematodes.length,
               afterDrain: +(g.mine.drained() - d1).toFixed(2), afterTank: w1 - s.active.water,
               flasks: g.mine.items().excrete, chip: document.getElementById('hud-worms').hidden };
    });
    // M14: the rate 0.2 -> 0.15 a worm a second, so the floor is read off the config (was a literal 5.5 = 92% of 3 x 0.2 x 10).
    ok('three worms parked attached drink for 10 s (the before window)', r.attachedBefore === 3 && r.beforeDrain >= 3 * r.rate * 10 * 0.92,
       `${r.attachedBefore} attached, ${r.beforeDrain} drained at ${r.rate}/s each (${r.beforeTank} from the tank), colony ${c.nodes}`);
    ok('one flask: the attached count reads 0 within one tick', r.attachedTick === 0 && r.worms === 0,
       `attached ${r.attachedTick}, ${r.worms} worms left`);
    ok('...the drain over the next 10 s is 0 (probe_counter read 1.9)', r.afterDrain === 0 && r.afterTank === 0,
       `${r.afterDrain} drained, tank -${r.afterTank}`);
    ok('...the toast says killed', /Mucus burst — 3 worms killed/.test(r.toast) && /killed/.test(r.toast), JSON.stringify(r.toast));
    ok('...a charge was spent and the worm chip is gone', r.flasks === 0 && r.chip === true, `flasks ${r.flasks}, chip hidden ${r.chip}`);

    // RANGE: a worm 150 units from a clean strand dies; one 200 units away is untouched; a burst with
    // only that far one costs nothing. And only CLEAN strands count.
    const rg = await b.page.evaluate(async () => {
      const g = window.__game, s = g.state, sub = s.substrate;
      s.nematodes.length = 0;
      const clean = s.active.nodes.filter((q) => !q.infected);
      const far = (x, y) => { let m = Infinity; for (const q of clean) m = Math.min(m, Math.hypot(q.x - x, q.y - y)); return m; };
      const spot = (dist) => {
        for (let k = 0; k < 4000; k++) {
          const h = clean[(k * 131) % clean.length], a = k * 2.399;
          const x = h.x + Math.cos(a) * dist, y = h.y + Math.sin(a) * dist;
          if (y < sub.surfaceY + 20) continue;
          const d = far(x, y);
          if (Math.abs(d - dist) < 6) return { x, y, d };
        }
        return null;
      };
      // M14: the mine's range 160 -> 300 (`CONFIG.mine.excreteRange`), so the two spots sit either side of whatever it is.
      const R = s.config.actions.excrete.range;
      const p150 = spot(R - 50), p200 = spot(R + 40);
      s.mineItems = Object.assign({}, s.mineItems, { excrete: 2 });
      // Worms that cannot see anything: sight 0, so they hold still for the measurement.
      s.config.nematodes.sightRadius = 0;
      g.mine.spawnWorm(p200.x, p200.y);
      const miss = g.mine.useExcrete();
      const afterMiss = g.mine.items().excrete;
      g.mine.spawnWorm(p150.x, p150.y);
      const hit = g.mine.useExcrete();
      const left = s.nematodes.map((w) => Math.round(far(w.x, w.y)));
      return { R, p150: p150 && Math.round(p150.d), p200: p200 && Math.round(p200.d), miss: miss.ok, afterMiss,
               hit: hit.ok, killed: hit.killed, left, flasks: g.mine.items().excrete };
    });
    ok('a burst with nothing within the range (300 since M14; was 160) costs nothing', rg.R === 300 && rg.miss === false && rg.afterMiss === 2,
       `range ${rg.R}, worm at ${rg.p200} u, ok=${rg.miss}, ${rg.afterMiss} flasks`);
    ok('...one 50 inside it dies and the one 40 outside is untouched', rg.hit === true && rg.killed === 1 && rg.left.length === 1
       && rg.left[0] >= rg.R + 30, `killed ${rg.killed} (at ${rg.p150} u), left ${JSON.stringify(rg.left)}, ${rg.flasks} flasks`);
    ok('no page errors', b.errs.length === 0, b.errs.slice(0, 3).join(' | '));
    await b.ctx.close();
  }

  // =========================================================================================
  // 2. BREEDING — stops at 6 attached, however wide the world
  // =========================================================================================
  if (want('breed')) {
    console.log('--- breeding stops at 6 attached worms, not at a world population');
    // FIVE TRIALS IN PARALLEL, one fresh context each, 60 s of real time: 1 worm attached, 6 chunks
    // generated (their seeded worms far below, out of sight), no flask.
    const trial = async (seed) => {
      const b = await E.bootMine(seed);
      await colony(b.page, 40, 16);
      const r = await b.page.evaluate(async () => {
        const g = window.__game, s = g.state;
        const home = g.mine.homeChunk();
        const cw = s.config.mine.chunkCols * s.substrate.cellSize;
        g.mine.ensureChunks((home - 3) * cw + 10, (home + 3) * cw - 10);
        // The seeded worms stay (they are what the old world cap of 16 counted) — but none may be
        // near the colony, so only the one we park can attach.
        const pop0 = s.nematodes.length;
        const tip = s.active.nodes.filter((q) => !q.infected).sort((a, b) => b.y - a.y)[0];
        g.mine.spawnWorm(tip.x + 6, tip.y);
        let maxA = 0, samples = 0;
        const t0 = performance.now();
        while (performance.now() - t0 < 60000) {
          await new Promise((res) => setTimeout(res, 250));
          s.active.water = Math.max(s.active.water, 1e6);   // a trial must not end on fuel
          maxA = Math.max(maxA, g.mine.attached()); samples++;
        }
        return { chunks: g.mine.chunks().length, pop0, pop: s.nematodes.length, final: g.mine.attached(), maxA, samples,
                 cap: s.config.nematodes.maxPopulation, over: !!s.runOver };
      });
      await b.ctx.close();
      return r;
    };
    // Three then two at a time, not five: the box has 4 CPUs and a starved page ticks slowly (verify
    // round 3: the standing "one heavy browser job at a time" rule).
    const rs = (await Promise.all([11, 22, 33].map(trial))).concat(await Promise.all([44, 55].map(trial)));
    for (const [i, r] of rs.entries()) console.log(`        trial ${i + 1}: ${JSON.stringify(r)}`);
    const reach2 = rs.filter((r) => r.maxA >= 2).length;
    ok('6 chunks generated in every trial, under a world bound of 64 (was 16)',
       rs.every((r) => r.chunks >= 6 && r.cap === 64), rs.map((r) => `${r.chunks} chunks / ${r.pop0} seeded worms`).join(', '));
    ok('attached worms reach 2 or more in at least 4 of 5 trials (60 s, no flask)', reach2 >= 4,
       `${reach2} of 5: max attached ${rs.map((r) => r.maxA).join(', ')}`);
    ok('...and never exceed 6', rs.every((r) => r.maxA <= 6), rs.map((r) => r.maxA).join(', '));
    // A trial whose run ENDED stops ticking, and then "never exceed 6" measured nothing (verify round 3).
    ok('...with every trial\'s run still live at the end of its 60 s', rs.every((r) => r.over === false && r.samples >= 100),
       rs.map((r) => `over ${r.over}, ${r.samples} samples`).join(', '));

    // THE CAP ITSELF, deterministically: five worms attached and a certain breed every tick. It must
    // land on exactly 6 and stay there.
    const b = await E.bootMine(909);
    await colony(b.page, 50, 16);
    const cap = await b.page.evaluate(async () => {
      const g = window.__game, s = g.state;
      s.config.mine.worms.breedPerSec = 1;
      const clean = s.active.nodes.filter((q) => !q.infected);
      for (let k = 0; k < 5; k++) { const h = clean[Math.floor((k + 0.5) * clean.length / 5)]; g.mine.spawnWorm(h.x + 5, h.y); }
      let maxA = 0; const t0 = performance.now();
      while (performance.now() - t0 < 8000) { await new Promise((res) => setTimeout(res, 100)); maxA = Math.max(maxA, g.mine.attached()); }
      return { maxA, final: g.mine.attached(), worms: s.nematodes.length };
    });
    ok('a certain breed every tick stops at exactly 6 attached', cap.maxA === 6 && cap.final === 6 && cap.worms === 6,
       JSON.stringify(cap));
    await b.ctx.close();
  }

  // =========================================================================================
  // 3. THE CLOUD — from first sense at 280-300 units, contact takes 6 s or more
  // =========================================================================================
  if (want('cloud')) {
    console.log('--- a cloud that senses you at the edge of its sight takes 6 s or more to arrive');
    const probe = async (seed, speed) => {
      const b = await E.bootMine(seed);
      await colony(b.page, 60, 20);
      const r = await b.page.evaluate(async (speed) => {
        const g = window.__game, s = g.state, sub = s.substrate;
        if (speed != null) s.config.trichoderma.moveSpeed = speed;
        const nodes = s.active.nodes.filter((q) => !q.infected);
        const nearest = (x, y) => { let m = Infinity, best = null; for (const q of nodes) { const d = Math.hypot(q.x - x, q.y - y); if (d < m) { m = d; best = q; } } return { d: m, n: best }; };
        let spot = null;
        for (let k = 0; k < 20000 && !spot; k++) {
          const h = nodes[(k * 7919) % nodes.length], a = k * 2.399, rr = 290;
          const x = h.x + Math.cos(a) * rr, y = h.y + Math.sin(a) * rr;
          if (y < sub.surfaceY + 30 || sub.solidAtWorld(x, y)) continue;
          const nn = nearest(x, y);
          if (nn.d < 280 || nn.d > 300 || !sub.segmentClear(x, y, nn.n.x, nn.n.y)) continue;
          spot = { x, y, d: nn.d };
        }
        if (!spot) return { spot: null };
        // Spawned between ticks, it has not moved: the tick that first sets `sees` senses from HERE.
        // Timed in WORLD TICKS (state.turn), not wall clock: a frame that runs two ticks would
        // otherwise read as the cloud being faster. The sensing tick's own creep is included.
        const turn0 = s.turn;
        g.mine.spawnCloud(spot.x, spot.y);
        const cl = s.clouds[s.clouds.length - 1];
        let senseTurn = null, contactTurn = null, sensedAt = null, contactAt = null;
        const t0 = performance.now();
        while (performance.now() - t0 < 25000) {
          await new Promise((res) => setTimeout(res, 20));
          if (senseTurn == null && cl.sees) { senseTurn = s.turn; sensedAt = performance.now(); }
          if (cl.spent || s.active.nodes.some((q) => q.infected)) { contactTurn = s.turn; contactAt = performance.now(); break; }
        }
        const step = s.config.realtime.stepMs / 1000;
        return { spawnD: Math.round(spot.d), firstTick: senseTurn === turn0 + 1, senseTurn: senseTurn - turn0, contactTurn: contactTurn - turn0,
                 secs: senseTurn != null && contactTurn != null ? +((contactTurn - senseTurn + 1) * step).toFixed(2) : null,
                 wall: sensedAt != null && contactAt != null ? +((contactAt - sensedAt) / 1000).toFixed(2) : null,
                 speed: s.config.trichoderma.moveSpeed };
      }, speed);
      await b.ctx.close();
      return r;
    };
    const res = [];
    for (const seed of [4242, 909, 11, 5, 2024]) { const r = await probe(seed); res.push(r); console.log(`        seed ${seed}: ${JSON.stringify(r)}`); }
    // M14: 0.5 -> 0.4 cells a tick (`CONFIG.mine.trych.moveSpeed`).
    ok('the mine\'s clone creeps at 0.4 cells a tick', res.every((r) => r.speed === 0.4), res.map((r) => r.speed).join(', '));
    // `secs` counts the sensing tick itself (it creeps on that tick): (contact - sense + 1) ticks.
    ok('on 5 seeds, contact takes 6 s or more from first sense at 280-300 units',
       res.every((r) => r.secs != null && r.secs >= 6 && r.firstTick && r.spawnD >= 280 && r.spawnD <= 300),
       res.map((r) => `${r.spawnD} u -> ${r.secs} s (${r.contactTurn - r.senseTurn + 1} ticks, wall ${r.wall} s)`).join(', '));
    const ctl = await probe(4242, 2.5);
    ok('...control: the campaign\'s 2.5 cells a tick arrives in under 3 s', ctl.secs != null && ctl.secs < 3,
       `${ctl.spawnD} u -> ${ctl.secs} s`);
  }

  // =========================================================================================
  // 4. THE BREACH AND THE ENZYME — a 150-strand colony, 5 seeds
  // =========================================================================================
  // A cloud dropped ON a strand with moveSpeed 0 (a probe that lets it creep measures its drift —
  // the breach-probe lesson), the breach read on the tick it lands, then one dose at its centroid.
  const BREACH = async (page, pts) => page.evaluate(async (pts) => {
    const g = window.__game, s = g.state;
    s.config.trichoderma.moveSpeed = 0;
    const clean = s.active.nodes.filter((q) => !q.infected);
    const hosts = pts.map((f) => clean[Math.min(clean.length - 1, Math.floor(f * clean.length))]);
    for (const h of hosts) g.mine.spawnCloud(h.x, h.y);
    for (let i = 0; i < 80 && !s.active.nodes.some((q) => q.infected); i++) await new Promise((res) => setTimeout(res, 25));
    // Every cloud lands on the same tick (one contact pass): read it there, before the creep.
    const rot = s.active.nodes.filter((q) => q.infected);
    return { hosts: hosts.map((h) => ({ x: h.x, y: h.y })), rotten: rot.length, nodes: s.active.nodes.length,
             spent: s.clouds.filter((c) => c.spent).length };
  }, pts);
  const DOSE = async (page, x, y) => page.evaluate(async ({ x, y }) => {
    const g = window.__game, s = g.state;
    const before = s.active.nodes.length, cleanBefore = s.active.nodes.filter((q) => !q.infected).length;
    const hadParent = new Set(s.active.nodes.filter((q) => q.parentId != null).map((q) => q.id));
    s.mineItems = Object.assign({}, s.mineItems, { amputate: Math.max(1, (s.mineItems && s.mineItems.amputate) | 0) });
    const r = g.mine.useAmputate(x, y);
    const turn0 = s.turn;
    for (let i = 0; i < 40 && s.turn === turn0; i++) await new Promise((res) => setTimeout(res, 25));
    const cleanAfter = s.active.nodes.filter((q) => !q.infected).length;
    // An orphan: had a parent before the cut, has none now (`_removeNodes` nulls the link, never cascades).
    const orphans = s.active.nodes.filter((q) => hadParent.has(q.id) && q.parentId == null).length;
    return { ok: r.ok, message: r.message, rot: r.rot, clean: r.clean, removed: before - s.active.nodes.length, said: r.removed, orphans,
             networks: (s.networks || [s.active]).length,
             cleanRemoved: cleanBefore - cleanAfter, rotten: s.active.nodes.filter((q) => q.infected).length,
             infect: s.mineInfect, alive: !!s.active.alive, over: !!s.runOver, nodes: s.active.nodes.length,
             oneNet: s.active.nodes.every((q) => s.active.byId.get(q.id) === q), left: g.mine.items().amputate };
  }, { x, y });
  const centroid = (page) => page.evaluate(() => {
    const rot = window.__game.state.active.nodes.filter((q) => q.infected);
    let x = 0, y = 0; for (const q of rot) { x += q.x; y += q.y; }
    return { x: x / rot.length, y: y / rot.length, n: rot.length };
  });
  if (want('breach')) {
    console.log('--- one breach is one patch of rot, and one dose cuts it out');
    const rows = [];
    for (const seed of [4242, 909, 11, 5, 2024]) {
      const b = await E.bootMine(seed);
      const c = await colony(b.page, 150, 30);
      const br = await BREACH(b.page, [0.55]);
      const cen = await centroid(b.page);
      const d = await DOSE(b.page, cen.x, cen.y);
      rows.push({ seed, colony: c.nodes, breach: br.rotten, dose: d });
      console.log(`        seed ${seed}: colony ${c.nodes}, breach ${br.rotten}, dose ${JSON.stringify({ ok: d.ok, rot: d.rot, clean: d.cleanRemoved, rotten: d.rotten, infect: d.infect, alive: d.alive, nodes: d.nodes })}`);
      await b.ctx.close();
    }
    // A DENSE KNOT (seed 7): ~20 strands under one cloud, recorded at 30-40 before the verify round.
    // Printed, and bounded at 45 — a breach's size is its SEED count (every clean strand the cloud
    // covers), so a regression that multiplies seeds shows here first.
    {
      const b = await E.bootMine(7);
      const c = await colony(b.page, 150, 30);
      const br = await BREACH(b.page, [0.55]);
      const seeds = await b.page.evaluate(() => window.__game.state.active.nodes.filter((q) => q._infSeed).length);
      console.log(`        dense knot, seed 7: colony ${c.nodes}, breach ${br.rotten} (${seeds} seeds)`);
      ok('a dense knot (seed 7) breaches 45 strands or fewer', br.rotten > 0 && br.rotten <= 45, `${br.rotten} rotten, ${seeds} seeds, colony ${c.nodes}`);
      await b.ctx.close();
    }
    ok('each colony is ~150 strands', rows.every((r) => r.colony >= 150 && r.colony <= 260), rows.map((r) => r.colony).join(', '));
    ok('first contact infects 25 strands or fewer, 5/5 seeds', rows.every((r) => r.breach > 0 && r.breach <= 25),
       rows.map((r) => r.breach).join(', '));
    ok('one dose at the breach centroid leaves 0 infected, 5/5', rows.every((r) => r.dose.ok && r.dose.rotten === 0),
       rows.map((r) => `${r.dose.rotten} (${r.dose.message})`).join(' | '));
    ok('...state.mineInfect is null within one tick', rows.every((r) => r.dose.infect === null), rows.map((r) => JSON.stringify(r.dose.infect)).join(', '));
    // Was '...at most 15 clean strands removed' (the plan's bound, with a one-segment margin). The
    // margin is gone (`cutMargin` 'none', verify round 3), so the tile's "only the rot" is the bound.
    ok('...and no clean strand removed — only the rot', rows.every((r) => r.dose.cleanRemoved === 0), rows.map((r) => r.dose.cleanRemoved).join(', '));
    ok('...and the colony stays one live network (orphans keep living)', rows.every((r) => r.dose.alive && !r.dose.over && r.dose.oneNet && r.dose.nodes > 0
         && r.dose.networks === 1 && r.dose.removed === r.dose.said),
       rows.map((r) => `${r.dose.nodes} live, ${r.dose.orphans} orphans kept, removed ${r.dose.removed} of ${r.dose.said} cut, ${r.dose.networks} net`).join(', '));

    // ORPHANS: a breach mid-fan, so clean tissue hangs off the rot. The cut takes the rot and
    // nothing else — the tissue below it keeps living (plan M6 risk).
    {
      const b = await E.bootMine(909);
      await colony(b.page, 150, 30);
      const host = await b.page.evaluate(() => {
        const s = window.__game.state, net = s.active;
        const sub = (n) => { let k = 0; const st = [n]; while (st.length) { const q = st.pop(); k++; for (const c of q.children) { const o = net.byId.get(c); if (o) st.push(o); } } return k; };
        let best = null, bk = 0;
        for (const n of net.nodes) { if (n.parentId == null) continue; const k = sub(n); if (k > bk && k < net.nodes.length * 0.6) { bk = k; best = n; } }
        return { x: best.x, y: best.y, sub: bk };
      });
      await b.page.evaluate(async (h) => {
        const g = window.__game, s = g.state; s.config.trichoderma.moveSpeed = 0; g.mine.spawnCloud(h.x, h.y);
        for (let i = 0; i < 80 && !s.active.nodes.some((q) => q.infected); i++) await new Promise((res) => setTimeout(res, 25));
      }, host);
      const cen = await centroid(b.page);
      const d = await DOSE(b.page, cen.x, cen.y);
      ok('a cut mid-fan orphans clean tissue, which keeps living in the one network', d.ok && d.rotten === 0 && d.orphans > 0
           && d.alive && !d.over && d.networks === 1 && d.removed === d.said,
         `host subtree ${host.sub}, cut ${d.said} (${d.rot} rot + ${d.clean} margin), ${d.orphans} orphans kept, ${d.nodes} live, ${d.networks} net`);
      await b.ctx.close();
    }

    // TWO SEPARATE CONTACTS: two patches, two doses.
    const b = await E.bootMine(4242);
    await colony(b.page, 150, 30);
    const two = await b.page.evaluate(async () => {
      const g = window.__game, s = g.state;
      s.config.trichoderma.moveSpeed = 0;
      const clean = s.active.nodes.filter((q) => !q.infected);
      // The two strands furthest apart, so the breaches cannot meet.
      let A = clean[0], B = clean[1], best = 0;
      for (let i = 0; i < clean.length; i += 3) for (let j = i + 1; j < clean.length; j += 3) {
        const d = Math.hypot(clean[i].x - clean[j].x, clean[i].y - clean[j].y); if (d > best) { best = d; A = clean[i]; B = clean[j]; }
      }
      g.mine.spawnCloud(A.x, A.y); g.mine.spawnCloud(B.x, B.y);
      for (let i = 0; i < 80 && s.active.nodes.filter((q) => q.infected).length === 0; i++) await new Promise((res) => setTimeout(res, 25));
      await new Promise((res) => setTimeout(res, 600));
      return { apart: Math.round(best), A: { x: A.x, y: A.y }, B: { x: B.x, y: B.y }, rotten: s.active.nodes.filter((q) => q.infected).length };
    });
    const d1 = await DOSE(b.page, two.A.x, two.A.y);
    await sleep(1200);
    const mid = await b.page.evaluate(() => ({ on: !!window.__game.state.mineInfect, rotten: window.__game.state.active.nodes.filter((q) => q.infected).length }));
    const d2 = await DOSE(b.page, two.B.x, two.B.y);
    ok('two separate contacts: one dose leaves the clock running', d1.ok && d1.rotten > 0 && mid.on === true,
       `${two.apart} u apart, ${two.rotten} rotten; after dose 1: ${d1.rotten} rotten, clock ${mid.on} (${d1.message})`);
    ok('...and the second dose clears it', d2.ok && d2.rotten === 0 && d2.infect === null, `${d2.rotten} rotten, ${d2.message}`);

    // NO ROT IN REACH: refused, the dose kept (and the arming, through the tap path).
    const miss = await b.page.evaluate(async () => {
      const g = window.__game, s = g.state;
      s.mineItems = Object.assign({}, s.mineItems, { amputate: 1 });
      const tip = s.active.nodes[0];
      const r = g.mine.useAmputate(tip.x, tip.y);
      return { ok: r.ok, noRot: !!r.noRot, message: r.message, left: g.mine.items().amputate, nodes: s.active.nodes.length };
    });
    ok('a dose with no rot within 300 units is refused and kept', miss.ok === false && miss.noRot && miss.left === 1,
       `${miss.message} — ${miss.left} left`);
    ok('no page errors', b.errs.length === 0, b.errs.slice(0, 3).join(' | '));
    await b.ctx.close();
  }

  // =========================================================================================
  // 4b. A BREACH WHILE DIGGING — the cloud creeps in at the mine's own speed while the player digs
  //     toward it (and, second, digs INTO a parked cloud). The breach block above drops a cloud on a
  //     SETTLED colony, which never sees what happens while a dig is arriving: `colonizeReachablePiles`
  //     re-runs every tick of the arrival window and its rot-before-harvest pass used to claim every
  //     strand DOWNSTREAM of one caught in mould — measured 21-104 strands of a ~150 colony at first
  //     contact (verifier probe, tests/breach-real-probe.cjs). The mine turns that claim off
  //     (`trichoderma.harvestRotDescendants` false). COUNTER_CONTROL=1 turns it back on.
  // =========================================================================================
  if (want('digbreach')) {
    console.log('--- a breach while digging toward the mould stays small');
    const CONTROL = process.env.COUNTER_CONTROL === '1';
    const RUN = (page, mode) => page.evaluate(async ({ mode, CONTROL }) => {
      const g = window.__game, s = g.state, sub = s.substrate;
      if (CONTROL) s.config.trichoderma.harvestRotDescendants = true;
      const clean = () => s.active.nodes.filter((q) => !q.infected);
      const tip = clean().sort((a, b) => b.y - a.y)[0];
      // A spot in open ground, in sight of the deepest tip, D away from every strand.
      const D = mode === 'creep' ? 150 : 75;
      let spot = null;
      for (let k = 0; k < 400 && !spot; k++) {
        const a = k * 2.399, x = tip.x + Math.cos(a) * D, y = tip.y + Math.sin(a) * D;
        if (y < sub.surfaceY + 30 || sub.solidAtWorld(x, y) || !sub.segmentClear(tip.x, tip.y, x, y)) continue;
        let m = 1e9; for (const q of clean()) m = Math.min(m, Math.hypot(q.x - x, q.y - y));
        if (m >= D - 20) spot = { x, y };
      }
      if (!spot) return { err: 'no spot' };
      if (mode === 'into') s.config.trichoderma.moveSpeed = 0;
      g.mine.spawnCloud(spot.x, spot.y);
      await new Promise((r) => setTimeout(r, 300));
      let first = null, grows = 0; const t0 = performance.now();
      while (performance.now() - t0 < 20000) {
        const inf = s.active.nodes.filter((q) => q.infected).length;
        if (inf) { first = inf; break; }
        if (grows < 10) {
          const c = clean().sort((a, b) => Math.hypot(a.x - spot.x, a.y - spot.y) - Math.hypot(b.x - spot.x, b.y - spot.y))[0];
          g.mine.growFrom(c.x, c.y, spot.x, spot.y); grows++;
        }
        await new Promise((r) => setTimeout(r, mode === 'creep' ? 700 : 900));
      }
      if (first == null) return { err: 'no contact', grows };
      const t1 = s.turn; for (let i = 0; i < 40 && s.turn === t1; i++) await new Promise((r) => setTimeout(r, 25));
      const rot = s.active.nodes.filter((q) => q.infected);
      let x = 0, y = 0; for (const q of rot) { x += q.x; y += q.y; }
      s.mineItems = Object.assign({}, s.mineItems, { amputate: 1 });
      const d = g.mine.useAmputate(x / rot.length, y / rot.length);
      const t2 = s.turn; for (let i = 0; i < 40 && s.turn === t2; i++) await new Promise((r) => setTimeout(r, 25));
      return { grows, first, next: rot.length, nodes: s.active.nodes.length, ok: d.ok,
               rottenAfter: s.active.nodes.filter((q) => q.infected).length, infect: s.mineInfect, over: !!s.runOver };
    }, { mode, CONTROL });
    const rows = [];
    for (const [mode, seeds] of [['creep', [4242, 909, 11, 5, 2024]], ['into', [909, 2024]]]) {
      for (const seed of seeds) {
        const b = await E.bootMine(seed);
        const c = await colony(b.page, 150, 30);
        const r = await RUN(b.page, mode);
        rows.push(Object.assign({ mode, seed, colony: c.nodes }, r));
        console.log(`        ${mode} seed ${seed}: colony ${c.nodes}, ${JSON.stringify(r)}`);
        await b.ctx.close();
      }
    }
    const creep = rows.filter((r) => r.mode === 'creep'), into = rows.filter((r) => r.mode === 'into');
    const fmt = (rs) => rs.map((r) => r.err || `${r.first} (next tick ${r.next})`).join(', ');
    ok('a cloud creeping onto a colony being dug toward: first contact infects 25 strands or fewer, 5/5 seeds',
       creep.every((r) => !r.err && r.first > 0 && r.first <= 25), fmt(creep));
    ok('...growing into a parked cloud: 25 or fewer, 2/2 seeds', into.every((r) => !r.err && r.first > 0 && r.first <= 25), fmt(into));
    ok('...and one dose at the centroid cures every one', rows.every((r) => !r.err && r.ok && r.rottenAfter === 0 && r.infect === null && !r.over),
       rows.map((r) => r.err || `${r.rottenAfter} left`).join(', '));
  }

  // =========================================================================================
  // 4c. THE ENZYME AFTER DIGGING INTO THE MOULD — the player digs into a parked cloud and keeps
  //     digging (3 more digs) before dosing, so a fresh fan runs beside the rot. With the old
  //     one-segment clean margin a dose cut 11-20 clean strands against 6-16 rot here (verifier: up
  //     to 43), which made the tile's "only the rot" false. CUT_CONTROL=1 restores that margin.
  // =========================================================================================
  if (want('digcut')) {
    console.log('--- one dose after digging into the mould cuts only the rot');
    const P = require('./enzyme-cut-probe.cjs');
    const margin = process.env.CUT_CONTROL === '1' ? 'segment' : null;
    const rows = [];
    for (const seed of [7, 101, 555, 8080]) {
      const b = await E.bootMine(seed);
      await b.page.evaluate(P.COLONY, { n: 150, maxM: 30, QUIET: P.QUIET.toString() });
      const r = await b.page.evaluate(P.DIGCUT, { mode: 'into', margin, after: 3 });
      rows.push(Object.assign({ seed }, r));
      console.log(`        seed ${seed}: ${JSON.stringify(r)}`);
      await b.ctx.close();
    }
    const fmt = (f) => rows.map((r) => r.err || f(r)).join(', ');
    ok('dug into a parked cloud and kept digging: one dose cures, 4/4 seeds',
       rows.every((r) => !r.err && r.doses === 1 && r.rottenAfter === 0 && r.clockNull && !r.over),
       fmt((r) => `${r.doses} dose(s), ${r.rottenAfter} left, clock ${r.clockNull ? 'cleared' : 'running'}`));
    ok('...and it cuts no clean strand — only the rot', rows.every((r) => !r.err && r.rotCut > 0 && r.cleanCut === 0),
       fmt((r) => `[rot ${r.rotCut}, clean ${r.cleanCut}]`));
  }

  // =========================================================================================
  // 5. THE CLOCK — 30 s on a save's first infection, 20 s after
  // =========================================================================================
  if (want('clock')) {
    console.log('--- a save\'s first infection gets 30 s');
    const b = await E.bootMine(909);
    await colony(b.page, 80, 24);
    const first = await BREACH(b.page, [0.5]);
    const r1 = await b.page.evaluate(async () => {
      await new Promise((res) => setTimeout(res, 150));
      const i = window.__game.mine.infect();
      return { left: i.left, banner: document.getElementById('hud-infectn').textContent,
               hint: (document.getElementById('hud-infecthint') || {}).textContent || '' };
    });
    const cen = await centroid(b.page);
    await DOSE(b.page, cen.x, cen.y);
    await sleep(800);
    await BREACH(b.page, [0.2]);
    const r2 = await b.page.evaluate(async () => { await new Promise((res) => setTimeout(res, 150)); return { left: window.__game.mine.infect().left,
      seen: (JSON.parse(localStorage.getItem('mycelium.progress.v2') || '{}').mineSeen || {}).rot }; });
    ok('the first infection clock on a fresh save reads 30 s', first.rotten > 0 && r1.left > 29 && r1.left <= 30 && r1.banner === '30',
       `left ${r1.left && r1.left.toFixed(2)} s, banner "${r1.banner}"`);
    ok('...the next one reads 20 s', r2.left > 19 && r2.left <= 20, `left ${r2.left && r2.left.toFixed(2)} s`);
    ok('...and the save remembers it (p.mineSeen.rot)', r2.seen === true, String(r2.seen));
    // A NEW DESCENT on the same save: 20 s from the start.
    const r3 = await b.page.evaluate(async () => {
      const g = window.__game; g.mine.playSeed(909);
      for (let i = 0; i < 150 && !(g.state.substrate && g.state.substrate._fineSolid); i++) await new Promise((res) => setTimeout(res, 100));
      await new Promise((res) => setTimeout(res, 1200));
      return { firstRot: g.state.config.mine.firstRot };
    });
    await b.page.evaluate(() => {});
    await require('./mine-harness.cjs').injectNav(b.page);
    await colony(b.page, 60, 20);
    await BREACH(b.page, [0.5]);
    const r4 = await b.page.evaluate(async () => { await new Promise((res) => setTimeout(res, 150)); return window.__game.mine.infect().left; });
    ok('...a later descent\'s first infection reads 20 s too', r3.firstRot === false && r4 > 19 && r4 <= 20, `firstRot ${r3.firstRot}, left ${r4 && r4.toFixed(2)} s`);
    ok('the rot banner says what to do', /enzyme|fruit/i.test(r1.hint), JSON.stringify(r1.hint));
    ok('no page errors', b.errs.length === 0, b.errs.slice(0, 3).join(' | '));
    await b.ctx.close();
  }

  // =========================================================================================
  // 6. AN ATTACHED WORM CAN BE FOUND — edge chevrons and the chip that points
  // =========================================================================================
  if (want('chevron')) {
    console.log('--- an off-screen attached worm is pointed at');
    const b = await E.bootMine(4242);
    await colony(b.page, 90, 20);
    const r = await b.page.evaluate(async () => {
      const g = window.__game, s = g.state;
      s.config.mine.worms.breedPerSec = 0; s.config.mine.worms.waterPerSec = 0;
      const clean = s.active.nodes.filter((q) => !q.infected);
      // The strand furthest from the root sideways, so a pan can put it off screen.
      let host = clean[0];
      for (const q of clean) if (Math.abs(q.x - s.active.root.x) > Math.abs(host.x - s.active.root.x)) host = q;
      g.mine.spawnWorm(host.x + 5, host.y);
      for (let i = 0; i < 40 && g.mine.attached() < 1; i++) await new Promise((res) => setTimeout(res, 100));
      const w = s.nematodes[0];
      // On screen first: the ring, no chevron.
      g.mine.lookAt(w.x, w.y);
      await new Promise((res) => setTimeout(res, 400));
      const onChev = g.mine.chevrons().length;
      // Pan well away: the worm is off screen.
      const side = w.x > s.active.root.x ? -1 : 1;
      g.mine.lookAt(w.x + side * 900, w.y - 200);
      await new Promise((res) => setTimeout(res, 400));
      const q = g.camera.worldToScreen(w.x, w.y);
      const off = q.x < 0 || q.y < 0 || q.x > g.camera.viewW || q.y > g.camera.viewH;
      const chev = g.mine.chevrons();
      return { attached: g.mine.attached(), onChev, off, chev, worm: { x: w.x, y: w.y }, view: { w: g.camera.viewW, h: g.camera.viewH } };
    });
    await b.page.screenshot({ path: path.join(ART, 'm6-chevron-390.png'), timeout: 8000, animations: 'disabled' }).catch(() => {});
    ok('an attached worm on screen draws no chevron', r.attached === 1 && r.onChev === 0, `attached ${r.attached}, ${r.onChev} chevrons`);
    const c0 = r.chev[0] || {};
    ok('off screen, chevrons().length is 1, on the screen edge', r.off && r.chev.length === 1
       && c0.x >= 0 && c0.x <= r.view.w && c0.y >= 0 && c0.y <= r.view.h
       && (c0.x <= 30 || c0.x >= r.view.w - 30 || c0.y <= 240 || c0.y >= r.view.h - 90),
       `off=${r.off}, ${JSON.stringify(r.chev)}`);
    // STRAIGHT UP: the chevron sits below the HUD stack (rows, rot banner, hint), not on it. A fixed
    // 100 px margin put it on the worm tip / rot banner at 390 px.
    const up = await b.page.evaluate(async (w) => {
      const g = window.__game;
      g.mine.lookAt(w.x, w.y + 1500);
      await new Promise((res) => setTimeout(res, 500));
      const top = document.getElementById('game').getBoundingClientRect().top;
      let band = 0;
      for (const sel of ['.minerows', '#hud-infect', '#minehint']) {
        const n = document.querySelector('#ui > .hud.minehud ' + sel);
        if (!n || n.hidden) continue; const rr = n.getBoundingClientRect(); if (rr.height > 0) band = Math.max(band, rr.bottom - top);
      }
      return { chev: g.mine.chevrons(), band: Math.round(band) };
    }, r.worm);
    await b.page.screenshot({ path: path.join(ART, 'm6-chevron-up-390.png'), timeout: 8000, animations: 'disabled' }).catch(() => {});
    const cu = up.chev[0] || {};
    ok('...a worm straight above points from below the HUD stack, not over it', up.chev.length === 1 && up.band > 0 && cu.y > up.band + 8 && cu.y < up.band + 60,
       `chevron y ${cu.y}, HUD stack bottom ${up.band}`);
    // THE CHIP, pressed for real.
    await b.page.click('#hud-worms', { timeout: 4000 }).catch((e) => console.log('   click failed: ' + e.message));
    await sleep(300);
    const after = await b.page.evaluate((w) => ({ d: Math.round(Math.hypot(window.__game.camera.x - w.x, window.__game.camera.y - w.y)),
      chev: window.__game.mine.chevrons().length }), r.worm);
    ok('tapping #hud-worms moves the camera to within 100 units of it', after.d <= 100, `${after.d} u, ${after.chev} chevrons after`);
    // THE LOOK: 2.5x worm, and the ring on its host strand.
    await b.page.screenshot({ path: path.join(ART, 'm6-attached-390.png'), timeout: 8000, animations: 'disabled' }).catch(() => {});
    const px = await b.page.evaluate(async (w) => {
      // Pixels in a ring around the host: the pulsing ring is warm red.
      const g = window.__game, s = g.state;
      // Both ends of the 1 Hz beat (pulse = sin(2*pi*t/1000)): t = 250 mod 1000 is the widest, faintest
      // ring, 750 the tightest. A single frame at an arbitrary time measured the phase, not the ring.
      const cv = document.getElementById('game'), ctx = cv.getContext('2d');
      const count = (t) => {
        g.renderFrame(t);
        const q = g.camera.worldToScreen(w.x, w.y), k = cv.width / cv.clientWidth;
        const R = 34 * k, img = ctx.getImageData(Math.max(0, q.x * k - R), Math.max(0, q.y * k - R), 2 * R, 2 * R).data;
        let red = 0; for (let i = 0; i < img.length; i += 4) if (img[i] > 170 && img[i + 1] < 140 && img[i + 2] < 120) red++;
        return red;
      };
      const base = Math.ceil(performance.now() / 1000) * 1000;
      const out = { wide: count(base + 250), tight: count(base + 750) };
      // The dead-end glow lit ON the same tip (verify round: two mint glows hid the ring). The ring
      // is drawn after the glow now, so it keeps its red.
      const o = s._mineOnb || (s._mineOnb = {});
      const saved = o.glow;
      o.glow = { tips: [{ id: -1, x: w.x, y: w.y, ang: Math.PI / 2, clear: 60 }], until: base + 1e7, at: base };
      out.glowWide = count(base + 1250); out.glowTight = count(base + 1750);
      o.glow = saved;
      return out;
    }, r.worm);
    ok('the attached worm wears a red ring, at both ends of its pulse', px.wide > 40 && px.tight > 40,
       `${px.wide} / ${px.tight} red px within 34 px of the worm (wide / tight)`);
    ok('...and keeps it under a dead-end glow lit on the same tip', px.glowWide > 40 && px.glowTight > 40,
       `${px.glowWide} / ${px.glowTight} red px with the glow on (wide / tight)`);

    // ROT OFF SCREEN, WHILE ITS CLOCK RUNS: a chevron points at it, and the rot banner pans to it.
    const rc = await b.page.evaluate(async (w) => {
      const g = window.__game, s = g.state;
      s.nematodes.length = 0;
      s.config.mine.infectionMs = 600000; s.config.mine.firstInfectionMs = 600000;
      s.config.trichoderma.moveSpeed = 0;
      const clean = s.active.nodes.filter((q) => !q.infected);
      let host = clean[0];
      for (const q of clean) if (Math.hypot(q.x - w.x, q.y - w.y) > Math.hypot(host.x - w.x, host.y - w.y)) host = q;
      g.mine.spawnCloud(host.x, host.y);
      for (let i = 0; i < 80 && !g.mine.infect().rotten; i++) await new Promise((res) => setTimeout(res, 50));
      g.mine.lookAt(host.x + (host.x > s.active.root.x ? -1500 : 1500), host.y - 300);
      await new Promise((res) => setTimeout(res, 500));
      const rotOn = s.active.nodes.some((q) => { if (!q.infected) return false; const p = g.camera.worldToScreen(q.x, q.y);
        return p.x >= 0 && p.y >= 0 && p.x <= g.camera.viewW && p.y <= g.camera.viewH; });
      return { rotten: g.mine.infect().rotten, on: !!s.mineInfect, rotOn, chev: g.mine.rotChevron(), view: { w: g.camera.viewW, h: g.camera.viewH } };
    }, r.worm);
    await b.page.screenshot({ path: path.join(ART, 'm6-rotchevron-390.png'), timeout: 8000, animations: 'disabled' }).catch(() => {});
    const rv = rc.chev || {};
    ok('rot off screen while its clock runs: a chevron on the screen edge points at it', rc.rotten > 0 && rc.on && !rc.rotOn && !!rc.chev
       && rv.x >= 0 && rv.x <= rc.view.w && rv.y >= 0 && rv.y <= rc.view.h,
       `${rc.rotten} rotten, clock ${rc.on}, rot on screen ${rc.rotOn}, chevron ${JSON.stringify(rc.chev)}`);
    await b.page.click('#hud-infect', { timeout: 4000 }).catch((e) => console.log('   click failed: ' + e.message));
    await sleep(400);
    const ra = await b.page.evaluate(() => { const g = window.__game, s = g.state;
      // On screen and clear of the HUD stack is the player-facing property; the camera cannot always
      // centre it (a clamp keeps the view off the sky, so rot near the surface sits above centre).
      let d = Infinity, seen = 0;
      for (const q of s.active.nodes) if (q.infected) {
        d = Math.min(d, Math.hypot(q.x - g.camera.x, q.y - g.camera.y));
        const p = g.camera.worldToScreen(q.x, q.y);
        if (p.x >= 0 && p.x <= g.camera.viewW && p.y >= 160 && p.y <= g.camera.viewH - 90) seen++;
      }
      return { d: Math.round(d), seen, chev: g.mine.rotChevron() }; });
    ok('...tapping the rot banner brings the rot on screen, below the HUD, and the chevron goes', ra.seen > 0 && ra.chev === null,
       `${ra.seen} rotten strands on screen, nearest ${ra.d} u from the view centre, chevron ${JSON.stringify(ra.chev)}`);
    ok('no page errors', b.errs.length === 0, b.errs.slice(0, 3).join(' | '));
    await b.ctx.close();
  }

  // =========================================================================================
  // 7. THE COPY — tiles, the first worm, the first rot
  // =========================================================================================
  if (want('copy')) {
    console.log('--- the words say what the items do');
    const b = await E.bootMine(909);
    const tiles = await b.page.evaluate(() => {
      const u = window.__game.store.upgrades;
      const f = (id) => { const t = (u.find ? u.find((x) => x.id === id) : u[id]) || {}; return String(t.effect || '').replace(/<[^>]+>/g, ''); };
      return { flask: f('excreteCharges'), enzyme: f('amputateCharges') };
    });
    ok('flask tile: \'Kills every worm on or near the colony.\'', /^Kills every worm on or near the colony\./.test(tiles.flask), JSON.stringify(tiles.flask));
    ok('enzyme tile: \'Tap the rot: one dose cuts out one whole patch of rot, and only the rot.\'',
       /^Tap the rot: one dose cuts out one whole patch of rot, and only the rot\./.test(tiles.enzyme), JSON.stringify(tiles.enzyme));
    await colony(b.page, 70, 20);
    const w = await b.page.evaluate(async () => {
      const g = window.__game, s = g.state;
      s.config.mine.worms.breedPerSec = 0;
      s.mineItems = Object.assign({}, s.mineItems, { excrete: 1, amputate: 1 });
      const tip = s.active.nodes.filter((q) => !q.infected).sort((a, b) => b.y - a.y)[0];
      g.mine.spawnWorm(tip.x + 5, tip.y);
      let hint = '';
      for (let i = 0; i < 60 && !/worm/i.test(hint); i++) { await new Promise((res) => setTimeout(res, 100)); hint = document.getElementById('minehint').textContent; }
      return { hint, rec: !!(JSON.parse(localStorage.getItem('mycelium.progress.v2') || '{}').mineTips || {}).first_worm };
    });
    ok('the first worm to attach brings a one-time tip naming the flask', /worm is drinking your water/.test(w.hint) && /flask/i.test(w.hint) && w.rec,
       `${JSON.stringify(w.hint)}, recorded ${w.rec}`);
    await b.page.evaluate(() => { const s = window.__game.state; s.nematodes.length = 0; });
    await BREACH(b.page, [0.4]);
    const rt = await b.page.evaluate(async () => {
      let hint = '';
      for (let i = 0; i < 60 && !/Rot!/.test(hint); i++) { await new Promise((res) => setTimeout(res, 100)); hint = document.getElementById('minehint').textContent; }
      return { hint, rec: !!(JSON.parse(localStorage.getItem('mycelium.progress.v2') || '{}').mineTips || {}).first_rot,
               banner: document.getElementById('hud-infecthint').textContent };
    });
    await b.page.screenshot({ path: path.join(ART, 'm6-rot-390.png'), timeout: 8000, animations: 'disabled' }).catch(() => {});
    ok('the first rot brings \'Rot! Arm the enzyme and tap the rot.\'', rt.hint === 'Rot! Arm the enzyme and tap the rot.' && rt.rec, `${JSON.stringify(rt.hint)}, recorded ${rt.rec}`);
    ok('...and the banner reads \'tap the enzyme, then the rot\'', rt.banner === 'tap the enzyme, then the rot', JSON.stringify(rt.banner));
    // ARMING, then a real tap on the rot: the banner follows, the tap cuts the patch.
    const arm = await b.page.evaluate(async () => {
      document.getElementById('kit-amputate').click();
      await new Promise((res) => setTimeout(res, 700));
      const rot = window.__game.state.active.nodes.filter((q) => q.infected);
      let x = 0, y = 0; for (const q of rot) { x += q.x; y += q.y; }
      const sp = window.__game.camera.worldToScreen(x / rot.length, y / rot.length);
      window.__game.mine.lookAt(x / rot.length, y / rot.length);
      await new Promise((res) => setTimeout(res, 300));
      const sp2 = window.__game.camera.worldToScreen(x / rot.length, y / rot.length);
      const r = document.getElementById('game').getBoundingClientRect();
      return { banner: document.getElementById('hud-infecthint').textContent, armed: window.__game.mine.armed(),
               px: r.left + sp2.x, py: r.top + sp2.y, rotten: rot.length };
    });
    await b.page.mouse.click(arm.px, arm.py);
    await sleep(700);
    const cut = await b.page.evaluate(() => ({ rotten: window.__game.state.active.nodes.filter((q) => q.infected).length,
      infect: window.__game.state.mineInfect, toast: (document.querySelector('.toast .tmsg') || {}).textContent || '',
      doses: window.__game.mine.items().amputate, banner: !document.getElementById('hud-infect').hidden }));
    ok('armed, the banner reads \'now tap the rot\'', arm.armed === 'amputate' && arm.banner === 'now tap the rot', `${arm.armed}, ${JSON.stringify(arm.banner)}`);
    ok('...and a real tap on the rot cuts the patch out and clears the clock', cut.rotten === 0 && cut.infect === null && cut.doses === 0 && !cut.banner
       && /the colony is clean/.test(cut.toast), `${arm.rotten} -> ${cut.rotten} rotten, ${JSON.stringify(cut.toast)}`);
    ok('no page errors', b.errs.length === 0, b.errs.slice(0, 3).join(' | '));
    await b.ctx.close();

    // AN EMPTY KIT ON A FRESH SAVE (verify round 3): the store's flask and enzyme tiles only appear
    // once a second descent is banked (M5 `mineShelfOpen`), so a run-1 player told "in the store"
    // was sent to a tile that is not there. The tips say "soon" until the shelf is open — with the
    // shelf-open save as the control, which must still say "in the store".
    const EMPTY = async (page, open) => page.evaluate(async (open) => {
      const g0 = window.__game;
      if (open) { g0.store.revealAll(); g0.mine.playSeed(909); await new Promise((res) => setTimeout(res, 1500)); }
      return JSON.parse(localStorage.getItem('mycelium.progress.v2') || '{}').mineRuns | 0;
    }, open);
    const WORMTIP = (page) => page.evaluate(async () => {
      const g = window.__game, s = g.state;
      s.config.mine.worms.breedPerSec = 0;
      s.mineItems = Object.assign({}, s.mineItems, { excrete: 0, amputate: 0 });
      const tip = s.active.nodes.filter((q) => !q.infected).sort((a, b) => b.y - a.y)[0];
      g.mine.spawnWorm(tip.x + 5, tip.y);
      let hint = '';
      for (let i = 0; i < 60 && !/worm/i.test(hint); i++) { await new Promise((res) => setTimeout(res, 100)); hint = document.getElementById('minehint').textContent; }
      s.nematodes.length = 0;
      return hint;
    });
    {
      const f = await E.bootMine(909);
      const runs = await EMPTY(f.page, false);
      await colony(f.page, 70, 20);
      const wt = await WORMTIP(f.page);
      await f.page.evaluate(() => { window.__game.state.mineItems.amputate = 0; });
      await BREACH(f.page, [0.4]);
      const rh = await f.page.evaluate(async () => {
        let hint = '';
        for (let i = 0; i < 60 && !/Rot!/.test(hint); i++) { await new Promise((res) => setTimeout(res, 100)); hint = document.getElementById('minehint').textContent; }
        return hint;
      });
      ok('a fresh save with an empty kit: the worm tip says the store will stock flasks soon, not that it has them',
         runs < 2 && wt === 'A worm is drinking your water. Mucus flasks kill worms — the store will stock them soon.', `mineRuns ${runs}, ${JSON.stringify(wt)}`);
      ok('...and the rot tip says the store will sell a cure soon', rh === 'Rot! In 30 s the colony fruits — the store will sell a cure soon.', JSON.stringify(rh));
      await f.ctx.close();
      const o = await E.bootMine(909);
      const runs2 = await EMPTY(o.page, true);
      await colony(o.page, 70, 20);
      const wt2 = await WORMTIP(o.page);
      ok('...control: once the shelf is open (2 descents banked) it says "in the store"', runs2 >= 2
         && wt2 === 'A worm is drinking your water. Mucus flasks kill worms — in the store.', `mineRuns ${runs2}, ${JSON.stringify(wt2)}`);
      ok('no page errors (empty-kit tips)', f.errs.length === 0 && o.errs.length === 0, f.errs.concat(o.errs).slice(0, 3).join(' | '));
      await o.ctx.close();
    }
  }

  console.log(`\n==== ${pass} passed, ${fail} failed ====`);
  await E.close();
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
