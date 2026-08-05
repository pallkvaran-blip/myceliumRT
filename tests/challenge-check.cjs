/* The three CHALLENGE levels (scripts/author-challenges.mjs), and the `threats` block that
 * makes a designed encounter possible at all.
 *
 *   node tests/challenge-check.cjs
 *
 * These levels are DESIGNS, so the interesting failures are not "does it boot" — they are the
 * silent ones where the level boots perfectly and teaches nothing:
 *
 *   • a threat that cannot SENSE its target never moves, so the encounter simply does not
 *     happen ("in sensing range" = within sightRadius AND segmentClear);
 *   • a cloud heads for its NEAREST visible food, so one stepping-stone crumb in view
 *     outranks the prize the cloud was placed to race the player for;
 *   • a worm prefers mycelium over an ant trail, so a worm that can see the route abandons
 *     the trail and the whole ants-as-a-shield idea evaporates;
 *   • a threat RESPAWNS up to the campaign level's ceiling, so "exactly two worms" quietly
 *     becomes three and the player is punished by something the designer did not place.
 *
 * Every one of those looks correct in the JSON, in a diff, and in a screenshot. So this asserts
 * the RELATIONSHIPS on the built world instead: what each creature can see, what it eats first,
 * how many steps a prize survives, and that nothing arrives uninvited.
 *
 * Runs TURN-BASED (`#level,<id>,turn`) so a step is one tickWorld call and the measurements are
 * deterministic — in real time the wall clock ticks during every await and a fuse measured in
 * steps becomes a fuse measured in how busy the container is.
 */
const http = require('http'), fs = require('fs'), path = require('path');
const { chromium } = require('playwright');
const ROOT = path.resolve(__dirname, '..');
const ART = path.join(__dirname, '.artifacts');
const T = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.webp': 'image/webp', '.mp3': 'audio/mpeg', '.wav': 'audio/wav' };
let pass = 0, fail = 0;
const ok = (n, c, x) => { c ? (pass++, console.log('  PASS  ' + n + (x ? '  — ' + x : ''))) : (fail++, console.log('  FAIL  ' + n + (x ? '  — ' + x : ''))); };

const IDS = ['challenge-spoiling', 'challenge-swarm', 'challenge-antroad'];
const DEFS = new Map(IDS.map((id) => [id, JSON.parse(fs.readFileSync(path.join(ROOT, 'docs', 'levels', id + '.json'), 'utf8'))]));

async function boot(browser, base, hash) {
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
  const errs = [];
  page.on('pageerror', (e) => errs.push(String(e && e.message)));
  page.on('console', (m) => { if (m.type() === 'error') errs.push('console:' + m.text()); });
  await page.addInitScript(() => { window.MYCELIUM_SUPABASE = { url: '', anonKey: '' }; });
  await page.goto(base + '/index.html#' + hash, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#loadscreen.ld-ready', { timeout: 60000 }).catch(() => {});
  await page.click('#loadscreen', { timeout: 5000 }).catch(() => {});
  await page.waitForFunction(() => window.__game && window.__game.state && window.__game.state.active, null, { timeout: 30000 }).catch(() => {});
  const solid = await page.waitForFunction(() => window.__game.state.substrate._rockSolidified === true, null, { timeout: 60000 }).then(() => true).catch(() => false);
  return { page, errs, solid };
}

// Shared measuring helpers, injected once per page. Everything reads the built world.
const PROBE = () => {
  const g = window.__game, s = g.state, sub = s.substrate;
  window.__C = {
    // Sum of nutrient left in a pile — how a fuse is measured.
    pileFuel: (p) => p.cells.reduce((a, i) => a + sub.cells[i].nutrient, 0),
    piles: () => sub.foodPiles.map((p, i) => ({ i, kind: p.kind, n: p.cells.length, fuel: window.__C.pileFuel(p), at: sub.cellCenter(...(() => { const idx = p.cells[0]; return [idx % sub.cols, Math.floor(idx / sub.cols)]; })()) })),
    // Centre of a pile, as the mean of its cells — a pile is a diamond, not a point.
    pileCentre: (p) => {
      let x = 0, y = 0;
      for (const idx of p.cells) { const c = sub.cellCenter(idx % sub.cols, Math.floor(idx / sub.cols)); x += c.x; y += c.y; }
      return { x: x / p.cells.length, y: y / p.cells.length };
    },
    // THE engine rule for "can this thing act on that thing": inside the radius AND a clear
    // line. Anything that tests only distance will pass on a target behind a wall.
    senses: (from, to, radius) => Math.hypot(to.x - from.x, to.y - from.y) <= radius && sub.segmentClear(from.x, from.y, to.x, to.y),
    // Which pile is the nearest VISIBLE food to a point — i.e. what a cloud will actually go
    // for, which is not necessarily the pile it was parked next to.
    nearestVisiblePile: (from, radius) => {
      let best = null, bd = Infinity;
      sub.foodPiles.forEach((p, i) => {
        if (window.__C.pileFuel(p) <= 0) return;
        const ctr = window.__C.pileCentre(p);
        const d = Math.hypot(ctr.x - from.x, ctr.y - from.y);
        if (!Number.isFinite(d) || d > radius || d >= bd) return;
        if (!sub.segmentClear(from.x, from.y, ctr.x, ctr.y)) return;
        bd = d; best = { i, kind: p.kind, d: Math.round(d) };
      });
      return best;
    },
    step: (n) => { for (let k = 0; k < (n || 1); k++) g.tickWorld(g.state, 'both'); },
    counts: () => ({ clouds: s.clouds.length, worms: s.nematodes.length, ants: s.ants ? s.ants.length : 0 }),
    cfg: () => ({
      trychCeiling: s.config.trichoderma.initialPatches, trychRespawn: s.config.trichoderma.respawnChance,
      wormCeiling: s.config.nematodes.initialCount, wormRespawn: s.config.nematodes.respawnChance,
      antCeiling: s.config.ants.nestCount,
      cloudSight: s.config.trichoderma.sightRadius, wormSight: s.config.nematodes.sightRadius,
      breed: s.config.nematodes.breedChance, leaves: s.config.trichoderma.leavesPerRound,
      sense: s.config.growth.sensingRadius,
    }),
    trailCells: () => { let n = 0; for (const c of sub.cells) if (c.antTrail) n++; return n; },
    // Worm state flags, set by stepNematodes: `sees` = a strand is in sensing range (it hunts),
    // `trailing` = no strand, but an ant line is (it is defused).
    worms: () => s.nematodes.map((w) => ({ x: Math.round(w.x), y: Math.round(w.y), sees: !!w.sees, trailing: !!w.trailing, feeding: !!w.feeding })),
    // A CLOUD STORES cx/cy, A WORM STORES x/y. makeCloud returns { cx, cy, r, strength, … }
    // while makeWorm returns { x, y, … }, so the two threats disagree about the name of the
    // most basic field either of them has. Reading `.x` off a cloud is not an error — it is
    // undefined, so every distance becomes NaN, every `NaN <= sightRadius` is false, and the
    // measurement reports "this cloud can see nothing" about a cloud that is about to eat the
    // pile in front of it. Normalised here so nothing downstream has to remember.
    clouds: () => s.clouds.map((c) => ({ x: Math.round(c.cx), y: Math.round(c.cy), r: c.r, spent: !!c.spent })),
    root: () => ({ x: s.active.root.x, y: s.active.root.y }),
    // The stepping stones (duff) vs the prizes (cache / engine) — the route vs the rewards.
    spine: () => sub.foodPiles.filter((p) => p.kind === 'duff').map((p) => window.__C.pileCentre(p)),
    prizes: () => sub.foodPiles.filter((p) => p.kind !== 'duff').map((p, i) => ({ i, kind: p.kind, cells: p.cells.length, at: window.__C.pileCentre(p), fuel: window.__C.pileFuel(p) })),
    // Reachability on the FINE mask (the grid growth really collides against), from the
    // colony's own root — a pile in a sealed pocket is a reward nobody can ever take.
    reachable: (pts) => {
      const fsz = sub._fineSize, FC = sub._fineCols, FR = sub._fineRows, mask = sub._fineSolid;
      const open = (c, r) => c >= 0 && r >= 0 && c < FC && r < FR && mask[r * FC + c] === 0;
      const root = s.active.root;
      const c0 = Math.floor(root.x / fsz), r0 = Math.floor((root.y - sub.surfaceY) / fsz);
      const seen = new Uint8Array(FC * FR);
      if (!open(c0, r0)) return pts.map(() => false);
      const q = [[c0, r0]]; seen[r0 * FC + c0] = 1;
      while (q.length) {
        const [c, r] = q.pop();
        for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const nc = c + dc, nr = r + dr;
          if (!open(nc, nr) || seen[nr * FC + nc]) continue;
          seen[nr * FC + nc] = 1; q.push([nc, nr]);
        }
      }
      return pts.map((p) => {
        const pc = Math.floor(p.x / fsz), pr = Math.floor((p.y - sub.surfaceY) / fsz);
        return !!(open(pc, pr) && seen[pr * FC + pc]);
      });
    },
  };
  return true;
};

(async () => {
  fs.mkdirSync(ART, { recursive: true });
  const srv = await new Promise((res) => { const s = http.createServer((rq, rs) => { let p = decodeURIComponent(rq.url.split('?')[0].split('#')[0]); if (p === '/') p = '/index.html'; const fp = path.join(ROOT, p); if (!fp.startsWith(ROOT) || !fs.existsSync(fp) || fs.statSync(fp).isDirectory()) { rs.writeHead(404); rs.end('nf'); return; } rs.writeHead(200, { 'Content-Type': T[path.extname(fp)] || 'application/octet-stream' }); fs.createReadStream(fp).pipe(rs); }); s.listen(0, () => res(s)); });
  const base = 'http://localhost:' + srv.address().port;
  const browser = await chromium.launch({ headless: true });
  // FRAME THE WHOLE LEVEL. The default camera opens on the colony, i.e. the top-left corner, so
  // a default screenshot of a 2952-wide map shows the entry channel and none of the design — the
  // prizes, the guards and the branches are all off-frame. Zoomed out to the bounds instead,
  // because looking at these frames is how the layout gets judged at all: the first capture
  // showed the entry descent as a visible LADDER of identical piles down the left edge, which
  // every assertion in this file was perfectly happy with.
  const shot = async (page, name) => {
    await page.evaluate(() => {
      const g = window.__game, cam = g.camera;
      cam.zoom = cam.minZoomForBounds ? cam.minZoomForBounds() : 0.2;
      if (cam.clamp) cam.clamp();
      // renderFrame draws one frame synchronously — the only reliable way to get a fresh frame
      // here, since headless throttles rAF toward 1-2 Hz.
      for (let i = 0; i < 3; i++) g.renderFrame();
    }).catch(() => {});
    await page.screenshot({ path: path.join(ART, name), timeout: 15000, animations: 'disabled' }).catch(() => {});
  };

  // ---------------------------------------------------------------- the threats block ----
  // NEGATIVE CONTROL FIRST. Every assertion below about "nothing arrives uninvited" is
  // meaningless unless something DOES arrive uninvited on a map without the block — that is
  // the behaviour being fixed, and a control is the only way to know the block is what did it.
  console.log('\n  ── the `threats` block (negative control: a map without one) ──');
  {
    const { page } = await boot(browser, base, 'level,obsidian-c15,turn');
    await page.evaluate(PROBE);
    const c = await page.evaluate(() => window.__C.cfg());
    ok('a level with NO threats block keeps the campaign ceilings', c.trychCeiling > 0 && c.wormCeiling > 0,
      `trych ceiling ${c.trychCeiling}, worm ceiling ${c.wormCeiling}`);
    ok('a level with NO threats block still respawns (this is what gets fixed)', c.trychRespawn > 0 && c.wormRespawn > 0,
      `cloud respawn ${c.trychRespawn}, worm respawn ${c.wormRespawn}`);
    // The uninvited arrival itself, on a map that places nothing at all.
    const before = await page.evaluate(() => window.__C.counts());
    await page.evaluate(() => window.__C.step(60));
    const after = await page.evaluate(() => window.__C.counts());
    ok('...and a map that places NO threats grows some anyway', after.clouds + after.worms > 0,
      `placed 0, after 60 steps: ${after.clouds} clouds + ${after.worms} worms (was ${before.clouds}+${before.worms} at boot)`);
    await page.close();
  }

  for (const id of IDS) {
    const def = DEFS.get(id);
    console.log(`\n  ── ${id} (${def.name}) ──`);
    const { page, errs, solid } = await boot(browser, base, 'level,' + id + ',turn');
    await page.evaluate(PROBE);

    // ------------------------------------------------------------------ it is a level ----
    const meta = await page.evaluate((wantId) => {
      const s = window.__game.state;
      return { id: s.levelDef && s.levelDef.id, authored: s.substrate.authored, sprites: s.substrate.levelSprites.length, turn: !s.config.realtime.enabled, ok: s.levelDef && s.levelDef.id === wantId };
    }, id);
    ok(`${id}: boots from #level,${id}`, meta.ok, `levelDef=${meta.id}, authored=${meta.authored}`);
    ok(`${id}: boots TURN-BASED, so a step is one world tick`, meta.turn === true);
    ok(`${id}: no page errors`, errs.length === 0, errs.slice(0, 2).join(' | ') || 'none');
    ok(`${id}: rock mask solidified`, solid);
    // assetsFrom is the whole reason these levels need no sprite folder of their own; if it
    // failed to resolve the map draws EMPTY and every geometric reading below is a fiction.
    const srcRocks = JSON.parse(fs.readFileSync(path.join(ROOT, 'docs', 'levels', def.derivedFrom + '.json'), 'utf8'))
      .objects.filter((o) => o.t === 'boulder' || o.t === 'formation').length;
    ok(`${id}: assetsFrom resolved — the source map's rock is all here`, meta.sprites === srcRocks,
      `${meta.sprites}/${srcRocks} sprites from ${def.derivedFrom}`);

    // ---------------------------------------------------------------- the threats block ----
    const cfg = await page.evaluate(() => window.__C.cfg());
    const want = def.threats;
    ok(`${id}: the level's threat ceilings are applied`,
      cfg.trychCeiling === want.trych && cfg.wormCeiling === want.nematodes && cfg.antCeiling === want.ants,
      `trych ${cfg.trychCeiling}/${want.trych}, worms ${cfg.wormCeiling}/${want.nematodes}, ants ${cfg.antCeiling}/${want.ants}`);
    ok(`${id}: respawn is off, so the encounter is the one that was designed`,
      cfg.trychRespawn === 0 && cfg.wormRespawn === 0, `cloud ${cfg.trychRespawn}, worm ${cfg.wormRespawn}`);

    const placed = { clouds: def.objects.filter((o) => o.t === 'trichoderma').length, worms: def.objects.filter((o) => o.t === 'nematode').length, ants: def.objects.filter((o) => o.t === 'ant').length };
    const boot0 = await page.evaluate(() => window.__C.counts());
    ok(`${id}: exactly the creatures the JSON places are in the world`,
      boot0.clouds === placed.clouds && boot0.worms === placed.worms && boot0.ants === placed.ants,
      `${boot0.clouds}c/${boot0.worms}w/${boot0.ants}a vs JSON ${placed.clouds}c/${placed.worms}w/${placed.ants}a`);

    // ------------------------------------------------------------------- it is playable ----
    const prizes = await page.evaluate(() => window.__C.prizes());
    const spine = await page.evaluate(() => window.__C.spine());
    // The author recorded which piles are the main route; sub.foodPiles cannot tell a route
    // stone from a branch crumb (both are duff) and the distinction is the whole design.
    const routePts = (def.design && def.design.route) || spine;
    const reach = await page.evaluate((pts) => window.__C.reachable(pts), [...spine, ...prizes.map((p) => p.at)]);
    ok(`${id}: every pile is reachable from the colony's root`, reach.every(Boolean),
      `${reach.filter(Boolean).length}/${reach.length} of ${spine.length} stepping stones + ${prizes.length} prizes`);
    // The route rule, as CONNECTIVITY rather than as spacing. A basic grow only reaches an
    // attractor inside sensingRadius, so what matters is whether the colony can hop from its own
    // root to every pile — not how far apart two adjacent entries of sub.foodPiles happen to be.
    // That array is in stamping order, so consecutive entries include the jump from a branch's
    // last crumb back to the next route pile, and it read 2175 units on a level that is fine.
    const conn = await page.evaluate((r) => {
      const g = window.__game, sub = g.state.substrate;
      const pts = [window.__C.root(), ...sub.foodPiles.map((p) => window.__C.pileCentre(p))];
      const seen = new Array(pts.length).fill(false);
      seen[0] = true; const stack = [0];
      while (stack.length) {
        const i = stack.pop();
        for (let j = 0; j < pts.length; j++) {
          if (seen[j]) continue;
          if (Math.hypot(pts[j].x - pts[i].x, pts[j].y - pts[i].y) > r) continue;
          if (!sub.segmentClear(pts[i].x, pts[i].y, pts[j].x, pts[j].y)) continue;
          seen[j] = true; stack.push(j);
        }
      }
      return { total: pts.length - 1, reached: seen.filter(Boolean).length - 1 };
    }, cfg.sense);
    ok(`${id}: the colony can hop from its root to EVERY pile (no stranded food)`,
      conn.reached === conn.total, `${conn.reached}/${conn.total} piles inside ${cfg.sense}-unit hops`);

    // ------------------------------------------------------- the design's own assertions ----
    if (id === 'challenge-spoiling') {
      ok('spoiling: three engine prizes', prizes.length === 3 && prizes.every((p) => p.kind === 'engine'),
        prizes.map((p) => `${p.kind}:${p.cells}c`).join(' '));
      // r:1 is a 5-cell diamond because the eating rate was set from "a 5-cell pile in 6
      // steps" — the pile size IS the fuse length, so it is worth asserting rather than
      // trusting the radius arithmetic.
      // THREE DIFFERENT SIZES, because size is the only lever that staggers these fuses.
      // Distance cannot: sightRadius caps a lit fuse at 500 units and a cloud covers that in
      // under three actions at moveSpeed 5.0, so 250 / 360 / 480 all measured exactly 6 steps.
      // A pile pays its `energy` per PILE rather than per cell, so this varies the clock without
      // varying the reward.
      const sizes = prizes.map((p) => p.cells).sort((a, b) => a - b);
      ok('spoiling: the three prizes are DIFFERENT sizes, which is what staggers the fuses',
        new Set(sizes).size === 3, sizes.join(' / ') + ` cells at ${cfg.leaves} cells eaten per step`);

      const clouds = await page.evaluate(() => window.__C.clouds());
      // Each cloud must SENSE its prize — inside sightRadius with a clear line. A cloud that
      // cannot is a cloud that never moves, which is the silent way this design dies.
      const seen = await page.evaluate((cs) => cs.map((c) => ({
        prizes: window.__C.prizes().filter((p) => window.__C.senses(c, p.at, window.__C.cfg().cloudSight)).length,
        nearest: window.__C.nearestVisiblePile(c, window.__C.cfg().cloudSight),
      })), clouds);
      ok('spoiling: every cloud can SENSE an engine prize, so every fuse is lit from turn one',
        seen.every((s) => s.prizes > 0),
        seen.map((s) => `${s.prizes} prize(s) in sight, nearest food ${s.nearest ? s.nearest.kind + '@' + s.nearest.d : 'none'}`).join(' | '));

      // The fuse, measured rather than computed: let the world run with no player at all and
      // record the step each prize is stripped on.
      const fuse = await page.evaluate(() => {
        const out = window.__C.prizes().map((p) => ({ kind: p.kind, at: p.at, fuel0: p.fuel, goneAt: null }));
        for (let step = 1; step <= 40; step++) {
          window.__C.step(1);
          const now = window.__C.prizes();
          out.forEach((o, i) => { if (o.goneAt == null && now[i] && now[i].fuel <= 0) o.goneAt = step; });
        }
        return { out, left: window.__C.prizes().map((p) => p.fuel) };
      });
      const eaten = fuse.out.filter((o) => o.goneAt != null);
      console.log(`        fuses (steps until stripped, no player acting): ${fuse.out.map((o) => o.goneAt == null ? 'survived 40' : o.goneAt).join(', ')}`);
      ok('spoiling: the clouds really do strip the prizes — the reward is on a clock',
        eaten.length >= 2, `${eaten.length}/3 prizes stripped inside 40 steps`);
      ok('spoiling: the fuses burn at DIFFERENT rates, so the level is a triage decision',
        new Set(fuse.out.map((o) => o.goneAt)).size >= 2, fuse.out.map((o) => o.goneAt == null ? 'survived 40' : o.goneAt + ' steps').join(' vs '));
    }

    if (id === 'challenge-swarm') {
      ok('swarm: two worms and nothing else', boot0.worms === 2 && boot0.clouds === 0 && boot0.ants === 0,
        `${boot0.worms} worms, ${boot0.clouds} clouds, ${boot0.ants} ants`);
      ok('swarm: two draft prizes out in the open', prizes.length === 2 && prizes.every((p) => p.kind === 'normal'),
        prizes.map((p) => p.kind).join(', '));
      // The load-bearing geometry: the safe route is safe. If a worm can sense any stepping
      // stone, it hunts the player along the whole route and this is the gauntlet level the
      // campaign already has, not a lesson about the first bite.
      const exposure = await page.evaluate((sp) => {
        const sr = window.__C.cfg().wormSight;
        return window.__C.worms().map((w) => ({
          w, seesRoute: sp.filter((p) => window.__C.senses(w, p, sr)).length,
          seesPrize: window.__C.prizes().filter((p) => window.__C.senses(w, p.at, sr)).length,
        }));
      }, routePts);
      ok('swarm: no worm can sense the safe route — passing by is genuinely free',
        exposure.every((e) => e.seesRoute === 0), exposure.map((e) => `${e.seesRoute} stones in sight`).join(', '));
      ok('swarm: but each worm CAN sense the prize, so going for it is what exposes you',
        exposure.every((e) => e.seesPrize > 0), exposure.map((e) => `${e.seesPrize} prize(s) in sight`).join(', '));
      // The stake. Breeding is per TICK IN CONTACT, which is why the first bite is the
      // expensive one — worth pinning next to the design that rests on it.
      ok('swarm: the stake is that contact BREEDS every tick', cfg.breed >= 0.5, `breedChance ${cfg.breed}`);
      // And nothing turns up to do it for the player.
      await page.evaluate(() => window.__C.step(60));
      const after = await page.evaluate(() => window.__C.counts());
      ok('swarm: 60 steps with the colony out of sight adds no worms at all',
        after.worms === 2 && after.clouds === 0, `${after.worms} worms, ${after.clouds} clouds`);
    }

    if (id === 'challenge-antroad') {
      ok('antroad: one nest and a pack of three worms', boot0.ants === 1 && boot0.worms === 3,
        `${boot0.ants} nest(s), ${boot0.worms} worms`);
      // Enough steps for the trail to be LAID, not just started. The line creeps out ~2 cells
      // per step (ants.extendSpeed), so one step leaves a 13-cell stub hugging the surface and
      // whether a given worm is within sightRadius of it is then an accident of where the stub
      // stopped — one of the three read `trailing: false` on a layout where all three sit on the
      // finished road. The flags themselves are written during the move phase, so they say
      // nothing at all at boot.
      // A FIXED STEP COUNT IS A BET ABOUT THE MACHINE, and this one lost inside a full sweep:
      // 8 steps, 50/50 standalone on three consecutive runs, and one worm reading
      // `trailing: false` under sweep load. Step until the thing the assertion needs actually
      // exists — every worm on the trail — bounded, so a real break still trips it instead of
      // spinning. (Same fix core-check and scale-check took, for the same reason.)
      const settle = await page.evaluate(async () => {
        for (let i = 0; i < 60; i++) {
          window.__C.step(1);
          const w = window.__C.worms();
          if (w.length && w.every((x) => x.trailing)) return { steps: i + 1, all: true };
        }
        return { steps: 60, all: false };
      });
      const trail = await page.evaluate(() => window.__C.trailCells());
      ok('antroad: the nest has laid a trail for the worms to shadow', trail > 0, `${trail} trail cells`);

      // THE assertion. A worm falls back to an ant trail only when NO strand is in sight, and
      // the feed block bails before biting on that path — so `trailing` with `sees` false and
      // `feeding` false is a worm the ants have defused. This is the mechanic the campaign
      // does not currently use anywhere. Reported WITH the settle count, so a run that only
      // just made it is visible rather than looking identical to one that made it at once.
      const w1 = await page.evaluate(() => window.__C.worms());
      const defused = w1.filter((w) => w.trailing && !w.sees && !w.feeding);
      ok('antroad: every worm is shadowing the trail, not hunting — sees=false, trailing=true',
        defused.length === w1.length,
        `settled after ${settle.steps} step(s)${settle.all ? '' : ' — NEVER settled'} · ` +
        w1.map((w) => `sees=${w.sees} trail=${w.trailing} feed=${w.feeding}`).join(' | '));

      // The price of the shield: the ants are eating the prize the player came for.
      const drain = await page.evaluate(() => {
        const before = window.__C.prizes().map((p) => p.fuel);
        window.__C.step(25);
        return { before, after: window.__C.prizes().map((p) => p.fuel) };
      });
      const drained = drain.before.reduce((a, b) => a + b, 0) - drain.after.reduce((a, b) => a + b, 0);
      ok('antroad: the ants are draining the prize while the worms are busy — the shield has a price',
        drained > 0, `${drained} nutrient gone in 25 steps (${drain.before} -> ${drain.after})`);

      // ...and killing the ants removes the bait. The trail is re-stamped from the nests every
      // step (stepAnts clears the field first), so removing the nest is exactly what Excreting
      // it does to the trail.
      const promoted = await page.evaluate(() => {
        window.__game.state.ants = [];
        window.__C.step(2);
        return { trail: window.__C.trailCells(), worms: window.__C.worms() };
      });
      ok('antroad: kill the ants and the bait goes with them — no trail left',
        promoted.trail === 0, `${promoted.trail} trail cells after the nest is gone`);
      ok('antroad: ...and the worms stop shadowing, so the shield was the ants',
        promoted.worms.every((w) => !w.trailing), promoted.worms.map((w) => `trail=${w.trailing}`).join(' | '));
    }

    await shot(page, `challenge-${id}.png`);
    await page.close();
  }

  await browser.close();
  srv.close();
  console.log(`\n==== ${pass} passed, ${fail} failed ====`);   // the runner parses THIS form
  console.log(`  frames: tests/.artifacts/challenge-*.png`);
  process.exit(fail ? 1 : 0);
})();
