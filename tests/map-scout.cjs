/* map-scout — an AUTHORING tool, not a check. Prints what a level's collision actually is,
 * so objects can be placed against the mask the game collides on rather than against the
 * bounding boxes in the JSON.
 *
 *   node tests/map-scout.cjs obsidian-c40
 *   node tests/map-scout.cjs obsidian-c40 --los 900,700 1800,900   # can A see B?
 *
 * WHY IT EXISTS. A rock's entry in docs/levels/*.json is a BOUNDING BOX, and the sprite
 * inside it is mostly transparent — so reading the JSON overstates rock badly and picking a
 * spot from it lands objects inside walls or in sealed pockets. Worse, the two errors point
 * opposite ways: a bbox says "solid" where the mask is open (so you skip good ground) and
 * says nothing about the thin tapered edges where a sight ray actually grazes. There is no
 * way to place a threat-and-its-target pair honestly without asking the built mask.
 *
 * Everything here reads `substrate._fineSolid` — the 9px grid stamped from each sprite's
 * ALPHA, which is what growth and line-of-sight both test (solidAtWorld). The ASCII grid is
 * per 36px CELL, shaded by how much of that cell is solid underneath, because a cell is the
 * unit food and cloud radii are written in.
 *
 * The --los pairs are the load-bearing part for threat placement. "Sensing range" is within
 * sightRadius AND segmentClear, so a cloud parked 400 units from a pile it cannot see will
 * sit there forever — a silent dead level. Ask before placing, not after playtesting.
 */
const http = require('http'), fs = require('fs'), path = require('path');
const { chromium } = require('playwright');
const ROOT = path.resolve(__dirname, '..');
const T = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.webp': 'image/webp', '.mp3': 'audio/mpeg', '.wav': 'audio/wav' };

const args = process.argv.slice(2);
const ids = args.filter((a) => !a.startsWith('-') && !/^\d+(\.\d+)?,\d+/.test(a));
const losRaw = [];
for (let i = 0; i < args.length; i++) if (args[i] === '--los') { losRaw.push(args[i + 1], args[i + 2]); i += 2; }
const losPts = losRaw.filter(Boolean).map((s) => { const [x, y] = s.split(',').map(Number); return { x, y }; });

if (!ids.length) { console.error('usage: node tests/map-scout.cjs <level-id> [--los x,y x,y]'); process.exit(1); }

(async () => {
  const srv = await new Promise((res) => { const s = http.createServer((rq, rs) => { let p = decodeURIComponent(rq.url.split('?')[0].split('#')[0]); if (p === '/') p = '/index.html'; const fp = path.join(ROOT, p); if (!fp.startsWith(ROOT) || !fs.existsSync(fp) || fs.statSync(fp).isDirectory()) { rs.writeHead(404); rs.end('nf'); return; } rs.writeHead(200, { 'Content-Type': T[path.extname(fp)] || 'application/octet-stream' }); fs.createReadStream(fp).pipe(rs); }); s.listen(0, () => res(s)); });
  const base = 'http://localhost:' + srv.address().port;
  const browser = await chromium.launch({ headless: true });

  for (const id of ids) {
    const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
    await page.addInitScript(() => { window.MYCELIUM_SUPABASE = { url: '', anonKey: '' }; });
    await page.goto(base + '/index.html#level,' + id, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('#loadscreen.ld-ready', { timeout: 60000 }).catch(() => {});
    await page.click('#loadscreen', { timeout: 5000 }).catch(() => {});
    await page.waitForFunction(() => window.__game && window.__game.state && window.__game.state.active, null, { timeout: 30000 }).catch(() => {});
    // Until the mask solidifies EVERY wall reads as open, so nothing below means anything.
    const solid = await page.waitForFunction(() => window.__game.state.substrate._rockSolidified === true, null, { timeout: 60000 }).then(() => true).catch(() => false);

    const out = await page.evaluate((los) => {
      const g = window.__game, s = g.state, sub = s.substrate;
      const cs = sub.cellSize, fsz = sub._fineSize;
      const per = Math.max(1, Math.round(cs / fsz));           // fine cells per side of a cell
      const rows = [];
      // Solid FRACTION per coarse cell, straight off the fine mask — the shading is what
      // makes a thin tapered rock edge visible, and edges are where sight rays graze.
      const frac = [];
      for (let r = 0; r < sub.rows; r++) {
        let line = '';
        for (let c = 0; c < sub.cols; c++) {
          let hit = 0, tot = 0;
          for (let fr = 0; fr < per; fr++) for (let fc = 0; fc < per; fc++) {
            const x = c * cs + (fc + 0.5) * fsz, y = sub.surfaceY + r * cs + (fr + 0.5) * fsz;
            tot++; if (sub.solidAtWorld(x, y)) hit++;
          }
          const f = hit / tot; frac.push(f);
          const cell = sub.cellAt(c, r);
          line += cell && cell.water ? '~' : cell && cell.maxNutrient > 0 ? '$'
            : f > 0.85 ? '#' : f > 0.5 ? '=' : f > 0.15 ? '-' : cell && cell.pathClear ? ':' : '.';
        }
        rows.push(line);
      }
      // Connected OPEN pockets, coarse — where an object can actually go. Reported by area
      // so a sealed one-cell dimple doesn't read as somewhere to put a pile.
      const openAt = (c, r) => c >= 0 && r >= 0 && c < sub.cols && r < sub.rows && frac[r * sub.cols + c] <= 0.15;
      const seen = new Int32Array(sub.cols * sub.rows).fill(-1);
      const pockets = [];
      for (let r = 0; r < sub.rows; r++) for (let c = 0; c < sub.cols; c++) {
        if (!openAt(c, r) || seen[r * sub.cols + c] >= 0) continue;
        const gi = pockets.length, q = [[c, r]]; seen[r * sub.cols + c] = gi;
        const cells = [];
        while (q.length) {
          const [cc, rr] = q.pop(); cells.push([cc, rr]);
          for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
            const nc = cc + dc, nr = rr + dr;
            if (!openAt(nc, nr) || seen[nr * sub.cols + nc] >= 0) continue;
            seen[nr * sub.cols + nc] = gi; q.push([nc, nr]);
          }
        }
        let sc = 0, sr = 0, c0 = 1e9, c1 = -1, r0 = 1e9, r1 = -1;
        for (const [cc, rr] of cells) { sc += cc; sr += rr; c0 = Math.min(c0, cc); c1 = Math.max(c1, cc); r0 = Math.min(r0, rr); r1 = Math.max(r1, rr); }
        pockets.push({ n: cells.length, col: Math.round(sc / cells.length), row: Math.round(sr / cells.length), c0, c1, r0, r1 });
      }
      pockets.sort((a, b) => b.n - a.n);

      // `state.active` IS the live network — there is no `activeIndex`, and reading one gives
      // undefined and a silent "root=none" that looks like the colony failed to seed.
      const net = s.active;
      const root = net && net.root ? { x: Math.round(net.root.x), y: Math.round(net.root.y) } : null;
      const cfg = s.config;
      const losOut = [];
      for (let i = 0; i + 1 < los.length; i += 2) {
        const a = los[i], b = los[i + 1];
        losOut.push({
          a, b, dist: Math.round(Math.hypot(b.x - a.x, b.y - a.y)),
          clear: sub.segmentClear(a.x, a.y, b.x, b.y),
          aSolid: sub.solidAtWorld(a.x, a.y), bSolid: sub.solidAtWorld(b.x, b.y),
        });
      }
      return {
        rows, cols: sub.cols, nrows: sub.rows, cs, fsz, surfaceY: sub.surfaceY,
        startCols: sub.startCols, goalStart: sub.cols - 6, root,
        sight: { cloud: cfg.trichoderma.sightRadius, worm: cfg.nematodes.sightRadius },
        coreY: sub.coreY == null ? null : sub.coreY,
        pockets: pockets.slice(0, 8),
        sprites: sub.levelSprites.length,
        piles: sub.foodPiles.map((p) => ({ kind: p.kind, n: p.cells.length, energy: p.energyValue })),
        threats: { clouds: s.clouds.length, worms: s.nematodes.length, ants: s.ants ? s.ants.length : 0 },
        los: losOut,
      };
    }, losPts);

    console.log(`\n=== ${id} ===  mask ${solid ? 'solidified' : 'NOT SOLIDIFIED — readings below are meaningless'}`);
    console.log(`${out.cols}x${out.nrows} cells @ ${out.cs}px  (fine ${out.fsz}px)  surfaceY=${out.surfaceY}  coreY=${out.coreY}  sprites=${out.sprites}`);
    console.log(`entry channel cols 0..${out.startCols}   goal channel cols ${out.goalStart}..${out.cols - 1}   root=${out.root ? out.root.x + ',' + out.root.y : 'none'}`);
    console.log(`sight: cloud ${out.sight.cloud}  worm ${out.sight.worm} world units  (= ${(out.sight.cloud / out.cs).toFixed(1)} cells)`);
    console.log(`placed: ${out.threats.clouds} clouds, ${out.threats.worms} worms, ${out.threats.ants} ants, ${out.piles.length} piles ${JSON.stringify(out.piles)}`);
    console.log('  # >85% solid   = >50%   - >15%   . open   : channel   ~ water   $ food');
    // Column ruler in TENS, so a spot read off the grid converts to world units by eye:
    // x = col*cs + cs/2, y = surfaceY + row*cs + cs/2.
    let ruler = '     ';
    for (let c = 0; c < out.cols; c++) ruler += c % 10 === 0 ? String((c / 10) % 10) : ' ';
    console.log(ruler);
    out.rows.forEach((line, r) => console.log(String(r).padStart(4) + ' ' + line));
    console.log('  biggest open pockets (coarse cells) — col,row centre and cell bounds:');
    for (const p of out.pockets) console.log(`    ${String(p.n).padStart(5)} cells  centre col ${p.col} row ${p.row}  ->  x=${p.col * out.cs + out.cs / 2} y=${out.surfaceY + p.row * out.cs + out.cs / 2}   cols ${p.c0}..${p.c1} rows ${p.r0}..${p.r1}`);
    for (const l of out.los) console.log(`  LOS ${l.a.x},${l.a.y} -> ${l.b.x},${l.b.y}: dist ${l.dist}  clear=${l.clear}${l.aSolid ? '  [A IS INSIDE ROCK]' : ''}${l.bSolid ? '  [B IS INSIDE ROCK]' : ''}`);
    await page.close();
  }
  await browser.close();
  srv.close();
})();
