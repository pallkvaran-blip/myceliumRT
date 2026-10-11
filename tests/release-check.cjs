/* RELEASE CHECK (finishing plan M15) — the release-hygiene gates, in --mine as `release`.
 *
 *   boot     THE BOOT DIET. A returning boot (title) AND a first visit (a descent) each make <= 60 requests
 *            before `#loadscreen.ld-ready` and reach it in <= 1.0 s (median of 3, local server). COUNTED AS
 *            REQUESTS STARTED before the gate turned ready (every `request` event, failed ones included, up to
 *            the moment a MutationObserver reports the class) — counting only those FINISHED by then read
 *            29-40 where 44-68 had started (M15 verify). The first visit's gate waits for band 0's art and the
 *            mask table only (assets/mine-masks.json); bands 1-3 start after it. Nothing the mine never draws
 *            is fetched. Control: `MYCELIUM_FULL_BOOT` (a re-offered campaign, a '#dev' sandbox) fetches the
 *            card faces again.
 *   masks    THE MASK TABLE IS EXACT: `gen-mine-masks.cjs --check` recomputes every band sprite's mask live
 *            (table off) and compares bit for bit, and against each file's sha1 and `__ASSET_VER`.
 *   diet     THE DIET REMOVES NO ART THE MINE DRAWS: five mine views rendered at a fixed clock with the diet
 *            and with the full boot differ by no more than two full boots differ from each other (the noise
 *            floor), and a positive control (the diet plus the hill/mountain/tree art) differs by far more.
 *   gutters  THE DESKTOP GUTTERS. At 1280x720, 1366x768 and 1920x1080 both panels are shown, their rects do
 *            not intersect `playSurfaceRect`, they take no pointer events, and the canvas still answers at the
 *            surface's centre and the HUD at its own. None at 390x844 (portrait) or 844x390 (a landscape
 *            phone), and none once the run is over. Screens tests/.artifacts/m15-gutters-<W>x<H>.png.
 *   perf     THE PERF GATE. renderFrame p95 <= 25 ms at 3,000 strands with 16 worms on screen at 390x844, the
 *            raster forced per frame (a 1 px readback: a synchronous renderFrame only records), dsf 2 (a
 *            phone's capped backing store) and dsf 1.
 *
 *            Three blocks of 100 frames, gated on the median block's p95 (one 60-frame block was host noise);
 *            a panning camera and human-paced digging are PRINTED alongside. Needs an idle host.
 *
 * `RELEASE_ONLY=boot,masks,diet,gutters,perf` runs a subset.
 */
const path = require('path'), fs = require('fs');
const H = require('./mine-harness.cjs');
const LP = require('./bots/legprobe.cjs');
const ROOT = path.resolve(__dirname, '..');
const ART = path.join(ROOT, 'tests', '.artifacts');
try { fs.mkdirSync(ART, { recursive: true }); } catch (_) {}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ONLY = (process.env.RELEASE_ONLY || '').split(',').filter(Boolean);
const want = (k) => !ONLY.length || ONLY.includes(k);
let pass = 0, fail = 0;
const ok = (name, cond, detail) => { if (cond) pass++; else fail++; console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`); };
const med = (a) => { const s = a.slice().sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)] : NaN; };
const pct = (a, p) => { const s = a.slice().sort((x, y) => x - y); return s.length ? s[Math.min(s.length - 1, Math.floor(s.length * p))] : NaN; };
const RETURNING = { runsDone: 4, mineRuns: 4, mineBest: 40, migratedMineShelfV2: true, mineStoreVisits: 3, minerals: 30,
  mineJourney: { journey: 1, leg: 2, legs: { 1: { runs: 2, bestDepth: 30, bestEast: 96, landed: true }, 2: { runs: 3, bestDepth: 61, bestEast: 80 } } },
  mineSeen: { leg: 2, line42: true } };
const seedSave = (sv) => (p) => p.addInitScript((sv) => { try { if (sv) localStorage.setItem('mycelium.progress.v2', JSON.stringify(sv)); } catch (_) {} }, sv);

(async () => {
  const E = await H.start();
  try {
    // ------------------------------------------------------------------ boot
    if (want('boot')) {
      console.log('--- the boot diet');
      // One boot, every request recorded against the moment the gate turned ready (file sizes off disk).
      // EVERY REQUEST STARTED BEFORE THE GATE (M15 verify): `request` events (failed ones included — they
      // are requests too) stamped in Node, against the moment the page's own MutationObserver reports
      // `ld-ready` through an exposed binding, so the cut is not a waitForSelector poll later. Boot-to-ready is
      // the page clock's (navigation start -> the class).
      const bootOnce = async (save, extra) => {
        const ctx = await E.browser.newContext({ viewport: { width: 390, height: 844 } });
        const page = await ctx.newPage();
        const reqs = []; let readyAt = null, readyPage = null;
        await page.exposeFunction('__relReady', (t) => { if (readyAt == null) { readyAt = Date.now(); readyPage = t; } });
        page.on('request', (rq) => {
          const p = decodeURIComponent(new URL(rq.url()).pathname);
          let sz = 0; try { sz = fs.statSync(path.join(ROOT, p === '/' ? 'index.html' : p)).size; } catch (_) {}
          reqs.push({ p, sz, t: Date.now() });
        });
        let failed = 0; page.on('requestfailed', () => { failed++; });
        await seedSave(save)(page);
        await page.addInitScript((x) => { window.MYCELIUM_SUPABASE = { url: '', anonKey: '' }; if (x) Object.assign(window, x);
          new MutationObserver(() => { const l = document.getElementById('loadscreen'); if (l && l.classList.contains('ld-ready') && !window.__relSent) { window.__relSent = 1; window.__relReady(performance.now()); } })
            .observe(document, { subtree: true, attributes: true, attributeFilter: ['class'] }); }, extra || null);
        await page.goto(E.base + '/index.html', { waitUntil: 'domcontentloaded' });
        await page.waitForSelector('#loadscreen.ld-ready', { timeout: 40000 });
        for (let i = 0; i < 50 && readyAt == null; i++) await sleep(20);
        const diet = await page.evaluate(() => window.__bootDiet && window.__bootDiet());
        const before = reqs.filter((x) => x.t <= readyAt);
        await ctx.close();
        return { ms: Math.round(readyPage), n: before.length, mb: before.reduce((a, x) => a + x.sz, 0) / 1048576, before, diet, failed };
      };
      const NON_MINE = /^\/assets\/(cards|species|tutorial|spores)\/|^\/assets\/(rockform\d+|rock(Basalt|Mossy|River|Slate|Veined)|skyline\d+|house|antColony[AB]|acorn|chestnut|pinecone|leafYellow\w+|lake\d)\.png|^\/assets\/rockface\//;
      const ret = [];
      for (let i = 0; i < 3; i++) ret.push(await bootOnce(RETURNING));
      const rn = ret.map((r) => r.n), rms = ret.map((r) => r.ms);
      ok('a returning boot makes <= 60 requests before the gate is ready (each of 3 boots)', Math.max(...rn) <= 60 && ret.every((r) => r.diet),
         `requests ${rn.join(' / ')}, ${ret.map((r) => r.mb.toFixed(2)).join(' / ')} MB, diet ${ret.map((r) => r.diet).join('/')}`);
      ok('...and reaches the gate in <= 1.0 s (median of 3, local server)', med(rms) <= 1000, `navigation -> ready ${rms.join(' / ')} ms`);
      ok('...fetching nothing the mine never draws', ret.every((r) => !r.before.some((x) => NON_MINE.test(x.p))),
         ret.map((r) => r.before.filter((x) => NON_MINE.test(x.p)).map((x) => x.p).join(',') || 0).join(' / ') + ' non-mine files');
      const fvs = [];
      for (let i = 0; i < 3; i++) fvs.push(await bootOnce(null));
      const fn = fvs.map((r) => r.n), fms = fvs.map((r) => r.ms);
      const band = (r) => r.before.filter((x) => /-c24\//.test(x.p));
      ok('a first visit (a descent) makes <= 60 requests before the gate is ready (each of 3 boots)',
         Math.max(...fn) <= 60 && fvs.every((r) => r.diet && r.before.some((x) => /mine-masks\.json$/.test(x.p))),
         `requests ${fn.join(' / ')}, ${fvs.map((r) => r.mb.toFixed(2)).join(' / ')} MB; band files before the gate ${fvs.map((r) => band(r).length).join(' / ')} (band 0 only); mask table ${fvs.every((r) => r.before.some((x) => /mine-masks/.test(x.p))) ? 'fetched' : 'MISSING'}`);
      ok('...and reaches the gate in <= 1.0 s (median of 3, local server)', med(fms) <= 1000, `navigation -> ready ${fms.join(' / ')} ms`);
      ok('...fetching nothing the mine never draws', fvs.every((r) => !r.before.some((x) => NON_MINE.test(x.p))),
         fvs.map((r) => r.before.filter((x) => NON_MINE.test(x.p)).map((x) => x.p).join(',') || 0).join(' / ') + ' non-mine files');
      const full = await bootOnce(RETURNING, { MYCELIUM_FULL_BOOT: true });
      const cards = full.before.filter((x) => /^\/assets\/cards\//.test(x.p)).length;
      ok('CONTROL: the full boot (a re-offered campaign, a #dev sandbox) still fetches the card faces and the rest',
         !full.diet && cards >= 60 && full.n > 150, `${full.n} requests, ${full.mb.toFixed(2)} MB, ${cards} card faces, ${full.ms} ms`);
      // A '#dev' sandbox boot takes the full boot too (the engine checks boot it and draw procedural rock).
      const dv = await (async () => { const b = await E.boot('#dev', 390, 844); const d = await b.page.evaluate(() => window.__bootDiet && window.__bootDiet()); await b.ctx.close(); return d; })();
      ok("...and so does a '#dev' boot", dv === false, String(dv));
    }

    // ------------------------------------------------------------------ masks
    if (want('masks')) {
      console.log('--- the mine mask table is exact');
      const { spawnSync } = require('child_process');
      const r = spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'gen-mine-masks.cjs'), '--check'], { encoding: 'utf8', env: Object.assign({}, process.env), timeout: 180000 });
      const out = ((r.stdout || '') + (r.stderr || '')).trim().split('\n').pop();
      ok('assets/mine-masks.json matches every band sprite bit for bit (live, table off), its file sha1s and __ASSET_VER', r.status === 0, out);
    }

    // ------------------------------------------------------------------ diet
    if (want('diet')) {
      console.log('--- the diet removes no art the mine draws');
      // Five views a player looks at (the hill and sky, the island, a seam, a pocket, deep rock), each drawn at
      // a FIXED clock after the world settles. `skip` widens the diet for the positive control.
      const frames = async (full, skip) => {
        // A save past its second descent: the ghost finger (runs 1-2) animates on the wall clock and read as
        // ~2,800 differing channels between two IDENTICAL full boots in the hill view, burying anything there.
        const b = await E.boot('#leg,1,1', 390, 844, { before: async (p) => { await seedSave({ runsDone: 4, mineRuns: 4, mineBest: 40, migratedMineShelfV2: true, mineTips: { dig: 1, first_ore: 1, first_pocket: 1, first_line: 1 } })(p);
          await p.addInitScript(([f, sk]) => { if (f) window.MYCELIUM_FULL_BOOT = true; if (sk) window.MYCELIUM_DIET_SKIP = sk; }, [full, skip || null]); } });
        await b.page.waitForFunction(() => window.__game && window.__game.state && window.__game.state.substrate._rockSolidified, { timeout: 40000 });
        await b.page.waitForFunction(() => window.__mineMasks && window.__mineMasks.keys().every((k) => window.__mineMasks.hasArt(k)), { timeout: 40000 }).catch(() => {});
        await sleep(5000);
        const out = await b.page.evaluate(async () => {
          const g = window.__game, s = g.state, sub = s.substrate, cam = g.camera;
          const J = sub.mineJourney, cs = sub.cellSize;
          const seam = sub.foodPiles.find((p) => p.cells && p.cells.length) || null;
          const seamXY = seam ? { x: (seam.cells[0] % sub.cols + 0.5) * cs, y: sub.surfaceY + (Math.floor(seam.cells[0] / sub.cols) + 0.5) * cs } : null;
          const res = (sub.reservoirs || [])[0];
          const spots = [['hill', (sub.mineHomeCol + 0.5) * cs, sub.surfaceY - 100, 0.6], ['island', J ? (J.taproot.col + 0.5) * cs : 2000, sub.surfaceY - 80, 0.6],
            ['seam', seamXY ? seamXY.x : 1500, seamXY ? seamXY.y : 800, 0.9], ['pocket', res ? (res.cx + 0.5) * cs : 1300, res ? sub.surfaceY + (res.cy + 0.5) * cs : 1300, 0.9],
            ['deep', (sub.mineHomeCol + 0.5) * cs, sub.surfaceY + 4000, 0.6]];
          const cv = document.getElementById('game'), r = {};
          for (const [n, x, y, z] of spots) {
            cam.zoom = z; g.mine.lookAt(x, y);
            for (let i = 0; i < 4; i++) g.renderFrame(123456, 0);
            const d = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height).data;
            const a = []; for (let i = 0; i < d.length; i += 16) a.push(d[i], d[i + 1], d[i + 2]);
            r[n] = a;
          }
          return r;
        });
        await b.ctx.close();
        return out;
      };
      const big = (A, B) => { const o = {}; for (const k of Object.keys(A)) { let n = 0; for (let i = 0; i < Math.min(A[k].length, B[k].length); i++) if (Math.abs(A[k][i] - B[k][i]) > 24) n++; o[k] = n; } return o; };
      const F1 = await frames(true), F2 = await frames(true), D = await frames(false);
      const P = await frames(false, '^(rockform\\d+|troll|rock(Basalt|Mossy|River|Slate|Veined)|skyline\\d+|house|antColony[AB]|acorn|chestnut|pinecone|leafYellow\\w+|lake\\d|mountain\\d*|moon|tree\\w*|goalhill|goalbush)$');
      const noise = big(F2, F1), diet = big(D, F1), pos = big(P, F1);
      const views = Object.keys(noise);
      const worst = views.map((k) => diet[k] - noise[k]);
      ok('the diet draws the same five mine views as the full boot (no more pixels differ than between two full boots, +5)',
         views.length === 5 && worst.every((d) => d <= 5),
         views.map((k) => `${k} ${diet[k]} vs noise ${noise[k]}`).join('; '));
      ok('...and the comparison can see missing art: the diet plus the hill/meadow/tree art differs far more (control)',
         Math.max(...views.map((k) => pos[k] - noise[k])) > 100, views.map((k) => `${k} ${pos[k]} (noise ${noise[k]})`).join('; '));
    }

    // ------------------------------------------------------------------ gutters
    if (want('gutters')) {
      console.log('--- the desktop gutters');
      const startRun = async (w, h) => {
        const b = await E.boot('', w, h, { before: seedSave(RETURNING) });
        await b.page.waitForSelector('#tsNewMine', { timeout: 20000 }).catch(() => {});
        await sleep(2200);
        await b.page.click('#tsNewMine').catch(() => {});
        await b.page.waitForFunction(() => window.__game && window.__game.state && window.__game.state.substrate
          && window.__game.state.substrate.mine && window.__game.state.substrate._rockSolidified && (window.__game.state._mineFrameN | 0) > 2, { timeout: 30000 }).catch(() => {});
        await sleep(1500);
        return b;
      };
      const inter = (a, s) => a && !(a.x + a.w <= s.x || s.x + s.w <= a.x || a.y + a.h <= s.y || s.y + s.h <= a.y);
      for (const [w, h] of [[1280, 720], [1366, 768], [1920, 1080]]) {
        const b = await startRun(w, h);
        const g = await b.page.evaluate(() => {
          const G = window.__game.mine.gutters(), s = G.surface;
          const at = (x, y) => { let e = document.elementFromPoint(x, y); while (e && !e.id && e.parentElement) e = e.parentElement; return e ? e.id : null; };
          const hud = document.getElementById('gearbtn');   // a real pointer target in the HUD
          const hb = hud ? hud.getBoundingClientRect() : null;
          return { G, centre: at(s.x + s.w / 2, s.y + s.h / 2), gutterHit: G.L ? at(G.L.x + G.L.w / 2, G.L.y + 20) : null,
                   hud: hb ? at(hb.left + Math.min(20, hb.width / 2), hb.top + hb.height / 2) : null };
        });
        await b.page.screenshot({ path: path.join(ART, `m15-gutters-${w}x${h}.png`), timeout: 8000, animations: 'disabled' }).catch(() => {});
        const { G } = g, s = G.surface;
        ok(`${w}x${h}: both gutter panels are shown, with the journey on the left and the next goal on the right (worded for mid-run: no 'ready to buy')`,
           !!(G.L && G.R && G.L.w > 150 && G.R.w > 150 && /Leg \d of 8/.test(G.L.text) && /Next goal/i.test(G.R.text) && /Daily dig/i.test(G.R.text)
             && !/ready to buy/i.test(G.R.text)),
           JSON.stringify({ L: G.L && [G.L.x | 0, G.L.y | 0, G.L.w | 0, G.L.h | 0], R: G.R && [G.R.x | 0, G.R.y | 0, G.R.w | 0, G.R.h | 0] }));
        ok(`${w}x${h}: ...their rects do not intersect the play surface, and they take no pointer events`,
           G.L && G.R && !inter(G.L, s) && !inter(G.R, s) && G.L.pe === 'none' && G.R.pe === 'none' && g.gutterHit !== 'mineGutL',
           JSON.stringify({ surface: s, pe: [G.L && G.L.pe, G.R && G.R.pe], hitOnPanel: g.gutterHit }));
        ok(`${w}x${h}: ...and the canvas still answers at the surface's centre, the HUD's gear at its own`, g.centre === 'game' && g.hud === 'gearbtn',
           JSON.stringify({ centre: g.centre, hud: g.hud }));
        if (w === 1280) {
          // ...and they go once the run is over (the end screen fills the window).
          await b.page.evaluate(() => { const s = window.__game.state; s.nematodes.length = 0; window.__game.mine.end(); });
          await b.page.waitForSelector('#ssMineEnd', { timeout: 20000 }).catch(() => {});
          await sleep(500);
          const gEnd = await b.page.evaluate(() => window.__game.mine.gutters());
          ok('1280x720: ...and none once the run is over (the end screen)', !gEnd.L && !gEnd.R, JSON.stringify(gEnd));
        }
        ok(`${w}x${h}: no page errors`, b.errs.length === 0, b.errs.join(' | '));
        await b.ctx.close();
      }
      // THE SAVE'S FIRST DESCENT HAS NO GUTTERS (M15 verify): no store goal for a store never seen, no journey
      // panel over the first minute. A fresh save on the plain URL goes straight into that descent.
      {
        const b = await E.boot('', 1280, 720);
        await b.page.waitForFunction(() => window.__game && window.__game.state && window.__game.state.substrate
          && window.__game.state.substrate.mine && (window.__game.state._mineFrameN | 0) > 2, { timeout: 30000 }).catch(() => {});
        await sleep(1200);
        const G = await b.page.evaluate(() => ({ g: window.__game.mine.gutters(), first: !(JSON.parse(localStorage.getItem('mycelium.progress.v2') || '{}').mineRuns > 0) }));
        await b.page.screenshot({ path: path.join(ART, 'm15-gutters-first-1280x720.png'), timeout: 8000, animations: 'disabled' }).catch(() => {});
        ok('1280x720, a fresh save\u2019s first descent: no gutter panels (no store goal before the store exists)', G.first && !G.g.L && !G.g.R, JSON.stringify(G));
        await b.ctx.close();
      }
      for (const [w, h, label] of [[390, 844, 'portrait phone'], [844, 390, 'landscape phone']]) {
        const b = await startRun(w, h);
        const G = await b.page.evaluate(() => window.__game.mine.gutters());
        await b.page.screenshot({ path: path.join(ART, `m15-gutters-${w}x${h}.png`), timeout: 8000, animations: 'disabled' }).catch(() => {});
        ok(`${w}x${h} (${label}): no gutter panels`, !G.L && !G.R, JSON.stringify(G));
        await b.ctx.close();
      }
    }

    // ------------------------------------------------------------------ perf
    if (want('perf')) {
      for (const dsf of [2, 1]) {
        console.log(`--- the perf gate: 3,000 strands and 16 worms, 390x844 dsf ${dsf}`);
        const b = await LP.openLeg(E, 4, 0, 390, 844, undefined, { dsf });
        await LP.measure(b.page);
        const st = await LP.perfState(b.page, { want: 3000, threats: true });
        await b.page.evaluate(() => { window.__game.state.active.water = 9999; });
        await sleep(3000);   // the fill's reveal lands, the camera settles on the colony
        // EXACTLY 16 WORMS, ON SCREEN: kept worms (or clones of one) moved onto clean strands in the view.
        const W = await b.page.evaluate(() => {
          const g = window.__game, s = g.state, cam = g.camera, net = s.active;
          const halfW = cam.viewW / (2 * cam.zoom), halfH = cam.viewH / (2 * cam.zoom);
          const inView = net.nodes.filter((n) => !n.infected && Math.abs(n.x - cam.x) < halfW * 0.9 && Math.abs(n.y - cam.y) < halfH * 0.9);
          const proto = s.nematodes[0] || (window.__perfKeep && window.__perfKeep.worms[0]);
          if (!proto || !inView.length) return { ok: false, inView: inView.length, worms: s.nematodes.length };
          const worms = s.nematodes.slice(0, 16);
          while (worms.length < 16) worms.push(JSON.parse(JSON.stringify(proto)));
          worms.forEach((w, i) => { const n = inView[Math.floor((i + 0.5) * inView.length / 16)]; w.x = n.x + 6; w.y = n.y + 6; w.tx = n.x; w.ty = n.y; });
          s.nematodes.length = 0; s.nematodes.push(...worms);
          // NO BREEDING while it is measured: the timed blocks are 300 ms apart with the real loop ticking
          // between them, and an attached worm breeds — one block read 20 worms (M15 verify).
          if (s.config.mine && s.config.mine.worms) s.config.mine.worms.breedPerSec = 0;
          if (s.config.nematodes) { s.config.nematodes.respawnChance = 0; }
          return { ok: true, inView: inView.length, worms: s.nematodes.length, nodes: net.nodes.length };
        });
        await sleep(1500);
        // THREE BLOCKS OF 100 FRAMES, GATED ON THE MEDIAN BLOCK'S p95 (M15 verify): one 60-frame window read
        // 14.4 ms on an idle host and 25-73 ms with another test job on the CPUs — every pass slowed by the same
        // factor, i.e. contention, not the game. The bound is unchanged; the sample is bigger and one stalled
        // block no longer decides it. THE GATE STILL WANTS AN IDLE HOST: run it alone, or in the --mine sweep
        // (which runs one check at a time).
        const block = () => b.page.evaluate(() => {
          const g = window.__game, c = document.getElementById('game').getContext('2d'), out = [];
          if (g.state.nematodes.length > 16) g.state.nematodes.length = 16;   // the placed 16 are first
          let t = performance.now();
          for (let i = 0; i < 104; i++) { t += 16.7; const a = performance.now(); g.renderFrame(t, 1); c.getImageData(0, 0, 1, 1); out.push(performance.now() - a); }
          const s = g.state, cam = g.camera, halfW = cam.viewW / (2 * cam.zoom), halfH = cam.viewH / (2 * cam.zoom);
          return { ms: out.slice(4), nodes: s.active.nodes.length, worms: s.nematodes.length,
                   wormsOnScreen: s.nematodes.filter((w) => Math.abs(w.x - cam.x) < halfW && Math.abs(w.y - cam.y) < halfH).length };
        });
        const blocks = [];
        for (let k = 0; k < 3; k++) { blocks.push(await block()); await sleep(300); }
        const p95s = blocks.map((x) => pct(x.ms, 0.95));
        const r = blocks.slice().sort((x, y) => pct(x.ms, 0.95) - pct(y.ms, 0.95))[1];
        // PRINTED, NOT GATED: the camera MOVING (a still camera is the case every memo hits) — 2 px a frame for
        // 100 frames — and human-paced play (a dig every 90 frames, i.e. ~1.5 s, with the camera following).
        const moving = await b.page.evaluate(() => {
          const g = window.__game, s = g.state, cam = g.camera, c = document.getElementById('game').getContext('2d');
          const run = (fn) => { const out = []; let t = performance.now(); for (let i = 0; i < 104; i++) { t += 16.7; fn(i); const a = performance.now(); g.renderFrame(t, 1); c.getImageData(0, 0, 1, 1); out.push(performance.now() - a); } return out.slice(4); };
          const x0 = cam.x, y0 = cam.y;
          const pan = run((i) => { cam.x = x0 + (i % 50 < 25 ? i % 25 : 25 - (i % 25)) * 2 / cam.zoom; });
          cam.x = x0; cam.y = y0;
          const tips = s.active.nodes.filter((n) => !n.infected).slice(-40);
          const dig = run((i) => { if (i % 90 === 10 && tips.length) { const n = tips[(i / 90 | 0) % tips.length]; s.active.water = 9999; g.mine.growFrom(n.x, n.y, n.x + 40, n.y + 160); } });
          return { pan, dig };
        });
        const pr = (a) => `median ${med(a).toFixed(1)} / p95 ${pct(a, 0.95).toFixed(1)} ms`;
        console.log(`  (printed, not gated) dsf ${dsf} camera panning 2 px a frame: ${pr(moving.pan)}; a dig every ~1.5 s: ${pr(moving.dig)}`);
        await b.page.screenshot({ path: path.join(ART, `m15-perf-3000-dsf${dsf}-390.png`), timeout: 8000, animations: 'disabled' }).catch(() => {});
        ok(`renderFrame p95 <= 25 ms at 3,000 strands and 16 worms, 390x844 dsf ${dsf}, raster forced per frame`,
           W.ok && r.nodes >= 3000 && r.worms === 16 && r.wormsOnScreen >= 12 && pct(r.ms, 0.95) <= 25,
           `median block: median ${med(r.ms).toFixed(2)} ms, p95 ${pct(r.ms, 0.95).toFixed(2)}, max ${Math.max(...r.ms).toFixed(2)} over ${r.ms.length} frames (block p95s ${p95s.map((x) => x.toFixed(1)).join(' / ')}); ${r.nodes} strands, ${r.worms} worms (${r.wormsOnScreen} on screen); fill ${JSON.stringify(st.fill)}`);
        ok(`...no page errors (dsf ${dsf})`, b.errs.length === 0, b.errs.join(' | '));
        await b.ctx.close();
      }
    }
  } catch (e) {
    fail++; console.log('FAIL  harness threw — ' + (e && e.stack || e));
  } finally {
    await E.close();
  }
  console.log(`\n==== ${pass} passed, ${fail} failed ====`);
  process.exit(fail ? 1 : 0);
})();
