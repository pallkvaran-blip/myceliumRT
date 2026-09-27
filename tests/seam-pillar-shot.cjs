/* SEAM PILLAR SHOT (M7 verifier round 4) — a tool: writes frames, never fails, not in the runner.
 *   NODE_PATH=/opt/node22/lib/node_modules node tests/seam-pillar-shot.cjs [legs=1,2,3] [--old]
 * For each leg, finds the rows where a chunk seam draws a FREE-STANDING THIN WALL (legprobe `world`'s
 * pillar metric: the band within 0.75 cell of the seam >= 50% drawn rock, 2-4 cells out on both sides
 * <= 30%), and frames the worst three seams at the resting zoom, centred on their tallest pillar run:
 * tests/.artifacts/m7-pillar-leg<N>-<k>[-old]-390.png. `--old` boots with MYCELIUM_OLD_SEAM_CHAIN
 * (round 3's seam) for the before picture. */
const path = require('path');
const H = require('./mine-harness.cjs');
const LP = require('./bots/legprobe.cjs');
const old = process.argv.includes('--old');
const legs = (process.argv.slice(2).find((a) => /^[\d,]+$/.test(a)) || '1,2,3').split(',').map(Number);
(async () => { const E = await H.start(); try {
  for (const leg of legs) {
    const b = await E.boot('#leg,1,' + leg, 390, 844, old ? { before: (p) => p.addInitScript(() => { window.MYCELIUM_OLD_SEAM_CHAIN = true; }) } : {});
    await b.page.waitForFunction(() => !!(window.__game && window.__game.mine && window.__game.mine.leg && window.__game.state.substrate._fineSolid), { timeout: 40000 });
    const w = await LP.world(b.page);
    const spots = await b.page.evaluate(() => {
      const g = window.__game, s = g.state, sub = s.substrate, cs = sub.cellSize, cw = s.config.mine.chunkCols, rows = sub.rows;
      const W = sub._fineCols, sol = sub._fineSolid, K = Math.round(cs / sub._fineSize);
      const frac = (a, bb, r) => { let n = 0, t = 0; for (let y = r * K; y < (r + 1) * K; y++) for (let x = Math.round(a * K); x < Math.round(bb * K); x++) { t++; n += sol[y * W + x]; } return n / t; };
      const out = [];
      for (let ci = 1; ci < 21; ci++) { const L = ci * cw; let tot = 0, run = 0, best = 0, at = -1;
        for (let r = 4; r < rows - 6; r++) { if (frac(L - 0.75, L + 0.75, r) >= 0.5 && frac(L - 4, L - 2, r) <= 0.3 && frac(L + 2, L + 4, r) <= 0.3) { tot++; run++; if (run > best) { best = run; at = r - ((run - 1) >> 1); } } else run = 0; }
        if (tot) out.push({ ci, tot, best, at }); }
      return out.sort((a, bb) => bb.tot - a.tot).slice(0, 3);
    });
    let k = 0;
    for (const sp of spots) {
      await b.page.evaluate(async ([ci, r]) => { const g = window.__game, sub = g.state.substrate, cs = sub.cellSize, cw = g.state.config.mine.chunkCols;
        g.mine.lookAt(ci * cw * cs, sub.surfaceY + (r + 0.5) * cs); await new Promise((q) => setTimeout(q, 700)); }, [sp.ci, sp.at]);
      const f = path.join(H.ROOT, 'tests', '.artifacts', `m7-pillar-leg${leg}-${++k}${old ? '-old' : ''}-390.png`);
      await b.page.screenshot({ path: f, animations: 'disabled', timeout: 8000 }).catch(() => {});
      console.log(`leg ${leg}${old ? ' (old seam)' : ''}: seam ${sp.ci} (col ${sp.ci * 24}) ${sp.tot} pillar rows, tallest run ${sp.best} at row ${sp.at} -> ${path.basename(f)}`);
    }
    console.log(`leg ${leg}${old ? ' (old seam)' : ''}: pillar rows per seam ${w.pillarSeam} (p90 ${w.pillarSeam90}), interior ${w.pillarMid} (p90 ${w.pillarMid90})`);
    await b.ctx.close();
  }
} finally { await E.close(); } })();
