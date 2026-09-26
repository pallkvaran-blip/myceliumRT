/* A PHONE PLAYER CAN SEE AND USE EVERY CONTROL — the finishing plan's M3, as assertions.
 *
 *     node tests/phone-check.cjs            (PHONE_ONLY=hud,tap,cut,hint,loader runs blocks)
 *
 * The defects this pins, measured on `claude/deep-mine-finish` before the fix:
 *   - THE HUD RAN OFF A 390 px SCREEN. One row carried water, P, depth, the worm chip, the rot clock,
 *     the price and the material dots; with three worms, the rot clock and three materials up it ran
 *     to x ~480 and pushed the gear (x 448-480) off the screen — Settings and both exits in it were
 *     unreachable exactly when a descent was in trouble.
 *   - A TAP ON THE COLONY DID NOTHING (dropped as "too short to point"), and so did a tap with the
 *     enzyme armed unless the finger wobbled past 12 px — and a tap on a rotten limb far from clean
 *     tissue could not spend a dose at all (`nearestNode` skips infected strands, so no aim started).
 *   - THE ONLY INSTRUCTION WAS INVISIBLE ON PHONES: it went to `.hint`, which the phone CSS hides.
 *   - The load gate said 'CLICK' on a phone.
 *
 * Every block runs on a FRESH context (fresh save). The touch blocks use a real touch context
 * (hasTouch + isMobile) and Playwright's touchscreen, which dispatches CDP touch events — the same
 * pointer events a finger makes, not mouse clicks dressed up.
 */
const path = require('path');
const H = require('./mine-harness.cjs');
const { sleep } = H;
let pass = 0, fail = 0;
const ok = (n, c, x) => { c ? (pass++, console.log('  PASS  ' + n + (x ? '  — ' + x : ''))) : (fail++, console.log('  FAIL  ' + n + (x ? '  — ' + x : ''))); };
const ART = path.join(H.ROOT, 'tests', '.artifacts');
require('fs').mkdirSync(ART, { recursive: true });
const ONLY = (process.env.PHONE_ONLY || '').split(',').filter(Boolean);
const want = (k) => !ONLY.length || ONLY.includes(k);

const QUIET = () => {
  const s = window.__game.state;
  s.nematodes.length = 0; s.clouds.length = 0;
  s.config.nematodes.respawnChance = 0; s.config.trichoderma.respawnChance = 0;
  if (s.config.mine.worms) s.config.mine.worms.waterPerSec = 0;
};
const touchCtx = (E, vw, vh) => E.browser.newContext({ viewport: { width: vw, height: vh }, deviceScaleFactor: 2,
  hasTouch: true, isMobile: true });

(async () => {
  const E = await H.start();
  try {
    // =========================================================================================
    // 1. HUD FIT — the loaded case: 3 worms attached, the rot banner up, 3 materials held, stuck
    // =========================================================================================
    if (want('hud')) for (const [vw, vh] of [[390, 844], [360, 640]]) {
      console.log(`--- the HUD at ${vw}x${vh}, fully loaded`);
      const ctx = await touchCtx(E, vw, vh);
      const b = await E.bootMine(4242, vw, vh, { ctx });
      const m = await b.page.evaluate(async ({ QUIET }) => {
        new Function('return (' + QUIET + ')')()();
        const g = window.__game, s = g.state;
        s.active.water = 100000;
        await window.__navDig({ targetM: 50, maxIters: 500 });
        await new Promise((r) => setTimeout(r, 600));
        for (let i = 0; i < 200 && g.mine.revealing(); i++) await new Promise((r) => setTimeout(r, 50));
        // THREE MATERIALS HELD, P held, three worms on the deepest tip, the rot at the same tip.
        s.mineMats = { anthracite: 6, garnet: 3, hematite: 12 };
        s.active.phosphorus = 27; s.mineOre = 27;
        s.config.mine.infectionMs = 120000;       // the deadline is not under test; the banner is
        let tip = null;
        for (const n of s.active.nodes) if (!n.infected && (!tip || n.y > tip.y)) tip = n;
        // On three DIFFERENT strands near the tip (two dropped on one strand can share a latch), and
        // topped up until three are attached — a spawned worm has to crawl onto tissue first.
        const live = s.active.nodes.filter((n) => !n.infected).sort((a, b) => b.y - a.y);
        for (let k = 0; k < 3; k++) { const n = live[Math.min(live.length - 1, k * 6)]; g.mine.spawnWorm(n.x + 3, n.y); }
        for (let i = 0; i < 200 && (s.mineAttached | 0) < 3; i++) {
          if (i % 40 === 39) { const n = live[(i / 40 | 0) * 4 + 2] || tip; g.mine.spawnWorm(n.x + 3, n.y); }
          await new Promise((r) => setTimeout(r, 100));
        }
        g.mine.spawnCloud(tip.x, tip.y);
        s.active.water = g.mine.costHere() - 1;   // stuck: FRUIT NOW comes up
        for (let i = 0; i < 200; i++) {
          const ic = document.getElementById('hud-infect'), fn = document.getElementById('fruitnow');
          if (s.runOver || (ic && !ic.hidden && fn && !fn.hidden)) break;
          await new Promise((r) => setTimeout(r, 25));
        }
        await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
        const vis = (e) => { const cs = getComputedStyle(e); return cs.display !== 'none' && cs.visibility !== 'hidden'; };
        const shown = (e) => { for (let n = e; n && n !== document.body; n = n.parentElement) if (!vis(n)) return false; return true; };
        const hud = document.querySelector('#ui > .hud');
        const out = [];
        let n = 0;
        for (const e of [hud, ...hud.querySelectorAll('*'), document.getElementById('fruitnow')]) {
          if (!e || !shown(e)) continue;
          const q = e.getBoundingClientRect();
          if (q.width <= 0 || q.height <= 0) continue;
          n++;
          if (q.left < -0.5 || q.top < -0.5 || q.right > innerWidth + 0.5 || q.bottom > innerHeight + 0.5)
            out.push(`${e.id || e.className || e.tagName} ${Math.round(q.left)}..${Math.round(q.right)} x ${Math.round(q.top)}..${Math.round(q.bottom)}`);
        }
        const R = (id) => { const e = document.getElementById(id); if (!e || !shown(e)) return null;
          const q = e.getBoundingClientRect(); return q.width > 0 ? { x0: q.left, x1: q.right, y0: q.top, y1: q.bottom } : null; };
        const gear = R('gearbtn');
        const hit = gear ? document.elementFromPoint((gear.x0 + gear.x1) / 2, (gear.y0 + gear.y1) / 2) : null;
        const over = (a, c) => !!(a && c) && Math.min(a.x1, c.x1) > Math.max(a.x0, c.x0) && Math.min(a.y1, c.y1) > Math.max(a.y0, c.y0);
        const row1 = (() => { const e = document.querySelector('.minehud .hudtop .resrow'); const q = e.getBoundingClientRect(); return { x0: q.left, x1: q.right, y0: q.top, y1: q.bottom }; })();
        return { depth: g.mine.depth(), over: s.runOver, attached: s.mineAttached | 0, rot: !!s.mineInfect, stuck: g.mine.stuck().on,
                 mats: [...document.querySelectorAll('#matrow .matchip')].map((c) => c.textContent),
                 two: hud.classList.contains('two'), n, outside: out, gear, gearHit: !!(hit && hit.closest && hit.closest('#gearbtn')),
                 fruit: R('fruitnow'), banner: R('hud-infect'), row2: R('hudrow2'), row1, worms: R('hud-worms'),
                 overlaps: { row1Gear: over(row1, gear), row2Gear: over(R('hudrow2'), gear), bannerRows: over(R('hud-infect'), R('hudrow2')) || over(R('hud-infect'), row1),
                             bannerGear: over(R('hud-infect'), gear) },
                 vw: innerWidth, vh: innerHeight };
      }, { QUIET: QUIET.toString() });
      await b.page.screenshot({ path: path.join(ART, `m3-hud-${vw}x${vh}.png`) });
      const f = (r) => r ? `x ${Math.round(r.x0)}-${Math.round(r.x1)}, y ${Math.round(r.y0)}-${Math.round(r.y1)}` : 'not shown';
      ok(`${vw}x${vh}: the loaded state is real (3 worms attached, rot banner, 3 materials, stuck)`,
         !m.over && m.attached >= 3 && m.rot && !!m.banner && m.mats.length === 3 && m.stuck && !!m.fruit,
         `${m.depth} m, ${m.attached} worms, rot ${m.rot}, banner ${f(m.banner)}, tags [${m.mats.join(' | ')}], stuck ${m.stuck}, fruit ${f(m.fruit)}`);
      ok('...the rows are stacked (two rows under 430 px)', m.two === true);
      ok('...every HUD descendant lies inside the viewport, #fruitnow included', m.n > 10 && m.outside.length === 0,
         m.outside.length ? m.outside.slice(0, 4).join(' | ') : `${m.n} visible elements inside ${m.vw}x${m.vh}`);
      ok('...elementFromPoint at the gear\'s centre is #gearbtn', m.gearHit, `gear ${f(m.gear)}`);
      ok('...nothing overlaps the gear or the rows (row 1, row 2, rot banner)', !m.overlaps.row1Gear && !m.overlaps.row2Gear && !m.overlaps.bannerRows && !m.overlaps.bannerGear,
         `row1 ${f(m.row1)}, row2 ${f(m.row2)}, banner ${f(m.banner)} ${JSON.stringify(m.overlaps)}`);
      ok('...material tags read as three letters and a count', m.mats.every((t) => /^[A-Z]{3}\s*\d+$/.test(t.trim())), m.mats.join(' | '));
      ok('no page errors', b.errs.length === 0, b.errs.slice(0, 2).join(' | ') || 'clean');
      await ctx.close();
    }

    // Screen point of a world point, in page (client) coordinates.
    const SCR = `(x, y) => { const g = window.__game, r = document.getElementById('game').getBoundingClientRect();
      const q = g.camera.worldToScreen(x, y); return { x: r.left + q.x, y: r.top + q.y }; }`;
    const toastUp = () => { const t = document.querySelector('#ui .toast, .toast');
      return !!(t && !t.classList.contains('hidden') && t.classList.contains('in')) ? (t.textContent || '').trim() : ''; };

    // =========================================================================================
    // 2. TAPS — a tap on the colony digs straight down; a tap away from it does nothing
    // =========================================================================================
    if (want('tap')) {
      console.log('--- taps, in a touch context (hasTouch, isMobile, 390x844)');
      const ctx = await touchCtx(E, 390, 844);
      const b = await E.bootMine(4242, 390, 844, { ctx });
      const cdp = await ctx.newCDPSession(b.page);
      const touch = async (type, pts) => cdp.send('Input.dispatchTouchEvent', { type,
        touchPoints: pts.map((p, i) => ({ x: p.x, y: p.y, id: i, radiusX: 4, radiusY: 4, force: 1 })) });
      await b.page.evaluate(({ QUIET }) => { new Function('return (' + QUIET + ')')()(); }, { QUIET: QUIET.toString() });
      const before = await b.page.evaluate(({ SCR }) => {
        const scr = new Function('return (' + SCR + ')')();
        const g = window.__game, s = g.state, root = s.active.nodes[0];
        return { nodes: s.active.nodes.length, water: s.active.water, depth: g.mine.depth(), root: scr(root.x, root.y),
                 touch: navigator.maxTouchPoints, coarse: matchMedia('(pointer: coarse)').matches };
      }, { SCR });
      await b.page.touchscreen.tap(before.root.x, before.root.y);
      await sleep(1600);
      const after = await b.page.evaluate(() => { const g = window.__game, s = g.state;
        return { nodes: s.active.nodes.length, water: s.active.water, depth: g.mine.depth(), digs: s.mineDigs | 0 }; });
      ok('the page is a touch page (maxTouchPoints > 0, pointer: coarse)', before.touch > 0 && before.coarse, `maxTouchPoints ${before.touch}, coarse ${before.coarse}`);
      ok('a tap on the root digs: the node count rises', after.nodes > before.nodes, `${before.nodes} -> ${after.nodes}, root at ${Math.round(before.root.x)},${Math.round(before.root.y)}`);
      ok('...water drops by exactly 2', before.water - after.water === 2, `${before.water} -> ${after.water}`);
      ok('...and depth is 1 m or more', after.depth >= 1, `${before.depth} -> ${after.depth} m`);
      await b.page.screenshot({ path: path.join(ART, 'm3-tap-dig-390.png') });

      // A tap 300 px from every strand: nothing, and no toast. The point is searched on the screen so
      // "300 px from every strand" is measured, not assumed.
      const far = await b.page.evaluate(({ SCR }) => {
        const scr = new Function('return (' + SCR + ')')();
        const s = window.__game.state, P = s.active.nodes.map((n) => scr(n.x, n.y));
        let best = null;
        for (let y = 60; y < innerHeight - 110; y += 10) for (let x = 20; x < innerWidth - 20; x += 10) {
          let d = Infinity; for (const p of P) d = Math.min(d, Math.hypot(p.x - x, p.y - y));
          const hit = document.elementFromPoint(x, y);
          if (hit && hit.id === 'game' && d >= 300 && (!best || d > best.d)) best = { x, y, d };
        }
        return { best, nodes: s.active.nodes.length, water: s.active.water, cam: [window.__game.camera.x, window.__game.camera.y] };
      }, { SCR });
      if (far.best) {
        await b.page.touchscreen.tap(far.best.x, far.best.y);
        let toast = '';
        for (let i = 0; i < 12; i++) { await sleep(100); toast = toast || await b.page.evaluate(toastUp); }
        const f2 = await b.page.evaluate(() => { const s = window.__game.state; return { nodes: s.active.nodes.length, water: s.active.water }; });
        ok('a tap 300 px from every strand leaves the nodes unchanged', f2.nodes === far.nodes && f2.water === far.water,
           `at ${far.best.x},${far.best.y} (${Math.round(far.best.d)} px from the nearest strand): nodes ${far.nodes} -> ${f2.nodes}, water ${far.water} -> ${f2.water}`);
        ok('...and shows no toast', !toast, toast || 'none');
      } else ok('a point 300 px from every strand exists on screen', false, 'none found');

      // CONTROL for the tight tap radius: a tap 90-150 px from the colony is inside the aim's grab
      // radius (it starts an aim) and outside `tapDigPx` (48). It must neither dig nor toast.
      const near = await b.page.evaluate(({ SCR }) => {
        const scr = new Function('return (' + SCR + ')')();
        const s = window.__game.state, P = s.active.nodes.map((n) => scr(n.x, n.y));
        for (let y = 80; y < innerHeight - 110; y += 6) for (let x = 20; x < innerWidth - 20; x += 6) {
          let d = Infinity; for (const p of P) d = Math.min(d, Math.hypot(p.x - x, p.y - y));
          const hit = document.elementFromPoint(x, y);
          if (hit && hit.id === 'game' && d >= 90 && d <= 150) return { x, y, d, nodes: s.active.nodes.length };
        }
        return null;
      }, { SCR });
      if (near) {
        await b.page.touchscreen.tap(near.x, near.y);
        let toast = '';
        for (let i = 0; i < 12; i++) { await sleep(100); toast = toast || await b.page.evaluate(toastUp); }
        const n2 = await b.page.evaluate(() => window.__game.state.active.nodes.length);
        ok(`control: a tap ${Math.round(near.d)} px from the colony (an aim, outside tapDigPx) does not dig or toast`, n2 === near.nodes && !toast,
           `nodes ${near.nodes} -> ${n2}, toast ${toast || 'none'}`);
      } else ok('control point 90-150 px from the colony exists', false, 'none found');

      // A TAP MUST NOT STEAL A PAN: one finger pressed away from the colony and dragged 120 px moves
      // the camera and digs nothing.
      if (far.best) {
        const c0 = await b.page.evaluate(() => ({ x: window.__game.camera.x, y: window.__game.camera.y, n: window.__game.state.active.nodes.length }));
        const p = far.best;
        await touch('touchStart', [p]);
        for (let k = 1; k <= 8; k++) { await touch('touchMove', [{ x: p.x + 4 * k, y: p.y - 15 * k }]); await sleep(16); }
        await touch('touchEnd', []);
        await sleep(300);
        const c1 = await b.page.evaluate(() => ({ x: window.__game.camera.x, y: window.__game.camera.y, n: window.__game.state.active.nodes.length }));
        ok('a one-finger drag away from the colony pans and does not dig', Math.hypot(c1.x - c0.x, c1.y - c0.y) > 20 && c1.n === c0.n,
           `camera moved ${Math.round(Math.hypot(c1.x - c0.x, c1.y - c0.y))} world units, nodes ${c0.n} -> ${c1.n}`);
      }
      // ...NOR A PINCH: two fingers placed ON the colony and spread zoom, and dig nothing, even though
      // the first finger went down on a strand (it started an aim, which the second finger drops).
      {
        const z = await b.page.evaluate(({ SCR }) => {
          const scr = new Function('return (' + SCR + ')')();
          const g = window.__game, s = g.state; let tip = null;
          for (const n of s.active.nodes) if (!n.infected && (!tip || n.y > tip.y)) tip = n;
          return { at: scr(tip.x, tip.y), zoom: g.camera.zoom, n: s.active.nodes.length, water: s.active.water };
        }, { SCR });
        const a = z.at;
        await touch('touchStart', [a]);
        await sleep(40);
        await touch('touchStart', [a, { x: a.x + 30, y: a.y + 30 }]);
        for (let k = 1; k <= 8; k++) { await touch('touchMove', [{ x: a.x - 6 * k, y: a.y - 6 * k }, { x: a.x + 30 + 6 * k, y: a.y + 30 + 6 * k }]); await sleep(16); }
        await touch('touchEnd', [{ x: a.x - 48, y: a.y - 48 }]);
        await touch('touchEnd', []);
        await sleep(500);
        const z1 = await b.page.evaluate(() => ({ zoom: window.__game.camera.zoom, n: window.__game.state.active.nodes.length, water: window.__game.state.active.water }));
        ok('a pinch that starts on the colony zooms and does not dig', Math.abs(z1.zoom - z.zoom) > 0.05 && z1.n === z.n && z1.water === z.water,
           `zoom ${z.zoom.toFixed(3)} -> ${z1.zoom.toFixed(3)}, nodes ${z.n} -> ${z1.n}, water ${z.water} -> ${z1.water}`);
      }
      // ...and a press on the colony that wobbles 8 px (under 12) is still a tap.
      {
        const w = await b.page.evaluate(({ SCR }) => {
          const scr = new Function('return (' + SCR + ')')();
          const g = window.__game, s = g.state; let tip = null;
          for (const n of s.active.nodes) if (!n.infected && (!tip || n.y > tip.y)) tip = n;
          return { at: scr(tip.x, tip.y), n: s.active.nodes.length, water: s.active.water };
        }, { SCR });
        await b.page.evaluate(() => { window.__game.camera.zoom = window.__game.camera.zoom; });
        await touch('touchStart', [w.at]);
        await touch('touchMove', [{ x: w.at.x + 5, y: w.at.y + 6 }]);
        await touch('touchEnd', []);
        await sleep(1400);
        const w1 = await b.page.evaluate(() => ({ n: window.__game.state.active.nodes.length, water: window.__game.state.active.water }));
        ok('a press on the colony that moves 8 px (< 12) still digs', w1.n > w.n && w.water - w1.water >= 2,
           `nodes ${w.n} -> ${w1.n}, water ${w.water} -> ${w1.water}`);
      }
      ok('no page errors', b.errs.length === 0, b.errs.slice(0, 2).join(' | ') || 'clean');
      await ctx.close();
    }

    // =========================================================================================
    // 3. THE ENZYME — armed, then a touch tap on a rotten strand spends one dose
    // =========================================================================================
    if (want('cut')) {
      console.log('--- the enzyme, armed, then a tap on the rot');
      const ctx = await touchCtx(E, 390, 844);
      const b = await E.bootMine(4242, 390, 844, { ctx });
      const r0 = await b.page.evaluate(async ({ QUIET, SCR }) => {
        new Function('return (' + QUIET + ')')()();
        const scr = new Function('return (' + SCR + ')')();
        const g = window.__game, s = g.state;
        s.active.water = 100000;
        await window.__navDig({ targetM: 40, maxIters: 500 });
        await new Promise((r) => setTimeout(r, 600));
        for (let i = 0; i < 200 && g.mine.revealing(); i++) await new Promise((r) => setTimeout(r, 50));
        s.mineItems = { excrete: 0, amputate: 2 };
        s.config.mine.infectionMs = 120000;
        let tip = null;
        for (const n of s.active.nodes) if (!n.infected && (!tip || n.y > tip.y)) tip = n;
        g.mine.spawnCloud(tip.x, tip.y);
        for (let i = 0; i < 100 && !g.mine.infect().rotten; i++) await new Promise((r) => setTimeout(r, 50));
        await new Promise((r) => setTimeout(r, 400));
        const kit = document.getElementById('kit-amputate').getBoundingClientRect();
        return { rotten: g.mine.infect().rotten, over: s.runOver, kit: { x: kit.left + kit.width / 2, y: kit.top + kit.height / 2, w: kit.width } };
      }, { QUIET: QUIET.toString(), SCR });
      ok('the colony carries rot and the kit shows the enzyme', r0.rotten > 0 && !r0.over && r0.kit.w > 0, `${r0.rotten} rotten, kit at ${Math.round(r0.kit.x)},${Math.round(r0.kit.y)}`);
      await b.page.touchscreen.tap(r0.kit.x, r0.kit.y);
      await sleep(150);
      const r1 = await b.page.evaluate(({ SCR }) => {
        const scr = new Function('return (' + SCR + ')')();
        const g = window.__game, s = g.state;
        // A rotten strand whose screen point is open canvas (not under the HUD or the kit).
        const rot = s.active.nodes.filter((n) => n.infected).map((n) => ({ n, p: scr(n.x, n.y) }))
          .filter(({ p }) => { const h = document.elementFromPoint(p.x, p.y); return h && h.id === 'game'; });
        const pick = rot[Math.floor(rot.length / 2)];
        return { armed: g.mine.armed(), items: g.mine.items(), at: pick ? pick.p : null, cand: rot.length };
      }, { SCR });
      ok('tapping the enzyme arms it', r1.armed === 'amputate', `armed ${r1.armed}`);
      if (r1.at) {
        await b.page.touchscreen.tap(r1.at.x, r1.at.y);
        await sleep(400);
        const r2 = await b.page.evaluate(() => ({ items: window.__game.mine.items(), armed: window.__game.mine.armed(), rotten: window.__game.mine.infect().rotten }));
        ok('...a touch tap on a rotten strand spends one dose (mineItems.amputate drops by 1)', (r1.items.amputate | 0) - (r2.items.amputate | 0) === 1,
           `amputate ${r1.items.amputate} -> ${r2.items.amputate}, rotten ${r0.rotten} -> ${r2.rotten}, armed ${r2.armed}`);
        ok('...and disarms', r2.armed === null);
      } else ok('a rotten strand is on open canvas', false, `${r1.cand} candidates`);
      await b.page.screenshot({ path: path.join(ART, 'm3-cut-390.png') });
      ok('no page errors', b.errs.length === 0, b.errs.slice(0, 2).join(' | ') || 'clean');
      await ctx.close();
    }

    // =========================================================================================
    // 4. THE HINT — fresh save, the plain URL, New: #minehint is visible and says how to dig
    // =========================================================================================
    if (want('hint')) {
      console.log('--- #minehint on a fresh save (plain URL, touch, 390x844)');
      const ctx = await touchCtx(E, 390, 844);
      const b = await E.boot('', 390, 844, { ctx });
      await b.page.waitForSelector('#tsNewMine', { timeout: 30000 }).catch(() => {});
      await sleep(800);
      await b.page.click('#tsNewMine', { timeout: 8000 }).catch(() => {});
      const h = await b.page.evaluate(async () => {
        const WANT = 'Drag down from the colony to dig';
        const t0 = performance.now();
        let reveal = null, first = null; const at = {};
        const read = () => { const e = document.getElementById('minehint');
          if (!e) return { text: '', disp: 'absent', w: 0, h: 0 };
          const q = e.getBoundingClientRect();
          return { text: (e.textContent || '').trim(), disp: getComputedStyle(e).display, w: q.width, h: q.height,
                   top: q.top, x0: q.left, x1: q.right }; };
        while (performance.now() - t0 < 30000) {
          const g = window.__game, cv = document.getElementById('game');
          const now = performance.now();
          if (reveal == null && g && g.state && g.state.substrate && g.state.substrate.mine && !document.body.classList.contains('handoff')
              && cv && getComputedStyle(cv).opacity === '1' && !(g.simPaused && g.simPaused())) reveal = now;
          if (reveal != null) {
            const r = read(), dt = now - reveal;
            if (first == null && r.text === WANT) first = dt;
            if (dt >= 1500 && !at.t15) at.t15 = Object.assign({ dt }, r);
            if (dt >= 4000) { at.t4 = Object.assign({ dt }, r); break; }
          }
          await new Promise((r) => setTimeout(r, 40));
        }
        const s = window.__game && window.__game.state;
        return { reveal: reveal != null, first, at, digs: s ? s.mineDigs | 0 : -1, best: JSON.parse(localStorage.getItem('mycelium.progress.v2') || '{}').mineBest || 0 };
      });
      await b.page.screenshot({ path: path.join(ART, 'm3-hint-390.png') });
      const t15 = h.at.t15 || {}, t4 = h.at.t4 || {};
      ok('a fresh save reaches the map with no dig made', h.reveal && h.digs === 0 && !h.best, `reveal ${h.reveal}, digs ${h.digs}, mineBest ${h.best}`);
      ok('#minehint reads "Drag down from the colony to dig" within 1 s of the reveal', h.first != null && h.first <= 1000,
         h.first == null ? 'never' : `${Math.round(h.first)} ms after the reveal`);
      ok('...its computed display is not none and its rect is non-zero (at 1.5 s)', t15.disp && t15.disp !== 'none' && t15.w > 0 && t15.h > 0,
         `display ${t15.disp}, ${Math.round(t15.w || 0)}x${Math.round(t15.h || 0)} at y ${Math.round(t15.top || 0)}`);
      ok('...and still reads it at 1.5 s and at 4 s', t15.text === 'Drag down from the colony to dig' && t4.text === 'Drag down from the colony to dig'
         && t4.disp !== 'none' && t4.w > 0, `"${t15.text}" at ${Math.round(t15.dt || 0)} ms, "${t4.text}" at ${Math.round(t4.dt || 0)} ms`);
      ok('...inside the screen', t4.x0 >= 0 && t4.x1 <= 390 && t4.top >= 0, `x ${Math.round(t4.x0)}-${Math.round(t4.x1)}`);
      // It clears on the first dig (any route) — a line that never clears sits over the map all run.
      const cleared = await b.page.evaluate(async () => {
        const g = window.__game, s = g.state, root = s.active.nodes[0];
        const r = g.mine.growFrom(root.x, root.y, root.x, root.y + 200);
        await new Promise((res) => setTimeout(res, 400));
        const e = document.getElementById('minehint');
        return { ok: r.ok, hidden: !e || e.hidden || getComputedStyle(e).display === 'none', text: e ? e.textContent : '' };
      });
      ok('...and clears once they have dug', cleared.ok && cleared.hidden, `dig ${cleared.ok}, hint "${cleared.text}"`);
      // NOTHING ON SCREEN QUOTES A PRICE IN WORDS: the chip owns the number.
      const quote = await b.page.evaluate(() => /water a dig/.test(document.getElementById('ui').innerText || ''));
      ok('nothing on screen quotes "water a dig"', !quote);
      ok('no page errors', b.errs.length === 0, b.errs.slice(0, 2).join(' | ') || 'clean');
      await ctx.close();
    }

    // =========================================================================================
    // 5. THE LOADER — 'Tap to dig' on a touch device, 'Click to dig' on a desktop
    // =========================================================================================
    if (want('loader')) {
      console.log('--- the load gate');
      for (const [label, mk, want2] of [
        ['touch', () => touchCtx(E, 390, 844), 'Tap to dig'],
        ['desktop', () => E.browser.newContext({ viewport: { width: 1280, height: 720 } }), 'Click to dig']]) {
        const ctx = await mk();
        const page = await ctx.newPage();
        await page.addInitScript(() => { window.MYCELIUM_SUPABASE = { url: '', anonKey: '' }; });
        await page.goto(E.base + '/index.html', { waitUntil: 'domcontentloaded' });
        await page.waitForSelector('#loadscreen.ld-ready', { timeout: 40000 }).catch(() => {});
        const t = await page.evaluate(() => ({ text: (document.getElementById('ldPct') || {}).textContent || '',
          coarse: matchMedia('(pointer: coarse)').matches }));
        if (label === 'touch') await page.screenshot({ path: path.join(ART, 'm3-loader-390.png') });
        ok(`${label}: the load gate reads '${want2}'`, t.text === want2, `"${t.text}" (pointer coarse ${t.coarse})`);
        await ctx.close();
      }
    }
  } catch (e) { console.log('HARNESS ERROR', e); fail++; }
  await E.close();
  console.log(`\n==== ${pass} passed, ${fail} failed ====`);
  process.exit(fail ? 1 : 0);
})();
