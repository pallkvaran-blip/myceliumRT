/* THE FIRST-VISIT CURTAIN, PROFILED — a tool, prints and never fails; not in the runner.
 *
 *     node tests/curtain-probe.cjs [runs=3] [--profile]
 *
 * Boots the dev-off build on a fresh save at 390x844 touch (the path onboard-check's 600 ms bound
 * times), taps the gate and reports tap -> run -> curtain-lifted. With --profile it also records a
 * CDP CPU profile over the tap -> reveal window and prints the top functions by SELF time, which is
 * how the M5 round-2 fix found `stampMouldInterp` / `stampCloudField` zeroing all 85k cells.
 */
const H = require('./mine-harness.cjs');
const runs = +(process.argv[2] || 3) || 3, PROF = process.argv.includes('--profile');
(async () => {
  const E = await H.start();
  const out = [];
  try {
    for (let i = 0; i < runs; i++) {
      const ctx = await E.browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
      const page = await ctx.newPage();
      await page.addInitScript(() => {
        window.MYCELIUM_SUPABASE = { url: '', anonKey: '' };
        const T = window.__t = {};
        document.addEventListener('pointerdown', () => { if (!T.tap) T.tap = performance.now(); }, true);
        T.cls = [];
        new MutationObserver(() => { const b = document.body; if (!b || !T.tap) return; const h = b.classList.contains('handoff');
          if (!T.cls.length || T.cls[T.cls.length - 1][1] !== h) T.cls.push([Math.round(performance.now()), h]); })
          .observe(document, { attributes: true, subtree: true, attributeFilter: ['class'] });
        T.lt = [];
        try { new PerformanceObserver((l) => { for (const e of l.getEntries()) T.lt.push([Math.round(e.startTime), Math.round(e.duration)]); }).observe({ type: 'longtask', buffered: true }); } catch (_) {}
        const raf0 = window.requestAnimationFrame; T.frames = [];
        window.requestAnimationFrame = (cb) => raf0((t) => { const a = performance.now(); cb(t); if (T.tap && !T.reveal) { const g = window.__game, sub = g && g.state && g.state.substrate; T.frames.push([Math.round(a), Math.round(performance.now() - a), sub ? (sub._rockSolidified ? 'S' : 's') + (document.body.classList.contains('handoff') ? 'H' : 'h') : '-']); } });
        setInterval(() => {
          const now = performance.now(), g = window.__game;
          if (!T.run && g && g.state && g.state.substrate && g.state.substrate.mine) T.run = now;
          if (T.run && !T.reveal && !document.body.classList.contains('handoff')) T.reveal = now;
        }, 8);
      });
      await page.goto(E.base + '/index-nodev.html', { waitUntil: 'domcontentloaded' });
      await page.waitForSelector('#loadscreen.ld-ready', { timeout: 60000 }).catch(() => {});
      await H.sleep(300);
      let cdp = null;
      if (PROF) { cdp = await ctx.newCDPSession(page); await cdp.send('Profiler.enable'); await cdp.send('Profiler.setSamplingInterval', { interval: 200 }); await cdp.send('Profiler.start'); }
      await page.touchscreen.tap(195, 420);
      await page.waitForFunction(() => window.__t.reveal, null, { timeout: 30000 }).catch(() => {});
      const T = await page.evaluate(() => Object.assign({}, window.__t));
      const r = { run: Math.round(T.run - T.tap), reveal: Math.round(T.reveal - T.tap) };
      out.push(r); console.log(`run ${i + 1}: run at ${r.run} ms, curtain lifted at ${r.reveal} ms`);
      const rel = (a) => a.filter(([t]) => t >= T.tap - 5).map(([t, d, f]) => `${Math.round(t - T.tap)}+${d}${f || ''}`).join(' ');
      console.log(`   long tasks after tap: ${rel(T.lt)}`);
      console.log(`   body.handoff changes after tap: ${T.cls.map(([t, h]) => `${Math.round(t - T.tap)}:${h ? 'UP' : 'down'}`).join(' ')}`);
      console.log(`   rAF callbacks tap->reveal: ${rel(T.frames)}`);
      if (PROF) {
        const { profile } = await cdp.send('Profiler.stop');
        const self = new Map(), byId = new Map(profile.nodes.map((n) => [n.id, n]));
        const dt = profile.timeDeltas; const counts = new Map();
        profile.samples.forEach((id, k) => counts.set(id, (counts.get(id) || 0) + (dt[k] || 0)));
        for (const [id, us] of counts) { const n = byId.get(id); const k = n.callFrame.functionName || '(anon)'; self.set(k, (self.get(k) || 0) + us); }
        [...self.entries()].sort((a, b) => b[1] - a[1]).slice(0, 18).forEach(([k, us]) => console.log(`   ${(us / 1000).toFixed(1).padStart(7)} ms  ${k}`));
        // WHO pays for the canvas calls: self time of save/restore/drawImage/fill attributed to the
        // nearest named JS caller (a software rasteriser flushes deferred draws at `restore`).
        const parent = new Map(); for (const n of profile.nodes) for (const c of (n.children || [])) parent.set(c, n.id);
        const CANVAS = new Set(['restore', 'save', 'drawImage', 'fill', 'stroke', 'fillRect', 'clip', '(anon)', 'ctx']);
        const by = new Map();
        for (const [id, us] of counts) {
          const n = byId.get(id); if (!CANVAS.has(n.callFrame.functionName || '(anon)')) continue;
          let p = parent.get(id), name = '?';
          while (p != null) { const pn = byId.get(p); const f = pn.callFrame.functionName; if (f && !CANVAS.has(f)) { name = f; break; } p = parent.get(p); }
          by.set(name, (by.get(name) || 0) + us);
        }
        console.log('   canvas-call self time by caller:');
        [...by.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8).forEach(([k, us]) => console.log(`     ${(us / 1000).toFixed(1).padStart(7)} ms  ${k}`));
      }
      await ctx.close();
    }
    const med = (a) => a.slice().sort((x, y) => x - y)[a.length >> 1];
    console.log(`median curtain ${med(out.map((r) => r.reveal))} ms over ${out.length}`);
  } finally { await E.close(); }
})();
