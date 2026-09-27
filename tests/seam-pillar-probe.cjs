/* SEAM PILLAR PROBE (M7 verifier round 2) — a tool: prints, never fails, not in the runner.
 *   NODE_PATH=/opt/node22/lib/node_modules node tests/seam-pillar-probe.cjs [legs=1,2,3]
 * "Does a chunk seam read as a COLUMN?", on the DRAWN map (the fine mask, i.e. sprite alpha). For a
 * vertical line, a row is a PILLAR row when the two cells either side of the line are mostly rock
 * (> 0.55 solid) while the ground 3-5 cells out on BOTH sides is mostly soil (< 0.25): a free-standing
 * strip of rock on the line. Printed per line (mean over lines) for every chunk seam and, as the
 * reference, for two interior lines per chunk (columns 8 and 16) — a seam that reads as ordinary rock
 * scores like an interior line. Also the carve-level count (closed run <= 6 wide around the line,
 * bounded by open ground both sides), which says whether a pillar is the CARVE's shape or the rock's.
 * `spine`: rows where the line's two cells are > 0.3 more solid than the denser flank — a dense stripe
 * inside porous rock, which reads as a line even with rock either side. */
const H = require('./mine-harness.cjs');
const LP = require('./bots/legprobe.cjs');
(async () => { const E = await H.start(); try {
  for (const leg of (process.argv[2] || '1,2,3').split(',').map(Number)) {
    const b = await LP.openLeg(E, leg);
    await LP.world(b.page);
    const r = await b.page.evaluate(() => {
      const g = window.__game, s = g.state, sub = s.substrate, cs = sub.cellSize, cw = s.config.mine.chunkCols, rows = sub.rows;
      const fsz = sub._fineSize, W = sub._fineCols, fs = sub._fineSolid, K = Math.round(cs / fsz);
      const JO = sub.mineJourney._open, cis = g.mine.chunks().sort((a, b) => a - b);
      const openAt = (c, r) => { const ci = Math.floor(c / cw), o = JO[ci]; if (!o) return false; const Wc = o.length / rows; return !!o[r * Wc + (c - ci * cw)]; };
      const sol = (ca, cb, r) => { let n = 0, t = 0; for (let y = r * K; y < r * K + K; y++) for (let x = ca * K; x < (cb + 1) * K; x++) { t++; if (fs[y * W + x]) n++; } return n / t; };
      const stat = (L) => {
        let drawn = 0, dRun = 0, dLong = 0, dMax = 0, carve = 0, spine = 0, sRun = 0, sLong = 0;
        for (let r = 3; r < rows - 6; r++) {
          const mid = sol(L - 1, L, r), fl = sol(L - 5, L - 3, r), fr = sol(L + 2, L + 4, r);
          const p = mid > 0.55 && fl < 0.25 && fr < 0.25;
          if (mid - Math.max(fl, fr) > 0.3) { spine++; sRun++; } else { if (sRun >= 6) sLong += sRun; sRun = 0; }
          if (p) { drawn++; dRun++; dMax = Math.max(dMax, dRun); } else { if (dRun >= 6) dLong += dRun; dRun = 0; }
          if (!openAt(L - 1, r) && !openAt(L, r)) { let a = L - 1; while (a - 1 >= L - 8 && !openAt(a - 1, r)) a--; let bb = L; while (bb + 1 <= L + 7 && !openAt(bb + 1, r)) bb++;
            if (bb - a + 1 <= 6 && openAt(a - 1, r) && openAt(bb + 1, r)) carve++; }
        }
        if (dRun >= 6) dLong += dRun;
        if (sRun >= 6) sLong += sRun;
        return { drawn, dLong, dMax, carve, spine, sLong };
      };
      const agg = (ls) => { const o = { drawn: 0, dLong: 0, dMax: 0, carve: 0, spine: 0, sLong: 0 }; for (const L of ls) { const t = stat(L); o.drawn += t.drawn; o.dLong += t.dLong; o.carve += t.carve; o.spine += t.spine; o.sLong += t.sLong; o.dMax = Math.max(o.dMax, t.dMax); }
        const f = (v) => +(v / ls.length).toFixed(1);
        return { lines: ls.length, drawn: f(o.drawn), inRuns6: f(o.dLong), longest: o.dMax, carve: f(o.carve), spine: f(o.spine), spineRuns6: f(o.sLong) }; };
      const seams = [], mids = [];
      for (const ci of cis) { if (cis.includes(ci - 1)) seams.push(ci * cw); if (cis.includes(ci - 1) && cis.includes(ci + 1)) mids.push(ci * cw + 8, ci * cw + 16); }
      return { seam: agg(seams), interior: agg(mids) };
    });
    console.log(`leg ${leg}  pillar rows per line (drawn / in runs >= 6 / longest run / carve-level):`);
    console.log(`   seams    ${JSON.stringify(r.seam)}`);
    console.log(`   interior ${JSON.stringify(r.interior)}`);
    await b.ctx.close();
  }
} finally { await E.close(); } })();
