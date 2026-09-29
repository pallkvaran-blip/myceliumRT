/* THE OXALIC VIAL — the finishing plan's M11, as assertions.
 *
 *     node tests/vial-check.cjs      (VIAL_ONLY=dig,thick,shelf,tolerate,ui runs blocks)
 *
 * Every block builds an ARENA in the fine mask next to a real colony ('#mine,4242', threats out): a
 * strand T at the end of a carved corridor, solid rock all round it, a wall of W units east of it and
 * an open chamber beyond with a stamped seam in it. The mask is written directly (the arena is a test
 * fixture); what is asserted is that the DIG never writes it.
 *
 *   dig       acceptance 1, 3, 4: W = 2.5 cells. With no vial armed the dig is 'Solid rock that way';
 *             armed, it lays nodes beyond the wall and claims the seam, the vial count drops by 1, the
 *             fine mask is byte-identical before and after; an ordinary dig from the far end succeeds.
 *   thick     acceptance 2: W = 6 cells: refused ('Too thick for the acid'), vial, water and nodes
 *             unchanged; a wall with rock again right behind it (no open ground) is refused too.
 *   shelf     acceptance 5: the Oxalic vial tile is hidden before leg 3 and on the shelf from leg 3, at
 *             [50 P, 12 G, 12 H]; a purchase reaches the next descent as cfg.mine.items.vial.
 *   tolerate  change 4: a strand inside rock (acidIn) is never a worm's target (no line of sight), never
 *             a claim's bridge source, never the pressed strand of a dig, and the only living strands
 *             inside the fine mask are the tunnel's own; a cloud at the tunnel mouth ticks without errors.
 *   ui        the kit's third button, arming by a real click, the acid-yellow aim arrow and its outline
 *             of the rock (aimAcid), a REAL mouse drag that digs through, and a 390x844 frame.
 * Acceptance 6 (threat, mould and harvest stay green) is the runner's own checks.
 */
const path = require('path');
const H = require('./mine-harness.cjs');
const { sleep } = H;
let pass = 0, fail = 0;
const ok = (n, c, x) => { c ? (pass++, console.log('  PASS  ' + n + (x ? '  — ' + x : ''))) : (fail++, console.log('  FAIL  ' + n + (x ? '  — ' + x : ''))); };
const ART = path.join(H.ROOT, 'tests', '.artifacts');
require('fs').mkdirSync(ART, { recursive: true });
const ONLY = (process.env.VIAL_ONLY || '').split(',').filter(Boolean);
const want = (k) => !ONLY.length || ONLY.includes(k);

// In-page: quiet the world, dig a little, and build the arena. Returns the arena's geometry.
const ARENA = async (W, opts) => {
  const o = opts || {};
  const g = window.__game, s = g.state, sub = s.substrate, net = s.active;
  s.nematodes.length = 0; s.clouds.length = 0;
  s.config.nematodes.respawnChance = 0; s.config.trichoderma.respawnChance = 0;
  if (s.config.mine.worms) s.config.mine.worms.waterPerSec = 0;
  s.config.mine.threatBands = s.config.mine.threatBands.map(() => ({ worms: 0, clouds: 0 }));
  s.config.mine.stuckFruitMs = 1e9;
  net.water = 5000;
  if (!s._vialDug) { await window.__navDig({ targetM: 30, maxIters: 120 }); s._vialDug = true; }
  for (let i = 0; i < 100 && g.mine.revealing(); i++) await new Promise((r) => setTimeout(r, 50));
  net.water = 5000;
  const fs = sub._fineSolid, fsz = sub._fineSize, FC = sub._fineCols, FR = sub._fineRows;
  const setBox = (x0, y0, x1, y1, v) => {
    const c0 = Math.max(0, Math.floor(x0 / fsz)), c1 = Math.min(FC - 1, Math.floor(x1 / fsz));
    const r0 = Math.max(0, Math.floor((y0 - sub.surfaceY) / fsz)), r1 = Math.min(FR - 1, Math.floor((y1 - sub.surfaceY) / fsz));
    for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) fs[r * FC + c] = v;
  };
  // The arena sits EAST of the colony's easternmost clean strand E, at its depth.
  let E = null;
  for (const n of net.nodes) if (!n.infected && (!E || n.x > E.x)) E = n;
  // Every chunk the arena (and the dig's growth out of it) can bring into the streaming pad exists and
  // is stamped BEFORE the arena is written, or a chunk stamped later re-stamps those columns from the
  // sprites and rewrites the fixture (the mask is the sprites' — the arena is not).
  g.mine.ensureChunks(E.x - 1500, E.x + 2600);
  for (let i = 0; i < 40 && (sub._mineDirtyC0 != null || s._mineStampNext); i++) await new Promise((r) => setTimeout(r, 50));
  await new Promise((r) => setTimeout(r, 300));
  const seg = s.config.growth.segmentLength;
  const tx = Math.round((E.x + 400) / fsz) * fsz + fsz * 0.5, ty = Math.round(E.y / fsz) * fsz + fsz * 0.5 + (sub.surfaceY % fsz);
  const wall0 = tx + 4;                         // the wall starts 4 units in front of T
  // Solid rock all round (so no dodge and no neighbour can go round the wall)...
  setBox(E.x + 40, ty - 300, tx + W + 520, ty + 300, 1);
  // ...a corridor from E out to T, and the chamber beyond the wall.
  setBox(E.x - 10, E.y - 14, E.x + 60, E.y + 14, 0);
  setBox(E.x + 40, ty - 14, tx, ty + 14, 0);
  const behind = o.behind || 0;                  // a second rock band this far past the wall (the 'no open ground' case)
  setBox(wall0 + W, ty - 150, wall0 + W + 380, ty + 150, 0);
  if (behind) setBox(wall0 + W + behind, ty - 150, wall0 + W + 380, ty + 150, 1);
  // A chain of strands from E along the corridor to T (grown-in, clean), so T is the only tip out here.
  let par = E;
  const steps = Math.ceil((tx - E.x) / seg);
  if (Math.abs(E.y - ty) > 1) { par = net.addNode(E.x + 30, ty, par); }
  for (let i = 1; i <= steps; i++) {
    const x = Math.min(tx, par.x + seg);
    if (x - par.x < 2) break;
    par = net.addNode(x, ty, par);
  }
  const T = par;
  // The coarse cells in the chamber: no rock flag (a pile cell must not be coarse rock), no water.
  const cs = sub.cellSize;
  for (let y = ty - 140; y <= ty + 140; y += cs) for (let x = wall0 + W + 10; x <= wall0 + W + 370; x += cs) {
    const c = sub.cellAtWorld(x, y); if (c) { c.rock = false; c.water = false; }
  }
  // The seam: 5 cells (a radius-1 diamond), Phosphorus, 120 units past the wall.
  const sx = wall0 + W + 120, sy = ty;
  const col = sub.colAtX(sx), row = sub.rowAtY(sy), cells = [];
  for (const [dc, dr] of [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]]) {
    const c = sub.cellAt(col + dc, row + dr); if (!c) continue;
    c.rock = false; c.nutrient = 50; c.maxNutrient = 50; c.foodKind = 'cache'; c.colonized = 0;
    c.energyPerNutrient = 3 / (5 * 50);
    cells.push(sub.index(col + dc, row + dr));
  }
  const pile = { cells, rewarded: false, kind: 'normal', energyValue: 3, mineMat: 'phosphorus' };
  sub.foodPiles.push(pile);
  if (window.__game.mine.waterRescan) window.__game.mine.waterRescan();
  net.recomputeVitality && net.recomputeVitality();
  return { tx: T.x, ty: T.y, tid: T.id, wall0, W, sx, sy, pileIndex: sub.foodPiles.length - 1, E: { x: E.x, y: E.y } };
};
const FSHASH = () => {
  const fs = window.__game.state.substrate._fineSolid; let h = 2166136261, n = 0;
  for (let i = 0; i < fs.length; i++) { h = Math.imul(h ^ fs[i], 16777619) >>> 0; n += fs[i]; }
  return h + ':' + n + ':' + fs.length;
};

(async () => {
  const E = await H.start();
  const boot = async (vw = 390, vh = 844, opts = {}) => {
    const b = await E.bootMine(4242, vw, vh, Object.assign({ before: async (page) => {
      await page.addInitScript(() => { window.MYCELIUM_NO_LOOKAHEAD = true; window.MYCELIUM_NO_IDLE_LOOKAHEAD = true; });
    } }, opts));
    await b.page.evaluate(() => { window.__ARENA = null; });
    return b;
  };
  try {
    // ======================================================================================
    if (want('dig')) {
      console.log('--- acceptance 1, 3, 4: a 2.5-cell wall between a strand and a seam');
      const b = await boot();
      const r = await b.page.evaluate(async ({ A, F }) => {
        const ARENA = new Function('return (' + A + ')')(), FSHASH = new Function('return (' + F + ')')();
        const g = window.__game, s = g.state, net = s.active, sub = s.substrate;
        const a = await ARENA(90);
        const pile = sub.foodPiles[a.pileIndex];
        const out = { a };
        // 3: with no vial, the same press is 'Solid rock that way'.
        s.mineItems.vial = 0; s._mineArmed = null;
        const n0 = net.nodes.length, w0 = net.water;
        const plain = g.mine.growFrom(a.tx, a.ty, a.tx + 200, a.ty);
        out.plain = { ok: plain.ok, msg: plain.message, nodes: net.nodes.length - n0, water: w0 - net.water };
        // ...and with one in the bag but NOT armed, the same.
        s.mineItems.vial = 2;
        const unarmed = g.mine.growFrom(a.tx, a.ty, a.tx + 200, a.ty);
        out.unarmed = { ok: unarmed.ok, msg: unarmed.message, vial: s.mineItems.vial };
        // The pre-check on its own.
        out.pre = g.mine.tunnel(a.tx, a.ty, a.tx + 200, a.ty);
        // 1: armed, the dig goes through.
        const armed = g.mine.armVial();
        const h0 = FSHASH(), fsCopy = Array.from(sub._fineSolid);
        const nA = net.nodes.length, wA = net.water, idA = net.nextNodeId;
        const dig = g.mine.growFrom(a.tx, a.ty, a.tx + 200, a.ty);
        const h1 = FSHASH();
        let diffCells = 0; for (let i = 0; i < fsCopy.length; i++) if (fsCopy[i] !== sub._fineSolid[i]) diffCells++;
        const fresh = net.nodes.filter((n) => n.id >= idA);
        const beyond = fresh.filter((n) => n.x > a.wall0 + a.W && !sub.solidAtWorld(n.x, n.y));
        out.dig = { ok: dig.ok, msg: dig.message, acid: dig.acid, armed, made: net.nodes.length - nA, water: wA - net.water,
                    cost: dig.cost, vial: s.mineItems.vial, armedAfter: s._mineArmed || null, h0, h1, diffCells,
                    beyond: beyond.length, acidNodes: fresh.filter((n) => n.acid).length, inRock: fresh.filter((n) => n.acidIn).length,
                    maxX: Math.round(Math.max(...fresh.map((n) => n.x)) - a.tx) };
        // The claim needs frames (the reveal, then the arrival window's ticks).
        let claimed = false;
        for (let i = 0; i < 160 && !claimed; i++) {
          await new Promise((res) => setTimeout(res, 50));
          claimed = pile.rewarded || pile.cells.some((ix) => sub.cells[ix].colonized > 0);
        }
        out.claimed = claimed; out.rewarded = !!pile.rewarded;
        // The claim came from open ground: no mat or bridge strand hangs off a strand inside the rock.
        const matsNew = net.nodes.filter((n) => n.id >= idA && n.colon);
        out.mats = matsNew.length;
        out.matFromRock = matsNew.filter((n) => { const p = net.byId.get(n.parentId); return p && p.acidIn; }).length;
        out.h2 = FSHASH();
        // 4: an ordinary dig from the tunnel's far end (its landing strand) succeeds.
        const land = fresh.filter((n) => n.acid && !n.acidIn).sort((p, q) => q.x - p.x)[0] || beyond[0];
        const nB = net.nodes.length;
        const after = g.mine.growFrom(land.x, land.y, land.x + 60, land.y + 120);
        out.after = { ok: after.ok, msg: after.message, made: net.nodes.length - nB, acid: after.acid, from: { x: Math.round(land.x - a.tx) },
                      origin: after.origin ? Math.round(Math.hypot(after.origin.x - land.x, after.origin.y - land.y)) : null, vial: s.mineItems.vial };
        return out;
      }, { A: ARENA.toString(), F: FSHASH.toString() });
      ok('no vial: the press into the wall is refused as solid rock, nothing grown, nothing charged',
         !r.plain.ok && /^Solid rock that way/.test(r.plain.msg) && r.plain.nodes === 0 && r.plain.water === 0, JSON.stringify(r.plain));
      ok('...and with a vial in the bag but not armed, the same', !r.unarmed.ok && /^Solid rock that way/.test(r.unarmed.msg) && r.unarmed.vial === 2, JSON.stringify(r.unarmed));
      ok('the pre-check finds the wall: through ~2.5 cells of rock to open ground', r.pre.ok && r.pre.rock >= 81 && r.pre.rock <= 108,
         `entry ${r.pre.entry && r.pre.entry.toFixed(1)}, exit ${r.pre.exit && r.pre.exit.toFixed(1)}, rock ${r.pre.rock && r.pre.rock.toFixed(1)}, ${r.pre.pts && r.pre.pts.length} nodes`);
      ok('armed: the dig lays nodes beyond the wall, in open ground', r.dig.ok && r.dig.armed === 'vial' && r.dig.beyond >= 2 && r.dig.inRock >= 2,
         `${r.dig.msg} ${r.dig.made} made, ${r.dig.acidNodes} tunnel strands (${r.dig.inRock} inside rock), ${r.dig.beyond} beyond the wall, to +${r.dig.maxX} u`);
      ok('...and claims the seam', r.claimed, `claimed ${r.claimed}, paid ${r.rewarded}`);
      ok('...from open ground: no mat strand hangs off a strand inside the rock', r.mats > 0 && r.matFromRock === 0, `${r.mats} mat strands, ${r.matFromRock} off an encased strand`);
      ok('...the vial count drops by exactly 1, the vial is put away, and the dig charged its ordinary price',
         r.dig.vial === 1 && r.dig.armedAfter === null && r.dig.water === r.dig.cost, `vial 2 -> ${r.dig.vial}, armed ${r.dig.armedAfter}, water -${r.dig.water} (price ${r.dig.cost})`);
      ok('...and the fine mask is byte-identical before and after (and after the claim)', r.dig.h0 === r.dig.h1 && r.dig.diffCells === 0 && r.h2 === r.dig.h0,
         `${r.dig.h0} -> ${r.dig.h1} -> ${r.h2}, ${r.dig.diffCells} cells differ`);
      ok('an ordinary dig from the tunnel\'s far end succeeds, from that strand, spending no vial',
         r.after.ok && r.after.made > 0 && !r.after.acid && r.after.origin === 0 && r.after.vial === 1, JSON.stringify(r.after));
      ok('no page errors (dig)', !b.errs.length, b.errs.slice(0, 2).join(' | '));
      await b.ctx.close();
    }
    // ======================================================================================
    if (want('thick')) {
      console.log('--- acceptance 2: a 6-cell wall is refused');
      const b = await boot();
      const r = await b.page.evaluate(async ({ A, F }) => {
        const ARENA = new Function('return (' + A + ')')(), FSHASH = new Function('return (' + F + ')')();
        const g = window.__game, s = g.state, net = s.active;
        const a = await ARENA(216);
        s.mineItems.vial = 2; g.mine.armVial();
        const n0 = net.nodes.length, w0 = net.water, h0 = FSHASH();
        const r1 = g.mine.growFrom(a.tx, a.ty, a.tx + 200, a.ty);
        const out = { thick: { ok: r1.ok, msg: r1.message, nodes: net.nodes.length - n0, water: w0 - net.water, vial: s.mineItems.vial,
                               armed: s._mineArmed || null, same: FSHASH() === h0 }, pre: g.mine.tunnel(a.tx, a.ty, a.tx + 200, a.ty) };
        return out;
      }, { A: ARENA.toString(), F: FSHASH.toString() });
      ok('a 6-cell wall: refused with \'Too thick for the acid\'', !r.thick.ok && /^Too thick for the acid/.test(r.thick.msg), r.thick.msg);
      ok('...the vial, the water and the colony unchanged (the vial stays armed for another aim)',
         r.thick.vial === 2 && r.thick.water === 0 && r.thick.nodes === 0 && r.thick.armed === 'vial' && r.thick.same, JSON.stringify(r.thick));
      ok('...the pre-check says why: the rock runs past the budget', r.pre.ok === false && r.pre.reason === 'thick' && r.pre.rock > 108,
         `rock ${r.pre.rock && r.pre.rock.toFixed(1)} u, reason ${r.pre.reason}`);
      await b.ctx.close();
      // Rock again right behind a thin wall: the path does not reach open ground.
      const b2 = await boot();
      const r2 = await b2.page.evaluate(async ({ A }) => {
        const ARENA = new Function('return (' + A + ')')();
        const g = window.__game, s = g.state, net = s.active;
        const a = await ARENA(54, { behind: 12 });
        s.mineItems.vial = 1; g.mine.armVial();
        const n0 = net.nodes.length;
        const r1 = g.mine.growFrom(a.tx, a.ty, a.tx + 200, a.ty);
        return { ok: r1.ok, msg: r1.message, nodes: net.nodes.length - n0, vial: s.mineItems.vial };
      }, { A: ARENA.toString() });
      ok('a 1.5-cell wall with rock again 12 units behind it: refused (no open ground on the far side), vial kept',
         !r2.ok && r2.nodes === 0 && r2.vial === 1 && /Too thick|open ground/.test(r2.msg), JSON.stringify(r2));
      ok('no page errors (thick)', !b.errs.length && !b2.errs.length, b.errs.concat(b2.errs).slice(0, 2).join(' | '));
      await b2.ctx.close();
    }
    // ======================================================================================
    if (want('shelf')) {
      console.log('--- acceptance 5: the tile is hidden before leg 3');
      const b = await boot();
      const r = await b.page.evaluate(async () => {
        const g = window.__game, S = g.store;
        const P = () => JSON.parse(localStorage.getItem('mycelium.progress.v2') || '{}');
        const put = (o) => { const p = P(); Object.assign(p, o); localStorage.setItem('mycelium.progress.v2', JSON.stringify(p)); };
        const shelf = () => S.shelf('mine').map((u) => u.id);
        const out = { costs: S.costs('oxalicVial', 'mine') };
        put({ mineRuns: 5, mineStoreVisits: 4, mineSeen: { leg: 2 }, mineJourney: { journey: 1, leg: 2, legs: { 1: { runs: 2, landed: true }, 2: { runs: 1 } } } });
        out.leg2 = shelf();
        put({ mineSeen: { leg: 3 }, mineJourney: { journey: 1, leg: 3, legs: { 1: { runs: 2, landed: true }, 2: { runs: 3, landed: true } } } });
        out.leg3 = shelf();
        put({ mineSeen: {}, mineJourney: { journey: 2, leg: 1, legs: {} } });
        out.j2 = shelf();
        // A hidden track cannot be bought.
        put({ mineSeen: { leg: 2 }, mineJourney: { journey: 1, leg: 2, legs: { 1: { runs: 2, landed: true } } } });
        S.credit(200);
        out.hiddenBuy = S.buy('oxalicVial');
        out.lvl0 = S.level('oxalicVial');
        put({ mineSeen: { leg: 3 }, mineJourney: { journey: 1, leg: 3, legs: { 1: { runs: 2, landed: true }, 2: { runs: 3, landed: true } } } });
        out.buy = S.buy('oxalicVial');
        out.lvl1 = S.level('oxalicVial');
        // The next descent carries it.
        g.mine.playSeed(4242);
        for (let i = 0; i < 100 && !(g.state.substrate && g.state.substrate._fineSolid); i++) await new Promise((res) => setTimeout(res, 100));
        out.items = Object.assign({}, g.state.config.mine.items);
        out.stateItems = Object.assign({}, g.state.mineItems);
        return out;
      });
      ok('the Oxalic vial is priced [50 P, 12 Garnet, 12 Hematite]', JSON.stringify(r.costs) === JSON.stringify([50, { m: 'garnet', n: 12 }, { m: 'hematite', n: 12 }]), JSON.stringify(r.costs));
      ok('...hidden on leg 2, on the shelf from the start of leg 3 (and on a later journey)',
         !r.leg2.includes('oxalicVial') && r.leg3.includes('oxalicVial') && r.j2.includes('oxalicVial'), `leg 2 [${r.leg2}] / leg 3 [${r.leg3}] / journey 2 [${r.j2}]`);
      ok('...a hidden vial cannot be bought; revealed, one can', r.lvl0 === 0 && r.lvl1 === 1, `hidden buy ${JSON.stringify(r.hiddenBuy)}, level ${r.lvl0} -> ${r.lvl1}`);
      ok('...and the next descent carries it (cfg.mine.items.vial -> state.mineItems.vial)', r.items.vial === 1 && r.stateItems.vial === 1, JSON.stringify(r.stateItems));
      ok('no page errors (shelf)', !b.errs.length, b.errs.slice(0, 2).join(' | '));
      await b.ctx.close();
    }
    // ======================================================================================
    if (want('tolerate')) {
      console.log('--- change 4: everything else tolerates strands inside rock');
      const b = await boot();
      const r = await b.page.evaluate(async ({ A }) => {
        const ARENA = new Function('return (' + A + ')')();
        const g = window.__game, s = g.state, net = s.active, sub = s.substrate;
        const a = await ARENA(90);
        s.mineItems.vial = 1; g.mine.armVial();
        const dig = g.mine.growFrom(a.tx, a.ty, a.tx + 200, a.ty);
        for (let i = 0; i < 80 && g.mine.revealing(); i++) await new Promise((res) => setTimeout(res, 50));
        const inR = net.nodes.filter((n) => n.acidIn);
        const out = { dig: dig.ok, inRock: inR.length };
        // The only living strands inside the fine mask are the tunnel's own.
        out.solidNodes = net.nodes.filter((n) => !n.infected && sub.solidAtWorld(n.x, n.y));
        out.solidNotAcid = out.solidNodes.filter((n) => !n.acidIn).length; out.solidNodes = out.solidNodes.length;
        // A dig pressed ON an encased strand grows from a strand in open ground, never from inside the rock.
        const e = inR[0];
        const nn = net.nearestNode(e.x, e.y);
        out.pressedEncased = { nearestIsIn: !!(nn && nn.acidIn) };
        // A worm on the far side of the wall, right up against it, with only encased strands near: it
        // must neither see nor attach to them (line of sight is rock).
        // Right beside an encased strand, 42 units below it inside the rock: within a worm's reach (1.4
        // cells) of it, with rock between them.
        const wx = e.x, wy = a.ty + 42;
        // carve a pocket for the worm (fine + coarse) away from any strand
        const fs = sub._fineSolid, fsz = sub._fineSize, FC = sub._fineCols;
        const pocket = [];
        for (let y = wy - 14; y <= wy + 14; y += fsz) for (let x = wx - 14; x <= wx + 14; x += fsz) {
          const i = Math.floor((y - sub.surfaceY) / fsz) * FC + Math.floor(x / fsz); pocket.push([i, fs[i]]); fs[i] = 0;
        }
        g.mine.spawnWorm(wx, wy);
        const w = s.nematodes[s.nematodes.length - 1];
        s.config.nematodes.sightRadius = 400;
        let attached = 0, sawIn = 0;
        for (let k = 0; k < 30; k++) {
          await new Promise((res) => setTimeout(res, 100));
          if (w.attached) { const host = w.targetId != null && net.byId.get(w.targetId); if (host && host.acidIn) attached++; }
          if (w.targetId != null) { const t = net.byId.get(w.targetId); if (t && t.acidIn) sawIn++; }
        }
        out.worm = { attachedToEncased: attached, targetedEncased: sawIn, attachedAny: !!w.attached,
                     reach: Math.round(Math.hypot(e.x - wx, e.y - wy)) + ' of ' + Math.round(s.config.nematodes.reach * sub.cellSize) };
        s.nematodes.length = 0;
        for (const [i, v] of pocket) fs[i] = v;
        // CONTROL: the same worm in the open chamber beside the tunnel's landing strand attaches.
        const land = net.nodes.filter((n) => n.acid && !n.acidIn).sort((p, q) => q.x - p.x)[0];
        g.mine.spawnWorm(land.x + 8, land.y + 30);
        const w2 = s.nematodes[s.nematodes.length - 1];
        for (let k = 0; k < 60 && !w2.attached; k++) await new Promise((res) => setTimeout(res, 100));
        out.worm.control = !!w2.attached;
        s.nematodes.length = 0;
        // Harvest: a pile stamped right beside an encased strand (on the rock side of the tunnel mouth)
        // is not claimed from inside the rock — the bridge source is never an acidIn strand.
        // (Checked on the engine: colonizeReachablePiles' sources after a fresh claim watermark.)
        const nIds = new Set(net.nodes.map((n) => n.id));
        // A cloud at the tunnel mouth: ticks without errors, and the rot (if any) can be counted.
        g.mine.spawnCloud(a.wall0 - 6, a.ty);
        let err = null;
        try { for (let k = 0; k < 8; k++) g.tickWorld(s); g.renderFrame(performance.now()); } catch (e2) { err = String(e2 && e2.message || e2); }
        out.cloud = { err, rotten: net.nodes.filter((n) => n.infected).length, rottenIn: net.nodes.filter((n) => n.infected && n.acidIn).length };
        out.mats = net.nodes.filter((n) => n.colon && !nIds.has(n.id)).length;
        return out;
      }, { A: ARENA.toString() });
      ok('the acid dig left strands inside the rock', r.dig && r.inRock >= 2, `${r.inRock} acidIn strands`);
      ok('the only living strands inside the fine mask are the tunnel\'s own', r.solidNotAcid === 0 && r.solidNodes >= r.inRock - 0, `${r.solidNodes} in rock, ${r.solidNotAcid} not the tunnel's`);
      ok('a press on an encased strand resolves to a strand in open ground', !r.pressedEncased.nearestIsIn, JSON.stringify(r.pressedEncased));
      ok('a worm within reach of a strand inside the rock, with rock between, never targets or attaches to it',
         r.worm.attachedToEncased === 0 && r.worm.targetedEncased === 0 && !r.worm.attachedAny, JSON.stringify(r.worm));
      ok('...control: the same worm beside the tunnel\'s open landing strand attaches', r.worm.control, JSON.stringify(r.worm));
      ok('a cloud at the tunnel mouth ticks and draws without errors', !r.cloud.err, JSON.stringify(r.cloud));
      ok('no page errors (tolerate)', !b.errs.length, b.errs.slice(0, 2).join(' | '));
      await b.ctx.close();
    }
    // ======================================================================================
    if (want('ui')) {
      console.log('--- the kit button, the acid-yellow aim, a real drag through the wall (390x844)');
      const ctx = await E.browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
      const b = await boot(390, 844, { ctx });
      const r0 = await b.page.evaluate(async ({ A }) => {
        const ARENA = new Function('return (' + A + ')')();
        const g = window.__game, s = g.state;
        const hid0 = (() => { const v = document.getElementById('kit-vial'); return !v || v.hidden || getComputedStyle(v).display === 'none'; })();
        const a = await ARENA(90);
        s.mineItems.vial = 2; s.config.mine.items.vial = 2;
        g.mine.lookAt(a.tx + 60, a.ty + 60);
        for (let i = 0; i < 20; i++) await new Promise((res) => requestAnimationFrame(res));
        const v = document.getElementById('kit-vial'), rc = v.getBoundingClientRect();
        return { a, hid0, shown: !v.hidden && getComputedStyle(v).display !== 'none', rect: { x: rc.left + rc.width / 2, y: rc.top + rc.height / 2, w: rc.width, h: rc.height },
                 n: document.getElementById('kit-vial-n').textContent };
      }, { A: ARENA.toString() });
      ok('the vial\'s kit button is absent with none carried, and shows its count once carried', r0.hid0 && r0.shown && r0.n === '2' && r0.rect.w >= 40, JSON.stringify(r0.rect));
      await b.page.mouse.click(r0.rect.x, r0.rect.y);
      await sleep(250);
      const armed = await b.page.evaluate(() => ({ armed: window.__game.mine.armed(), cls: document.getElementById('kit-vial').classList.contains('armed') }));
      ok('a real click on it arms the vial (and the button shows it)', armed.armed === 'vial' && armed.cls, JSON.stringify(armed));
      // A real drag from T east through the wall.
      const sp = await b.page.evaluate(({ a }) => { const c = window.__game.camera, p = c.worldToScreen(a.tx, a.ty), q = c.worldToScreen(a.tx + 150, a.ty);
        const cv = document.getElementById('game').getBoundingClientRect(); return { x: p.x + cv.left, y: p.y + cv.top, x2: q.x + cv.left, y2: q.y + cv.top }; }, { a: r0.a });
      const w0 = await b.page.evaluate(() => ({ n: window.__game.state.active.nodes.length, vial: window.__game.state.mineItems.vial }));
      await b.page.mouse.move(sp.x, sp.y);
      await b.page.mouse.down();
      for (let k = 1; k <= 10; k++) { await b.page.mouse.move(sp.x + (sp.x2 - sp.x) * k / 10, sp.y + (sp.y2 - sp.y) * k / 10); await sleep(30); }
      await sleep(200);
      const mid = await b.page.evaluate(() => ({ acid: window.__game.mine.aimAcid() }));
      await b.page.screenshot({ path: path.join(ART, 'm11-vial-aim-390.png') }).catch(() => {});
      await b.page.mouse.up();
      await sleep(2500);
      const after = await b.page.evaluate(() => { const s = window.__game.state; return { n: s.active.nodes.length, vial: s.mineItems.vial, armed: s._mineArmed || null,
        acid: s.active.nodes.filter((n) => n.acid).length, segs: (s.active.acidSegs || []).length }; });
      ok('while aiming, the arrow outlines the rock it would cross (through, ~2.5 cells)', mid.acid && mid.acid.ok && mid.acid.exit - mid.acid.entry >= 80, JSON.stringify(mid.acid));
      ok('a real drag digs through: tunnel strands laid, one vial spent, the vial put away',
         after.n > w0.n && after.acid >= 3 && after.vial === w0.vial - 1 && after.armed === null, `nodes +${after.n - w0.n}, ${after.acid} tunnel strands, vial ${w0.vial} -> ${after.vial}`);
      // The tunnel is drawn amber: sample pixels along it against a frame with the pass skipped.
      const px = await b.page.evaluate(async ({ a }) => {
        const g = window.__game, s = g.state, c = g.camera;
        g.mine.lookAt(a.tx + 60, a.ty);
        for (let i = 0; i < 6; i++) await new Promise((res) => requestAnimationFrame(res));
        const cv = document.getElementById('game'), cx = cv.getContext('2d');
        const pts = []; for (let d = 12; d <= 90; d += 12) pts.push(c.worldToScreen(a.wall0 + d, a.ty));
        const dpr = cv.width / cv.getBoundingClientRect().width;
        g.renderFrame(performance.now());
        let amber = 0;
        for (const p of pts) { const d = cx.getImageData(Math.round(p.x * dpr), Math.round(p.y * dpr), 1, 1).data; if (d[0] > 170 && d[1] > 110 && d[2] < 110 && d[0] > d[2] + 60) amber++; }
        return { amber, of: pts.length };
      }, { a: r0.a });
      ok('the tunnel is drawn amber over the rock', px.amber >= px.of - 2, `${px.amber} of ${px.of} samples along the wall amber`);
      await b.page.screenshot({ path: path.join(ART, 'm11-vial-tunnel-390.png') }).catch(() => {});
      ok('no page errors (ui)', !b.errs.length, b.errs.slice(0, 2).join(' | '));
      await ctx.close();
    }
  } catch (e) {
    fail++; console.log('  FAIL  harness error: ' + (e && e.stack || e));
  } finally {
    console.log(`\n==== ${pass} passed, ${fail} failed ====`);
    await E.close();
    process.exit(fail ? 1 : 0);
  }
})();
