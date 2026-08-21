/* IS THERE A CONTINUOUS ROCK-FREE CORRIDOR RUNNING THE DEPTH OF THE MINE? A measuring tool, not a
 * check — it prints and never fails, and it is not in the runner.
 *
 * It exists because the owner reported the same defect TWICE and a diff could not show it either
 * time: "there is still a vertical line from where the colony starts, straight down, that is totally
 * void of rocks", and then, after the shaft was made to wander, "that corridor is still there, just
 * not directly below the colony anymore." Rock is only placed where the carve left ground CLOSED, so
 * any reserved full-depth shaft — plumb or snaking — is a guaranteed rock-free line down the map.
 *
 * TWO READINGS, and the second is the one that caught the second report:
 *   · the DRAWN mask along the start column, row by row. A reserved plumb shaft reads 0 of 168 rows
 *     solid; with the shaft merely wandering it read 47-69 of 168, which looks fixed and is not.
 *   · the LONGEST UNBROKEN VERTICAL RUN of open ground anywhere in the streamed world. This is the
 *     honest question: a corridor that snakes still runs the whole depth, and only this sees it.
 *
 * Measured on `mineHomeCol`, and on the fine mask (`solidAtWorld`) rather than `cell.rock`, because
 * the coarse flag is not what growth is tested against and a sprite overhangs its cells.
 *
 *   NODE_PATH=/opt/node22/lib/node_modules node tests/void-probe.cjs [seed]
 */
const http = require('http'), fs = require('fs'), path = require('path');
const { chromium } = require('playwright');
const ROOT = path.resolve(__dirname, '..');
const T = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.png': 'image/png',
  '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.webp': 'image/webp', '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav', '.css': 'text/css' };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const srv = http.createServer((rq, rs) => {
    const u = decodeURIComponent(rq.url.split('?')[0]);
    const f = path.join(ROOT, u === '/' ? 'index.html' : u);
    fs.readFile(f, (e, d) => e ? (rs.writeHead(404), rs.end())
      : (rs.writeHead(200, { 'Content-Type': T[path.extname(f)] || 'application/octet-stream' }), rs.end(d)));
  }).listen(0);
  const port = srv.address().port;
  const br = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const ctx = await br.newContext({ viewport: { width: 390, height: 844 } });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => console.log('PAGEERROR:', e.message));
  await page.addInitScript(() => { window.MYCELIUM_SUPABASE = { url: '', anonKey: '' }; });
  const seed = process.argv[2] || 4242;
  await page.goto(`http://127.0.0.1:${port}/index.html#mine,${seed}`);
  await page.waitForSelector('#loadscreen.ld-ready', { timeout: 40000 }).catch(() => {});
  await page.click('#loadscreen', { timeout: 5000 }).catch(() => {});
  await page.waitForFunction(() => !!(window.__game && window.__game.state
    && window.__game.state.substrate && window.__game.state.substrate.mine), { timeout: 40000 });
  await page.waitForFunction(() => !!window.__game.state.substrate._fineSolid, { timeout: 20000 });
  await sleep(1500);

  const r = await page.evaluate(() => {
    const g = window.__game, s = g.state, sub = s.substrate;
    const home = sub.mineHomeCol != null ? sub.mineHomeCol : (sub.cols >> 1);
    const solidAt = (c, r2) => sub.solidAtWorld((c + 0.5) * sub.cellSize,
                                                sub.surfaceY + (r2 + 0.5) * sub.cellSize);
    // 1. the start column, row by row
    const col = [];
    for (let r2 = 0; r2 < sub.rows; r2++) col.push(solidAt(home, r2) ? 1 : 0);
    // 2. the longest unbroken vertical run of open ground, over the GENERATED columns only —
    //    ungenerated chunks are empty and would read as one enormous void.
    const cis = g.mine.chunks();
    const cc = s.config.mine.chunkCols;
    const lo = Math.min(...cis) * cc, hi = (Math.max(...cis) + 1) * cc - 1;
    let worst = 0, worstCol = -1;
    const runs = [];
    for (let c = lo; c <= hi; c++) {
      let run = 0, best = 0;
      for (let r2 = 0; r2 < sub.rows; r2++) {
        if (solidAt(c, r2)) run = 0;
        else { run++; if (run > best) best = run; }
      }
      runs.push(best);
      if (best > worst) { worst = best; worstCol = c; }
    }
    runs.sort((a, b) => b - a);
    // 3. THE LONGEST CONTINUOUSLY-DESCENDING OPEN PATH, allowing a step sideways per row. This is the
    //    reading that matters and the per-column one above is a trap: a shaft that WANDERS has short
    //    per-column runs and is still a corridor running the whole map, so the first version of this
    //    probe reported the same 61 rows before and after the wander was added and could not see the
    //    defect it was written for. A staircase is what a chute actually is.
    //    ...AND RESTRICTED BY WIDTH, which is what separates a CORRIDOR from a maze route. An
    //    unrestricted staircase reads 168 of 168 on any solvable map — it threads the galleries and
    //    links, which is the maze working, not a chute. What the eye reads as a corridor is a channel
    //    WIDE enough to see along: a carved shaft is ~3 cells across, a maze passage squeezes to one.
    //    So the path may only use cells whose left and right neighbours are open too.
    const H = sub.rows, Wc = hi - lo + 1;
    const wide = (i, r2) => !solidAt(lo + i, r2)
      && !solidAt(lo + Math.max(0, i - 1), r2) && !solidAt(lo + Math.min(Wc - 1, i + 1), r2);
    const stairFor = (okAt) => {
      let prev = new Int16Array(Wc), cur = new Int16Array(Wc), best = 0;
      for (let r2 = 0; r2 < H; r2++) {
        for (let i = 0; i < Wc; i++) {
          if (!okAt(i, r2)) { cur[i] = 0; continue; }
          let b = 0;
          for (const di of [-1, 0, 1]) {
            const j = i + di;
            if (j >= 0 && j < Wc && prev[j] > b) b = prev[j];
          }
          cur[i] = b + 1;
          if (cur[i] > best) best = cur[i];
        }
        const t = prev; prev = cur; cur = t;
      }
      return best;
    };
    const stair = stairFor((i, r2) => !solidAt(lo + i, r2));
    const stairWide = stairFor(wide);
    return { stair, stairWide, home, col, rows: sub.rows, worst, worstCol, lo, hi,
             top: runs.slice(0, 8), median: runs[runs.length >> 1],
             repairs: (() => {
               const mc = s.mineChunks;
               const list = mc instanceof Map ? [...mc.values()] : Object.values(mc || {});
               return list.filter(Boolean).map((p) => p.repairs | 0);
             })() };
  });

  const solidRows = r.col.reduce((a, b) => a + b, 0);
  console.log(`=== seed ${seed}, home column ${r.home}, generated cols ${r.lo}..${r.hi} ===`);
  console.log(`start column: rock across it on ${solidRows} of ${r.rows} rows`);
  console.log(`LONGEST DESCENDING **WIDE** CHANNEL: ${r.stairWide} of ${r.rows} rows  <-- the real reading`);
  console.log(`  (any-width descending path: ${r.stair} of ${r.rows} — 168 on any solvable map, so not the question)`);
  console.log(`longest unbroken run in ONE column: ${r.worst} of ${r.rows} (col ${r.worstCol})`);
  console.log(`  top runs ${r.top.join(', ')}   median column ${r.median}`);
  console.log(`descent repairs opened per chunk: [${r.repairs.join(', ')}]`);
  let line = '';
  for (const v of r.col) line += v ? '#' : '.';
  console.log('start column, top to bottom (# rock, . open):');
  for (let i = 0; i < line.length; i += 42) console.log('  r' + String(i).padStart(3) + ' ' + line.slice(i, i + 42));
  await br.close(); srv.close();
})();
