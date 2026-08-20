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
  ok('the carve leaves room for rock', shaft.stats.openFrac < 0.45, `${(shaft.stats.openFrac * 100).toFixed(1)}% open`);
  // ...and the rock loop reached the band targets it was given. Separate from the mask assertions
  // below because they are different failures: a chunk that missed its targets and a chunk that hit
  // them and still looks thin want opposite fixes, and the drawn mask cannot tell them apart.
  ok('...and the rock loop met its band targets', shaft.stats.hit.every((h) => h > 0.85),
     shaft.stats.hit.join(' / '));
  // Deeper bands run denser (CONFIG.mine.bands[].fill), which is what makes the descent close in.
  // Asserted as a TREND with slack rather than as monotonic: a band's target is a target, and the
  // carve has priority — a seed whose channels wander through one band legitimately leaves it less
  // room for rock. What must hold is that the bottom is denser than the top.
  ok('rock closes in with depth', shaft.stats.cover[3] > shaft.stats.cover[0],
     shaft.stats.cover.join(' / '));
  // ...and every band lands in the TRACED CAMPAIGN MAPS' own range of solid ground. The trend above
  // is a design intention the carve can legitimately override on one seed; this is the bound that
  // actually decides whether a band is playable.
  ok('...and every band packs most of its closed ground',
     shaft.stats.cover.every((c) => c > 0.55 && c <= 1.001), shaft.stats.cover.join(' / '));
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
  ok('every ore seam is reachable', flood.pilesOk === flood.piles, `${flood.pilesOk} of ${flood.piles}`);
  ok('every water pocket is reachable', flood.pocketsOk === flood.pockets, `${flood.pocketsOk} of ${flood.pockets}`);
  // A shaft that is nearly all open is a shaft with no rock in it, which passes everything above
  // and is not a mine. The other side of the same coin as the reachability flood.
  // A shaft that is nearly all open is a shaft with no rock in it, which passes everything above and
  // is not a mine; one that is nearly all rock is a shaft you cannot dig. The bound is the TRACED
  // CAMPAIGN MAPS' own range (23-53% solid) seen from the other side — the fill targets were raised
  // to land there, and this is what would notice them drifting back out.
  ok('...and the shaft is neither hollow nor solid', flood.reachedFrac > 0.2 && flood.reachedFrac < 0.8,
     `${(flood.reachedFrac * 100).toFixed(1)}% of the ${flood.chunks} generated chunk(s) reachable`);
  // CONNECTIVITY IS THE CARVE'S WHOLE PROMISE, and it is a different assertion from the three above:
  // those ask whether specific things are reachable, this asks whether ANY open ground is walled off.
  // A sealed pocket is where a run dies for no reason the player can see.
  ok('...and essentially no open ground is walled off', flood.connectedFrac > 0.97,
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
    const r1 = g.mine.grow(0, 1);
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
  ok('...and reaches about 2 steps of ground',
     grow.deepestGain >= grow.seg * 1.5 && grow.deepestGain <= grow.seg * 6 * 1.05,
     `${Math.round(grow.deepestGain)} units of a possible ${Math.round(grow.seg * 6)} (${grow.grewNodes} filaments)`),
  ok('it can be used as long as there is water', grow.playsWithWater >= 8, `${grow.playsWithWater} digs on 18 water`);
  ok('...and is refused when it cannot be paid for', grow.refusedWhenBroke && grow.refusalSaysWater, 'refused, and says water');
  ok('...with the run still live', grow.stillLive === true, String(grow.stillLive));

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
    ok('the chunk seams meet — the whole streamed world is one connected space',
       seam.connected > 0.97, `${(seam.connected * 100).toFixed(1)}% of open ground over ${seam.chunks} chunks`);
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
    ok('twelve digs carry the colony well to the LEFT of the start', near.left > 900,
       `${Math.round(near.left)} units (~${(near.left / near.cs).toFixed(0)} cells)`);
    ok('...and as far to the RIGHT', near2.right > 900, `${Math.round(near2.right)} units`);

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
      for (let i = 0; i < 10; i++) {
        let t = null;
        for (const n of s.active.nodes) {
          if (n.infected || n.y > shallowY + 90) continue;
          if (!t || n.x < t.x) t = n;
        }
        if (!t) break;
        g.mine.growFrom(t.x, t.y, t.x - 200, t.y);
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
      return { camX: g.camera.x, camAfterDown, depthAfterDown, depth: g.mine.depth(),
               onScreen: p.x > 0 && p.y > 0 && p.x < r.width && p.y < r.height,
               screen: [Math.round(p.x), Math.round(p.y)], view: [Math.round(r.width), Math.round(r.height)],
               dWork: Math.abs(g.camera.x - work.x), dDeep: Math.abs(g.camera.x - deep.x) };
    });
    // THE PLAYER-FACING PROPERTY: what you just dug is still on screen, so you can press it and keep
    // going. On a fixed-zoom screen that is the whole of it — tissue off screen cannot be touched.
    ok('what a sideways dig just grew is still on screen', cam.onScreen,
       `strand at ${cam.screen} of ${cam.view}, camera ${Math.round(cam.camX)}` +
       ` (${Math.round(cam.dWork)} from the work, ${Math.round(cam.dDeep)} from the deepest strand)`);
    ok('...and the camera moved there rather than staying over the descent',
       Math.abs(cam.camX - cam.camAfterDown) > 60,
       `${Math.round(cam.camAfterDown)} -> ${Math.round(cam.camX)}`);
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
    // Grow to the nearest pocket and park there.
    const res = (sub.reservoirs || [])[0];
    if (!res) return { none: true };
    const at = sub.cellCenter(res.cx, res.cy);
    const cost = g.mine.cost();
    // THE GAIN IS TRACKED, NOT THE TAP COUNT. One dig fans out ~19 filaments, so a grow aimed at a
    // pocket can legitimately reach a SECOND one in the same tick — the rule is "each source pays its
    // lump once", and pinning `taps === 1` was pinning the map instead (it read 2 the moment the
    // spurs moved). `gain` is what the tank got beyond what the digging cost.
    const w0 = 100000;
    s.active.water = w0;
    // ...AND FROM WHERE THE PAGE ALREADY IS. This block shares its page with the depth-beat dive,
    // which digs to ~166 m and taps a pocket of its own on the way — counted from zero the probe
    // charged this measurement for a payment made before it set the tank, and read `2 sources, +10W`.
    const taps0 = (s._tappedWater || { size: 0 }).size;
    let digs = 0;
    for (let i = 0; i < 60; i++) {
      let tip = null, bd = Infinity;
      for (const n of s.active.nodes) {
        if (n.infected) continue;
        const d = (n.x - at.x) ** 2 + (n.y - at.y) ** 2;
        if (d < bd) { bd = d; tip = n; }
      }
      if (!tip) break;
      if (g.mine.growFrom(tip.x, tip.y, at.x, at.y).ok) digs++;
      await new Promise((r) => setTimeout(r, 200));
      if ((s._tappedWater || { size: 0 }).size > taps0) break;
    }
    const taps = (s._tappedWater || { size: 0 }).size - taps0;
    if (!taps) return { reached: false };
    const gain = s.active.water - (w0 - digs * cost);
    // The lump has landed. Now sit still for several world ticks with a strand in the water and
    // check the tank does not move — no income, no second tap.
    s.active.water = 100;
    await new Promise((r) => setTimeout(r, 3500));
    return { reached: true, taps, gain, digs, after: s.active.water,
             want: s.config.mine.reservoirWater };
  });
  if (pocket.none || pocket.reached === false) {
    console.log('  note   could not reach a water pocket in the probe window — pocket rules unmeasured');
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
      let digs = 0;
      for (let i = 0; i < 300; i++) {
        if (g.state.runOver) break;
        if (g.mine.grow(0, 1).ok) digs++; else break;
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
    ok('the mine shelf is fuel plus its own three tracks',
       shop.shelf.join(',') === 'water,growSteps,oreYield,pocketWater', shop.shelf.join(','));
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
    ok('...with four upgrade tiles and no colonies',
       store.tiles === 4 && store.colonyTiles === 0 && store.colonySectionsHidden,
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
      return { nodes: window.__game.state.active.nodes.length, water: window.__game.state.active.water,
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
    ok('...and it cost water', afterDrag.water === dragged.water - 2,
       `${dragged.water} -> ${afterDrag.water}`);

    // ...run it dry and follow the ending through to the store.
    await page.evaluate(async () => {
      const g = window.__game;
      for (let i = 0; i < 300; i++) {
        if (g.state.runOver) break;
        if (!g.mine.grow(0, 1).ok) break;
        if (i % 5 === 4) await new Promise((r) => setTimeout(r, 60));
      }
    });
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
