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
    const el = document.querySelector('#levelIntro .li-count');
    const out = { shown: !!document.getElementById('levelIntro'),
                  text: el ? el.textContent.trim() : null,
                  aria: box ? box.getAttribute('aria-label') : null };
    window.__cfg.dev.enabled = was;
    document.querySelectorAll('#levelIntro').forEach((n) => n.remove());
    return out;
  });
  ok('the level intro appears with the dev flag off', intro.shown === true);
  ok('the intro counts the level out of the campaign length', intro.text === '4 of 10',
     intro.text || '(no counter)');
  ok('...and a screen reader hears the same', intro.aria === 'Level 4 of 10', intro.aria);

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
