/* SFX PROBE — how loud the mine's synthesised cues really are, and what the voice cap does.
 * A TOOL: prints, never fails, not in the runner. `node tests/sfx-probe.cjs`
 *
 * Measures with tests/sfx-meter.cjs (an AudioWorklet peak meter on the audio thread, and every source's
 * [start, stop) on the audio clock), reporting each scenario's PEAK in dBFS. Scenarios: every cue alone; ten band gongs fired at once; six
 * DIFFERENT cues at once; a real-shaped dig across a line (grow sample + gong + hiss); and the voice
 * budget's own counters (scheduled / dropped / high-water mark).
 * Each row also carries `phone`: the peak through sfx-meter's 300 Hz highpass (a phone-speaker proxy).
 * The meter is awaited (`__meterReady`) before the first scenario. M12 minors: the first scenario used to
 * read ~14-30 dB low — not the meter but the game, whose output chain was built by its first sound with
 * its compressors fully clamped (fixed in initSfx).
 * Written for the M12 verify round: the plan asks for "at most 6 voices, peaking at -12 dBFS", and the
 * first build counted CUES (a gong is 3 oscillators), let six identical gongs stack to +1.6 dBFS, and left
 * the dig sample out.
 */
const H = require('./mine-harness.cjs');
const TAP = require('./sfx-meter.cjs');
(async () => {
  const E = await H.start();
  try {
    const b = await E.bootMine(4242, 390, 844, { before: TAP });
    await b.page.mouse.click(200, 400);   // a gesture, so the context runs
    const out = await b.page.evaluate(async () => {
      const S = window.__game.sfx(), sl = (ms) => new Promise((r) => setTimeout(r, ms));
      if (window.__sfx.muted()) S.toggleSfx();
      for (let i = 0; i < 40 && window.__sfx.ctxState() !== 'running'; i++) await sl(50);
      const meters = await window.__meterReady();   // the meter listens before the first scenario plays
      // the dig sample decodes lazily
      for (let i = 0; i < 60 && !window.__sfx.growReady?.(); i++) await sl(50);
      const db = (v) => (v > 0 ? (20 * Math.log10(v)).toFixed(1) : '-inf');
      const res = { ctx: window.__sfx.ctxState(), meter: window.__meterError || ('worklet x' + meters), grow: !!(window.__sfx.growReady && window.__sfx.growReady()) };
      const run = async (name, fn, wait = 2600) => {
        await sl(300); window.__peakReset(); window.__voiceReset(); const d0 = window.__sfx.counts.dropped | 0;
          fn(); await sl(wait);
        res[name] = { dBFS: db(window.__peak), phone: db(window.__peakPhone), dropped: (window.__sfx.counts.dropped | 0) - d0, voices: window.__voiceMax() };
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
      await run('record then landfall (the ending)', () => { S.playRecordArp(); setTimeout(() => S.playEndChord(true), 640); }, 3000);
      await run('finale x8', () => { for (let i = 0; i < 8; i++) setTimeout(() => S.playFinaleNote(i), i * 300); }, 4500);
      return res;
    });
    for (const [k, v] of Object.entries(out)) console.log(k.padEnd(36), typeof v === 'object' ? JSON.stringify(v) : v);
    await b.ctx.close();
  } finally { await E.close(); }
})();
