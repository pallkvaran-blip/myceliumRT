/* THE FIRST MINUTE TEACHES ITSELF — the finishing plan's M4, as assertions.
 *
 *     node tests/onboard-check.cjs     (ONB_ONLY=first,ghost,tips,stale,beat,feedback,pocket,pocketlag,nudge,walled,end runs blocks)
 *
 * What it pins (docs/finish/PLAN.md, M4 acceptance 1-6; 7 is tests/bots/naive.cjs):
 *   1. A FIRST VISIT (fresh save, plain URL, touch) skips the title: the gate tap lands in run 1, the
 *      curtain lifts within 600 ms, a drag started 200 ms after #minehint shows is accepted within
 *      2.5 s of the tap, audio is running — and a second boot of the same save shows the title.
 *   2. The ghost finger draws before the first dig, stops after it, comes back after 6 s idle on
 *      runs 1-2 and not on run 3.
 *   3. The four one-shot tips (dig, first_ore, first_pocket, first_line) fire once per SAVE — a
 *      stubbed telemetry route receives one 'tutorial' event each, and a reload fires none again.
 *   4. The 42 m beat says 'Digs now cost 4'; with tolerance bought the moved line gets its own beat.
 *   5. A claimed seam spawns a floater within 60 world units of the pile centroid within 200 ms and
 *      rings the ping (__sfx.counts.ore); muted, the counts do not move.
 *   6. A tapped pocket's disc reads at most 0.7x its untapped luminance.
 *   +  the dead-end nudge lights tips after two dead-end digs on run 1 and not on run 6, and run 1's
 *      end screen says 'Your first descent' where run 2's does not.
 * Every block runs on a FRESH context (fresh save).
 */
const path = require('path');
const H = require('./mine-harness.cjs');
const lib = require('./bots/lib.cjs');
const { sleep } = H;
let pass = 0, fail = 0;
const ok = (n, c, x) => { c ? (pass++, console.log('  PASS  ' + n + (x ? '  — ' + x : ''))) : (fail++, console.log('  FAIL  ' + n + (x ? '  — ' + x : ''))); };
const ART = path.join(H.ROOT, 'tests', '.artifacts');
require('fs').mkdirSync(ART, { recursive: true });
const ONLY = (process.env.ONB_ONLY || '').split(',').filter(Boolean);
const want = (k) => !ONLY.length || ONLY.includes(k);

const QUIET = () => {
  const s = window.__game.state;
  s.nematodes.length = 0; s.clouds.length = 0;
  s.config.nematodes.respawnChance = 0; s.config.trichoderma.respawnChance = 0;
  if (s.config.mine.worms) s.config.mine.worms.waterPerSec = 0;
};
const quiet = (page) => page.evaluate(({ Q }) => { new Function('return (' + Q + ')')()(); }, { Q: QUIET.toString() });
const touchCtx = (E, vw, vh) => E.browser.newContext({ viewport: { width: vw, height: vh }, deviceScaleFactor: 2,
  hasTouch: true, isMobile: true });
const prog = (page) => page.evaluate(() => JSON.parse(localStorage.getItem('mycelium.progress.v2') || '{}'));
const pollHint = (page, re, ms) => page.evaluate(async ({ src, ms }) => {
  const re = new RegExp(src); const t0 = performance.now();
  while (performance.now() - t0 < ms) {
    const h = document.getElementById('minehint');
    const t = h && !h.hidden ? (h.textContent || '').trim() : '';
    if (re.test(t)) return { t, at: Math.round(performance.now() - t0) };
    await new Promise((r) => setTimeout(r, 40));
  }
  return null;
}, { src: re.source, ms });

(async () => {
  const E = await H.start();
  try {
    // =========================================================================================
    // 1. FIRST VISIT — no title, curtain within 600 ms, a drag dig within 2.5 s of the gate tap
    // =========================================================================================
    if (want('first')) {
      console.log('--- a first visit (fresh save, plain URL, touch, 390x844, dev flag off)');
      const ctx = await touchCtx(E, 390, 844);
      const page = await ctx.newPage();
      const errs = []; page.on('pageerror', (e) => errs.push(String(e && e.message)));
      await page.addInitScript(() => {
        window.MYCELIUM_SUPABASE = { url: '', anonKey: '' };
        const T = window.__t = {};
        document.addEventListener('pointerdown', () => { if (!T.tap) T.tap = performance.now(); }, true);
        setInterval(() => {
          const now = performance.now(), g = window.__game;
          if (!T.title && document.getElementById('titleScreen')) T.title = now;
          if (!T.run && g && g.state && g.state.substrate && g.state.substrate.mine) T.run = now;
          if (T.run && !T.reveal && !document.body.classList.contains('handoff')) T.reveal = now;
          const h = document.getElementById('minehint');
          if (T.reveal && !T.hint && h && !h.hidden && getComputedStyle(h).display !== 'none' && h.getBoundingClientRect().height > 0
              && /Drag down/.test(h.textContent || '')) T.hint = now;
          if (!T.dig && g && g.state && (g.state.mineDigs | 0) > 0) T.dig = now;
        }, 8);
      });
      await page.goto(E.base + '/index-nodev.html', { waitUntil: 'domcontentloaded' });
      await page.waitForSelector('#loadscreen.ld-ready', { timeout: 60000 }).catch(() => {});
      await page.touchscreen.tap(195, 420);
      await page.waitForFunction(() => window.__t.hint || window.__t.title, null, { timeout: 30000 }).catch(() => {});
      let T = await page.evaluate(() => Object.assign({}, window.__t));
      if (T.hint) {
        await sleep(200);
        const cdp = await ctx.newCDPSession(page);
        const root = await page.evaluate(() => { const g = window.__game, r = document.getElementById('game').getBoundingClientRect();
          const n = g.state.active.nodes[0], q = g.camera.worldToScreen(n.x, n.y); return { x: r.left + q.x, y: r.top + q.y }; });
        const tp = (x, y) => [{ x, y, id: 0, radiusX: 4, radiusY: 4, force: 1 }];
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: tp(root.x, root.y) });
        for (let i = 1; i <= 6; i++) { await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: tp(root.x, root.y + i * 20) }); await sleep(16); }
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
        await page.waitForFunction(() => window.__t.dig, null, { timeout: 4000 }).catch(() => {});
      }
      T = await page.evaluate(() => Object.assign({}, window.__t, { audio: window.__sfx && window.__sfx.ctxState(),
        nodev: window.__cfg && window.__cfg.dev.enabled === false }));
      const rel = (k) => (T[k] != null && T.tap != null ? Math.round(T[k] - T.tap) : null);
      ok('the patched build reads dev.enabled false (the shipping path)', T.nodev);
      ok('a fresh save never shows the title', !T.title && T.run != null, `title ${rel('title')}, run at ${rel('run')} ms`);
      ok('...the curtain lifts within 600 ms of the gate tap', rel('reveal') != null && rel('reveal') <= 600, `${rel('reveal')} ms`);
      ok('...and a drag begun 200 ms after #minehint shows is accepted within 2.5 s of the tap',
         rel('dig') != null && rel('dig') <= 2500, `hint at ${rel('hint')} ms, dig accepted at ${rel('dig')} ms`);
      ok('the gate tap unlocked audio (AudioContext running)', T.audio === 'running', String(T.audio));
      await page.screenshot({ path: path.join(ART, 'm4-first-visit-390.png') });
      // THE SECOND BOOT of the same save: the dug descent is banked at boot (hidden-tab pending), so
      // the save now has a finished run and the title shows.
      await page.goto(E.base + '/index-nodev.html', { waitUntil: 'domcontentloaded' });
      await page.waitForSelector('#loadscreen.ld-ready', { timeout: 60000 }).catch(() => {});
      await page.touchscreen.tap(195, 420);
      const title2 = await page.waitForSelector('#tsNewMine', { timeout: 20000 }).then(() => true).catch(() => false);
      const p2 = await prog(page);
      ok('a second boot of that save shows the title', title2, `runsDone ${p2.runsDone | 0}, mineBest ${p2.mineBest | 0}`);
      ok('no page errors', errs.length === 0, errs.slice(0, 2).join(' | ') || 'clean');
      await ctx.close();
      // `?dev=1` ON A FRESH SAVE STILL REACHES THE TITLE (verifier): it is how the owner gets the
      // title and the store's dev column on the Pages build (dev.enabled true), and the first-visit
      // skip used to drop that profile straight into a descent. Control: the same build, no flag.
      const firstDest = async (url) => {
        const c = await touchCtx(E, 390, 844), pg = await c.newPage();
        await pg.addInitScript(() => { window.MYCELIUM_SUPABASE = { url: '', anonKey: '' }; });
        await pg.goto(E.base + url, { waitUntil: 'domcontentloaded' });
        await pg.waitForSelector('#loadscreen.ld-ready', { timeout: 60000 }).catch(() => {});
        await pg.touchscreen.tap(195, 420);
        const d = await pg.waitForFunction(() => { const g = window.__game;
          if (document.getElementById('titleScreen')) return 'title';
          if (g && g.state && g.state.substrate && g.state.substrate.mine) return 'descent';
          return false; }, null, { timeout: 30000 }).then((h) => h.jsonValue()).catch(() => null);
        await c.close(); return d;
      };
      const devDest = await firstDest('/index.html?dev=1'), plainDest = await firstDest('/index.html');
      ok('a fresh save opened with ?dev=1 lands on the title (control: without it, a descent)', devDest === 'title' && plainDest === 'descent',
         `?dev=1 -> ${devDest}, plain -> ${plainDest}`);
    }

    // =========================================================================================
    // 2. THE GHOST FINGER
    // =========================================================================================
    if (want('ghost')) {
      console.log('--- the ghost finger (#mine,4242, fresh save)');
      const b = await E.bootMine(4242, 390, 844);
      await quiet(b.page);
      const g1 = await b.page.evaluate(async () => {
        const g = window.__game, s = g.state, wait = (ms) => new Promise((r) => setTimeout(r, ms));
        const out = { f0: g.mine.ghost().frames };
        await wait(900); out.f1 = g.mine.ghost().frames; out.on = g.mine.ghost().on; out.ang = g.mine.ghost().ang;
        const root = s.active.nodes[0];
        out.ray = g.mine.bestDownRay(root.x, root.y);
        out.dig = g.mine.growFrom(root.x, root.y, root.x, root.y + 200).ok;
        await wait(300); out.f2 = g.mine.ghost().frames;
        await wait(1500); out.f3 = g.mine.ghost().frames;
        await wait(5200); out.f4 = g.mine.ghost().frames; out.runNo = g.mine.onb().runNo;
        return out;
      });
      await b.page.screenshot({ path: path.join(ART, 'm4-ghost-idle-390.png') });
      ok('ghost().frames rises before the first dig', g1.f1 > g1.f0 && g1.on, `${g1.f0} -> ${g1.f1} over 900 ms, on ${g1.on}`);
      ok('...along an open downward ray (7 rays, scored on the mask)', g1.ray && g1.ray.clear > 0 && g1.ang > 0.4 && g1.ang < 2.8,
         `angle ${(g1.ang * 180 / Math.PI).toFixed(0)} deg, clear ${g1.ray && Math.round(g1.ray.clear)} u`);
      ok('...and stops rising after the first dig', g1.dig && g1.f3 === g1.f2, `dig ${g1.dig}; ${g1.f2} -> ${g1.f3} over 1.5 s`);
      ok('...and comes back after 6 s without a dig on run 1', g1.runNo === 1 && g1.f4 > g1.f3, `run ${g1.runNo}: ${g1.f3} -> ${g1.f4} after 7 s idle`);
      // RUN 3: the idle return is for runs 1-2 only (the first-dig ghost still shows).
      await b.page.evaluate(() => { const p = JSON.parse(localStorage.getItem('mycelium.progress.v2') || '{}'); p.runsDone = 2; p.mineBest = 30;
        localStorage.setItem('mycelium.progress.v2', JSON.stringify(p)); window.__game.mine.playSeed(4242); });
      await H.waitMine(b.page); await quiet(b.page);
      const g3 = await b.page.evaluate(async () => {
        const g = window.__game, s = g.state, wait = (ms) => new Promise((r) => setTimeout(r, ms));
        const out = { runNo: g.mine.onb().runNo, f0: g.mine.ghost().frames };
        await wait(900); out.f1 = g.mine.ghost().frames;
        const root = s.active.nodes[0];
        out.dig = g.mine.growFrom(root.x, root.y, root.x, root.y + 200).ok;
        await wait(400); out.f2 = g.mine.ghost().frames;
        await wait(6800); out.f3 = g.mine.ghost().frames;
        return out;
      });
      ok('run 3 still shows it before the first dig', g3.runNo === 3 && g3.f1 > g3.f0, `run ${g3.runNo}: ${g3.f0} -> ${g3.f1}`);
      ok('...but not after 7 s idle', g3.dig && g3.f3 === g3.f2, `${g3.f2} -> ${g3.f3}`);
      // THE RAY MEMO DOES NOT SURVIVE THE RUN (verifier fix): strand ids restart at 0, so a run that
      // ended with the ghost on its root handed the next run's root the SAME memo key ('0:0:1') and
      // the ghost slid along a ray scored on the previous seed's rock. Every root ray on these seeds
      // is straight down (the head is carved under the home column), so the check reads the memo
      // itself: two runs back to back, the ghost on the root both times, and the second must
      // RE-SCORE its ray (`scores` rises) although its key is identical.
      const gm = await b.page.evaluate(async () => {
        const g = window.__game, wait = (ms) => new Promise((r) => setTimeout(r, ms));
        const waitMask = async () => { for (let i = 0; i < 200 && !(g.state.substrate && g.state.substrate._rockSolidified && g.mine.ghost().on); i++) await wait(50); };
        g.mine.playSeed(4242); await waitMask(); await wait(500);
        const a = g.mine.ghost();
        g.mine.playSeed(909); await waitMask(); await wait(500);
        const c = g.mine.ghost();
        return { s0: a.scores, s1: c.scores, on: a.on && c.on, digs: g.state.mineDigs | 0 };
      });
      ok("a new run re-scores the ghost's ray even when its memo key repeats", gm.on && gm.digs === 0 && gm.s1 > gm.s0,
         `scores ${gm.s0} -> ${gm.s1} across the run change, both on the root`);
      ok('no page errors', b.errs.length === 0, b.errs.slice(0, 2).join(' | ') || 'clean');
      await b.ctx.close();
    }

    // =========================================================================================
    // 3. THE ONE-SHOT TIPS, through a stubbed telemetry route, and again after a reload
    // =========================================================================================
    if (want('tips')) {
      console.log('--- one-shot tips (#mine,4242, fresh save, telemetry routed to a stub)');
      const ctx = await E.browser.newContext({ viewport: { width: 390, height: 844 } });
      const posted = [];
      await ctx.route('https://tele.test/**', async (route) => {
        const rq = route.request();
        if (rq.method() === 'POST' && /\/rest\/v1\/events/.test(rq.url())) { try { posted.push(JSON.parse(rq.postData() || '{}')); } catch (_) {} }
        await route.fulfill({ status: rq.method() === 'POST' ? 201 : 200, contentType: 'application/json', body: '[]' });
      });
      await ctx.addInitScript(() => {
        window.MYCELIUM_SUPABASE = { url: 'https://tele.test', anonKey: 'k' };
        // WHEN each line appeared, in the same clock as the event's `ms` (ms since mineStartedAt).
        window.__shown = [];
        setInterval(() => { const h = document.getElementById('minehint'), s = window.__game && window.__game.state;
          const t = h && !h.hidden ? (h.textContent || '').trim() : '';
          if (t && t !== window.__lastHint && s && s.mineStartedAt) window.__shown.push({ t, ms: Date.now() - s.mineStartedAt });
          window.__lastHint = t; }, 10);
      });
      const page = await ctx.newPage();
      const errs = []; page.on('pageerror', (e) => errs.push(String(e && e.message)));
      const bootSeed = async () => {
        await page.goto(E.base + '/index.html#mine,4242', { waitUntil: 'domcontentloaded' });
        await page.waitForSelector('#loadscreen.ld-ready', { timeout: 40000 }).catch(() => {});
        await page.click('#loadscreen', { timeout: 5000 }).catch(() => {});
        await H.waitMine(page); await H.injectNav(page); await quiet(page);
      };
      // The four stimuli, in order; returns the hint lines seen for each.
      const stimuli = async () => {
        const out = {};
        await page.evaluate(() => { const s = window.__game.state, r = s.active.nodes[0]; window.__game.mine.growFrom(r.x, r.y, r.x, r.y + 200); });
        out.dig = await pollHint(page, /Every dig costs water/, 2500);
        await page.evaluate(() => {
          const g = window.__game, s = g.state, sub = s.substrate, root = s.active.nodes[0];
          let best = null, bd = Infinity;
          for (const p of sub.foodPiles) {
            if (p.rewarded || (p.mineMat && p.mineMat !== 'phosphorus')) continue;
            let x = 0, y = 0; for (const i of p.cells) { x += (i % sub.cols + 0.5) * sub.cellSize; y += sub.surfaceY + (((i / sub.cols) | 0) + 0.5) * sub.cellSize; }
            x /= p.cells.length; y /= p.cells.length;
            const d = Math.hypot(x - root.x, y - root.y); if (d < bd) { bd = d; best = { x, y }; }
          }
          window.__pileAt = best; g.mine.lookAt(best.x, best.y);
        });
        out.ore = await pollHint(page, /Phosphorus — grow into it/, 8000);
        out.ring = await page.evaluate(() => window.__game.mine.onb().ring);
        await page.evaluate(() => {
          const g = window.__game, s = g.state, sub = s.substrate, root = s.active.nodes[0];
          // A reservoir's cx/cy are CELL coordinates.
          const W = (q) => ({ x: (q.cx + 0.5) * sub.cellSize, y: sub.surfaceY + (q.cy + 0.5) * sub.cellSize });
          const r = sub.reservoirs.slice().sort((a, b) => Math.hypot(W(a).x - root.x, W(a).y - root.y) - Math.hypot(W(b).x - root.x, W(b).y - root.y))[0];
          g.mine.lookAt(W(r).x, W(r).y);
        });
        out.pocket = await pollHint(page, /Water pocket — touch it for \+10/, 8000);
        await page.evaluate(async () => { window.__game.state.active.water = 100000; await window.__navDig({ targetM: 37, maxIters: 400 }); });
        out.label = await page.evaluate(async () => {
          for (let i = 0; i < 60; i++) { const l = window.__game.mine.onb().label; if (l && l.drawn > 0) return l; await new Promise((r) => setTimeout(r, 50)); }
          return window.__game.mine.onb().label;
        });
        out.depth = await page.evaluate(() => window.__game.state.mineMaxDepth | 0);
        return out;
      };
      await bootSeed();
      const a = await stimuli();
      await page.screenshot({ path: path.join(ART, 'm4-tips-label-390.png') });
      await sleep(800);
      const tut = () => posted.filter((r) => r.kind === 'tutorial').map((r) => r.detail);
      const t1 = tut();
      ok("first dig: 'Every dig costs water — the deeper, the more'", !!a.dig, a.dig ? `${a.dig.at} ms after the dig` : 'never');
      ok("first P seam on screen: 'Phosphorus — grow into it' and a pulse ring", !!a.ore && !!a.ring, a.ore ? `ring ${JSON.stringify(a.ring)}` : 'never');
      ok("first pocket on screen: 'Water pocket — touch it for +10'", !!a.pocket, a.pocket ? a.pocket.t : 'never');
      ok("6 m above the first price line: a label on it, 'Past 42 m every dig costs 4'",
         !!a.label && a.label.text === 'Past 42 m every dig costs 4' && a.label.drawn > 0, `${JSON.stringify(a.label)} at ${a.depth} m`);
      const cnt = (list, id) => list.filter((d) => d === id).length;
      ok("the stub received one 'tutorial' event each for dig, first_ore, first_pocket, first_line",
         ['dig', 'first_ore', 'first_pocket', 'first_line'].every((id) => cnt(t1, id) === 1), JSON.stringify(t1));
      ok('...each carrying ms into the run', posted.filter((r) => r.kind === 'tutorial').every((r) => r.ms >= 0 && r.ms < 600000),
         posted.filter((r) => r.kind === 'tutorial').map((r) => r.ms).join(', '));
      // LOGGED WHEN SHOWN, NOT WHEN QUEUED (verifier fix): each hint tip's event `ms` lands within
      // 250 ms of the moment its line appeared in #minehint (it used to fire at queue time, seconds
      // before the line showed, and for lines that never showed at all).
      const shown = await page.evaluate(() => window.__shown.slice());
      const REs = { dig: /Every dig costs water/, first_ore: /Phosphorus — grow into it/, first_pocket: /Water pocket/ };
      const gaps = Object.keys(REs).map((id) => { const ev = posted.find((r) => r.kind === 'tutorial' && r.detail === id);
        const sh = shown.find((x) => REs[id].test(x.t)); return { id, ev: ev && ev.ms, sh: sh && sh.ms, gap: ev && sh ? Math.abs(ev.ms - sh.ms) : null }; });
      ok('...and each hint tip is logged within 250 ms of the moment it shows', gaps.every((g) => g.gap != null && g.gap <= 250),
         gaps.map((g) => `${g.id} ev ${g.ev} / shown ${g.sh}`).join(', '));
      const pr = await prog(page);
      ok('p.mineTips records all four', ['dig', 'first_ore', 'first_pocket', 'first_line'].every((k) => pr.mineTips && pr.mineTips[k]), JSON.stringify(pr.mineTips));
      // ...AND A RELOAD FIRES NONE OF THEM AGAIN.
      await bootSeed();
      const b2 = await stimuli();
      await sleep(800);
      const t2 = tut().slice(t1.length);
      ok('after a reload the same four stimuli send no tutorial event', t2.length === 0, JSON.stringify(t2));
      ok('...and show none of the four', !b2.dig && !b2.ore && !b2.pocket && !b2.label && !b2.ring,
         JSON.stringify({ dig: !!b2.dig, ore: !!b2.ore, pocket: !!b2.pocket, label: b2.label, depth: b2.depth }));
      ok('no page errors', errs.length === 0, errs.slice(0, 2).join(' | ') || 'clean');
      await ctx.close();
    }

    // =========================================================================================
    // 3b. A QUEUED TIP IS NOT A SEEN TIP — the cost line goes first, a claimed subject is dropped
    // =========================================================================================
    // The same sequence twice (verifier minor: the claimed case alone could pass with the reward
    // clause deleted, because the ore tip also drops when its seam leaves the screen or passes
    // maxAge). The camera is PINNED on the seam after the dig in both, so only the reward differs:
    // claimed -> never shown; unclaimed (the CONTROL) -> shown.
    if (want('stale')) for (const claim of [true, false]) {
      console.log(`--- stale tips (#mine,4242, fresh save): queued behind the drag line, then ${claim ? 'claimed' : 'NOT claimed (control)'}`);
      const ctx = await E.browser.newContext({ viewport: { width: 390, height: 844 } });
      const posted = [];
      await ctx.route('https://tele.test/**', async (route) => {
        const rq = route.request();
        if (rq.method() === 'POST' && /\/rest\/v1\/events/.test(rq.url())) { try { posted.push(JSON.parse(rq.postData() || '{}')); } catch (_) {} }
        await route.fulfill({ status: rq.method() === 'POST' ? 201 : 200, contentType: 'application/json', body: '[]' });
      });
      await ctx.addInitScript(() => { window.MYCELIUM_SUPABASE = { url: 'https://tele.test', anonKey: 'k' }; });
      const page = await ctx.newPage();
      const errs = []; page.on('pageerror', (e) => errs.push(String(e && e.message)));
      await page.goto(E.base + '/index.html#mine,4242', { waitUntil: 'domcontentloaded' });
      await page.waitForSelector('#loadscreen.ld-ready', { timeout: 40000 }).catch(() => {});
      await page.click('#loadscreen', { timeout: 5000 }).catch(() => {});
      await H.waitMine(page); await quiet(page);
      const tut = () => posted.filter((r) => r.kind === 'tutorial').map((r) => r.detail);
      // A P seam on screen while the sticky drag line is up: the ore line QUEUES behind it.
      const q = await page.evaluate(async () => {
        const g = window.__game, s = g.state, sub = s.substrate, root = s.active.nodes[0];
        let best = null, bd = Infinity;
        for (const p of sub.foodPiles) {
          if (p.rewarded || (p.mineMat && p.mineMat !== 'phosphorus')) continue;
          let x = 0, y = 0; for (const i of p.cells) { x += (i % sub.cols + 0.5) * sub.cellSize; y += sub.surfaceY + (((i / sub.cols) | 0) + 0.5) * sub.cellSize; }
          x /= p.cells.length; y /= p.cells.length;
          const d = Math.hypot(x - root.x, y - root.y); if (d < bd) { bd = d; best = { x, y }; }
        }
        g.mine.lookAt(best.x, best.y);
        await new Promise((r) => setTimeout(r, 900));
        const Q = s._mineTips || {};
        return { seam: best, hint: (document.getElementById('minehint') || {}).textContent || '', queued: (Q.queue || []).map((t) => t.id),
                 seen: !!JSON.parse(localStorage.getItem('mycelium.progress.v2') || '{}').mineTips?.first_ore };
      });
      await sleep(500);
      ok('an ore tip found while the drag line is up is QUEUED, not recorded or logged', /Drag down/.test(q.hint) && q.queued.includes('ore')
         && !q.seen && !tut().includes('first_ore'), `hint "${q.hint}", queue ${JSON.stringify(q.queued)}, recorded ${q.seen}, events ${JSON.stringify(tut())}`);
      // The first dig: the cost line shows AT ONCE, ahead of the waiting ore line.
      const d = await page.evaluate(async ({ claim, seam }) => {
        const g = window.__game, s = g.state, r = s.active.nodes[0];
        const t0 = performance.now(); const ok = g.mine.growFrom(r.x, r.y, r.x, r.y + 200).ok;
        let at = null;
        while (performance.now() - t0 < 2500) { const t = (document.getElementById('minehint') || {}).textContent || '';
          if (/Every dig costs water/.test(t)) { at = Math.round(performance.now() - t0); break; }
          if (/Phosphorus/.test(t)) break;
          await new Promise((q) => setTimeout(q, 20)); }
        // The dig re-armed the follow camera: pin it back on the seam, so leaving the screen cannot be
        // why the line drops.
        g.mine.lookAt(seam.x, seam.y);
        // ...then (unless this is the control) every P seam is claimed before the ore line's turn comes.
        if (claim) for (const p of s.substrate.foodPiles) if (!p.mineMat || p.mineMat === 'phosphorus') p.rewarded = true;
        const seenOre = [];
        const t1 = performance.now();
        while (performance.now() - t1 < 5500) { const t = (document.getElementById('minehint') || {}).textContent || '';
          if (/Phosphorus/.test(t)) seenOre.push(Math.round(performance.now() - t1));
          if (!claim) g.mine.lookAt(seam.x, seam.y);   // hold the pin (a camera ease could drift)
          await new Promise((q) => setTimeout(q, 40)); }
        return { ok, at, seenOre: seenOre.length, firstOre: seenOre[0], ring: g.mine.onb().ring,
                 seen: !!JSON.parse(localStorage.getItem('mycelium.progress.v2') || '{}').mineTips?.first_ore };
      }, { claim, seam: q.seam });
      if (!claim) {
        ok('CONTROL: the same sequence with the seam NOT claimed (camera pinned) shows the queued ore line, and records it',
           d.seenOre > 0 && d.seen && tut().includes('first_ore'), `shown ${d.seenOre} samples (first at ${d.firstOre} ms), recorded ${d.seen}, events ${JSON.stringify(tut())}`);
        ok('no page errors', errs.length === 0, errs.slice(0, 2).join(' | ') || 'clean');
        await ctx.close();
        continue;
      }
      ok("the first dig's cost line shows within 400 ms, ahead of the queued ore line", d.ok && d.at != null && d.at <= 400, `${d.at} ms`);
      ok('...and an ore line whose seam was claimed before its turn is dropped: never shown, not recorded, not logged',
         d.seenOre === 0 && !d.ring && !d.seen && !tut().includes('first_ore'), `shown ${d.seenOre} samples, ring ${!!d.ring}, recorded ${d.seen}, events ${JSON.stringify(tut())}`);
      ok('...while the dig tip was logged once', tut().filter((x) => x === 'dig').length === 1, JSON.stringify(tut()));
      ok('no page errors', errs.length === 0, errs.slice(0, 2).join(' | ') || 'clean');
      await ctx.close();
    }

    // =========================================================================================
    // 4. THE PRICE-LINE BEAT
    // =========================================================================================
    if (want('beat')) {
      const watchBeats = (page) => page.evaluate(() => {
        window.__beats = [];
        new MutationObserver(() => { const e = document.getElementById('mineBeat');
          if (e && !e.__seen) { e.__seen = 1; window.__beats.push({ text: e.innerText.replace(/\s+/g, ' ').trim(), small: e.classList.contains('small') }); } })
          .observe(document.body, { childList: true });
      });
      console.log('--- the 42 m beat, no tolerance bought');
      {
        const b = await E.bootMine(4242, 390, 844);
        await quiet(b.page); await watchBeats(b.page);
        const r = await b.page.evaluate(async () => { window.__game.state.active.water = 100000;
          const n = await window.__navDig({ targetM: 47, maxIters: 500 }); await new Promise((r) => setTimeout(r, 600));
          return { depth: n.depth, beats: window.__beats, lines: window.__game.mine.heatLines ? window.__game.mine.heatLines() : null }; });
        const b42 = r.beats.find((x) => /^42 m/.test(x.text));
        ok("the 42 m beat contains 'Digs now cost 4'", !!b42 && /Digs now cost 4\b/.test(b42.text), `${JSON.stringify(r.beats)} at ${r.depth} m`);
        await b.page.screenshot({ path: path.join(ART, 'm4-beat-42-390.png') });
        await b.ctx.close();
      }
      console.log('--- one step of heat tolerance: the moved line beats on its own');
      {
        const b = await E.bootMine(4242, 390, 844);
        const bought = await b.page.evaluate(() => { const S = window.__game.store; S.credit(500); S.revealAll(); const r = S.buy('heatTolerance');   // M5: revealed first
          window.__game.mine.playSeed(4242); return r; });
        await H.waitMine(b.page); await H.injectNav(b.page); await quiet(b.page); await watchBeats(b.page);
        const r = await b.page.evaluate(async () => { window.__game.state.active.water = 100000;
          const first = window.__game.state.config.mine.heat.safeDepth + (window.__game.state.config.mine.heatBonus | 0);
          const n = await window.__navDig({ targetM: first + 5, maxIters: 700 }); await new Promise((r) => setTimeout(r, 600));
          return { first, depth: n.depth, beats: window.__beats }; });
        const b42 = r.beats.find((x) => /^42 m/.test(x.text));
        const own = r.beats.find((x) => x.text.startsWith(r.first + ' m'));
        ok('the heat tolerance step was bought and moved the first line', bought && bought.ok !== false && r.first > 42, `first line ${r.first} m`);
        ok("...the 42 m band beat reads 'Digs still cost 2'", !!b42 && /Digs still cost 2\b/.test(b42.text) && !/Digs now cost/.test(b42.text), JSON.stringify(b42));
        ok(`...and the moved line gets a small beat of its own, 'Digs now cost 4'`, !!own && own.small && /Digs now cost 4\b/.test(own.text),
           `${JSON.stringify(r.beats)} at ${r.depth} m`);
        await b.ctx.close();
      }
    }

    // =========================================================================================
    // 5. COLLECTION FEEDBACK — floater at the site within 200 ms, a ping; muted, no count
    // =========================================================================================
    if (want('feedback')) {
      console.log('--- collection feedback (#mine,4242: the route bot digs to seams)');
      const b = await E.bootMine(4242, 390, 844);
      await quiet(b.page); await lib.injectBot(b.page);
      await b.page.evaluate(() => {
        const g = window.__game, s = g.state, sub = s.substrate;
        s.active.water = 100000;
        window.__pays = []; let last = s.mineOre | 0; const seen = new Set(sub.foodPiles.filter((p) => p.rewarded));
        const cen = (p) => { let x = 0, y = 0; for (const i of p.cells) { x += (i % sub.cols + 0.5) * sub.cellSize; y += sub.surfaceY + (((i / sub.cols) | 0) + 0.5) * sub.cellSize; } return { x: x / p.cells.length, y: y / p.cells.length }; };
        let lastW = window.__sfx.counts.ore;
        const tick = () => {
          const o = s.mineOre | 0;
          if (o !== last) {
            const t = performance.now();
            const piles = sub.foodPiles.filter((p) => p.rewarded && !seen.has(p) && (!p.mineMat || p.mineMat === 'phosphorus'));
            piles.forEach((p) => seen.add(p));
            const rec = { t, dOre: o - last, piles: piles.map(cen), sfxBefore: lastW, sfxAfter: window.__sfx.counts.ore, muted: window.__sfx.muted() };
            last = o; lastW = window.__sfx.counts.ore;
            setTimeout(() => { rec.floaters = g.mine.floaters().filter((f) => /^\+\d+ P$/.test(f.text)).map((f) => ({ x: f.x, y: f.y, text: f.text, bornAt: performance.now() - f.age }));
              window.__pays.push(rec); }, 200);
          } else lastW = window.__sfx.counts.ore;
          if (!s.runOver) requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      });
      const digUntil = async (n) => {
        for (let i = 0; i < 90; i++) {
          const k = await b.page.evaluate(() => window.__pays.length);
          if (k >= n) return true;
          await b.page.evaluate(() => window.__qa.step({ visR: 3000, useItems: false, maxDetour: 6000 }));
          await sleep(700);
        }
        return false;
      };
      await digUntil(1);
      await sleep(300);
      const p1 = await b.page.evaluate(() => window.__pays.slice());
      const e1 = p1[0];
      const near = e1 && e1.piles.length && e1.floaters.find((f) => e1.piles.some((c) => Math.hypot(c.x - f.x, c.y - f.y) <= 60) && f.bornAt - e1.t <= 200);
      ok('a claimed seam spawns a floater within 60 world units of the pile centroid within 200 ms', !!near,
         e1 ? `piles ${JSON.stringify(e1.piles.map((c) => [Math.round(c.x), Math.round(c.y)]))}, floaters ${JSON.stringify((e1.floaters || []).map((f) => [f.text, Math.round(f.x), Math.round(f.y), Math.round(f.bornAt - e1.t)]))}` : 'no seam paid in 90 digs');
      ok('...and __sfx.counts.ore rises by 1 per seam', !!e1 && e1.sfxAfter - e1.sfxBefore === e1.piles.length && e1.piles.length >= 1,
         e1 ? `${e1.sfxBefore} -> ${e1.sfxAfter} for ${e1.piles.length} seam(s)` : '');
      await b.page.screenshot({ path: path.join(ART, 'm4-floater-390.png') });
      // MUTED: the next seam still floats but rings nothing.
      await b.page.evaluate(() => { if (!window.__sfx.muted()) window.__game.sfx().toggleSfx(); });
      await digUntil(p1.length + 1);
      await sleep(300);
      const p2 = await b.page.evaluate(() => window.__pays.slice());
      const e2 = p2[p1.length];
      ok('with sound muted, a seam leaves the counts unchanged', !!e2 && e2.muted && e2.sfxAfter === e2.sfxBefore && e2.piles.length >= 1,
         e2 ? `${e2.sfxBefore} -> ${e2.sfxAfter}, muted ${e2.muted}` : 'no second seam paid');
      ok('...and still floats its payout', !!e2 && e2.floaters.length > 0, e2 ? JSON.stringify(e2.floaters.map((f) => f.text)) : '');
      await b.page.evaluate(() => { if (window.__sfx.muted()) window.__game.sfx().toggleSfx(); });
      ok('no page errors', b.errs.length === 0, b.errs.slice(0, 2).join(' | ') || 'clean');
      await b.ctx.close();
    }

    // =========================================================================================
    // 6. A TAPPED POCKET READS AS SPENT
    // =========================================================================================
    if (want('pocket')) {
      console.log('--- a tapped pocket is drawn at 35%');
      const b = await E.bootMine(4242, 390, 844);
      await quiet(b.page);
      const r = await b.page.evaluate(async () => {
        const g = window.__game, s = g.state, sub = s.substrate, root = s.active.nodes[0];
        // The first-pocket tip's ring would be drawn over the disc: mark the tips as already seen.
        const pp = JSON.parse(localStorage.getItem('mycelium.progress.v2') || '{}');
        pp.mineTips = { dig: true, first_ore: true, first_pocket: true, first_line: true };
        localStorage.setItem('mycelium.progress.v2', JSON.stringify(pp));
        const tapped = s._tappedWater || (s._tappedWater = new Set());
        const W = (q) => ({ x: (q.cx + 0.5) * sub.cellSize, y: sub.surfaceY + (q.cy + 0.5) * sub.cellSize });   // cx/cy are cells
        const res = sub.reservoirs.filter((q) => !tapped.has(q.id))
          .sort((a, b) => Math.hypot(W(a).x - root.x, W(a).y - root.y) - Math.hypot(W(b).x - root.x, W(b).y - root.y))[0];
        g.mine.lookAt(W(res).x, W(res).y);
        const cv = document.getElementById('game'), c2 = cv.getContext('2d'), k = cv.width / cv.clientWidth;
        const lum = () => {
          g.renderFrame(performance.now(), 1);
          // The pocket's own water cells (its footprint), in screen px, inset half a cell.
          const tl = g.camera.worldToScreen((res.c0 + 0.5) * sub.cellSize, sub.surfaceY + (res.r0 + 0.5) * sub.cellSize);
          const br = g.camera.worldToScreen((res.c1 + 0.5) * sub.cellSize, sub.surfaceY + (res.r1 + 0.5) * sub.cellSize);
          const x = Math.round(tl.x * k), y = Math.round(tl.y * k), w = Math.max(2, Math.round((br.x - tl.x) * k)), h = Math.max(2, Math.round((br.y - tl.y) * k));
          const d = c2.getImageData(x, y, w, h).data; let L = 0;
          for (let i = 0; i < d.length; i += 4) L += 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
          return { L: L / (d.length / 4), rect: [x, y, w, h], zoom: g.camera.zoom };
        };
        await new Promise((r) => setTimeout(r, 300));
        const before = lum(), again = lum();
        tapped.add(res.id);
        const after = lum();
        return { id: res.id, before, again, after };
      });
      await b.page.screenshot({ path: path.join(ART, 'm4-pocket-tapped-390.png') });
      ok('the untapped reading is on screen and stable (control)', r.before.L > 20 && Math.abs(r.before.L - r.again.L) < 3,
         `${r.before.L.toFixed(1)} / ${r.again.L.toFixed(1)}, rect ${r.before.rect.join(',')}`);
      ok("a tapped pocket's disc reads at most 0.7x its untapped luminance at the same zoom",
         r.after.zoom === r.before.zoom && r.after.L <= 0.7 * r.before.L,
         `${r.before.L.toFixed(1)} -> ${r.after.L.toFixed(1)} (${(r.after.L / r.before.L).toFixed(2)}x), rect ${r.before.rect.join(',')}`);
      await b.ctx.close();
    }

    // =========================================================================================
    // 6b. A POCKET PAYS WHEN THE DRAWN COLONY REACHES IT (verifier minor, round 2)
    // =========================================================================================
    // The route bot digs toward water; every payout is caught on the frame it lands and the strands
    // touching that pocket are counted, split by `grownIn`. Before the fix 0 of the touching strands
    // had grown in at 9 of 9 payouts (the first arrived 258-1097 ms later), so the '+10 water' floater
    // and the glug landed before their cause.
    if (want('pocketlag')) {
      console.log('--- a pocket pays only once a strand touching it has grown in (#mine,4242)');
      const b = await E.bootMine(4242, 390, 844);
      await quiet(b.page);
      await lib.injectBot(b.page);
      await b.page.evaluate(() => { const g = window.__game, s = g.state, sub = s.substrate; s.active.water = 100000;
        window.__pl = []; const known = new Set(s._tappedWater || []);
        const near = (r) => { const cs = sub.cellSize, md = 30; let any = 0, grown = 0;
          const x0 = r.c0 * cs, x1 = (r.c1 + 1) * cs, y0 = sub.surfaceY + r.r0 * cs, y1 = sub.surfaceY + (r.r1 + 1) * cs;
          for (const n of s.active.nodes) { if (n.infected) continue;
            const dx = Math.max(x0 - n.x, 0, n.x - x1), dy = Math.max(y0 - n.y, 0, n.y - y1);
            if (Math.hypot(dx, dy) <= md) { any++; if (s.active.grownIn(n)) grown++; } }
          return { any, grown }; };
        const t = () => { for (const id of (s._tappedWater || [])) if (!known.has(id)) { known.add(id);
            const r = sub.reservoirs.find((q) => q.id === id); if (r) window.__pl.push(Object.assign({ id }, near(r))); }
          if (!s.runOver) requestAnimationFrame(t); };
        requestAnimationFrame(t); });
      for (let i = 0; i < 40; i++) {
        await b.page.evaluate(() => window.__qa.step({ visR: 3000, useItems: false, maxDetour: 6000 }));
        await sleep(700);
        if (await b.page.evaluate(() => window.__pl.length >= 3)) break;
      }
      await sleep(1500);
      const pl = await b.page.evaluate(() => window.__pl.slice());
      ok('every pocket payout had a GROWN-IN strand touching the pocket when it paid', pl.length >= 2 && pl.every((e) => e.grown > 0),
         `${pl.length} payouts: ${pl.map((e) => `#${e.id} ${e.grown}/${e.any} grown`).join(', ')}`);
      await b.ctx.close();
    }

    // =========================================================================================
    // 7. THE DEAD-END NUDGE (runs 1-5)
    // =========================================================================================
    if (want('nudge')) {
      // THE NAIVE PLAYER'S OWN DEAD END: dig from the deepest clean tip along the most open downward
      // ray (the ghost's choice) until two successful digs in a row each take fewer than 2 new cells.
      // On seed 4242 that is digs 8-9 at 28 m (tests/bots/naive.cjs --baseline). At most 20 digs.
      const deadEnds = (page) => page.evaluate(async () => {
        const g = window.__game, s = g.state, wait = (ms) => new Promise((r) => setTimeout(r, ms));
        s.active.water = 100000;
        const reach = s.config.growth.segmentLength * 3 * (s.config.mine.growSteps || 2);
        const cells = []; let pair = false;
        for (let i = 0; i < 20 && !pair; i++) {
          let t = null; for (const n of s.active.nodes) if (!n.infected && (!t || n.y > t.y)) t = n;
          const ray = g.mine.bestDownRay(t.x, t.y), a = ray ? ray.ang : Math.PI / 2;
          const r = g.mine.growFrom(t.x, t.y, t.x + Math.cos(a) * reach, t.y + Math.sin(a) * reach);
          cells.push(r.ok ? r.newCells : 'x');
          const k = cells.length;
          pair = k >= 2 && typeof cells[k - 1] === 'number' && typeof cells[k - 2] === 'number' && cells[k - 1] < 2 && cells[k - 2] < 2;
          await wait(pair ? 150 : 450);
        }
        const h = document.getElementById('minehint');
        return { cells, pair, glow: g.mine.glow(), hint: h ? (h.textContent || '').trim() : '', runNo: g.mine.onb().runNo, depth: g.mine.maxDepth() };
      });
      console.log('--- run 1: two dead-end digs light the open tips');
      const b = await E.bootMine(4242, 390, 844);
      await quiet(b.page);
      const r1 = await deadEnds(b.page);
      await b.page.screenshot({ path: path.join(ART, 'm4-nudge-glow-390.png') });
      ok('two successful digs in a row that each take fewer than 2 new cells (a naive dive)', r1.pair, `${JSON.stringify(r1.cells)} at ${r1.depth} m`);
      ok('...light the two most open clean tips (glow)', r1.glow.nudges >= 1 && r1.glow.tips.length >= 1 && r1.glow.tips.length <= 2,
         `${r1.glow.nudges} nudge(s), tips ${JSON.stringify(r1.glow.tips.map((t) => [Math.round(t.x), Math.round(t.y), +t.score.toFixed(1)]))}`);
      ok("...and the hint reads 'Dead end — dig from a glowing tip'", r1.hint === 'Dead end — dig from a glowing tip', `"${r1.hint}"`);
      const gone = await b.page.evaluate(async () => { await new Promise((r) => setTimeout(r, 4300)); return window.__game.mine.glow().tips.length; });
      ok('...for 4 s', gone === 0, `${gone} tip(s) still lit at 4.3 s`);
      console.log('--- run 6: no nudge');
      await b.page.evaluate(() => { const p = JSON.parse(localStorage.getItem('mycelium.progress.v2') || '{}'); p.runsDone = 5; p.mineBest = 40;
        localStorage.setItem('mycelium.progress.v2', JSON.stringify(p)); window.__game.mine.playSeed(4242); });
      await H.waitMine(b.page); await quiet(b.page);
      const r6 = await deadEnds(b.page);
      ok('run 6: the same two dead-end digs light nothing (control)', r6.runNo === 6 && r6.glow.nudges === 0 && r6.pair,
         `run ${r6.runNo}, cells ${JSON.stringify(r6.cells)}, nudges ${r6.glow.nudges}`);
      await b.ctx.close();
    }

    // =========================================================================================
    // 7b. THE NUDGE ALSO FIRES ON 3 'Solid rock' REFUSALS IN A ROW, and the glow SHOWS the direction
    // =========================================================================================
    if (want('walled')) {
      console.log("--- run 1: three 'Solid rock' refusals in a row light the open tips (#mine,4242)");
      const b = await E.bootMine(4242, 390, 844);
      await quiet(b.page);
      const r = await b.page.evaluate(async () => {
        const g = window.__game, s = g.state, sub = s.substrate, wait = (ms) => new Promise((q) => setTimeout(q, ms));
        s.active.water = 100000;
        // The naive dive (deepest clean tip, most open downward ray) until its first 'Solid rock':
        // on 4242 that is dig 13 at 28 m, and every press after it is refused (verifier's variant a).
        const reach = s.config.growth.segmentLength * 3 * (s.config.mine.growSteps || 2);
        const press = (p) => g.mine.growFrom(p.x, p.y, p.x + Math.cos(p.a) * reach, p.y + Math.sin(p.a) * reach);
        let pick = null;
        for (let i = 0; i < 40 && !pick; i++) {
          let t = null; for (const n of s.active.nodes) if (!n.infected && (!t || n.y > t.y)) t = n;
          const ray = g.mine.bestDownRay(t.x, t.y), p = { x: t.x, y: t.y, a: ray ? ray.ang : Math.PI / 2 };
          const res = press(p);
          if (!res.ok && /Solid rock/.test(res.message || '')) pick = Object.assign(p, { msgs: [res.message] });
          await wait(450);
        }
        if (!pick) return null;
        await wait(4500);                       // any glow the dead digs lit has gone
        const n0 = g.mine.glow().nudges;
        const r2 = press(pick); pick.msgs.push(r2.message); await wait(150);
        const n1 = g.mine.glow().nudges - n0;
        // The third press is a REAL DRAG (below), so the UI's refusal toast is raised as a player's is.
        g.mine.lookAt(pick.x, pick.y); await wait(200);
        const q = g.camera.worldToScreen(pick.x, pick.y), cv = document.getElementById('game').getBoundingClientRect();
        return { pick, n0, n1, sx: cv.left + q.x, sy: cv.top + q.y, depth: g.mine.maxDepth() };
      }).then(async (st) => {
        if (!st) return null;
        // Drag from the walled strand along its refused ray.
        const L = 90, ex = st.sx + Math.cos(st.pick.a) * L, ey = st.sy + Math.sin(st.pick.a) * L;
        await b.page.mouse.move(st.sx, st.sy); await b.page.mouse.down();
        for (let k = 1; k <= 6; k++) { await b.page.mouse.move(st.sx + (ex - st.sx) * k / 6, st.sy + (ey - st.sy) * k / 6); await sleep(16); }
        await b.page.mouse.up();
        await sleep(450);
        return b.page.evaluate(({ st }) => {
          const g = window.__game, gl = g.mine.glow(), hint = document.getElementById('minehint');
          const toast = document.querySelector('.toast');
          const tv = !!(toast && !toast.classList.contains('hidden') && toast.classList.contains('in'));
          const hr = hint && !hint.hidden ? hint.getBoundingClientRect() : null;
          const cv = document.getElementById('game').getBoundingClientRect();
          const rows = document.querySelector('.minerows'), rr = rows ? rows.getBoundingClientRect() : null;
          const band = Math.max(hr ? hr.bottom : 0, rr ? rr.bottom : 0) - cv.top;
          const tips = gl.tips.map((t) => { const q = g.camera.worldToScreen(t.x, t.y);
            return { x: Math.round(q.x), y: Math.round(q.y), len: t.len, clearPx: t.clear * g.camera.zoom }; });
          return { msgs: st.pick.msgs.concat([(toast && toast.textContent) || '']), n1: st.n1, n2: gl.nudges - st.n0, glow: gl, depth: st.depth,
                   hint: hint ? hint.textContent || '' : '', toastUp: tv, toastText: toast ? toast.textContent : '', band, tips,
                   vw: g.camera.viewW, vh: g.camera.viewH };
        }, { st });
      });
      ok('a strand the dig refuses twice as solid rock, then a real drag on it', !!r && r.msgs.length === 3 && r.msgs.slice(0, 2).every((m) => /Solid rock/.test(m || '')),
         r ? JSON.stringify(r.msgs) : 'no walled strand found');
      if (r) {
        ok('...two refusals in a row nudge nothing (control)', r.n1 === 0, `+${r.n1} nudge(s) after the second, at ${r.depth} m`);
        ok('...the third lights the open tips', r.n2 === 1 && r.glow.tips.length >= 1, `+${r.n2} nudge(s), ${r.glow.tips.length} tip(s)`);
        ok("...with the 'Dead end' hint", /Dead end — dig from a glowing tip/.test(r.hint), `"${r.hint}"`);
        ok('...and each glowing tip DRAWS its direction (the ghost slide along its ray)', r.glow.drawn > 0 && r.glow.tips.every((t) => t.ang >= 0 && t.ang <= Math.PI),
           `${r.glow.drawn} tip-slides drawn, angles ${r.glow.tips.map((t) => (t.ang * 180 / Math.PI).toFixed(0)).join('/')}`);
        // Verifier minors, round 2 (p-ev7-25.png, p-ev3-20.png): the press that fires the nudge must
        // not leave its 'Solid rock' toast over the hint; a glowing tip is on screen and below the HUD
        // stack; and its slide (dot travel + 21 px head) ends inside the ray it was scored on.
        ok("...the drag's 'Solid rock' toast is dropped when the nudge fires (it sat on the hint)", !r.toastUp,
           `toast ${r.toastUp ? 'UP: ' + r.toastText : 'hidden'}`);
        ok('...every glowing tip is on screen and below the HUD stack', r.tips.length >= 1
           && r.tips.every((t) => t.y > r.band && t.y < r.vh && t.x > 0 && t.x < r.vw),
           `band ${Math.round(r.band)} px; tips ${r.tips.map((t) => `(${t.x},${t.y})`).join(' ')}`);
        ok('...and each slide ends inside its open ray', r.tips.every((t) => t.len + 21 <= Math.max(t.clearPx, 16 + 21) + 0.5),
           r.tips.map((t) => `${Math.round(t.len)}+21 px vs ${Math.round(t.clearPx)} px clear`).join(', '));
      }
      await b.page.screenshot({ path: path.join(ART, 'm4-nudge-walled-390.png') });
      ok('no page errors', b.errs.length === 0, b.errs.slice(0, 2).join(' | ') || 'clean');
      await b.ctx.close();
    }

    // =========================================================================================
    // 8. RUN 1'S END SCREEN
    // =========================================================================================
    if (want('end')) {
      console.log("--- 'Your first descent' on run 1, not on run 2");
      const b = await E.bootMine(4242, 390, 844);
      await quiet(b.page);
      const endText = async () => {
        await b.page.evaluate(async () => { const g = window.__game, s = g.state, r = s.active.nodes[0];
          g.mine.growFrom(r.x, r.y, r.x, r.y + 200); await new Promise((q) => setTimeout(q, 700)); g.mine.end(); });
        await b.page.waitForSelector('#ssMineEnd', { timeout: 15000 }).catch(() => {});
        await sleep(600);
        return b.page.evaluate(() => (document.getElementById('ssMineEnd') || {}).innerText || '');
      };
      const t1 = await endText();
      await b.page.screenshot({ path: path.join(ART, 'm4-end-first-390.png') });
      ok("run 1's end screen says 'Your first descent'", /your first descent/i.test(t1), t1.replace(/\s+/g, ' ').slice(0, 140));
      await b.page.evaluate(() => document.getElementById('ssMineDone').click());
      await b.page.waitForSelector('#ssDescend', { timeout: 15000 }).catch(() => {});
      await b.page.evaluate(() => document.getElementById('ssDescend').click());
      await b.page.waitForFunction(() => { const s = window.__game && window.__game.state;
        return !!(s && s.substrate && s.substrate.mine && !s.runOver && s.substrate._rockSolidified && !document.getElementById('speciesSelect')); }, null, { timeout: 30000 });
      await sleep(1200); await quiet(b.page);
      const t2 = await endText();
      ok("...and run 2's does not", t2.length > 0 && !/your first descent/i.test(t2), t2.replace(/\s+/g, ' ').slice(0, 140));
      await b.ctx.close();
    }
  } catch (e) {
    fail++; console.log('  HARNESS ERROR — ' + (e && e.stack || e));
  }
  console.log(`\n==== ${pass} passed, ${fail} failed ====`);
  await E.close();
  process.exit(fail ? 1 : 0);
})();
