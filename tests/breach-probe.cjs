/* WHAT DOES THE BREACH DISC ACTUALLY COST, AT THE REAL ORGANISM SCALE?
 *
 *     node tests/breach-probe.cjs
 *
 * Prints numbers, not PASS/FAIL, and is not in the runner. Written to answer one balance question
 * about `trichoderma.firstTouchRadius` (contact infects every clean strand in a disc, not just the
 * nearest one): does that make a cloud's touch materially more lethal, or is it the cosmetic fix it
 * was asked for? Averaged over six contact points spread through one grown colony.
 *
 * Measured on two boots, ~1000-strand colonies, median segment 25.5 units (i.e. growth.scale 1.5 —
 * the real thing), at the shipped firstTouchRings of 12:
 *
 *     radius 0 (the cloud's own reach)  ->  25/34 seeds, 30% / 39% of the colony claimed
 *     radius 1.5 (shipped)              ->  48/64 seeds, 37% / 48%
 *     radius 3.0                        -> 155/180 seeds, 55% / 66%
 *
 * So the shipped disc costs about SEVEN TO NINE POINTS more of the colony than a cloud-reach-only
 * breach — a real increase, well short of proportional: 48 seeds do not claim 48 × 12 rings,
 * because they sit within a couple of segments of each other and their ring walks are largely the
 * same ground (and every seed is marked infected before any walk runs, so a walk that meets
 * another seed stops rather than re-claiming what that seed covers itself). Turn the radius up and
 * it does bite: 3 cells takes about two thirds of the colony on one touch.
 *
 * TWO TRAPS THIS EXISTS BECAUSE OF:
 *
 *   1. `infect-probe`'s colony is a hand-built fan with 4-UNIT spacing, against the real 25.5-unit
 *      segment. A 54-unit disc covers ~6 strands along a real filament and ~27 along that one, so
 *      that probe reports the disc claiming 42-94% of its colony and OVERSTATES it by roughly an
 *      order of magnitude. Any geometric rule has to be measured on tissue at the real scale.
 *   2. The plain `grow` action refuses with "No food within sensing range", so a probe that grows
 *      by calling it 26 times measures a 3-STRAND colony and reports 100% for every setting. A
 *      directional grow CARD (Rhizomorph Lance) grows into open ground and is the way to build a
 *      real colony from a test.
 *
 * A THIRD TRAP, found while writing it: `freshGrowthRings` has to be turned OFF or the rows are not
 * comparable to each other. `tickWorld` moves `net._turnStartId` to `nextNodeId` at its END, so
 * every strand counts as "grown this step" for the FIRST measured breach and none of them for the
 * rest — which read as radius 0 claiming 130 strands and radius 1.5 claiming 50, i.e. the disc
 * making a breach smaller. It is off here, along with the established race, so what each row shows
 * is the disc plus its ring walks and nothing else.
 *
 * Expect spread between boots: the map is seeded from Date.now(), so the colony's shape and which
 * strands the six points land on both change. Read the radius comparison WITHIN one run.
 */
const http = require('http'), fs = require('fs'), path = require('path');
const { chromium } = require('playwright');
const ROOT = process.env.MYC_ROOT || '/home/user/myceliumRT';
const T = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.png': 'image/png', '.webp': 'image/webp', '.mp3': 'audio/mpeg', '.wav': 'audio/wav' };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const srv = await new Promise((r) => { const s = http.createServer((rq, rs) => { let p = decodeURIComponent(rq.url.split('?')[0].split('#')[0]); if (p === '/') p = '/index.html'; const fp = path.join(ROOT, p); if (!fs.existsSync(fp) || fs.statSync(fp).isDirectory()) { rs.writeHead(404); rs.end('nf'); return; } rs.writeHead(200, { 'Content-Type': T[path.extname(fp)] || 'application/octet-stream' }); fs.createReadStream(fp).pipe(rs); }); s.listen(0, () => r(s)); });
  const b = await chromium.launch({ headless: true, executablePath: '/opt/pw-browsers/chromium' });
  const ctx = await b.newContext({ viewport: { width: 1400, height: 800 } });
  await ctx.addInitScript(() => { window.MYCELIUM_SUPABASE = { url: '', anonKey: '' }; });
  const p = await ctx.newPage();
  p.on('pageerror', (e) => console.log('PAGEERROR:', String(e).slice(0, 200)));
  await p.goto('http://localhost:' + srv.address().port + '/index.html#dev,turn', { waitUntil: 'domcontentloaded' });
  await p.waitForSelector('#loadscreen.ld-ready', { timeout: 60000 }).catch(() => {});
  await p.click('#loadscreen', { timeout: 5000 }).catch(() => {});
  await p.waitForFunction(() => window.__game && window.__game.state && window.__game.state.active, null, { timeout: 60000 }).catch(() => {});
  for (let i = 0; i < 6 && await p.$('#levelIntro'); i++) { await p.mouse.click(1100, 300); await sleep(300); }

  const R = await p.evaluate(() => {
    const G = window.__game, s = G.state, sub = s.substrate, net = s.active, cs = sub.cellSize;
    const t = s.config.trichoderma;
    s.nematodes.length = 0; s.clouds.length = 0; if (s.ants) s.ants.length = 0;
    // --- a real colony, grown by a directional card (see trap 2 in the header) ---
    const C = s.cards;
    for (let i = 0; i < 26; i++) {
      net.energy = 1e6; net.water = 999; net.phosphorus = 999;
      s.runOver = false; s.winPending = false; net.alive = true;
      const fp = net.frontierPoint() || net.nodes[0];
      const ang = (i % 5 - 2) * 0.5 + Math.PI / 2;                 // fan downward
      C.hand.push({ id: C.seq++, name: 'Rhizomorph Lance' });
      G.play(C.hand.length - 1, { x: fp.x + Math.cos(ang) * 300, y: fp.y + Math.sin(ang) * 300, srcX: fp.x, srcY: fp.y });
      G.settleEnemyTurn();
    }
    for (const n of net.nodes) { n._liveAt = 0; n.infected = false; n.rotAge = 0; }
    for (const c of sub.cells) { c.trich = 0; c.mouldProof = 0; c.reinfectGrace = 0; }

    // The segment length is the whole point of this probe — print it, so a future reader can see
    // at a glance whether the colony was at the real scale or a hand-built toy.
    const segs = [];
    for (const n of net.nodes) { if (n.parentId == null) continue; const q = net.byId.get(n.parentId); if (q) segs.push(Math.hypot(n.x - q.x, n.y - q.y)); }
    segs.sort((a, b) => a - b);

    const life = t.rotLifeTurns, rings0 = t.firstTouchRings, depth = t.spreadDepthPerTurn,
          speed = t.moveSpeed, rad0 = t.firstTouchRadius;
    t.rotLifeTurns = 999;          // nothing may fall away mid-measure
    t.spreadDepthPerTurn = 0;      // the established race is not what is being attributed
    t.moveSpeed = 0;               // tickWorld creeps the clouds BEFORE the contact pass
    const fresh = t.freshGrowthRings; t.freshGrowthRings = 0;   // see trap 3 — otherwise row 1 alone gets it
    const rows = [];
    for (const rad of [0, 1.5, 3]) {
      for (const ftr of [0, 12]) {
        let inf = 0, seeds = 0, trials = 0;
        for (let k = 1; k <= 6; k++) {
          for (const n of net.nodes) { n.infected = false; n.rotAge = 0; n._infSeed = false; }
          t.firstTouchRadius = rad; t.firstTouchRings = ftr;
          const target = net.nodes[Math.floor(net.nodes.length * k / 7)];
          s.clouds.length = 0;
          s.clouds.push({ cx: target.x, cy: target.y, r: 1.05, strength: 1, dying: false, heading: null });
          s.runOver = false; s.winPending = false; net.alive = true; net._spreadAccum = 0;
          G.tickWorld(s);
          inf += net.nodes.filter((x) => x.infected).length;
          seeds += net.nodes.filter((x) => x._infSeed).length;
          trials++;
        }
        rows.push({ radiusCells: rad, firstTouchRings: ftr, avgSeeds: +(seeds / trials).toFixed(1),
                    avgClaimed: Math.round(inf / trials), of: net.nodes.length,
                    pct: Math.round(100 * inf / trials / net.nodes.length) });
      }
    }
    t.rotLifeTurns = life; t.firstTouchRings = rings0; t.spreadDepthPerTurn = depth;
    t.moveSpeed = speed; t.firstTouchRadius = rad0; t.freshGrowthRings = fresh;
    return { strands: net.nodes.length, medianSegment: +segs[Math.floor(segs.length / 2)].toFixed(1),
             cellSize: cs, cloudRadiusCells: 1.05, rows };
  });

  console.log(`colony ${R.strands} strands · median segment ${R.medianSegment} units · cell ${R.cellSize} · cloud r ${R.cloudRadiusCells} cells`);
  console.log('(6 contact points averaged; established race + fresh-growth claim off, rot held, cloud pinned)\n');
  console.log('radius(cells)  rings   seeds   claimed   of      %');
  for (const r of R.rows) {
    console.log(`  ${String(r.radiusCells).padEnd(12)} ${String(r.firstTouchRings).padStart(3)}   ` +
                `${String(r.avgSeeds).padStart(6)}  ${String(r.avgClaimed).padStart(7)}   ${String(r.of).padStart(4)}   ${String(r.pct).padStart(3)}%`);
  }
  await b.close(); srv.close();
})();
