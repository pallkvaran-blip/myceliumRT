/* CHUNK GENERATION COST (M7 verifier round 3) — a tool: prints, never fails, not in the runner.
 *   NODE_PATH=/opt/node22/lib/node_modules node tests/chunkgen-probe.cjs [route ...]   (default: leg,1 leg,2 leg,3 mine,4242)
 * `mineEnsureChunks` generates a chunk SYNCHRONOUSLY on the frame the colony's pad or the camera
 * crosses into it, so a chunk's generation time is a hitch on the frame the player is watching. This
 * boots each route, then asks for one new chunk at a time (walking east, then west, from the chunks
 * that exist at boot) and times each `ensureChunks` call with performance.now — generation only; the
 * stamp (`solidifyMineRock`) runs on a later frame and is not in these numbers. Headless desktop CPU:
 * a phone is several times slower, so read the ratio to the free layout as much as the milliseconds.
 * Env: REPS (default 1) boots each route that many times; FILE serves another page (a snapshot).
 * PLAY=1 measures the FRAME LOOP instead: it digs east along the surface band for PLAY_DIGS (40) digs
 * with frames running between them (threats out, tank topped up) and prints `__game.mine.genLog()` —
 * one entry per frame that generated a chunk: how many it made (the cap is 1), how long, and whether it
 * was the idle lookahead (made while no finger was down and no grow arriving) or a chunk needed now. */
const H = require('./mine-harness.cjs');
const routes = process.argv.slice(2).length ? process.argv.slice(2) : ['leg,1,1', 'leg,1,2', 'leg,1,3', 'mine,4242'];
(async () => {
  const E = await H.start();
  try {
    for (const route of routes) {
      const all = [];
      for (let rep = 0; rep < (+process.env.REPS || 1); rep++) {
        const b = await E.boot('#' + route, 390, 844, process.env.FILE ? { file: process.env.FILE } : {});
        await b.page.waitForFunction(() => !!(window.__game && window.__game.state && window.__game.state.substrate && window.__game.state.substrate._fineSolid), { timeout: 40000 });
        if (process.env.PLAY) {
          const r = await b.page.evaluate(async (nDigs) => {
            const g = window.__game, s = g.state, sub = s.substrate, cs = sub.cellSize, net = s.active;
            const sleep = (ms) => new Promise((q) => setTimeout(q, ms));
            for (let i = 0; i < 80 && !g.mine.genLog().length; i++) await sleep(50);
            const boot = g.mine.genLog().length;
            let digs = 0;
            for (let i = 0; i < nDigs && !s.runOver; i++) {
              s.nematodes.length = 0; s.clouds.length = 0; net.water = 999;
              let tip = null; for (const n of net.nodes) if (!n.infected && (!tip || n.x > tip.x)) tip = n;
              const rr = g.mine.growFrom(tip.x, tip.y, tip.x + 160, tip.y + 20 * Math.sin(i));
              if (rr && rr.ok) digs++;
              await sleep(700);
            }
            return { boot, digs, east: Math.max(...net.nodes.map((n) => n.x)) / cs | 0, log: g.mine.genLog() };
          }, +process.env.PLAY_DIGS || 40);
          all.push(...r.log.map((e) => e.ms));
          const need = r.log.filter((e) => !e.ahead), ahead = r.log.filter((e) => e.ahead);
          console.log(`#${route} play: ${r.digs} digs to col ${r.east}; ${r.log.length} generating frames (max ${Math.max(0, ...r.log.map((e) => e.made))} chunks in one), ${ahead.length} idle lookahead / ${need.length} needed now; needed ms [${need.map((e) => e.ms).join(' ')}]`);
          await b.ctx.close();
          continue;
        }
        const t = await b.page.evaluate(() => {
          const g = window.__game, s = g.state, sub = s.substrate, cs = sub.cellSize, cw = s.config.mine.chunkCols;
          const n = Math.ceil(sub.cols / cw), have = g.mine.chunks().map(Number);
          const lo = Math.min(...have), hi = Math.max(...have), order = [];
          for (let c = hi + 1; c < n; c++) order.push(c);
          for (let c = lo - 1; c >= 0; c--) order.push(c);
          const out = [];
          for (const ci of order) {
            const x = (ci * cw + cw / 2) * cs;
            const t0 = performance.now();
            g.mine.ensureChunks(x, x + 1);
            out.push(+(performance.now() - t0).toFixed(1));
          }
          return out;
        });
        all.push(...t);
        if (b.errs.length) console.log('  page errors:', b.errs.slice(0, 2));
        await b.ctx.close();
      }
      const srt = all.slice().sort((a, b) => a - b), q = (p) => srt[Math.min(srt.length - 1, Math.floor(p * srt.length))];
      console.log(`#${route}: ${all.length} chunks  median ${q(0.5)} ms  p90 ${q(0.9)}  max ${srt[srt.length - 1]}   [${all.join(' ')}]`);
    }
  } finally { await E.close(); }
})();
