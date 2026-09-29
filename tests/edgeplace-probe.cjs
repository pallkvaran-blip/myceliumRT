/* PROBE (M10 verify): can an edge mark find NO clear spot, and what happens when it cannot?
 * A worm chevron's placement (`mineEdgePlace`, shared with the compass) walks back to the screen
 * centre; if the whole ray is under a HUD rect it returns null. This covers the screen with a toast
 * (one of the HUD rects the placement avoids), attaches worms off screen, sets rot off screen, buys
 * the compass, and renders frames — printing page errors and what was drawn. Also prints needle /
 * chevron overlaps from a sweep. Prints, never fails.   node tests/edgeplace-probe.cjs [vw vh]
 */
const H = require('./mine-harness.cjs');
const vw = +process.argv[2] || 390, vh = +process.argv[3] || 844;
(async () => {
  const E = await H.start();
  try {
    const b = await E.boot('#leg,1,2', vw, vh);
    await b.page.waitForFunction(() => !!(window.__game && window.__game.mine && window.__game.state.substrate._fineSolid), { timeout: 40000 });
    await H.sleep(1200); await H.injectNav(b.page);
    const r = await b.page.evaluate(async () => {
      const g = window.__game, s = g.state;
      s.nematodes.length = 0; s.clouds.length = 0; s.config.nematodes.respawnChance = 0; s.config.trichoderma.respawnChance = 0;
      s.active.water = 100000;
      await window.__navDig({ targetM: 40, maxIters: 200 });
      for (let i = 0; i < 100 && g.mine.revealing(); i++) await new Promise((res) => setTimeout(res, 50));
      s.config.mine.worms.waterPerSec = 0;
      s.config.mine.compass = { island: 2, mats: { anthracite: 2, garnet: 2, hematite: 2 } };
      const live = s.active.nodes.filter((n) => !n.infected).sort((a, c) => c.y - a.y);
      for (let k = 0; k < 4; k++) { const n = live[Math.min(live.length - 1, k * 9)]; g.mine.spawnWorm(n.x + 3, n.y); }
      for (let i = 0; i < 120 && (s.mineAttached | 0) < 2; i++) await new Promise((res) => setTimeout(res, 100));
      const out = { attached: s.mineAttached | 0 };
      // Sweep: needles vs chevrons overlap.
      const f = g.mine.compass()[0];
      let overlaps = 0, pairs = 0, chevs = 0, needles = 0;
      const hit = (a, c) => a.x0 < c.x1 && a.x1 > c.x0 && a.y0 < c.y1 && a.y1 > c.y0;
      for (const [ox, oy] of [[700, -500], [-700, 400], [0, 900], [900, 0], [-900, -300]]) {
        g.mine.lookAt(f.fx + ox, f.fy + oy);
        for (let k = 0; k < 4; k++) {
          g.renderFrame(performance.now());
          const ch = g.mine.chevrons(), nd = g.mine.needles().filter((n) => n.rect);
          chevs += ch.length; needles += nd.length;
          for (const c of ch) for (const n of nd) { pairs++; if (hit(n.rect, { x0: c.x - 17, x1: c.x + 17, y0: c.y - 17, y1: c.y + 17 })) overlaps++; }
        }
      }
      Object.assign(out, { chevs, needles, pairs, overlaps });
      // Cover the screen with a HUD rect (a toast), worms off screen: does the frame survive?
      g.mine.lookAt(f.fx + 900, f.fy - 600);
      const t = document.createElement('div'); t.className = 'toast in';
      Object.assign(t.style, { position: 'fixed', left: '0', top: '0', width: '100vw', height: '100vh', zIndex: 1, pointerEvents: 'none', transform: 'none', maxWidth: 'none', margin: '0' });
      document.getElementById('ui').appendChild(t);
      g.mine.hudRects();   // force re-read
      let err = null;
      s._mineChevrons = 'stale';
      const onS = []; for (const w of s.nematodes) { if (!w.attached) continue; const q = window.__game.camera ? null : null; onS.push(Math.round(w.x) + ',' + Math.round(w.y)); }
      out.cam = g.mine.lookAt ? null : null;
      try { g.renderFrame(performance.now() + 1000); } catch (e) { err = String(e && e.message || e); }
      out.rects = g.mine.hudRects().map((q) => q.sel + ':' + [q.x0, q.y0, q.x1, q.y1].map(Math.round).join(','));
      
      out.coverErr = err; out.rawChev0 = s._mineChevrons === 'stale' ? 'STALE (the frame died before the marks finished)' : s._mineChevrons.length; if (s._mineChevrons === 'stale') s._mineChevrons = []; out.coverNeedles = g.mine.needles().map((n) => n.hidden || (n.x != null ? 'drawn' : 'faded'));
      t.remove();
      return out;
    });
    console.log(JSON.stringify(r, null, 1));
    console.log('page errors:', b.errs.slice(0, 3));
  } finally { await E.close(); }
})();
