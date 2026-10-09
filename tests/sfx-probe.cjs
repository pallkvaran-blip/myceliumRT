/* SFX PROBE — how loud the mine's synthesised cues really are, and what the voice cap does.
 * A TOOL: prints, never fails, not in the runner. `node tests/sfx-probe.cjs`
 *
 * Taps every connection to the AudioContext's destination into an AnalyserNode and polls its time
 * domain every 10 ms (a 2048-sample window is ~43 ms at 48 kHz, so nothing between polls is missed),
 * reporting each scenario's PEAK in dBFS. Scenarios: every cue alone; ten band gongs fired at once; six
 * DIFFERENT cues at once; a real-shaped dig across a line (grow sample + gong + hiss); and the voice
 * budget's own counters (scheduled / dropped / high-water mark).
 * Written for the M12 verify round: the plan asks for "at most 6 voices, peaking at -12 dBFS", and the
 * first build counted CUES (a gong is 3 oscillators), let six identical gongs stack to +1.6 dBFS, and left
 * the dig sample out.
 */
const H = require('./mine-harness.cjs');
const TAP = (page) => page.addInitScript(() => {
  window.__peak = 0;
  const C = AudioNode.prototype.connect;
  const taps = new WeakMap();
  AudioNode.prototype.connect = function (dst) {
    const r = C.apply(this, arguments);
    try {
      if (dst && dst instanceof AudioDestinationNode) {
        const ctx = this.context;
        let an = taps.get(ctx);
        if (!an) {
          an = ctx.createAnalyser(); an.fftSize = 2048; taps.set(ctx, an);
          const buf = new Float32Array(2048);
          setInterval(() => { an.getFloatTimeDomainData(buf); let m = 0; for (let i = 0; i < buf.length; i++) { const v = Math.abs(buf[i]); if (v > m) m = v; } if (m > window.__peak) window.__peak = m; }, 10);
        }
        C.call(this, an);
      }
    } catch (_) {}
    return r;
  };
});
(async () => {
  const E = await H.start();
  try {
    const b = await E.bootMine(4242, 390, 844, { before: TAP });
    await b.page.mouse.click(200, 400);   // a gesture, so the context runs
    const out = await b.page.evaluate(async () => {
      const S = window.__game.sfx(), sl = (ms) => new Promise((r) => setTimeout(r, ms));
      if (window.__sfx.muted()) S.toggleSfx();
      for (let i = 0; i < 40 && window.__sfx.ctxState() !== 'running'; i++) await sl(50);
      // the dig sample decodes lazily
      for (let i = 0; i < 60 && !window.__sfx.growReady?.(); i++) await sl(50);
      const db = (v) => (v > 0 ? (20 * Math.log10(v)).toFixed(1) : '-inf');
      const res = { ctx: window.__sfx.ctxState() };
      const run = async (name, fn, wait = 2600) => {
        await sl(300); window.__peak = 0; const d0 = window.__sfx.counts.dropped | 0;
        if (window.__sfx.resetHigh) window.__sfx.resetHigh();
        fn(); await sl(wait);
        res[name] = { dBFS: db(window.__peak), dropped: (window.__sfx.counts.dropped | 0) - d0, high: window.__sfx.high ? window.__sfx.high() : null };
      };
      const single = { seam: () => S.playSeamPing('phosphorus', 0), reach: () => S.playReachTick(3), glug: () => S.playPocketGlug(),
        hiss: () => S.playLineHiss(), gong: () => S.playBandGong(), thud: () => S.playRefuseThud(), worm: () => S.playWormClick(),
        flask: () => S.playFlaskSplat(), snip: () => S.playEnzymeSnip(), fizz: () => S.playAcidFizz(), rot: () => S.playRotSting(),
        heart: () => S.playHeartbeat(), relief: () => S.playReliefChime(), record: () => S.playRecordArp(), sparkle: () => S.playSparkle(),
        landfall: () => S.playEndChord(true), chord: () => S.playEndChord(false), tick: () => S.playCountTick(), ding: () => S.playCountDing(),
        buy: () => S.playBuyChime(), finale: () => S.playFinaleNote(3) };
      for (const k of Object.keys(single)) await run(k, single[k], k === 'landfall' || k === 'finale' || k === 'gong' ? 2600 : 1200);
      await run('gong x10', () => { for (let i = 0; i < 10; i++) S.playBandGong(); });
      await run('six different', () => { S.playBandGong(); S.playLineHiss(); S.playRotSting(); S.playRecordArp(); S.playFlaskSplat(); S.playReliefChime(); });
      await run('dig + gong + hiss', () => { S.playGrowBurst(60, 1000); S.playBandGong(); S.playLineHiss(); });
      await run('dig x2 + six different', () => { S.playGrowBurst(60, 600); S.playGrowBurst(60, 600); S.playBandGong(); S.playLineHiss(); S.playRotSting(); S.playRecordArp(); S.playFlaskSplat(); S.playReliefChime(); });
      await run('record then landfall (the ending)', () => { S.playRecordArp(); setTimeout(() => S.playEndChord(true), 560); }, 3000);
      await run('finale x8', () => { for (let i = 0; i < 8; i++) setTimeout(() => S.playFinaleNote(i), i * 300); }, 4500);
      return res;
    });
    for (const [k, v] of Object.entries(out)) console.log(k.padEnd(36), typeof v === 'object' ? JSON.stringify(v) : v);
    await b.ctx.close();
  } finally { await E.close(); }
})();
