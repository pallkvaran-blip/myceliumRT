/* Ant trails vs DRAWN rock.
 *
 *   node tests/ant-rock-check.cjs            # every level below
 *   node tests/ant-rock-check.cjs antroad    # just the ones whose id matches
 *
 * A nest's trail is a BFS over cells, and a cell is not what the player sees: rock SPRITES
 * overhang the cells they are flagged on, so a path can be legal on the coarse `cell.rock` grid
 * and still run visibly through a boulder. buildTrail already tests each step against the fine
 * `solidAtWorld` mask for exactly that reason — destination and midpoint both.
 *
 * The failure this check exists for is not a missing test, it is a TIMING one, and it is invisible
 * in the code that has the test in it. `solidAtWorld` falls back to the coarse flag whenever the
 * fine mask does not exist yet:
 *
 *     solidAtWorld(x, y) { const fs = this._fineSolid; if (!fs) { …return !!(c && c.rock); } … }
 *
 * and the mask is published by solidifyRock during RENDER, while placeAntNests → retarget →
 * buildTrail runs at BUILD time, before any frame has drawn. So a nest's FIRST trail is always
 * plotted against the coarse grid however carefully buildTrail tests it, and on a map whose rock
 * is a traced sprite — where coarse and fine disagree most — the ants come out walking over the
 * rocks. It corrects itself only if the nest happens to retarget later.
 *
 * So: boot, wait for the mask, let the line lay itself, then assert that no part of the BUILT
 * trail sits on drawn rock. Asserted against `solidAtWorld` rather than against a screenshot
 * because that IS the thing the art is matched to.
 */
const http = require('http'), fs = require('fs'), path = require('path');
const { chromium } = require('playwright');
const ROOT = path.resolve(__dirname, '..');
const ART = path.join(__dirname, '.artifacts');
const T = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.webp': 'image/webp', '.mp3': 'audio/mpeg', '.wav': 'audio/wav' };
let pass = 0, fail = 0;
const ok = (n, c, x) => { c ? (pass++, console.log('  PASS  ' + n + (x ? '  — ' + x : ''))) : (fail++, console.log('  FAIL  ' + n + (x ? '  — ' + x : ''))); };

// Boot hashes that put an ant nest on the map. The procedural dev start is included because the
// campaign's own maps are procedural and carry nests from LEVEL_THREATS; the authored one is
// included because a TRACED map is where the coarse and fine masks disagree most.
// Both cases are TRACED maps with nests, which is where the coarse cell grid and the drawn
// sprite disagree most and so where a trail crosses visible rock.
//
// The second case used to be the procedural dev start, as a control. That stopped being
// procedural: `#dev` opens at level 1, campaign slot 1 is now an authored map, and levelDefFor
// serves it — so the "control" was quietly booting campaign-01, which places no ants at all and
// reported 0 nests. Named after the level now, so it cannot drift like that again.
const CASES = [
  { id: 'antroad', hash: 'level,challenge-antroad,turn', note: 'authored, 1 nest' },
  { id: 'campaign-02', hash: 'level,campaign-02-obsidian-c40,turn', note: 'campaign map, 3 nests' },
];
// The map the pile-timing block uses. Authored, so its geometry repeats run to run.
const PILE_LEVEL = 'campaign-02-obsidian-c40';
const only = process.argv.slice(2).filter((a) => !a.startsWith('-'));
const RUN = CASES.filter((c) => !only.length || only.some((o) => c.id.includes(o)));

// Boot a level and wait for it to be playable. The per-case loop below inlines the same steps for
// historical reasons; the blocks at the end use this.
async function boot(browser, base, hash) {
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  const errs = [];
  page.on('pageerror', (e) => errs.push(String(e && e.message)));
  await page.addInitScript(() => { window.MYCELIUM_SUPABASE = { url: '', anonKey: '' }; });
  await page.goto(base + '/index.html#' + hash, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#loadscreen.ld-ready', { timeout: 60000 }).catch(() => {});
  await page.click('#loadscreen', { timeout: 5000 }).catch(() => {});
  await page.waitForFunction(() => window.__game && window.__game.state && window.__game.state.active, null, { timeout: 40000 });
  return { page, errs };
}

(async () => {
  fs.mkdirSync(ART, { recursive: true });
  const srv = await new Promise((res) => { const s = http.createServer((rq, rs) => { let p = decodeURIComponent(rq.url.split('?')[0].split('#')[0]); if (p === '/') p = '/index.html'; const fp = path.join(ROOT, p); if (!fp.startsWith(ROOT) || !fs.existsSync(fp) || fs.statSync(fp).isDirectory()) { rs.writeHead(404); rs.end('nf'); return; } rs.writeHead(200, { 'Content-Type': T[path.extname(fp)] || 'application/octet-stream' }); fs.createReadStream(fp).pipe(rs); }); s.listen(0, () => res(s)); });
  const base = 'http://localhost:' + srv.address().port;
  const browser = await chromium.launch({ headless: true });

  for (const c of RUN) {
    console.log(`\n  ── ${c.id} (${c.note}) ──`);
    const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
    const errs = [];
    page.on('pageerror', (e) => errs.push(String(e && e.message)));
    await page.addInitScript(() => { window.MYCELIUM_SUPABASE = { url: '', anonKey: '' }; });
    await page.goto(base + '/index.html#' + c.hash, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('#loadscreen.ld-ready', { timeout: 60000 }).catch(() => {});
    await page.click('#loadscreen', { timeout: 5000 }).catch(() => {});
    await page.waitForFunction(() => window.__game && window.__game.state && window.__game.state.active, null, { timeout: 30000 }).catch(() => {});
    // Nothing below means anything until the fine mask exists — that is the whole subject.
    const solid = await page.waitForFunction(() => window.__game.state.substrate._rockSolidified === true, null, { timeout: 60000 }).then(() => true).catch(() => false);
    ok(`${c.id}: the fine rock mask is built`, solid);

    // THE TRAIL IS ALREADY OUT when the level opens. `built` is how far the column has got
    // along its path, and stepAnts creeps it at ants.extendSpeed — 2 cells/tick in real time —
    // so this used to read a stub for the first ~8 ticks and the player entered a level where
    // the ants had not started. Read BEFORE anything is stepped: the assertion is about the
    // state the level opens in, so a single tick would hide it.
    const opening = await page.evaluate(() => (window.__game.state.ants || []).map((n) => ({
      built: n.built, len: (n.path || []).length, target: !!n.target })));
    for (const [i, n] of opening.entries()) {
      ok(`${c.id}: nest ${i}'s trail is fully laid the moment the level opens`,
        n.len > 1 && n.built >= n.len - 1 - 1e-6,
        `built ${Math.round(n.built)} of ${n.len - 1} path cells${n.target ? '' : ' (no target!)'}`);
    }

    // AND IT IS CLEAN BEFORE THE PLAYER TOUCHES ANYTHING. Everything below this block steps the
    // world 40 times first, which is the state AFTER stepAnts has re-planned — so it measured past
    // the window the bug lived in. In turn-based a world step is a player ACTION, so "the trail the
    // level opens with" is what you sit and look at, and it was the coarse-grid route. The re-plan
    // is driven from the FRAME LOOP now (advanceSim), so wait for its one-shot flag rather than
    // stepping anything.
    const replanned = await page.waitForFunction(
      () => (window.__game.state.ants || []).every((n) => n._finePath), null, { timeout: 20000 })
      .then(() => true).catch(() => false);
    ok(`${c.id}: the opening trail is re-planned against the fine mask, with no action taken`,
      replanned, replanned ? 'every nest carries _finePath' : 'timed out waiting for the re-plan');
    const atOpen = await page.evaluate(() => window.__game.auditAnts());
    const openOnRock = (atOpen.nests || []).reduce((a, n) => a + n.onRock, 0);
    ok(`${c.id}: the trail the level OPENS with crosses no drawn rock`, openOnRock === 0,
      `${openOnRock} sampled points inside a boulder`);
    // The STAMP is the half that outlasted the first fix: the re-plan re-routed the drawn line and
    // left cell.antTrail on the old route, because setTrailFields is the only thing that clears it
    // and it sat below the re-plan inside stepAnts. 18 of 57 on 2-obsidian, with the line at 0.
    ok(`${c.id}: and so does the STAMPED trail at level open`, atOpen.trailOnRock === 0,
      `${atOpen.trailOnRock} of ${atOpen.trailCells} stamped trail cells`);
    ok(`${c.id}: __game.auditAnts() calls the opening trail clean`, atOpen.clean === true,
      atOpen.err || `clean=${atOpen.clean}`);

    const nests = await page.evaluate(() => (window.__game.state.ants || []).length);
    ok(`${c.id}: has an ant nest to check`, nests > 0, `${nests} nest(s)`);
    if (!nests) { await page.close(); continue; }

    // Let the line lay itself out. It creeps a couple of cells per step, so a short run leaves
    // most of the path unbuilt and a clean reading that means nothing.
    const res = await page.evaluate(() => {
      const g = window.__game, s = g.state, sub = s.substrate;
      for (let i = 0; i < 40; i++) g.tickWorld(s, 'both');
      const out = [];
      for (const nest of (s.ants || [])) {
        const p = nest.path || [];
        const built = Math.min(p.length - 1, Math.floor(nest.built != null ? nest.built : p.length));
        let onRock = 0; const worst = [];
        for (let k = 0; k <= built && k < p.length; k++) {
          const ctr = sub.cellCenter(p[k].col, p[k].row);
          if (sub.solidAtWorld(ctr.x, ctr.y)) { onRock++; if (worst.length < 4) worst.push(`${p[k].col},${p[k].row}`); }
        }
        // What the path WOULD be if it were planned now, with the mask present. The gap between
        // this and the above is the whole bug: same function, same nest, different answer,
        // because the first run happened before the mask existed.
        out.push({ len: p.length, built, onRock, worst, target: nest.target });
      }
      // Trail CELLS as stamped (what the renderer draws the line from, and what worms follow).
      let trailOnRock = 0, trailCells = 0;
      sub.forEachCell((cell, col, row) => {
        if (!cell.antTrail) return;
        trailCells++;
        const ctr = sub.cellCenter(col, row);
        if (sub.solidAtWorld(ctr.x, ctr.y)) trailOnRock++;
      });
      const allHome = (s.ants || []).every((n) => n.dormant === true || (n.path || []).length < 2);
      return { nests: out, trailCells, trailOnRock, allHome };
    });

    for (const [i, n] of res.nests.entries()) {
      console.log(`        nest ${i}: path ${n.len} cells, ${n.built} built, ${n.onRock} on drawn rock${n.worst.length ? ' (' + n.worst.join(' ') + ')' : ''}`);
    }
    const totalOnRock = res.nests.reduce((a, n) => a + n.onRock, 0);
    ok(`${c.id}: no built trail cell sits on drawn rock`, totalOnRock === 0,
      `${totalOnRock} of ${res.nests.reduce((a, n) => a + n.built + 1, 0)} built cells are inside a boulder`);
    // 0 OF 0 IS NOT A PASS BY ITSELF. Forty world steps at the shipped harvestRate is enough for
    // three nests to strip a map's food and go home, and a nest with nothing to eat stamps nothing —
    // which is indistinguishable here from a build that stopped stamping. So the count has to be
    // explained: either there are trail cells, or every nest is legitimately dormant with no path.
    ok(`${c.id}: no STAMPED trail cell sits on drawn rock`, res.trailOnRock === 0,
      `${res.trailOnRock} of ${res.trailCells} stamped trail cells`);
    ok(`${c.id}: ...and that count is explained`, res.trailCells > 0 || res.allHome === true,
      res.trailCells > 0 ? `${res.trailCells} cells stamped` : `no cells, and every nest is home/dormant: ${res.allHome}`);
    ok(`${c.id}: no page errors`, errs.length === 0, errs.slice(0, 2).join(' | ') || 'none');

    await page.screenshot({ path: path.join(ART, `ants-${c.id}.png`), timeout: 15000, animations: 'disabled' }).catch(() => {});
    await page.close();
  }

  // ===========================================================================================
  // HOW LONG A NEST TAKES TO FINISH A FOOD PILE
  //
  // Owner: "reduce the time it takes ants to finish a food pile down to 6 turns. I believe it
  // currently sits at 10." The number they were reaching for was `ants.harvestRate` — and on its
  // own it could not do it. A nest drained ONE target cell per step and then spent a whole step
  // retargeting to the next cell of the same pile, and another travelling the new leg, so a
  // standard authored pile (9 cells × 50 = 450 nutrient) took about two steps per cell WHATEVER
  // the rate: measured 26 turns at 40/action and a flat 17 turns at every rate from 50 to 120.
  // `harvestRate` is a budget spent across the pile now, which is what the config always claimed
  // it was ("nutrient per action"), and 75 is 450/6.
  //
  // Asserted as the OUTCOME the owner asked for *and* as the per-step budget, because the outcome
  // alone would pass again on a build where the rate had quietly stopped meaning anything.
  // ===========================================================================================
  {
    console.log(`\n  ── a nest finishing a pile ──`);
    let page, errs;
    try { ({ page, errs } = await boot(browser, base, 'level,' + PILE_LEVEL + ',turn')); }
    catch (e) { ok('pile timing: the level boots', false, String(e && e.message).slice(0, 90)); }
    if (page) {
      ok('pile timing: the level boots', true, PILE_LEVEL);
      const r = await page.evaluate(async () => {
        const G = window.__game, s = G.state, sub = s.substrate;
        for (let i = 0; i < 200 && !sub._rockSolidified; i++) { try { G.renderFrame(); } catch (_) {} await new Promise((res) => setTimeout(res, 25)); }
        // Only the ants may touch this food. The colony drains a CLAIMED cell every step via
        // resolveIncome, anywhere on the map, and a cloud eats leaves — either would be counted as
        // the nest's dinner. (Measured the wrong way round first: a probe that left them in read
        // 4 turns where a clean one read 6.)
        s.nematodes = []; s.clouds = [];
        if (s.config.nematodes) s.config.nematodes.respawnChance = 0;
        if (s.config.trichoderma) s.config.trichoderma.respawnChance = 0;
        const nest = (s.ants || [])[0];
        if (!nest) return { err: 'this map has no ant nest' };
        s.ants = [nest];                                  // ONE nest, so the per-step figure is one nest's
        sub.forEachCell((c) => { c.nutrient = 0; c.maxNutrient = 0; c.colonized = 0; });
        // A STANDARD authored pile, built to spec rather than found: 9 cells × 50. Measured as both
        // the minimum AND the median pile on three different maps, so it is *the* pile.
        let spot = null;
        for (let tries = 0; tries < 4000 && !spot; tries++) {
          const col = 3 + ((tries * 7) % (sub.cols - 8)), row = 3 + ((tries * 5) % (sub.rows - 8));
          let clear = true;
          for (let c = col; c < col + 3; c++) for (let rr = row; rr < row + 3; rr++) {
            const cell = sub.cellAt(c, rr);
            if (!cell || cell.rock || cell.water || cell.hazard) clear = false;
          }
          if (clear) spot = { col, row };
        }
        if (!spot) return { err: 'no 3x3 of clear ground to lay a pile in' };
        const idx = [];
        for (let c = spot.col; c < spot.col + 3; c++) for (let rr = spot.row; rr < spot.row + 3; rr++) {
          const i = sub.index(c, rr); sub.cells[i].nutrient = 50; sub.cells[i].maxNutrient = 50; idx.push(i);
        }
        nest.path = [{ col: spot.col, row: spot.row }]; nest.built = 0;
        nest.target = { col: spot.col, row: spot.row }; nest.dormant = false; nest._finePath = true;
        const mapTot = () => { let t = 0; for (const c of sub.cells) t += c.nutrient; return t; };
        const pileTot = () => idx.reduce((a, k) => a + sub.cells[k].nutrient, 0);
        const start = pileTot(); const perStep = [];
        let steps = 0;
        while (pileTot() > 0 && steps < 60) {
          s.runOver = false; s.winPending = false; s.won = false; s.active.alive = true;
          const b0 = mapTot(); G.tickWorld(s); steps++;
          perStep.push(Math.round(b0 - mapTot()));
        }
        return { err: null, rate: s.config.ants.harvestRate, start: Math.round(start), steps, perStep,
                 live: !s.runOver };
      });
      if (r.err) { ok('pile timing: the probe built a pile to eat', false, r.err); }
      else {
        ok('pile timing: the probe built a pile to eat', r.start === 450, `${r.start} nutrient in 9 cells`);
        ok('pile timing: the run stayed live, so the step count means something', r.live === true);
        // THE OWNER'S NUMBER.
        ok('a nest finishes a standard food pile in 6 turns', r.steps === 6,
          `${r.steps} turns to clear ${r.start} nutrient at ${r.rate}/action`);
        // AND THE RATE IS ACTUALLY SPENT. Every step but the last must carry the full budget off the
        // map; a build that went back to one-cell-per-step reads 50s here and 9 turns above.
        const full = r.perStep.slice(0, -1);
        ok('...and every turn carries the whole harvestRate off the map', full.length > 0 && full.every((v) => Math.abs(v - r.rate) < 0.51),
          `removed per turn [${r.perStep.join(', ')}], rate ${r.rate}`);
        ok('...so the clearing time is total / rate, as the config says', r.steps === Math.ceil(r.start / r.rate),
          `${r.start}/${r.rate} = ${(r.start / r.rate).toFixed(2)} → ${Math.ceil(r.start / r.rate)} turns`);
      }
      ok('pile timing: no page errors', errs.length === 0, errs.slice(0, 2).join(' | ') || 'none');
      await page.close();
    }
  }

  // BOTH MODE_TUNING TABLES, OR ONE OF THE TWO GAMES GOT HARDER ON ITS OWN. A rate lives in the
  // CONFIG literal and in both tables, and a retune has to move them by the same factor — the
  // ratio here is the thing to assert, not either number, so a future retune in one place fails.
  {
    const read = async (hash) => {
      const { page } = await boot(browser, base, hash);
      const v = await page.evaluate(() => ({
        rate: window.__game.state.config.ants.harvestRate,
        rt: !!(window.__game.state.config.realtime && window.__game.state.config.realtime.enabled),
      }));
      await page.close();
      return v;
    };
    const t = await read('level,' + PILE_LEVEL + ',turn');
    const rt = await read('level,' + PILE_LEVEL);
    ok('ants.harvestRate: turn-based is the owner\'s 6-turn value', t.rt === false && Math.abs(t.rate - 75) < 1e-6,
      `${t.rate}/action (realtime=${t.rt})`);
    ok('ants.harvestRate: real time carries the SAME retune factor', rt.rt === true && Math.abs(rt.rate / t.rate - 12.2 / 75) < 1e-3,
      `${rt.rate}/tick against ${t.rate}/action — ratio ${(rt.rate / t.rate).toFixed(4)}, wanted ${(12.2 / 75).toFixed(4)}`);
  }

  await browser.close();
  srv.close();
  console.log(`\n==== ${pass} passed, ${fail} failed ====`);   // the runner parses THIS form
  console.log('  frames: tests/.artifacts/ants-*.png');
  process.exit(fail ? 1 : 0);
})();
