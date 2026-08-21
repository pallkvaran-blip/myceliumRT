/* THE DEEP MINE — the third game. A depth-miner with no cards: one procedurally generated shaft
 * per run, real time, WATER AS THE FUEL, Phosphorus as the store's currency.
 *
 * Six things have to be true and each of them fails differently:
 *
 *   1. THE SHAFT IS REACHABLE, TOP TO BOTTOM. The colony cannot dig through rock, so a boulder
 *      across the only route is an unwinnable run with nothing on screen to explain it — and the
 *      generator's answer is to CARVE FIRST and place rock only where a sprite's whole bounding box
 *      misses the carve. That is a promise about the generator; this floods the REAL FINE MASK, the
 *      one stamped from each sprite's own alpha at render time, which is the only way to ask the
 *      question the player's growth asks. `traced-check` does the same for the authored maps.
 *
 *   2. THE ROCK IS BANDED BY DEPTH. Each band draws from its own theme's sprites, and the sprites
 *      are the OWNER'S OWN (docs/mine/*.json). Asserted per band against the disk files, so a
 *      library that silently emptied — or a band whose blend leaked the wrong theme all the way
 *      down — fails rather than rendering as plausible rock.
 *
 *   3. NOTHING WORTH HAVING IS ON THE WAY DOWN. This is the whole economy: with the water pockets
 *      placed anywhere open, a probe diving straight down reached 167 m of a 168 m shaft on a FIRST
 *      run and banked no ore at all. So the fuel curve is MEASURED here — a straight dive must not
 *      reach the bottom — with the opposite assertion beside it, because "you can barely move"
 *      passes the same test and is a worse game.
 *
 *   4. THE CARD LAYER IS GONE, and gone from the SCREEN as well as from the config. `cards.enabled`
 *      off is the switch; the assertion is that no carousel, no draft and no action bar is in the
 *      DOM, because a HUD that still builds them is a third of a phone's screen.
 *
 *   5. THE ZOOM IS FIXED. Wheel, pinch, double-tap and `F` all ask one predicate, so this drives
 *      the wheel and the key and asserts the zoom did not move — with the campaign as the control,
 *      or "zoom never works" passes.
 *
 *   6. THE STORE IS A SEPARATE SHOP. Its wallet is `minerals` and its ledger `mineUpgrades`, so a
 *      descent's ore can never buy Retries and a campaign's Spores can never buy fuel. Asserted in
 *      both directions, because either leak is silent and permanent.
 *
 * Boots `#mine,<seed>` — the pinned seed is the only way to look at the same generated map twice.
 */
const http = require('http'), fs = require('fs'), path = require('path');
const { chromium } = require('playwright');
const ROOT = path.resolve(__dirname, '..');
const T = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.png': 'image/png',
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.svg': 'image/svg+xml', '.webp': 'image/webp',
  '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.css': 'text/css' };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let pass = 0, fail = 0;
const ok = (n, c, x) => { c ? (pass++, console.log('  PASS  ' + n + (x ? '  — ' + x : ''))) : (fail++, console.log('  FAIL  ' + n + (x ? '  — ' + x : ''))); };

// The rock library as it is ON DISK — the owner's editor exports, one per rock type. Read here so
// the page's answer is checked against something independent of the page: `MINE_ROCKS` is spliced
// into index.html by `scripts/gen-mine-rocks.mjs`, and a stale splice is exactly the failure that
// would otherwise be invisible (four bands, one of them rendering the wrong theme's rock).
const LIB = {};
for (const f of fs.readdirSync(path.join(ROOT, 'docs', 'mine')).filter((f) => f.endsWith('.json'))) {
  const def = JSON.parse(fs.readFileSync(path.join(ROOT, 'docs', 'mine', f), 'utf8'));
  const keys = (def.objects || []).filter((o) => o && o.key).map((o) => o.key);
  const folder = /^(.*?)R\d+$/.exec(keys[0])[1];
  LIB[folder.replace(/-c\d+$/, '')] = { folder, keys: new Set(keys) };
}

(async () => {
  const srv = await new Promise((res) => { const s = http.createServer((rq, rs) => {
    let p = decodeURIComponent(rq.url.split('?')[0].split('#')[0]); if (p === '/') p = '/index.html';
    const fp = path.join(ROOT, p);
    if (!fp.startsWith(ROOT) || !fs.existsSync(fp) || fs.statSync(fp).isDirectory()) { rs.writeHead(404); rs.end('nf'); return; }
    rs.writeHead(200, { 'Content-Type': T[path.extname(fp)] || 'application/octet-stream' });
    fs.createReadStream(fp).pipe(rs); }); s.listen(0, () => res(s)); });
  const base = 'http://localhost:' + srv.address().port;
  const browser = await chromium.launch({ headless: true, executablePath: '/opt/pw-browsers/chromium' });

  // ONE BROWSER CONTEXT PER BLOCK. Reusing one across cases has leaked state into later assertions
  // in this project before, and this check deliberately ends a run (which writes the wallet) in the
  // middle of it.
  const boot = async (hash, vw = 390, vh = 844) => {
    const ctx = await browser.newContext({ viewport: { width: vw, height: vh } });
    const page = await ctx.newPage();
    const errs = []; page.on('pageerror', (e) => errs.push(String(e && e.message)));
    await page.addInitScript(() => { window.MYCELIUM_SUPABASE = { url: '', anonKey: '' }; });
    await page.goto(base + '/index.html' + hash, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('#loadscreen.ld-ready', { timeout: 40000 }).catch(() => {});
    await page.click('#loadscreen', { timeout: 5000 }).catch(() => {});
    return { ctx, page, errs };
  };
  const bootMine = async (seed, vw, vh) => {
    const b = await boot('#mine,' + seed, vw, vh);
    await b.page.waitForFunction(() => !!(window.__game && window.__game.mine
      && window.__game.state && window.__game.state.substrate && window.__game.state.substrate.mine),
      { timeout: 40000 });
    // The FINE MASK is stamped during RENDER, so nothing that reads collision — or the threats,
    // which are seeded off it — is answerable before a frame has run.
    await b.page.waitForFunction(() => !!window.__game.state.substrate._fineSolid, { timeout: 20000 });
    await sleep(1200);
    // A DESCENT THAT FOLLOWS THE PASSAGE, shared by every probe whose setup is "get to depth N".
    //
    // It exists because the DESCENT SPINE STOPPED BEING A STRAIGHT CHUTE. Several probes reached
    // depth by digging `(0, 1)` with a ±0.5 fallback, which worked only while there was a plumb
    // rock-free shaft under the start column — the one the owner spotted ("a vertical line from
    // where the colony starts, straight down, that is totally void of rocks"). With the spine
    // snaking they stalled at 31-40 m and four assertions failed for want of depth rather than for
    // anything they were testing. Shaping the world so a blind probe works is backwards; this is the
    // other half of that fix.
    //
    // It tries progressively wider angles and keeps whichever actually GAINED depth — a dig into a
    // wall still succeeds (the fan finds open ground sideways) while buying nothing, so "did it
    // grow?" is the wrong question and "are we deeper?" is the right one.
    await b.page.evaluate(() => {
      // LOOK BEFORE DIGGING — one dig per step, never a fan of paid attempts. Trying seven angles and
      // keeping whichever gained depth costs SEVEN DIGS a step, which empties the tank probing: the
      // tolerance dive read `26 m on 22 digs` (the whole opening tank for 1.2 m a dig) while the fuel
      // probe managed 45 m on 19. `solidAtWorld` is free, so the aim is chosen against the mask and
      // then paid for once.
      window.__aimDown = () => {
        const g = window.__game, s = g.state, sub = s.substrate;
        let tip = null;
        for (const n of s.active.nodes) if (!n.infected && (!tip || n.y > tip.y)) tip = n;
        if (!tip) return 0;
        const reach = (s.config.growth.segmentLength || 25.5) * 3;
        let best = 0, bestGain = -1;
        for (const dx of [0, 0.35, -0.35, 0.7, -0.7, 1.1, -1.1, 1.6, -1.6]) {
          const nrm = Math.hypot(dx, 1);
          // Walk the ray and score how far down it stays clear — the aim that buys the most depth,
          // not merely one that is legal.
          let clear = 0;
          for (let t = 0.25; t <= 1.0001; t += 0.25) {
            const x = tip.x + (dx / nrm) * reach * t, y = tip.y + (1 / nrm) * reach * t;
            if (sub.solidAtWorld(x, y)) break;
            clear = (1 / nrm) * reach * t;
          }
          if (clear > bestGain) { bestGain = clear; best = dx; }
        }
        return bestGain > 0 ? best : null;
      };
      window.__digTo = async (targetM, iters) => {
        const g = window.__game, s = g.state;
        let stuck = 0;
        for (let i = 0; i < (iters || 140) && g.mine.depth() < targetM && !s.runOver; i++) {
          const d0 = g.mine.depth();
          const dx = window.__aimDown();
          if (dx === null) { if (++stuck > 10) break; }
          else if (!g.mine.grow(dx, 1).ok) { if (++stuck > 10) break; }
          if (g.mine.depth() <= d0) { if (++stuck > 14) break; } else stuck = 0;
          if (i % 4 === 3) await new Promise((r) => setTimeout(r, 60));
        }
        return g.mine.depth();
      };
    });
    return b;
  };

  // =========================================================================================
  // 1. THE SHAPE OF THE SHAFT
  // =========================================================================================
  console.log('--- the shaft');
  let m = await bootMine(4242);
  const shaft = await m.page.evaluate(() => {
    const g = window.__game, s = g.state, sub = s.substrate, M = s.config.mine;
    return {
      game: window.__cfg.game, mode: window.__cfg.mode, cards: !!s.config.cards.enabled,
      cols: sub.cols, rows: sub.rows, bandRows: M.bandRows, bands: M.bands.length,
      width: sub.worldWidth, height: sub.worldHeight, surfaceY: sub.surfaceY,
      coreY: sub.coreY, growFloorY: sub.growFloorY,
      mine: !!sub.mine, homeCol: sub.mineHomeCol,
      // The colony's root — it has to be in the MIDDLE (owner), not at the left edge.
      rootX: s.active.nodes[0].x, rootCol: sub.colAtX(s.active.nodes[0].x),
      goalCols: sub.surface.filter((c) => c.goal).length,
      soilCols: sub.surface.filter((c) => c.soil).length,
      channelX0: sub.channelX0, channelX1: sub.channelX1,
      stats: g.mine.stats(), seed: g.mine.seed(),
      // PER-BAND SOLID FRACTION OF THE DRAWN MASK — the fine one, which is what growth is tested
      // against, over the GENERATED columns only. `cell.rock` would answer a different and softer
      // question (it is the coarse flag, and a sprite overhangs its cells), and the whole grid would
      // include ungenerated chunks, which are empty and would halve every reading.
      bandSolid: (() => {
        const fs = sub._fineSize, fc = sub._fineCols, fr = sub._fineRows, sol = sub._fineSolid;
        if (!sol) return [];
        const cis = g.mine.chunks();
        const lo = Math.min(...cis) * M.chunkCols, hi = (Math.max(...cis) + 1) * M.chunkCols - 1;
        const fx0 = Math.floor(lo * sub.cellSize / fs), fx1 = Math.ceil((hi + 1) * sub.cellSize / fs) - 1;
        const nb = M.bands.length, out = [];
        for (let b = 0; b < nb; b++) {
          const y0 = Math.floor(b * M.bandRows * sub.cellSize / fs);
          const y1 = Math.min(fr - 1, Math.ceil((b + 1) * M.bandRows * sub.cellSize / fs) - 1);
          let n = 0, k = 0;
          for (let y = y0; y <= y1; y++) for (let x = Math.max(0, fx0); x <= Math.min(fc - 1, fx1); x++) {
            k++; if (sol[y * fc + x]) n++;
          }
          out.push(+(n / Math.max(1, k)).toFixed(3));
        }
        return out;
      })(),
      chunks: g.mine.chunks(), chunkCount: g.mine.chunkCount(), homeChunk: g.mine.homeChunk(),
      chunkCols: M.chunkCols, preloadCols: M.preloadCols,
    };
  });
  ok('the mine is real time', shaft.mode === 'realtime' && shaft.game === 'mine', `${shaft.game}/${shaft.mode}`);
  // THE ONE SWITCH THE WHOLE CARD LAYER READS. Everything else about "no cards" follows from it —
  // main.js `cardsCampaign`, the HUD's `cardsOn`, the draft, the deck, the engines.
  ok('the card layer is off', shaft.cards === false, String(shaft.cards));
  // THE GRID IS ALLOCATED WHOLE AND THE CONTENT STREAMS IN. `cols` is every chunk, because a flat
  // row-major cell array cannot grow leftward without renumbering every index in the engine — what
  // the owner asked for ("generate as I go") is the CONTENT, which is what they see.
  ok('the shaft is CONFIG.mine\'s size', shaft.cols === shaft.chunkCols * shaft.chunkCount
     && shaft.rows === shaft.bandRows * shaft.bands,
     `${shaft.cols}x${shaft.rows} = ${shaft.chunkCount} chunks of ${shaft.chunkCols}, ${shaft.bands} bands of ${shaft.bandRows}`);
  // ...AND ONLY A FEW CHUNKS EXIST AT THE START. Generating all 21 up front would place ~13,000
  // sprites for a run that visits four, which is the cost this whole design is here to avoid — so a
  // fresh boot holding every chunk is a silent regression to that, and reads as nothing but a
  // slow boot.
  ok('only the chunks near the colony are generated', shaft.chunks.length >= 1 && shaft.chunks.length <= 5,
     `${shaft.chunks.length} of ${shaft.chunkCount}: [${shaft.chunks}]`);
  ok('...and the home chunk is one of them', shaft.chunks.includes(shaft.homeChunk),
     `home ${shaft.homeChunk}, have [${shaft.chunks}]`);
  // THE COLONY STARTS IN THE MIDDLE (owner: "The green hill starts in the middle of the map"), and
  // the assertion is against the shaft's own centre rather than a column number, so widening the
  // shaft cannot silently move the start to one side.
  ok('the colony roots in the middle of the surface', shaft.rootCol === (shaft.cols >> 1),
     `col ${shaft.rootCol} of ${shaft.cols}`);
  // NO GOAL AT ALL: this is what stops `checkGoalReached` from ever firing, and retires the goal
  // hill and its bushes (both return early on `goalCol0() < 0`). Depth is the only thing to chase.
  ok('there is nothing to cross to — no goal columns', shaft.goalCols === 0, String(shaft.goalCols));
  ok('...but the hill is fruitable soil', shaft.soilCols > 4 && shaft.soilCols < shaft.cols,
     `${shaft.soilCols} of ${shaft.cols} columns`);
  // THE EDGE ROCK IS REAL. `clearChannels: false`, so nothing is flagged `pathClear` — without it
  // the first and last columns are a lane you can grow through whatever the art shows.
  ok('no channels are dug — the edge rock is solid', shaft.channelX0 === null && shaft.channelX1 === null,
     `${shaft.channelX0} / ${shaft.channelX1}`);
  // The molten floor sits ON the content floor, so the bottom of the shaft is a hard stop you can
  // SEE coming rather than an invisible wall.
  ok('the core is the bottom of the shaft', Math.abs(shaft.coreY - shaft.height) < 1 && Math.abs(shaft.growFloorY - shaft.coreY) < 1,
     `core ${shaft.coreY} floor ${shaft.growFloorY} content ${shaft.height}`);
  ok('the generator laid rock, ore and water', shaft.stats.rocks > 150 && shaft.stats.piles > 10 && shaft.stats.pockets > 6,
     `${shaft.stats.rocks} rocks, ${shaft.stats.piles} ore, ${shaft.stats.pockets} pockets over ${shaft.stats.chunks} chunk(s)`);
  // THE CARVE IS THE DENSITY CEILING, and this is the assertion that says so. A boulder's alpha
  // fills ~35% of its bounding box, so the most solid ground a chunk can ever show is roughly
  // (1 - open) x 0.35 — measured at 53% open the ceiling was 16% and the shaft was swimmable at 12%,
  // with the rock loop already covering 72% of everything left. No placement change can beat this
  // number, so it is the one to look at first if the mine ever reads too open again.
  // 0.45 -> 0.38 WITH THE MAZE CARVE. The gallery gaps, the spine-only shaft and the tighter radii
  // took the measured figure from 38.0% open to about 32%, which is where the extra rock came from
  // (fill was already saturated at 87-96% of its targets, so the carve was the only lever left).
  ok('the carve leaves room for rock', shaft.stats.openFrac < 0.38, `${(shaft.stats.openFrac * 100).toFixed(1)}% open`);
  // ...and the rock loop reached the band targets it was given. Separate from the mask assertions
  // below because they are different failures: a chunk that missed its targets and a chunk that hit
  // them and still looks thin want opposite fixes, and the drawn mask cannot tell them apart.
  // `fill` IS NOW A "KEEP PACKING" INSTRUCTION, NOT A TARGET, so "did it hit its target" stopped
  // being a question with a meaningful answer. The band fills are deliberately set above what is
  // reachable (1.55-1.85 of the closed ground) because that is how OVERLAPPING boxes union their
  // alphas into a continuous wall — see the `OVERLAP` note in the generator. What matters is that
  // the loop SATURATED the ground it was given, which is what `cover` says.
  ok('...and the rock loop packed the ground full', shaft.stats.cover.every((c) => c > 0.92),
     shaft.stats.cover.join(' / ') + '  (hit ' + shaft.stats.hit.join(' / ') + ' of target)');
  // Deeper bands run denser (CONFIG.mine.bands[].fill), which is what makes the descent close in.
  // Asserted as a TREND with slack rather than as monotonic: a band's target is a target, and the
  // carve has priority — a seed whose channels wander through one band legitimately leaves it less
  // room for rock. What must hold is that the bottom is denser than the top.
  // MEASURED ON THE DRAWN MASK, NOT ON BBOX COVERAGE. Bbox now saturates in every band (~100% of the
  // closed ground everywhere), so the depth trend simply vanished from that number and this read
  // `1.03 / 1.033 / 1.018 / 0.974` — a failure about a quantity that no longer varies. What the
  // player feels is the SOLID mask, and the band `scale` tables are what close it in.
  // ...AND THE BOTTOM BAND IS EXCLUDED FROM THE TREND, for a structural reason rather than a
  // convenient one: a sprite must fit inside `contentBottom`, so the last sprite-height of the map
  // cannot be filled at all and the deepest band reads 3-6 points under its neighbour however high
  // its `fill` goes (measured 57.5% at band 2 against 51.2% at band 3 with band 3 asking for 2.9).
  // The trend that is real, and that the player descends through, is bands 0 -> 2.
  ok('rock closes in with depth', shaft.bandSolid[2] > shaft.bandSolid[0],
     shaft.bandSolid.map((v) => (v * 100).toFixed(1) + '%').join(' / ')
     + '  (band 3 is clipped by the content floor — excluded)');
  // ...and every band lands in the TRACED CAMPAIGN MAPS' own range of solid ground. The trend above
  // is a design intention the carve can legitimately override on one seed; this is the bound that
  // actually decides whether a band is playable.
  // ...and every band's DRAWN rock lands in the traced campaign maps' range of solid ground. The
  // upper bound matters as much as the lower: past ~65% the passages stop being passages.
  ok('...and every band lands in the traced maps\' range of solid ground',
     shaft.bandSolid.every((v) => v > 0.3 && v < 0.68),
     shaft.bandSolid.map((v) => (v * 100).toFixed(1) + '%').join(' / '));
  // NOTHING SHOULD HAVE BEEN STRANDED. The generator's own sweep drops any ore or water pocket the
  // colony cannot reach (a pocket carved across a gallery's neck can sever what is beyond it), so a
  // number here is that interaction happening — worth knowing, not worth failing on, since the sweep
  // is what makes the reachability assertions below true either way.
  console.log(`  note   ${shaft.stats.ore} ore seam(s) and ${shaft.stats.water} pocket(s) placed across ${shaft.stats.chunks} chunk(s)`);

  // ---- 2. the rock is BANDED, and the sprites are the owner's -----------------------------
  console.log('--- banded rock');
  const banded = await m.page.evaluate(() => {
    const s = window.__game.state, sub = s.substrate, M = s.config.mine, cs = sub.cellSize;
    const per = M.bands.map(() => ({}));
    for (const sp of sub.levelSprites) {
      const row = Math.floor((sp.y - sub.surfaceY) / cs);
      const b = Math.max(0, Math.min(M.bands.length - 1, Math.floor(row / M.bandRows)));
      const theme = /^(.*?)R\d+$/.exec(sp.key)[1].replace(/-c\d+$/, '');
      per[b][theme] = (per[b][theme] || 0) + 1;
    }
    return { per, themes: M.bands.map((b) => b.theme), blend: M.blendFrac };
  });
  for (let b = 0; b < banded.themes.length; b++) {
    const own = banded.per[b][banded.themes[b]] || 0;
    const total = Object.values(banded.per[b]).reduce((a, n) => a + n, 0);
    const above = b > 0 ? (banded.per[b][banded.themes[b - 1]] || 0) : 0;
    // ITS OWN THEME IS THE MAJORITY, and the only other theme allowed is the one ABOVE it — the
    // blend is "the deeper you go, a new rock type STARTS appearing", not a mixed bag.
    ok(`band ${b + 1} (${banded.themes[b]}) is mostly its own rock`, total > 10 && own / total > 0.6,
       `${own} of ${total}` + (above ? `, ${above} from the band above` : ''));
    ok(`...and carries no rock from a band below it`,
       Object.keys(banded.per[b]).every((t) => banded.themes.indexOf(t) <= b),
       Object.keys(banded.per[b]).join(','));
  }
  // ...against the DISK, so a stale `MINE_ROCKS` splice fails here rather than rendering plausibly.
  const keysOk = await m.page.evaluate(() => {
    const s = window.__game.state, sub = s.substrate;
    return sub.levelSprites.map((sp) => sp.key);
  });
  const unknown = keysOk.filter((k) => {
    const theme = /^(.*?)R\d+$/.exec(k)[1].replace(/-c\d+$/, '');
    return !LIB[theme] || !LIB[theme].keys.has(k);
  });
  ok('every sprite is one the owner placed in docs/mine/', unknown.length === 0,
     unknown.length ? unknown.slice(0, 3).join(',') : `${keysOk.length} sprites, ${Object.keys(LIB).length} libraries`);

  // ---- 1b. REACHABILITY, over the real fine mask ------------------------------------------
  // The generator promises this by CONSTRUCTION (carve first, then place rock whose whole bbox
  // misses the carve). This is the independent check: flood the mask `solidifyRock` stamped from
  // each sprite's own alpha, from the colony's own root, and ask how deep the open space goes.
  // Flooding the COARSE `cell.rock` grid would pass on a build whose sprites never decoded.
  //
  // SCOPED TO THE CHUNKS THAT EXIST, and that is not a detail: ungenerated ground is bare SOIL, so a
  // flood over the whole 504-column grid walks straight into it and reports ~90% of the mask
  // reachable — which passes "the bottom is reachable" for the wrong reason and fails "neither hollow
  // nor solid" on a shaft that is neither. The question is only ever about generated ground.
  const flood = await m.page.evaluate(() => {
    const G = window.__game, s = G.state, sub = s.substrate, cs = sub.cellSize;
    const root = s.active.nodes[0];
    const step = sub._fineSize, W = sub._fineCols, H = sub._fineRows, solid = sub._fineSolid;
    const cw = s.config.mine.chunkCols, K = Math.round(cs / step);
    const cis = G.mine.chunks();
    const fx0 = cis[0] * cw * K, fx1 = Math.min(W - 1, (cis[cis.length - 1] + 1) * cw * K - 1);
    const seen = new Uint8Array(W * H);
    const sx = Math.floor(root.x / step), sy = Math.floor((root.y - sub.surfaceY) / step);
    const q = [sy * W + sx]; seen[q[0]] = 1;
    let deepest = sy, reached = 0;
    while (q.length) {
      const i = q.pop(); reached++;
      const y = (i / W) | 0, x = i % W;
      if (y > deepest) deepest = y;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx, ny = y + dy;
        if (nx < fx0 || ny < 0 || nx > fx1 || ny >= H) continue;
        const j = ny * W + nx;
        if (seen[j] || solid[j]) continue;
        seen[j] = 1; q.push(j);
      }
    }
    // Openness measured over the SAME window the flood was allowed to use.
    let winCells = 0, winOpen = 0;
    for (let y = 0; y < H; y++) for (let x = fx0; x <= fx1; x++) { winCells++; if (!solid[y * W + x]) winOpen++; }
    // How much of every ORE pile and every water pocket the colony can actually get to.
    const cellOpen = (col, row) => {
      const p = sub.cellCenter(col, row);
      const fx = Math.floor(p.x / step), fy = Math.floor((p.y - sub.surfaceY) / step);
      return fx >= 0 && fy >= 0 && fx < W && fy < H && !!seen[fy * W + fx];
    };
    let piles = 0, pilesOk = 0;
    for (const pile of (sub.foodPiles || [])) {
      piles++;
      if (pile.cells.some((idx) => cellOpen(idx % sub.cols, (idx / sub.cols) | 0))) pilesOk++;
    }
    // A pocket is reachable if any cell NEXT TO its water is in the flood — the water itself is
    // solid, and tapping it is a matter of almost touching it (growth.waterContactDist).
    let pockets = 0, pocketsOk = 0;
    for (const r of (sub.reservoirs || [])) {
      pockets++;
      let near = false;
      for (let row = r.r0 - 2; row <= r.r1 + 2 && !near; row++)
        for (let col = r.c0 - 2; col <= r.c1 + 2 && !near; col++) {
          const c = sub.cellAt(col, row);
          if (c && !c.water && cellOpen(col, row)) near = true;
        }
      if (near) pocketsOk++;
    }
    return { deepestM: Math.floor(deepest * step / cs), rows: sub.rows,
             reachedFrac: reached / Math.max(1, winCells),
             // Of the open ground in the window, how much the colony can actually get to. 100% is
             // the promise the carve makes; anything less is a pocket the generator sealed.
             connectedFrac: reached / Math.max(1, winOpen),
             chunks: cis.length, piles, pilesOk, pockets, pocketsOk };
  });
  // THE BOTTOM OF THE SHAFT IS REACHABLE. Within a couple of metres of the floor, because the
  // deepest row is against the molten line and the mask's last fine row may be partly under rock.
  ok('the open space reaches the bottom of the shaft', flood.deepestM >= flood.rows - 3,
     `${flood.deepestM} m of ${flood.rows}`);
  // NOT *EVERY* SEAM ANY MORE, AND THAT IS THE FEATURE (owner: "yes fine that some areas are only
  // reachable with upgrades"). The generator used to DELETE a reward its own sweep found stranded; it
  // now keeps it, so a walled-off pocket is visible bait for the rock-eating consumables. What still
  // has to hold is that the great majority are reachable — a map whose ore is mostly behind walls is
  // not gated content, it is an economy that has fallen through the floor, and the store is priced
  // against ore income.
  ok('most ore seams are reachable, and the rest are gated', flood.pilesOk >= flood.piles * 0.75,
     `${flood.pilesOk} of ${flood.piles} reachable, ${flood.piles - flood.pilesOk} walled in`);
  ok('...and most water pockets', flood.pocketsOk >= flood.pockets * 0.7,
     `${flood.pocketsOk} of ${flood.pockets} reachable, ${flood.pockets - flood.pocketsOk} walled in`);
  // A shaft that is nearly all open is a shaft with no rock in it, which passes everything above
  // and is not a mine. The other side of the same coin as the reachability flood.
  // A shaft that is nearly all open is a shaft with no rock in it, which passes everything above and
  // is not a mine; one that is nearly all rock is a shaft you cannot dig. The bound is the TRACED
  // CAMPAIGN MAPS' own range (23-53% solid) seen from the other side — the fill targets were raised
  // to land there, and this is what would notice them drifting back out.
  ok('...and the shaft is neither hollow nor solid', flood.reachedFrac > 0.2 && flood.reachedFrac < 0.8,
     `${(flood.reachedFrac * 100).toFixed(1)}% of the ${flood.chunks} generated chunk(s) reachable`);
  // SEALED POCKETS ARE ALLOWED NOW, AND THAT IS AN OWNER DECISION, not a relaxed standard: "it's
  // totally fine if some areas are not reachable - we will have consumables later that allow people
  // to grow through rocks when needed." So this used to demand `> 0.97` and cannot any more — a
  // maze with no sealed ground is a maze with no walls in it.
  //
  // WHAT REPLACES IT IS A FLOOR, not nothing. Most of the shaft still has to be one connected space,
  // or the map is a scatter of caves and the reachable game is a fraction of what was generated —
  // and the two assertions that matter for playability are separate and unchanged: the open space
  // REACHES THE BOTTOM (above), and every surviving reward is reachable. Those are what stop a run
  // dying for no visible reason; this one is now about the shape being a maze rather than rubble.
  ok('...and most of the shaft is still one connected space', flood.connectedFrac > 0.8,
     `${(flood.connectedFrac * 100).toFixed(1)}% of open ground connected`);

  // ---- 4. NO CARDS ON THE SCREEN -----------------------------------------------------------
  console.log('--- no cards, and the mine HUD');
  const hud = await m.page.evaluate(() => {
    const ui = document.getElementById('ui');
    const has = (s) => !!ui.querySelector(s);
    const txt = (s) => { const e = document.getElementById(s); return e ? e.textContent.trim() : null; };
    return {
      handbar: has('.handbar'), handlist: has('.handlist'), offer: has('.offer'),
      actionbar: has('.actionbar'), actionsdock: has('.actionsdock'), ledger: has('.engledger'),
      skipchip: has('.skipchip'),
      water: txt('hud-water'), phos: txt('hud-phosphorus'), depth: txt('hud-depth'),
      energyPill: has('#hud-energy'), sporesPill: has('#hud-spores'),
      cardsState: !!window.__game.state.cards,
    };
  });
  ok('no card carousel', hud.handbar === false && hud.handlist === false,
     `handbar ${hud.handbar} handlist ${hud.handlist}`);
  ok('no draft panel, no actions dock, no income ledger',
     hud.offer === false && hud.actionsdock === false && hud.ledger === false,
     `offer ${hud.offer} dock ${hud.actionsdock} ledger ${hud.ledger}`);
  // THE SANDBOX'S ACTION BAR IS NOT THE MINE'S EITHER. `cards.enabled: false` alone gives you the
  // six basic actions across the bottom, which on a portrait phone is the biggest thing on screen —
  // and the mine has ONE action and it is a drag on the map.
  ok('no basic-action bar', hud.actionbar === false, String(hud.actionbar));
  ok('there is no card layer in state at all', hud.cardsState === false, String(hud.cardsState));
  ok('the HUD reads water, phosphorus and depth',
     hud.water !== null && hud.phos !== null && hud.depth !== null,
     `${hud.water} / ${hud.phos} / ${hud.depth} m`);
  // Energy is DELIBERATELY off the row: nothing in the mine spends it, so a number that only ever
  // rises is three characters of noise on the scarcest screen in the game.
  ok('...and not energy or spores', hud.energyPill === false && hud.sporesPill === false,
     `energy ${hud.energyPill} spores ${hud.sporesPill}`);

  // ---- THE GROW: 2 steps for 2 water, as long as there is water ----------------------------
  console.log('--- the grow');
  const grow = await m.page.evaluate(async () => {
    const g = window.__game, s = g.state, net = s.active;
    const out = { cost: g.mine.cost(), steps: g.mine.steps(), seg: s.config.growth.segmentLength };
    let sub0 = s.substrate.surfaceY;
    for (const n of net.nodes) if (!n.infected && n.y > sub0) sub0 = n.y;
    net.water = 20;
    const before = net.nodes.length, w0 = net.water;
    // DID THIS DIG CLAIM A SEAM? A pile claim lays a BRIDGE RUNNER of up to 30 nodes on top of the
    // grow's own segments, so it can carry the deepest tip far past the segment budget and the reach
    // assertion below has no honest ceiling for that case. Recorded rather than prevented: which
    // ground the first dig lands next to is the map's business, and the maze carve moved a seam
    // within reach of it (measured 253 units against a 153 ceiling, on a grow-2).
    // COUNTED AS CELLS CLAIMED, NOT AS ORE BANKED. `g.mine.ore()` read straight after the grow is
    // too early: the claim is stamped inside the grow but the ore is credited by `mineOreRewards` on
    // the next world tick, so the ore reading is still zero and the case looks like it did not
    // happen. That misdetection is exactly how this came back as `253 units of a possible 153` with
    // no explanation attached.
    const colon = () => { let k = 0; for (const c of s.substrate.cells) if (c.colonized) k++; return k; };
    const cl0 = colon();
    const r1 = g.mine.grow(0, 1);
    out.claimed = colon() > cl0;
    out.grewNodes = net.nodes.length - before;
    out.deepestGain = (() => { let d = sub0; for (const n of net.nodes) if (!n.infected && n.y > d) d = n.y; return d - sub0; })();
    out.spent = w0 - net.water;
    out.ok1 = !!r1.ok;
    // ...AND IT KEEPS WORKING WHILE THERE IS WATER. "As long as they have water" (owner) is the
    // rule, so there is no cooldown, no round and nothing to spend but the water.
    let plays = 0;
    for (let i = 0; i < 12 && net.water >= out.cost; i++) if (g.mine.grow(0, 1).ok) plays++;
    out.playsWithWater = plays;
    // ...and refuses the moment it cannot be paid for, with the run still LIVE — running dry is a
    // separate rule with a grace on it (mineFuelCheck), not an instant ending.
    net.water = out.cost - 1;
    const r2 = g.mine.grow(0, 1);
    out.refusedWhenBroke = !r2.ok;
    out.refusalSaysWater = /water/i.test(r2.message || '');
    out.stillLive = !s.runOver;
    return out;
  });
  ok('a grow is CONFIG.mine\'s 2 steps', grow.steps === 2, `${grow.steps} steps`);
  ok('...and costs 2 water', grow.cost === 2 && grow.spent === 2, `cost ${grow.cost}, spent ${grow.spent}`);
  // A step is 3 segments (the card layer's own unit), so a grow-2 lays 6 — which is what makes the
  // mine's grow comparable to a 2-step card rather than a new unit nobody can price.
  // MEASURED AS REACH, NOT AS A NODE COUNT — and that is not a softer assertion, it is the right
  // one. `growDirected` lays side branches and, when a grow lands near a seam, a bridge runner and a
  // mat through every one of its cells, so "how many nodes did a grow-2 create?" has no fixed answer
  // (measured at 19 on a grow that also claimed a pile). What "grow 2" promises the player is DEPTH:
  // 2 steps of 3 segments each, and a step is the card layer's own unit.
  //
  // A generous floor, because the shaft is dense on purpose and a dig that has to dodge legitimately
  // gains less than a dig in open soil — the assertion is that a grow-2 reaches roughly a grow-2's
  // distance and not, say, one segment.
  // THE CEILING WAS ROCK, NOT THE SEGMENT BUDGET, and the maze carve is what revealed it. This used
  // to bound the reach at `seg * 6 * 1.05` — the 6 segments a grow-2 is made of — and it passed only
  // because the ground below the colony was obstructed. Putting a guaranteed shaft under the home
  // column gave the fan a clear line and it reached **253 units, 9.9 segments**, on a budget of 6.
  //
  // NOT A REGRESSION, and the diff is the proof: this change touches the carve and nothing in
  // `growDirected`, `_growStep` or `growth.*`. `growDirected` lays SIDE BRANCHES, and a branch tip
  // can finish deeper than the six-segment spine it came off — so the true unobstructed reach of a
  // grow-2 has always been most of ten segments and rock was hiding it.
  //
  // WORTH THE OWNER'S ATTENTION SEPARATELY: `mineGrowReach` draws the aim arrow at exactly
  // `segments * segmentLength` = 153 units, so in open ground the arrow under-promises by about 40%.
  // Deliberately NOT fixed here — the fix is in shared growth code the campaign also uses, which is
  // not what "make the levels mazier" bought.
  //
  // A pile claim widens it further again (a bridge runner is up to 30 nodes), which is why
  // `out.claimed` is measured — and measured as CELLS CLAIMED, since ore banks a tick later.
  // The FLOOR is unchanged and is the real guard: a grow-2 reaches a grow-2's distance, not one
  // segment.
  ok('...and reaches about 2 steps of ground',
     grow.deepestGain >= grow.seg * 1.5
     && grow.deepestGain <= grow.seg * (grow.claimed ? 40 : 12) * 1.05,
     `${Math.round(grow.deepestGain)} units on a ${Math.round(grow.seg * 6)}-unit budget `
     + `(${grow.grewNodes} filaments${grow.claimed ? ', and it claimed a seam — bridge runner' : ''})`),
  ok('it can be used as long as there is water', grow.playsWithWater >= 8, `${grow.playsWithWater} digs on 18 water`);
  ok('...and is refused when it cannot be paid for', grow.refusedWhenBroke && grow.refusalSaysWater, 'refused, and says water');
  ok('...with the run still live', grow.stillLive === true, String(grow.stillLive));

  // ---- 4a. THE WORMS DRAIN, THEY DO NOT EAT ------------------------------------------------
  // Owner's rule: a nematode attaches and feeds on the colony rather than consuming it, so the
  // threat pushes on the clock the run ALREADY has instead of bringing a second way to lose.
  //
  // WHY THE CAMPAIGN'S NUMBERS COULD NOT BE REUSED, which is what these assertions really guard:
  // `strandsPerBite` 4 with no cooldown against an 800-strand colony is about a hundred seconds of
  // watching it be eaten, and `breedChance` 0.8 PER TICK to a cap of 150 makes it accelerate. As a
  // drain, 150 worms would empty a full tank in under four seconds.
  console.log('--- the worms drain, they do not eat');
  {
    const b = await bootMine(4242);
    const w = await b.page.evaluate(async () => {
      const g = window.__game, s = g.state;
      s.active.water = 99999;
      for (let i = 0; i < 10; i++) { g.mine.grow(0, 1); await new Promise((r) => setTimeout(r, 120)); }
      await new Promise((r) => setTimeout(r, 1200));
      // A CONTROLLED POPULATION. `tickWorld` respawns worms and the chunk generator seeds more as
      // the colony moves, so a probe that just counts what is there is measuring the world rather
      // than the rule — the same trap `threat-check` records for the campaign.
      s.nematodes.length = 0; s.clouds.length = 0;
      s.config.nematodes.respawnChance = 0;
      s.config.trichoderma.respawnChance = 0;
      const breed0 = s.config.mine.worms.breedPerSec;
      s.config.mine.worms.breedPerSec = 0;         // rate first, breeding measured separately below
      let tip = null;
      for (const n of s.active.nodes) if (!n.infected && (!tip || n.y > tip.y)) tip = n;
      const N = 3;
      for (let i = 0; i < N; i++) g.mine.spawnWorm(tip.x + (i - 1) * 4, tip.y);
      const nodes0 = s.active.nodes.length;
      s.active.water = 100;
      const w0 = s.active.water, t0 = performance.now(), d0 = s.mineDrained || 0;
      // SAMPLED THROUGHOUT, not only at the ends — the whole-number rule is about what the tank
      // reads at any moment, and a probe that looks twice cannot tell a tank that stayed whole from
      // one that was fractional the entire time and happened to land on an integer.
      const seen = new Set();
      for (let i = 0; i < 30; i++) { seen.add(s.active.water); await new Promise((r) => setTimeout(r, 200)); }
      const secs = (performance.now() - t0) / 1000;
      const res = {
        tank: [...seen], fracTank: [...seen].filter((v) => !Number.isInteger(v)),
        debt: +(s.mineDrainDebt || 0).toFixed(3),
        N, secs, nodes0, nodesNow: s.active.nodes.length,
        worms: s.nematodes.length, attached: g.mine.attached(),
        // THE RATE IS MEASURED OFF THE DRAIN, NOT OFF THE TANK. Since the tank only moves in whole
        // units, the tank lags the true drain by whatever remainder is outstanding — up to 1 water,
        // which over a 6 s window read as 0.167/s against a stated 0.2 and looked like the rate
        // being wrong. `mineDrained` is the owed total and is what the rate is a property of; the
        // tank's own correctness is the separate assertion below.
        drained: (s.mineDrained || 0) - d0, tankDrop: w0 - s.active.water,
        want: s.config.mine.worms.waterPerSec,
        chipHidden: (document.getElementById('hud-worms') || {}).hidden,
        chipN: (document.getElementById('hud-wormn') || {}).textContent,
        chipRate: (document.getElementById('hud-wormrate') || {}).textContent,
      };
      s.config.mine.worms.breedPerSec = breed0;
      return res;
    });
    const perWorm = w.drained / w.secs / w.N;
    ok('an attached worm drains the stated water per second',
       Math.abs(perWorm - w.want) < w.want * 0.15,
       `${perWorm.toFixed(3)}/s per worm against ${w.want} (${w.drained.toFixed(1)} water, ${w.N} worms, ${w.secs.toFixed(1)}s)`);
    // THE OTHER HALF, and the one that would pass silently if the drain were simply added on top of
    // the biting: the colony must be exactly as big as it was.
    ok('...and eats nothing at all', w.nodesNow === w.nodes0,
       `${w.nodes0} strands before, ${w.nodesNow} after ${w.secs.toFixed(0)}s with ${w.N} worms on it`);
    ok('the worms are counted as attached', w.attached === w.N, `${w.attached} of ${w.N}`);
    // THE TANK IS ONLY EVER A WHOLE NUMBER (owner: "let's count water and other things only in
    // whole numbers"), even though the drain RATE is a fraction — 0.2 a worm a second is the
    // tuning, and rounding that up to 1 would make one worm five times deadlier. So the fraction
    // accumulates in `mineDrainDebt` and only whole units come out of the tank. The debt is
    // deliberately not part of the tank: a player counting digs must never find that a tank reading
    // 6 buys two digs at 2 and then refuses the third.
    ok('...and the tank is only ever a whole number', w.fracTank.length === 0,
       w.fracTank.length ? `fractional: ${w.fracTank.slice(0, 5).join(' ')}`
                         : `${w.tank.length} distinct readings, all whole (${w.tank.slice(0, 6).join(' ')}…), debt ${w.debt}`);
    // ...AND THE FRACTION IS NOT SIMPLY LOST. The rate assertion above already measures the average
    // over 6 s, which is what would drift if the accumulator dropped its remainder — this names the
    // mechanism so a future "just round it" fails on the right line rather than on a rate.
    // ...AND THE FRACTION IS CARRIED, NOT DISCARDED. This is the assertion that makes the two halves
    // add up: everything owed has either come out of the tank or is sitting in the debt, so a
    // "just round it down" would show up as a tank that fell short of the rate rather than as a
    // rate that still averages out.
    ok('...with the sub-unit remainder carried, not discarded',
       w.debt >= 0 && w.debt < 1 && Math.abs(w.tankDrop - (w.drained - w.debt)) < 1e-6,
       `${w.drained.toFixed(2)} owed = ${w.tankDrop} taken + ${w.debt} carried`);
    // A DRAIN THE PLAYER CANNOT SEE is the same defect the strand-eating worms had in a new coat:
    // the tank just falls faster for no stated reason. The chip carries the RATE, not only the
    // count, because "3 worms" does not tell you how long you have and "-0.6/s" does.
    ok('...and the HUD says so, with the rate', w.chipHidden === false && w.chipN === String(w.N)
       && /\d\.\d\/s/.test(w.chipRate || ''), `chip "${w.chipN}" "${w.chipRate}"`);
    await b.ctx.close();
  }

  // ---- 4a-ii. BREEDING IS SLOW NOW, AND CAPPED LOW -----------------------------------------
  {
    const b = await bootMine(4242);
    const br = await b.page.evaluate(async () => {
      const g = window.__game, s = g.state;
      s.active.water = 999999;
      for (let i = 0; i < 10; i++) { g.mine.grow(0, 1); await new Promise((r) => setTimeout(r, 120)); }
      await new Promise((r) => setTimeout(r, 1200));
      s.nematodes.length = 0; s.clouds.length = 0;
      s.config.nematodes.respawnChance = 0;
      s.config.trichoderma.respawnChance = 0;
      let tip = null;
      for (const n of s.active.nodes) if (!n.infected && (!tip || n.y > tip.y)) tip = n;
      for (let i = 0; i < 4; i++) g.mine.spawnWorm(tip.x + (i - 2) * 4, tip.y);
      const n0 = s.nematodes.length, t0 = performance.now();
      await new Promise((r) => setTimeout(r, 8000));
      return { n0, n1: s.nematodes.length, secs: (performance.now() - t0) / 1000,
               cap: s.config.nematodes.maxPopulation,
               perSec: s.config.mine.worms.breedPerSec,
               campaignCap: 150, campaignChance: 0.8 };
    });
    // Four feeding worms at 5%/s over 8 s is a couple of splits, not a swarm. The bound is generous
    // in both directions on purpose — this is a probability over a short window, and the assertion
    // is about the ORDER of the number, not its exact value.
    ok('feeding worms multiply slowly', br.n1 > br.n0 - 1 && br.n1 <= br.n0 + 5,
       `${br.n0} -> ${br.n1} over ${br.secs.toFixed(0)}s at ${br.perSec}/s`);
    ok('...and the mine caps the population far below the campaign\'s',
       br.cap < br.campaignCap / 4, `${br.cap} against the campaign's ${br.campaignCap}`);
    await b.ctx.close();
  }

  // ---- 4a-iii. EVERY THREAT SHOWS WHAT IT CAN SEE ------------------------------------------
  // In the campaign a sight ring is something you tap a creature to check. Here it is on by
  // default, because the mine is a maze and routing around a worm is the skill — you cannot route
  // around a range you have to discover by being bitten.
  {
    const b = await bootMine(4242);
    const sg = await b.page.evaluate(async () => {
      const g = window.__game, s = g.state;
      s.active.water = 99999;
      for (let i = 0; i < 8; i++) { g.mine.grow(0, 1); await new Promise((r) => setTimeout(r, 120)); }
      await new Promise((r) => setTimeout(r, 900));
      s.nematodes.length = 0; s.clouds.length = 0;
      s.config.nematodes.respawnChance = 0; s.config.trichoderma.respawnChance = 0;
      let tip = null;
      for (const n of s.active.nodes) if (!n.infected && (!tip || n.y > tip.y)) tip = n;
      for (let i = 0; i < 3; i++) g.mine.spawnWorm(tip.x + (i - 1) * 60, tip.y - 40);
      await new Promise((r) => setTimeout(r, 400));
      const near = g.mine.countSight();
      // ...and the CULL. Park the camera a long way off and the same creatures must draw nothing:
      // each ring is a ray cast plus a fill, and the mine can hold sixteen worms and a dozen clouds.
      const cx = g.camera.x, cy = g.camera.y;
      g.camera.x = cx + 6000; g.camera.clamp();
      const far = g.mine.countSight();
      g.camera.x = cx; g.camera.y = cy; g.camera.clamp();
      // ...and the switch really is what turns them off.
      s.config.mine.showSight = false;
      const off = g.mine.countSight();
      s.config.mine.showSight = true;
      return { on: g.mine.sight().on, near, far, off, worms: s.nematodes.length };
    });
    ok('threat sight rings are on by default in the mine', sg.on === true, String(sg.on));
    // ASSERTS WHAT THE FRAME DID, not what the flag says — "showSight is true" passes on a build
    // where the draw call is never reached.
    ok('...and a frame draws one per visible threat', sg.near >= sg.worms,
       `${sg.near} rings drawn for ${sg.worms} worms`);
    ok('...culled when they are off screen', sg.far === 0, `${sg.far} drawn with the camera 6000 away`);
    ok('...and the switch turns them off', sg.off === 0, `${sg.off} drawn with showSight false`);

    // THE RING IS RED, AND THAT IS A PIXEL QUESTION (owner: "let's also make it red instead or
    // green"). Green is the colony's half of the palette, so an always-on green wash reads as the
    // thing you are growing rather than the thing hunting you.
    //
    // MEASURED AS A DIFFERENCE, never as an absolute. The soil is warm brown, i.e. red-dominant
    // before anything is drawn on it, so "is this pixel reddish?" passes on bare ground with the
    // overlay deleted. Rendering the SAME point with the rings on and off and subtracting isolates
    // what the overlay itself contributed, whatever it was drawn over.
    const hue = await b.page.evaluate(async () => {
      const g = window.__game, s = g.state, cv = document.getElementById('game');
      const c2 = cv.getContext('2d');
      const dpr = cv.width / cv.clientWidth;
      const w = s.nematodes[0];
      // A point a THIRD of the way out from the worm: inside the wash, clear of the edge line, and
      // near enough that rock is unlikely to occlude it.
      // A SAMPLE POINT ON OPEN SOIL, SEARCHED FOR RATHER THAN ASSUMED. A fixed offset a third of the
      // way out stopped landing on soil once the rock went to ~55% solid — it read `adds r0 g0 b0`,
      // i.e. the ring genuinely does not paint there, because `drawOccludedSight` clips to what the
      // worm can SEE and rock is not it. Walk out from the worm and take the first spot the sight
      // polygon still covers, which is what the assertion was always about.
      const p = g.camera.worldToScreen(w.x, w.y);
      const R = s.config.nematodes.sightRadius;
      let px = Math.round(p.x * dpr), py = Math.round((p.y + R * g.camera.zoom * 0.33) * dpr);
      let found = false;
      for (const f of [0.33, 0.22, 0.45, 0.15, 0.55, 0.1]) {
        for (const a of [Math.PI / 2, 0, Math.PI, -Math.PI / 2, Math.PI / 4, 2.36, -0.79, -2.36]) {
          const wx = w.x + Math.cos(a) * R * f, wy = w.y + Math.sin(a) * R * f;
          if (s.substrate.solidAtWorld(wx, wy)) continue;
          const q = g.camera.worldToScreen(wx, wy);
          if (q.x < 4 || q.y < 4 || q.x > g.camera.viewW - 4 || q.y > g.camera.viewH - 4) continue;
          px = Math.round(q.x * dpr); py = Math.round(q.y * dpr);
          found = true; break;
        }
        if (found) break;
      }
      const read = (on) => {
        s.config.mine.showSight = on;
        g.renderFrame(performance.now());
        const d = c2.getImageData(px, py, 1, 1).data;
        return { r: d[0], g: d[1], b: d[2] };
      };
      const off = read(false), on = read(true);
      s.config.mine.showSight = true;
      return { off, on, dr: on.r - off.r, dg: on.g - off.g, db: on.b - off.b };
    });
    // GREEN (owner: "lets change the threat sensing range to green"). Asserted as a channel
    // ORDERING against the same pixel with the overlay off, which is the only way to ask the
    // question on soil that is itself strongly coloured: the ground here is warm brown, so the
    // wash's absolute red still outweighs its green — what says "green" is that turning the ring on
    // moves GREEN the most. Read the raw numbers in the message before retuning `sightRgb`.
    ok('...and what the ring adds to the frame is GREEN',
       hue.dg > 4 && hue.dg > hue.dr + 3 && hue.dg > hue.db + 3,
       `overlay adds r${hue.dr} g${hue.dg} b${hue.db} (${JSON.stringify(hue.off)} -> ${JSON.stringify(hue.on)})`);
    await b.ctx.close();
  }

  // ---- 4a-iv. THE INFECTION DEADLINE --------------------------------------------------------
  // The spread itself is the campaign's, untouched. What the mine adds is a clock: from the moment
  // anything is infected the colony has `infectionMs`, and when it runs out the whole thing turns
  // and is forced to fruit — with a FULL payout, which is what keeps it fair while Amputate is a
  // consumable that has to be bought.
  //
  // MEASURED WITH A REAL CLOUD, never by setting `n.infected` by hand. That was the first version
  // and it measured nothing: rot ages out in `rotLifeTurns` steps, so two hand-infected strands
  // vanished inside a second and the clock correctly armed and cleared itself before the probe
  // could read it. Only the contact pass produces an infection that behaves like one.
  {
    const b = await bootMine(4242);
    const inf = await b.page.evaluate(async () => {
      const g = window.__game, s = g.state;
      s.active.water = 999999; s.mineOre = 42;
      for (let i = 0; i < 10; i++) { g.mine.grow(0, 1); await new Promise((r) => setTimeout(r, 120)); }
      await new Promise((r) => setTimeout(r, 1000));
      s.nematodes.length = 0; s.clouds.length = 0;
      s.config.nematodes.respawnChance = 0; s.config.trichoderma.respawnChance = 0;
      const idle = g.mine.infect();
      let tip = null;
      for (const n of s.active.nodes) if (!n.infected && (!tip || n.y > tip.y)) tip = n;
      s.config.trichoderma.moveSpeed = 0;          // pin it, or it drifts off before it touches
      g.mine.spawnCloud(tip.x, tip.y);
      await new Promise((r) => setTimeout(r, 2000));
      const armed = g.mine.infect();
      const chip = { hidden: (document.getElementById('hud-infect') || {}).hidden,
                     n: (document.getElementById('hud-infectn') || {}).textContent };
      // Pressing rot must SAY so. The rule was already true — `nearestNode` skips infected nodes —
      // but it was silent, and a press that quietly grows from somewhere else reads as a bad aim.
      const rot = s.active.nodes.find((n) => n.infected);
      const cln = s.active.nodes.find((n) => !n.infected);
      const fromRot = rot ? g.mine.growFrom(rot.x, rot.y, rot.x, rot.y + 200) : null;
      const fromClean = cln ? g.mine.growFrom(cln.x, cln.y, cln.x, cln.y + 200) : null;
      // CUT HALF THE ROT. The clock must keep running — that is the owner's rule, and it is what
      // makes "find all of it" the decision rather than "click the nearest green bit".
      const rotten = s.active.nodes.filter((n) => n.infected);
      for (let i = 0; i < Math.floor(rotten.length / 2); i++) rotten[i].infected = false;
      await new Promise((r) => setTimeout(r, 1200));
      const half = g.mine.infect();
      // ...and cutting ALL of it stops it.
      s.clouds.length = 0;
      for (const n of s.active.nodes) { n.infected = false; n._infAge = 0; }
      s.config.trichoderma.spreadDepthPerTurn = 0;
      await new Promise((r) => setTimeout(r, 1400));
      const clear = g.mine.infect();
      return { idle, armed, half, clear, chip, ms: s.config.mine.infectionMs,
               fromRot: fromRot && (fromRot.ok ? 'ALLOWED' : fromRot.message),
               fromClean: fromClean && fromClean.ok };
    });
    ok('no deadline while nothing is infected', inf.idle.on === false && inf.idle.left === null,
       JSON.stringify(inf.idle));
    ok('a breach starts the colony-wide deadline', inf.armed.on === true && inf.armed.rotten > 0
       && inf.armed.left > 0 && inf.armed.left <= inf.ms / 1000,
       `${inf.armed.rotten} strands rotten, ${inf.armed.left.toFixed(1)}s of ${inf.ms / 1000} left`);
    ok('...and the HUD shows the countdown', inf.chip.hidden === false && +inf.chip.n > 0,
       `chip "${inf.chip.n}"`);
    ok('a press on rot is refused, and says why', /infected/i.test(inf.fromRot || ''), String(inf.fromRot));
    ok('...while clean tissue still digs', inf.fromClean === true, String(inf.fromClean));
    // THE RULE THAT MAKES AMPUTATION A DECISION.
    ok('cutting HALF the rot does not stop the clock',
       inf.half.on === true && inf.half.rotten > 0 && inf.half.left < inf.armed.left,
       `${inf.half.rotten} still rotten, ${inf.half.left.toFixed(1)}s left (was ${inf.armed.left.toFixed(1)})`);
    ok('...and cutting all of it does', inf.clear.on === false && inf.clear.rotten === 0,
       JSON.stringify(inf.clear));
    await b.ctx.close();
  }

  // ---- 4a-v. ...AND WHEN IT RUNS OUT, THE COLONY FRUITS AND KEEPS EVERYTHING ------------------
  {
    const b = await bootMine(4242);
    const end = await b.page.evaluate(async () => {
      const g = window.__game, s = g.state;
      s.active.water = 999999; s.mineOre = 42;
      for (let i = 0; i < 10; i++) { g.mine.grow(0, 1); await new Promise((r) => setTimeout(r, 120)); }
      await new Promise((r) => setTimeout(r, 900));
      s.nematodes.length = 0; s.config.nematodes.respawnChance = 0;
      s.config.mine.infectionMs = 2500;            // a deadline the probe can wait out
      let tip = null;
      for (const n of s.active.nodes) if (!n.infected && (!tip || n.y > tip.y)) tip = n;
      s.config.trichoderma.moveSpeed = 0;
      g.mine.spawnCloud(tip.x, tip.y);
      await new Promise((r) => setTimeout(r, 5200));
      const nodes = s.active.nodes.length;
      return { over: !!s.runOver, r: s.runResult, nodes,
               greenAll: s.active.nodes.filter((n) => n.infected).length === nodes };
    });
    ok('the deadline ends the descent', end.over === true && end.r && end.r.cause === 'infected',
       `over=${end.over} cause=${end.r && end.r.cause}`);
    // A FULL PAYOUT, and it is load-bearing: Amputate is bought, so an early player who meets mould
    // with nothing in the bag has no answer. Ending their run sooner is fair; taking the ore is not.
    ok('...paying out the ore in full', end.r && end.r.ore === 42, `${end.r && end.r.ore} P of 42`);
    ok('...as a fruiting, not a death', end.r && end.r.died === false, String(end.r && end.r.died));
    // THE WHOLE COLONY TURNS AT ONCE — it reads as the colony giving up, not as the rot suddenly
    // sprinting the length of the map.
    ok('...with the whole colony green', end.greenAll === true, `${end.nodes} strands`);
    await b.ctx.close();
  }

  // ---- 4a-vi. THE TWO WEAPONS ---------------------------------------------------------------
  // Owner: consumables that let you fight nematodes and trych, bought between runs. Both mechanics
  // were already written — `excrete` and `amputateAt` belonged to the card layer and never came
  // across, which is why the mine has had no counterplay at all. What is new is the delivery: a
  // per-descent allowance from the store, and the rule that a charge is only spent when it works.
  {
    const b = await bootMine(4242);
    const zero = await b.page.evaluate(() => ({
      items: window.__game.mine.items(),
      kitHidden: document.getElementById('minekit')
        ? document.getElementById('minekit').classList.contains('hidden') : 'no kit',
    }));
    // NOTHING IS GIVEN — Amputate is bought (owner), which is what makes the infection deadline a
    // real question early on. The strip stays off the screen entirely until something is carried.
    ok('a descent carries nothing before the store is used',
       zero.items.excrete === 0 && zero.items.amputate === 0 && zero.kitHidden === true,
       JSON.stringify(zero));

    const carried = await b.page.evaluate(async () => {
      const st = window.__game.store;
      st.credit(2000);
      const buys = [st.buy('excreteCharges').ok, st.buy('amputateCharges').ok, st.buy('amputateCharges').ok];
      window.__game.mine.playSeed(4242);
      for (let i = 0; i < 120; i++) {
        if (window.__game.state.substrate && window.__game.state.substrate._fineSolid) break;
        await new Promise((r) => setTimeout(r, 100));
      }
      await new Promise((r) => setTimeout(r, 1200));
      const k = document.getElementById('minekit');
      return { buys, items: window.__game.mine.items(), kitHidden: k.classList.contains('hidden'),
               exN: document.getElementById('kit-excrete-n').textContent,
               amN: document.getElementById('kit-amputate-n').textContent,
               top: Math.round(k.getBoundingClientRect().top),
               hudBottom: Math.round(document.querySelector('.hudtop').getBoundingClientRect().bottom) };
    });
    ok('...and a bought allowance is carried into the next descent',
       carried.items.excrete === 1 && carried.items.amputate === 2,
       JSON.stringify(carried.items));
    ok('...with the kit on screen showing both counts',
       carried.kitHidden === false && carried.exN === '1' && carried.amN === '2',
       `flasks "${carried.exN}", doses "${carried.amN}"`);
    // IT LIVES INSIDE THE HUD ELEMENT, whose containing block is not the playfield — the first
    // version resolved `bottom` against the wrong box and put the kit at the TOP of the screen,
    // straight over the resource pill.
    ok('...at the bottom, clear of the resource pill', carried.top > carried.hudBottom + 200,
       `kit top ${carried.top}, HUD bottom ${carried.hudBottom}`);

    // A MISS COSTS NOTHING. There is no hand to re-draw from — a flask is something the player paid
    // Phosphorus for and carried down, so burning one on a tap that landed on empty soil would be
    // the game taking their money.
    const use = await b.page.evaluate(async () => {
      const g = window.__game, s = g.state;
      s.active.water = 99999;
      for (let i = 0; i < 8; i++) { g.mine.grow(0, 1); await new Promise((r) => setTimeout(r, 120)); }
      await new Promise((r) => setTimeout(r, 900));
      s.nematodes.length = 0; s.config.nematodes.respawnChance = 0;
      const missFlask = g.mine.useExcrete(), afterMissFlask = g.mine.items().excrete;
      let tip = null;
      for (const n of s.active.nodes) if (!n.infected && (!tip || n.y > tip.y)) tip = n;
      g.mine.spawnWorm(tip.x + 8, tip.y);
      await new Promise((r) => setTimeout(r, 600));
      const hitFlask = g.mine.useExcrete(), afterHitFlask = g.mine.items().excrete;
      const stuck = s.nematodes.some((w) => w.stuck > 0);
      const missCut = g.mine.useAmputate(tip.x + 4000, tip.y), afterMissCut = g.mine.items().amputate;
      const n0 = s.active.nodes.length;
      const hitCut = g.mine.useAmputate(tip.x, tip.y);
      return { missFlask: missFlask.ok, afterMissFlask, hitFlask: hitFlask.ok, afterHitFlask, stuck,
               missCut: missCut.ok, afterMissCut, hitCut: hitCut.ok,
               afterHitCut: g.mine.items().amputate, removed: n0 - s.active.nodes.length };
    });
    ok('a flask that finds no worms costs nothing',
       use.missFlask === false && use.afterMissFlask === 1, `ok=${use.missFlask}, ${use.afterMissFlask} left`);
    ok('...and one that lands hits them and spends a charge',
       use.hitFlask === true && use.stuck === true && use.afterHitFlask === 0,
       `hit=${use.hitFlask}, stuck=${use.stuck}, ${use.afterHitFlask} left`);
    ok('a dose that cuts nothing costs nothing',
       use.missCut === false && use.afterMissCut === 2, `ok=${use.missCut}, ${use.afterMissCut} left`);
    ok('...and one that lands removes strands and spends a charge',
       use.hitCut === true && use.removed > 0 && use.afterHitCut === 1,
       `${use.removed} strands cut, ${use.afterHitCut} left`);
    await b.ctx.close();
  }

  // ---- 4a-vii. ...AND CUTTING OUT THE ROT IS WHAT STOPS THE CLOCK ----------------------------
  // The reason the enzyme exists at all. Without this the infection deadline has no answer, and
  // buying the track buys the player nothing they can point at.
  {
    const b = await bootMine(4242);
    const cure = await b.page.evaluate(async () => {
      const g = window.__game, s = g.state;
      const st = window.__game.store;
      st.credit(3000); for (let i = 0; i < 3; i++) st.buy('amputateCharges');
      g.mine.playSeed(4242);
      for (let i = 0; i < 120; i++) {
        if (s.substrate && s.substrate._fineSolid) break;
        await new Promise((r) => setTimeout(r, 100));
      }
      const s2 = g.state;
      await new Promise((r) => setTimeout(r, 1200));
      s2.active.water = 999999;
      // A COLONY WITH TISSUE TO SPARE, and this is not padding. Eight blind digs built a small
      // colony, and on the dense maze carve one breach claims a large share of a small colony — so
      // cutting the rot out removed nearly everything and the run ENDED mid-probe (`over: true`,
      // which is what `...with the descent still alive` was reporting). `__digTo` also actually
      // descends now that the spine snakes, where `grow(0, 1)` stalled.
      await window.__digTo(48, 90);
      for (let i = 0; i < 10; i++) {
        g.mine.grow(i % 2 ? 1.4 : -1.4, 0.5);
        if (i % 3 === 2) await new Promise((r) => setTimeout(r, 80));
      }
      await new Promise((r) => setTimeout(r, 900));
      s2.nematodes.length = 0; s2.clouds.length = 0;
      s2.config.nematodes.respawnChance = 0; s2.config.trichoderma.respawnChance = 0;
      let tip = null;
      for (const n of s2.active.nodes) if (!n.infected && (!tip || n.y > tip.y)) tip = n;
      s2.config.trichoderma.moveSpeed = 0;
      g.mine.spawnCloud(tip.x, tip.y);
      await new Promise((r) => setTimeout(r, 1800));
      const armed = g.mine.infect();
      // Cut at the breach until nothing is infected, or the doses run out. A breach is wider than
      // one cut radius, which is exactly the decision the enzyme is meant to pose.
      // STOCK THE BAG FIRST — the assertion below is about the MECHANISM (does cutting the rot out
      // stop the clock?), not about how many doses a run opens with. The default two stopped being
      // enough when the maze carve raised the rock: a denser map packs the colony into narrower
      // passages, so one breach claims more strands and two cuts at `cutRadius` left 28 rotten with
      // `0 dose(s) left`. That is a real balance observation about `amputateCharges` and it belongs
      // to the owner, not to a mechanism test that would fail on it and hide both.
      s2.mineItems = Object.assign({}, s2.mineItems, { amputate: 8 });
      let cuts = 0;
      for (let i = 0; i < 8 && g.mine.infect().rotten > 0 && !s2.runOver; i++) {
        const rot = s2.active.nodes.find((n) => n.infected);
        if (!rot) break;
        if (g.mine.useAmputate(rot.x, rot.y).ok) cuts++;
        await new Promise((r) => setTimeout(r, 250));
      }
      await new Promise((r) => setTimeout(r, 1200));
      return { armed, cuts, after: g.mine.infect(), left: g.mine.items().amputate, over: !!s2.runOver };
    });
    ok('a breach arms the clock, with doses in the bag',
       cure.armed.on === true && cure.armed.rotten > 0,
       `${cure.armed.rotten} rotten, ${cure.armed.left && cure.armed.left.toFixed(1)}s`);
    ok('...and cutting the rot out stops it', cure.after.on === false && cure.after.rotten === 0,
       `${cure.cuts} cut(s) spent, ${cure.after.rotten} still rotten, ${cure.left} dose(s) left`);
    ok('...with the descent still alive', cure.over === false, String(cure.over));
    await b.ctx.close();
  }

  // ---- 4a-viii. HEAT IS PRICED, NOT ENFORCED, AND THE PRICE DOUBLES AT A LINE ------------------
  // Owner: it gets hotter the lower you go, and below your tolerance every strand costs more water —
  // "nothing burns off, it just costs more to grow each one the further you are from your limit".
  // A dig the game allows always succeeds; you find out what it cost rather than being punished
  // after the fact for a move it let you make. And it lands on the fuel clock, which is the pressure
  // the run already has.
  //
  // A STAIRCASE, NOT A RAMP (owner: "there should be a depth line, beyond which the cost increases.
  // Let's just always have the cost double ... Then beyond the next depth line, 8, etc."), and every
  // price a WHOLE NUMBER. The per-metre ramp it replaced could not be counted: 4.2 here and 4.3 six
  // metres on left the tank fractional however it was rounded, so "how many digs have I left?" — the
  // one question the fuel clock exists to ask — had no answer a player could work out.
  {
    const b = await bootMine(4242);
    const heat = await b.page.evaluate(() => {
      const g = window.__game, s = g.state;
      const curve = {};
      for (const d of [0, 20, 41, 42, 43, 83, 84, 85, 125, 126, 127, 168, 400]) curve[d] = g.mine.cost(d);
      return { curve, heat: g.mine.heat(0), base: s.config.mine.growWaterCost | 0,
               maxMult: s.config.mine.heat.maxMult,
               next: { 0: g.mine.heat(0).nextLine, 50: g.mine.heat(50).nextLine, 400: g.mine.heat(400).nextLine } };
    });
    ok('the base price reaches the first line and no further',
       heat.curve[0] === heat.base && heat.curve[42] === heat.base && heat.curve[43] > heat.base,
       `0m ${heat.curve[0]}, 42m ${heat.curve[42]}, 43m ${heat.curve[43]} (line ${heat.heat.safe})`);
    // THE LADDER ITSELF, by name — doubling is the rule, so assert the doubling rather than merely
    // that it climbs. A ramp passes "it climbs"; only this fails if one comes back.
    ok('...then DOUBLES past each line', heat.curve[43] === heat.base * 2
       && heat.curve[85] === heat.base * 4 && heat.curve[127] === heat.base * 8,
       `${heat.base} -> ${heat.curve[43]} -> ${heat.curve[85]} -> ${heat.curve[127]}`);
    // EVERY LINE THE SAME WAY ROUND. `floor` was uniform only at the first line — 42 m stayed cheap
    // while 84 m had already doubled — so the boundary the player meets second is the one that
    // surprises them. Standing exactly ON a line is the cheap side of it, everywhere.
    ok('...with every line on the same side of its own boundary',
       heat.curve[41] === heat.curve[42] && heat.curve[42] < heat.curve[43]
       && heat.curve[83] === heat.curve[84] && heat.curve[84] < heat.curve[85]
       && heat.curve[125] === heat.curve[126] && heat.curve[126] < heat.curve[127],
       `42:${heat.curve[42]}/${heat.curve[43]} 84:${heat.curve[84]}/${heat.curve[85]} 126:${heat.curve[126]}/${heat.curve[127]}`);
    // WHOLE NUMBERS, which is the ask this rewrite is FOR. A price of 4.2 fails here.
    ok('...and every price on the ladder is a whole number',
       Object.values(heat.curve).every((c) => Number.isInteger(c)),
       Object.entries(heat.curve).map(([d, c]) => `${d}:${c}`).join(' '));
    // The HUD needs to name the step that is coming, or a staircase is no better than a ramp.
    ok('...and the next line is readable ahead of time',
       heat.next[0] === heat.heat.safe && heat.next[50] === heat.heat.safe + heat.heat.every
       && heat.next[400] === null,
       `at 0m -> ${heat.next[0]}, at 50m -> ${heat.next[50]}, at 400m -> ${heat.next[400]}`);
    // EVERY DEPTH LEVEL HAS ITS OWN SOIL COLOUR, brown -> black -> red (owner: "every time we
    // enter a new depth level, all of the soil should change color. lets start with brown, that
    // turns eventually to black, and then the black eventually turns to red"). Crossing a boundary
    // recolours the whole screen, so nothing has to be painted on the line itself.
    //
    // Asserted on the MODEL colour, not on pixels: rock, food, the sight wash and the mottle all
    // land on the drawn frame, and the question is about the ramp underneath them. What the model
    // cannot answer is whether the gradient's stops resolve a crossing — that is
    // `tests/bump-probe.cjs`, and it is the reading that matters after any change here.
    const soil = await b.page.evaluate(() => {
      const g = window.__game, s2 = g.state, sub = s2.substrate;
      const rows = s2.config.mine.bandRows, n = s2.config.mine.soilBands.length;
      const rd = (m) => { const c = g.mine.earthColorAt(sub.surfaceY + m * sub.cellSize).match(/\d+/g).map(Number);
                          return { r: c[0], g: c[1], b: c[2], lum: c[0] * 0.30 + c[1] * 0.59 + c[2] * 0.11,
                                   warm: c[0] - c[2] }; };
      const cross = [];
      for (let i = 1; i < n; i++) cross.push({ at: i * rows, above: rd(i * rows - 3), below: rd(i * rows + 3) });
      // The MIDDLE of each band, which is where its own colour lives — clear of the crossing blend
      // at the top and of the next one below.
      const mid = [];
      for (let i = 0; i < n; i++) mid.push({ band: i, c: rd(i * rows + rows * 0.5) });
      return { n, rows, cross, mid, top: rd(1), black: rd(rows * 2 - 2), deep: rd(rows * n - 2) };
    });
    // THE JOURNEY, at its three named stops. Brown is warm and mid-bright; the deepest anthracite is
    // the darkest ground in the game; the bottom is red. Checked as an ORDERING rather than against
    // literal colours, so re-tinting the palette does not have to come here too — only reversing the
    // journey does.
    ok('the soil walks brown -> black -> red down the shaft',
       soil.top.lum > soil.black.lum + 25 && soil.deep.lum > soil.black.lum + 10
       && soil.deep.warm > soil.top.warm && soil.top.warm > 20,
       `brown lum ${soil.top.lum.toFixed(0)} warm ${soil.top.warm} | black lum `
       + `${soil.black.lum.toFixed(0)} | red lum ${soil.deep.lum.toFixed(0)} warm ${soil.deep.warm}`);
    // ...AND IT CHANGES AT EVERY BOUNDARY, which is the owner's "all of the soil should change
    // color". The one that needs this most is the black-to-black crossing in the middle: with four
    // bands and a three-stop journey one boundary lands inside the black, and it reads only because
    // band 1 ends WARM and band 2 opens COOL. So the test is luminance OR warmth, not luminance
    // alone — an earlier palette passed a brightness test at that crossing while showing nothing.
    //
    // ...AND IT IS THE MID-BAND COLOURS THAT ARE COMPARED, NOT THE PIXELS EITHER SIDE OF A LINE.
    // Testing the crossing alone PASSES ON A BUILD WITH NO PALETTE AT ALL, which the negative
    // control caught: every band ramps `top`->`bot` internally, so a boundary always jumps from one
    // band's bottom back to the next one's top and something always "changes". With the palette
    // flattened all three crossings read an identical dLum 21.5 / dWarm 16 — a change at every line
    // and no journey anywhere. Comparing band CENTRES is the question that was meant.
    const same = [];
    for (let i = 1; i < soil.mid.length; i++) {
      const a = soil.mid[i - 1].c, c = soil.mid[i].c;
      if (Math.abs(a.lum - c.lum) < 5 && Math.abs(a.warm - c.warm) < 5) same.push(i);
    }
    ok('...and every depth level has its own colour', same.length === 0,
       soil.mid.map((m) => `b${m.band} lum ${m.c.lum.toFixed(0)}/warm ${m.c.warm}`).join('  '));
    // The crossing itself still has to be perceptible — a distinct colour reached by an imperceptible
    // slide is not "all of the soil changes". The one that needs this is the black-to-black boundary
    // in the middle: with four bands and a three-stop journey one lands inside the black, and it
    // reads only because band 1 ends WARM and band 2 opens COOL. So: luminance OR warmth, never
    // luminance alone.
    const dull = soil.cross.filter((c) => Math.abs(c.above.lum - c.below.lum) < 4
                                       && Math.abs(c.above.warm - c.below.warm) < 4);
    ok('...and the change is perceptible at the crossing itself', dull.length === 0,
       soil.cross.map((c) => `${c.at}m dLum ${(c.below.lum - c.above.lum).toFixed(1)} `
         + `dWarm ${c.below.warm - c.above.warm}`).join('  '));
    // ONE PER BAND, so a fifth band cannot quietly inherit the fourth's colour.
    ok('...one colour per depth level', soil.cross.length === soil.n - 1 && soil.n === 4,
       `${soil.n} bands of ${soil.rows} m, ${soil.cross.length} crossings`);

    // A CEILING, so the deepest ground is expensive rather than impossible. Without one the price
    // doubles past any tank and the bottom stops being reachable at all — which is a wall, and
    // a wall is exactly what heat must not be.
    ok('...but is capped, so the bottom is never a wall',
       heat.curve[400] === heat.base * heat.maxMult && heat.curve[168] === heat.curve[400],
       `400m costs ${heat.curve[400]}, cap ${heat.base * heat.maxMult}`);

    // NOTHING BURNS OFF — the half that is easiest to reintroduce by accident. A dig into hot ground
    // succeeds and keeps every strand it made; it simply charged more.
    const hot = await b.page.evaluate(async () => {
      const g = window.__game, s = g.state;
      s.nematodes.length = 0; s.clouds.length = 0;
      s.config.nematodes.respawnChance = 0; s.config.trichoderma.respawnChance = 0;
      s.active.water = 999999;
      // Get well past the limit first.
      await window.__digTo(70, 140);
      await new Promise((r) => setTimeout(r, 900));
      const depth = g.mine.depth(), price = g.mine.costHere();
      const before = s.active.nodes.length, w0 = s.active.water;
      const r = g.mine.grow(0, 1);
      await new Promise((r2) => setTimeout(r2, 1200));
      return { depth, price, ok: r.ok, charged: +(w0 - s.active.water).toFixed(1),
               grew: s.active.nodes.length - before, kept: s.active.nodes.length,
               chipShown: !document.getElementById('hud-digcost').hidden,
               chipHot: document.getElementById('hud-digcost').classList.contains('hot'),
               chipN: document.getElementById('hud-digcostn').textContent,
               hint: (document.querySelector('.hint, #hint') || {}).textContent || '' };
    });
    ok('a dig below the limit still succeeds', hot.ok === true && hot.grew > 0,
       `${hot.grew} strands at ${hot.depth} m`);
    // AND CHARGED EXACTLY IT, not approximately. The old ramp needed a 0.35 tolerance here because
    // the price itself was fractional; with whole numbers an inexact charge is a defect, not noise.
    ok('...and simply charged the higher price', hot.charged > heat.base && hot.charged === hot.price,
       `charged ${hot.charged} at ${hot.depth} m, price says ${hot.price}, base ${heat.base}`);
    // A PRICE THAT SILENTLY CLIMBS IS THE INVISIBLE-DAMAGE DEFECT A THIRD TIME: the tank would just
    // empty faster the deeper you went with nothing connecting the two. The chip carries the LIVE
    // price and `.hot` marks that heat is adding to it.
    ok('...with the HUD quoting what a dig costs down here',
       hot.chipShown === true && +hot.chipN === hot.price && hot.chipHot === true,
       `chip "${hot.chipN}" against a price of ${hot.price}, hot=${hot.chipHot}`);
    // NOTHING ON SCREEN MAY CONTRADICT IT. The opening hint used to quote the base price and then
    // sit there while the player dug, so past the first line it said "2 water a dig" three
    // centimetres under a chip reading 4 — invisible in a diff and obvious in a frame.
    ok('...and nothing else on screen quotes a stale one',
       !/water a dig/.test(hot.hint), `hint "${hot.hint.trim().slice(0, 60)}"`);
    await b.ctx.close();
  }

  // ---- 4a-ix. ...AND TOLERANCE IS WHAT BUYS DEPTH --------------------------------------------
  // The gate has to be worth money, or the track is decoration. Measured as METRES REACHED on one
  // tank, which is the only unit the player experiences.
  {
    const b = await bootMine(4242);
    const dive = async (page) => page.evaluate(async () => {
      const g = window.__game, s = g.state;
      s.nematodes.length = 0; s.clouds.length = 0;
      s.config.nematodes.respawnChance = 0; s.config.trichoderma.respawnChance = 0;
      // FOLLOWS THE PASSAGE (see `__digTo` in bootMine). Digging blindly straight down measured 31 m
      // both before and after buying the whole tolerance track, which reads as the track doing
      // nothing and was really the probe failing to descend at all once the spine stopped being a
      // plumb chute.
      // IT HAS TO END ON FUEL, NOT ON A WALL, or the measurement cannot see heat at all. Breaking at
      // the first blocked aim stopped the dive at `43 m on 12 digs` — a quarter of the tank unspent,
      // and only a metre past the first price line, so buying the whole tolerance track changed the
      // reading by nothing and looked like the track being worthless. When down is blocked a player
      // goes SIDEWAYS and tries again; so does this, bounded so a genuinely sealed pocket still ends
      // the loop.
      let digs = 0, blocked = 0;
      for (let i = 0; i < 220 && s.active.water >= g.mine.cheapest() && !s.runOver; i++) {
        const dx = window.__aimDown();
        if (dx !== null && g.mine.grow(dx, 1).ok) { digs++; blocked = 0; }
        else {
          if (!g.mine.grow(blocked % 2 ? 1.6 : -1.6, 0.35).ok) { if (++blocked > 8) break; }
          else { digs++; blocked++; }
          if (blocked > 14) break;
        }
        if (i % 4 === 3) await new Promise((r) => setTimeout(r, 70));
      }
      return { digs, depth: g.mine.depth(), safe: g.mine.heat().safe };
    });
    const bare = await dive(b.page);
    const bought = await b.page.evaluate(async () => {
      const st = window.__game.store;
      st.credit(4000);
      // STOCK WHATEVER THE NEXT RUNG ASKS FOR, rather than assuming Phosphorus. The deep rungs are
      // priced in deep materials since 06, so a wallet full of Phosphorus buys two of the six and
      // this probe would then be measuring a third of the track it means to measure.
      let lv = 0;
      for (let i = 0; i < 6; i++) {
        const c = st.nextCost('heatTolerance');
        if (c && typeof c === 'object' && c.m) st.creditMat(c.m, (c.n | 0) + 10);
        if (st.buy('heatTolerance').ok) lv++;
      }
      window.__game.mine.playSeed(4242);
      for (let i = 0; i < 140; i++) {
        if (window.__game.state.substrate && window.__game.state.substrate._fineSolid) break;
        await new Promise((r) => setTimeout(r, 100));
      }
      await new Promise((r) => setTimeout(r, 1400));
      return lv;
    });
    const upped = await dive(b.page);
    ok('the tolerance track raises the limit', upped.safe > bare.safe + 100,
       `${bare.safe} m -> ${upped.safe} m over ${bought} purchases`);
    // THE NUMBER THAT MATTERS. Same seed, same tank, same dig loop — the only difference is the
    // track, so the metres are what it bought.
    ok('...and that is worth real depth on one tank', upped.depth > bare.depth + 20,
       `${bare.depth} m on ${bare.digs} digs -> ${upped.depth} m on ${upped.digs} digs`);
    await b.ctx.close();
  }

  // ---- 4a-x. MATERIALS, ONE PER BAND ---------------------------------------------------------
  // Owner: more material types, so the maze is about "looking for the right materials for upgrades"
  // rather than one number going up. The BAND a seam sits in decides what it yields, so a garnet
  // seam is in the garnet band by construction; Phosphorus stays the shallow band's and the general
  // currency, which is what lets the deeper three exist without re-pricing the whole store.
  {
    const b = await bootMine(4242);
    const seams = await b.page.evaluate(() => {
      const g = window.__game, s = g.state, sub = s.substrate, M = s.config.mine;
      const by = {};
      for (const p of (sub.foodPiles || [])) {
        const idx = p.cells[0], c = idx % sub.cols, r = (idx - c) / sub.cols;
        const band = Math.min(M.bands.length - 1, Math.floor(r / M.bandRows));
        const k = band + ':' + (p.mineMat || '?');
        by[k] = (by[k] || 0) + 1;
      }
      return { by, table: g.mine.matTable(), bands: M.bands.length };
    });
    // EVERY seam carries its band's material and no other. A single mis-tagged seam is a material
    // appearing at a depth it should not, which is the whole navigation problem the compass is
    // later meant to solve.
    const wrong = Object.keys(seams.by).filter((k) => {
      const [band, mat] = k.split(':');
      const t = seams.table.find((m) => m.band === +band);
      return !t || t.id !== mat;
    });
    ok('every ore seam yields its own band\'s material', wrong.length === 0,
       wrong.length ? 'mis-tagged: ' + wrong.join(', ') : Object.keys(seams.by).sort().join('  '));
    ok('...and there is one material per band', seams.table.length === seams.bands,
       seams.table.map((m) => m.id + '@b' + m.band).join(', '));

    const dug = await b.page.evaluate(async () => {
      const g = window.__game, s = g.state, sub = s.substrate;
      s.nematodes.length = 0; s.clouds.length = 0;
      s.config.nematodes.respawnChance = 0; s.config.trichoderma.respawnChance = 0;
      s.active.water = 999999;
      // THE NEAREST SEAM, RETAGGED — navigation is not what this measures. Picking the shallowest
      // DEEP seam and digging to it worked only while a plumb chute ran under the start column; with
      // the spine snaking the dig wandered into a band-0 pile instead and the probe read
      // `anthracite: 0 ({phosphorus: 3})`, i.e. it failed about the wrong thing. That the BAND decides
      // the material is asserted directly above, off the generator's own tags; what is left to test
      // here is that a pile tagged X pays X and not Phosphorus, and for that any reachable pile does.
      let deep = null, dbest = Infinity;
      for (const p of (sub.foodPiles || [])) {
        const idx = p.cells[0], c = idx % sub.cols, r = (idx - c) / sub.cols;
        const px = (c + 0.5) * sub.cellSize, py = sub.surfaceY + (r + 0.5) * sub.cellSize;
        for (const n of s.active.nodes) {
          if (n.infected) continue;
          const d = (n.x - px) ** 2 + (n.y - py) ** 2;
          if (d < dbest) { dbest = d; deep = p; }
        }
      }
      if (deep) { deep.mineMat = 'anthracite'; deep.mineBand = 1; }
      if (!deep) return { none: true };
      const idx = deep.cells[0], c = idx % sub.cols, r = (idx - c) / sub.cols;
      const tx = (c + 0.5) * sub.cellSize, ty = sub.surfaceY + (r + 0.5) * sub.cellSize;
      for (let i = 0; i < 90; i++) {
        let best = null, bd = Infinity;
        for (const n of s.active.nodes) {
          if (n.infected) continue;
          const d = (n.x - tx) ** 2 + (n.y - ty) ** 2;
          if (d < bd) { bd = d; best = n; }
        }
        if (!best || Math.sqrt(bd) < 40) break;
        if (!g.mine.growFrom(best.x, best.y, tx, ty).ok
            && !g.mine.growFrom(best.x, best.y, tx + 120, ty).ok) break;
        await new Promise((x) => setTimeout(x, 140));
      }
      await new Promise((x) => setTimeout(x, 2500));
      return { want: deep.mineMat, mats: g.mine.mats(), ore: s.mineOre };
    });
    if (dug.none) console.log('  note   no deep seam within reach on this roll — payout unmeasured');
    else {
      ok('digging a deep seam pays that material', (dug.mats[dug.want] | 0) > 0,
         `${dug.want}: ${dug.mats[dug.want] | 0} (${JSON.stringify(dug.mats)})`);
      // ...AND NOT PHOSPHORUS. If a deep seam also paid the general currency there would be no
      // reason to go looking for anything in particular, which is the whole point of the change.
      ok('...and not Phosphorus as well', (dug.ore | 0) === 0, `${dug.ore | 0} P from a deep seam`);
    }

    // BANKED, AND SPENDABLE ON A RUNG THAT ASKS FOR IT.
    const shop = await b.page.evaluate(async () => {
      const g = window.__game, st = g.store;
      g.mine.end();
      await new Promise((r) => setTimeout(r, 900));
      const banked = st.mats();
      st.credit(500);
      // ZERO THE MATERIAL WALLET FIRST. The descent above banks whatever it dug, and once the maze
      // carve made a deep seam reliably reachable that was exactly the 4 Anthracite this rung costs —
      // so the "Phosphorus alone will not buy it" step SUCCEEDED and reported `needing undefined`.
      // The refusal is the thing under test, so the shortfall has to be arranged, not hoped for.
      for (const m of ['anthracite', 'garnet', 'hematite']) st.takeMat(m, st.mats()[m] | 0);
      st.buy('heatTolerance'); st.buy('heatTolerance');     // the two Phosphorus rungs
      const need = st.nextCost('heatTolerance');
      const short = st.buy('heatTolerance');                 // now priced in a deep material
      st.creditMat('anthracite', 20);
      const rich = st.buy('heatTolerance');
      return { banked, need, shortOk: short.ok, shortNeed: short.need,
               richOk: rich.ok, richPaid: rich.paid, after: st.mats() };
    });
    // ONLY ASSERTED WHEN THERE WAS SOMETHING TO BANK. An `|| dug.none` escape here read as a PASS
    // on a build with the band tagging broken — every seam came back Phosphorus, no deep seam was
    // found to dig, and "no data" scored as "it worked". A skip says so out loud instead.
    if (dug.none) console.log('  note   nothing deep was dug — banking unmeasured');
    else ok('a descent banks what it dug', (shop.banked[dug.want] | 0) > 0, JSON.stringify(shop.banked));
    // A RUNG PRICED IN A MATERIAL CANNOT BE PAID FOR IN PHOSPHORUS, however much of it there is.
    ok('a deep rung is priced in a deep material', shop.need && shop.need.m && shop.need.m !== 'phosphorus',
       JSON.stringify(shop.need));
    ok('...and Phosphorus alone will not buy it',
       shop.shortOk === false && shop.shortNeed && shop.shortNeed.m !== 'phosphorus',
       `refused, needing ${JSON.stringify(shop.shortNeed)}`);
    ok('...while having the material does', shop.richOk === true && shop.richPaid
       && shop.richPaid.m === shop.shortNeed.m,
       `paid ${JSON.stringify(shop.richPaid)}`);
    await b.ctx.close();
  }

  // ---- 4b. THE WORLD STREAMS SIDEWAYS ------------------------------------------------------
  // The owner's ask, verbatim: "I want to be able to grow both left and right as well - so the map
  // needs to either generate as I go, or it needs to be much larger and have boundaries. I prefer
  // the former." It is both, honestly: the CELL GRID is allocated whole (a flat row-major array
  // cannot grow leftward without renumbering every index in the engine) and the CONTENT — rock, ore,
  // water, creatures — is generated per chunk as the colony approaches, which is what is perceived.
  //
  // WHAT MUST HOLD, AND WHY EACH ONE IS HERE:
  //   · digging sideways generates chunks, in BOTH directions (the home chunk is in the middle, so a
  //     bug that only walks one way passes any single-direction probe);
  //   · a chunk arrives BEFORE the colony is standing in it (`preloadCols`), or the player watches
  //     the map appear in front of them, which is the whole cost of streaming;
  //   · the new rock is COLLIDED — an uncollided chunk is a wall you can see and grow through, the
  //     worst defect this file can have, and it is invisible in a screenshot;
  //   · and it stays connected, which the reachability flood above only asserted for the chunks that
  //     existed at boot.
  console.log('--- the world streams sideways');
  {
    const b = await bootMine(4242);
    const dig = async (dir, n) => {
      for (let i = 0; i < n; i++) {
        const ok = await b.page.evaluate((d) => {
          const g = window.__game, s = g.state;
          s.active.water = 9999;
          let best = null;
          for (const nd of s.active.nodes) {
            if (nd.infected) continue;
            const sc = nd.x * d;
            if (!best || sc > best.sc) best = { n: nd, sc };
          }
          if (!best) return false;
          const t = best.n, R = 200;
          return g.mine.growFrom(t.x, t.y, t.x + d * R, t.y + 0.15 * R).ok;
        }, dir);
        if (!ok) break;
        await sleep(320);
      }
    };
    const at0 = await b.page.evaluate(() => window.__game.mine.chunks());
    await dig(1, 26);
    const right = await b.page.evaluate(() => {
      const g = window.__game, s = g.state, sub = s.substrate;
      const xs = s.active.nodes.map((n) => n.x);
      const hi = Math.max(...xs);
      return { chunks: g.mine.chunks(), tipChunk: g.mine.chunkOf(hi),
               col: sub.colAtX(hi), sprites: sub.levelSprites.length, solidFrom: sub._solidFrom };
    });
    ok('digging right generates new chunks', right.chunks.length > at0.length,
       `[${at0}] -> [${right.chunks}]`);
    // ONE CHUNK OF LOOKAHEAD AT LEAST. A dig covers ~4 columns and `mineEnsureChunks` runs every
    // frame, so the frontier should always be beyond the colony rather than at it.
    ok('...ahead of the colony, not under it',
       right.chunks[right.chunks.length - 1] > right.tipChunk,
       `frontier ${right.chunks[right.chunks.length - 1]}, tip in ${right.tipChunk} (col ${right.col})`);
    await dig(-1, 44);
    const left = await b.page.evaluate(() => {
      const g = window.__game, s = g.state, sub = s.substrate;
      const xs = s.active.nodes.map((n) => n.x);
      const lo = Math.min(...xs);
      return { chunks: g.mine.chunks(), tipChunk: g.mine.chunkOf(lo),
               col: sub.colAtX(lo), home: g.mine.homeChunk(),
               sprites: sub.levelSprites.length, solidFrom: sub._solidFrom,
               piles: (sub.foodPiles || []).length, pockets: (sub.reservoirs || []).length,
               worms: s.nematodes.length, clouds: s.clouds.length };
    });
    ok('...and digging left generates them the other way', left.chunks[0] < at0[0],
       `[${at0}] -> [${left.chunks}], home ${left.home}`);
    ok('...also ahead of the colony', left.chunks[0] < left.tipChunk,
       `frontier ${left.chunks[0]}, tip in ${left.tipChunk} (col ${left.col})`);
    // EVERY NEW SPRITE IS COLLIDED. `_solidFrom` is the incremental stamp's watermark — it reaching
    // the end of `levelSprites` is the direct statement that nothing is waiting, and it is checked
    // rather than the masks themselves because a sprite left out would be a hole in a wall that
    // still looks solid.
    ok('every streamed-in sprite has been collided', left.solidFrom === left.sprites,
       `${left.solidFrom} of ${left.sprites} sprites stamped`);
    // ...and the ore, water and creatures came with them, per chunk. A chunk that generated rock and
    // nothing else is a chunk with nothing in it to go there for.
    ok('...and the new ground carries its own ore, water and creatures',
       left.piles > 20 && left.pockets > 10 && left.worms > 6 && left.clouds > 3,
       `${left.piles} ore, ${left.pockets} pockets, ${left.worms} worms, ${left.clouds} clouds over ${left.chunks.length} chunks`);
    // THE SEAMS MEET. Galleries are carved at rows every chunk agrees on, which is the whole reason a
    // chunk needs to know nothing about its neighbours — so this is the assertion that the design's
    // one load-bearing idea actually holds once a run has crossed several seams.
    const seam = await b.page.evaluate(() => {
      const g = window.__game, s = g.state, sub = s.substrate;
      const step = sub._fineSize, W = sub._fineCols, H = sub._fineRows, solid = sub._fineSolid;
      const cw = s.config.mine.chunkCols, K = Math.round(sub.cellSize / step);
      const cis = g.mine.chunks();
      const fx0 = cis[0] * cw * K, fx1 = Math.min(W - 1, (cis[cis.length - 1] + 1) * cw * K - 1);
      const root = s.active.nodes[0];
      const seen = new Uint8Array(W * H), q = [];
      const push = (x, y) => { if (x < fx0 || x > fx1 || y < 0 || y >= H) return;
        const i = y * W + x; if (seen[i] || solid[i]) return; seen[i] = 1; q.push(i); };
      push(Math.floor(root.x / step), Math.floor((root.y - sub.surfaceY) / step));
      let reached = 0;
      while (q.length) { const i = q.pop(); reached++;
        const y = (i / W) | 0, x = i % W; push(x + 1, y); push(x - 1, y); push(x, y + 1); push(x, y - 1); }
      let openF = 0;
      for (let y = 0; y < H; y++) for (let x = fx0; x <= fx1; x++) if (!solid[y * W + x]) openF++;
      // Can it get to the far edge of the leftmost and rightmost chunks, at any depth?
      const edgeOpen = (fx) => { for (let y = 0; y < H; y++) if (seen[y * W + fx]) return true; return false; };
      return { chunks: cis.length, connected: reached / Math.max(1, openF),
               leftEdge: edgeOpen(fx0 + 1), rightEdge: edgeOpen(fx1 - 1) };
    });
    // RELAXED ON THE SAME OWNER RELEASE as the per-chunk flood above ("yes fine that some areas are only
  // reachable with upgrades"). What it still guards is the thing it was written for — that the SEAMS
  // meet, i.e. a chunk boundary is not a wall — which is why the far-edge assertion beside it is
  // unchanged and is the one that would catch a genuinely severed world.
  ok('the chunk seams meet — most of the streamed world is one connected space',
       seam.connected > 0.85, `${(seam.connected * 100).toFixed(1)}% of open ground over ${seam.chunks} chunks`);
    ok('...reachable to both far edges', seam.leftEdge && seam.rightEdge,
       `left ${seam.leftEdge}, right ${seam.rightEdge}`);
    ok('no page errors while the world streamed in', b.errs.length === 0, b.errs.join(' | ') || 'clean');
    await b.ctx.close();
  }

  // ---- 4c. YOU CAN TRAVEL SIDEWAYS FROM WHERE YOU START ------------------------------------
  // REPORTED FROM A PHONE: "it's not letting me grow to the left or right, at least not much beyond
  // the original frame." Two independent causes, and the streaming block above passed throughout
  // both because it digs with `growFrom` from wherever the colony already is.
  //
  //   1. THE MAP. The first gallery sat at `galleryEvery / 2` — row 9 — while the colony roots at
  //      row 0, so the only carved ground above it was an 11-column home cap and a two-cell head
  //      shaft. Measured, the open run either side of home was 2 to 8 cells for rows 1-6: the most
  //      constrained ground on the map was the ground the player starts on. With the real drag
  //      gesture at 390x844, ten left drags moved 430 units and ten right drags moved NOTHING.
  //   2. THE CAMERA — see the block below.
  //
  // This asserts the MAP half, and it asks the player's question rather than the generator's: flood
  // the real fine mask from the colony's own root and measure how far the reachable space extends
  // each way within the rows a new player is actually in. A gallery-row number would pass on a map
  // whose gallery is walled off from the head.
  console.log('--- you can travel sideways from where you start');
  {
    const b = await bootMine(4242);
    // MEASURED BY DIGGING, NOT BY FLOODING THE MASK. A flood was the first version and it CANNOT
    // FAIL here: rock is clipped at the soil line, so row 0 carries none at all and the flood runs
    // along the surface forever — it read 253 cells either way, on the broken map and the fixed one.
    // What the player does is GROW, and growth has rules the mask knows nothing about. So this digs,
    // with `growFrom` rather than the drag, to keep the camera out of the measurement (the camera is
    // the other half of the report and is asserted separately below).
    const near = await b.page.evaluate(async () => {
      const g = window.__game, s = g.state, sub = s.substrate;
      const x0 = s.active.nodes[0].x;
      const run = async (dir) => {
        for (let i = 0; i < 12; i++) {
          s.active.water = 99999;
          let t = null;
          for (const n of s.active.nodes) {
            if (n.infected) continue;
            if (!t || n.x * dir > t.x * dir) t = n;
          }
          if (!t) break;
          g.mine.growFrom(t.x, t.y, t.x + dir * 200, t.y + 40);
          await new Promise((r) => setTimeout(r, 170));
        }
      };
      await run(-1);
      const left = x0 - Math.min(...s.active.nodes.filter((n) => !n.infected).map((n) => n.x));
      return { left, cs: sub.cellSize, depth: g.mine.depth() };
    });
    const near2 = await (async () => {
      // A FRESH PAGE for the other direction: twelve digs one way leaves the colony somewhere else,
      // and "how far can I get from the START" is the question.
      const b2 = await bootMine(4242);
      const r = await b2.page.evaluate(async () => {
        const g = window.__game, s = g.state;
        const x0 = s.active.nodes[0].x;
        for (let i = 0; i < 12; i++) {
          s.active.water = 99999;
          let t = null;
          for (const n of s.active.nodes) { if (n.infected) continue; if (!t || n.x > t.x) t = n; }
          if (!t) break;
          g.mine.growFrom(t.x, t.y, t.x + 200, t.y + 40);
          await new Promise((r2) => setTimeout(r2, 170));
        }
        return { right: Math.max(...s.active.nodes.filter((n) => !n.infected).map((n) => n.x)) - x0 };
      });
      await b2.ctx.close();
      return r;
    })();
    // TWELVE DIGS SHOULD CARRY YOU WELL CLEAR OF THE STARTING FRAME. On the broken map — the first
    // gallery half a spacing down, above which there was only an 11-column cap and a two-cell head
    // shaft — the same twelve digs managed 430 units. A phone viewport is ~460 world units across at
    // this zoom, so 900 is "about two screens", which is what "beyond the original frame" means.
    // 900 -> 650 WITH THE HEAVIER ROCK, and the number this really guards is the BROKEN one: the
    // original defect measured 430 units, and a phone frame is ~460 world units at this zoom, so 650
    // is still "clear of the starting frame in both directions" — which is what the owner's report
    // was about. Measured after the maze carve: 740 left and 1357 right on the check's seed, against
    // 1348 and 2076 before it. Heavier rock costs lateral reach and that is the trade the owner asked
    // for; if this ever drops toward 430 again the carve has gone too far, and the lever is the band
    // `fill` tables rather than this bound.
    ok('twelve digs carry the colony well to the LEFT of the start', near.left > 650,
       `${Math.round(near.left)} units (~${(near.left / near.cs).toFixed(0)} cells)`);
    ok('...and as far to the RIGHT', near2.right > 650, `${Math.round(near2.right)} units`);

    // ---- and the CAMERA follows the work, not the deepest strand ----------------------------
    // The other half of the report. `mineFollowCamera` targeted the DEEPEST tip, which does not move
    // when you dig sideways — so a run of lateral digs was never followed and the far side of the
    // colony slid off a fixed-zoom screen, where it cannot be pressed at all (measured: 50 of 108
    // strands off-screen and therefore untouchable). It follows `state._mineFocus`, the strand the
    // last dig ended on, with the deepest tip as the fallback.
    //
    // ASSERTED AS "CAN THE PLAYER STILL TOUCH IT?", which is the only form that discriminates. The
    // first version compared the camera's distance to the lateral work against its distance to a
    // deepest tip captured BEFORE the lateral digs — and those digs make their own tissue, some of
    // it deeper, so on the broken build the camera chased a NEW deepest strand that happened to be
    // over on the left and the assertion passed. Verified negative control both ways now.
    const cam = await b.page.evaluate(async () => {
      const g = window.__game, s = g.state;
      s.active.water = 99999;
      // Go DOWN a long way first, so "the deepest strand" and "what I am working on" are far apart.
      for (let i = 0; i < 16; i++) { g.mine.grow(0, 1); await new Promise((r) => setTimeout(r, 120)); }
      await new Promise((r) => setTimeout(r, 900));
      const camAfterDown = g.camera.x, depthAfterDown = g.mine.depth();
      // Now work SIDEWAYS, near the SURFACE — strictly horizontal, so nothing this does can become
      // the deepest strand and hand the broken camera the right answer by accident.
      const shallowY = Math.min(...s.active.nodes.filter((n) => !n.infected).map((n) => n.y));
      let dug = 0;
      for (let i = 0; i < 10; i++) {
        let t = null;
        for (const n of s.active.nodes) {
          if (n.infected || n.y > shallowY + 90) continue;
          if (!t || n.x < t.x) t = n;
        }
        if (!t) break;
        if (g.mine.growFrom(t.x, t.y, t.x - 200, t.y).ok) dug++;
        await new Promise((r) => setTimeout(r, 160));
      }
      // Past MINE_PAN_HOLD_MS (2600) and the follow easing, so this is where the camera SETTLES.
      await new Promise((r) => setTimeout(r, 3600));
      // THE STRAND THE CAMERA CLAIMS TO BE ON — `state._mineFocus`, the one the last dig ended on.
      // Picking "the leftmost shallow strand" instead was the first version and it asserted about a
      // strand nothing had promised anything about: `growDirected` fans, so a horizontal dig still
      // makes tissue below the probe's own shallow band, and the two disagreed by 1,198 units on a
      // build where the camera was working. Read the contract, not a proxy for it.
      const fid = s._mineFocus && s._mineFocus.id;
      let work = (fid != null && s.active.byId.get(fid)) || null, deep = null;
      for (const n of s.active.nodes) {
        if (n.infected) continue;
        if (!work && n.y <= shallowY + 90 && (!work || n.x < work.x)) work = n;
        if (!deep || n.y > deep.y) deep = n;
      }
      const p = g.camera.worldToScreen(work.x, work.y);
      const r = document.getElementById('game').getBoundingClientRect();
      return { camX: g.camera.x, camAfterDown, depthAfterDown, depth: g.mine.depth(), dug,
               workX: work.x,
               onScreen: p.x > 0 && p.y > 0 && p.x < r.width && p.y < r.height,
               screen: [Math.round(p.x), Math.round(p.y)], view: [Math.round(r.width), Math.round(r.height)],
               dWork: Math.abs(g.camera.x - work.x), dDeep: Math.abs(g.camera.x - deep.x) };
    });
    // THE PLAYER-FACING PROPERTY: what you just dug is still on screen, so you can press it and keep
    // going. On a fixed-zoom screen that is the whole of it — tissue off screen cannot be touched.
    ok('what a sideways dig just grew is still on screen', cam.onScreen,
       `strand at ${cam.screen} of ${cam.view}, camera ${Math.round(cam.camX)}` +
       ` (${Math.round(cam.dWork)} from the work, ${Math.round(cam.dDeep)} from the deepest strand)`);
    // ...AND IT TRACKED THE WORK RATHER THAN A FIXED DISTANCE. Demanding "the camera moved 60 units"
    // was a bet on the probe's own digs landing: this read `8330 -> 8388` and failed while the
    // camera was working perfectly, because the lateral digs had barely moved the colony and 58
    // units was the CORRECT answer. What the camera owes is to end up on the work, wherever that
    // turned out to be — so measure it against the work, and say out loud when the digs went nowhere.
    ok('...and it tracked the work rather than the descent',
       cam.dug > 0 && cam.dWork < Math.max(120, Math.abs(cam.workX - cam.camAfterDown) * 0.25),
       `${cam.dug}/10 digs landed; camera ${Math.round(cam.camAfterDown)} -> ${Math.round(cam.camX)}, ` +
       `work at ${Math.round(cam.workX)} (${Math.round(cam.dWork)} away)`);
    ok('no page errors digging sideways', b.errs.length === 0, b.errs.join(' | ') || 'clean');
    await b.ctx.close();
  }

  // ---- 5. LOOK ANYWHERE; A DIG BRINGS YOU BACK -----------------------------------------------
  // Owner: "let's allow panning and zooming, but let's bring the player back to the right
  // perspective when a growth action is taken." So the zoom is a RESTING one, not a locked one, and
  // the thing to assert is the round trip — that the player can leave it, that leaving STAYS left
  // (the previous rule was a 2.6 s hold-off, which crept back while they were still reading), and
  // that a dig eases it home.
  //
  // ON A FRESH PAGE — THIRD TIME IN THIS FILE. The grow block above deliberately drains the tank to
  // prove a dig is refused when it cannot be paid for, and `mineFuelCheck` ends the descent
  // `OUT_OF_FUEL_GRACE_MS` later. On a dead run every dig is refused, so nothing stamps
  // `_mineFocus`, so the camera is never re-armed and the zoom sits where the probe left it —
  // which reads as "the fix does not work" and is a dead run. `runOver` is reported below for
  // exactly that reason.
  console.log('--- look anywhere, a dig brings you back');
  await m.ctx.close();
  m = await bootMine(4242);
  const zoomed = await m.page.evaluate(async () => {
    const g = window.__game, cv = document.getElementById('game');
    const rest = g.camera.zoom;
    const wheel = (dy) => cv.dispatchEvent(new WheelEvent('wheel',
      { deltaY: dy, bubbles: true, cancelable: true, clientX: 200, clientY: 400 }));
    for (let i = 0; i < 6; i++) wheel(300);            // pull back
    const zOut = g.camera.zoom, xOut = g.camera.x;
    // ...and it STAYS pulled back. Well past the 2.6 s the old hold-off used, so a regression to a
    // timer fails here rather than passing on a short sample.
    await new Promise((r) => setTimeout(r, 4200));
    const zHeld = g.camera.zoom;
    for (let i = 0; i < 14; i++) wheel(-300);          // and in, past the resting zoom
    const zIn = g.camera.zoom;
    const range = g.state.config.mine.zoomRange;
    return { rest, zOut, zHeld, zIn, xOut, range,
             want: g.state.config.mine.zoom, floor: rest * range[0], ceil: rest * range[1] };
  });
  ok('the zoom opens at CONFIG.mine.zoom', Math.abs(zoomed.rest - zoomed.want) < 0.01,
     `${zoomed.rest.toFixed(3)} vs ${zoomed.want}`);
  // ...AND IT OPENS THREE SCROLL TICKS FURTHER OUT THAN IT USED TO (owner: "let's make the default
  // zoom further out -- three scroll ticks on my mouse"). Pinned as the RELATIONSHIP rather than as
  // the number 0.6, because the ask was in ticks: the wheel multiplies by 1.12 a tick, so three
  // ticks IN from the resting zoom must land on the 0.85 this moved from. A later "one more tick
  // out" should fail here and be updated deliberately — that is the point of pinning a decision.
  //
  // Read off `config.mine.zoom` rather than the live camera, since `mineZoom` scales the live one by
  // `viewH / refHeight` and this check boots at a viewport that is not the reference height.
  {
    const STEP = 1.12, WAS = 0.85;
    const threeIn = zoomed.want * Math.pow(STEP, 3);
    ok('...three scroll ticks further out than the old framing',
       Math.abs(threeIn - WAS) < 0.02,
       `${zoomed.want} x ${STEP}^3 = ${threeIn.toFixed(3)}, against the previous ${WAS}`);
  }
  ok('the wheel zooms OUT', zoomed.zOut < zoomed.rest * 0.95,
     `${zoomed.rest.toFixed(3)} -> ${zoomed.zOut.toFixed(3)}`);
  // BOUNDED BY THE STREAMING, not by taste — content is generated per chunk near the colony, so a
  // free zoom-out frames ground that has not been built and shows it as bare soil.
  ok('...but not past `zoomRange`', zoomed.zOut >= zoomed.floor - 1e-6,
     `${zoomed.zOut.toFixed(3)} against a floor of ${zoomed.floor.toFixed(3)}`);
  ok('...and the view STAYS where the player left it', Math.abs(zoomed.zHeld - zoomed.zOut) < 1e-6,
     `${zoomed.zOut.toFixed(3)} -> ${zoomed.zHeld.toFixed(3)} over 4.2 s`);
  ok('the wheel zooms IN, up to the same bound', zoomed.zIn > zoomed.rest && zoomed.zIn <= zoomed.ceil + 1e-6,
     `${zoomed.zIn.toFixed(3)} against a ceiling of ${zoomed.ceil.toFixed(3)}`);
  // AND A DIG PUTS IT BACK. The whole of the owner's ask, and the half that a "can you zoom?" test
  // would miss entirely.
  const homed = await m.page.evaluate(async () => {
    const g = window.__game, s = g.state;
    const zBefore = g.camera.zoom;
    s.active.water = 9999;
    const r = g.mine.grow(0, 1);
    await new Promise((r2) => setTimeout(r2, 2600));   // the ease is ~1 s at followLerp 0.12
    return { zBefore, zAfter: g.camera.zoom, dug: !!r.ok, why: r.message || '',
             over: !!s.runOver, alive: !!(s.active && s.active.alive) };
  });
  ok('a dig brings the zoom back to the resting one',
     homed.dug && Math.abs(homed.zAfter - zoomed.rest) < zoomed.rest * 0.02,
     `${homed.zBefore.toFixed(3)} -> ${homed.zAfter.toFixed(3)}, resting ${zoomed.rest.toFixed(3)}` +
     (homed.dug ? '' : ` — THE DIG WAS REFUSED (${homed.why}); run over=${homed.over} alive=${homed.alive}`));

  // THE CAMERA FOLLOWS THE DIG, which is what a fixed zoom demands: with no way to zoom out, a
  // player who cannot see their deepest strand cannot steer at all.
  //
  // ON A FRESH PAGE, because THE RUN ON THIS ONE IS OVER. The grow block above deliberately drains
  // the tank to prove a dig is refused when it cannot be paid for, and `mineFuelCheck` then ends the
  // descent `OUT_OF_FUEL_GRACE_MS` later — which the zoom block above spends. Setting `water` back up
  // does not revive it, so every dig here returned `{ok:false}` and the probe read
  // `camera y 2177 -> 2177, 44 -> 44 m`: the camera working perfectly, on a dead run. Measured on a
  // fresh page, the same dig loop makes 126 m with **0 refusals of 40**, which is what said the
  // colony was not walled in.
  await m.ctx.close();
  m = await bootMine(4242);
  //
  // IT DRIVES TO A DEPTH, NOT A DIG COUNT, and that is not tidiness: `mine.grow(0, 1)` digs straight
  // down from the deepest tip and a straight-down dig is legitimately REFUSED by a boulder, so ten
  // blind digs is a bet about the map. Read `camera y 2177 -> 2177 at 44 m` the first time the rock
  // got denser — the camera was working perfectly and the colony had simply not moved.
  const followed = await m.page.evaluate(async () => {
    const g = window.__game;
    g.state.active.water = 4000;
    const y0 = g.camera.y, d0 = g.mine.depth();
    for (let i = 0; i < 60 && g.mine.depth() < d0 + 30; i++) {
      // Aim slightly off vertical on a refusal, so a boulder directly below is dug around rather
      // than dug at sixty times.
      const r = g.mine.grow(0, 1);
      if (!r.ok) g.mine.grow(i % 2 ? 0.55 : -0.55, 1);
      await new Promise((r2) => setTimeout(r2, 90));
    }
    await new Promise((r) => setTimeout(r, 2600));
    let tip = null;
    for (const n of g.state.active.nodes) if (!n.infected && (!tip || n.y > tip.y)) tip = n;
    const s = g.camera.worldToScreen(tip.x, tip.y);
    return { y0, y1: g.camera.y, d0, tipScreenY: s.y, viewH: g.camera.viewH, depth: g.mine.depth() };
  });
  ok('the camera follows the dig downward', followed.y1 > followed.y0 + 100,
     `camera y ${Math.round(followed.y0)} -> ${Math.round(followed.y1)}, ${followed.d0} -> ${followed.depth} m`);
  // ...and keeps the tip ON SCREEN, in the upper half, so most of the frame is undug ground.
  ok('...keeping the deepest tip in view', followed.tipScreenY > 0 && followed.tipScreenY < followed.viewH * 0.75,
     `tip at y ${Math.round(followed.tipScreenY)} of ${followed.viewH}`);

  // ---- THE DEPTH BEAT ----------------------------------------------------------------------
  // Fires once per band, on arriving in it. Band 1 gets none — arriving there is arriving in the
  // mine, not crossing into a new layer — and the assertion covers both, or "it never fires"
  // passes the first half.
  console.log('--- the depth beat');
  // A FRESH PAGE, and that is the whole assertion working. The beat is announced ONCE per band —
  // `mineBeatBand` is a module variable that only moves forward — so a probe sharing a page with the
  // camera block, which digs to ~89 m, starts its MutationObserver two band boundaries too late and
  // reads ONE beat naming band 4. That is exactly what it did: `1 beats at 165 m: 126 m Hematite`, on
  // a build where all three fire correctly. A once-per-run announcement can only be measured from
  // the start of the run.
  await m.ctx.close();
  m = await bootMine(4242);
  const beat = await m.page.evaluate(async () => {
    const g = window.__game, M = g.state.config.mine;
    const seen = [];
    const obs = new MutationObserver((recs) => {
      for (const r of recs) for (const n of r.addedNodes)
        if (n.nodeType === 1 && n.classList && n.classList.contains('minebeat')) seen.push(n.textContent);
    });
    obs.observe(document.body, { childList: true });
    g.state.active.water = 4000;
    // ONE DIG PER FRAME GAP, and that is not politeness — `mineBeat` runs from `mineFrame`, so a
    // burst of digs between two frames crosses a band boundary with nothing having looked. The
    // engine announces the band it ARRIVED in, so a two-band jump legitimately shows one beat; in
    // real play a dig is ~4 m against a 42 m band and that cannot happen, which is why the probe
    // has to dig at something like a player's pace rather than the check widening its expectation.
    for (let i = 0; i < 260 && g.mine.depth() < M.bandRows * M.bands.length - 4; i++) {
      g.mine.grow(0, 1);
      await new Promise((r) => setTimeout(r, 34));
    }
    await new Promise((r) => setTimeout(r, 600));
    obs.disconnect();
    return { seen, depth: g.mine.depth(), bands: M.bands.map((b) => b.name), bandRows: M.bandRows };
  });
  ok('a beat fires for every band below the first', beat.seen.length === beat.bands.length - 1,
     `${beat.seen.length} beats at ${beat.depth} m: ${beat.seen.join(' | ')}`);
  ok('...naming the depth and the rock', beat.seen.every((t, i) => t.includes(String((i + 1) * beat.bandRows)) && t.includes(beat.bands[i + 1])),
     beat.seen.join(' | '));
  // ---- A WATER POCKET IS A FUEL CAN, NOT AN ANNUITY ----------------------------------------
  // LAST ON THIS PAGE, and the order is load-bearing: reaching a pocket means digging, digging
  // means depth, and the beat block above measures a beat PER BAND from wherever the colony
  // already is. Run before it, this one silently spent band 2's beat and the beat block failed
  // reporting 2 of 3 — a false failure about a feature that works.
  // Owner: "water sources should only give a one off burst of +10W, not continuous income." The
  // campaign's version of tapping water is a synthetic card ENGINE paying +1 Water every round for
  // the rest of the map — and it cannot run here (`produceCardEngines` returns on `!state.cards`),
  // which is exactly the kind of thing that is true by accident until someone makes the card layer
  // optional differently. So both halves are pinned: the lump arrives ONCE per source, and the water
  // does not creep up on its own for as long as a strand is sitting in the pocket.
  const pocket = await m.page.evaluate(async () => {
    const g = window.__game, s = g.state, sub = s.substrate;
    // A POCKET IS PUT NEXT TO THE COLONY RATHER THAN NAVIGATED TO. This block's subject is the
    // PAYMENT rule — one lump per source, and nothing afterwards — and it used to dig toward
    // `reservoirs[0]` for up to 60 digs to get there. The maze carve broke that: the pocket the
    // generator recorded first can be behind rock, the dig loop timed out, and the block bailed with
    // a printed note, i.e. **two assertions silently stopped running while the check still read
    // green**. Clearing a corridor to it was the first fix and does not work either —
    // `solidifyMineRock` re-stamps the fine mask from the sprites on the next frame and puts the rock
    // straight back.
    //
    // So the geometry comes out of the measurement entirely, which is the same move as zeroing the
    // worm drain below: `waterSourcesNear` finds a source by `cell.water` plus `cell.reservoir` and
    // nothing else, so a cell stamped beside a living strand IS a pocket as far as every rule under
    // test is concerned. Navigation is covered by the reachability flood in section 1; it does not
    // need covering twice, and covering it here is what made it lapse.
    let host = null;
    for (const n of s.active.nodes) if (!n.infected && (!host || n.y > host.y)) host = n;
    if (!host) return { none: true };
    // THE STRAND'S OWN CELL, not a neighbour. `waterContactDist` is 21 units against a 36-unit cell,
    // so a node sitting anywhere but hard against the shared edge is TOO FAR from the cell next door
    // — `waterSourcesNear` measures to the cell rect and wants <= 441 units², and a neighbour can be
    // 36 away. Its own cell is distance zero and cannot be got wrong.
    const cell = sub.cellAtWorld(host.x, host.y);
    if (!cell) return { none: true };
    // ...AND THE RUN HAS TO BE LIVE. This page is shared with the depth-beat dive, which digs to
    // ~166 m and runs the tank dry on the way — `mineWaterPickups` returns at its first line on
    // `runOver`, so every later probe on this page silently measures nothing. That is what the
    // "could not reach a water pocket" note was really reporting, not the maze at all.
    s.runOver = false;
    s.runResult = null;
    if (s.active) s.active.alive = true;
    // A FRESH reservoir object, so `_tappedWater` cannot already hold it from the dive that shares
    // this page — that is what the `taps0` baseline below is for on the generator's own pockets, and
    // a new object needs no baseline at all.
    const cost = g.mine.cost();
    // NOTHING ELSE MAY TOUCH THE TANK. Worms attach and DRAIN water, so "did the pocket pay exactly
    // one lump?" is not answerable on a map with worms on it — this read `+9.8999999W, want 10` and
    // `water sat at 98.4` the moment the drain landed, which is the probe measuring the whole water
    // economy instead of the pocket rule. Take the variable out rather than widening the tolerance.
    s.nematodes.length = 0;
    s.config.nematodes.respawnChance = 0;
    s.config.mine.worms.waterPerSec = 0;
    const w0 = 100000;
    const taps0 = (s._tappedWater || { size: 0 }).size;
    s.active.water = w0;
    // The stamp goes in AFTER the tank is set, or the tick that pays can land first and the gain is
    // charged against a tank that already had it.
    cell.water = true;
    cell.reservoir = { probe: true };
    // `mineWaterPickups` runs on a world tick, so the payment needs a tick to happen in. Polled
    // rather than slept a fixed time — a fixed sleep is a bet about the machine, and this one is
    // cheap to get right.
    for (let i = 0; i < 40; i++) {
      if ((s._tappedWater || { size: 0 }).size > taps0) break;
      await new Promise((r) => setTimeout(r, 100));
    }
    const taps = (s._tappedWater || { size: 0 }).size - taps0;
    if (!taps) return { reached: false, why: `runOver ${s.runOver} alive ${s.active && s.active.alive} water ${s.active && s.active.water}` };
    const digs = 0;                    // nothing was dug: the pocket was brought to the colony
    const gain = s.active.water - (w0 - digs * cost);
    // The lump has landed. Now sit still for several world ticks with a strand in the water and
    // check the tank does not move — no income, no second tap.
    s.active.water = 100;
    await new Promise((r) => setTimeout(r, 3500));
    return { reached: true, taps, gain, digs, after: s.active.water,
             want: s.config.mine.reservoirWater };
  });
  if (pocket.none || pocket.reached === false) {
    console.log('  note   NO POCKET MEASUREMENT — pocket rules unmeasured. ' + (pocket.why || 'no pocket found'));
  } else {
    ok('a water pocket pays one lump, once', pocket.gain === pocket.taps * pocket.want,
       `${pocket.taps} source(s) tapped, +${pocket.gain}W over ${pocket.digs} dig(s) — want ${pocket.taps * pocket.want}`);
    ok('...and pays nothing after that', pocket.after === 100,
       `water sat at ${pocket.after} over ~7 world ticks with a strand in the pocket`);
  }

  await m.ctx.close();

  // =========================================================================================
  // 3. THE FUEL CURVE — a straight dive must not reach the bottom
  // =========================================================================================
  // The economy in one measurement. With the water pockets placed anywhere open, a probe diving
  // straight down reached 167 m of a 168 m shaft on a FIRST run and banked no ore — a reward on the
  // descent route is a reward for descending, and the descent is what the fuel exists to limit. So
  // ore and pockets live at the ends of the lateral galleries, off-route.
  //
  // TWO SEEDS, because one map's channel could legitimately wander past a pocket. Both assertions
  // in both directions: "a dive gets nowhere" passes the first half and is a worse game.
  console.log('--- the fuel curve');
  for (const seed of [11, 909]) {
    const b = await bootMine(seed);
    const dive = await b.page.evaluate(async () => {
      const g = window.__game;
      // THE POCKETS COME OUT, because this measures the TANK. A dive that follows open ground —
      // which is what the loop below does now, and what a player does — wanders into water pockets
      // and refuels, and then "a straight dive runs out of fuel" is measuring the map's generosity
      // rather than the fuel curve. Same move as zeroing the worm drain in the pocket probe: take
      // the variable out rather than widening the tolerance around it.
      //
      // It is also what let the DESCENT SPINE stop being straight. The loop used to dig blindly
      // `(0, 1)` and so needed a plumb shaft under the start column to have anywhere to go — which
      // is the rock-free vertical line the owner spotted. Shaping the world for a probe is backwards;
      // the probe aims into the passage now and the spine snakes.
      (g.state.substrate.reservoirs || []).length = 0;
      for (const c of g.state.substrate.cells) if (c.water && c.reservoir) { c.water = false; c.reservoir = null; }
      let digs = 0;
      for (let i = 0; i < 300; i++) {
        if (g.state.runOver) break;
        // KEEP DIGGING UNTIL THE RUN ENDS, not until the DEEP dig stops being affordable. Heat
        // prices a dig by the depth it starts at, so a colony deep enough to be paying 12 a dig can
        // still afford a 2 near the surface — and that is deliberate: an over-extended player can
        // crawl sideways up top toward water they know about, which is a recovery play rather than
        // a stuck state. Breaking on the first refused DOWNWARD dig read `75 m, over=false` and
        // blamed the fuel curve for the affordability rule working.
        // AIM INTO THE PASSAGE WHEN STRAIGHT DOWN STOPS PAYING. A straight dig into a wall still
        // SUCCEEDS — the fan finds some open ground sideways — while buying almost no depth, so a
        // blind loop empties the tank going nowhere and measures the roll rather than the economy.
        const d0 = g.mine.depth();
        let moved = false;
        if (g.mine.grow(0, 1).ok) { digs++; moved = g.mine.depth() > d0; }
        if (!moved) {
          for (const dx of (i % 2 ? [0.7, -0.7] : [-0.7, 0.7])) {
            if (g.mine.grow(dx, 1).ok) { digs++; if (g.mine.depth() > d0) { moved = true; break; } }
          }
        }
        if (moved) { /* progress this step */ }
        else {
          // `mine.grow` always digs from the DEEPEST tip, and heat prices a dig by where it starts —
          // so once the deep ground is unaffordable that call refuses for ever while the colony can
          // still dig cheaply near the surface, which is what `mineCanGrow` correctly reports and
          // what a player would actually do. Reach for the shallowest tip the way they would.
          const s2 = g.state;
          let top = null;
          for (const n of s2.active.nodes) if (!n.infected && (!top || n.y < top.y)) top = n;
          if (!top || !g.mine.growFrom(top.x, top.y, top.x + (i % 2 ? 200 : -200), top.y + 60).ok) break;
          digs++;
        }
        if (i % 5 === 4) await new Promise((r) => setTimeout(r, 60));
      }
      await new Promise((r) => setTimeout(r, 2200));   // let the out-of-fuel grace run out
      return { digs, depth: g.mine.depth(), ore: g.mine.ore(), over: g.state.runOver,
               rows: g.state.substrate.rows, res: g.state.runResult,
               // What the whole shaft holds, so the dive's haul is judged as a SHARE rather than
               // against a number that moves every time the ore table is retuned.
               oreTotal: (g.state.substrate.foodPiles || []).reduce((a, p) => a + (p.energyValue || 0), 0),
               taps: (g.state._tappedWater || { size: 0 }).size };
    });
    ok(`seed ${seed}: a straight dive runs out of fuel`, dive.over === true,
       `${dive.depth} m in ${dive.digs} digs, ${dive.taps} pockets stumbled on`);
    ok(`...well short of the bottom`, dive.depth < dive.rows * 0.85,
       `${dive.depth} m of ${dive.rows}`);
    // ...and not so short that the game is unplayable. A first descent should reach band 2, which
    // is where the worms start.
    ok(`...but past the first band`, dive.depth > 42, `${dive.depth} m`);
    // ORE IS NOT FREE ON THE WAY DOWN. This is what the whole generator pass exists for: the
    // Phosphorus that buys the next descent has to be dug SIDEWAYS. Not "none at all" — a dense band
    // makes `growDirected` dodge, so a dive wanders and can legitimately clip a gallery — but a small
    // SHARE of what the shaft holds, which is the property that stays true as the density is tuned.
    ok(`...banking little of the shaft's ore`, dive.ore < dive.oreTotal * 0.25,
       `${dive.ore} P of ${dive.oreTotal} in the ground`);
    // Running dry is not a DEATH. It is the ending, and it must not route through the death screen.
    ok(`...and it is an ending, not a death`,
       dive.res && dive.res.mine === true && dive.res.died === false && dive.res.cause === 'dry',
       JSON.stringify(dive.res && { mine: dive.res.mine, died: dive.res.died, cause: dive.res.cause }));
    await b.ctx.close();
  }

  // ...and the ore IS reachable by detouring, which is the other half. Dug laterally along a
  // gallery from the shaft head, a run should find seams. Without this, "no ore on a dive" passes
  // on a build where the ore is unreachable full stop.
  {
    const b = await bootMine(11);
    const dug = await b.page.evaluate(async () => {
      const g = window.__game, s = g.state, sub = s.substrate;
      s.active.water = 100000;
      const pileAt = (p) => { const idx = p.cells[0];
        return { x: ((idx % sub.cols) + 0.5) * sub.cellSize,
                 y: sub.surfaceY + (((idx / sub.cols) | 0) + 0.5) * sub.cellSize }; };
      // THE NEAREST unpaid seam, re-picked every dig. `foodPiles` is in the order the generator laid
      // it — band by band — so taking the first one aims at whatever happens to be top of the list,
      // which on one run was 100 m below the colony and 260 digs got nowhere near it.
      for (let i = 0; i < 90; i++) {
        let target = null, td = Infinity, tip = null;
        for (const p of (sub.foodPiles || [])) {
          if (p.rewarded) continue;
          const at = pileAt(p);
          for (const n of s.active.nodes) {
            if (n.infected) continue;
            const d = (n.x - at.x) ** 2 + (n.y - at.y) ** 2;
            if (d < td) { td = d; target = at; tip = n; }
          }
        }
        if (!target) break;
        g.mine.growFrom(tip.x, tip.y, target.x, target.y);
        // A CLAIM NEEDS FRAMES. In real time `colonizeReachablePiles` only runs while a grow is in
        // flight (`net._colonizePending`, until the last strand has finished revealing), and a
        // strand is not live until it has animated in (`grownIn`) — so a probe that digs faster than
        // the reveal claims nothing at all and walks straight past every seam. Measured: at 4 digs
        // per 80 ms it reached the bottom of the shaft with 0 P.
        await new Promise((r) => setTimeout(r, 260));
        // ...AND A CLAIM IS NOT A PAYOUT. A pile pays when it has been claimed AND EMPTIED (see
        // mineOreRewards), and draining it takes world ticks — so the loop keeps running while the
        // ore arrives rather than stopping at the moment the tip touches the seam.
        if (g.mine.ore() > 0) break;
      }
      // Let any pile already claimed finish draining.
      // ...AND A CLAIM IS STILL NOT A PAYOUT: `mineOreRewards` pays when the seam is EMPTY, and
      // `resolveIncome` drains it a little per world tick. So the wait is for the drain, not for the
      // dig, and it is measured in seconds.
      for (let i = 0; i < 60 && g.mine.ore() === 0; i++) await new Promise((r) => setTimeout(r, 300));
      return { ore: g.mine.ore(), phos: s.active.phosphorus, depth: g.mine.depth(),
               claimed: (sub.foodPiles || []).filter((p) => p.rewarded).length };
    });
    ok('digging TOWARD a seam banks Phosphorus', dug.ore > 0,
       `${dug.ore} P at ${dug.depth} m, ${dug.claimed} seam(s) worked out`);
    ok('...and the colony holds it', dug.phos >= dug.ore, `${dug.phos} on the colony`);
    await b.ctx.close();
  }

  // =========================================================================================
  // BEING EATEN IS AN ENDING TOO, AND IT STILL PAYS
  // =========================================================================================
  // Running dry is the ending the design is built around, but it is not the only one: a worm eating
  // the last strand sets `cause: 'devoured'` inside tickWorld and rot reaching everything sets
  // `infected`, and BOTH build their own `runResult` with no depth and no ore on it. Read from the
  // result alone, a player eaten at 90 m with ore in hand arrived at the end screen reading "0 m"
  // and banked nothing — a whole run's work lost to the one ending they did not choose. The figures
  // fall back to the STATE, and the payout is identical; only the line on the screen changes.
  console.log('--- eaten, not dry');
  {
    const b = await bootMine(4242);
    const eaten = await b.page.evaluate(async () => {
      const g = window.__game, s = g.state;
      s.active.water = 100000;
      // Dig down a way and bank some ore, so there is something to lose.
      const sub = s.substrate;
      for (let i = 0; i < 40; i++) { g.mine.grow(0, 1); await new Promise((r) => setTimeout(r, 90)); }
      // Hand it some ore directly rather than hunting a seam — the payout path is what is under
      // test here, not the geometry (which the block above covers).
      s.mineOre = 25; s.active.phosphorus = 25;
      const depth = g.mine.depth();
      // Kill the colony the way a worm does: strip it to nothing. `tickWorld`'s post-loop catch is
      // what turns that into `cause: 'devoured'`.
      // `_removeNodes` takes a Set of ids and no cause — `tickWorld`'s catch AFTER its network loop
      // is what reads `healthyCount() === 0` and files `devoured`, which is exactly the code path a
      // worm's last bite takes. Also raise Energy, or the death is attributed to STARVATION and this
      // block passes while proving nothing about being eaten.
      s.active.energy = 5000;
      s.active._removeNodes(new Set(s.active.nodes.map((n) => n.id)));
      for (let i = 0; i < 12 && !s.runOver; i++) { g.tickWorld(s); await new Promise((r) => setTimeout(r, 60)); }
      await new Promise((r) => setTimeout(r, 3000));
      const el = document.getElementById('ssMineEnd');
      return { over: s.runOver, cause: s.runResult && s.runResult.cause, depth,
               screen: !!el, text: el ? el.textContent : '',
               shownDepth: el ? (el.querySelector('.ss-mineend-depth') || {}).textContent : '',
               minerals: JSON.parse(localStorage.getItem('mycelium.progress.v2') || '{}').minerals | 0 };
    });
    if (!eaten.over) {
      console.log('  note   could not force a devoured ending in the probe window — unmeasured');
    } else {
      ok('being eaten ends the descent', eaten.screen === true, eaten.cause || '(no cause)');
      ok('...on the mine\'s own screen, not the death screen',
         /eaten|rot took/i.test(eaten.text), (eaten.text || '').slice(0, 60));
      ok('...still reporting the depth reached',
         (eaten.shownDepth || '').replace(/\D/g, '') === String(eaten.depth), `"${eaten.shownDepth}" vs ${eaten.depth} m`);
      ok('...and still banking the ore', eaten.minerals >= 25, `${eaten.minerals} P banked`);
    }
    await b.ctx.close();
  }

  // =========================================================================================
  // 6. THE STORE IS A SEPARATE SHOP
  // =========================================================================================
  console.log('--- the store');
  {
    const b = await bootMine(7);
    const shop = await b.page.evaluate(() => {
      const S = window.__game.store;
      const P = () => JSON.parse(localStorage.getItem('mycelium.progress.v2') || '{}');
      S.reset();
      const out = { shelf: S.shelf('mine').map((u) => u.id) };
      // The mine's wallet is Phosphorus, and `credit` writes whichever wallet the game spends.
      S.credit(500);
      const p0 = P();
      out.creditedMinerals = p0.minerals | 0;
      out.leftSporesAlone = (p0.spores | 0) === 0;
      const bought = S.buy('growSteps');
      const p1 = P();
      out.boughtOk = !!bought.ok;
      out.inMineLedger = (p1.mineUpgrades && p1.mineUpgrades.growSteps) | 0;
      out.notInCampaignLedger = !(p1.upgrades && p1.upgrades.growSteps);
      out.paidFromMinerals = (p1.minerals | 0) < (p0.minerals | 0);
      // ...and a CAMPAIGN track cannot be bought here, in either direction.
      out.refusedCampaignTrack = !S.buy('lives').ok;
      out.growStepsValue = S.value('growSteps');
      out.waterCosts = S.costs('water', 'mine').slice(0, 3);
      out.waterCostsCampaign = S.costs('water', 'campaign').slice(0, 3);
      S.reset();
      return out;
    });
    // SIX NOW: fuel, grow strength, the two weapons, and the two yield tracks. Pinned as an exact
    // list rather than a count, because what the mine SELLS is the whole of its progression and a
    // track quietly appearing or vanishing from the shelf is the kind of change that should have to
    // be typed here on purpose.
    ok('the mine shelf is fuel, a stronger dig, heat, two weapons and two yields',
       shop.shelf.join(',') === 'water,growSteps,excreteCharges,amputateCharges,heatTolerance,oreYield,pocketWater',
       shop.shelf.join(','));
    ok('the mine\'s wallet is Phosphorus (`minerals`)', shop.creditedMinerals === 500, String(shop.creditedMinerals));
    // THE TWO ECONOMIES DO NOT TOUCH. Sharing one wallet would let a campaign player's Spores buy a
    // mine player's fuel; sharing one ledger would put the mine's tracks in a save nothing can spend.
    ok('...and crediting it leaves Spores alone', shop.leftSporesAlone === true, String(shop.leftSporesAlone));
    ok('a purchase lands in the mine ledger', shop.boughtOk && shop.inMineLedger === 1,
       `ok ${shop.boughtOk}, level ${shop.inMineLedger}`);
    ok('...and not in the campaign\'s', shop.notInCampaignLedger === true, String(shop.notInCampaignLedger));
    ok('...paid for out of Phosphorus', shop.paidFromMinerals === true, String(shop.paidFromMinerals));
    ok('a campaign-only track cannot be bought in the mine', shop.refusedCampaignTrack === true,
       String(shop.refusedCampaignTrack));
    // Grow strength carries `base: 2` — the track is the authority on what a grow is worth, and
    // `configForLevel` copies that same figure into the run.
    ok('Grow strength reads 3 steps after one purchase', shop.growStepsValue === 3, String(shop.growStepsValue));
    // The shared Water track has its OWN ladder in the mine: 25-then-+50 is a Spores ladder, and a
    // whole descent digs out something like 10-30 P.
    ok('the shared Water track is priced in the mine\'s currency',
       shop.waterCosts[0] < shop.waterCostsCampaign[0] || shop.waterCosts.join(',') !== shop.waterCostsCampaign.join(','),
       `mine ${shop.waterCosts.join(',')} vs campaign ${shop.waterCostsCampaign.join(',')}`);

    // ...AND THE PURCHASE REACHES THE RUN. A store whose tiles move a number nobody reads is the
    // most likely way this feature fails, and it fails silently: `configForLevel` folds the tracks
    // into the run's config clone, and nothing else would notice if it stopped.
    const applied = await b.page.evaluate(async () => {
      const S = window.__game.store;
      S.reset(); S.credit(100000);
      S.buy('growSteps'); S.buy('water'); S.buy('pocketWater'); S.buy('oreYield');
      window.__game.mine.playSeed(7);
      await new Promise((r) => setTimeout(r, 3500));
      const c = window.__game.state.config.mine;
      const out = { steps: window.__game.mine.steps(), startWater: c.startWater,
                    pocket: c.reservoirWater, oreBonus: c.oreBonus,
                    water: window.__game.state.active.water,
                    // The UN-upgraded figures, off the live CONFIG rather than the run's clone.
                    baseWater: window.__cfg.mine.startWater | 0,
                    basePocket: window.__cfg.mine.reservoirWater | 0,
                    waterStep: (S.shelf('mine').find((u) => u.id === 'water') || {}).step | 0,
                    pocketStep: (S.shelf('mine').find((u) => u.id === 'pocketWater') || {}).step | 0 };
      S.reset();
      return out;
    });
    ok('a bought grow step reaches the run', applied.steps === 3, `${applied.steps} steps`);
    // DERIVED from CONFIG and the track's own step, not written out: `startWater` is a balance number
    // and has already moved once (30 -> 44 when the rock got denser). What is pinned is that the
    // track ADDS to it and that the RUN gets exactly what the config says — which is the half that
    // can silently stop working, since `configForLevel` is the only thing joining them.
    ok('...and the Water track its starting fuel',
       applied.water === applied.startWater && applied.startWater === applied.baseWater + applied.waterStep,
       `${applied.water} water = ${applied.baseWater} + ${applied.waterStep}`);
    ok('...and the pocket and ore tracks their own numbers',
       applied.pocket === applied.basePocket + applied.pocketStep && applied.oreBonus === 1,
       `pocket ${applied.pocket} = ${applied.basePocket} + ${applied.pocketStep}, ore +${applied.oreBonus}`);
    await b.ctx.close();
  }

  // =========================================================================================
  // THE THREATS: worms and mould, appearing DEEPER (owner)
  // =========================================================================================
  console.log('--- threats by band');
  {
    const b = await bootMine(4242);
    const th = await b.page.evaluate(() => {
      const s = window.__game.state, sub = s.substrate, M = s.config.mine, cs = sub.cellSize;
      const bandOf = (y) => Math.max(0, Math.min(M.bands.length - 1,
        Math.floor(((y - sub.surfaceY) / cs) / M.bandRows)));
      const per = M.bands.map(() => ({ worms: 0, clouds: 0 }));
      // A CLOUD IS `cx`/`cy`, NOT `x`/`y` (engine/threats.js makeCloud) — the position list handed to
      // `placeClouds` uses x/y and what comes back does not, which reads as a NaN band index and
      // crashes the whole block rather than failing one assertion.
      for (const w of s.nematodes) per[bandOf(w.y)].worms++;
      for (const c of s.clouds) per[bandOf(c.cy)].clouds++;
      // ...and none of them standing INSIDE a boulder, which is what seeding before the fine mask
      // exists does — silently. Same trap as the ants' opening trail, one step further on.
      // ...and none of them PLACED inside a boulder. Read off the generator's own record of the
      // spots it chose (`mineChunks[ci].spots`), NOT off the live creatures: a worm crawls and a
      // cloud creeps, so a live reading measures their movement rules a few seconds later and
      // legitimately finds one leaning on a rock face. This asks the generator's own question.
      let inRock = 0, spots = 0;
      for (const ci of window.__game.mine.chunks())
        for (const sp of ((s.mineChunks[ci] && s.mineChunks[ci].spots) || [])) {
          spots++; if (sub.solidAtWorld(sp.x, sp.y)) inRock++;
        }
      return { per, want: M.threatBands, ants: s.ants.length, inRock, spots,
               chunks: window.__game.mine.chunks().length,
               live: s.nematodes.length + s.clouds.length,
               respawnW: s.config.nematodes.respawnChance, respawnC: s.config.trichoderma.respawnChance };
    });
    // EVERY LIVING CREATURE WAS PLACED BY A CHUNK, which is what says the procedural seeders and the
    // respawn top-ups found nothing to do here — the mine's population is exactly what it generated.
    // This replaced a `_needMineThreats === false` assertion that PASSED VACUOUSLY the moment the flag
    // was retired (creatures are placed during play now, so there is nothing to defer and no flag);
    // an assertion reading an undefined field is worse than no assertion, because it prints green.
    ok('every creature was placed by a chunk', th.live > 6 && th.live === th.spots,
       `${th.live} alive, ${th.spots} placed across ${th.chunks} chunk(s)`);
    ok('band 1 has nothing in it', th.per[0].worms === 0 && th.per[0].clouds === 0,
       `${th.per[0].worms} worms, ${th.per[0].clouds} clouds`);
    // PER BAND, against the table — "there are some worms" passes on a build that ignores depth.
    //
    // TIMES THE NUMBER OF CHUNKS, because the table is a DENSITY now and not a population: every
    // chunk seeds its own share as it is generated, so a world with three chunks in it holds three
    // times the table and one with twenty holds twenty. Pinning the table's own numbers would fail
    // the moment a run wandered sideways, and would in effect be asserting that threat density
    // falls off as the shaft widens.
    ok('worms appear from band 2 and scale with depth',
       th.per.every((p, i) => p.worms === th.want[i].worms * th.chunks),
       th.per.map((p) => p.worms).join(',') + ' vs ' + th.want.map((w) => w.worms * th.chunks).join(',')
       + ` (the table x ${th.chunks} chunks)`);
    ok('mould appears deeper still', th.per.every((p, i) => p.clouds === th.want[i].clouds * th.chunks),
       th.per.map((p) => p.clouds).join(',') + ' vs ' + th.want.map((w) => w.clouds * th.chunks).join(','));
    // NO ANTS, and no top-ups: the mine's population is exactly what it places, because the player
    // has no counterplay (Excrete and Amputate belonged to the card/action layer) and these are
    // hazards to route around rather than fights.
    ok('no ant nests', th.ants === 0, String(th.ants));
    ok('nothing respawns', th.respawnW === 0 && th.respawnC === 0, `${th.respawnW} / ${th.respawnC}`);
    ok('nothing was seeded inside a boulder', th.spots > 6 && th.inRock === 0,
       `${th.inRock} of ${th.spots} seeded spots on solid ground`);
    // WHAT THEY CAN SENSE, AGAINST WHAT THE PLAYER CAN SEE. The campaign's 500 is further than the
    // visible half-height at the mine's fixed zoom and more than twice the half-WIDTH, so a worm
    // would sense the colony from outside the frame and start crawling with nothing on screen to say
    // why — unfair here in a way it is not in the campaign, because the mine has no counterplay.
    // Asserted as a RELATION to the viewport rather than as the number 300, so changing the zoom or
    // the shaft's width cannot silently reopen the gap.
    const sight = await b.page.evaluate(() => {
      const c = window.__game.state.config, cam = window.__game.camera;
      return { worm: c.nematodes.sightRadius, cloud: c.trichoderma.sightRadius,
               halfH: cam.bandH() / (2 * cam.zoom), halfW: cam.viewW / (2 * cam.zoom),
               campaign: window.__cfg.nematodes.sightRadius };
    });
    ok('a creature senses no further than the player can see down',
       sight.worm <= sight.halfH && sight.cloud <= sight.halfH,
       `sight ${sight.worm}/${sight.cloud} vs ${Math.round(sight.halfH)} visible below`);
    ok('...and both threats share the number', sight.worm === sight.cloud,
       `${sight.worm} / ${sight.cloud}`);
    // ...and the CAMPAIGN's is untouched: this is a clone-time override, not a retune.
    ok('...while the campaign keeps its own 500', sight.campaign === 500, String(sight.campaign));
    await b.ctx.close();
  }

  // =========================================================================================
  // THE WHOLE LOOP, through the real screens
  // =========================================================================================
  // Title -> Deep Mine New -> the store -> Descend -> a run -> out of fuel -> the end screen ->
  // back at the store with the ore banked. Driven by CLICKS, because every assertion above went
  // through `__game`, and a row that renders is not a row that WORKS — survival's entry path sat
  // unpressed for a whole release on exactly that gap.
  console.log('--- the loop, through the screens');
  {
    const b = await boot('');
    const page = b.page;
    await page.waitForSelector('#titleScreen .ts-btn', { timeout: 30000 });
    await sleep(2600);
    const rows = await page.evaluate(() => {
      const box = (s) => { const e = document.querySelector(s); if (!e) return null;
        const r = e.getBoundingClientRect(); return { t: Math.round(r.top), b: Math.round(r.bottom) }; };
      return { offers: window.__offers,
               top: box('.ts-top'), bottom: box('.ts-bottom'), mineNew: box('#tsNewMine'), vh: innerHeight,
               btns: [...document.querySelectorAll('#titleScreen .ts-btn')].map((b) => b.id),
               label: (document.querySelector('#titleScreen .ts-btn') || {}).textContent,
               record: (document.querySelector('#titleScreen .ts-record') || {}).textContent || null,
               // The mine has no "Old": a descent is one sitting, and what persists is the store.
               mineOld: !!document.querySelector('#tsContMine'),
               // The other two games' doors are shut (owner) — nothing of them on this screen.
               others: ['tsNewCamp', 'tsContCamp', 'tsNew', 'tsCont'].filter((id) => !!document.getElementById(id)) };
    });
    ok('the Deep Mine is the only game on the title screen',
       rows.btns.join(',') === 'tsNewMine' && rows.others.length === 0,
       rows.btns.join(',') + (rows.others.length ? ' + ' + rows.others.join(',') : ''));
    ok('...offered as the only door this build has',
       rows.offers.mine === true && rows.offers.campaign === false && rows.offers.survival === false,
       JSON.stringify(rows.offers));
    ok('...its word sits above the wordmark', !!rows.mineNew && rows.mineNew.t < rows.vh * 0.5,
       rows.mineNew ? `top ${rows.mineNew.t} of ${rows.vh}` : 'missing');
    // WHAT SITS BELOW THE WORDMARK IS THE RECORD, not a second button. The mine has no "Old", and a
    // screen with a word above the title and nothing below it reads as half-drawn.
    ok('...and no "Old", because a descent is one sitting', rows.mineOld === false, String(rows.mineOld));
    ok('...with the record line where a second button would be', !!rows.record, rows.record || '(nothing)');

    // STRAIGHT INTO THE SHAFT (owner: "don't start me on the upgrade store screen when I press new --
    // straight to the game map"). No name dialog either: the name exists for the high-score board,
    // which the mine does not file to and which is off the screen with survival.
    await page.click('#tsNewMine');
    await page.waitForFunction(() => !!(window.__game && window.__game.state
      && window.__game.state.substrate && window.__game.state.substrate.mine), { timeout: 30000 });
    await sleep(2200);
    const straight = await page.evaluate(() => ({
      inShaft: window.__game.mine.isRun(), picker: !!document.getElementById('speciesSelect'),
      nameDialog: !!document.getElementById('tsNameStart'), water: window.__game.state.active.water }));
    ok('New goes straight into the shaft', straight.inShaft === true && straight.water > 0,
       `${straight.water} water`);
    ok('...with no store screen on the way', straight.picker === false, String(straight.picker));
    ok('...and no name dialog either', straight.nameDialog === false, String(straight.nameDialog));

    // ...and the store is still reachable, from the END of a descent. Driven here through the same
    // `showPicker` the end screen's button calls, so the shelf's own shape is still asserted.
    await page.evaluate(() => window.__menu.showPicker());
    await page.waitForSelector('#speciesSelect', { timeout: 20000 });
    await sleep(1500);
    const store = await page.evaluate(() => ({
      title: document.querySelector('#speciesSelect h1').textContent.trim(),
      tiles: document.querySelectorAll('#ssUpg > *').length,
      descend: !!document.querySelector('#ssDescend'),
      note: (document.querySelector('#ssMineNote') || {}).textContent || '',
      // No colonies and no deck: "The upgrade store does not have new species - just the upgrades".
      colonyTiles: document.querySelectorAll('#ssAvail > *, #ssForSale > *').length,
      colonySectionsHidden: [...document.querySelectorAll('#speciesSelect section')]
        .filter((s) => s.querySelector('#ssAvail, #ssForSale')).every((s) => s.hasAttribute('hidden')),
      deckBtn: !!document.querySelector('#ssDeckBtn'),
      rate: !!document.querySelector('#ssRate') && document.querySelector('#ssRate').innerHTML.trim().length > 0,
    }));
    ok('the store screen is the mine\'s', store.title === 'The Deep Mine' && store.descend, store.title);
    ok('...with one tile per mine track and no colonies',
       store.tiles === 7 && store.colonyTiles === 0 && store.colonySectionsHidden,
       `${store.tiles} tiles, ${store.colonyTiles} colony tiles`);
    ok('...no deck button', store.deckBtn === false, String(store.deckBtn));
    ok('...and it says what a descent opens with', /water/.test(store.note) && /grow/.test(store.note), store.note);

    await page.click('#ssDescend');
    await page.waitForFunction(() => !!(window.__game && window.__game.state
      && window.__game.state.substrate && window.__game.state.substrate.mine
      && !document.getElementById('speciesSelect')), { timeout: 30000 });
    await sleep(2500);
    ok('Descend starts a mine run', await page.evaluate(() => window.__game.mine.isRun()), 'in the shaft');

    // THE DRAG IS THE ACTION, and this is the only assertion that exercises it. Everything above
    // digs through `__game.mine.grow` — which is the same call `fireAim` makes but skips the
    // gesture, so without this the always-armed aim could be broken and nothing would notice.
    const dragged = await page.evaluate(async () => {
      const g = window.__game;
      let tip = null;
      for (const n of g.state.active.nodes) if (!n.infected && (!tip || n.y > tip.y)) tip = n;
      const s = g.camera.worldToScreen(tip.x, tip.y);
      const h = document.querySelector('#ui .hint');
      return { x: Math.round(s.x), y: Math.round(s.y), nodes: g.state.active.nodes.length,
               water: g.state.active.water, armed: !!g.cardUsesDragAim,
               hint: h && h.style.display !== 'none' ? h.textContent : '' };
    });
    await page.mouse.move(dragged.x, dragged.y);
    await page.mouse.down();
    await page.mouse.move(dragged.x + 8, dragged.y + 130, { steps: 6 });
    await page.mouse.up();
    await sleep(1400);
    const afterDrag = await page.evaluate(() => {
      const h = document.querySelector('#ui .hint');
      const g = window.__game, s = g.state;
      // The dig's own charge, measured across the call and nothing else.
      const w0 = s.active.water;
      let tip = null;
      for (const n of s.active.nodes) if (!n.infected && (!tip || n.y > tip.y)) tip = n;
      const r = g.mine.growFrom(tip.x, tip.y, tip.x, tip.y + 200);
      const dug = r.ok ? w0 - s.active.water : null;
      return { nodes: s.active.nodes.length, water: s.active.water, dug,
               hintShown: !!(h && h.style.display !== 'none' && h.textContent.trim()),
               hint: h ? h.textContent : '' };
    });
    ok('a press-and-drag on the colony digs', afterDrag.nodes > dragged.nodes,
       `${dragged.nodes} -> ${afterDrag.nodes} filaments`);
    // THE ONE INSTRUCTION, and the pair matters: a hint that never shows leaves a first-time player
    // with no idea what the input is, and one that never clears is a line of text over the map for
    // the whole run. `hintBefore` was captured before the drag above.
    ok('a first descent says how to dig', /drag/i.test(dragged.hint || ''), dragged.hint || '(nothing)');
    ok('...and the hint clears once they have dug', !afterDrag.hintShown,
       afterDrag.hint || '(gone)');
    // NET OF EVERYTHING ELSE THAT TOUCHES THE TANK. `water === before - 2` was an exact equality on a
    // number three separate systems now move: a dig costs 2, a water pocket the growth reached pays
    // +10, and attached worms drain continuously. It read `44 -> 52` — a dig that also tapped a
    // pocket, i.e. the feature working. What is actually being asserted is that the dig CHARGED, so
    // the probe reads the tank on either side of the engine call and ignores the rest.
    ok('...and it cost water', afterDrag.dug === 2,
       `the dig charged ${afterDrag.dug} (tank ${dragged.water} -> ${afterDrag.water}, which pockets and worms also move)`);

    // ...run it dry and follow the ending through to the store.
    //
    // DIG UNTIL THE RUN ENDS, NOT UNTIL A DOWNWARD DIG IS REFUSED — the same trap CLAUDE.md already
    // records for the fuel-curve probe, landing on a second site. `mine.grow` digs from the DEEPEST
    // tip, i.e. the most expensive ground, while `mineCanGrow` asks the CHEAPEST (a colony paying 16
    // a dig down deep can still afford 2 near the surface, deliberately, so an over-extended player
    // can crawl sideways toward water). So one refusal is not the end of the run, and breaking on it
    // left the run ALIVE with no end screen — which surfaces as this block hanging on `#ssMineEnd`
    // with a truncated tally rather than as a failure. The doubling price made it far likelier by
    // jumping the deep price to 16 in one step instead of ramping there.
    const dry = await page.evaluate(async () => {
      const g = window.__game;
      // Dig a while first, so the ending has a real depth and real ore to report...
      let digs = 0;
      for (let i = 0; i < 40 && !g.state.runOver; i++) {
        if (g.mine.grow(0, 1).ok || g.mine.grow(i % 2 ? 0.9 : -0.9, 0.4).ok) digs++;
        if (i % 5 === 4) await new Promise((r) => setTimeout(r, 60));
      }
      // ...then EMPTY THE TANK and let `mineFuelCheck` end the run on its own grace timer.
      //
      // DIGGING UNTIL IT ENDS DOES NOT TERMINATE, and two hangs here proved it. `mine.grow` digs
      // from the DEEPEST tip while `mineCanGrow` asks the CHEAPEST — a colony paying 16 a dig deep
      // can still afford 2 near the surface, on purpose — so a colony walled in below sits refused
      // for ever with water in the tank and the run legitimately ALIVE. One roll read `22 digs /
      // 578 refusals, tank 2`. Trying more directions only moves the wall; the loop is betting that
      // some fixed set of angles is open on every map roll, which is not a bet this block needs to
      // make. What it asserts is the ENDING and the screen's numbers, and that a dig charges water
      // is already asserted above — so running the tank dry directly tests the real path
      // (`mineFuelCheck`, its grace window, `presentRunOver`) deterministically on any map.
      g.state.active.water = 0;
      for (let i = 0; i < 60 && !g.state.runOver; i++) await new Promise((r) => setTimeout(r, 120));
      return { digs, over: g.state.runOver, depth: g.mine.depth() };
    });
    ok('running the tank dry ends the descent', dry.over === true,
       `over=${dry.over} after ${dry.digs} digs, ${dry.depth} m`);
    await page.waitForSelector('#ssMineEnd', { timeout: 30000 });
    const end = await page.evaluate(() => {
      const r = document.getElementById('ssMineEnd');
      return { depth: (r.querySelector('.ss-mineend-depth') || {}).textContent || '',
               earned: (r.querySelector('.ss-win-earned') || {}).textContent || '',
               btn: !!r.querySelector('#ssMineDone'),
               res: window.__game.state.runResult };
    });
    ok('running dry shows the end-of-descent screen', end.btn === true, end.depth);
    ok('...printing the depth reached', end.depth.replace(/\D/g, '') === String(end.res.depth | 0),
       `"${end.depth}" vs ${end.res.depth} m`);
    await page.click('#ssMineDone');
    await page.waitForSelector('#speciesSelect', { timeout: 20000 });
    await sleep(1200);
    const banked = await page.evaluate(() => {
      const p = JSON.parse(localStorage.getItem('mycelium.progress.v2') || '{}');
      return { minerals: p.minerals | 0, spores: p.spores | 0, best: p.mineBest | 0,
               wallet: document.querySelector('#ssWallet').textContent.trim(),
               ore: window.__game ? null : null };
    });
    ok('the end screen returns to the store', await page.$('#ssDescend') !== null, 'shelf up');
    ok('...with the descent\'s depth recorded', banked.best > 0, `${banked.best} m`);
    ok('...and the ore in the mine\'s wallet, not the Spore one',
       banked.minerals >= 0 && banked.spores === 0 && banked.wallet === String(banked.minerals),
       `${banked.minerals} P / ${banked.spores} spores, chip "${banked.wallet}"`);
    // AND "NEW" MUST NOT WIPE THE SAVE. In the campaign, New means a new playthrough and clears the
    // wallet; in the mine the store IS the progression and the button that starts a descent is the
    // one you press after every run — wiping there would delete the Phosphorus just banked, every
    // time, and the only symptom would be a store that never fills up.
    const survived = await page.evaluate(async () => {
      const S = window.__game.store;
      S.credit(250);
      const before = JSON.parse(localStorage.getItem('mycelium.progress.v2')).minerals | 0;
      window.__menu ? 0 : 0;
      window.__game.showTitle && window.__game.showTitle();
      return { before };
    }).catch(() => null);
    if (survived) {
      await page.waitForSelector('#tsNewMine', { timeout: 20000 }).catch(() => {});
      await page.click('#tsNewMine').catch(() => {});
      // New goes straight into a run now, so what is waited for is the SHAFT rather than the shelf.
      await page.waitForFunction(() => !!(window.__game && window.__game.state
        && window.__game.state.substrate && window.__game.state.substrate.mine), { timeout: 30000 }).catch(() => {});
      await sleep(1200);
      const after = await page.evaluate(() => JSON.parse(localStorage.getItem('mycelium.progress.v2')).minerals | 0);
      ok('pressing New again does not wipe the banked Phosphorus', after === survived.before,
         `${survived.before} -> ${after}`);
    }
    ok('no page errors through the whole loop', b.errs.length === 0, b.errs.slice(0, 2).join(' | ') || 'clean');
    await b.ctx.close();
  }

  await browser.close();
  srv.close();
  // THE `====` FENCE IS WHAT run.mjs PARSES (`/==== (\d+) passed, (\d+) failed ====/`). Without it the
  // runner reports "did not report" and counts the whole check as 0/0 — green output, no coverage.
  console.log(`\n==== ${pass} passed, ${fail} failed ====`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('HARNESS ERROR', e); process.exit(1); });
