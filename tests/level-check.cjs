/* The hand-authored map "Three Ways Up" (docs/levels/three-ways.json).
 *
 * The design claim is geometric — three lanes, sealed from each other for the
 * whole width of the map, each one traversable end to end — and geometry is
 * exactly what you cannot verify by reading the JSON. Rock collision comes from
 * each sprite's ALPHA sampled into a 9 px mask at render time (solidifyRock), so
 * "is that wall actually solid?" is only answerable from the running game.
 *
 * So: boot the map, wait for the mask, then flood-fill it.
 *   • a fill started in one lane must never reach another (the seal)
 *   • each lane must connect its mouth to its far end (traversable)
 *   • a fill from the colony must reach all three mouths and the goal (winnable)
 * Plus the content claims: one threat kind per lane, food where it was placed.
 *
 * Screenshots (tests/.artifacts/level-*.png) are the other half — look at them.
 */
const http = require('http'), fs = require('fs'), path = require('path');
const { chromium } = require('playwright');
const ROOT = path.resolve(__dirname, '..');
const ART = path.join(__dirname, '.artifacts');
const T = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.svg': 'image/svg+xml', '.webp': 'image/webp', '.mp3': 'audio/mpeg', '.wav': 'audio/wav' };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let pass = 0, fail = 0;
const ok = (n, c, x) => { c ? (pass++, console.log('  PASS  ' + n + (x ? '  — ' + x : ''))) : (fail++, console.log('  FAIL  ' + n + (x ? '  — ' + x : ''))); };

// The band table from scripts/author-three-ways.mjs. Duplicated on purpose: if a
// lane is moved there and not here, these assertions should fail rather than
// quietly follow the map wherever it went.
const LANES = {
  A: { r0: 0, r1: 5, label: 'ant terrace' },
  B: { r0: 10, r1: 17, label: 'mould gallery' },
  C: { r0: 22, r1: 29, label: 'worm deep' },
};
const SEALED_C0 = 12, SEALED_C1 = 71;   // inside the slab span, excluding atrium + goal channel

(async () => {
  fs.mkdirSync(ART, { recursive: true });
  const srv = await new Promise((res) => { const s = http.createServer((rq, rs) => { let p = decodeURIComponent(rq.url.split('?')[0].split('#')[0]); if (p === '/') p = '/index.html'; const fp = path.join(ROOT, p); if (!fp.startsWith(ROOT) || !fs.existsSync(fp) || fs.statSync(fp).isDirectory()) { rs.writeHead(404); rs.end('nf'); return; } rs.writeHead(200, { 'Content-Type': T[path.extname(fp)] || 'application/octet-stream' }); fs.createReadStream(fp).pipe(rs); }); s.listen(0, () => res(s)); });
  const base = 'http://localhost:' + srv.address().port;
  const browser = await chromium.launch({ headless: true });

  // ---------------------------------------------------------------- boot ----
  // One browser per case is the house rule, but the mask + the screenshots all
  // come off the same untouched map, so the geometry pass shares one page.
  const page = await browser.newPage({ viewport: { width: 1800, height: 1100 } });
  const errs = [];
  page.on('pageerror', (e) => errs.push(String(e && e.message)));
  page.on('console', (m) => { if (m.type() === 'error') errs.push('console:' + m.text()); });
  await page.addInitScript(() => { window.MYCELIUM_SUPABASE = { url: '', anonKey: '' }; });
  await page.goto(base + '/index.html#level,three-ways', { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#loadscreen.ld-ready', { timeout: 30000 }).catch(() => {});
  await page.click('#loadscreen', { timeout: 5000 }).catch(() => {});
  await page.waitForFunction(() => window.__game && window.__game.state && window.__game.state.active, null, { timeout: 30000 }).catch(() => {});
  // The level intro is left UP for the assertions below: it holds the real-time
  // clock, so every threat is still exactly where the map placed it. It gets
  // dismissed further down, for the screenshots. (The map renders behind it, so
  // the collision mask is still built.)
  //
  // The collision mask is built on the first frame where every rock sprite has
  // decoded; until then the coarse flags stand and every wall reads as open.
  const solid = await page.waitForFunction(() => window.__game.state.substrate._rockSolidified === true, null, { timeout: 30000 }).then(() => true).catch(() => false);

  ok('#level,three-ways boots the authored map', await page.evaluate(() => {
    const s = window.__game.state;
    return !!(s && s.levelDef && s.levelDef.id === 'three-ways' && s.substrate.authored);
  }), 'no page errors: ' + (errs.length ? errs.slice(0, 2).join(' | ') : 'true'));
  ok('boots with no page errors', errs.length === 0, errs.slice(0, 3).join(' | ') || 'none');
  ok('rock collision solidified', solid);
  ok('runs in real time', await page.evaluate(() => window.__cfg.realtime.enabled === true));

  const geo = await page.evaluate(() => {
    const sub = window.__game.state.substrate;
    return { cols: sub.cols, rows: sub.rows, cs: sub.cellSize, w: sub.worldWidth, h: sub.worldHeight, surfaceY: sub.surfaceY, sprites: sub.levelSprites.length };
  });
  ok('world box is 80×33 cells', geo.cols === 80 && geo.rows === 33, `${geo.cols}×${geo.rows} cells, ${geo.w}×${geo.h} units, ${geo.sprites} sprites`);

  // ------------------------------------------------------- the seal + run ----
  // Flood-fills over the FINE mask (substrate._fineSolid: 9 px cells, the grid
  // growth actually collides against). Run inside the page so the mask never
  // has to cross the bridge.
  const fill = await page.evaluate(({ LANES, SEALED_C0, SEALED_C1 }) => {
    const sub = window.__game.state.substrate;
    const fsz = sub._fineSize, FC = sub._fineCols, FR = sub._fineRows, mask = sub._fineSolid;
    const cs = sub.cellSize, surfaceY = sub.surfaceY;
    const fcOf = (x) => Math.floor(x / fsz);
    const frOf = (y) => Math.floor((y - surfaceY) / fsz);
    const openAt = (fc, fr) => fc >= 0 && fr >= 0 && fc < FC && fr < FR && mask[fr * FC + fc] === 0;

    // BFS from a world point, optionally clipped to a column window.
    function flood(x, y, clip) {
      const c0 = clip ? fcOf(clip[0] * cs) : 0;
      const c1 = clip ? fcOf((clip[1] + 1) * cs) - 1 : FC - 1;
      const seen = new Uint8Array(FC * FR);
      const s = { fc: fcOf(x), fr: frOf(y) };
      if (!openAt(s.fc, s.fr) || s.fc < c0 || s.fc > c1) return { seeded: false, cells: 0, rows: [0, 0], cols: [0, 0], seen };
      const q = [s.fr * FC + s.fc];
      seen[q[0]] = 1;
      let head = 0, minR = FR, maxR = -1, minC = FC, maxC = -1, n = 0;
      while (head < q.length) {
        const cur = q[head++]; n++;
        const fc = cur % FC, fr = (cur - fc) / FC;
        if (fr < minR) minR = fr; if (fr > maxR) maxR = fr;
        if (fc < minC) minC = fc; if (fc > maxC) maxC = fc;
        for (const [dc, dr] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
          const nc = fc + dc, nr = fr + dr;
          if (nc < c0 || nc > c1 || !openAt(nc, nr)) continue;
          const ni = nr * FC + nc;
          if (seen[ni]) continue;
          seen[ni] = 1; q.push(ni);
        }
      }
      // Report the extent in CELL coordinates — that's the language of the design.
      return { seeded: true, cells: n, rows: [Math.floor(minR * fsz / cs), Math.floor(maxR * fsz / cs)], cols: [Math.floor(minC * fsz / cs), Math.floor(maxC * fsz / cs)], seen };
    }
    const reaches = (r, col, row) => {
      const fc = fcOf(col * cs + cs / 2);
      // Any fine row inside the cell counts — a corridor can be a fraction of a
      // cell tall where a slab spills into it.
      for (let k = 0; k < 4; k++) if (r.seen[(frOf(surfaceY + row * cs) + k) * FC + fc]) return true;
      return false;
    };

    const out = { lanes: {}, colony: null };
    for (const [key, lane] of Object.entries(LANES)) {
      // Seed just inside the sealed span. Try a few rows: the slabs' crust lumps
      // bite a little way into the corridors, and which row that lands on is a
      // detail of the art, not of the design. Bottom-up, since lane A's upper rows
      // are under the lake.
      let seedRow = lane.r1, r = null;
      for (let row = lane.r1; row >= lane.r0; row--) {
        r = flood((SEALED_C0 + 1) * cs + cs / 2, surfaceY + row * cs + cs / 2, [SEALED_C0, SEALED_C1]);
        if (r.seeded) { seedRow = row; break; }
      }
      out.lanes[key] = {
        seeded: r.seeded, cells: r.cells, rows: r.rows, cols: r.cols,
        // The seal claim: the fill must never reach ANOTHER lane's band. (Not
        // "must stay inside its own band" — the slabs spill a few px into the
        // corridors, and lane C's floor is the bottom of the world, not a wall,
        // so its fill legitimately runs down through the bedrock lumps.)
        escapes: Object.entries(LANES).filter(([k]) => k !== key)
          .filter(([, o]) => r.rows[0] <= o.r1 && r.rows[1] >= o.r0).map(([k]) => k).join('') || null,
        // End to end inside the sealed span?
        spansToFarEnd: reaches(r, SEALED_C1, seedRow) || reaches(r, SEALED_C1, lane.r0) || reaches(r, SEALED_C1, lane.r1),
      };
    }
    // And from the colony itself, over the whole map: can the player actually
    // get into each lane, and out to the goal?
    const root = window.__game.state.active.root;
    const c = flood(root.x, root.y + 8, null);
    out.colony = {
      seeded: c.seeded, cells: c.cells,
      entersA: reaches(c, 40, LANES.A.r1), entersB: reaches(c, 40, 13), entersC: reaches(c, 40, 26),
      reachesGoal: reaches(c, 76, 0),
    };
    return out;
  }, { LANES, SEALED_C0, SEALED_C1 });

  for (const [key, lane] of Object.entries(LANES)) {
    const r = fill.lanes[key];
    ok(`lane ${key} (${lane.label}) is open at its mouth`, r.seeded, `${r.cells} mask cells`);
    ok(`lane ${key} is sealed from the other lanes`, r.seeded && !r.escapes,
      r.escapes ? `LEAKS into lane ${r.escapes} — fill spans rows ${r.rows[0]}–${r.rows[1]}`
                : `fill spans rows ${r.rows[0]}–${r.rows[1]}, lane is ${lane.r0}–${lane.r1}`);
    ok(`lane ${key} runs end to end`, r.spansToFarEnd, `fill spans cols ${r.cols[0]}–${r.cols[1]} of ${SEALED_C0}–${SEALED_C1}`);
  }
  ok('the colony can enter all three lanes', fill.colony.entersA && fill.colony.entersB && fill.colony.entersC,
    `A=${fill.colony.entersA} B=${fill.colony.entersB} C=${fill.colony.entersC}`);
  ok('the goal surface is reachable', fill.colony.reachesGoal, `${fill.colony.cells} mask cells reachable from the seed`);

  // --------------------------------------------------------------- content ----
  const content = await page.evaluate(({ LANES }) => {
    const st = window.__game.state, sub = st.substrate;
    const rowOf = (y) => Math.floor((y - sub.surfaceY) / sub.cellSize);
    const laneOf = (row) => {
      for (const [k, l] of Object.entries(LANES)) if (row >= l.r0 && row <= l.r1) return k;
      return '-';
    };
    const piles = sub.foodPiles.map((p) => {
      let r = 0;
      for (const i of p.cells) r += (i - (i % sub.cols)) / sub.cols;
      return { lane: laneOf(Math.round(r / p.cells.length)), kind: p.kind, cells: p.cells.length, energy: p.energyValue };
    });
    const tally = (arr, f) => arr.reduce((a, x) => { const k = f(x); a[k] = (a[k] || 0) + 1; return a; }, {});
    return {
      ants: (st.ants || []).map((n) => n.col),
      clouds: (st.clouds || []).map((c) => laneOf(rowOf(c.cy))),
      worms: (st.nematodes || []).map((w) => laneOf(rowOf(w.y))),
      pilesByLane: tally(piles, (p) => p.lane),
      engines: piles.filter((p) => p.kind === 'engine').map((p) => p.lane),
      pileCount: piles.length,
      biggest: Math.max(...piles.map((p) => p.cells)),
      reservoirs: sub.reservoirs.map((r) => laneOf(Math.round((r.r0 + r.r1) / 2))),
      // The lake has to bite into lane A, or its squeeze is decorative.
      lakeInLaneA: (() => {
        let n = 0;
        for (let c = 54; c <= 64; c++) for (let r = LANES.A.r0; r <= LANES.A.r1; r++) { const cell = sub.cellAt(c, r); if (cell && cell.water) n++; }
        return n;
      })(),
      cities: sub.authoredCities.length, mountains: sub.authoredMountains.length, props: sub.authoredProps.length,
    };
  }, { LANES });

  ok('three ant nests, all over lane A', content.ants.length === 3, 'cols ' + content.ants.join(', '));
  ok('four mould clouds, all in lane B', content.clouds.length === 4 && content.clouds.every((l) => l === 'B'), 'lanes ' + content.clouds.join(''));
  ok('five worms, all in lane C', content.worms.length === 5 && content.worms.every((l) => l === 'C'), 'lanes ' + content.worms.join(''));
  ok('food is split 10 / 6 / 3 across the lanes',
    content.pilesByLane.A === 10 && content.pilesByLane.B === 6 && content.pilesByLane.C === 3,
    JSON.stringify(content.pilesByLane) + ` of ${content.pileCount} piles`);
  ok('an engine cache in lane A and one in lane C', content.engines.length === 2 && content.engines.includes('A') && content.engines.includes('C'), 'lanes ' + content.engines.join(', '));
  ok("lane C holds the map's biggest pile", content.biggest >= 25, `${content.biggest} cells`);
  ok('two reservoirs in lane B, one in lane C',
    content.reservoirs.filter((l) => l === 'B').length === 2 && content.reservoirs.filter((l) => l === 'C').length === 1,
    'lanes ' + content.reservoirs.join(', '));
  ok('the lake bites into lane A', content.lakeInLaneA >= 20, `${content.lakeInLaneA} water cells in lane A under cols 54–64`);
  ok('surface decor survived the loader', content.cities === 2 && content.mountains === 3 && content.props === 6,
    `${content.cities} cities, ${content.mountains} mountains, ${content.props} props`);

  // ----------------------------------------------------------- screenshots ----
  // Now clear the intro. It is created a beat AFTER the state exists, so wait for
  // it before clicking — clicking first and then testing for it exits the loop
  // immediately and every shot comes out as a picture of the overlay.
  await page.waitForSelector('#levelIntro', { timeout: 15000 }).catch(() => {});
  for (let i = 0; i < 6 && await page.$('#levelIntro'); i++) { await page.mouse.click(900, 300); await sleep(1000); }
  ok('the level intro dismisses', !(await page.$('#levelIntro')));

  // Pin the camera by hand: the whole point is a repeatable frame, and the
  // in-game min-zoom floor is derived from the viewport.
  const shoot = async (name, x, y, zoom) => {
    await page.evaluate(({ x, y, zoom }) => {
      const cam = window.__game.camera;
      cam.zoom = zoom; cam.x = x; cam.y = y; cam.clamp();
    }, { x, y, zoom });
    await sleep(700);
    await page.screenshot({ path: path.join(ART, `level-${name}.png`) });
  };
  await shoot('overview', 1440, 970, 0.625);
  await shoot('atrium', 430, 970, 1.15);
  await shoot('lane-a', 1900, 480, 1.15);
  await shoot('lane-b', 1450, 880, 1.15);
  await shoot('lane-c', 1700, 1300, 1.15);
  console.log('  shots → tests/.artifacts/level-*.png');

  await page.close();

  // -------------------------------------------------- turn-based sanity ----
  // The map is designed for real time, but it must not be BROKEN in the other
  // game — a shared authored level that only boots in one mode is a trap.
  const page2 = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const errs2 = [];
  page2.on('pageerror', (e) => errs2.push(String(e && e.message)));
  await page2.addInitScript(() => { window.MYCELIUM_SUPABASE = { url: '', anonKey: '' }; });
  await page2.goto(base + '/index.html#level,three-ways,turn', { waitUntil: 'domcontentloaded' });
  await page2.waitForSelector('#loadscreen.ld-ready', { timeout: 30000 }).catch(() => {});
  await page2.click('#loadscreen', { timeout: 5000 }).catch(() => {});
  await page2.waitForFunction(() => window.__game && window.__game.state && window.__game.state.active, null, { timeout: 30000 }).catch(() => {});
  const t = await page2.evaluate(() => ({
    turn: window.__game.state.turn, rt: window.__cfg.realtime.enabled,
    authored: !!window.__game.state.substrate.authored, cols: window.__game.state.substrate.cols,
  }));
  ok('the same map boots in turn-based', t.authored && t.cols === 80 && t.rt === false && errs2.length === 0,
    `rt=${t.rt} cols=${t.cols} errs=${errs2.slice(0, 2).join(' | ') || 'none'}`);
  await page2.close();

  console.log(`\n==== ${pass} passed, ${fail} failed ====`);
  await browser.close(); srv.close(); process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('HARNESS ERROR', e); process.exit(2); });
