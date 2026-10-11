/* RELEASE CHECK (finishing plan M15) — the release-hygiene gates, in --mine as `release`.
 *
 *   boot     THE BOOT DIET. A returning boot (title) makes <= 60 requests before `#loadscreen.ld-ready` and
 *            reaches it in <= 1.0 s (median of 3, local server). A first visit fetches no card face, species
 *            portrait, threat portrait, spore icon or procedural/card-game sprite before the gate; its band
 *            bill (126 sprites + their masks, behind the gate on purpose — M4's tap->map curtain) is printed
 *            and bounded as a regression (<= 160 requests, <= 12 MB). Control: `MYCELIUM_FULL_BOOT` (what a
 *            re-offered campaign or a '#dev' sandbox gets) fetches the card faces again.
 *   gutters  THE DESKTOP GUTTERS. At 1280x720, 1366x768 and 1920x1080 both panels are shown, their rects do
 *            not intersect `playSurfaceRect`, they take no pointer events, and the canvas still answers at the
 *            surface's centre and the HUD at its own. None at 390x844 (portrait) or 844x390 (a landscape
 *            phone), and none once the run is over. Screens tests/.artifacts/m15-gutters-<W>x<H>.png.
 *   perf     THE PERF GATE. renderFrame p95 <= 25 ms at 3,000 strands with 16 worms on screen at 390x844, the
 *            raster forced per frame (a 1 px readback: a synchronous renderFrame only records), dsf 2 (a
 *            phone's capped backing store) and dsf 1.
 *
 * `RELEASE_ONLY=boot,gutters,perf` runs a subset.
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
      const bootOnce = async (save, extra) => {
        const ctx = await E.browser.newContext({ viewport: { width: 390, height: 844 } });
        const page = await ctx.newPage();
        const reqs = []; let readyAt = null;
        page.on('requestfinished', (rq) => {
          const p = decodeURIComponent(new URL(rq.url()).pathname);
          let sz = 0; try { sz = fs.statSync(path.join(ROOT, p === '/' ? 'index.html' : p)).size; } catch (_) {}
          reqs.push({ p, sz, t: Date.now() });
        });
        await seedSave(save)(page);
        await page.addInitScript((x) => { window.MYCELIUM_SUPABASE = { url: '', anonKey: '' }; if (x) Object.assign(window, x); }, extra || null);
        const t0 = Date.now();
        await page.goto(E.base + '/index.html', { waitUntil: 'domcontentloaded' });
        await page.waitForSelector('#loadscreen.ld-ready', { timeout: 40000 });
        readyAt = Date.now();
        const diet = await page.evaluate(() => window.__bootDiet && window.__bootDiet());
        const before = reqs.filter((x) => x.t <= readyAt);
        await ctx.close();
        return { ms: readyAt - t0, n: before.length, mb: before.reduce((a, x) => a + x.sz, 0) / 1048576, before, diet };
      };
      const NON_MINE = /^\/assets\/(cards|species|tutorial|spores)\/|^\/assets\/(rockform\d+|rock(Basalt|Mossy|River|Slate|Veined)|skyline\d+|house|antColony[AB]|acorn|chestnut|pinecone|leafYellow\w+|lake\d)\.png|^\/assets\/rockface\//;
      const ret = [];
      for (let i = 0; i < 3; i++) ret.push(await bootOnce(RETURNING));
      const rn = ret.map((r) => r.n), rms = ret.map((r) => r.ms);
      ok('a returning boot makes <= 60 requests before the gate is ready (each of 3 boots)', Math.max(...rn) <= 60 && ret.every((r) => r.diet),
         `requests ${rn.join(' / ')}, ${ret.map((r) => r.mb.toFixed(2)).join(' / ')} MB, diet ${ret.map((r) => r.diet).join('/')}`);
      ok('...and reaches the gate in <= 1.0 s (median of 3, local server)', med(rms) <= 1000, `goto -> ready ${rms.join(' / ')} ms`);
      ok('...fetching nothing the mine never draws', ret.every((r) => !r.before.some((x) => NON_MINE.test(x.p))),
         ret.map((r) => r.before.filter((x) => NON_MINE.test(x.p)).map((x) => x.p).join(',') || 0).join(' / ') + ' non-mine files');
      const fv = await bootOnce(null);
      const band = fv.before.filter((x) => /-c24\//.test(x.p));
      ok('a first visit fetches no card / species / procedural art before the gate (band bill printed: behind the gate by design, M4)',
         !fv.before.some((x) => NON_MINE.test(x.p)) && fv.diet && fv.n <= 160 && fv.mb <= 12,
         `${fv.before.filter((x) => NON_MINE.test(x.p)).map((x) => x.p).join(',')} ${fv.n} requests, ${fv.mb.toFixed(2)} MB, ${fv.ms} ms; band files ${band.length} (${(band.reduce((a, x) => a + x.sz, 0) / 1048576).toFixed(2)} MB)`);
      const full = await bootOnce(RETURNING, { MYCELIUM_FULL_BOOT: true });
      const cards = full.before.filter((x) => /^\/assets\/cards\//.test(x.p)).length;
      ok('CONTROL: the full boot (a re-offered campaign, a #dev sandbox) still fetches the card faces and the rest',
         !full.diet && cards >= 60 && full.n > 150, `${full.n} requests, ${full.mb.toFixed(2)} MB, ${cards} card faces, ${full.ms} ms`);
      // A '#dev' sandbox boot takes the full boot too (the engine checks boot it and draw procedural rock).
      const dv = await (async () => { const b = await E.boot('#dev', 390, 844); const d = await b.page.evaluate(() => window.__bootDiet && window.__bootDiet()); await b.ctx.close(); return d; })();
      ok("...and so does a '#dev' boot", dv === false, String(dv));
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
        ok(`${w}x${h}: both gutter panels are shown, with the journey on the left and the next goal on the right`,
           !!(G.L && G.R && G.L.w > 150 && G.R.w > 150 && /Leg \d of 8/.test(G.L.text) && /Next goal/i.test(G.R.text) && /Daily dig/i.test(G.R.text)),
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
          return { ok: true, inView: inView.length, worms: s.nematodes.length, nodes: net.nodes.length };
        });
        await sleep(1500);
        const r = await b.page.evaluate(() => {
          const g = window.__game, c = document.getElementById('game').getContext('2d'), out = [];
          let t = performance.now();
          for (let i = 0; i < 64; i++) { t += 16.7; const a = performance.now(); g.renderFrame(t, 1); c.getImageData(0, 0, 1, 1); out.push(performance.now() - a); }
          const s = g.state, cam = g.camera, halfW = cam.viewW / (2 * cam.zoom), halfH = cam.viewH / (2 * cam.zoom);
          return { ms: out.slice(4), nodes: s.active.nodes.length, worms: s.nematodes.length,
                   wormsOnScreen: s.nematodes.filter((w) => Math.abs(w.x - cam.x) < halfW && Math.abs(w.y - cam.y) < halfH).length };
        });
        await b.page.screenshot({ path: path.join(ART, `m15-perf-3000-dsf${dsf}-390.png`), timeout: 8000, animations: 'disabled' }).catch(() => {});
        ok(`renderFrame p95 <= 25 ms at 3,000 strands and 16 worms, 390x844 dsf ${dsf}, raster forced per frame`,
           W.ok && r.nodes >= 3000 && r.worms === 16 && r.wormsOnScreen >= 12 && pct(r.ms, 0.95) <= 25,
           `median ${med(r.ms).toFixed(2)} ms, p95 ${pct(r.ms, 0.95).toFixed(2)}, max ${Math.max(...r.ms).toFixed(2)} over ${r.ms.length} frames; ${r.nodes} strands, ${r.worms} worms (${r.wormsOnScreen} on screen); fill ${JSON.stringify(st.fill)}`);
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
