/* SEAM PROFILE (M7 verifier round 2) — a tool: prints, never fails, not in the runner.
 *   NODE_PATH=/opt/node22/lib/node_modules node tests/seam-profile.cjs [leg|mine,<seed>] [file]
 * Mean fine-mask solidity of carve-CLOSED cells by column offset from a chunk seam (-6..+5: offset 0
 * is the first column of the right-hand chunk), over every seam of the whole leg world, rows 3..rows-7.
 * A seam that reads as a LINE shows as a peak at offsets -1/0 (the stitch's chain) flanked by a trough
 * at -3..-2 / +1..+2 (closed ground no sprite could fit, since a sprite must fit inside its chunk).
 * `open%` is the share of cells the carve opened at that offset. */
const H = require('./mine-harness.cjs');
const LP = require('./bots/legprobe.cjs');
(async () => {
  const E = await H.start();
  const arg = process.argv[2] || '2', file = process.argv[3];
  try {
    let b;
    if (/^mine/.test(arg)) {
      b = await E.boot('#' + arg, 390, 844, file ? { file } : {});
      await b.page.waitForFunction(() => !!(window.__game && window.__game.state && window.__game.state.substrate._fineSolid), { timeout: 40000 });
    } else b = await LP.openLeg(E, +arg, 0, 390, 844, file);
    await LP.world(b.page);
    const r = await b.page.evaluate(() => {
      const g = window.__game, s = g.state, sub = s.substrate, cs = sub.cellSize, cw = s.config.mine.chunkCols;
      const fsz = sub._fineSize, W = sub._fineCols, solid = sub._fineSolid, K = Math.round(cs / fsz);
      const JO = sub.mineJourney && sub.mineJourney._open;
      const cis = g.mine.chunks().slice().sort((a, b) => a - b);
      const openAt = (c, r) => { const ci = Math.floor(c / cw); const o = JO && JO[ci];
        if (o) { const Wc = o.length / sub.rows; return !!o[r * Wc + (c - ci * cw)]; }
        return !sub.solidAtWorld((c + 0.5) * cs, sub.surfaceY + (r + 0.5) * cs) && false; };
      const out = {};
      for (let k = -6; k <= 5; k++) out[k] = { a: 0, n: 0, open: 0, all: 0 };
      for (const ci of cis) { if (!cis.includes(ci - 1)) continue;
        for (let k = -6; k <= 5; k++) { const c = ci * cw + k;
          for (let r = 3; r < sub.rows - 6; r++) { out[k].all++;
            if (openAt(c, r)) { out[k].open++; continue; }
            let n = 0; for (let y = r * K; y < r * K + K; y++) for (let x = c * K; x < c * K + K; x++) if (solid[y * W + x]) n++;
            out[k].a += n / (K * K); out[k].n++; } } }
      const rows = []; for (let k = -6; k <= 5; k++) rows.push([k, +(out[k].a / Math.max(1, out[k].n)).toFixed(3), +(100 * out[k].open / out[k].all).toFixed(1)]);
      return { rows, journey: !!JO, sprites: sub.levelSprites.length, under: sub.levelSprites.filter((q) => q.under).length };
    });
    console.log(`${arg}: ${r.sprites} sprites (${r.under} stitch)${r.journey ? '' : ' — free layout: open% not known, solidity over all cells'}`);
    for (const [k, sol, op] of r.rows) console.log(`  offset ${String(k).padStart(3)}  closed solidity ${sol.toFixed(3)}  ${'#'.repeat(Math.round(sol * 40)).padEnd(40)}  open ${op}%`);
    await b.ctx.close();
  } finally { await E.close(); }
})();
