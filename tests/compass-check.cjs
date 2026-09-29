/* THE COMPASSES — the finishing plan's M10, as assertions.
 *
 *     node tests/compass-check.cjs      (COMPASS_ONLY=shelf,none,bearing,rich,order,idle,hud runs blocks)
 *
 *   shelf    the tracks and prices (island [12, 40 P], one per deep material generated from
 *            CONFIG.mine.materials), the reveal gates (store visit 2 on a journey save; a material's first
 *            seam), a real purchase folding into cfg.mine.compass on the next descent, and the store tile.
 *   none     acceptance 1: nothing bought -> compass() is [] and the screen edges are pixel-identical to a
 *            frame with the compass renderer switched off (MYCELIUM_NO_COMPASS); control: one rung bought
 *            draws something there.
 *   bearing  acceptance 2: every needle's bearing within 2 deg of atan2(target - focus) and its distance
 *            within 1 m, off targets recomputed here from the substrate (taproot; nearest unclaimed seam);
 *            the DRAWN needle sits on that bearing from the focus strand's screen point and its label
 *            prints the metres; a rock sprite stamped between focus and target changes neither.
 *   rich     acceptance 3: rung 3 targets the unclaimed seam with the highest value within 90 m (nearest
 *            among equals); a claimed seam is skipped; with nothing within 90 m it falls back to the
 *            nearest; rung 2 is the nearest (control).
 *   order    acceptance 4: '#mine,4242' with the idle look-ahead ON (chunks made in idle slots) and a boot
 *            with every look-ahead OFF generating chunks in REVERSE give identical chunk records, rock and
 *            seams for all 21 chunks.
 *   idle     acceptance 5: the idle look-ahead makes chunks, each in an idle slot of its own and stamped in
 *            the next; no long task over 50 ms overlaps any of those slots (PerformanceObserver 'longtask').
 *   hud      acceptance 7: at 390x844 with the whole HUD up (rows stacked, rot banner, hint, gear, kit,
 *            FRUIT NOW) and four needles swept round 36 bearings from three focus positions, no drawn needle
 *            rect intersects a HUD rect; the worm chevrons (which share the placement) do not either.
 */
const path = require('path');
const H = require('./mine-harness.cjs');
const { sleep } = H;
let pass = 0, fail = 0;
const ok = (n, c, x) => { c ? (pass++, console.log('  PASS  ' + n + (x ? '  — ' + x : ''))) : (fail++, console.log('  FAIL  ' + n + (x ? '  — ' + x : ''))); };
const ART = path.join(H.ROOT, 'tests', '.artifacts');
require('fs').mkdirSync(ART, { recursive: true });
const ONLY = (process.env.COMPASS_ONLY || '').split(',').filter(Boolean);
const want = (k) => !ONLY.length || ONLY.includes(k);

const QUIET = () => {
  const s = window.__game.state;
  s.nematodes.length = 0; s.clouds.length = 0;
  s.config.nematodes.respawnChance = 0; s.config.trichoderma.respawnChance = 0;
  if (s.config.mine.worms) s.config.mine.worms.waterPerSec = 0;
  s.config.mine.threatBands = s.config.mine.threatBands.map(() => ({ worms: 0, clouds: 0 }));
};
const bootLeg = async (E, leg, vw = 390, vh = 844, opts = {}) => {
  const b = await E.boot('#leg,1,' + leg, vw, vh, opts);
  await b.page.waitForFunction(() => !!(window.__game && window.__game.mine && window.__game.mine.leg
    && window.__game.mine.leg() && window.__game.state.substrate._fineSolid), { timeout: 40000 });
  await sleep(1200);
  await H.injectNav(b.page);
  return b;
};
// Independent targets, recomputed from the substrate (not through mineCompassModel).
const TRUTH = () => {
  const g = window.__game, s = g.state, sub = s.substrate, cs = sub.cellSize, net = s.active;
  const f = s._mineFocus && net.byId.get(s._mineFocus.id);
  let focus = f && !f.infected ? f : null;
  if (!focus) for (const n of net.nodes) if (!n.infected && (!focus || n.y > focus.y)) focus = n;
  const out = { focus: { x: focus.x, y: focus.y, id: focus.id }, t: {} };
  const J = sub.mineJourney;
  if (J && J.taproot) out.t.compassIsland = { x: (J.taproot.col + 0.5) * cs, y: sub.surfaceY + (J.taproot.row + 0.5) * cs };
  for (const m of s.config.mine.materials) {
    let best = null, bd = Infinity;
    for (const pile of sub.foodPiles) {
      if (pile.mineMat !== m.id || pile.rewarded) continue;
      if (pile.cells.some((i) => sub.cells[i] && sub.cells[i].colonized > 0)) continue;
      let sx = 0, sy = 0; for (const i of pile.cells) { sx += (i % sub.cols + 0.5) * cs; sy += sub.surfaceY + ((i / sub.cols | 0) + 0.5) * cs; }
      const c = { x: sx / pile.cells.length, y: sy / pile.cells.length };
      const d = Math.hypot(c.x - focus.x, c.y - focus.y);
      if (d < bd) { bd = d; best = c; }
    }
    if (best) out.t['compass_' + m.id] = best;
  }
  return out;
};

(async () => {
  const E = await H.start();
  try {
    // ======================================================================================
    if (want('shelf')) {
      console.log('--- the tracks, the reveal and a real purchase');
      const b = await bootLeg(E, 2);
      const r = await b.page.evaluate(async () => {
        const g = window.__game, S = g.store;
        const P = () => JSON.parse(localStorage.getItem('mycelium.progress.v2') || '{}');
        const put = (o) => { const p = P(); Object.assign(p, o); localStorage.setItem('mycelium.progress.v2', JSON.stringify(p)); };
        const ids = S.ids('mine');
        const costs = {}; for (const id of ids.filter((i) => /compass/i.test(i))) costs[id] = S.costs(id, 'mine');
        const shelf = () => S.shelf('mine').map((u) => u.id);
        put({ mineRuns: 3, mineStoreVisits: 1, mineJourney: { journey: 1, leg: 1, legs: { 1: { runs: 2 } } }, mineSeen: {} });
        const v1 = shelf();
        put({ mineStoreVisits: 2 });
        const v2 = shelf();
        put({ mineJourney: { journey: 1, leg: 1, legs: {} } });
        const free = shelf();
        put({ mineJourney: { journey: 1, leg: 1, legs: { 1: { runs: 2 } } }, mineSeen: { mat_garnet: true } });
        const gar = shelf();
        // A hidden track cannot be bought either (the shelf and the buy path share one predicate).
        S.credit(500);
        const hidden = S.buy('compass_hematite');
        // The real purchase, folded into the next descent.
        const b1 = S.buy('compassIsland'), b2 = S.buy('compassIsland'), bg = S.buy('compass_garnet');
        g.mine.playLeg(1, 2);
        await new Promise((res) => setTimeout(res, 1500));
        const cfgC = JSON.parse(JSON.stringify(g.state.config.mine.compass));
        const model = g.mine.compass();
        return { ids, costs, v1, v2, free, gar, hidden: hidden && hidden.ok, b1: b1.ok, b2: b2.ok, bg: bg.ok, cfgC, model };
      });
      const want4 = ['compassIsland', 'compass_anthracite', 'compass_garnet', 'compass_hematite'];
      ok('the mine sells an island compass and one compass per deep material', want4.every((id) => r.ids.includes(id)),
         r.ids.filter((i) => /compass/.test(i)).join(', '));
      const cj = JSON.stringify(r.costs);
      ok('...at the plan\'s prices', cj === JSON.stringify({ compassIsland: [12, 40], compass_anthracite: [20, 60, { m: 'anthracite', n: 12 }],
         compass_garnet: [40, 100, { m: 'garnet', n: 12 }], compass_hematite: [60, 140, { m: 'hematite', n: 12 }] }), cj);
      ok('the island compass is hidden on store visit 1 and on the shelf from visit 2 on a journey save',
         !r.v1.includes('compassIsland') && r.v2.includes('compassIsland'), `visit 1 [${r.v1}] / visit 2 [${r.v2}]`);
      ok('...but not on a save that has never played a leg', !r.free.includes('compassIsland'), `[${r.free}]`);
      ok('a material compass appears with that material\'s first seam, and no other', r.gar.includes('compass_garnet')
         && !r.gar.includes('compass_anthracite') && !r.gar.includes('compass_hematite') && !r.v2.includes('compass_garnet'), `[${r.gar}]`);
      ok('...and a hidden compass cannot be bought', r.hidden === false);
      ok('a purchase reaches the next descent as cfg.mine.compass', r.b1 && r.b2 && r.bg && r.cfgC.island === 2 && r.cfgC.mats.garnet === 1
         && r.cfgC.mats.anthracite === 0, JSON.stringify(r.cfgC));
      const isl = r.model.find((e) => e.kind === 'island'), gm = r.model.find((e) => e.mat === 'garnet');
      ok('...the island needle carries metres at rung 2, the garnet one only a bearing at rung 1', isl && isl.dist != null && gm && gm.dist == null
         && r.model.length === 2, JSON.stringify(r.model.map((e) => [e.id, e.rung, e.dist])));
      // The store's tile, on the real screen.
      await b.page.evaluate(() => { for (const e of document.querySelectorAll('#speciesSelect')) e.remove(); window.__menu.showPicker(); });
      await b.page.waitForSelector('.ss-upg[data-track="compassIsland"]', { timeout: 8000 }).catch(() => {});
      const t = await b.page.evaluate(() => {
        const q = (id) => { const e = document.querySelector(`.ss-upg[data-track="${id}"]`); return e ? { now: (e.querySelector('.ss-upg-now') || {}).textContent,
          icon: !!e.querySelector('.ss-upg-top svg'), nm: (e.querySelector('.ss-upg-nm') || {}).textContent, btn: (e.querySelector('.ss-upg-btn') || {}).textContent } : null; };
        return { isl: q('compassIsland'), gar: q('compass_garnet') };
      });
      await b.page.evaluate(() => { const e = document.querySelector('.ss-upg[data-track="compass_garnet"]'); if (e) e.scrollIntoView({ block: 'center' }); });
      await sleep(300);
      await b.page.screenshot({ path: path.join(ART, 'm10-store-390.png') }).catch(() => {});
      ok('the store shows the island compass as bought out and the garnet one at rung 1, with the compass icon',
         t.isl && /metres/.test(t.isl.now) && t.gar && /bearing/.test(t.gar.now) && t.isl.icon && t.gar.icon && /100/.test(t.gar.btn || ''),
         JSON.stringify(t));
      ok('no page errors (shelf)', !b.errs.length, b.errs.slice(0, 2).join(' | '));
      await b.ctx.close();
    }

    // ======================================================================================
    if (want('none')) {
      console.log('--- acceptance 1: nothing bought draws nothing');
      const b = await bootLeg(E, 2);
      const r = await b.page.evaluate(async (QUIET) => {
        new Function('return (' + QUIET + ')')()();
        const g = window.__game, s = g.state;
        for (let i = 0; i < 4; i++) { g.mine.grow(0.2, 1); await new Promise((res) => setTimeout(res, 500)); }
        await new Promise((res) => setTimeout(res, 800));
        const cv = document.getElementById('game'), cx = cv.getContext('2d');
        const W = cv.width, Hh = cv.height, band = Math.round(60 * W / innerWidth);
        const edges = () => {
          const parts = [cx.getImageData(0, 0, W, band).data, cx.getImageData(0, Hh - band, W, band).data,
                         cx.getImageData(0, 0, band, Hh).data, cx.getImageData(W - band, 0, band, Hh).data];
          return parts;
        };
        const diff = (A, B) => { let n = 0; for (let k = 0; k < A.length; k++) { const a = A[k], c = B[k]; for (let i = 0; i < a.length; i += 4) if (a[i] !== c[i] || a[i + 1] !== c[i + 1] || a[i + 2] !== c[i + 2]) n++; } return n; };
        const T = performance.now();
        const frame = (knob) => { window.MYCELIUM_NO_COMPASS = knob; g.renderFrame(T); return edges(); };
        const model = g.mine.compass();
        const cfg = JSON.parse(JSON.stringify(s.config.mine.compass));
        const a0 = frame(false), a1 = frame(false), off = frame(true);
        const noise = diff(a0, a1), vsOff = diff(a0, off);
        // CONTROL: one rung of the island compass (live on the run's config).
        s.config.mine.compass.island = 1;
        const on = frame(false), offC = frame(true);
        const ctl = diff(on, offC);
        s.config.mine.compass.island = 0; window.MYCELIUM_NO_COMPASS = false;
        return { model, cfg, noise, vsOff, ctl, needles: g.mine.needles().length };
      }, QUIET.toString());
      ok('nothing bought: compass() is [] (and the run\'s config carries every rung at 0)', r.model.length === 0 && r.cfg.island === 0
         && Object.values(r.cfg.mats).every((v) => v === 0), JSON.stringify(r.cfg));
      ok('...and the screen edges are pixel-identical to a frame with the compass renderer off',
         r.noise === 0 && r.vsOff === 0, `${r.vsOff} px differ (noise floor between two identical frames: ${r.noise})`);
      ok('...control: one island rung changes the edges', r.ctl > 200, `${r.ctl} px differ`);
      ok('no page errors (none)', !b.errs.length, b.errs.slice(0, 2).join(' | '));
      await b.ctx.close();
    }

    // ======================================================================================
    if (want('bearing')) {
      console.log('--- acceptance 2: bearings and distances, through rock');
      const b = await bootLeg(E, 2);
      const r = await b.page.evaluate(async ({ QUIET, TRUTH }) => {
        new Function('return (' + QUIET + ')')()();
        const truth = new Function('return (' + TRUTH + ')')();
        const g = window.__game, s = g.state, sub = s.substrate, cs = sub.cellSize, cw = s.config.mine.chunkCols;
        s.active.water = 100000;
        await window.__navDig({ targetM: 30, maxIters: 200 });
        for (let i = 0; i < 100 && g.mine.revealing(); i++) await new Promise((res) => setTimeout(res, 50));
        g.mine.ensureChunks(0, 9 * cw * cs);
        s.config.mine.compass = { island: 2, mats: { anthracite: 2, garnet: 2, hematite: 2 } };
        await new Promise((res) => setTimeout(res, 600));
        const T = truth();
        const M = g.mine.compass();
        const rows = M.map((e) => {
          const t = T.t[e.id];
          const want = t ? Math.atan2(t.y - T.focus.y, t.x - T.focus.x) * 180 / Math.PI : null;
          let db = want == null ? null : Math.abs(e.bearing - want); if (db != null && db > 180) db = 360 - db;
          return { id: e.id, db, dd: t ? Math.abs(e.dist - Math.hypot(t.x - T.focus.x, t.y - T.focus.y) / cs) : null,
                   tgt: t ? Math.hypot(t.x - e.tx, t.y - e.ty) : null, focusSame: e.focusId === T.focus.id, bearing: e.bearing, dist: e.dist };
        });
        // What was DRAWN: each needle on its bearing from the focus strand's screen point; labels in metres.
        g.renderFrame(performance.now());
        const N = g.mine.needles();
        const drawn = N.filter((n) => n.x != null).map((n) => {
          let a = Math.atan2(n.y - n.fy, n.x - n.fx) * 180 / Math.PI - n.bearing; a = Math.abs(((a + 540) % 360) - 180);
          const lab = /(\d+) m$/.exec(n.label || '');
          return { id: n.id, da: a, len: Math.hypot(n.y - n.fy, n.x - n.fx), lab: lab ? +lab[1] : null, dist: n.dist };
        });
        // Stamp a rock sprite across the straight line from the focus to the island target.
        const e0 = M.find((e) => e.kind === 'island');
        const mx = (e0.fx + e0.tx) / 2, my = (e0.fy + e0.ty) / 2;
        const tpl = sub.levelSprites.find((q) => q.w > 60) || sub.levelSprites[0];
        const before = sub.solidAtWorld(mx, my);
        sub.levelSprites.push(Object.assign({}, tpl, { x: mx, y: my, w: 260, h: 260, rot: 0 }));
        const c0 = sub.colAtX(mx - 140), c1 = sub.colAtX(mx + 140);
        sub._mineDirtyC0 = Math.min(sub._mineDirtyC0 != null ? sub._mineDirtyC0 : c0, c0); sub._mineDirtyC1 = Math.max(sub._mineDirtyC1 != null ? sub._mineDirtyC1 : c1, c1);
        for (let i = 0; i < 40 && !sub.solidAtWorld(mx, my); i++) await new Promise((res) => setTimeout(res, 50));
        const after = sub.solidAtWorld(mx, my);
        const e1 = g.mine.compass().find((e) => e.kind === 'island');
        return { rows, drawn, n: M.length, before, after, b0: e0.bearing, b1: e1.bearing, t0: [e0.tx, e0.ty], t1: [e1.tx, e1.ty], d0: e0.dist, d1: e1.dist,
                 depth: g.mine.depth() };
      }, { QUIET: QUIET.toString(), TRUTH: TRUTH.toString() });
      await b.page.screenshot({ path: path.join(ART, 'm10-needles-390.png') }).catch(() => {});
      ok(`four needles at ${r.depth} m (island + three materials)`, r.n === 4, r.rows.map((x) => x.id).join(', '));
      ok('...every bearing within 2 deg of atan2(target - focus), off targets recomputed from the substrate',
         r.rows.length === 4 && r.rows.every((x) => x.db != null && x.db < 2 && x.tgt < 1 && x.focusSame),
         r.rows.map((x) => `${x.id} ${x.bearing.toFixed(1)} deg (off ${x.db != null ? x.db.toFixed(3) : '?'}, target off ${x.tgt != null ? x.tgt.toFixed(2) : '?'} u)`).join('; '));
      ok('...and every distance within 1 m', r.rows.every((x) => x.dd != null && x.dd <= 1),
         r.rows.map((x) => `${x.id} ${x.dist} m (off ${x.dd != null ? x.dd.toFixed(2) : '?'})`).join('; '));
      ok('the drawn needles sit on those bearings from the focus strand\'s screen point, and print the metres',
         r.drawn.length >= 2 && r.drawn.every((x) => x.len < 40 || x.da < 2) && r.drawn.every((x) => x.lab === x.dist),
         r.drawn.map((x) => `${x.id} off ${x.da.toFixed(2)} deg at ${Math.round(x.len)} px, label ${x.lab}`).join('; '));
      ok('a rock sprite stamped between the focus and the island leaves the bearing, the distance and the target unchanged',
         !r.before && r.after && r.b0 === r.b1 && r.d0 === r.d1 && r.t0.join() === r.t1.join(),
         `midpoint solid ${r.before} -> ${r.after}; bearing ${r.b0.toFixed(3)} -> ${r.b1.toFixed(3)}, ${r.d0} -> ${r.d1} m`);
      ok('no page errors (bearing)', !b.errs.length, b.errs.slice(0, 2).join(' | '));
      await b.ctx.close();
    }

    // ======================================================================================
    if (want('rich')) {
      console.log('--- acceptance 3: rung 3 is the richest unclaimed seam within 90 m');
      const b = await bootLeg(E, 2);
      const r = await b.page.evaluate(async (QUIET) => {
        new Function('return (' + QUIET + ')')()();
        const g = window.__game, s = g.state, sub = s.substrate, cs = sub.cellSize, cw = s.config.mine.chunkCols;
        s.active.water = 100000;
        await window.__navDig({ targetM: 45, maxIters: 300 });
        for (let i = 0; i < 100 && g.mine.revealing(); i++) await new Promise((res) => setTimeout(res, 50));
        g.mine.ensureChunks(0, 9 * cw * cs);
        const f0 = g.mine.compass;
        const cen = (pile) => { let sx = 0, sy = 0; for (const i of pile.cells) { sx += (i % sub.cols + 0.5) * cs; sy += sub.surfaceY + ((i / sub.cols | 0) + 0.5) * cs; } return { x: sx / pile.cells.length, y: sy / pile.cells.length }; };
        const res = {};
        for (const mat of ['anthracite', 'garnet']) {
          s.config.mine.compass = { island: 0, mats: { [mat]: 2 } };
          const near = g.mine.compass()[0];
          const fx = near.fx, fy = near.fy;
          const cands = sub.foodPiles.map((p, i) => ({ p, i, c: cen(p) })).filter((o) => o.p.mineMat === mat && !o.p.rewarded
            && !o.p.cells.some((k) => sub.cells[k].colonized > 0)).map((o) => Object.assign(o, { d: Math.hypot(o.c.x - fx, o.c.y - fy) / cs }));
          const inR = cands.filter((o) => o.d <= 90).sort((a, c) => a.d - c.d);
          const out = { near: near.pileIndex, nearest: cands.slice().sort((a, c) => a.d - c.d)[0].i, inR: inR.length, total: cands.length };
          if (inR.length >= 2) {
            // Make the FARTHEST in range the one rich seam in range (the others plain): rung 3 must pick it.
            const save = inR.map((o) => o.p.rich);
            inR.forEach((o) => { o.p.rich = false; });
            const far = inR[inR.length - 1]; far.p.rich = true;
            s.config.mine.compass.mats[mat] = 3;
            const e3 = g.mine.compass()[0];
            out.rich = { pick: e3.pileIndex, want: far.i, richest: e3.richest, value: e3.value, d: +far.d.toFixed(1) };
            // Nothing rich in range: equal values -> the nearest in range.
            far.p.rich = false;
            const e3b = g.mine.compass()[0];
            out.flat = { pick: e3b.pileIndex, want: inR[0].i };
            // A claimed seam is skipped: claim the rich one, the next best (the nearest, all plain) wins.
            far.p.rich = true;
            const k0 = far.p.cells[0], was = sub.cells[k0].colonized; sub.cells[k0].colonized = 1;
            const e3c = g.mine.compass()[0];
            out.claimed = { pick: e3c.pileIndex, notWant: far.i, want: inR[0].i };
            sub.cells[k0].colonized = was;
            // Out of range: a rich seam beyond 90 m does not beat a plain one inside.
            const beyond = cands.filter((o) => o.d > 90).sort((a, c) => a.d - c.d)[0];
            far.p.rich = false;
            if (beyond) { const bw = beyond.p.rich; beyond.p.rich = true; const e3d = g.mine.compass()[0];
              out.beyond = { pick: e3d.pileIndex, want: inR[0].i, d: +beyond.d.toFixed(1) }; beyond.p.rich = bw; }
            inR.forEach((o, j) => { o.p.rich = save[j]; });
          }
          // Nothing within 90 m at all: rung 3 falls back to the nearest.
          const all = cands.slice();
          if (all.length) {
            s.config.mine.compassRichM = 0.5;
            s.config.mine.compass.mats[mat] = 3;
            out.fallback = { pick: g.mine.compass()[0].pileIndex, want: out.nearest };
            s.config.mine.compassRichM = 90;
          }
          res[mat] = out;
        }
        return { res, depth: g.mine.depth() };
      }, QUIET.toString());
      for (const mat of ['anthracite', 'garnet']) {
        const o = r.res[mat];
        ok(`${mat}: rung 2 points at the nearest unclaimed seam`, o.near === o.nearest, `pile ${o.near} vs nearest ${o.nearest} (${o.total} seams, ${o.inR} within 90 m, at ${r.depth} m)`);
        ok(`${mat}: rung 3 points at the richest within 90 m, not the nearest`, !!o.rich && o.rich.pick === o.rich.want && o.rich.richest && o.rich.value === 6,
           o.rich ? `pile ${o.rich.pick} vs ${o.rich.want} (rich, ${o.rich.d} m), value ${o.rich.value}` : `only ${o.inR} seams in range`);
        ok(`${mat}: ...all equal -> the nearest in range; a claimed seam is skipped; a rich seam past 90 m does not count`,
           !!o.flat && o.flat.pick === o.flat.want && o.claimed.pick !== o.claimed.notWant && o.claimed.pick === o.claimed.want
           && (!o.beyond || o.beyond.pick === o.beyond.want), JSON.stringify({ flat: o.flat, claimed: o.claimed, beyond: o.beyond }));
        ok(`${mat}: ...and with no seam within range it falls back to the nearest`, !!o.fallback && o.fallback.pick === o.fallback.want, JSON.stringify(o.fallback));
      }
      ok('no page errors (rich)', !b.errs.length, b.errs.slice(0, 2).join(' | '));
      await b.ctx.close();
    }

    // ======================================================================================
    if (want('order')) {
      console.log("--- acceptance 4: '#mine,4242' is the same world with the idle look-ahead on and off");
      const read = (page, reverse) => page.evaluate(async (reverse) => {
        const g = window.__game, s = g.state, sub = s.substrate, cs = sub.cellSize, cw = s.config.mine.chunkCols;
        const total = Math.ceil(sub.cols / cw);
        const pre = g.mine.chunks().slice().sort((a, b) => a - b);
        const idle = g.mine.idleLog().filter((e) => e.kind === 'gen').map((e) => e.ci);
        if (reverse) for (let ci = total - 1; ci >= 0; ci--) g.mine.ensureChunks((ci + 0.3) * cw * cs, (ci + 0.7) * cw * cs);
        g.mine.ensureChunks(0, sub.worldWidth - 1);
        const recs = {}; for (let ci = 0; ci < total; ci++) recs[ci] = s.mineChunks[ci] ? JSON.stringify(s.mineChunks[ci]) : null;
        const sp = sub.levelSprites.map((q) => [q.key, q.x, q.y, q.w, q.h, q.rot].join(',')).sort();
        let h = 2166136261; for (const t of sp) for (let i = 0; i < t.length; i++) { h ^= t.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
        const piles = sub.foodPiles.map((p) => [p.mineMat, !!p.rich, p.cells.slice().sort((a, b) => a - b).join('.')].join(':')).sort().join('|');
        return { recs, total, sprites: sp.length, hash: h, piles, pre, idle, stats: JSON.stringify(g.mine.stats()) };
      }, reverse);
      const A = await E.bootMine(4242);
      await A.page.evaluate(() => { const s = window.__game.state; s.config.mine.compass = { island: 0, mats: { garnet: 1 } }; });
      await A.page.waitForFunction(() => window.__game.mine.idleLog().filter((e) => e.kind === 'gen').length >= 2, { timeout: 20000 }).catch(() => {});
      const ra = await read(A.page, false);
      const B = await E.boot('#mine,4242', 390, 844, { before: (page) => page.addInitScript(() => { window.MYCELIUM_NO_LOOKAHEAD = true; window.MYCELIUM_NO_IDLE_LOOKAHEAD = true; }) });
      await H.waitMine(B.page);
      const rb = await read(B.page, true);
      const same = Object.keys(ra.recs).filter((k) => ra.recs[k] && ra.recs[k] === rb.recs[k]);
      ok('the idle look-ahead made chunks on the first boot, and none on the second', ra.idle.length >= 2 && rb.idle.length === 0,
         `idle chunks [${ra.idle}] / [${rb.idle}]; before the full walk: [${ra.pre}] / [${rb.pre}]`);
      ok(`all ${ra.total} chunk records identical, although the second boot generated them in reverse`, same.length === ra.total,
         `${same.length}/${ra.total}${same.length < ra.total ? ', differ: ' + Object.keys(ra.recs).filter((k) => !same.includes(k)).join(',') : ''}`);
      ok('...and the same rock, sprite for sprite, the same seams (material, richness, cells) and the same stats',
         ra.hash === rb.hash && ra.sprites === rb.sprites && ra.piles === rb.piles && ra.stats === rb.stats && ra.sprites > 5000,
         `${ra.sprites} / ${rb.sprites} sprites, hash ${ra.hash} / ${rb.hash}, piles ${ra.piles === rb.piles ? 'same' : 'differ'}`);
      ok('no page errors (order)', !A.errs.length && !B.errs.length, A.errs.concat(B.errs).slice(0, 2).join(' | '));
      await A.ctx.close(); await B.ctx.close();
    }

    // ======================================================================================
    if (want('idle')) {
      console.log('--- acceptance 5: idle generation makes no long task over 50 ms');
      for (const [label, hash] of [['leg 2', '#leg,1,2'], ['free layout', '#mine,4242']]) {
        const b = await E.boot(hash, 390, 844, { before: (page) => page.addInitScript(() => {
          window.__lt = [];
          try { new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__lt.push({ t: e.startTime, d: e.duration }); }).observe({ type: 'longtask', buffered: true }); } catch (_) {}
        }) });
        await H.waitMine(b.page);
        const r = await b.page.evaluate(async (QUIET) => {
          new Function('return (' + QUIET + ')')()();
          const g = window.__game, s = g.state;
          await new Promise((res) => setTimeout(res, 1500));
          const n0 = g.mine.chunks().length;
          const lt0 = window.__lt.length;
          s.config.mine.compass = { island: 0, mats: { anthracite: 1 } };
          for (let i = 0; i < 120 && g.mine.idleLog().filter((e) => e.kind === 'stamp').length < 2; i++) await new Promise((res) => setTimeout(res, 100));
          await new Promise((res) => setTimeout(res, 500));
          const log = g.mine.idleLog();
          const lts = window.__lt.slice(lt0);
          const hits = [];
          for (const e of log) for (const L of lts) if (L.d > 50 && L.t < e.t0 + e.ms + 1 && L.t + L.d > e.t0 - 1) hits.push({ kind: e.kind, ci: e.ci, ms: e.ms, lt: Math.round(L.d) });
          const frameStamps = g.mine.genLog().filter((e) => e.ahead === 'idle' && e.stampFrame).length;
          return { n0, n1: g.mine.chunks().length, log, hits, lts: lts.map((L) => Math.round(L.d)), frameStamps, observer: typeof PerformanceObserver !== 'undefined' };
        }, QUIET.toString());
        const gens = r.log.filter((e) => e.kind === 'gen'), stamps = r.log.filter((e) => e.kind === 'stamp');
        ok(`${label}: the idle look-ahead makes chunks past the colony's (one a slot) and stamps each in a later slot`,
           gens.length >= 1 && stamps.length >= 1 && r.n1 > r.n0 && r.frameStamps === 0,
           `chunks ${r.n0} -> ${r.n1}; idle ${gens.map((e) => 'gen ' + e.ci + ' ' + e.ms + ' ms').join(', ')}; ${stamps.map((e) => 'stamp ' + e.ms + ' ms').join(', ')}; frame-stamped ${r.frameStamps}`);
        ok(`${label}: ...no long task over 50 ms overlaps an idle slot, and no slot ran past 50 ms`,
           r.observer && r.hits.length === 0 && r.log.every((e) => e.ms <= 50),
           `${r.hits.length} overlapping; slots ${r.log.map((e) => e.ms).join(' / ')} ms; long tasks in the window [${r.lts.join(', ')}] ms`);
        ok(`no page errors (idle, ${label})`, !b.errs.length, b.errs.slice(0, 2).join(' | '));
        await b.ctx.close();
      }
    }

    // ======================================================================================
    if (want('hud')) {
      console.log('--- acceptance 7: at 390 px no needle sits on the HUD');
      const ctx = await E.browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
      const b = await bootLeg(E, 2, 390, 844, { ctx });
      const r = await b.page.evaluate(async (QUIET) => {
        new Function('return (' + QUIET + ')')()();
        const g = window.__game, s = g.state, sub = s.substrate, cs = sub.cellSize;
        s.active.water = 100000;
        await window.__navDig({ targetM: 30, maxIters: 200 });
        for (let i = 0; i < 100 && g.mine.revealing(); i++) await new Promise((res) => setTimeout(res, 50));
        // THE WHOLE HUD: three materials, worms attached, the rot banner, the kit, FRUIT NOW (held).
        s.mineMats = { anthracite: 6, garnet: 3, hematite: 12 };
        s.active.phosphorus = 27; s.mineOre = 27;
        s.config.mine.infectionMs = 1e7; s.config.mine.firstInfectionMs = 1e7; s.config.mine.stuckFruitMs = 1e9;
        s.mineItems = { excrete: 2, amputate: 2 };
        const live = s.active.nodes.filter((n) => !n.infected).sort((a, c) => c.y - a.y);
        for (let k = 0; k < 3; k++) { const n = live[Math.min(live.length - 1, k * 6)]; g.mine.spawnWorm(n.x + 3, n.y); }
        for (let i = 0; i < 120 && (s.mineAttached | 0) < 2; i++) await new Promise((res) => setTimeout(res, 100));
        g.mine.spawnCloud(live[0].x, live[0].y);
        for (let i = 0; i < 100 && !s.mineInfect; i++) await new Promise((res) => setTimeout(res, 50));
        s.active.water = g.mine.costHere() - 1;
        for (let i = 0; i < 100; i++) { const fn = document.getElementById('fruitnow'); if (fn && !fn.hidden) break; await new Promise((res) => setTimeout(res, 50)); }
        s.config.mine.compass = { island: 2, mats: { anthracite: 2, garnet: 2, hematite: 2 } };
        await new Promise((res) => setTimeout(res, 400));
        const J = sub.mineJourney, tap0 = { col: J.taproot.col, row: J.taproot.row };
        const hudSel = g.mine.hudRects().map((q) => q.sel);
        const hit = (a, c) => a.x0 < c.x1 && a.x1 > c.x0 && a.y0 < c.y1 && a.y1 > c.y0;
        let drawn = 0, hidden = 0, bad = [], chev = 0, chevBad = [];
        const f = g.mine.compass()[0];
        const cam0 = { x: g.state && window.__game.camera ? 0 : 0 };
        const offs = [[0, 0], [-120, 260], [150, -60]];
        for (const [ox, oy] of offs) {
          g.mine.lookAt(f.fx + ox, f.fy + oy + 120);
          for (let a = 0; a < 360; a += 10) {
            const rad = a * Math.PI / 180, R = 70;
            J.taproot.col = Math.max(1, Math.min(sub.cols - 2, Math.round(f.fx / cs + Math.cos(rad) * R - 0.5)));
            J.taproot.row = Math.max(1, Math.min(sub.rows - 2, Math.round((f.fy - sub.surfaceY) / cs + Math.sin(rad) * R - 0.5)));
            const rects = g.mine.hudRects();
            g.renderFrame(performance.now());
            for (const n of g.mine.needles()) {
              if (n.hidden) { hidden++; continue; }
              if (n.x == null) continue;
              drawn++;
              if (n.x < 0 || n.y < 0 || n.x > innerWidth || n.y > innerHeight) bad.push(n.id + ' off screen');
              for (const q of rects) if (hit(n.rect, q)) bad.push(`${n.id} @${a} deg on ${q.sel}`);
            }
            for (const c of g.mine.chevrons()) { chev++; for (const q of rects) if (Math.abs(c.x - (q.x0 + q.x1) / 2) < (q.x1 - q.x0) / 2 + 17 && Math.abs(c.y - (q.y0 + q.y1) / 2) < (q.y1 - q.y0) / 2 + 17) chevBad.push(q.sel); }
          }
        }
        J.taproot.col = tap0.col; J.taproot.row = tap0.row;
        g.mine.lookAt(f.fx, f.fy + 200);
        g.renderFrame(performance.now());
        return { hudSel, drawn, hidden, bad: bad.slice(0, 6), nbad: bad.length, chev, chevBad: chevBad.slice(0, 4), attached: s.mineAttached | 0,
                 rot: !!s.mineInfect, over: !!s.runOver };
      }, QUIET.toString());
      await b.page.screenshot({ path: path.join(ART, 'm10-hud-390.png') }).catch(() => {});
      ok('the loaded HUD is up (rows, rot banner, gear, kit, FRUIT NOW) and the run is live',
         !r.over && r.rot && ['#ui .minerows', '#hud-infect', '#gearbtn', '#minekit', '#fruitnow'].every((q) => r.hudSel.includes(q)), `[${r.hudSel.join(', ')}], ${r.attached} worms attached`);
      ok('...four needles swept round 36 bearings from 3 focus positions: none of the drawn needle rects touches a HUD rect',
         r.drawn >= 300 && r.nbad === 0, `${r.drawn} drawn, ${r.hidden} held back (no clear spot on the ray), ${r.nbad} on the HUD ${r.bad.join(' | ')}`);
      ok('...and the worm chevrons (same placement) never sit on one either', r.chevBad.length === 0, `${r.chev} chevrons ${r.chevBad.join(' | ')}`);
      ok('no page errors (hud)', !b.errs.length, b.errs.slice(0, 2).join(' | '));
      await b.ctx.close();
    }
  } catch (e) {
    fail++; console.log('  FAIL  harness error: ' + (e && e.stack || e));
  } finally {
    console.log(`\n==== ${pass} passed, ${fail} failed ====`);
    await E.close();
    process.exit(fail ? 1 : 0);
  }
})();
