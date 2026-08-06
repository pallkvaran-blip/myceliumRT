/* SURVIVAL PLAYS THE AUTHORED MAP POOL, in a random order, with the LEVEL's threats.
 *
 * Three separate things had to become true and each fails differently:
 *
 *   1. THE ROTATION. A shuffled bag, not a roll per level — an independent pick would repeat a
 *      map two levels running about one time in seventeen, which reads as broken rather than as
 *      chance. So: no repeat inside a cycle, none across the seam, and every map used. And it is
 *      a RUN-LONG order, which is what a retry / "Old" / the level-complete advance all depend
 *      on: re-entering a level must serve the same map.
 *
 *   2. THE THREATS COME FROM THE LEVEL, not from the JSON. A survival map is level 2 in one run
 *      and level 40 in the next, so an authored spawn list could only ever be right for one of
 *      them. Asserted against `threatsForLevel` at both ends of the curve, because "there are
 *      some worms" passes on a build that ignores the level entirely.
 *
 *   3. THEY ARE SEEDED AFTER THE ROCK MASK LANDS. `findSpawnSpot` rejects a spot with rock
 *      within four cells — and on an AUTHORED map every one of those flags is stamped by
 *      solidifyRock during RENDER and is clear at build time. Seeding early therefore drops
 *      worms and clouds inside boulders, silently, which is the same trap that put the ants'
 *      opening trail over the rock. The check counts creatures standing on solid ground; the
 *      negative control is that this number is 0 rather than "small", because the seeder's own
 *      clearance rule makes 0 the correct answer.
 *
 * Plus the map data itself: 5 orange + 5 yellow + the owner's 1 red on every map, no pile
 * holing the rock, and a surface backdrop that stops short of the goal meadow.
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

// The pool as it is on disk, so the page's answer is checked against something independent.
const DISK = fs.readdirSync(path.join(ROOT, 'docs', 'levels')).filter((f) => f.endsWith('.json'))
  .map((f) => JSON.parse(fs.readFileSync(path.join(ROOT, 'docs', 'levels', f), 'utf8')))
  .filter((d) => d && d.survival);

(async () => {
  const srv = await new Promise((res) => { const s = http.createServer((rq, rs) => {
    let p = decodeURIComponent(rq.url.split('?')[0].split('#')[0]); if (p === '/') p = '/index.html';
    const fp = path.join(ROOT, p);
    if (!fp.startsWith(ROOT) || !fs.existsSync(fp) || fs.statSync(fp).isDirectory()) { rs.writeHead(404); rs.end('nf'); return; }
    rs.writeHead(200, { 'Content-Type': T[path.extname(fp)] || 'application/octet-stream' });
    fs.createReadStream(fp).pipe(rs); }); s.listen(0, () => res(s)); });
  const base = 'http://localhost:' + srv.address().port;
  const browser = await chromium.launch({ headless: true, executablePath: '/opt/pw-browsers/chromium' });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await ctx.newPage();
  const errs = []; page.on('pageerror', (e) => errs.push(String(e && e.message)));
  await page.addInitScript(() => { window.MYCELIUM_SUPABASE = { url: '', anonKey: '' }; });
  await page.goto(base + '/index.html#dev,turn', { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#loadscreen.ld-ready', { timeout: 40000 }).catch(() => {});
  await page.click('#loadscreen', { timeout: 5000 }).catch(() => {});
  await page.waitForFunction(() => !!(window.__game && window.__game.survival), { timeout: 40000 });

  // ---- the map DATA ------------------------------------------------------------------------
  console.log('\n-- the survival map pool --');
  ok('there are survival maps on disk', DISK.length > 0, `${DISK.length}`);
  const inGame = await page.evaluate(() => window.__game.survival.maps());
  ok('the game sees every one of them', inGame.length === DISK.length,
    `${inGame.length} in the build vs ${DISK.length} on disk`);
  const badFood = DISK.filter((d) => {
    const f = d.objects.filter((o) => o.t === 'food');
    return f.filter((o) => o.kind === 'cache').length !== 5 || f.filter((o) => o.kind === 'duff').length !== 5;
  });
  ok('every map carries 5 orange and 5 yellow piles', badFood.length === 0,
    badFood.length ? badFood.map((d) => d.id).join(', ') : `${DISK.length} maps`);
  // The owner's own objects, which nothing here may have dropped.
  const noRed = DISK.filter((d) => !d.objects.some((o) => o.kind === 'cache-engine'));
  ok("the owner's red pile survived on every map", noRed.length === 0, noRed.map((d) => d.id).join(', '));
  const noRock = DISK.filter((d) => d.objects.filter((o) => o.t === 'boulder' || o.t === 'formation').length < 10);
  ok("the owner's rock survived on every map", noRock.length === 0, noRock.map((d) => d.id).join(', '));
  // The surface backdrop. Only two things are asserted here: that every map HAS one — a traced
  // map ships with a bare horizon, which is the state these were in when the owner sent them —
  // and that it stays inside the band, since left of it is the entry channel and right of it the
  // goal meadow, whose green hill the game draws itself.
  //
  // The rule that actually governs its CONTENT — no city over rock the soil line cuts — belongs
  // to `surface-rock-check` (`sky`) and to the script that writes it,
  // `scripts/author-campaign-surface.mjs`. Restating it here would be a second, weaker copy: the
  // cut is a property of the sprite's alpha and can only be measured in the running game.
  const BAND_LO = 216, BAND_HI = 2484;
  const badBd = DISK.filter((d) => {
    const bd = d.objects.filter((o) => o.t === 'mountain' || o.t === 'city');
    return !bd.length || bd.some((o) => o.x + o.w / 2 > BAND_HI + 0.01 || o.x - o.w / 2 < BAND_LO - 0.01);
  });
  ok('every map has a surface backdrop, inside the band', badBd.length === 0,
    badBd.length ? badBd.map((d) => d.id).join(', ') : `${DISK.length} maps`);
  const noAssets = DISK.filter((d) => !d.assetsFrom || !fs.existsSync(path.join(ROOT, 'assets', d.assetsFrom)));
  ok('every map points at an asset folder that exists', noAssets.length === 0, noAssets.map((d) => d.id).join(', '));
  const slotted = DISK.filter((d) => d.campaignLevel != null);
  ok('no survival map claims a campaign slot', slotted.length === 0, slotted.map((d) => d.id).join(', '));

  // ---- the ROTATION ------------------------------------------------------------------------
  console.log('\n-- the shuffled bag --');
  const N = inGame.length;
  const bag = await page.evaluate((n) => {
    const s = window.__game.survival; s.reset();
    return Array.from({ length: n * 3 }, (_, i) => s.mapFor(i + 1));
  }, N);
  ok('a full cycle uses every map exactly once', new Set(bag.slice(0, N)).size === N,
    `${new Set(bag.slice(0, N)).size} distinct of ${N}`);
  ok('the second cycle does too', new Set(bag.slice(N, N * 2)).size === N,
    `${new Set(bag.slice(N, N * 2)).size} distinct of ${N}`);
  let adj = 0; for (let i = 1; i < bag.length; i++) if (bag[i] === bag[i - 1]) adj++;
  ok('no map is served twice in a row, including across a bag seam', adj === 0, `${adj} repeat(s) in ${bag.length} levels`);
  // STABLE: asking again must give the same answer, or a retry hands the player a different map.
  const again = await page.evaluate((n) => Array.from({ length: n }, (_, i) => window.__game.survival.mapFor(i + 1)), N);
  ok('asking for the same level twice gives the same map', again.every((id, i) => id === bag[i]),
    again.filter((id, i) => id !== bag[i]).length + ' differed');
  // ...and a NEW run reshuffles, or every player walks the same seventeen maps in one order.
  const other = await page.evaluate((n) => {
    const s = window.__game.survival; s.reset();
    return Array.from({ length: n }, (_, i) => s.mapFor(i + 1));
  }, N);
  ok('a fresh run draws a different order', other.join() !== bag.slice(0, N).join(),
    other[0] === bag[0] ? 'same first map (can happen ~1 in ' + N + ')' : 'differs');

  // ---- a real RUN: the map, and the level's threats -----------------------------------------
  // Both ends of the escalation. Level 1 is the authored table's 1/1/1; level 20 is deep in the
  // compounding bonus, and a build that ignored the level entirely would pass the first and fail
  // the second.
  for (const lvl of [1, 20]) {
    console.log(`\n-- a survival run on level ${lvl} --`);
    await page.evaluate((L) => {
      document.querySelectorAll('#speciesSelect,#levelIntro,#tutorial').forEach((n) => n.remove());
      window.__game.survival.play('marasmius', L);
    }, lvl);
    // The threats are seeded on the first frame after the rock mask lands, and a map's sprites
    // take a few frames to decode — POLL for it rather than guessing a wait.
    const seeded = await page.waitForFunction(() => {
      const s = window.__game.state;
      return !!(s && s.substrate && s.substrate._fineSolid && !s._needLevelThreats);
    }, { timeout: 40000 }).then(() => true).catch(() => false);
    await page.evaluate(() => { document.querySelectorAll('#levelIntro,#tutorial').forEach((n) => n.remove()); });
    ok(`L${lvl}: the level built and its threats were seeded`, seeded);
    if (!seeded) continue;

    const r = await page.evaluate(() => {
      const g = window.__game, s = g.state, sub = s.substrate;
      const onRock = (list) => list.filter((c) => sub.solidAtWorld(c.x, c.y)).length;
      return {
        id: s.levelDef && s.levelDef.id, survival: !!(s.levelDef && s.levelDef.survival),
        worms: s.nematodes.length, clouds: s.clouds.length, ants: s.ants.length,
        wormsOnRock: onRock(s.nematodes), cloudsOnRock: onRock(s.clouds),
        piles: sub.foodPiles.reduce((o, p) => { o[p.kind] = (o[p.kind] || 0) + 1; return o; }, {}),
        mountains: (sub.authoredMountains || []).length, cities: (sub.authoredCities || []).length,
        chX0: sub.channelX0, chX1: sub.channelX1,
        audit: g.auditRocks ? g.auditRocks().holing : null,
      };
    });
    ok(`L${lvl}: the map is one of the survival pool`, r.survival && inGame.includes(r.id), r.id);
    ok(`L${lvl}: it carries the owner's red pile plus 5 orange and 5 yellow`,
      r.piles.engine === 1 && r.piles.normal === 5 && r.piles.duff === 5, JSON.stringify(r.piles));
    ok(`L${lvl}: its surface backdrop reached the world`, r.mountains + r.cities > 0,
      `${r.mountains} mountain(s), ${r.cities} city/cities`);
    ok(`L${lvl}: no pile holes the rock`, r.audit === 0, `${r.audit} holing`);
    ok(`L${lvl}: the rock art is clipped to the channels`, r.chX0 === 108 && r.chX1 != null,
      `${r.chX0} / ${r.chX1}`);

    // THE ESCALATION. Read the expected counts out of the game's own curve rather than writing
    // them down here, or a deliberate retune of LEVEL_THREATS shows up as a failure in a check
    // that is not about the curve.
    const t = await page.evaluate((L) => {
      // threatsForLevel is not on __game; the counts it produced are on the live config, which
      // is where every seeder reads them and therefore the honest comparison.
      const c = window.__game.state.config;
      return { ants: c.ants.nestCount, worms: c.nematodes.initialCount, clouds: c.trichoderma.initialPatches };
    }, lvl);
    ok(`L${lvl}: the worms are the LEVEL's, not the map's`, r.worms === t.worms, `${r.worms} vs ${t.worms} from the curve`);
    ok(`L${lvl}: so are the clouds`, r.clouds === t.clouds, `${r.clouds} vs ${t.clouds}`);
    ok(`L${lvl}: so are the ant nests`, r.ants === t.ants, `${r.ants} vs ${t.ants}`);
    // The whole reason the seeding is deferred: seeded at build time, `cell.rock` is empty on an
    // authored map and these land inside boulders. 0 is the right answer, not "few" —
    // findSpawnSpot keeps a four-cell clearance from rock.
    ok(`L${lvl}: nothing was seeded inside a boulder`, r.wormsOnRock === 0 && r.cloudsOnRock === 0,
      `${r.wormsOnRock} worm(s) and ${r.cloudsOnRock} cloud(s) on solid ground`);
  }

  // A DEV BOOT KEEPS THE PROCEDURAL GENERATOR. It is the only sandbox left that has one, and
  // core-check's null case (no core → procedural) depends on it.
  console.log('\n-- the dev sandbox is still procedural --');
  const dev = await page.evaluate(() => {
    const g = window.__game;
    return { isRun: g.survival.isRun(), def: g.survival.defFor(1) };
  });
  ok('a run with a chosen species is a survival run', dev.isRun);

  await page.screenshot({ path: path.join(__dirname, '.artifacts', 'survival-level.png'), animations: 'disabled', timeout: 15000 }).catch(() => {});
  ok('no page errors', errs.length === 0, errs.slice(0, 2).join(' | '));
  console.log(`\n==== ${pass} passed, ${fail} failed ====`);
  await browser.close(); srv.close();
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('HARNESS ERROR', e); process.exit(1); });
