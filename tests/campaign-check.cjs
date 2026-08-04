/* THE CAMPAIGN: ten levels, each a specific procedurally generated map.
 *
 * What this guards, and why each one is here rather than obvious:
 *   - TEN LEVELS, AND IT ENDS. The old ladder ran to MAX_LEVEL (100) and was unwinnable past
 *     ~35 by design. Clearing level 10 must now finish the campaign, and clearing 9 must not —
 *     an off-by-one either strands the ending or fires it a level early, and neither shows up
 *     anywhere except at the end of a full run.
 *   - EACH LEVEL IS A MAP, NOT A ROLL. That is the entire difference between this and what came
 *     before, and it rests on `createState` deriving every generator decision from
 *     `makeRng(seed)`. If one `Math.random()` gets into that path the seeds stop meaning
 *     anything and NOTHING else notices — the game still plays, the levels are just different
 *     every time. So level 3 is built twice and the two worlds are compared cell for cell.
 *   - THE MAPS ARE PLAYABLE. Ten fixed seeds means a bad one ships forever, where a random roll
 *     would be gone next run. Every level is flood-filled from the colony's own root cell to the
 *     goal band; a sealed map would be unwinnable for every player, permanently.
 *   - EVERY COLONY STARTS AT LEVEL 1 (owner). The old `defaultStartLevel` let a higher tier open
 *     on 3 or 5, which over ten levels hands away half the campaign.
 *
 * Boots once and replays levels through `__game.campaign.play`, so it is seconds, not minutes.
 */
const http = require('http'); const fs = require('fs'); const path = require('path');
const { chromium } = require('playwright');
const ROOT = path.resolve(__dirname, '..');
const TYPES = { '.html':'text/html','.js':'text/javascript','.json':'application/json','.png':'image/png',
  '.jpg':'image/jpeg','.jpeg':'image/jpeg','.svg':'image/svg+xml','.webp':'image/webp','.mp3':'audio/mpeg','.wav':'audio/wav','.css':'text/css' };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let pass = 0, fail = 0;
const ok = (n, c, x) => { c ? (pass++, console.log('  PASS  ' + n + (x ? '  — ' + x : ''))) : (fail++, console.log('  FAIL  ' + n + (x ? '  — ' + x : ''))); };

(async () => {
  const srv = await new Promise((res) => { const s = http.createServer((rq, rs) => {
    let p = decodeURIComponent(rq.url.split('?')[0].split('#')[0]); if (p === '/') p = '/index.html';
    const fp = path.join(ROOT, p);
    if (!fp.startsWith(ROOT) || !fs.existsSync(fp) || fs.statSync(fp).isDirectory()) { rs.writeHead(404); rs.end('nf'); return; }
    rs.writeHead(200, { 'Content-Type': TYPES[path.extname(fp)] || 'application/octet-stream' });
    fs.createReadStream(fp).pipe(rs); }); s.listen(0, () => res(s)); });
  const base = 'http://localhost:' + srv.address().port;
  const browser = await chromium.launch({ headless: true, executablePath: '/opt/pw-browsers/chromium' });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errs = []; page.on('pageerror', (e) => errs.push(String(e && e.message)));
  page.on('console', (m) => { if (m.type() === 'error') errs.push('console:' + m.text()); });
  await page.addInitScript(() => { window.MYCELIUM_SUPABASE = { url: '', anonKey: '' }; });

  await page.goto(base + '/index.html#dev', { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#loadscreen.ld-ready', { timeout: 25000 }).catch(() => {});
  await page.click('#loadscreen', { timeout: 5000 }).catch(() => {});
  await page.waitForFunction(() => window.__game && window.__game.campaign, null, { timeout: 25000 });
  for (let i = 0; i < 4 && await page.$('#levelIntro'); i++) { await page.mouse.click(720, 420); await sleep(900); }

  // The world-reading probe, defined once in the page: build a campaign level and describe it.
  // The FLOOD is the assertion that matters — 4-neighbour over non-rock cells from the colony's
  // own root cell, asking whether any cell of the goal band is reachable. It is the coarse
  // `cell.rock` mask rather than the fine one, which is the right grain here: procedural maps
  // put their rock in cells (the fine mask is stamped from AUTHORED sprites and is empty on a
  // generated map, so flooding it would pass every level vacuously).
  await page.evaluate(() => {
    window.__probe = (level) => {
      const g = window.__game;
      g.campaign.play('marasmius', level);
      const st = g.state, sub = st.substrate;
      const C = sub.cols, R = sub.rows, cells = sub.cells;
      const solid = (i) => !!(cells[i] && cells[i].rock);
      // Root cell = where the colony was seeded.
      const n0 = st.active.nodes[0];
      const rc = Math.min(C - 1, Math.max(0, Math.floor(n0.x / sub.cellSize)));
      const rr = Math.min(R - 1, Math.max(0, Math.floor((n0.y - sub.surfaceY) / sub.cellSize)));
      const goalFrom = C - (st.config.substrate.goalCols || 6);
      const seen = new Uint8Array(C * R);
      const stack = [rr * C + rc];
      seen[stack[0]] = 1;
      let filled = 0, reachesGoal = false;
      while (stack.length) {
        const i = stack.pop(); filled++;
        const c = i % C, r = (i / C) | 0;
        if (c >= goalFrom) reachesGoal = true;
        const push = (c2, r2) => {
          if (c2 < 0 || r2 < 0 || c2 >= C || r2 >= R) return;
          const j = r2 * C + c2;
          if (seen[j] || solid(j)) return;
          seen[j] = 1; stack.push(j);
        };
        push(c + 1, r); push(c - 1, r); push(c, r + 1); push(c, r - 1);
      }
      // A digest of the ROCK mask: the map's identity, cheap to compare and stable.
      let h = 2166136261 >>> 0;
      for (let i = 0; i < C * R; i++) { h ^= solid(i) ? 1 : 0; h = Math.imul(h, 16777619) >>> 0; }
      const rock = cells.reduce((a, c) => a + (c.rock ? 1 : 0), 0);
      return { level, cols: C, rows: R, digest: h, rock, rockPct: Math.round((rock / (C * R)) * 100),
               filled, reachesGoal, rootAt: rc + ',' + rr, goalFrom,
               food: (sub.foodPiles || []).length, nodes: st.active.nodes.length,
               water: cells.reduce((a, c) => a + (c.reservoir ? 1 : 0), 0) };
    };
  });

  // ---- two games, one build -------------------------------------------------
  // Survival and Campaign are separate: the campaign is ten levels with fixed maps and no high
  // score, Survival is the 100-level ladder it always was. Everything below hangs off that flag,
  // so if it stops travelling from the title screen the campaign silently becomes Survival.
  const games = await page.evaluate(async () => {
    const g = window.__game, cfg = window.__cfg;
    const was = cfg.game;
    const read = () => ({ game: cfg.game, isRun: g.campaign.isRun(),
                          seed: g.campaign.seed(3), resumeKey: g.resumeKey ? g.resumeKey() : null });
    g.campaign.play('marasmius', 3);
    await new Promise((r) => setTimeout(r, 250));
    const camp = read();
    // Survival: the same species run, the other game.
    cfg.game = 'survival';
    const surv = { game: cfg.game, isRun: g.campaign.isRun() };
    cfg.game = was;
    return { camp, surv };
  });
  ok('a campaign run knows it is one', games.camp.game === 'campaign' && games.camp.isRun === true,
     JSON.stringify(games.camp));
  // The flag is the ONLY thing separating them, so flipping it must flip the behaviour.
  ok('the same run under Survival is not a campaign run', games.surv.isRun === false,
     JSON.stringify(games.surv));

  // ---- the shape ------------------------------------------------------------
  const shape = await page.evaluate(() => {
    const c = window.__game.campaign;
    return { levels: c.levels, start: c.startLevel, seeds: c.seeds, payout: c.payout,
             past: c.seed(c.levels + 1), zero: c.seed(0), first: c.seed(1), last: c.seed(c.levels) };
  });
  ok('the campaign is ten levels', shape.levels === 10, String(shape.levels));
  ok('every colony starts on level 1', shape.start === 1, String(shape.start));
  ok('there is one seed per level', shape.seeds.length === shape.levels,
     `${shape.seeds.length} seeds for ${shape.levels} levels`);
  // Two levels sharing a seed would be the same map twice, which reads as a generator bug.
  ok('the seeds are all distinct', new Set(shape.seeds).size === shape.seeds.length,
     shape.seeds.map((s) => '0x' + s.toString(16)).join(' '));
  ok('every seed is usable', shape.seeds.every((s) => Number.isFinite(s) && s > 0));
  // Off the ladder there is no fixed map — a dev run or a level past the end must roll a fresh
  // one, which is what `null` tells startRun.
  ok('off the ladder there is no fixed seed', shape.past === null && shape.zero === null,
     `level ${shape.levels + 1}: ${shape.past}, level 0: ${shape.zero}`);
  console.log(`  note  a full clear pays ${shape.payout} Spores (sum of 1..${shape.levels})`);

  // ---- the ten maps ---------------------------------------------------------
  const maps = [];
  for (let n = 1; n <= shape.levels; n++) {
    maps.push(await page.evaluate((lv) => window.__probe(lv), n));
    await sleep(60);
  }
  ok('all ten levels build', maps.length === 10 && maps.every((m) => m && m.cols > 0 && m.rows > 0),
     maps.map((m) => `${m.level}:${m.cols}x${m.rows}`).join(' '));
  ok('every level seeds a colony', maps.every((m) => m.nodes > 0),
     maps.map((m) => m.level + ':' + m.nodes).join(' '));
  ok('every level has food to eat', maps.every((m) => m.food > 0),
     maps.map((m) => m.level + ':' + m.food).join(' '));
  // THE ONE THAT MATTERS: a sealed map is unwinnable for every player, forever, because the seed
  // is fixed. Flood from the colony's own root to the goal band.
  const sealed = maps.filter((m) => !m.reachesGoal);
  ok('the goal is reachable on every level', sealed.length === 0,
     sealed.length ? 'sealed: ' + sealed.map((m) => 'L' + m.level).join(', ')
                   : maps.map((m) => 'L' + m.level + ' ' + m.rockPct + '% rock').join(' · '));
  // A map that is nearly all rock (or nearly none) is playable but not a level. Wide band —
  // this is a smoke test for a pathological seed, not a balance judgement.
  const odd = maps.filter((m) => m.rockPct > 60 || m.rockPct < 2);
  ok('no level is a pathological amount of rock', odd.length === 0,
     odd.map((m) => 'L' + m.level + ' ' + m.rockPct + '%').join(', ') || 'all 2-60%');
  // Ten identical maps would mean the seed isn't reaching the generator at all.
  ok('the ten levels are ten different maps',
     new Set(maps.map((m) => m.digest)).size === maps.length,
     new Set(maps.map((m) => m.digest)).size + ' distinct of ' + maps.length);

  // ---- determinism: a level is a MAP, not a roll ----------------------------
  // If any `Math.random()` gets into the generation path the seeds silently stop meaning
  // anything: the game still plays, the levels are just different every time and no other check
  // would notice. Build level 3 again and compare the rock mask cell for cell.
  const again = await page.evaluate(() => window.__probe(3));
  const third = maps[2];
  ok('the same level builds the same map twice',
     again.digest === third.digest && again.rock === third.rock,
     `digest ${third.digest} vs ${again.digest}, rock ${third.rock} vs ${again.rock}`);
  ok('...and seeds the colony in the same place', again.rootAt === third.rootAt,
     `${third.rootAt} vs ${again.rootAt}`);

  // ---- the ladder ends ------------------------------------------------------
  // Clearing 9 continues; clearing 10 finishes the campaign. Both go through the real win path.
  const clear = async (level) => page.evaluate(async (lv) => {
    document.querySelectorAll('#ssLevelComplete, #ssGameWon, #levelIntro').forEach((n) => n.remove());
    window.__game.campaign.play('marasmius', lv);
    await new Promise((r) => setTimeout(r, 200));
    window.__game.winLevel();
    // presentRunOver waits on the celebration; poll rather than guess a duration.
    for (let i = 0; i < 60; i++) {
      if (document.getElementById('ssLevelComplete') || document.getElementById('ssGameWon')) break;
      await new Promise((r) => setTimeout(r, 200));
    }
    return { complete: !!document.getElementById('ssLevelComplete'), won: !!document.getElementById('ssGameWon') };
  }, level);

  const nine = await clear(9);
  ok('clearing level 9 does not end the campaign', nine.complete === true && nine.won === false,
     JSON.stringify(nine));
  const ten = await clear(10);
  ok('clearing level 10 finishes the campaign', ten.won === true && ten.complete === false,
     JSON.stringify(ten));
  await page.evaluate(() => document.querySelectorAll('#ssLevelComplete, #ssGameWon').forEach((n) => n.remove()));

  // ---- the level intro counts toward the end --------------------------------
  // A finite campaign has to say it is finite; the wordmark can't carry the total.
  // The dev build SKIPS the intro (`state.config.dev.enabled`), and `state.config` is a deep clone
  // taken at run start — so turning the LIVE flag off before starting the level is what makes the
  // screen appear at all. Without this the assertion passes on a screen that was never built,
  // which is the zero-coverage pass CLAUDE.md warns about; the flag goes back on afterwards.
  const intro = await page.evaluate(async () => {
    document.querySelectorAll('#levelIntro, #ssLevelComplete, #ssGameWon').forEach((n) => n.remove());
    const was = window.__cfg.dev.enabled;
    window.__cfg.dev.enabled = false;
    window.__game.campaign.play('marasmius', 4);
    for (let i = 0; i < 60 && !document.getElementById('levelIntro'); i++) await new Promise((r) => setTimeout(r, 150));
    const box = document.querySelector('#levelIntro .li-level');
    const el = document.querySelector('#levelIntro .li-of');
    // The threat tallies ("×3" under each creature portrait) live on the same screen. The
    // counter was first written with THEIR class name, which already existed further down the
    // stylesheet — the later rule won and the campaign position came out in the tally's white
    // bold serif, reading as one more creature count. The text assertion passed throughout.
    const tally = document.querySelector('#levelIntro .li-threat .li-count');
    const cs = el ? getComputedStyle(el) : null, ts = tally ? getComputedStyle(tally) : null;
    const out = { shown: !!document.getElementById('levelIntro'),
                  text: el ? el.textContent.trim() : null,
                  aria: box ? box.getAttribute('aria-label') : null,
                  tallies: !!tally,
                  distinct: !!(cs && ts && (cs.fontFamily !== ts.fontFamily || cs.color !== ts.color)),
                  font: cs ? cs.fontFamily.split(',')[0] : null, color: cs ? cs.color : null };
    window.__cfg.dev.enabled = was;
    document.querySelectorAll('#levelIntro').forEach((n) => n.remove());
    return out;
  });
  ok('the level intro appears with the dev flag off', intro.shown === true);
  ok('the intro counts the level out of the campaign length', intro.text === '4 of 10',
     intro.text || '(no counter)');
  ok('...and a screen reader hears the same', intro.aria === 'Level 4 of 10', intro.aria);
  ok('the intro still shows its threat tallies', intro.tallies === true);
  // A position is not a threat. This is the assertion that would have caught the class collision
  // the text assertion sailed straight through.
  ok('the campaign counter does not look like a threat tally', intro.distinct === true,
     `${intro.font} ${intro.color}`);

  // ---- the selection screen sends you to level 1 ----------------------------
  const start = await page.evaluate(async () => {
    let got = null;
    document.querySelectorAll('#speciesSelect').forEach((n) => n.remove());
    window.__game.showPicker();
    await new Promise((r) => setTimeout(r, 500));
    const root = document.getElementById('speciesSelect');
    const lede = (root.querySelector('.ss-lede') || {}).textContent || '';
    // Read the level each Select button would start on, without actually starting three runs.
    const before = window.__game.campaign.level();
    root.querySelector('#ssAvail .ss-slot:last-child .ss-selbtn').click();
    await new Promise((r) => setTimeout(r, 400));
    got = window.__game.campaign.level();
    return { lede, before, got };
  });
  ok('Select starts the run on level 1', start.got === 1, `level ${start.got}`);
  ok('the screen says how long the campaign is', /10 levels/.test(start.lede), start.lede.slice(0, 80));

  // ---- ending a run deliberately ------------------------------------------
  // "Players decide what cards to keep when they decide to end each run" — the exit is a normal
  // campaign move, so it must reach the keep screen, not a game-over.
  const ended = await page.evaluate(async () => {
    document.querySelectorAll('#loadoutSelect, #ssLevelComplete, #ssGameWon').forEach((n) => n.remove());
    window.__game.campaign.play('marasmius', 2);
    await new Promise((r) => setTimeout(r, 300));
    window.__game.campaign.endRun();
    for (let i = 0; i < 60 && !document.getElementById('loadoutSelect'); i++) await new Promise((r) => setTimeout(r, 200));
    const root = document.getElementById('loadoutSelect');
    const title = root ? (root.querySelector('.lo-h-title') || {}).textContent : null;
    const instr = root ? (root.querySelector('.lo-h-instr') || {}).textContent : null;
    if (root) root.remove();
    return { reached: !!root, title, instr };
  });
  ok('ending a run reaches the keep screen', ended.reached === true, ended.title || '(never appeared)');
  ok('...and it asks what to keep in your deck', /deck/i.test(ended.instr || ''), ended.instr);

  // ---- retries --------------------------------------------------------------
  // "When a player dies they should be given the option of trying the same level again if they
  // have retries left... if they are out of retries, that option should still be visible on the
  // death screen, just not usable." Every clause of that is an assertion below.
  const die = (level, lives, deck) => page.evaluate(async (a) => {
    const g = window.__game;
    document.querySelectorAll('#loadoutSelect, #ssLevelComplete, #ssGameWon, #levelIntro').forEach((n) => n.remove());
    g.store.reset();
    if (a.lives) { g.store.credit(1e6); for (let i = 0; i < a.lives; i++) g.store.buy('lives'); }
    if (a.deck) g.deck.set(a.deck);
    g.campaign.play('marasmius', a.level);
    await new Promise((r) => setTimeout(r, 300));
    const before = { lives: g.campaign.lives(), entry: g.campaign.entry(), spores: g.store.balance(),
                     level: g.campaign.level(), water: g.state.active.water };
    // Kill the colony the way the engine does, then let presentRunOver run.
    g.state.active.alive = false; g.state.runOver = true;
    g.state.runResult = { won: false, died: true, cause: 'devoured', turns: g.state.turn };
    g.killColony ? null : null;
    window.__present ? window.__present() : null;
    return before;
  }, { level, lives, deck });

  // presentRunOver is driven from the render loop; the simplest honest trigger is the same one
  // the settings menu uses, which ends the run and lands on the identical screen.
  const dieAndShow = async (level, lives) => {
    const before = await page.evaluate(async (a) => {
      const g = window.__game;
      document.querySelectorAll('#loadoutSelect, #ssLevelComplete, #ssGameWon, #levelIntro').forEach((n) => n.remove());
      g.store.reset();
      if (a.lives) { g.store.credit(1e6); for (let i = 0; i < a.lives; i++) g.store.buy('lives'); }
      g.campaign.play('marasmius', a.level);
      await new Promise((r) => setTimeout(r, 350));
      const snap = { lives: g.campaign.lives(), entry: g.campaign.entry(), spores: g.store.balance(),
                     level: g.campaign.level() };
      g.campaign.endRun();
      for (let i = 0; i < 60 && !document.getElementById('loadoutSelect'); i++) await new Promise((r) => setTimeout(r, 200));
      const btn = document.getElementById('loTertiary');
      return { ...snap, shown: !!btn, label: btn ? btn.textContent.trim() : null,
               disabled: btn ? btn.disabled : null, sporesAfterDeath: g.store.balance() };
    }, { level, lives });
    return before;
  };

  // Buying 2 on top of the base 1 → three retries in the run.
  const withLives = await dieAndShow(3, 2);
  ok('the run stocks the base retry plus what the store sold', withLives.lives === 3, String(withLives.lives));
  ok('the level records the state it was entered in', !!withLives.entry && withLives.entry.level === 3,
     withLives.entry ? `level ${withLives.entry.level}, ${withLives.entry.hand.length} in hand` : 'no snapshot');
  ok('the death screen offers a retry', withLives.shown === true && withLives.disabled === false, withLives.label);
  ok('...and says how many are left', /3 left/.test(withLives.label || ''), withLives.label);

  const retried = await page.evaluate(async () => {
    const g = window.__game;
    const before = { lives: g.campaign.lives(), spores: g.store.balance(), level: g.campaign.level(),
                     entry: g.campaign.entry() };
    document.getElementById('loTertiary').click();
    for (let i = 0; i < 60; i++) {
      if (!document.getElementById('loadoutSelect') && g.state && g.state.active && !g.state.runOver) break;
      await new Promise((r) => setTimeout(r, 200));
    }
    const st = g.state;
    return { before, lives: g.campaign.lives(), level: g.campaign.level(), spores: g.store.balance(),
             over: !!st.runOver, alive: !!st.active.alive, screen: !!document.getElementById('loadoutSelect'),
             res: { energy: st.active.energy, water: st.active.water, phosphorus: st.active.phosphorus },
             hand: (st.cards.hand || []).map((h) => h.name).sort().join(','),
             deckLen: (st.cards.drawDeck || []).length };
  });
  ok('retrying restarts the SAME level', retried.level === retried.before.level && retried.over === false,
     `level ${retried.before.level} → ${retried.level}, over=${retried.over}`);
  ok('a retry costs one of them', retried.lives === retried.before.lives - 1,
     `${retried.before.lives} → ${retried.lives}`);
  ok('the death screen closes', retried.screen === false);
  // "start with the same cards and resources as they previously had" — against the snapshot the
  // level was entered with, not against whatever was left when the colony died.
  const e = retried.before.entry;
  ok('...with the resources it was entered with',
     !!e && retried.res.energy === e.res.energy && retried.res.water === e.res.water
        && retried.res.phosphorus === e.res.phosphorus,
     e ? `entered ${JSON.stringify(e.res)}, retried ${JSON.stringify(retried.res)}` : 'no snapshot');
  ok('...and the same cards in hand',
     !!e && retried.hand === e.hand.slice().sort().join(','),
     e ? `entered [${e.hand.sort().join(',')}] vs [${retried.hand}]` : 'no snapshot');
  ok('...and the same draw deck', !!e && retried.deckLen === e.deck.length,
     e ? `${e.deck.length} vs ${retried.deckLen}` : 'no snapshot');
  // A death pays half the level's Spores. A retry cancels the death, so it must cancel the pay —
  // otherwise a three-retry run banks the bonus four times on one level.
  ok('a retry hands back the Spores the cancelled death paid',
     retried.spores === withLives.spores, `${withLives.spores} → death ${withLives.sporesAfterDeath} → retry ${retried.spores}`);

  // The map has to come back identical, or "the same level" is only half true. Fixed seeds are
  // what make that so, and this is where it pays off for a player.
  //
  // Both digests are taken a beat AFTER the level starts, deliberately: the rock mask settles
  // over the first frames, so a digest read synchronously (as `__probe` does) and one read after
  // a pause disagree on the same map. Comparing across that gap is a false failure — which is
  // exactly what this assertion did first time round.
  const sameMap = await page.evaluate(async () => {
    const g = window.__game;
    const dig = () => { let h = 2166136261 >>> 0;
      for (const c of g.state.substrate.cells) { h ^= c.rock ? 1 : 0; h = Math.imul(h, 16777619) >>> 0; }
      return h; };
    const retried = dig();
    const level = g.campaign.level();
    g.campaign.play('marasmius', level);          // a FRESH build of the same level, same wait
    await new Promise((r) => setTimeout(r, 400));
    return { retried, fresh: dig(), level, seed: g.state.seed };
  });
  ok('the retried level is the same map as a fresh build of it',
     sameMap.retried === sameMap.fresh,
     `level ${sameMap.level} (seed ${sameMap.seed}): retried ${sameMap.retried} vs fresh ${sameMap.fresh}`);

  // RUNNING OUT. Everyone starts with one retry now, so zero is only reachable by SPENDING it —
  // which makes this the more useful test anyway: buy nothing, die, retry, die again.
  const spent = await page.evaluate(async () => {
    const g = window.__game;
    document.querySelectorAll('#loadoutSelect, #levelIntro').forEach((n) => n.remove());
    g.store.reset();                       // no purchases: the base retry and nothing else
    g.campaign.play('marasmius', 2);
    await new Promise((r) => setTimeout(r, 350));
    const stocked = g.campaign.lives();
    const toDeath = async () => {
      g.campaign.endRun();
      for (let i = 0; i < 60 && !document.getElementById('loadoutSelect'); i++) await new Promise((r) => setTimeout(r, 200));
      const b = document.getElementById('loTertiary');
      return { label: b ? b.textContent.trim() : null, disabled: b ? b.disabled : null, shown: !!b };
    };
    const first = await toDeath();
    document.getElementById('loTertiary').click();          // spend the only one
    for (let i = 0; i < 60; i++) { if (!document.getElementById('loadoutSelect') && !g.state.runOver) break;
      await new Promise((r) => setTimeout(r, 200)); }
    await new Promise((r) => setTimeout(r, 300));
    const after = g.campaign.lives();
    const second = await toDeath();
    document.querySelectorAll('#loadoutSelect').forEach((n) => n.remove());
    return { stocked, first, after, second };
  });
  ok('a run with no purchases still gets the one retry everyone starts with',
     spent.stocked === 1 && /1 left/.test(spent.first.label || ''), `${spent.stocked} — "${spent.first.label}"`);
  ok('spending it leaves none', spent.after === 0, String(spent.after));
  ok('with none left the option is still on screen', spent.second.shown === true, spent.second.label);
  ok('...but not usable', spent.second.disabled === true, `disabled=${spent.second.disabled}`);
  ok('...and says so', /none left/i.test(spent.second.label || ''), spent.second.label);
  await page.evaluate(() => { document.querySelectorAll('#loadoutSelect').forEach((n) => n.remove()); window.__game.store.reset(); });

  // ---- the title screen ------------------------------------------------------
  // The Campaign row used to be locked and say "coming soon". It is a real entry now: its own
  // New/Old, turn-based only, and its own resume slot so starting a campaign can't clobber a
  // half-finished Survival run (and vice versa).
  const title = await page.evaluate(async () => {
    document.querySelectorAll('#titleScreen, #speciesSelect, #loadoutSelect').forEach((n) => n.remove());
    window.__game.showTitle();
    for (let i = 0; i < 40 && !document.getElementById('titleScreen'); i++) await new Promise((r) => setTimeout(r, 150));
    const root = document.getElementById('titleScreen');
    if (!root) return { missing: true };
    const modes = [...root.querySelectorAll('.ts-mode')].map((n) => n.textContent.trim());
    const camp = root.querySelector('#tsNewCamp'), old = root.querySelector('#tsContCamp');
    const locked = root.querySelectorAll('.ts-locked').length;
    const soon = [...root.querySelectorAll('.ts-soon')].map((n) => n.textContent.trim());
    return { modes, hasNew: !!camp, hasOld: !!old, locked, soon,
             ids: ['tsNew', 'tsCont', 'tsNewRt', 'tsContRt', 'tsNewCamp', 'tsContCamp']
               .filter((id) => !!root.querySelector('#' + id)) };
  });
  ok('the title screen offers both games', !title.missing && title.modes.join('/') === 'Survival/Campaign',
     (title.modes || []).join(' / '));
  ok('Campaign has its own New and Old', title.hasNew === true && title.hasOld === true,
     (title.ids || []).join(', '));
  ok('nothing on the title screen is locked any more', title.locked === 0, String(title.locked));
  // "Chapter 1" (owner), in the slot that used to say "coming soon". It names the CONTENT rather
  // than the rules — the same word the in-game editor stamps on maps saved from it.
  ok('...and the row is named Chapter 1', (title.soon || []).join(' ').trim() === 'Chapter 1',
     (title.soon || []).join(' | ') || '(nothing there)');
  // Three slots, not two: Survival turn-based, Survival real-time, Campaign.
  const slots = await page.evaluate(() => {
    const g = window.__game, cfg = window.__cfg, was = { m: cfg.mode, g: cfg.game };
    const key = (m, gm) => { cfg.mode = m; cfg.game = gm; return g.resumeKey(); };
    const out = { survTurn: key('turn', 'survival'), survRt: key('realtime', 'survival'),
                  camp: key('turn', 'campaign') };
    cfg.mode = was.m; cfg.game = was.g;
    return out;
  });
  ok('the campaign keeps its own continue slot',
     new Set(Object.values(slots)).size === 3, JSON.stringify(slots));
  await page.evaluate(() => document.querySelectorAll('#titleScreen').forEach((n) => n.remove()));

  // ---- the campaign scores nothing ------------------------------------------
  // Not just "we don't call recordHighScore": a campaign death must leave the board untouched
  // AND must not raise the Top-10 prompt, which would offer to show a score that was never
  // filed. Survival on the same boards is the control — without it this passes on a board that
  // simply never works.
  const scoring = await page.evaluate(async () => {
    const g = window.__game, cfg = window.__cfg;
    const hs = g.scores;
    // The board is PER MODE, and this page booted real-time (`#dev`) — reading the turn-based
    // one showed 0 → 0 for Survival too and made the campaign assertion look meaningful when it
    // was measuring an empty table.
    const board = () => hs.allTimeBoard(cfg.mode === 'turn' ? 'turn' : 'realtime').length;
    localStorage.removeItem('mycelium.highscores.v1');
    const run = async (game) => {
      document.querySelectorAll('#loadoutSelect, #hsPrompt, .hs-prompt').forEach((n) => n.remove());
      cfg.game = game;
      g.campaign.play('marasmius', 3);
      cfg.game = game;                       // campaign.play forces 'campaign'; put it back for Survival
      await new Promise((r) => setTimeout(r, 300));
      const before = board();
      g.campaign.endRun();
      for (let i = 0; i < 60 && !document.getElementById('loadoutSelect'); i++) await new Promise((r) => setTimeout(r, 200));
      document.getElementById('loConfirm').click();          // "Next run" — the door that files a score
      await new Promise((r) => setTimeout(r, 900));
      const out = { before, after: board(),
                    prompt: !!document.querySelector('#hsPrompt, .hs-prompt, [id*="highscorePrompt" i]') };
      document.querySelectorAll('#speciesSelect, #loadoutSelect').forEach((n) => n.remove());
      return out;
    };
    const camp = await run('campaign');
    const surv = await run('survival');
    cfg.game = 'campaign';
    localStorage.removeItem('mycelium.highscores.v1');
    return { camp, surv };
  });
  ok('a campaign run files no high score',
     scoring.camp.after === scoring.camp.before, `board ${scoring.camp.before} → ${scoring.camp.after}`);
  ok('...and never offers the Top-10 prompt', scoring.camp.prompt === false);
  // The control: the same death in Survival DOES score, so the assertion above is about the
  // campaign and not about a board that never worked.
  ok('Survival still scores, so that is a real difference',
     scoring.surv.after > scoring.surv.before, `board ${scoring.surv.before} → ${scoring.surv.after}`);

  // The menu's own label for it — a campaign exit that banks a deck, not a rage-quit.
  const label = await page.evaluate(() => {
    const b = document.getElementById('set-forcefruit');
    return b ? b.textContent.trim() : null;
  });
  ok('the menu names it for what you get', /keep cards/i.test(label || ''), label || '(button missing)');

  await page.screenshot({ path: path.join(__dirname, '.artifacts', 'campaign.png'),
    animations: 'disabled', timeout: 8000 }).catch(() => {});

  ok('no page errors', errs.length === 0, errs.slice(0, 3).join(' | '));
  console.log(`\n==== ${pass} passed, ${fail} failed ====`);
  await browser.close(); srv.close();
  process.exit(fail ? 1 : 0);
})();
