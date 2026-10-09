/* JUICE — the finishing plan's M12, as assertions.
 *
 *     node tests/juice-check.cjs      (JUICE_ONLY=sfx,mute,vib,motion,hud,perf runs blocks)
 *
 *   sfx     acceptance 1: one scripted descent on '#mine,4242' (a save whose best is 3 m) — a seam and a
 *           pocket stamped AT the colony and claimed, a dig past the 42 m price line (the band beat
 *           fires there too), a worm spawned onto the colony, a flask from the kit, a cloud parked on a
 *           strand, a dose cut, a refused dig, the clock pushed into its last ten seconds, then FRUIT NOW
 *           (the record beaten and the end chord) and a Buy on the end screen. Every one of __sfx.counts
 *           ore, pocket, line, beat, worm, rot, flask, enzyme, runEnd and buy is >= 1, and oscillators
 *           were really created (the control for the muted block).
 *   mute    ...with Sound effects off the same events create NO oscillator and move no count.
 *   vib     acceptance 2: navigator.vibrate stubbed. Vibration ON: a seam vibrates 12 ms and a pocket
 *           20 ms; OFF: the next seam and pocket never call it (and still pay — the control).
 *   motion  acceptance 3: Reduced motion ON, a dig across the 42 m line leaves the shake offset 0 on
 *           every drawn frame (the shake was asked for and refused); OFF, the same crossing shakes,
 *           by at most 3 px. Under Reduced motion the end screen's figures are final at once.
 *   hud     acceptance 4: the water chip has .low and 'N left' exactly when water < 4 x costHere, over
 *           ten tank levels around the boundary; the price chip pulses when the price changes (the
 *           42 m line); the flask button breathes while a worm is attached and the enzyme while rot is
 *           on the colony, and neither does without its threat. A 390x844 frame of the low chip.
 *   loud    the plan's "at most 6 voices, peaking at -12 dBFS" (M12 verify): with tests/sfx-meter.cjs (an
 *           AudioWorklet peak meter, and every source's [start, stop) on the audio clock) the worst stacks —
 *           ten band gongs at once, six different cues at once, two wide digs plus six cues — peak at or under
 *           -12 dBFS with at most 6 SOURCES sounding (a gong is two, the first build counted it as one);
 *           a seam ping during a six-layer dig is ADMITTED by stealing grow layers; the ending (record then
 *           landfall chord) and the Promised Land's eight notes drop nothing. Negative controls: with the
 *           limiter off (MYCELIUM_NO_SFX_CEILING) ten gongs peak above -12; with the cap lifted
 *           (MYCELIUM_SFX_VOICES 99) the meter sees more than 6 sources.
 *   verify  the M12 verify round's fixes: 'N left' in row 2 and nothing off a 360 / 320 px HUD with the
 *           chip low; Reduced motion seeded from the OS setting (and a stored choice winning); no
 *           Vibration item without navigator.vibrate; a new run's first frame carries no price pulse; the
 *           beat hidden under the open settings menu; the landfall's chord and vibration on the frame the
 *           run ends, seconds before the end screen.
 *   perf    acceptance 5: 16 worms on the colony, frames timed with juice on and off INTERLEAVED frame
 *           by frame (mineFrame + renderFrame + a 1 px readback to force the raster; a shake asked
 *           every 8th frame on the 'on' side): p95(on) - p95(off) <= 1.0 ms.
 */
const path = require('path');
const H = require('./mine-harness.cjs');
const METER = require('./sfx-meter.cjs');
const { sleep } = H;
let pass = 0, fail = 0;
const ok = (n, c, x) => { c ? (pass++, console.log('  PASS  ' + n + (x ? '  — ' + x : ''))) : (fail++, console.log('  FAIL  ' + n + (x ? '  — ' + x : ''))); };
const ART = path.join(H.ROOT, 'tests', '.artifacts');
require('fs').mkdirSync(ART, { recursive: true });
const ONLY = (process.env.JUICE_ONLY || '').split(',').filter(Boolean);
const want = (k) => !ONLY.length || ONLY.includes(k);

// A save that has dug before (best 3 m — so a descent past it is a record, and it is not a first visit)
// and has the onboarding tips seen (their rings and lines would sit over the frames).
const SAVE = (page) => page.addInitScript(() => {
  try {
    if (!localStorage.getItem('mycelium.progress.v2')) localStorage.setItem('mycelium.progress.v2', JSON.stringify({
      runsDone: 1, mineBest: 3, mineRuns: 2, migratedMineShelfV2: true,
      mineTips: { dig: true, first_ore: true, first_pocket: true, first_line: true, first_worm: true, first_rot: true, first_cloud: true } }));
  } catch (_) {}
});
// Counts every oscillator and buffer source the page creates — the muted block's evidence.
const AUDIO_SPY = (page) => page.addInitScript(() => {
  window.__oscN = 0; window.__srcN = 0;
  const P = (window.BaseAudioContext || window.AudioContext || {}).prototype;
  if (P && P.createOscillator) {
    const o = P.createOscillator, b = P.createBufferSource;
    P.createOscillator = function () { window.__oscN++; return o.apply(this, arguments); };
    P.createBufferSource = function () { window.__srcN++; return b.apply(this, arguments); };
  }
});
const VIB_SPY = (page) => page.addInitScript(() => {
  window.__vibs = [];
  try { Object.defineProperty(Navigator.prototype, 'vibrate', { configurable: true, value: function (p) { window.__vibs.push(p); return true; } }); } catch (_) {}
});
const QUIET = () => {
  const s = window.__game.state;
  s.nematodes.length = 0; s.clouds.length = 0;
  s.config.nematodes.respawnChance = 0; s.config.trichoderma.respawnChance = 0;
  if (s.config.mine.worms) s.config.mine.worms.waterPerSec = 0;
  s.config.mine.threatBands = s.config.mine.threatBands.map(() => ({ worms: 0, clouds: 0 }));
  s.config.mine.stuckFruitMs = 1e9;
  s.active.water = 5000;
};
const quiet = (page) => page.evaluate(({ Q }) => { new Function('return (' + Q + ')')()(); }, { Q: QUIET.toString() });

// In-page helpers, installed once per page.
const HELPERS = () => {
  const g = window.__game;
  const S = () => g.state;
  const wait = async (fn, ms) => { const t0 = performance.now(); while (performance.now() - t0 < ms) { const v = fn(); if (v) return v; await new Promise((r) => setTimeout(r, 40)); } return fn(); };
  // A grown-in clean strand of the colony, the k-th from the root (skipping strands already used).
  window.__used = window.__used || new Set();
  window.__strand = (minDy) => {
    const s = S(), net = s.active, root = net.nodes[0];
    for (const n of net.nodes) {
      if (n.infected || !net.grownIn(n) || window.__used.has(n.id)) continue;
      if (minDy != null && n.y - s.substrate.surfaceY < minDy) continue;
      // far from every strand already used, so two stamps never share a cell
      let near = false;
      for (const id of window.__used) { const m = net.byId.get(id); if (m && Math.hypot(m.x - n.x, m.y - n.y) < 80) { near = true; break; } }
      if (near) continue;
      window.__used.add(n.id); return { id: n.id, x: n.x, y: n.y };
    }
    return null;
  };
  // A SEAM AT THE COLONY, claimed: stamped on a strand's own cell (clean cover reaches it), its nutrient
  // already digested and the cell colonised — `mineOreRewards` pays it on the next frame.
  window.__seam = async () => {
    const s = S(), sub = s.substrate, n = window.__strand(30);
    if (!n) return { ok: false, why: 'no free strand' };
    const pi = g.mine.stampSeam(n.x, n.y, 'phosphorus');
    if (pi < 0) return { ok: false, why: 'stamp refused' };
    const pile = sub.foodPiles[pi];
    for (const idx of pile.cells) { const c = sub.cells[idx]; c.nutrient = 0; c.colonized = 1; }
    const ore0 = s.mineOre | 0;
    const paid = await wait(() => pile.rewarded, 3000);
    return { ok: !!paid, ore: (s.mineOre | 0) - ore0 };
  };
  // A POCKET AT THE COLONY: stamped under a grown-in strand, rescanned, paid on the next frame.
  window.__pocket = async () => {
    const s = S(), n = window.__strand(30), w0 = Math.floor(s.active.water);
    if (!n) return { ok: false, why: 'no free strand' };
    const k0 = (s._tappedWater ? s._tappedWater.size : 0);
    g.mine.stampPocket(n.x, n.y, 30);
    const got = await wait(() => (s._tappedWater ? s._tappedWater.size : 0) > k0, 3000);
    return { ok: !!got, dw: Math.floor(s.active.water) - w0 };
  };
  window.__wait = wait;
};
const helpers = (page) => page.evaluate(({ F }) => { new Function('return (' + F + ')')()(); }, { F: HELPERS.toString() });
const counts = (page) => page.evaluate(() => Object.assign({}, window.__sfx.counts));

(async () => {
  const E = await H.start();
  try {
    // =========================================================================================
    // 1. EVERY CUE FIRES ON A SCRIPTED DESCENT
    // =========================================================================================
    if (want('sfx')) {
      console.log('--- acceptance 1: every cue on one scripted descent (#mine,4242)');
      const b = await E.bootMine(4242, 390, 844, { before: async (page) => { await SAVE(page); await AUDIO_SPY(page); await METER(page); } });
      await quiet(b.page); await helpers(b.page);
      await b.page.evaluate(() => { window.__peakReset(); window.__voiceReset(); });
      const c0 = await counts(b.page);
      const r = await b.page.evaluate(async () => {
        const g = window.__game, s = g.state, out = {};
        if (window.__sfx.muted()) g.sfx().toggleSfx();
        // the 42 m line and the band beat (anthracite at 42 m) — first, so there is colony to stamp on
        s.active.water = 5000;
        out.dive = await window.__navDig({ targetM: 47, maxIters: 160 });
        out.depth = g.mine.depth();
        await window.__wait(() => window.__sfx.counts.line > 0, 2000);
        await window.__wait(() => !g.mine.revealing(), 4000);
        out.seam = await window.__seam();
        out.pocket = await window.__pocket();
        // a worm onto the colony
        let tip = null; for (const n of s.active.nodes) if (!n.infected && (!tip || n.y > tip.y)) tip = n;
        g.mine.spawnWorm(tip.x + 6, tip.y - 6);
        out.attached = !!(await window.__wait(() => g.mine.attached() > 0, 8000));
        // a flask from the kit (the real handler)
        s.mineItems.excrete = 2; s.mineItems.amputate = 2;
        await new Promise((x) => setTimeout(x, 100));
        g.handlers.onMineItem('excrete');
        out.flaskLeft = s.mineItems.excrete;
        await new Promise((x) => setTimeout(x, 200));
        // a refused dig: a tank below the price, restored at once
        s.active.water = 1; out.refuse = g.mine.grow(0, 1); s.active.water = 5000;
        await new Promise((x) => setTimeout(x, 200));
        // rot: a still cloud parked on a strand
        s.config.trichoderma.moveSpeed = 0;
        const n2 = window.__strand(30);
        g.mine.spawnCloud(n2.x, n2.y);
        out.rot = !!(await window.__wait(() => s.mineInfect, 8000));
        // the clock's last ten seconds: the heartbeat
        if (s.mineInfect) s.mineInfect.start -= Math.max(0, s.mineInfect.ms - 8000);
        await window.__wait(() => window.__sfx.counts.heartbeat > 0, 2500);
        // a dose cut on the rot
        const rotten = s.active.nodes.find((n) => n.infected);
        out.cut = rotten ? g.mine.useAmputate(rotten.x, rotten.y) : null;
        await new Promise((x) => setTimeout(x, 300));
        for (let i = 0; i < 3 && s.mineInfect; i++) {
          const rr = s.active.nodes.find((n) => n.infected); if (!rr) break;
          s.mineItems.amputate = (s.mineItems.amputate | 0) + 1; g.mine.useAmputate(rr.x, rr.y);
          await new Promise((x) => setTimeout(x, 300));
        }
        await new Promise((x) => setTimeout(x, 300));
        out.oscBeforeEnd = window.__oscN;
        g.store.credit(400);
        g.handlers.onFruitNow();
        return out;
      });
      await b.page.waitForSelector('#ssMineEnd', { timeout: 15000 }).catch(() => {});
      await sleep(1600);
      const end = await b.page.evaluate(() => ({ goal: (document.querySelector('#ssMineGoal') || {}).dataset ? document.querySelector('#ssMineGoal').dataset.goal : null,
        buy: !!document.getElementById('ssMineBuy'), best: (document.querySelector('.ss-mineend-best') || {}).textContent || '' }));
      if (end.buy) { await b.page.click('#ssMineBuy'); await sleep(300); }
      const c1 = await counts(b.page);
      const osc = await b.page.evaluate(() => window.__oscN);
      const d = (k) => (c1[k] | 0) - (c0[k] | 0);
      console.log('    events: ' + JSON.stringify(r) + ' end ' + JSON.stringify(end));
      console.log('    counts: ' + JSON.stringify(c1) + ' last dropped ' + JSON.stringify(await b.page.evaluate(() => window.__sfx.last.dropped || null)));
      for (const k of ['ore', 'pocket', 'line', 'beat', 'worm', 'rot', 'flask', 'enzyme', 'runEnd', 'buy'])
        ok(`__sfx.counts.${k} >= 1`, d(k) >= 1, `${c0[k] | 0} -> ${c1[k] | 0}`);
      ok('...and the refusal thud, the heartbeat, the relief chime, the record arpeggio and the count-up ticks/ding fired too',
         d('refuse') >= 1 && d('heartbeat') >= 1 && d('relief') >= 1 && d('record') >= 1 && d('tick') >= 1 && d('ding') >= 1,
         `refuse ${d('refuse')}, heartbeat ${d('heartbeat')}, record ${d('record')} (${end.best.trim()}), tick ${d('tick')}, ding ${d('ding')}, relief ${d('relief')}`);
      ok('the seam and the pocket were really claimed (+P, +water)', r.seam.ok && r.seam.ore > 0 && r.pocket.ok && r.pocket.dw > 0,
         `seam ${JSON.stringify(r.seam)}, pocket ${JSON.stringify(r.pocket)}, dive ${r.depth} m`);
      ok('oscillators were created (the control for the muted run)', osc > 0, `${osc} oscillators`);
      const lv = await b.page.evaluate(() => ({ peak: window.__peak, voices: window.__voiceMax(), high: window.__sfx.high(), err: window.__meterError || null }));
      const dbv = (v) => (v > 0 ? 20 * Math.log10(v) : -Infinity);
      ok('over the whole descent, never more than 6 sources sounding at once (measured off the audio clock)', lv.voices >= 1 && lv.voices <= 6 && lv.high <= 6,
         `meter max ${lv.voices}, the game's own high-water ${lv.high}, dropped ${c1.dropped | 0}, stolen ${c1.stolen | 0}`);
      ok('...and the mix never peaked above -12 dBFS', lv.peak > 0 && dbv(lv.peak) <= -12, `peak ${dbv(lv.peak).toFixed(1)} dBFS${lv.err ? ' meter ' + lv.err : ''}`);
      ok('no page errors', b.errs.length === 0, b.errs.slice(0, 2).join(' | ') || 'clean');
      await b.ctx.close();
    }

    // =========================================================================================
    // 1b. MUTED: NO OSCILLATOR, NO COUNT
    // =========================================================================================
    if (want('mute')) {
      console.log('--- acceptance 1: with sound off, nothing is created');
      const b = await E.bootMine(4242, 390, 844, { before: async (page) => { await SAVE(page); await AUDIO_SPY(page);
        await page.addInitScript(() => { try { localStorage.setItem('mycSfxMuted', '1'); } catch (_) {} }); } });
      await quiet(b.page); await helpers(b.page);
      const r = await b.page.evaluate(async () => {
        const g = window.__game, s = g.state;
        const c0 = Object.assign({}, window.__sfx.counts), o0 = window.__oscN, b0 = window.__srcN;
        const out = { muted: window.__sfx.muted() };
        s.active.water = 5000;
        out.dive = await window.__navDig({ targetM: 47, maxIters: 160 });
        out.depth = g.mine.depth();
        await window.__wait(() => !g.mine.revealing(), 4000);
        out.seam = await window.__seam(); out.pocket = await window.__pocket();
        let tip = null; for (const n of s.active.nodes) if (!n.infected && (!tip || n.y > tip.y)) tip = n;
        g.mine.spawnWorm(tip.x + 6, tip.y - 6);
        out.attached = !!(await window.__wait(() => g.mine.attached() > 0, 8000));
        s.mineItems.excrete = 1; g.handlers.onMineItem('excrete');
        s.active.water = 1; g.mine.grow(0, 1); s.active.water = 5000;
        s.config.trichoderma.moveSpeed = 0;
        const n2 = window.__strand(30); g.mine.spawnCloud(n2.x, n2.y);
        out.rot = !!(await window.__wait(() => s.mineInfect, 8000));
        await new Promise((x) => setTimeout(x, 400));
        const c1 = window.__sfx.counts;
        const moved = Object.keys(c1).filter((k) => k !== 'dropped' && (c1[k] | 0) !== (c0[k] | 0));
        return Object.assign(out, { osc: window.__oscN - o0, src: window.__srcN - b0, moved });
      });
      ok('the events happened (seam, pocket, line, worm, rot)', r.seam.ok && r.pocket.ok && r.depth > 42 && r.attached && r.rot,
         `seam ${r.seam.ok}, pocket ${r.pocket.ok}, ${r.depth} m, worm ${r.attached}, rot ${r.rot}`);
      ok('muted: no oscillator and no buffer source created', r.muted && r.osc === 0 && r.src === 0, `muted ${r.muted}, oscillators ${r.osc}, sources ${r.src}`);
      ok('...and no __sfx count moved', r.moved.length === 0, r.moved.join(', ') || 'none');
      await b.ctx.close();
    }


    // =========================================================================================
    // 1c. LOUDNESS AND THE VOICE BUDGET (M12 verify)
    // =========================================================================================
    const STACKS = async (page) => page.evaluate(async () => {
      const S = window.__game.sfx(), sl = (ms) => new Promise((r) => setTimeout(r, ms));
      if (window.__sfx.muted()) S.toggleSfx();
      for (let i = 0; i < 60 && window.__sfx.ctxState() !== 'running'; i++) await sl(50);
      for (let i = 0; i < 80 && !window.__sfx.growReady(); i++) await sl(50);
      const res = { ctx: window.__sfx.ctxState(), grow: window.__sfx.growReady(), meter: window.__meterError || 'worklet' };
      const run = async (name, fn, wait) => {
        await sl(400); window.__peakReset(); window.__voiceReset();
        const c0 = Object.assign({}, window.__sfx.counts);
        fn(); await sl(wait || 2600);
        const c1 = window.__sfx.counts, d = (k) => (c1[k] | 0) - (c0[k] | 0);
        res[name] = { dB: window.__peak > 0 ? +(20 * Math.log10(window.__peak)).toFixed(1) : -999, voices: window.__voiceMax(),
                      dropped: d('dropped'), stolen: d('stolen'), ore: d('ore'), runEnd: d('runEnd'), finale: d('finale') };
      };
      await run('gongs', () => { for (let i = 0; i < 10; i++) S.playBandGong(); });
      await run('six', () => { S.playBandGong(); S.playLineHiss(); S.playRotSting(); S.playRecordArp(); S.playFlaskSplat(); S.playReliefChime(); });
      await run('digs', () => { S.playGrowBurst(60, 600); S.playGrowBurst(60, 600); S.playBandGong(); S.playLineHiss(); S.playRotSting(); S.playRecordArp(); S.playFlaskSplat(); S.playReliefChime(); });
      await run('seamInDig', () => { S.playGrowBurst(60, 300); setTimeout(() => S.playSeamPing('phosphorus', 0), 60); }, 2200);
      await run('ending', () => { S.playRecordArp(); setTimeout(() => S.playEndChord(true), 640); }, 3000);
      await run('finale', () => { for (let i = 0; i < 8; i++) setTimeout(() => S.playFinaleNote(i), i * 300); }, 4200);
      return res;
    });
    if (want('loud')) {
      console.log('--- the voice budget and the -12 dBFS peak (sfx-meter)');
      const b = await E.bootMine(4242, 390, 844, { before: async (page) => { await SAVE(page); await METER(page); } });
      await quiet(b.page);
      await b.page.keyboard.press('Shift');   // a gesture, so the context runs
      const r = await STACKS(b.page);
      console.log('    ' + JSON.stringify(r));
      const fits = (x) => x && x.dB <= -12 && x.voices <= 6;
      ok('ten band gongs at once: peak <= -12 dBFS, <= 6 sources (the rest dropped)', fits(r.gongs) && r.gongs.dropped >= 5, JSON.stringify(r.gongs));
      ok('six different cues at once: peak <= -12 dBFS, <= 6 sources', fits(r.six), JSON.stringify(r.six));
      ok('two wide digs plus six cues: peak <= -12 dBFS, <= 6 sources (the grow sample is in the budget)', r.grow && fits(r.digs) && r.digs.voices >= 4, JSON.stringify(r.digs));
      ok('a seam ping during a six-layer dig is admitted by stealing grow layers, not dropped', fits(r.seamInDig) && r.seamInDig.ore === 1 && r.seamInDig.stolen >= 1 && r.seamInDig.dropped === 0, JSON.stringify(r.seamInDig));
      ok('the ending (record arpeggio, then the landfall chord) and the eight finale notes drop nothing', fits(r.ending) && r.ending.runEnd === 1 && r.ending.dropped === 0 && fits(r.finale) && r.finale.finale === 8 && r.finale.dropped === 0,
         `ending ${JSON.stringify(r.ending)}, finale ${JSON.stringify(r.finale)}`);
      ok('no page errors', b.errs.length === 0, b.errs.slice(0, 2).join(' | ') || 'clean');
      await b.ctx.close();
      // NEGATIVE CONTROLS: the meter sees a violation when the guard is off
      const c = await E.bootMine(4242, 390, 844, { before: async (page) => { await SAVE(page); await METER(page);
        await page.addInitScript(() => { window.MYCELIUM_NO_SFX_CEILING = true; window.MYCELIUM_SFX_VOICES = 99; }); } });
      await quiet(c.page);
      await c.page.keyboard.press('Shift');
      const rc = await STACKS(c.page);
      ok('control: limiter off and cap lifted, ten gongs peak above -12 dBFS with more than 6 sources', rc.gongs.dB > -12 && rc.gongs.voices > 6, JSON.stringify(rc.gongs));
      await c.ctx.close();
    }

    // =========================================================================================
    // V. THE VERIFY ROUND'S FIXES (41a0c97 + this round)
    // =========================================================================================
    if (want('verify')) {
      console.log("--- verify: 'N left' fits, OS reduced motion, no vibration item without the API, no carried pulse, beat under the menu, the ending on its frame");
      // (a) the low chip at 360 and 320 px, a 2-digit price (heat lines every 10 m, so 47 m costs 16)
      for (const [vw, vh] of [[360, 640], [320, 568]]) {
        const b = await E.bootMine(4242, vw, vh, { before: SAVE });
        await quiet(b.page); await helpers(b.page);
        const m = await b.page.evaluate(async () => {
          const g = window.__game, s = g.state;
          s.active.water = 5000;
          await window.__navDig({ targetM: 47, maxIters: 160 });
          s.config.mine.heat.safeDepth = 1; s.config.mine.heat.lineEvery = 10;
          await new Promise((x) => setTimeout(x, 300));
          const c = g.mine.costHere();
          s.active.water = 4 * c - 1;
          await new Promise((x) => setTimeout(x, 900));
          await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
          const vis = (e) => { for (let n = e; n && n !== document.body; n = n.parentElement) { const cs = getComputedStyle(n); if (cs.display === 'none' || cs.visibility === 'hidden') return false; } return true; };
          const hud = document.querySelector('#ui > .hud'), out = [];
          for (const e of [hud, ...hud.querySelectorAll('*')]) {
            if (!vis(e)) continue; const q = e.getBoundingClientRect(); if (q.width <= 0 || q.height <= 0) continue;
            if (q.left < -0.5 || q.top < -0.5 || q.right > innerWidth + 0.5 || q.bottom > innerHeight + 0.5) out.push(`${e.id || e.className} ${Math.round(q.left)}..${Math.round(q.right)}`);
          }
          const R = (e) => { if (!e || !vis(e)) return null; const q = e.getBoundingClientRect(); return { x0: q.left, x1: q.right, y0: q.top, y1: q.bottom }; };
          const over = (a, c) => !!(a && c) && Math.min(a.x1, c.x1) > Math.max(a.x0, c.x0) && Math.min(a.y1, c.y1) > Math.max(a.y0, c.y0);
          const row1e = document.querySelector('.hud .hudtop .resrow'), wl = document.getElementById('hud-waterleft');
          const gear = R(document.getElementById('gearbtn'));
          const hit = gear ? document.elementFromPoint((gear.x0 + gear.x1) / 2, (gear.y0 + gear.y1) / 2) : null;
          const kids = [...row1e.children].filter(vis).map(R).filter(Boolean);
          return { cost: c, water: Math.floor(s.active.water), two: hud.classList.contains('two'),
                   low: document.getElementById('hud-waterchip').classList.contains('low'),
                   left: vis(wl) ? wl.textContent.trim() : null, inRow2: !!(wl && wl.closest('#hudrow2')),
                   outside: out, row1Over: row1e.scrollWidth - row1e.clientWidth, row1Gear: kids.some((k) => over(k, gear)),
                   gearHit: !!(hit && hit.closest && hit.closest('#gearbtn')) };
        });
        await b.page.screenshot({ path: path.join(ART, `m12-lowwater-${vw}.png`) });
        ok(`${vw}x${vh}: the chip is low with a 2-digit price, and 'N left' sits in row 2`,
           m.cost >= 10 && m.low && m.two && m.inRow2 && m.left === Math.floor(m.water / m.cost) + ' left', JSON.stringify({ cost: m.cost, water: m.water, left: m.left, inRow2: m.inRow2 }));
        ok(`${vw}x${vh}: nothing off the screen, row 1 does not overflow, nothing in row 1 under the gear, the gear hit-tests`,
           m.outside.length === 0 && m.row1Over <= 0 && !m.row1Gear && m.gearHit, JSON.stringify({ outside: m.outside.slice(0, 3), row1Over: m.row1Over, row1Gear: m.row1Gear, gearHit: m.gearHit }));
        await b.ctx.close();
      }
      // (b) Reduced motion follows the OS setting; a stored choice wins
      const rm = [];
      for (const [os, stored] of [[null, null], ['reduce', null], ['reduce', false]]) {
        const ctx = await E.browser.newContext({ viewport: { width: 390, height: 844 }, ...(os ? { reducedMotion: os } : {}) });
        const b = await E.bootMine(4242, 390, 844, { ctx, before: async (page) => { await SAVE(page);
          if (stored != null) await page.addInitScript((v) => { try { localStorage.setItem('mycelium.settings.v1', JSON.stringify({ reducedMotion: v })); } catch (_) {} }, stored); } });
        rm.push(await b.page.evaluate(() => ({ rm: window.__game.mine.juicePrefs().reducedMotion, body: document.body.classList.contains('rmotion') })));
        await b.ctx.close();
      }
      ok('Reduced motion: off by default, on when the OS asks for reduce, and a stored Off wins over the OS', rm[0].rm === false && rm[1].rm === true && rm[2].rm === false, JSON.stringify(rm));
      // (c) no Vibration item where the browser cannot vibrate
      const vb = [];
      for (const strip of [false, true]) {
        const b = await E.bootMine(4242, 390, 844, { before: async (page) => { await SAVE(page);
          if (strip) await page.addInitScript(() => { try { delete Navigator.prototype.vibrate; } catch (_) {} }); } });
        await b.page.click('#gearbtn').catch(() => {});
        await sleep(300);
        vb.push(await b.page.evaluate(() => ({ api: typeof navigator.vibrate === 'function', item: !!document.getElementById('set-vib'), rm: !!document.getElementById('set-rmotion'),
                                             pref: window.__game.mine.juicePrefs().vibration })));
        await b.ctx.close();
      }
      ok('no Vibration item (and vibration off) without navigator.vibrate; the item is there with it', vb[0].api && vb[0].item && !vb[1].api && !vb[1].item && vb[1].pref === false && vb[1].rm,
         JSON.stringify(vb));
      // (d) a new run's first frame carries no price pulse; (e) the beat goes under the open menu
      {
        const b = await E.bootMine(4242, 390, 844, { before: SAVE });
        await quiet(b.page); await helpers(b.page);
        const r = await b.page.evaluate(async () => {
          const g = window.__game, s = g.state, out = {};
          s.active.water = 5000;
          const p0 = g.mine.digPulses();
          await window.__navDig({ targetM: 47, maxIters: 160 });
          await new Promise((x) => setTimeout(x, 700));
          out.run1 = { pulses: g.mine.digPulses() - p0, cost: g.mine.costHere() };
          const p1 = g.mine.digPulses();
          g.mine.playSeed(4242);
          for (let i = 0; i < 100 && (!window.__game.state || window.__game.state === s); i++) await new Promise((x) => setTimeout(x, 30));
          await new Promise((x) => setTimeout(x, 1200));
          const dc = document.getElementById('hud-digcost');
          out.run2 = { pulses: g.mine.digPulses() - p1, cost: window.__game.mine.costHere(), cls: dc.className, text: dc.textContent };
          return out;
        });
        ok("a new run's first frames carry no price pulse (the last run's price is forgotten)", r.run1.pulses >= 1 && r.run1.cost >= 4 && r.run2.pulses === 0 && !/pulse/.test(r.run2.cls),
           JSON.stringify(r));
        await quiet(b.page);
        const bt = await b.page.evaluate(async () => {
          const g = window.__game;
          g.mine.showBeat('42 m', 'ANTHRACITE', 'Digs now cost 4', false);
          await new Promise((x) => setTimeout(x, 120));
          const vis = () => { const e = document.getElementById('mineBeat'); return e ? getComputedStyle(e).visibility : null; };
          const before = vis();
          document.getElementById('gearbtn').click();
          await new Promise((x) => setTimeout(x, 120));
          const open = vis(), menu = !document.getElementById('settingsmenu').classList.contains('hidden');
          document.getElementById('gearbtn').click();
          await new Promise((x) => setTimeout(x, 120));
          return { before, open, menu, after: vis() };
        });
        ok('the beat is hidden while the settings menu is open, and back when it closes', bt.before === 'visible' && bt.menu && bt.open === 'hidden' && bt.after === 'visible', JSON.stringify(bt));
        await b.ctx.close();
      }
      // (f) a landfall's chord and vibration land on the frame the run ends, seconds before the screen
      {
        const b = await E.bootMine(4242, 390, 844, { before: async (page) => { await SAVE(page); await VIB_SPY(page); } });
        const r = await b.page.evaluate(async () => {
          const g = window.__game;
          if (window.__sfx.muted()) g.sfx().toggleSfx();
          g.mine.setJuice('vibration', true);
          g.mine.playLeg(1, 1);
          const s0 = g.state;
          for (let i = 0; i < 200 && !(window.__game.state && window.__game.state !== s0 && window.__game.mine.journey && window.__game.state.substrate.mineJourney); i++) await new Promise((x) => setTimeout(x, 30));
          const s = window.__game.state;
          s.nematodes.length = 0; s.clouds.length = 0;
          for (let i = 0; i < 60 && !s.substrate._rockSolidified; i++) await new Promise((x) => setTimeout(x, 50));
          await new Promise((x) => setTimeout(x, 400));
          g.mine.grow(0, 1);
          await new Promise((x) => setTimeout(x, 600));
          const e0 = window.__sfx.counts.runEnd | 0, r0 = window.__sfx.counts.record | 0, v0 = window.__vibs.length;
          const t = { first: null, cue: null, vib: null, over: null, screen: null };
          const t0 = performance.now();
          g.mine.plantAtTaproot();
          while (performance.now() - t0 < 12000) {
            const now = performance.now() - t0;
            if (t.over == null && s.runOver) t.over = now;
            if (t.cue == null && (window.__sfx.counts.runEnd | 0) > e0) t.cue = now;
            if (t.first == null && ((window.__sfx.counts.runEnd | 0) > e0 || (window.__sfx.counts.record | 0) > r0)) t.first = now;
            if (t.vib == null && window.__vibs.slice(v0).some((p) => Array.isArray(p) && p.join(',') === '60,40,120')) t.vib = now;
            if (t.screen == null && document.getElementById('ssMineEnd')) t.screen = now;
            if (t.screen != null && t.cue != null) break;
            await new Promise((x) => setTimeout(x, 16));
          }
          return Object.assign(t, { cause: s.runResult && s.runResult.cause, landfall: window.__sfx.last.runEnd });
        });
        const f = (v) => v == null ? 'never' : Math.round(v) + ' ms';
        // The ending's first sound (the record arpeggio when a record fell, else the chord) and the
        // vibration within 400 ms of the run ending; the chord 640 ms after an arpeggio; all of it seconds
        // before the end screen (the first M12 build played them AT the screen: 6.3 s after the landfall).
        ok("a landfall's first sound and [60, 40, 120] vibration land within 400 ms of the run ending, the chord within 1100 ms, all before the end screen",
           r.cause === 'island' && r.over != null && r.first != null && r.cue != null && r.vib != null && r.first - r.over <= 400 && r.vib - r.over <= 400
           && r.cue - r.over <= 1100 && r.screen != null && r.screen - r.cue >= 1000 && r.landfall && r.landfall.landfall,
           `cause ${r.cause}: over ${f(r.over)}, first sound ${f(r.first)}, chord ${f(r.cue)}, vibration ${f(r.vib)}, end screen ${f(r.screen)}`);
        ok('no page errors (verify)', b.errs.length === 0, b.errs.slice(0, 2).join(' | ') || 'clean');
        await b.ctx.close();
      }
    }
    // =========================================================================================
    // 2. VIBRATION
    // =========================================================================================
    if (want('vib')) {
      console.log('--- acceptance 2: vibration on a seam and a pocket, and never when off');
      const b = await E.bootMine(4242, 390, 844, { before: async (page) => { await SAVE(page); await VIB_SPY(page); } });
      await quiet(b.page); await helpers(b.page);
      const r = await b.page.evaluate(async () => {
        const g = window.__game, out = {};
        // enough colony for four stamps 80 units apart (the boot colony is a handful of strands)
        g.state.active.water = 5000;
        await window.__navDig({ targetM: 24, maxIters: 80 });
        await window.__wait(() => !g.mine.revealing(), 4000);
        out.def = g.mine.juicePrefs().vibration;          // a desktop (fine pointer) defaults OFF
        g.mine.setJuice('vibration', true);
        window.__vibs.length = 0;
        out.s1 = await window.__seam(); out.afterSeam = window.__vibs.slice();
        out.p1 = await window.__pocket(); out.afterPocket = window.__vibs.slice();
        g.mine.setJuice('vibration', false);
        window.__vibs.length = 0;
        out.s2 = await window.__seam(); out.p2 = await window.__pocket();
        out.off = window.__vibs.slice();
        out.stored = JSON.parse(localStorage.getItem('mycelium.settings.v1') || '{}').vibration;
        return out;
      });
      ok('with Vibration on, a seam calls navigator.vibrate(12)', r.s1.ok && r.afterSeam.length === 1 && r.afterSeam[0] === 12, JSON.stringify(r.afterSeam));
      ok('...and a pocket calls navigator.vibrate(20)', r.p1.ok && r.afterPocket.length === 2 && r.afterPocket[1] === 20, JSON.stringify(r.afterPocket));
      ok('with it off, a seam and a pocket never call it (and still pay)', r.s2.ok && r.p2.ok && r.off.length === 0, `calls ${JSON.stringify(r.off)}, paid ${r.s2.ok}/${r.p2.ok}`);
      ok('the setting is persisted in mycelium.settings.v1, and a fine pointer defaults to off', r.stored === false && r.def === false, `stored ${r.stored}, default ${r.def}`);
      // The menu toggles it (and Reduced motion) — the real buttons.
      await b.page.click('#gearbtn');
      await sleep(150);
      const m0 = await b.page.evaluate(() => ({ v: (document.getElementById('set-vib-state') || {}).textContent, r: (document.getElementById('set-rmotion-state') || {}).textContent }));
      await b.page.click('#set-vib'); await b.page.click('#set-rmotion');
      const m1 = await b.page.evaluate(() => ({ v: document.getElementById('set-vib-state').textContent, r: document.getElementById('set-rmotion-state').textContent,
        p: window.__game.mine.juicePrefs(), body: document.body.classList.contains('rmotion') }));
      await b.page.screenshot({ path: path.join(ART, 'm12-settings-390.png') });
      ok("the settings menu's Vibration and Reduced motion toggles flip the settings", m0.v === 'Off' && m0.r === 'Off' && m1.v === 'On' && m1.r === 'On'
         && m1.p.vibration && m1.p.reducedMotion && m1.body, `${JSON.stringify(m0)} -> ${JSON.stringify(m1)}`);
      await b.ctx.close();
    }

    // =========================================================================================
    // 3. REDUCED MOTION: NO SHAKE THROUGH A LINE CROSSING
    // =========================================================================================
    if (want('motion')) {
      console.log('--- acceptance 3: reduced motion holds the camera still through the 42 m line');
      const b = await E.bootMine(4242, 390, 844, { before: SAVE });
      await quiet(b.page); await helpers(b.page);
      const r = await b.page.evaluate(async () => {
        const g = window.__game, s = g.state, out = {};
        g.mine.setJuice('reducedMotion', true);
        g.mine.resetShake();
        // sample the offset applied on EVERY drawn frame through the crossing
        const seen = []; let on = true;
        const tick = () => { seen.push(g.mine.shake().cur); if (on) requestAnimationFrame(tick); };
        requestAnimationFrame(tick);
        s.active.water = 5000;
        out.dive = await window.__navDig({ targetM: 47, maxIters: 160 });
        out.depth = g.mine.depth();
        await new Promise((x) => setTimeout(x, 400));
        out.rm = g.mine.shake();
        out.maxSeen = Math.max(0, ...seen.map((c) => Math.hypot(c.x, c.y)));
        out.frames = seen.length;
        // CONTROL: motion back on, the same crossing (forgotten, so it is felt again) shakes.
        g.mine.setJuice('reducedMotion', false);
        g.mine.resetShake(); seen.length = 0;
        delete s._mineLineFelt;
        await new Promise((x) => setTimeout(x, 600));
        on = false;
        out.on = g.mine.shake();
        out.maxSeenOn = Math.max(0, ...seen.map((c) => Math.hypot(c.x, c.y)));
        out.framesOn = seen.length;
        return out;
      });
      ok('with Reduced motion on, the line was crossed and the shake refused', r.depth > 42 && r.rm.kinds.line >= 1 && r.rm.skipped >= 1 && r.rm.n === 0,
         `${r.depth} m, ${JSON.stringify(r.rm.kinds)}, skipped ${r.rm.skipped}, shaken ${r.rm.n}`);
      ok('...and the camera offset stayed 0 on every frame through it', r.rm.maxPx === 0 && r.maxSeen === 0 && r.frames > 10,
         `max ${r.rm.maxPx} px (sampled ${r.maxSeen} over ${r.frames} frames)`);
      ok('CONTROL: with it off the same crossing shakes the camera, by at most 3 px', r.on.n >= 1 && r.on.maxPx > 0 && r.on.maxPx <= 3.0001,
         `shaken ${r.on.n}, max ${r.on.maxPx} px over ${r.framesOn} frames`);
      // Reduced motion: the end screen's figures are final from its first frame.
      await b.page.evaluate(() => { window.__game.mine.setJuice('reducedMotion', true); window.__game.handlers.onFruitNow(); });
      await b.page.waitForSelector('#ssMineEnd', { timeout: 15000 }).catch(() => {});
      const ec = await b.page.evaluate(() => Array.from(document.querySelectorAll('#ssMineEnd .ss-count')).map((c) => [c.textContent, c.dataset.n]));
      ok('...and under Reduced motion the end screen does not count up (figures final at once)', ec.length > 0 && ec.every(([t, n]) => t === n) && ec.some(([, n]) => +n > 0),
         JSON.stringify(ec));
      await b.ctx.close();
    }

    // =========================================================================================
    // 4. THE HUD: LOW WATER, PRICE PULSE, KIT PULSE
    // =========================================================================================
    if (want('hud')) {
      console.log('--- acceptance 4: the water chip, the price pulse and the kit pulses (390x844)');
      const b = await E.bootMine(4242, 390, 844, { before: SAVE });
      await quiet(b.page); await helpers(b.page);
      const r = await b.page.evaluate(async () => {
        const g = window.__game, s = g.state, out = { rows: [] };
        const read = () => { const c = document.getElementById('hud-waterchip'), l = document.getElementById('hud-waterleft');
          return { low: c.classList.contains('low'), left: l.hidden ? null : l.textContent }; };
        const p0 = g.mine.digPulses();
        s.active.water = 5000;
        out.dive = await window.__navDig({ targetM: 47, maxIters: 160 });
        await new Promise((x) => setTimeout(x, 700));
        out.pulses = g.mine.digPulses() - p0;
        out.cost = g.mine.costHere();
        const c = out.cost;
        for (const w of [12 * c, 4 * c + 1, 4 * c, 4 * c - 1, 3 * c + 1, 3 * c, 2 * c, c + 1, c, 5 * c]) {
          s.active.water = w;
          await new Promise((x) => setTimeout(x, 650));
          const cc = g.mine.costHere();
          out.rows.push(Object.assign({ w, cost: cc, want: w < 4 * cc, wantLeft: w < 4 * cc ? Math.floor(w / cc) + ' left' : null }, read()));
        }
        s.active.water = 2 * c;
        await new Promise((x) => setTimeout(x, 650));
        return out;
      });
      await b.page.screenshot({ path: path.join(ART, 'm12-lowwater-390.png') });
      const bad = r.rows.filter((x) => x.low !== x.want || x.left !== x.wantLeft);
      ok("the water chip has .low and 'N left' exactly when water < 4 x costHere", bad.length === 0 && r.rows.some((x) => x.low) && r.rows.some((x) => !x.low),
         `cost ${r.cost}: ` + r.rows.map((x) => `${x.w}:${x.low ? x.left : '-'}`).join(' ') + (bad.length ? ' BAD ' + JSON.stringify(bad[0]) : ''));
      ok('the price chip pulses when the price changes (the 42 m line)', r.pulses >= 1, `${r.pulses} pulse(s), price now ${r.cost}`);
      // the kit: a worm attached with a flask in the bag, and rot with a dose
      const k = await b.page.evaluate(async () => {
        const g = window.__game, s = g.state, out = {};
        s.active.water = 5000;
        const btn = (id) => document.getElementById(id);
        const cls = () => ({ fl: btn('kit-excrete').classList.contains('threat'), en: btn('kit-amputate').classList.contains('threat'),
          anim: getComputedStyle(btn('kit-excrete')).animationName });
        s.mineItems.excrete = 1; s.mineItems.amputate = 1;
        await new Promise((x) => setTimeout(x, 700));
        out.calm = cls();
        let tip = null; for (const n of s.active.nodes) if (!n.infected && (!tip || n.y > tip.y)) tip = n;
        g.mine.spawnWorm(tip.x + 6, tip.y - 6);
        await window.__wait(() => g.mine.attached() > 0, 8000);
        await new Promise((x) => setTimeout(x, 700));
        out.worm = cls();
        s.nematodes.length = 0;
        s.config.trichoderma.moveSpeed = 0;
        const n2 = window.__strand(30); g.mine.spawnCloud(n2.x, n2.y);
        await window.__wait(() => s.mineInfect, 8000);
        await new Promise((x) => setTimeout(x, 900));
        out.rot = cls();
        return out;
      });
      await b.page.screenshot({ path: path.join(ART, 'm12-kitpulse-390.png') });
      ok('the flask breathes while a worm is attached, and not before', !k.calm.fl && k.worm.fl && k.worm.anim === 'kitthreat', JSON.stringify(k));
      ok('the enzyme breathes while rot is on the colony, and not before; the flask stops once the worms are gone', !k.calm.en && k.rot.en && !k.rot.fl, JSON.stringify(k.rot));
      ok('no page errors', b.errs.length === 0, b.errs.slice(0, 2).join(' | ') || 'clean');
      await b.ctx.close();
    }

    // =========================================================================================
    // 5. PERF: 16 WORMS, JUICE ON vs OFF, INTERLEAVED
    // =========================================================================================
    if (want('perf')) {
      console.log('--- acceptance 5: frame p95, juice on vs off, 16 worms (390x844 dsf 2)');
      const ctx = await E.browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
      const b = await E.bootMine(4242, 390, 844, { ctx, before: SAVE });
      await quiet(b.page); await helpers(b.page);
      const r = await b.page.evaluate(async () => {
        const g = window.__game, s = g.state;
        s.active.water = 5000;
        await window.__navDig({ targetM: 30, maxIters: 120 });
        await window.__wait(() => !g.mine.revealing(), 4000);
        let tip = null; for (const n of s.active.nodes) if (!n.infected && (!tip || n.y > tip.y)) tip = n;
        for (let i = 0; i < 16; i++) g.mine.spawnWorm(tip.x + ((i % 8) - 4) * 30, tip.y - 20 - (i > 7 ? 40 : 0));
        await new Promise((x) => setTimeout(x, 1500));
        const cv = document.getElementById('game'), c = cv.getContext('2d');
        const on = [], off = [];
        let t = performance.now();
        const frame = (juice, i) => {
          window.MYCELIUM_NO_JUICE = !juice;
          if (juice && i % 8 === 0) g.mine.shakeNow('perf');
          t += 16.7;
          const a = performance.now();
          g.mine.frameStep(t, 16.7); g.renderFrame(t, 1); c.getImageData(0, 0, 1, 1);
          return performance.now() - a;
        };
        for (let i = 0; i < 20; i++) frame(i & 1, i);            // warm
        for (let i = 0; i < 400; i++) { if (i & 1) on.push(frame(true, i >> 1)); else off.push(frame(false, i >> 1)); }
        window.MYCELIUM_NO_JUICE = false;
        const q = (a, p) => { a = a.slice().sort((x, y) => x - y); return a[Math.min(a.length - 1, Math.floor(a.length * p))]; };
        return { worms: s.nematodes.length, attached: g.mine.attached(), n: on.length,
                 on: { med: q(on, 0.5), p95: q(on, 0.95) }, off: { med: q(off, 0.5), p95: q(off, 0.95) }, shakes: g.mine.shake().n };
      });
      const dp = r.on.p95 - r.off.p95;
      ok('frame p95 with the juice on regresses by 1.0 ms or less (16 worms)', r.worms >= 16 && dp <= 1.0,
         `worms ${r.worms} (attached ${r.attached}), ${r.n} frames each, on med ${r.on.med.toFixed(2)} / p95 ${r.on.p95.toFixed(2)} ms, off med ${r.off.med.toFixed(2)} / p95 ${r.off.p95.toFixed(2)} ms, delta p95 ${dp.toFixed(2)} ms, shakes ${r.shakes}`);
      await b.ctx.close();
    }
  } catch (e) {
    fail++; console.log('  FAIL  harness error — ' + (e && e.stack || e));
  } finally {
    await E.close();
  }
  console.log(`\n==== ${pass} passed, ${fail} failed ====`);
  process.exit(fail ? 1 : 0);
})();
