/* Headless functional test for the real-time Mycelium conversion. */
const http = require('http');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const ROOT = path.resolve(__dirname, '..');   // the repo root — served as-is
const TYPES = { '.html':'text/html', '.js':'text/javascript', '.json':'application/json',
  '.png':'image/png', '.jpg':'image/jpeg', '.jpeg':'image/jpeg', '.svg':'image/svg+xml',
  '.webp':'image/webp', '.mp3':'audio/mpeg', '.wav':'audio/wav', '.css':'text/css' };

function serve() {
  return new Promise((resolve) => {
    const srv = http.createServer((req, res) => {
      let p = decodeURIComponent(req.url.split('?')[0].split('#')[0]);
      if (p === '/') p = '/index.html';
      const fp = path.join(ROOT, p);
      if (!fp.startsWith(ROOT) || !fs.existsSync(fp) || fs.statSync(fp).isDirectory()) { res.writeHead(404); res.end('nf'); return; }
      res.writeHead(200, { 'Content-Type': TYPES[path.extname(fp)] || 'application/octet-stream' });
      fs.createReadStream(fp).pipe(res);
    });
    srv.listen(0, () => resolve(srv));
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let PASS = 0, FAIL = 0;
function ok(name, cond, extra) { (cond ? (PASS++, console.log('  PASS  ' + name + (extra ? '  — ' + extra : ''))) : (FAIL++, console.log('  FAIL  ' + name + (extra ? '  — ' + extra : '')))); }

// Restore a known-good, ticking baseline for an independent probe. Returns { live, ticks }.
async function stabilize(page, opts = {}) {
  await page.evaluate((o) => {
    const g = window.__game, st = g.state, net = st.active;
    st.runOver = false; st.winPending = false; st.won = false;
    if (net) { net.alive = true; net.energy = 1e6; net.water = 999; net.phosphorus = 999; }
    if (st.cards) st.cards.pendingOffers.length = 0;
    if (o.noThreats) { st.clouds = []; st.nematodes = []; }
    if (net && net.nodes) for (const n of net.nodes) { n.infected = false; n.health = 1; }
  }, opts);
  // A "Level N" intro overlay legitimately freezes the clock until dismissed — after an
  // earlier probe ends a run, the campaign advances and puts one up. Click it away.
  for (let i = 0; i < 3; i++) {
    const intro = await page.$('#levelIntro');
    if (!intro) break;
    await page.mouse.click(400, 300).catch(() => {});
    await sleep(2000);
  }
  // Wait for the clock to actually advance (a menu can still hold it frozen).
  const t0 = await page.evaluate(() => window.__game.state.turn);
  for (let i = 0; i < 12; i++) {
    await sleep(260);
    const t = await page.evaluate(() => window.__game.state.turn);
    if (t > t0 + 1) return { live: true, ticks: t - t0 };
  }
  return { live: false, ticks: 0 };
}

async function boot(page, hash) {
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push('console:' + m.text()); });
  page.on('pageerror', (e) => errors.push('pageerror:' + (e && e.message)));
  await page.goto(base + '/index.html' + hash, { waitUntil: 'domcontentloaded' });
  // Wait for the boot loading screen to be ready, then click to enter.
  await page.waitForSelector('#loadscreen.ld-ready', { timeout: 15000 }).catch(() => {});
  await page.click('#loadscreen', { timeout: 5000 }).catch(() => {});
  // Wait for a run to become active.
  await page.waitForFunction(() => window.__game && window.__game.state && window.__game.state.active, null, { timeout: 15000 }).catch(() => {});
  return errors;
}

let base;
(async () => {
  const srv = await serve();
  base = 'http://localhost:' + srv.address().port;
  const browser = await chromium.launch({ headless: true });

  // ---------------- TEST 1: #puzzle — RT clock ticks with no input --------------
  console.log('\n[TEST 1] #puzzle — real-time clock advances with no player input');
  {
    const page = await browser.newPage();
    const errors = await boot(page, '#puzzle');
    const active = await page.evaluate(() => !!(window.__game && window.__game.state && window.__game.state.active));
    ok('run active after boot', active);
    const t0 = await page.evaluate(() => window.__game.state.turn);
    await sleep(2500);
    const t1 = await page.evaluate(() => window.__game.state.turn);
    const dt = t1 - t0;
    // ~2 ticks/sec over ~2.5s of unpaused time → expect ~4-6 ticks (allow slack).
    ok('turn advances over wall-clock with NO input', dt >= 3, `Δturn=${dt} over 2.5s`);
    ok('no console/page errors during puzzle boot+run', errors.length === 0, errors.slice(0,3).join(' | '));
    // Config: the requested speed re-tunes, and no rockform15-22 sprite loaded.
    const cfg = await page.evaluate(() => {
      const c = window.__game.state.config;
      const A = (typeof asset === 'function');   // asset() is module-scoped; probe via a canary instead
      return {
        crawl: c.nematodes.crawlSpeed, wander: c.nematodes.wanderSpeed,
        move: c.trichoderma.moveSpeed, leaves: c.trichoderma.leavesPerRound,
        spread: c.trichoderma.spreadDepthPerTurn, harvest: c.ants.harvestRate,
        dev: !!(c.dev && c.dev.enabled), fadeMs: c.render.infectFadeMs,
        creep: c.render.infectCreepMs, roundSeconds: c.cards.roundSeconds,
        stepMs: (c.realtime && c.realtime.stepMs) || 500,
        // Every key of MODE_TUNING.realtime that the loaded config does NOT match, and how
        // many keys the two tables disagree on (a guard against comparing a table to itself).
        mism: (() => {
          const T = window.__modeTuning; if (!T) return ['no __modeTuning hook'];
          const read = (p) => p.split('.').reduce((o, k) => (o == null ? o : o[k]), c);
          const out = [];
          for (const k in T.realtime) if (read(k) !== T.realtime[k]) out.push(`${k}=${read(k)} want ${T.realtime[k]}`);
          return out;
        })(),
        differ: (() => {
          const T = window.__modeTuning; if (!T) return 0;
          let n = 0;
          for (const k in T.realtime) if (T.realtime[k] !== T.turn[k]) n++;
          return n;
        })(),
        keys: window.__modeTuning ? Object.keys(window.__modeTuning.realtime).length : 0,
      };
    });
    // Against MODE_TUNING itself, not pinned numbers. These five assertions used to hard-code
    // the RT rates — under names describing retunes from several sessions earlier ("halved
    // again", "slowed 50%") — so every balance change broke them and the names lied about what
    // they were checking. threat-check owns the absolute values. What belongs HERE is that a
    // real-time boot loaded the REAL-TIME table, whatever it currently says.
    ok('real time loaded EVERY value from MODE_TUNING.realtime', cfg.mism.length === 0,
       cfg.mism.length ? cfg.mism.join(', ')
         : `crawl=${cfg.crawl} move=${cfg.move} spread=${cfg.spread} harvest=${cfg.harvest}`);
    ok('and those differ from the turn-based table (so that assertion means something)',
       cfg.differ >= 5, `${cfg.differ} of ${cfg.keys} keys differ between the modes`);
    ok('dev buttons re-enabled (CONFIG.dev.enabled=true)', cfg.dev === true, `dev.enabled=${cfg.dev}`);
    // The fade is a fixed look choice; the CREEP has to track the spread rate, so assert the
    // relationship rather than the number — it has moved 300 → 100 → 50 → 100 as the rate did.
    const simRings = cfg.spread / ((cfg.stepMs || 500) / 1000);
    ok('the infection turn is short and crisp (fade 240ms)', cfg.fadeMs === 240, `fadeMs=${cfg.fadeMs}`);
    ok('and the visible creep keeps pace with the spread rate', (1000 / cfg.creep) >= simRings,
       `creep draws ${(1000/cfg.creep).toFixed(1)} rings/s vs sim ${simRings.toFixed(1)} (creepMs=${cfg.creep})`);
    ok('a cadence dot (one "round") is 10 seconds of wall clock', cfg.roundSeconds === 10, `roundSeconds=${cfg.roundSeconds}`);
    await page.close();
  }

  // ---------------- TEST 2: #dev — card layer, draft pause, consume ------------
  console.log('\n[TEST 2] #dev — card layer boots, draft pauses time, colony consumes piles');
  {
    const page = await browser.newPage();
    const errors = await boot(page, '#dev');
    // Dismiss the "Level 1" intro overlay (click screen center) and let it fade out.
    await page.mouse.click(400, 300).catch(() => {});
    await sleep(2200);
    const hasCards = await page.evaluate(() => !!(window.__game.state.cards));
    ok('card layer present in #dev run', hasCards);

    // Clock ticks while playing.
    const a0 = await page.evaluate(() => window.__game.state.turn);
    await sleep(1600);
    const a1 = await page.evaluate(() => window.__game.state.turn);
    ok('clock ticks during normal play', (a1 - a0) >= 1, `Δturn=${a1 - a0}`);

    // Ant trail EXTENDS from the old pile (cumulative) instead of re-routing from the nest.
    const ant = await page.evaluate(() => {
      const g = window.__game, st = g.state, sub = st.substrate;
      const nest = (st.ants || [])[0];
      if (!nest || !nest.path || nest.path.length < 2) return { noNest: true };
      const before = nest.path.map((p) => ({ col: p.col, row: p.row }));
      nest.built = Math.max(0, nest.path.length - 1);              // force "arrived"
      if (nest.target) { const c = sub.cellAt(nest.target.col, nest.target.row); if (c) c.nutrient = 0; }  // empty its pile
      g.tickWorld(st);                                             // arrived + empty → extend to next food
      const after = nest.path;
      let prefixOk = after.length >= before.length;
      for (let i = 0; i < before.length && prefixOk; i++) prefixOk = after[i] && after[i].col === before[i].col && after[i].row === before[i].row;
      const builtBefore = nest.built;
      g.tickWorld(st);                                             // now the line should be TRAVELING the new leg
      return { beforeLen: before.length, afterLen: after.length, prefixOk, extended: after.length > before.length, builtGrew: nest.built >= builtBefore };
    });
    ok('ant trail keeps its old path as a prefix (extends, does NOT re-route)', ant.noNest || ant.prefixOk, ant.noNest ? 'no nest on map' : `len ${ant.beforeLen}→${ant.afterLen}, prefixOk=${ant.prefixOk}`);
    ok('finishing a pile lengthens the ant trail toward the next food', ant.noNest || ant.extended, ant.noNest ? 'no nest' : `len ${ant.beforeLen}→${ant.afterLen}`);
    ok('the line then creeps out along the new leg (built advances)', ant.noNest || ant.builtGrew, `builtGrew=${ant.builtGrew}`);

    // A REAL ant trail must never route through drawn rock, and the ants drawn on it must
    // not sit on rock either (BFS + weave wobble + lane offset all use the fine sprite mask).
    const rocky = await page.evaluate(async () => {
      const g = window.__game, st = g.state, sub = st.substrate, cam = g.camera;
      const nest = (st.ants || [])[0];
      if (!nest) return { noNest: true };
      st.runOver = false; st.winPending = false; st.active.alive = true; st.active.energy = 100000;
      nest.path = []; nest.built = 0; nest.target = null;   // force a fresh trail from the nest
      g.tickWorld(st);
      const path = nest.path || [];
      let solidCells = 0;
      for (const p of path) { const c = sub.cellCenter(p.col, p.row); if (sub.solidAtWorld(c.x, c.y)) solidCells++; }
      // Now check the ants actually DRAWN on it.
      nest.built = Math.max(0, path.length - 1); nest.dormant = false;
      let solidAnts = 0, marks = 0;
      if (path.length >= 2) {
        const a = sub.cellCenter(path[0].col, path[0].row);
        const b = sub.cellCenter(path[path.length - 1].col, path[path.length - 1].row);
        cam.fitBounds({ minX: Math.min(a.x, b.x) - 80, minY: Math.min(a.y, b.y) - 160,
                        maxX: Math.max(a.x, b.x) + 80, maxY: Math.max(a.y, b.y) + 160 }, 20);
        g.traceAnts(true);
        await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
        const ms = g.antMarks();
        g.traceAnts(false);
        marks = ms.length;
        for (const m of ms) if (sub.solidAtWorld(m.x, m.y)) solidAnts++;
      }
      return { len: path.length, solidCells, marks, solidAnts };
    });
    ok('the ant trail never routes through drawn rock', rocky.noNest || (rocky.len > 1 && rocky.solidCells === 0), rocky.noNest ? 'no nest' : `${rocky.solidCells} of ${rocky.len} trail cells on rock`);
    ok('no ant is drawn standing on rock', rocky.noNest || rocky.marks === 0 || rocky.solidAnts === 0, `${rocky.solidAnts} of ${rocky.marks} ants on rock`);

    // ONE click drafts a card (it used to need a double click).
    const draft = await page.evaluate(async () => {
      const g = window.__game, st = g.state, C = st.cards;
      st.runOver = false; st.winPending = false; st.active.alive = true;
      const name = (C.hand[0] && C.hand[0].name) || 'Apical Drive';
      C.pendingOffers.length = 0;
      C.pendingOffers.push({ choices: [name], kind: 'normal' });   // no center → panel shows at once
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      const card = document.querySelector('.offercard');
      if (!card) return { noPanel: true };
      const before = C.hand.length, offers = C.pendingOffers.length;
      const help = (document.querySelector('.offerhelp') || {}).textContent || '';
      card.click();                                                // ONE click
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      return { help, drafted: C.hand.length > before, offersLeft: C.pendingOffers.length, offers };
    });
    ok('a single click drafts the card', draft.noPanel || (draft.drafted && draft.offersLeft < draft.offers), draft.noPanel ? 'no draft panel' : `hand grew: ${draft.drafted}, offers ${draft.offers}→${draft.offersLeft}`);
    ok('the draft help no longer says double-click', draft.noPanel || !/double/i.test(draft.help), `help: "${draft.help}"`);

    // While the clock is stopped for a draft, the ants must stop marching too.
    const frozen = await page.evaluate(async () => {
      const g = window.__game, st = g.state, sub = st.substrate, cam = g.camera;
      const nest = (st.ants || [])[0];
      if (!nest) return { noNest: true };
      st.runOver = false; st.winPending = false; st.active.alive = true; st.active.energy = 100000;
      st.cards.pendingOffers.length = 0;
      // A visible built trail to march on.
      const row = Math.min(sub.rows - 2, 3);
      nest.path = []; for (let i = 0; i < 24; i++) nest.path.push({ col: 2 + i, row });
      nest.built = nest.path.length - 1; nest.dormant = false; nest.target = null;
      const a = sub.cellCenter(2, row), b = sub.cellCenter(2 + 23, row);
      cam.fitBounds({ minX: a.x - 60, minY: a.y - 200, maxX: b.x + 60, maxY: b.y + 200 }, 20);
      g.traceAnts(true);
      const sample = async () => {
        await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
        const m = g.antMarks();
        return m.length ? m[0].s : null;
      };
      // RUNNING: the column advances between frames.
      const r1 = await sample();
      await new Promise((r) => setTimeout(r, 260));
      const r2 = await sample();
      // FROZEN by a draft: it must hold still.
      st.cards.pendingOffers.push({ choices: ['Apical Drive'], kind: 'normal' });
      await new Promise((r) => setTimeout(r, 260));
      const f1 = await sample();
      await new Promise((r) => setTimeout(r, 420));
      const f2 = await sample();
      st.cards.pendingOffers.length = 0;
      g.traceAnts(false);
      return { r1, r2, f1, f2, moved: (r1 != null && r2 != null) ? Math.abs(r2 - r1) : null,
               drift: (f1 != null && f2 != null) ? Math.abs(f2 - f1) : null };
    });
    ok('control: the ant column marches while the clock runs', !frozen.noNest && frozen.moved != null && frozen.moved > 0.5, frozen.moved == null ? 'no ants drawn' : `advanced ${frozen.moved.toFixed(1)}px in 260ms`);
    ok('the ants STOP marching while time is stopped for a draft', !frozen.noNest && frozen.drift != null && frozen.drift < 0.01, frozen.drift == null ? 'n/a' : `drifted ${frozen.drift.toFixed(3)}px over 420ms of pause`);

    // Ants must cover the WHOLE trail, however long it has grown cumulatively — the old
    // 28-ant cap left the far half of a long line bare ("a trail with no ants going nowhere").
    const cover = await page.evaluate(async () => {
      const g = window.__game, st = g.state, sub = st.substrate, cam = g.camera;
      const nest = (st.ants || [])[0];
      if (!nest) return { noNest: true };
      st.runOver = false; st.active.alive = true; st.active.energy = 100000;
      // A long, straight, fully-built trail across open ground at a fixed depth.
      const row = Math.min(sub.rows - 2, 3);
      const c0 = 2, cells = 44;
      nest.path = []; for (let i = 0; i < cells; i++) nest.path.push({ col: c0 + i, row });
      nest.built = nest.path.length - 1; nest.dormant = false; nest.target = null;
      const a = sub.cellCenter(c0, row), b = sub.cellCenter(c0 + cells - 1, row);
      cam.fitBounds({ minX: a.x - 60, minY: a.y - 200, maxX: b.x + 60, maxY: b.y + 200 }, 20);
      g.traceAnts(true);
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      const marks = g.antMarks();
      g.traceAnts(false);
      if (!marks.length) return { none: true };
      const len = marks[0].len, SP = marks[0].sp;
      const ss = marks.map((m) => m.s).sort((x, y) => x - y);
      let maxGap = ss[0];
      for (let i = 1; i < ss.length; i++) maxGap = Math.max(maxGap, ss[i] - ss[i - 1]);
      maxGap = Math.max(maxGap, len - ss[ss.length - 1]);
      return { count: marks.length, len, SP, span: ss[ss.length - 1] - ss[0], maxGap };
    });
    ok('the ant column is not capped — a long trail carries many more than 28 ants', cover.noNest || cover.none || cover.count > 28, cover.none ? 'no ants drawn' : `${cover.count} ants over a ${Math.round(cover.len)}px trail`);
    ok('no bare stretch anywhere along the trail (gaps stay at the ant spacing)', cover.noNest || cover.none || cover.maxGap <= cover.SP * 1.25, cover.none ? 'n/a' : `largest gap ${Math.round(cover.maxGap)}px vs spacing ${Math.round(cover.SP)}px`);

    // When there is no food left to reach, the column must WALK HOME — never sit on a drawn
    // trail with no ants on it, running nowhere (drawAnts hides the marchers while dormant).
    const homeward = await page.evaluate(() => {
      const g = window.__game, st = g.state, sub = st.substrate, net = st.active;
      const nest = (st.ants || [])[0];
      if (!nest) return { noNest: true };
      st.runOver = false; st.winPending = false; net.alive = true; net.energy = 100000;
      st.clouds = []; st.nematodes = [];
      const keptFood = sub.cells.map((c) => c.nutrient);
      for (const c of sub.cells) c.nutrient = 0;          // every pile finished: nothing reachable
      nest.target = null;
      nest.path = []; nest.built = 0;                     // a known short line of our own to retract
      for (let r = 0; r < 6; r++) nest.path.push({ col: nest.col, row: r });
      nest.built = nest.path.length - 1;
      const startLen = nest.path.length;
      // A line drawn with no ants on it is the exact bug: path long enough to draw AND dormant.
      let danglingFrames = 0, lens = [];
      for (let i = 0; i < 12; i++) {
        st.runOver = false; net.alive = true;
        g.tickWorld(st);
        lens.push(nest.path.length);
        if (nest.path.length >= 2 && nest.dormant) danglingFrames++;
      }
      for (let i = 0; i < sub.cells.length; i++) sub.cells[i].nutrient = keptFood[i];
      // Same cleanup: don't leave pile-reward drafts queued (they'd freeze the clock later).
      st.cards.pendingOffers.length = 0; st.winPending = false; st.won = false; st.runOver = false;
      return { startLen, endLen: nest.path.length, danglingFrames, dormantAtEnd: nest.dormant, lens };
    });
    ok('the ant line retracts toward the nest when nothing is reachable', homeward.noNest || homeward.endLen < homeward.startLen, homeward.noNest ? 'no nest' : `path ${homeward.startLen} → ${homeward.endLen}`);
    ok('never a drawn ant line with no ants marching on it', homeward.noNest || homeward.danglingFrames === 0, `${homeward.danglingFrames} dangling tick(s)`);
    ok('once fully retracted the trail is gone (nest goes dormant)', homeward.noNest || (homeward.endLen === 0 && homeward.dormantAtEnd), `endLen=${homeward.endLen} dormant=${homeward.dormantAtEnd}`);

    await stabilize(page, { noThreats: false });
    // Mould clouds must HOLD STILL when nothing is within sensing range (no wandering).
    const idle = await page.evaluate(() => {
      const g = window.__game, st = g.state, sub = st.substrate, net = st.active;
      st.runOver = false; st.winPending = false; net.alive = true; net.energy = 100000;
      // One cloud parked far from the colony, and every food cell emptied, so it can see
      // nothing at all. Anything but "stays exactly put" is wandering.
      const keptFood = sub.cells.map((c) => c.nutrient);
      for (const c of sub.cells) c.nutrient = 0;
      const far = { cx: sub.worldWidth * 0.5, cy: sub.surfaceY + sub.cellSize * 4, r: 1, strength: 1, dying: false, heading: 0.7 };
      st.clouds = [far]; st.nematodes = [];
      const x0 = far.cx, y0 = far.cy;
      for (let i = 0; i < 12; i++) { st.runOver = false; net.alive = true; g.tickWorld(st); }
      const moved = Math.hypot(far.cx - x0, far.cy - y0);
      // Control: put food on the nearest OPEN cell it has clear line of sight to — it must
      // then actually creep toward it, proving "no wandering" isn't "never moves".
      const cloud = st.clouds[0];
      let control = -1, placed = false;
      for (let d = 2; d <= 12 && !placed; d++) {
        for (const [dx, dy] of [[d, 0], [-d, 0], [0, d], [0, -d], [d, d], [-d, -d], [d, -d], [-d, d]]) {
          const px = cloud.cx + dx * sub.cellSize, py = cloud.cy + dy * sub.cellSize;
          const c2 = sub.cellAtWorld(px, py);
          if (c2 && !c2.rock && !c2.water && sub.segmentClear(cloud.cx, cloud.cy, px, py)) {
            c2.nutrient = 50; c2.maxNutrient = Math.max(c2.maxNutrient, 50); placed = true; break;
          }
        }
      }
      if (placed) {
        const bx = cloud.cx, by = cloud.cy;
        for (let i = 0; i < 4; i++) { st.runOver = false; net.alive = true; g.tickWorld(st); }
        control = Math.hypot(cloud.cx - bx, cloud.cy - by);
      }
      for (let i = 0; i < sub.cells.length; i++) sub.cells[i].nutrient = keptFood[i];   // restore the map
      // Emptying every cell made the colonised piles "finish", queueing pile-reward drafts —
      // which would freeze the clock for the tests that follow. Drop them.
      st.cards.pendingOffers.length = 0; st.winPending = false; st.won = false; st.runOver = false;
      return { moved, control };
    });
    ok('a mould cloud with nothing in sensing range does NOT wander', idle.moved < 0.01, `drifted ${idle.moved.toFixed(2)}px over 12 ticks`);
    // A control, so a genuine "couldn't place food anywhere in its line of sight on this map"
    // is reported as inconclusive rather than counted as a failure — it proves nothing either way.
    if (idle.control < 0) console.log('  SKIP  control: a cloud DOES creep once something is in range  — no open cell in its line of sight on this map');
    else ok('control: a cloud DOES creep once something is in range', idle.control > 0.5, `moved ${idle.control.toFixed(1)}px toward food`);

    // Interpolation plumbing: after ticks, movers carry pre-tick snapshots (rx0/ry0[/rh0])
    // that the renderer tweens toward the current position — the basis for smooth movement.
    const interp = await page.evaluate(async () => {
      const st = window.__game.state, sub = st.substrate, net = st.active;
      await new Promise((r) => setTimeout(r, 900));   // let the auto-clock populate snapshots
      const cl = st.clouds || [], wm = st.nematodes || [];
      const cloudSnap = cl.length ? cl.every((c) => typeof c.rx0 === 'number' && typeof c.ry0 === 'number') : null;
      const wormSnap = wm.length ? wm.every((w) => typeof w.rx0 === 'number' && typeof w.ry0 === 'number' && typeof w.rh0 === 'number') : null;
      const antSnap = (st.ants || []).length ? st.ants.every((n) => typeof n.rbuilt0 === 'number') : null;
      return { clouds: cl.length, worms: wm.length, cloudSnap, wormSnap, antSnap };
    });
    ok('threats carry per-tick snapshots the renderer interpolates (worms, mould, ant line)',
      interp.cloudSnap !== false && interp.wormSnap !== false && interp.antSnap !== false,
      `clouds=${interp.clouds}(${interp.cloudSnap}) worms=${interp.worms}(${interp.wormSnap}) antBuilt(${interp.antSnap})`);

    // Draft pause timing: finishing a pile QUEUES the offer, but the pile→draft intro still has
    // to play. Time must keep running through that intro and only freeze once the draft is up.
    const froze = await page.evaluate(async () => {
      const st = window.__game.state, net = st.active;
      const name = (st.cards.hand[0] && st.cards.hand[0].name) || 'Apical Drive';
      const c = net.nodes[0];
      // A real pile-style offer: it carries a world centre, so the intro sequence plays.
      st.cards.pendingOffers.push({ choices: [name], kind: 'normal', center: { x: c.x, y: c.y } });
      const t0 = st.turn;
      await new Promise((r) => setTimeout(r, 600));       // during the intro (wait 500ms + leaf 320ms)
      const duringIntro = st.turn - t0;
      await new Promise((r) => setTimeout(r, 1400));      // intro has finished — draft now on screen
      const t1 = st.turn;
      await new Promise((r) => setTimeout(r, 1200));
      return { duringIntro, afterDelta: st.turn - t1 };
    });
    ok('time KEEPS RUNNING while the pile→draft intro plays (not frozen on pile touch)', froze.duringIntro >= 1, `Δturn=${froze.duringIntro} during the intro`);
    ok('time FREEZES once the draft is actually on screen', froze.afterDelta === 0, `Δturn=${froze.afterDelta} while choosing a card`);

    // Resume: clear the offer, confirm the clock RESUMES.
    const resumed = await page.evaluate(async () => {
      const st = window.__game.state;
      st.cards.pendingOffers.length = 0;
      const before = st.turn;
      await new Promise((r) => setTimeout(r, 1500));
      return st.turn - before;
    });
    ok('clock RESUMES after the draft is resolved', resumed >= 1, `Δturn=${resumed} after clearing the draft`);

    await stabilize(page, { noThreats: true });
    // Immediate-consume: deterministically exercise the edited colonizeReachablePiles.
    // Drop a living strand inside a pile, colonise, and confirm the WHOLE pile is claimed,
    // its nutrient is banked as Energy AT ONCE, and it's left empty (no slow income drain).
    const consume = await page.evaluate(() => {
      const st = window.__game.state, sub = st.substrate, net = st.active;
      const pile = (sub.foodPiles || []).find((p) => p.cells.reduce((s, i) => s + sub.cells[i].nutrient, 0) > 0);
      if (!pile) return { noPiles: true };
      const mid = pile.cells[Math.floor(pile.cells.length / 2)];
      const mc = sub.cellCenter(mid % sub.cols, Math.floor(mid / sub.cols));
      const nutBefore = pile.cells.reduce((s, i) => s + sub.cells[i].nutrient, 0);
      const e0 = net.energy;
      const inPile = net.addNode(mc.x, mc.y, net.nodes[0]);   // a strand sitting inside the pile
      inPile._revSeen = true; inPile._liveAt = 0;              // ...that has finished growing in
      net.colonizeReachablePiles(sub, st.rng);    // "fully grows into it" → should consume now
      return {
        claimed: pile.cells.every((i) => sub.cells[i].colonized >= 1),
        nutBefore, nutAfter: pile.cells.reduce((s, i) => s + sub.cells[i].nutrient, 0),
        energyGained: net.energy - e0,
      };
    });
    ok('growing into a pile claims all its cells', !consume.noPiles && consume.claimed);
    ok('a fully-grown-into pile is consumed IMMEDIATELY (nutrient → 0)', !consume.noPiles && consume.nutAfter <= 1e-6, `nutrient ${Math.round(consume.nutBefore||0)}→${Math.round(consume.nutAfter||0)}`);
    ok('immediate consume banks the pile Energy at once', !consume.noPiles && consume.energyGained > 0, `+${(consume.energyGained||0).toFixed(1)}⚡`);
    // Infection CREEP: a whole chain infected in one sim tick must not turn green together —
    // each strand gets its own later turn time (_infAt), stepping outward along the filaments.
    const creep = await page.evaluate(async () => {
      const st = window.__game.state, net = st.active;
      const frame2 = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      for (const n of net.nodes) n.infected = false;      // clean slate
      await frame2();                                     // lets the scheduler clear stale _infAt
      // Walk a parent→child chain so the rot has a line to travel along.
      const chain = [];
      let cur = net.nodes[0];
      while (cur && chain.length < 6) { chain.push(cur); cur = cur.children.length ? net.byId.get(cur.children[0]) : null; }
      for (const n of chain) n.infected = true;           // one tick infects the lot
      await frame2();
      const times = chain.map((n) => n._infAt);
      const scheduled = times.filter((t) => typeof t === 'number');
      const spread = scheduled.length > 1 ? Math.max(...scheduled) - Math.min(...scheduled) : 0;
      let increasing = true, minGap = Infinity;
      for (let i = 1; i < scheduled.length; i++) {
        if (scheduled[i] < scheduled[i - 1]) increasing = false;
        minGap = Math.min(minGap, scheduled[i] - scheduled[i - 1]);
      }
      return { len: chain.length, scheduled: scheduled.length, spread, increasing, minGap,
               creepMs: st.config.render.infectCreepMs };
    });
    ok('every rotten strand gets its own turn time (creep front scheduled)', creep.scheduled === creep.len, `${creep.scheduled}/${creep.len} scheduled`);
    // Thresholds DERIVED from infectCreepMs, not the 250ms that was hard-coded when the creep
    // was 300. It tracks the spread rate and has now moved 300 → 100 → 50 → 100; the rule being
    // tested is unchanged — one creep step per strand, in order — so the rule is what's asserted.
    const wantGap = creep.creepMs * 0.9;
    const wantSpread = Math.max(1, creep.len - 1) * creep.creepMs * 0.9;
    ok('a ring infected in ONE tick does not turn green together (staggered creep)',
       creep.spread >= wantSpread,
       `turn times span ${Math.round(creep.spread)}ms across ${creep.len} strands, wanted >=${Math.round(wantSpread)} (creep ${creep.creepMs}ms)`);
    ok('the rot turns outward along the strands, in order', creep.increasing, `monotonic=${creep.increasing}`);
    ok('each strand waits a full creep step after the previous one', creep.minGap >= wantGap,
       `min gap ${Math.round(creep.minGap)}ms, wanted >=${Math.round(wantGap)} (creep ${creep.creepMs}ms)`);

    // Income engines: with engineSlow=3, a per-tick engine should produce on only 1 of every 3
    // world ticks. Install one water engine in isolation and drive exactly 6 ticks → 2 payouts.
    const eng = await page.evaluate(() => {
      const g = window.__game, st = g.state, sub = st.substrate, net = st.active, C = st.cards;
      // Isolate: heal the creep test's rot, no threats, plenty of energy, and clear any strand
      // sitting at the goal surface (a win would stop the clock mid-measurement).
      for (const n of net.nodes) { n.infected = false; n.health = 1; }
      net.energy = 100000; st.clouds = []; st.nematodes = []; st.ants = [];
      const band = new Set();
      for (const n of net.nodes) { const s = sub.surfaceColumnAtX(n.x); if (s && s.goal && (n.y - sub.surfaceY) <= 400) band.add(n.id); }
      if (band.size) net._removeNodes(band);
      const stepMs = st.config.realtime.stepMs;
      const roundSeconds = st.config.cards.roundSeconds;
      const roundTicks = Math.round((roundSeconds * 1000) / stepMs);
      // Measure in PHOSPHORUS: the lake/reservoir water-source engine only ever adds water,
      // so it can't contaminate the reading.
      const diag = [];
      const run = (engine, ticks) => {
        st.runOver = false; st.winPending = false; st.won = false; net.alive = true; C.pendingOffers.length = 0;
        C.engines = [engine]; C._engTick = 0;
        net.phosphorus = 0;          // room to accrue (stabilize pins resources at the soft cap)
        const p0 = net.phosphorus, t0 = st.turn;
        // Keep the run alive across the (up to 60s of) simulated time so this measures purely
        // the cadence: threats off, and nothing may end the run mid-count.
        for (let i = 0; i < ticks; i++) {
          st.runOver = false; st.winPending = false; net.alive = true;
          st.clouds = []; st.nematodes = []; net.energy = 100000;
          g.tickWorld(st);
        }
        diag.push({ want: ticks, ran: st.turn - t0, over: st.runOver, alive: net.alive, nodes: net.nodes.length, healthy: net.healthyCount(), p: net.phosphorus, cap: st.config.cards.softCapPhosphorus });
        return net.phosphorus - p0;
      };
      return {
        roundSeconds, roundTicks, stepMs, diag,
        dotBefore: run({ name: '__a', phosphorus: 5 }, roundTicks - 1),          // 9.5s — not yet
        dotOn:     run({ name: '__b', phosphorus: 5 }, roundTicks),              // 10s   — one payout
        sixBefore: run({ name: '__c', phosphorus: 7, every: 6, _et: 0 }, 6 * roundTicks - 1),   // 59.5s
        sixOn:     run({ name: '__d', phosphorus: 7, every: 6, _et: 0 }, 6 * roundTicks),       // 60s
      };
    });
    if (eng.sixOn !== 7 || eng.dotOn !== 5) console.log('    [diag] engine runs:', JSON.stringify(eng.diag));
    ok('one cadence dot = 10s → 20 world ticks at the 500ms step', eng.roundTicks === 20 && eng.roundSeconds === 10, `${eng.roundSeconds}s = ${eng.roundTicks} ticks of ${eng.stepMs}ms`);
    ok('a 1-dot engine pays NOTHING before its 10s are up', eng.dotBefore === 0, `+${eng.dotBefore} at 9.5s`);
    ok('a 1-dot engine pays exactly once at 10s', eng.dotOn === 5, `+${eng.dotOn} at 10s`);
    ok('a 6-dot engine pays NOTHING before 1 minute', eng.sixBefore === 0, `+${eng.sixBefore} at 59.5s`);
    ok('a 6-dot engine pays exactly once at 1 minute', eng.sixOn === 7, `+${eng.sixOn} at 60s`);

    // Ability cooldowns are written in the same dots, so they must run on the same clock.
    const cd = await page.evaluate(() => {
      const g = window.__game, st = g.state, net = st.active, C = st.cards;
      st.runOver = false; st.winPending = false; net.alive = true; net.energy = 100000;
      const roundTicks = Math.round((st.config.cards.roundSeconds * 1000) / st.config.realtime.stepMs);
      C.engines = []; C._engTick = 0;
      const a = { name: '__ability', every: 6, cd: 6, used: 0 };
      C.actions = [a];
      const tick = (n) => { for (let i = 0; i < n; i++) { st.runOver = false; st.winPending = false; net.alive = true; st.clouds = []; st.nematodes = []; net.energy = 100000; g.tickWorld(st); } };
      tick(roundTicks - 1);
      const afterAlmostOne = a.cd;                       // 9.5s in: still 6 dots left
      tick(roundTicks * 5 + 1);
      const afterFive = a.cd;                            // 60s in: 6 dots burned down
      C.actions = [];
      return { roundTicks, afterAlmostOne, afterFive };
    });
    ok('an ability cooldown dot does not tick down before its 10s', cd.afterAlmostOne === 6, `cd=${cd.afterAlmostOne} after 9.5s`);
    ok('a 6-dot ability cooldown takes a full minute to recover', cd.afterFive === 0, `cd=${cd.afterFive} after 60s`);
    // slowed: 6/3 = 2 payouts × 5 = 10; un-slowed would be 6 × 5 = 30.

    // A pile stripped by THREATS (ants drain nutrient but leave the footprint behind, and the
    // leaves fade out) must not still be colonisable — the colony shouldn't spread a mat into
    // ground where the food has already visibly gone. Self-validating: a CONTROL pass proves
    // the pile is genuinely reachable first, so a "0 claimed" result can't be a false pass.
    const stale = await page.evaluate(() => {
      const st = window.__game.state, sub = st.substrate, net = st.active;
      const pile = (sub.foodPiles || []).find((p) => p.cells.some((i) => sub.cells[i].maxNutrient > 0));
      if (!pile) return { noPile: true };
      const at = (i) => sub.cellCenter(i % sub.cols, Math.floor(i / sub.cols));
      const c0 = at(pile.cells[0]);
      const near = net.addNode(c0.x + 55, c0.y, net.nodes[0]);   // a living strand within sensing range (135)
      near._revSeen = true; near._liveAt = 0;                    // ...already grown in
      const claimedCount = () => pile.cells.filter((i) => sub.cells[i].colonized >= 1).length;
      const reset = (nutrient) => { for (const i of pile.cells) { const c = sub.cells[i]; c.colonized = 0; c.nutrient = nutrient ? c.maxNutrient : 0; } };
      reset(true);                                       // CONTROL: food present → should claim
      net.colonizeReachablePiles(sub, st.rng);
      const control = claimedCount();
      reset(false);                                      // ants ate it: nutrient gone, footprint left
      net.colonizeReachablePiles(sub, st.rng);
      return { control, stripped: claimedCount(), total: pile.cells.length };
    });
    // A long grow commits its whole path at once and animates in afterwards. A pile at the far
    // end must NOT be digested until the growth has actually arrived there. Uses the pile
    // furthest from the colony so no already-grown strand is in reach (no false pass).
    const arrive = await page.evaluate(() => {
      const st = window.__game.state, sub = st.substrate, net = st.active;
      const at = (i) => sub.cellCenter(i % sub.cols, Math.floor(i / sub.cols));
      const nut = (p) => p.cells.reduce((s, i) => s + sub.cells[i].nutrient, 0);
      const nearest2 = (p) => { let b = Infinity; for (const i of p.cells) { const c = at(i); for (const nd of net.nodes) { const d = (nd.x - c.x) ** 2 + (nd.y - c.y) ** 2; if (d < b) b = d; } } return b; };
      const cands = (sub.foodPiles || []).filter((p) => nut(p) > 0).sort((a, b) => nearest2(b) - nearest2(a));
      const pile = cands[0];
      const sense = st.config.growth.sensingRadius;
      if (!pile || nearest2(pile) <= sense * sense) return { skip: true };   // no isolated pile to test with
      const c = at(pile.cells[0]);
      // The far end of a committed grow: a strand already inside the pile, still animating in.
      const tip = net.addNode(c.x, c.y, net.nodes[0]);
      tip._revSeen = true;
      tip._appearAt = net._nowMs + 4000;
      tip._liveAt = net._nowMs + 5000;               // finishes growing in 5s from now
      const before = nut(pile);
      net.colonizeReachablePiles(sub, st.rng);       // mid-animation: must NOT touch the pile
      const midway = nut(pile);
      net._nowMs = tip._liveAt + 1;                  // the front arrives
      net.colonizeReachablePiles(sub, st.rng);
      return { before, midway, after: nut(pile) };
    });
    ok('a far pile is NOT consumed while the growth is still animating toward it', arrive.skip || arrive.midway === arrive.before, arrive.skip ? 'no isolated pile on this map' : `nutrient ${Math.round(arrive.before)} → ${Math.round(arrive.midway)} mid-animation`);
    ok('the pile IS consumed the moment the growth actually arrives', arrive.skip || arrive.after === 0, arrive.skip ? 'skipped' : `nutrient → ${Math.round(arrive.after)} on arrival`);

    ok('control: a pile WITH food is reachable and gets claimed', stale.noPile || stale.control > 0, `${stale.control}/${stale.total} cells claimed`);
    ok('a pile already eaten by threats is NOT colonised (no spreading into vanished food)', stale.noPile || stale.stripped === 0, `${stale.stripped}/${stale.total} cells claimed after it was stripped`);

    // END-TO-END, the reported scenario: play a real BIG directed grow across the map. Nothing
    // may be digested at the moment it is played — piles must fall as the front reaches them.
    const bigGrow = await page.evaluate(async () => {
      const g = window.__game, st = g.state, sub = st.substrate, net = st.active, C = st.cards;
      st.runOver = false; st.winPending = false; net.alive = true; C.pendingOffers.length = 0;
      for (const n of net.nodes) { n.infected = false; n.health = 1; }
      net.energy = 800; net.water = 99; net.phosphorus = 99;
      st.clouds = []; st.nematodes = []; st.ants = [];     // isolate: only the colony can eat food
      const total = () => sub.cells.reduce((s, c) => s + c.nutrient, 0);
      const t0 = total(), n0 = net.nodes.length;
      C.hand.push({ id: C.seq++, name: 'Rhizomorph Lance' });   // an 18-segment directed grow
      const fp = net.frontierPoint() || net.nodes[0];
      const res = g.play(C.hand.length - 1, { x: fp.x + 700, y: fp.y + 60, srcX: fp.x, srcY: fp.y });
      const immediately = total(), nAfterPlay = net.nodes.length;
      await new Promise((r) => setTimeout(r, 3500));        // let the reveal play out
      return { played: !!(res && res.ok), t0, immediately, later: total(), grew: nAfterPlay - n0, nodes: net.nodes.length };
    });
    // (__game.play wraps resolveCardOp, which returns nothing — the strand count is the evidence.)
    ok('the big grow actually played and committed a long path', bigGrow.grew > 5, `+${bigGrow.grew} strands committed in one play`);
    ok('a big grow digests NOTHING at the instant it is played', bigGrow.immediately === bigGrow.t0, `map nutrient ${Math.round(bigGrow.t0)} → ${Math.round(bigGrow.immediately)} at play time`);
    console.log(`    [info] after the reveal finished, map nutrient ${Math.round(bigGrow.t0)} → ${Math.round(bigGrow.later)} (piles fall as the front arrives)`);

    // THREATS may only see/eat tissue that has appeared.
    const unseen = await page.evaluate(() => {
      const g = window.__game, st = g.state, sub = st.substrate, net = st.active;
      st.runOver = false; st.winPending = false; st.won = false; net.alive = true;
      st.clouds = []; net.energy = 800;
      st.config.nematodes.breedChance = 0;   // one worm only, so it can't wipe the colony mid-test
      for (const n of net.nodes) { n.infected = false; n.health = 1; }
      const base = net.nodes[0];
      const fresh = net.addNode(base.x, base.y + sub.cellSize * 6, base);   // committed but still animating in
      fresh._revSeen = true;
      fresh._appearAt = net._nowMs + 4000;
      fresh._liveAt = net._nowMs + 5000;
      const id = fresh.id;
      st.nematodes = [{ x: fresh.x + 4, y: fresh.y, heading: 0, hits: 0, stuck: 0, feeding: false, feedCd: 0, phase: 0 }];
      for (let i = 0; i < 3; i++) g.tickWorld(st);
      const targetedWhileGrowing = (st.nematodes[0] || {}).targetId === id;
      const survived = net.byId.has(id);
      net._nowMs = fresh._liveAt + 1;                                        // it finishes growing in
      st.runOver = false; st.winPending = false; net.alive = true;           // keep ticking if the worm hurt the colony
      for (let i = 0; i < 3; i++) g.tickWorld(st);
      return { targetedWhileGrowing, survived, eatenAfter: !net.byId.has(id), ranOut: st.runOver };
    });
    ok('a worm does not TARGET tissue that has not appeared yet', !unseen.targetedWhileGrowing, `targeted=${unseen.targetedWhileGrowing}`);
    ok('a worm cannot EAT tissue that has not appeared yet', unseen.survived, `survived=${unseen.survived}`);
    ok('once the tissue has appeared the worm can find and eat it', unseen.eatenAfter, `eaten=${unseen.eatenAfter}`);

    // WIN gate: must be at the actual SURFACE, and only once the growth has arrived.
    const win = await page.evaluate(() => {
      const g = window.__game, st = g.state, sub = st.substrate, net = st.active;
      st.runOver = false; st.winPending = false; st.won = false; net.alive = true; net.fruited = false;
      st.cards.pendingOffers.length = 0; st.clouds = []; st.nematodes = []; net.energy = 800;
      for (const n of net.nodes) { n.infected = false; n.health = 1; }
      let gc = -1;
      for (let c = sub.cols - 1; c >= 0; c--) if (sub.surface[c] && sub.surface[c].goal) { gc = c; break; }
      if (gc < 0) return { skip: true };
      const x = gc * sub.cellSize + sub.cellSize / 2;
      const gd = st.config.cards.goalSurfaceDepth;
      // Isolation: earlier tests (the big grow, the far-pile probes) may already have left
      // grown-in strands up near the goal, which would win before we place anything. Clear
      // the whole goal-surface band first so this measures ONLY the strands placed below.
      const preexisting = new Set();
      for (const n of net.nodes) {
        const s = sub.surfaceColumnAtX(n.x);
        if (s && s.goal && (n.y - sub.surfaceY) <= gd + 200) preexisting.add(n.id);
      }
      if (preexisting.size) net._removeNodes(preexisting);
      const cleared = preexisting.size;
      // (a) DEEP inside the goal zone — past the surface requirement, but well inside the
      //     Fruit action's old 170-unit reachDepth, which is what used to hand you the win.
      const deep = net.addNode(x, sub.surfaceY + gd + 80, net.nodes[0]);
      deep._revSeen = true; deep._liveAt = 0;
      g.tickWorld(st);
      const wonDeep = !!st.won;
      // (b) AT the surface, but still animating in.
      const tip = net.addNode(x, sub.surfaceY + 10, net.nodes[0]);
      tip._revSeen = true; tip._appearAt = net._nowMs + 4000; tip._liveAt = net._nowMs + 5000;
      g.tickWorld(st);
      const wonWhileGrowing = !!st.won;
      // (c) the growth arrives. Reset the run state first: the point under test is that the
      // win fires on arrival, not that the colony survived the two probe ticks above.
      st.runOver = false; st.winPending = false; net.alive = true; net.energy = 100000;
      for (const n of net.nodes) { n.infected = false; n.health = 1; }
      net._nowMs = tip._liveAt + 1;
      g.tickWorld(st);
      return { skip: false, gd, cleared, wonDeep, wonWhileGrowing, wonOnArrival: !!st.won,
               diag: { alive: net.alive, over: st.runOver, nodes: net.nodes.length,
                       healthy: net.healthyCount(), tipInf: tip.infected, tipHere: net.byId.has(tip.id) } };
    });
    ok('a strand deep in the goal zone does NOT win — it must reach the actual surface', win.skip || !win.wonDeep, win.skip ? 'no goal zone' : `depth ${win.gd + 80} (limit ${win.gd}) → won=${win.wonDeep}; cleared ${win.cleared} pre-existing`);
    ok('a strand at the goal surface does NOT win while it is still growing in', win.skip || !win.wonWhileGrowing, `won=${win.wonWhileGrowing}`);
    ok('the win lands the moment the growth arrives at the surface', win.skip || win.wonOnArrival, win.wonOnArrival ? 'won=true' : `won=false ${JSON.stringify(win.diag || {})}`);

    // The pills show TIME BARS that fill gradually, not one dot per round.
    const bars = await page.evaluate(async () => {
      const g = window.__game, st = g.state, net = st.active, C = st.cards;
      st.runOver = false; st.winPending = false; net.alive = true; net.energy = 100000;
      st.clouds = []; st.nematodes = [];
      C.engines = [{ name: 'Aquifer Tap', water: 2, every: 6, _et: 1 }];   // a 6-dot income stream
      C._engTick = 0;
      if (!window.__ui_open) { window.__ui_open = true; }
      const ui = document.querySelector('.engledger');
      // Make sure the ledger pill is open, then let the HUD refresh.
      for (let i = 0; i < 2; i++) { g.tickWorld(st); }
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      const led = document.querySelector('.engledger');
      const bar = led && led.querySelector('.cbar[data-cadkey]');
      const fill = bar && bar.firstElementChild;
      const oldDots = document.querySelectorAll('.clight').length;
      if (!fill) return { noLedger: !led, noBar: true, oldDots, html: led ? led.innerHTML.slice(0, 200) : '' };
      const barW = bar.getBoundingClientRect().width;
      const pct = () => parseFloat(fill.style.width) || 0;
      const p1 = pct();
      const el1 = fill;
      await new Promise((r) => setTimeout(r, 1300));      // ~2-3 world ticks
      const p2 = pct();
      // Smooth glide, not a jump: the rendered width should sit between the stepped values.
      const same = document.contains(el1) && bar.firstElementChild === el1;
      return { oldDots, p1, p2, barW, same, roundSeconds: st.config.cards.roundSeconds, trans: getComputedStyle(fill).transitionDuration };
    });
    ok('the old cadence dots are gone', (bars.oldDots || 0) === 0, `${bars.oldDots} dot element(s) left`);
    ok('the pills show a cadence time BAR', !bars.noBar, bars.noBar ? `no .cbar found (ledger html: ${bars.html})` : `bar ${Math.round(bars.barW)}px wide`);
    // Everything else about the bar — that its fill CLIMBS, that it glides on a CSS
    // transition, and that the element survives HUD refreshes — is hover-check.cjs's, along
    // with the same property for a hovered card. Those need an isolated page: on this file's
    // long-running one a draft or an affordability change mid-probe re-renders the row for
    // legitimate reasons, so copies here reported failures they couldn't justify.

    ok('no console/page errors across the #dev run', errors.length === 0, errors.slice(0,4).join(' | '));
    await page.close();
  }

  // ---------------- TEST 3: aim-drag cancel rules (own fresh run) --------------
  // Its own page: the drag rules need a live, playable run and an uncovered canvas, which the
  // destructive probes in TEST 2 can't guarantee.
  console.log('\n[TEST 3] #dev — grow-aim drag: only off-screen / back-to-origin cancels');
  {
    const page = await browser.newPage();
    const errors = await boot(page, '#dev');
    await page.mouse.click(400, 300).catch(() => {});   // dismiss the "Level 1" intro
    await sleep(2200);
    // Aim-drag cancelling: dragging FAR must keep the aim; only leaving the screen or pulling
    // back to the press point cancels. Driven through the real pointer path (pointer capture
    // and all), so this exercises exactly what the player's finger does.
    await stabilize(page, { noThreats: true });
    // Every press re-places the strand it is measured against and re-arms the card using the
    // CURRENT camera, so nothing between setup and press (a tick, a pan, a re-render) can
    // invalidate the target — the same shape as tests/aim-check.cjs.
    const pressAt = async (dx, dy, drags) => {
      const setup = await page.evaluate(() => {
        const g = window.__game, st = g.state, net = st.active;
        st.runOver = false; st.winPending = false; st.won = false; net.alive = true;
        st.clouds = []; st.nematodes = []; st.cards.pendingOffers.length = 0;
        net.energy = 1e6; net.water = 999; net.phosphorus = 999;
        const px = Math.round(g.camera.viewW / 2), py = Math.round(g.camera.viewH * 0.45);
        const w = g.camera.screenToWorld(px, py);
        const nd = net.addNode(w.x, w.y, net.nodes[0]);
        nd._revSeen = true; nd._liveAt = 0; nd.infected = false;
        const armedOk = g.armAim('Apical Drive');
        return { armedOk, px, py, vw: g.camera.viewW, vh: g.camera.viewH,
                 radius: Math.max(170, Math.min(420, 260 * g.camera.zoom)), zoom: g.camera.zoom };
      });
      const x0 = setup.px + dx, y0 = setup.py + dy;
      await page.mouse.move(x0, y0);
      await page.mouse.down();
      const states = [];
      for (const d of drags) {
        // 'maxX'/'maxY' mean "as far as possible while still on screen" — going past the edge
        // is itself a cancel, so a far-drag probe has to stay inside the viewport.
        const tx = d.dx === 'maxX' ? setup.vw - 20 : x0 + d.dx;
        const ty = d.dy === 'maxY' ? setup.vh - 20 : y0 + d.dy;
        await page.mouse.move(tx, ty);
        states.push(await page.evaluate(() => window.__game.aimState()));
      }
      await page.mouse.up();
      return { setup, states };
    };

    // Cancel rules, in one gesture: far out, back to the origin, out again, then off screen.
    const seq = await pressAt(0, 0, [
      { dx: 20, dy: 20 },                                   // registers a direction
      { dx: 'maxX', dy: 'maxY' },                           // FAR but ON screen — must NOT cancel
      { dx: 4, dy: 4 },                                     // back to the press point → cancel
      { dx: 320, dy: 140 },                                 // out again → re-armed
      { dx: -5000, dy: 0 },                                 // off the screen → cancel
    ]);
    const [, aFar, aBack, aAgain, aOff] = seq.states;
    ok('a long drag no longer cancels the grow aim', !!(aFar && aFar.armed && aFar.dragged && !aFar.cancelled), aFar ? `armed=${aFar.armed} dragged=${aFar.dragged} cancelled=${aFar.cancelled} at ${Math.round(aFar.d)}px` : 'no aim');
    ok('pulling back to the press point cancels', !!(aBack && aBack.cancelled), aBack ? `cancelled=${aBack.cancelled} at ${Math.round(aBack.d)}px` : 'n/a');
    ok('dragging back out re-arms the aim', !!(aAgain && aAgain.dragged && !aAgain.cancelled), aAgain ? `cancelled=${aAgain.cancelled}` : 'n/a');
    ok('dragging off the screen cancels', !!(aOff && aOff.cancelled), aOff ? `cancelled=${aOff.cancelled}` : 'n/a');

    // Forgiving aim: pressing NEAR the colony (not on it) must aim, not pan.
    const on = await pressAt(0, 0, [{ dx: 70, dy: 45 }]);
    const near = await pressAt(120, 0, [{ dx: 70, dy: 45 }]);
    const edge = await pressAt(Math.round(on.setup.radius * 0.85), 0, [{ dx: 70, dy: 45 }]);
    ok('pressing ON a strand aims', !!on.states[0].armed, `radius ${Math.round(on.setup.radius)}px at zoom ${on.setup.zoom.toFixed(2)}`);
    ok('pressing 120px off the colony still aims', !!near.states[0].armed, `armed=${near.states[0].armed}`);
    ok('pressing just inside the radius still aims', !!edge.states[0].armed, `at ${Math.round(on.setup.radius * 0.85)}px of ${Math.round(on.setup.radius)}px`);

    // A press provably beyond the radius of EVERY strand must still pan.
    const farPt = await page.evaluate(() => {
      const g = window.__game, net = g.state.active;
      const vw = g.camera.viewW, vh = g.camera.viewH;
      const radius = Math.max(170, Math.min(420, 260 * g.camera.zoom));
      const pts = net.nodes.map((n) => g.camera.worldToScreen(n.x, n.y));
      let best = { x: 30, y: 30 }, bestD = -1;
      for (let x = 30; x <= vw - 30; x += 40) for (let y = 30; y <= vh * 0.75; y += 40) {
        let d = Infinity;
        for (const p of pts) { const dd = Math.hypot(p.x - x, p.y - y); if (dd < d) d = dd; }
        if (d > bestD) { bestD = d; best = { x, y }; }
      }
      return { x: best.x, y: best.y, nearest: bestD, radius };
    });
    let offFar = null;
    if (farPt.nearest > farPt.radius + 20) {
      await page.evaluate(() => { window.__game.armAim('Apical Drive'); });
      await page.mouse.move(farPt.x, farPt.y);
      await page.mouse.down();
      await page.mouse.move(farPt.x + 50, farPt.y + 30);
      offFar = await page.evaluate(() => window.__game.aimState());
      await page.mouse.up();
    }
    ok('a press beyond the radius still pans instead of aiming', !!(offFar && !offFar.armed),
      offFar ? `nearest strand ${Math.round(farPt.nearest)}px away vs radius ${Math.round(farPt.radius)}px; armed=${offFar.armed}`
             : `inconclusive: nowhere on screen is clear of the colony`);


    ok('no console/page errors during the aim test', errors.length === 0, errors.slice(0,3).join(' | '));
    await page.close();
  }

  await browser.close();
  srv.close();
  console.log(`\n==== ${PASS} passed, ${FAIL} failed ====`);
  process.exit(FAIL ? 1 : 0);
})().catch((e) => { console.error('TEST HARNESS ERROR:', e); process.exit(2); });
