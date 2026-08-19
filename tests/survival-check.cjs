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
  // THE EDGE ROCK IS SOLID. The owner placed rock at both edges on purpose ("I placed them all in
  // such a way that the goal line is easily accessible"), and the only thing that makes it real is
  // this flag: with the channels dug, `pathClear` beats rock and those boulders are art you grow
  // straight through. The reachability that makes it SAFE is asserted by `traced-check`, which
  // floods the real fine mask; this is the setting that has to stay set.
  const dug = DISK.filter((d) => (d.layout || {}).clearChannels !== false);
  ok('no survival map digs entry/goal channels (its edge rock collides)', dug.length === 0,
    dug.length ? dug.map((d) => d.id).join(', ') : `${DISK.length} maps`);

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
        edgeSolid: (() => {
          const cs = sub.cellSize; let n = 0;
          for (let c = sub.cols - 7; c < sub.cols; c++)
            for (let rr = 0; rr < sub.rows; rr++)
              if (sub.solidAtWorld(c * cs + cs / 2, sub.surfaceY + rr * cs + cs / 2)) n++;
          return n;
        })(),
        audit: g.auditRocks ? g.auditRocks().holing : null,
      };
    });
    ok(`L${lvl}: the map is one of the survival pool`, r.survival && inGame.includes(r.id), r.id);
    ok(`L${lvl}: it carries the owner's red pile plus 5 orange and 5 yellow`,
      r.piles.engine === 1 && r.piles.normal === 5 && r.piles.duff === 5, JSON.stringify(r.piles));
    ok(`L${lvl}: its surface backdrop reached the world`, r.mountains + r.cities > 0,
      `${r.mountains} mountain(s), ${r.cities} city/cities`);
    ok(`L${lvl}: no pile holes the rock`, r.audit === 0, `${r.audit} holing`);
    // No channels dug — so the rock the owner placed at both edges is REAL rock, and the last
    // few columns are ordinary ground rather than a guaranteed lane. Measured on the substrate
    // rather than read off the JSON: this is the half that could silently stop being true.
    ok(`L${lvl}: no pathClear lane was dug (the edge rock collides)`,
      r.chX0 === null && r.chX1 === null && r.edgeSolid > 0,
      `channels ${r.chX0}/${r.chX1}, ${r.edgeSolid} solid cell(s) in the last 7 columns`);

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

  // WHICH WAYS IN PLAY THE POOL, and which one deliberately does not. This is the distinction the
  // owner reported twice: gating on `chosenSpecies` looked like "is this a real run?" and was
  // really "did they click a species tile?", so the picker's own Dev quick-start fell through —
  // first to a campaign map, then (once that was closed) to a procedural roll. Both halves are
  // asserted, because either one alone passes on a build that gets the other wrong.
  // ---- the level card, and the tutorial ------------------------------------------------------
  // Both were reported missing on survival, and both have the same root: survival does its own
  // thing at a point the campaign had already passed.
  console.log('\n-- the level card and the tutorial --');
  {
    // THE CARD IS BUILT BEFORE THE THREATS EXIST. `begin()` fills the intro payload, and
    // `seedLevelThreats` does not run until the first frame the rock mask lands — so counting the
    // live arrays (which is what `levelThreatList` did) reported 0 of everything and the card's
    // `count > 0` filter dropped all three portraits. Reported as "Survival: we're missing the
    // level screens with the threat counts."
    //
    // Asserted on the CARD, not on the payload: the payload was never the thing the player saw,
    // and a future change could restore the counts and still not render them.
    const card = await page.evaluate(async () => {
      const g = window.__game;
      document.querySelectorAll('#speciesSelect,#levelIntro,#tutorial').forEach((n) => n.remove());
      // The dev build SKIPS the level card, so a probe that just looks for it passes on a screen
      // that was never built. `state.config` is a deep clone taken at run start, so the LIVE flag
      // is what decides — same trap campaign-check documents.
      const wasDev = window.__cfg.dev.enabled;
      window.__cfg.dev.enabled = false;
      g.survival.play('marasmius', 5);
      for (let i = 0; i < 120 && !document.getElementById('levelIntro'); i++) {
        await new Promise((r) => setTimeout(r, 100));
      }
      const root = document.getElementById('levelIntro');
      const out = {
        built: !!root,
        // One tile per creature: the portrait img and the "×N" beside it.
        imgs: root ? [...root.querySelectorAll('img')].map((i) => (i.getAttribute('src') || '').split('/').pop()) : [],
        counts: root ? [...root.querySelectorAll('.li-count')].map((n) => n.textContent.trim()) : [],
        // What the curve says level 5 should hold, read off the live config like the block above.
        want: (() => { const c = g.state.config;
          return { ants: c.ants.nestCount, worms: c.nematodes.initialCount, clouds: c.trichoderma.initialPatches }; })(),
      };
      window.__cfg.dev.enabled = wasDev;
      return out;
    });
    ok('the survival level card is built', card.built);
    // Three creatures, three portraits. Level 5 is 3 ants / 5 worms / 5 clouds — all non-zero, so
    // a card missing one is missing it wrongly rather than filtering an absent creature.
    ok('it shows a portrait for each of the three threats', card.imgs.length === 3,
       `${card.imgs.length}: ${card.imgs.join(', ')}`);
    // The numbers are the CURVE's, which is the half that was actually broken — an empty array
    // and an array of "×0" both render as "no portraits", so the count has to be read.
    const wantCounts = ['×' + card.want.ants, '×' + card.want.clouds, '×' + card.want.worms];
    ok('...and the counts are the level\'s own, not zero',
       card.counts.join(',') === wantCounts.join(','),
       `card says ${card.counts.join(', ')} — curve says ${wantCounts.join(', ')}`);
  }
  {
    // ALL THE TIPS ON LEVEL 1 (owner). The campaign introduces the ants on 2 and the mould on 3,
    // which works because its ten levels arrive in a fixed order; survival draws its map at random
    // from seventeen, so level 2 is a different map every run and cannot be relied on to show a
    // creature. Asserted on the SCRIPT rather than by clicking through — several steps are gated
    // on a real player action, which a headless probe cannot supply.
    const tut = await page.evaluate(async () => {
      const g = window.__game;
      document.querySelectorAll('#levelIntro,#tutorial').forEach((n) => n.remove());
      const read = () => (g.tutorialScript() || []).map((s) => s.text);
      g.survival.play('marasmius', 1);
      await new Promise((r) => setTimeout(r, 400));
      g.startTutorial();
      const surv = read();
      // The CONTROL, on the same page: a campaign run must keep the split, or "all the tips are
      // on level 1" passes on a build that simply always inlines them.
      g.campaign.play('marasmius', 1);
      await new Promise((r) => setTimeout(r, 400));
      g.startTutorial();
      const camp = read();
      const campLasts = (g.tutorialScript() || []).filter((s) => s.last).length;
      // PUT THE GAME BACK. `campaign.play` calls `setGame('campaign')` and CONFIG.game is global,
      // so left set the very next section asked for a survival map and got
      // campaign-01-magnetite-c40 — a harness state leak that reads exactly like a real regression
      // in the thing that section is about.
      g.survival.play('marasmius', 1);
      await new Promise((r) => setTimeout(r, 400));
      document.querySelectorAll('#tutorial,#levelIntro').forEach((n) => n.remove());
      return { surv, camp, campLasts };
    }).catch((e) => ({ err: String(e && e.message) }));
    if (tut.err) {
      ok('the survival tutorial script can be read', false, tut.err);
    } else {
      const has = (l, re) => l.some((t) => re.test(t));
      ok('survival puts the ANT tip in the level-1 walkthrough', has(tut.surv, /Ants are/i),
         `${tut.surv.length} steps`);
      ok('...and the TRICHODERMA tip too', has(tut.surv, /green mould/i), `${tut.surv.length} steps`);
      ok('CONTROL: the campaign walkthrough still has neither',
         !has(tut.camp, /Ants are/i) && !has(tut.camp, /green mould/i), `${tut.camp.length} steps`);
      // The tips each carry `last: true` of their own (each is normally a script of one), so
      // concatenated as-is the Next button reads "Begin" three steps early.
      ok('exactly one step is marked last, so the button says Begin once',
         tut.campLasts === 1, `${tut.campLasts} step(s) marked last`);
      // ...AND THE TIPS LAND IN FRONT OF THE WHOLE CLOSING BLOCK, which is TWO steps now — the
      // plain "Good luck…" for a phone and the fullscreen line for a desktop. Splicing before the
      // last ELEMENT would drop the tips between them and leave a phone signing off three steps
      // early, and "the tips are present" passes either way.
      const iAnt = tut.surv.findIndex((t) => /Ants are/i.test(t));
      const iBye = tut.surv.findIndex((t) => /Good luck/i.test(t));
      ok('...and both tips come BEFORE the sign-off, not between the two closing steps',
         iAnt > 0 && iBye > 0 && iAnt < iBye && /full screen mode/i.test(tut.surv[tut.surv.length - 1] || ''),
         `ant at ${iAnt}, sign-off at ${iBye} of ${tut.surv.length - 1}`);
    }
  }

  console.log('\n-- which ways in play the pool --');
  const devQuick = await page.evaluate(async () => {
    const g = window.__game;
    document.querySelectorAll('#speciesSelect,#levelIntro,#tutorial').forEach((n) => n.remove());
    g.showPicker();                       // the button lives here, and reaching it clears the sandbox flag
    await new Promise((r) => setTimeout(r, 400));
    const b = document.getElementById('ssDev');
    if (!b) return { err: 'no Dev quick-start button' };
    b.click();
    await new Promise((r) => setTimeout(r, 2500));
    const s = g.state;
    return { id: s.levelDef ? s.levelDef.id : '(procedural)', survival: !!(s.levelDef && s.levelDef.survival), isRun: g.survival.isRun() };
  });
  ok("the picker's Dev quick-start plays the survival pool", devQuick.survival && inGame.includes(devQuick.id),
    devQuick.err || devQuick.id);
  // ...and the BOOT HASH does not. `#dev` is a developer's URL, not somebody playing Survival, and
  // it is the only route left with a procedural generator — `core-check`'s null case is "no core,
  // therefore procedural" and boots exactly this.
  const ctx3 = await browser.newContext({ viewport: { width: 1100, height: 700 } });
  const p3 = await ctx3.newPage();
  await p3.addInitScript(() => { window.MYCELIUM_SUPABASE = { url: '', anonKey: '' }; });
  await p3.goto(base + '/index.html#dev,turn', { waitUntil: 'domcontentloaded' });
  await p3.waitForSelector('#loadscreen.ld-ready', { timeout: 40000 }).catch(() => {});
  await p3.click('#loadscreen', { timeout: 5000 }).catch(() => {});
  await p3.waitForFunction(() => !!(window.__game && window.__game.state), { timeout: 40000 }).catch(() => {});
  await sleep(2000);
  const hashDev = await p3.evaluate(() => ({
    id: window.__game.state.levelDef ? window.__game.state.levelDef.id : null,
    core: window.__game.state.substrate.coreY,
  }));
  await ctx3.close();
  ok('the `#dev` boot hash still rolls a procedural map', hashDev.id === null, hashDev.id || 'procedural');
  ok('...so it still has no molten core (core-check depends on this)', hashDev.core == null, String(hashDev.core));

  await page.screenshot({ path: path.join(__dirname, '.artifacts', 'survival-level.png'), animations: 'disabled', timeout: 15000 }).catch(() => {});

  // ---- A STALE SAVED DRAFT MUST NOT EMPTY THE POOL ------------------------------------------
  // The owner AUTHORED these 17 in the in-game editor, so their browser holds a saved draft of
  // every one — saved BEFORE `survival: true` existed, and therefore without it. `allLevels()`
  // lets a draft SHADOW the committed file, `survivalMaps()` filters on the flag, and the pool
  // came out EMPTY; `levelDefFor` then falls through to the procedural generator. Reported as
  // survival still rolling procedural maps on their desktop while working on their phone — the
  // phone has no drafts, which is the tell. `allLevels()` inherits `survival` from the committed
  // map now, exactly as it already inherits `campaignLevel` for the same reason.
  //
  // Asserted through localStorage rather than the model, because the shadowing is the mechanism.
  console.log('\n-- a stale saved draft must not empty the pool --');
  const shadow = await page.evaluate((ids) => {
    const g = window.__game;
    const before = g.survival.maps().length;
    // Exactly what Save as… writes, minus the flag those drafts predate.
    const drafts = ids.map((id) => ({ format: 'mycelium-level', version: 1, id, name: id,
      chapter: 'Chapter 1', campaignLevel: null, assetsFrom: id,
      world: { width: 2952, height: 1400, surfaceY: 380, cellSize: 36 }, layout: {}, objects: [] }));
    try { localStorage.setItem('mycelium.savedLevels.v1', JSON.stringify(drafts)); } catch (_) { return { err: 'localStorage' }; }
    const after = g.survival.maps().length;
    try { localStorage.removeItem('mycelium.savedLevels.v1'); } catch (_) {}
    return { before, after, restored: g.survival.maps().length };
  }, inGame);
  ok('a draft of every survival map does not empty the pool', shadow.after === shadow.before,
    shadow.err || `${shadow.before} → ${shadow.after} with 17 flagless drafts shadowing them`);
  ok('...and clearing the drafts leaves it intact', shadow.restored === shadow.before,
    `${shadow.restored}`);

  // ---- "Old" comes back to the SAME map --------------------------------------------------
  // The rotation is a run-long shuffle held in memory. It is written into the resume snapshot and
  // restored AFTER `stockRun()` (which resets it) — get that ordering wrong, or drop the field,
  // and the player resumes onto a different map for the level they left off on. Neither half is
  // visible from the model alone, so this drives the real screens: New → picker → Start Run, then
  // a genuine page RELOAD, then Old. Its own context, because the point is that localStorage
  // survives and the module state does not.
  console.log('\n-- survival is off the title screen, and "Old" still returns to the same map --');
  const ctx2 = await browser.newContext({ viewport: { width: 1300, height: 820 } });
  const p2 = await ctx2.newPage();
  await p2.addInitScript(() => { window.MYCELIUM_SUPABASE = { url: '', anonKey: '' }; });
  const boot = async () => {
    await p2.waitForSelector('#loadscreen.ld-ready', { timeout: 40000 }).catch(() => {});
    await p2.click('#loadscreen', { timeout: 5000 }).catch(() => {});
  };
  await p2.goto(base + '/index.html', { waitUntil: 'domcontentloaded' }); await boot();
  await p2.waitForSelector('#titleScreen .ts-btn', { timeout: 30000 });
  // THE DOOR IS OPEN AGAIN (owner: "let's add survival back"). It was shut for one release and
  // the option to reopen it was one constant, `OFFER_SURVIVAL` — so the row's return is that line
  // and nothing else, which is the claim this pair of assertions makes.
  //
  // Everything BELOW still drives the run through `__menu.playSurvival` rather than through the
  // button. That was written when the row was gone and it stays: it is the shorter route, and it
  // keeps this file measuring survival's RULES rather than the title screen's markup, which
  // mode-check owns.
  const doors = await p2.evaluate(() => ['tsNew', 'tsCont', 'tsNewRt', 'tsContRt', 'tsNewCamp', 'tsContCamp']
    .filter((id) => !!document.getElementById(id)));
  ok('survival has a row on the title screen again', doors.includes('tsNew') && doors.includes('tsCont'),
     doors.join(', '));
  ok('...beside the campaign\'s, and real time still has none',
     doors.join(',') === 'tsNew,tsCont,tsNewCamp,tsContCamp', doors.join(', '));
  // AND THE DOOR OPENS ONTO SOMETHING. A row that renders is not a row that works: the survival
  // entry path sat unexercised for a release, and `onNew` branches on the game it is handed —
  // the campaign gets the opening screens, survival goes straight to the picker. Driven through
  // the real clicks (New → name → Start), because the ids and the handler table are exactly what
  // could have drifted apart while nothing was pressing them. It ends at the PICKER rather than
  // in a run: choosing a species is the next screen either way, and this file has its own,
  // shorter route into the run itself just below.
  await p2.click('#tsNew');
  await p2.waitForSelector('#tsNameStart', { timeout: 8000 });
  await p2.click('#tsNameStart');
  const arrived = await p2.waitForSelector('#speciesSelect', { timeout: 20000 }).then(() => true).catch(() => false);
  ok('pressing Survival "New" reaches the species picker', arrived);
  ok('...having set the game to survival, not the campaign',
     await p2.evaluate(() => window.__cfg.game === 'survival' && window.__cfg.mode === 'turn'),
     await p2.evaluate(() => window.__cfg.game + '/' + window.__cfg.mode));
  await p2.evaluate(() => { document.querySelectorAll('#speciesSelect').forEach((n) => n.remove()); });
  const ran = await p2.evaluate(async () => {
    if (!window.__menu.playSurvival('marasmius', 1, 'turn')) return false;   // the row carried its mode
    for (let i = 0; i < 80; i++) {
      if (window.__game.state && window.__game.state.levelDef) return true;
      await new Promise((r) => setTimeout(r, 100));
    }
    return false;
  });
  ok('a survival run still reaches a survival map', ran);
  if (ran) {
    await sleep(3000);
    const b4 = await p2.evaluate(() => {
      const g = window.__game;
      try { g.saveResume && g.saveResume(); } catch (_) {}   // as a tab-close would
      return { id: g.state.levelDef.id, order: g.survival.order().join('|') };
    });
    ok('a real survival run serves a survival map', /^0-survival-/.test(b4.id) || inGame.includes(b4.id), b4.id);
    const slot = await p2.evaluate(() => {
      for (const k of ['mycelium.resume.v1', 'mycelium.resume.rt.v1']) {
        try { const r = JSON.parse(localStorage.getItem(k) || 'null'); if (r) return (r.survivalOrder || []).join('|'); } catch (_) {}
      }
      return null;
    });
    ok('the rotation is written into the resume slot', slot === b4.order && !!slot,
      slot === null ? 'no survivalOrder saved' : `${(slot || '').split('|').length} map(s)`);
    await p2.goto(base + '/index.html', { waitUntil: 'domcontentloaded' }); await boot();
    await p2.waitForSelector('#titleScreen .ts-btn', { timeout: 30000 });
    // `__menu.continueRun` IS the title screen's "Old" — the same function the button calls, not
    // a second implementation of it. Driven directly here because survival's button is withheld;
    // the campaign's Old still goes through the identical path and campaign-check clicks it.
    // `__menu` and not `__game`: begin() installs `__game`, so on a title screen it does not
    // exist yet — which is the whole reason the boot-time hook exists.
    await p2.evaluate(() => window.__menu.continueRun('turn', 'survival'));
    const back = await p2.waitForFunction(() => !!(window.__game && window.__game.state && window.__game.state.levelDef),
      { timeout: 40000 }).then(() => true).catch(() => false);
    ok('"Old" resumes into a level', back);
    if (back) {
      await sleep(3000);
      const af = await p2.evaluate(() => ({ id: window.__game.state.levelDef.id, order: window.__game.survival.order().join('|') }));
      ok('...on the SAME map it left off on', af.id === b4.id, `${b4.id} → ${af.id}`);
      ok('...with the rotation restored, not reshuffled', af.order === b4.order,
        af.order === b4.order ? 'identical' : 'differs');
    }
  }
  await ctx2.close();

  ok('no page errors', errs.length === 0, errs.slice(0, 2).join(' | '));
  console.log(`\n==== ${pass} passed, ${fail} failed ====`);
  await browser.close(); srv.close();
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('HARNESS ERROR', e); process.exit(1); });
