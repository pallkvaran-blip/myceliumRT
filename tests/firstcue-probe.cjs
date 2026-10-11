/* FIRST-CUE PROBE (M15) — a tool, prints and never fails. Boots '#mine,4242' N times and plays the page's first
 * refusal thud and the same thud again, reading the peak off tests/sfx-meter.cjs and every compressor's
 * `reduction`. Run it under load (3 x `node -e 'for(;;){}'`) to see the old flake: before M15 the first thud read
 * -27.7 / -20.1 / -18.9 dBFS across boots (PeriodicWave built after the start time; a 3 ms lead); now one value.
 *   node tests/firstcue-probe.cjs [N]
 */
const H = require('./mine-harness.cjs');
const METER = require('./sfx-meter.cjs');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  const E = await H.start();
  const N = +process.argv[2] || 4;
  for (let i = 0; i < N; i++) {
    const b = await E.bootMine(4242, 390, 844, { before: async (page) => {
      await page.addInitScript(() => { try { localStorage.setItem('mycelium.progress.v2', JSON.stringify({ runsDone: 1, mineBest: 3, mineRuns: 2, migratedMineShelfV2: true, mineTips: { dig: true, first_ore: true, first_pocket: true, first_line: true, first_worm: true, first_rot: true, first_cloud: true } })); } catch (_) {}
        window.__comps = []; const P = (window.BaseAudioContext || window.AudioContext).prototype; const o = P.createDynamicsCompressor;
        P.createDynamicsCompressor = function () { const c = o.apply(this, arguments); window.__comps.push(c); return c; }; });
      await METER(page); } });
    await b.page.evaluate(() => { const s = window.__game.state; s.nematodes.length = 0; s.clouds.length = 0; s.config.mine.stuckFruitMs = 1e9; s.active.water = 5000; });
    await b.page.keyboard.press('Shift');
    const r = await b.page.evaluate(async () => {
      const S = window.__game.sfx(), sl = (ms) => new Promise((r) => setTimeout(r, ms));
      if (window.__sfx.muted()) S.toggleSfx();
      for (let i = 0; i < 60 && window.__sfx.ctxState() !== 'running'; i++) await sl(50);
      await window.__meterReady();
      const out = {};
      const dbf = (v) => (v > 0 ? +(20 * Math.log10(v)).toFixed(1) : -999);
      for (const name of ['first', 'again']) {
        await sl(400);
        const red0 = window.__comps.map((c) => +c.reduction.toFixed(1));
        window.__peakReset();
        const c0 = Object.assign({}, window.__sfx.counts);
        const t0 = window.__game.sfx && window.__sfx.ctxState();
        S.playRefuseThud();
        const red1 = []; for (let k = 0; k < 8; k++) { await sl(100); red1.push(window.__comps.map((c) => +c.reduction.toFixed(1)).join('/')); }
        await sl(100);
        const c1 = window.__sfx.counts; const moved = Object.keys(c1).filter((k) => (c1[k] | 0) !== (c0[k] | 0)).map((k) => k + '+' + ((c1[k] | 0) - (c0[k] | 0)));
        out[name] = { dB: dbf(window.__peak), red0, red1: red1.join(' '), moved };
      }
      return out;
    });
    console.log(i, JSON.stringify(r));
    await b.ctx.close();
  }
  await E.close();
})();
