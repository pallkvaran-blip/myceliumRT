/* THE CAMPAIGN: ten levels, each a specific procedurally generated map.
 *
 * What this guards, and why each one is here rather than obvious:
 *   - TEN LEVELS, AND IT ENDS. The old ladder ran to MAX_LEVEL (100) and was unwinnable past
 *     ~35 by design. Clearing the LAST level must finish the campaign and the one before it must
 *     not — the length is read from the model rather than written here, because it has moved once
 *     (ten to nine, when a map was archived) and an assertion pinned to 10 would then have been
 *     asserting the bug —
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
    window.__probe = async (level) => {
      const g = window.__game;
      g.campaign.play('marasmius', level);
      const st = g.state, sub = st.substrate;
      // WAIT FOR THE FINE MASK, and drive frames to build it. solidifyRock runs during RENDER and
      // only on the frame where every rock sprite has decoded, and loadLevelAssets is deliberately
      // not awaited — so straight after campaign.play() an authored level has NO rock stamped
      // anywhere. Measuring there is not merely imprecise: the flood fill then runs over an empty
      // mask, so "the goal is reachable on every level" — the assertion this file calls the one
      // that matters — passed without touching a single wall.
      for (let i = 0; i < 120 && !sub._rockSolidified; i++) {
        try { g.renderFrame(); } catch (_) {}
        await new Promise((r) => setTimeout(r, 50));
      }
      const C = sub.cols, R = sub.rows, cells = sub.cells;
      // ROCK IS `solidAtWorld`, NOT `cell.rock`. The campaign's ten levels are AUTHORED now:
      // their rock is a list of sprites and a fine alpha mask, and the coarse cell flag those
      // generated maps used is never set — so every one of them read ~0% rock and their mask
      // digests were identical, which surfaced as "5 distinct of 10" and a pathological-density
      // failure on nine levels. solidAtWorld answers for both kinds (it falls back to the coarse
      // flag when no fine mask exists), so this measures the rock the player actually collides
      // with whichever way the level was built.
      const solid = (i) => {
        const c = i % C, r = (i / C) | 0;
        return sub.solidAtWorld(c * sub.cellSize + sub.cellSize / 2,
                                sub.surfaceY + r * sub.cellSize + sub.cellSize / 2);
      };
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
      let rock = 0;
      for (let i = 0; i < C * R; i++) if (solid(i)) rock++;
      // An AUTHORED level's identity is its id — two campaign slots holding the same map is the
      // thing being guarded, and the id says so directly and without depending on the mask being
      // stamped yet. A generated level has no def and falls back to the mask digest.
      const ident = (st.levelDef && st.levelDef.id) || ('gen:' + h);
      return { level, cols: C, rows: R, digest: h, ident, authored: !!st.levelDef, rock,
               rockPct: Math.round((rock / (C * R)) * 100),
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
  ok('the campaign is nine levels', shape.levels === 9, String(shape.levels));
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

  // ---- every map -------------------------------------------------------------
  const maps = [];
  for (let n = 1; n <= shape.levels; n++) {
    maps.push(await page.evaluate((lv) => window.__probe(lv), n));
    await sleep(60);
  }
  ok('every level builds', maps.length === shape.levels && maps.every((m) => m && m.cols > 0 && m.rows > 0),
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
  // Ten identical maps would mean the seed isn't reaching the generator at all — or, now that
  // the ten are AUTHORED, that two campaign slots are serving the same file. Compared by
  // identity (the level id where there is one, the mask digest otherwise) so it answers the
  // same question for either kind.
  ok('the ten levels are ten different maps',
     new Set(maps.map((m) => m.ident)).size === maps.length,
     new Set(maps.map((m) => m.ident)).size + ' distinct of ' + maps.length +
     (maps.every((m) => m.authored) ? ' (authored)' : ''));

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
  // Clearing the second-to-last continues; clearing the last finishes the campaign. Both go
  // through the real win path. Derived from `shape.levels` so archiving a map moves them together —
  // hard-coded 9 and 10 would have started asserting "the ladder ends at 10" on a 9-level campaign,
  // which is the same off-by-one this block exists to catch.
  const clear = async (level) => page.evaluate(async (lv) => {
    document.querySelectorAll('#ssLevelComplete, #ssGameWon, #levelIntro').forEach((n) => n.remove());
    window.__game.campaign.play('marasmius', lv);
    await new Promise((r) => setTimeout(r, 200));
    window.__game.winLevel();
    // THE VICTORY SCREEN IS THE CAMPAIGN'S LAST SCREEN — it REPLACED `#ssGameWon` on this path
    // (its click goes to the title screen), so waiting for that card hangs here and the whole
    // block would report "clearing the last level does not finish the campaign". Left STANDING
    // rather than dismissed: the block below drives it, and dismissing it here would take the
    // page to the title screen behind the next assertion's back.
    let victory = false;
    // presentRunOver waits on the celebration; poll rather than guess a duration.
    for (let i = 0; i < 90; i++) {
      if (document.querySelector('#levelIntro.li-vict')) { victory = true; break; }
      if (document.getElementById('ssLevelComplete') || document.getElementById('ssGameWon')) break;
      await new Promise((r) => setTimeout(r, 200));
    }
    return { complete: !!document.getElementById('ssLevelComplete'),
             card: !!document.getElementById('ssGameWon'), victory };
  }, level);

  const penult = await clear(shape.levels - 1);
  ok(`clearing level ${shape.levels - 1} does not end the campaign`,
     penult.complete === true && penult.victory === false, JSON.stringify(penult));
  const last = await clear(shape.levels);
  // THE VICTORY SCREEN IS THE ENDING NOW, on the real win path — not the run-complete card, and
  // not only the debug hook the block further down drives. The penultimate level is the control:
  // without it this passes on a build that shows the victory screen on EVERY level clear.
  ok(`clearing level ${shape.levels} finishes the campaign, on the victory screen`,
     last.victory === true && last.complete === false && last.card === false,
     `final ${JSON.stringify(last)}, level ${shape.levels - 1} victory=${penult.victory}`);

  // ...AND ITS CLICK DOES BOTH THINGS (owner): back to the title screen, and a new tab to the
  // rating page. `window.open` is stubbed rather than allowed — a real popup would open a tab the
  // harness then has to chase, and what is being asserted is that the call happens AT ALL and with
  // the right URL. It must fire from inside the click handler: deferred to `onDone`, after the
  // 2.9 s fade, it is no longer a user gesture and every popup blocker eats it silently.
  const exit = await page.evaluate(async () => {
    const opened = [];
    const real = window.open;
    window.open = (u, t) => { opened.push({ url: u, target: t }); return null; };
    try {
      // Deaf until the fade lands, so click until it goes rather than once.
      for (let i = 0; i < 60 && document.querySelector('#levelIntro.li-vict'); i++) {
        document.querySelector('#levelIntro.li-vict').click();
        await new Promise((r) => setTimeout(r, 200));
      }
      for (let i = 0; i < 40 && !document.getElementById('titleScreen'); i++) {
        await new Promise((r) => setTimeout(r, 200));
      }
    } finally { window.open = real; }
    return { opened, title: !!document.getElementById('titleScreen'),
             card: !!document.getElementById('ssGameWon'),
             picker: !!document.getElementById('speciesSelect'),
             rateUrl: window.__game.ending().rateUrl };
  });
  ok('...and its click opens the rating page in a new tab',
     exit.opened.length === 1 && exit.opened[0].url === exit.rateUrl && exit.opened[0].target === '_blank',
     JSON.stringify(exit.opened));
  ok('...and lands on the title screen, not the picker or the run-complete card',
     exit.title === true && exit.card === false && exit.picker === false,
     JSON.stringify({ title: exit.title, card: exit.card, picker: exit.picker }));
  await page.evaluate(() => document.querySelectorAll('#ssLevelComplete, #ssGameWon, #levelIntro, #titleScreen').forEach((n) => n.remove()));

  // ---- the victory screen's CONTENT -----------------------------------------
  // THE ANIMATION IS NOT MEASURED HERE, and that split is the whole lesson of this block. This page
  // has played nine levels by now and is starved: one `await setTimeout(0)` was measured at
  // 9,275 ms, so a 2.6 s fade cannot be sampled at all. Two rounds of false failures came out of
  // trying — nine assertions naming nine different features, on a build that was correct. The fade,
  // the deaf window and the second-screen softlock live in `victory-check`, which boots a fresh
  // page and goes straight to the screen. What belongs HERE is that the screen is REACHED (asserted
  // on the real win path above) and that it says the right things, which is end state and survives
  // any amount of load.
  const vict = await page.evaluate(async () => {
    const g = window.__game;
    document.querySelectorAll('#levelIntro, #speciesSelect, #ssGameWon, #tutorial, #titleScreen').forEach((n) => n.remove());
    // A dismissed screen lives on for its own fade-out; wait it out rather than reading it.
    const root = () => document.querySelector('#levelIntro.li-vict');
    for (let i = 0; i < 60 && root(); i++) await new Promise((r) => setTimeout(r, 200));
    const out = { cleanStart: !root() };
    let done = false;
    g.victory(() => { done = true; });
    // POLL FOR THE WORDMARK CANVAS, which is the one thing created when the card OPENS. Polling
    // for the quote's attribution returned instantly and read the card before it had opened: every
    // staged element is in the DOM from creation and only its `li-stage-in` class arrives later.
    // However long the starved page takes it gets there, because `openCard` is armed off a plain
    // timer with a hard ceiling precisely so that is guaranteed.
    for (let i = 0; i < 200 && !document.querySelector('#levelIntro.li-vict .li-level canvas'); i++) {
      await new Promise((r) => setTimeout(r, 200));
    }
    out.word = !!document.querySelector('#levelIntro.li-vict .li-level canvas');
    out.red = (document.querySelector('.li-vict-line') || {}).textContent || null;
    out.say = (document.querySelector('.li-vict-say .li-story-p') || {}).textContent || null;
    const qt = document.querySelector('.li-vict-quote .li-quote-t');
    out.quoteText = qt ? qt.textContent : null;
    out.quoteWrap = qt ? getComputedStyle(qt).whiteSpace : null;
    out.quoteBy = (document.querySelector('.li-vict-quote .li-quote-by') || {}).textContent || null;
    out.ending = g.ending();
    for (let i = 0; i < 60 && root(); i++) { root().click(); await new Promise((r) => setTimeout(r, 200)); }
    for (let i = 0; i < 30 && !done; i++) await new Promise((r) => setTimeout(r, 200));
    out.done = done;
    document.querySelectorAll('#ssGameWon, #levelIntro, #titleScreen').forEach((n) => n.remove());
    return out;
  });
  ok('the probe starts on a clean page', vict.cleanStart === true);
  ok('VICTORY is grown as a mycelium wordmark', vict.word === true);
  ok('"You persisted" sits under it in red', vict.red === 'You persisted', JSON.stringify(vict.red));
  // The owner's sign-off, above the quotation — the game's own voice, in the opening's paragraph
  // style, so it is the same object at both ends of the campaign.
  ok('the sign-off is shown above the passage', vict.say === vict.ending.say, JSON.stringify(vict.say));
  // THE ENDING IS A QUOTED PASSAGE (owner), so what is asserted is that the shipped text reaches
  // the screen intact and is attributed. Compared against `__game.ending()` rather than restated
  // here — a check that hard-codes the passage is just a second copy to keep in step.
  ok('the ending passage is shown, whole',
     !!vict.quoteText && vict.quoteText.includes(vict.ending.quote.text),
     `${(vict.quoteText || '').length} chars on screen vs ${vict.ending.quote.text.length} shipped`);
  // IT IS VERSE. The line breaks are the poem's own and only `pre-line` keeps them; reflowed to
  // the container's width it reads as prose that has been justified badly, which is invisible in a
  // text comparison and obvious in a frame.
  ok('...as verse, with the poem\'s own line breaks',
     vict.quoteWrap === 'pre-line' && /\n/.test(vict.ending.quote.text),
     `white-space: ${vict.quoteWrap}, ${(vict.ending.quote.text.match(/\n/g) || []).length} break(s)`);
  // ATTRIBUTED. The passage is public domain (Tennyson, 1842) so there is no legal obligation
  // here, but an unattributed quotation on the campaign's last screen is the kind of thing that
  // gets noticed — and `docs/quotes.json` records that this game already carries 21 uncleared
  // quotes, so the ending is the last place to be careless.
  ok('...and attributed', !!vict.quoteBy && /Whitman/.test(vict.quoteBy), JSON.stringify(vict.quoteBy));
  ok('...and the red line answers the opening\'s ask ("must persist" -> "persisted")',
     /must persist/i.test(vict.ending.ask) && /persisted/i.test(vict.ending.red),
     `${vict.ending.ask} -> ${vict.ending.red}`);
  // It HANDS OVER — i.e. `onDone` fires on dismiss, which is what carries the real path into
  // `showGameWon`. Asserted as the callback and not as `#ssGameWon`, because the debug hook's
  // onDone is the probe's own function: through it there is no card to find, and asserting one
  // fails on a screen that is working perfectly. That the handover LANDS on the card is asserted
  // on the real win path above (`last.viaVictory && last.won`).
  ok('dismissing it hands over (onDone fires)', vict.done === true,
     JSON.stringify({ done: vict.done }));
  // The fade, the deaf window and the softlock: tests/victory-check.cjs, on a page that can
  // actually measure them.

  // ---- the final level's goal band ------------------------------------------
  // "Almost twice as big", with things floating over it (owner) — the map that ENDS the campaign,
  // so its goal is meant to look like an arrival rather than like every other level's exit.
  // Asserted against the campaign's LAST level rather than against level 9, and by counting the
  // surface columns the engine actually flagged `goal` rather than by reading the JSON: the point
  // is what the world came out as, and `summerCols` is clamped on the way in.
  const goalBand = await page.evaluate(async ({ last }) => {
    document.querySelectorAll('#levelIntro').forEach((n) => n.remove());
    const g = window.__game;
    const read = (lv) => {
      g.campaign.play('marasmius', lv);
      const sub = g.state.substrate;
      let n = 0;
      for (let c = 0; c < sub.cols; c++) if (sub.surface[c] && sub.surface[c].goal) n++;
      return { green: n, motes: g.state.config.render.goalMotes | 0,
               drawn: (sub.renderer && sub.renderer.goalMotes) ? sub.renderer.goalMotes.length : null };
    };
    const a = read(1), b = read(last);
    await new Promise((r) => setTimeout(r, 100));
    document.querySelectorAll('#levelIntro').forEach((n) => n.remove());
    return { first: a, last: b };
  }, { last: shape.levels });
  ok('the final level\'s green band is close to twice any other level\'s',
     goalBand.last.green >= goalBand.first.green * 1.6,
     `${goalBand.last.green} columns vs ${goalBand.first.green} on level 1`);
  ok('...and only it has things drifting over the goal',
     goalBand.last.motes > 0 && goalBand.first.motes === 0,
     `last ${goalBand.last.motes}, first ${goalBand.first.motes}`);

  // ---- the opening, on NEW ---------------------------------------------------
  // It fires when you press New and before the species picker (owner), not at run start in front
  // of the first level card. Driven through the REAL route — title -> New -> name -> Start —
  // because the whole defect class here is "the screen exists but nothing reaches it": the level
  // card was hidden from every build by a dev-flag skip that no assertion could see, and this
  // screen's previous placement was reachable only through a latch that stopped re-arming.
  const onNew = await page.evaluate(async () => {
    document.querySelectorAll('#levelIntro, #speciesSelect, #ssLevelComplete, #ssGameWon').forEach((n) => n.remove());
    window.__game.showTitle();
    for (let i = 0; i < 60 && !document.querySelector('#tsNewCamp'); i++) await new Promise((r) => setTimeout(r, 100));
    if (!document.querySelector('#tsNewCamp')) return { reachedTitle: false };
    document.querySelector('#tsNewCamp').click();
    for (let i = 0; i < 40 && !document.querySelector('#tsNameStart'); i++) await new Promise((r) => setTimeout(r, 100));
    if (!document.querySelector('#tsNameStart')) return { reachedTitle: true, reachedDialog: false };
    document.querySelector('#tsNameInput').value = 'probe';
    document.querySelector('#tsNameStart').click();
    // The title screen plays a consume animation before onNew fires, so poll rather than guess.
    for (let i = 0; i < 120 && !document.querySelector('#levelIntro.li-story'); i++) await new Promise((r) => setTimeout(r, 100));
    const st = document.querySelector('#levelIntro.li-story');
    const cs = (sel) => { const n = document.querySelector(sel); return n ? getComputedStyle(n) : null; };
    const pc = cs('.li-story-p'), ac = cs('.li-story-ask');
    const rgb = (c) => c ? (c.color.match(/\d+/g) || []).slice(0, 3).map(Number) : null;
    const out = { reachedTitle: true, reachedDialog: true, shown: !!st,
                  paras: [...document.querySelectorAll('.li-story-p')].map((n) => n.textContent.trim()),
                  ask: (document.querySelector('.li-story-ask') || {}).textContent || null,
                  btns: document.querySelectorAll('#levelIntro button').length,
                  hint: (document.querySelector('#levelIntro .li-hint') || {}).textContent || null,
                  paraRGB: rgb(pc), askRGB: rgb(ac),
                  preLine: pc ? pc.whiteSpace : null,
                  // The picker must NOT already be up behind it — the point of moving this screen
                  // is that it frames the choice rather than following it.
                  pickerBefore: !!document.getElementById('speciesSelect') };
    if (st) document.querySelector('#levelIntro').click();
    for (let i = 0; i < 90 && document.querySelector('.li-story'); i++) await new Promise((r) => setTimeout(r, 100));
    for (let i = 0; i < 60 && !document.getElementById('speciesSelect'); i++) await new Promise((r) => setTimeout(r, 100));
    out.pickerAfter = !!document.getElementById('speciesSelect');
    document.querySelectorAll('#levelIntro, #speciesSelect').forEach((n) => n.remove());
    return out;
  });
  ok('pressing New on the Campaign row shows the opening', onNew.shown === true,
     `title=${onNew.reachedTitle} dialog=${onNew.reachedDialog}`);
  ok('...before the species picker, not after it',
     onNew.pickerBefore === false && onNew.pickerAfter === true,
     `picker before=${onNew.pickerBefore} after=${onNew.pickerAfter}`);
  ok('...all three paragraphs of it', onNew.paras.length === 3, `${onNew.paras.length} paragraph(s)`);
  // Dashes, not a full stop (owner) — the same bracketing the title card's "-chapter one-" uses,
  // so the closing line reads as a caption rather than as a fourth sentence of the story.
  ok('...closing on "-You must persist-"', /^-You must persist-$/.test((onNew.ask || '').trim()),
     onNew.ask || '(none)');
  ok('...naming nine geologies, not ten', /Nine geologies/.test(onNew.paras.join(' ')),
     onNew.paras[2] ? onNew.paras[2].slice(0, 40) : '(none)');
  // The owner's own line break inside the first block, which only `pre-line` keeps.
  ok('...keeping the line break inside the first block',
     onNew.preLine === 'pre-line' && /\n/.test(onNew.paras[0] || ''), onNew.preLine);
  // NO BUTTON, and a tiny "click" instead (owner).
  ok('...with no button on it at all', onNew.btns === 0, String(onNew.btns));
  ok('...just a tiny "click"', onNew.hint === 'click', onNew.hint || '(none)');
  // ALL WHITE (owner). The closing line used to take the game's mint; measured as channels rather
  // than as a string, because that is what says "not coloured" for any colour.
  const white = (c) => c && Math.abs(c[0] - c[1]) < 10 && Math.abs(c[1] - c[2]) < 10 && c[0] > 230;
  ok('...and every line of it white, the closing one included',
     white(onNew.paraRGB) && white(onNew.askRGB),
     `body ${JSON.stringify(onNew.paraRGB)} close ${JSON.stringify(onNew.askRGB)}`);
  // It is NOT part of run start any more, so the level card stands alone.
  const notAtRunStart = await page.evaluate(async () => {
    document.querySelectorAll('#levelIntro').forEach((n) => n.remove());
    const was = window.__cfg.dev.enabled;
    window.__cfg.dev.enabled = false;
    window.__game.campaign.play('marasmius', 1);
    for (let i = 0; i < 60 && !document.getElementById('levelIntro'); i++) await new Promise((r) => setTimeout(r, 150));
    const out = { story: !!document.querySelector('#levelIntro.li-story'),
                  card: (document.querySelector('#levelIntro .li-of') || {}).textContent || null };
    window.__cfg.dev.enabled = was;
    document.querySelectorAll('#levelIntro').forEach((n) => n.remove());
    return out;
  });
  ok('starting a level goes straight to the level card, with no opening in front of it',
     notAtRunStart.story === false && notAtRunStart.card === '1/9',
     `story=${notAtRunStart.story} card=${notAtRunStart.card}`);

  // ---- the level intro counts toward the end --------------------------------
  // A finite campaign has to say it is finite; the wordmark can't carry the total.
  // The dev build SKIPS the intro (`state.config.dev.enabled`), and `state.config` is a deep clone
  // taken at run start — so turning the LIVE flag off before starting the level is what makes the
  // screen appear at all. Without this the assertion passes on a screen that was never built,
  // which is the zero-coverage pass CLAUDE.md warns about; the flag goes back on afterwards.
  // WITH THE DEV FLAG ON — which is how the build SHIPS, and how the owner plays it. `revealMap`
  // skips the level card under that flag so map playtesting is not interrupted 59 times, and the
  // exemption for campaign runs was missing: the card was hidden from every player of every build.
  // Reported as "I'm not seeing them on my phone", and invisible to every assertion below, because
  // they all turn the flag OFF first to make the screen appear at all. So this one asserts the
  // shipping configuration, and it has to come first — the block below leaves the flag restored.
  const introDevOn = await page.evaluate(async () => {
    document.querySelectorAll('#levelIntro, #ssLevelComplete, #ssGameWon').forEach((n) => n.remove());
    window.__cfg.dev.enabled = true;
    window.__game.campaign.play('marasmius', 4);
    for (let i = 0; i < 60 && !document.getElementById('levelIntro'); i++) await new Promise((r) => setTimeout(r, 150));
    const out = { shown: !!document.getElementById('levelIntro'),
                  rock: !!document.querySelector('#levelIntro .li-rock') };
    document.querySelectorAll('#levelIntro').forEach((n) => n.remove());
    return out;
  });
  ok('the campaign level card appears in the SHIPPING build, dev flag and all',
     introDevOn.shown === true && introDevOn.rock === true,
     `shown=${introDevOn.shown} rock=${introDevOn.rock}`);

  const intro = await page.evaluate(async () => {
    document.querySelectorAll('#levelIntro, #ssLevelComplete, #ssGameWon').forEach((n) => n.remove());
    const was = window.__cfg.dev.enabled;
    window.__cfg.dev.enabled = false;
    window.__game.campaign.play('marasmius', 4);
    for (let i = 0; i < 60 && !document.getElementById('levelIntro'); i++) await new Promise((r) => setTimeout(r, 150));
    const box = document.querySelector('#levelIntro .li-level');
    const el = document.querySelector('#levelIntro .li-of');
    const cs = el ? getComputedStyle(el) : null;
    const rockEl = document.querySelector('#levelIntro .li-rock');
    const rs = rockEl ? getComputedStyle(rockEl) : null;
    const hintEl = document.querySelector('#levelIntro .li-hint');
    // `.li-sub` is the survival ladder's escalation taunt and nothing else now — the campaign's
    // per-level story lines used to share the slot and have been dropped, so its ABSENCE here is
    // the assertion.
    const sub = document.querySelector('#levelIntro .li-sub');
    const out = { shown: !!document.getElementById('levelIntro'),
                  text: el ? el.textContent.trim() : null,
                  aria: box ? box.getAttribute('aria-label') : null,
                  // The campaign card carries NO threat portraits (owner). Counted rather than
                  // sampled: "the first one is gone" would pass on a row that still had two.
                  portraits: document.querySelectorAll('#levelIntro .li-threat').length,
                  // The counter sits at the FOOT now, so it must be outside `.li-head` — the block
                  // that holds the title, the rock and the story. Asserting the CLASS alone would
                  // pass on a foot-styled counter still sitting under the wordmark.
                  ofInHead: !!document.querySelector('#levelIntro .li-head .li-of'),
                  ofFooter: !!(el && el.classList.contains('li-of--foot')),
                  ofRGB: cs ? (cs.color.match(/\d+/g) || []).slice(0, 3).map(Number) : null,
                  ofSize: cs ? parseFloat(cs.fontSize) : null,
                  font: cs ? cs.fontFamily.split(',')[0] : null, color: cs ? cs.color : null,
                  // The rock name, in dark red caps under the title.
                  rock: rockEl ? rockEl.textContent.trim() : null,
                  rockFromModel: window.__game.rockName(),
                  rockRGB: rs ? (rs.color.match(/\d+/g) || []).slice(0, 3).map(Number) : null,
                  rockCaps: rs ? rs.textTransform : null,
                  rockSize: rs ? parseFloat(rs.fontSize) : null,
                  // "At the very bottom" is a POSITION, not a class. Measured as a fraction of the
                  // viewport, because the failure to catch is the counter quietly going back to
                  // riding under the last line of the centred column, which no class name shows.
                  ofBottomFrac: (() => { const n = document.querySelector('#levelIntro .li-of--foot');
                    return n ? n.getBoundingClientRect().bottom / window.innerHeight : null; })(),
                  hint: hintEl ? hintEl.textContent.trim() : null,
                  // Every part after the wordmark is staged, and starts hidden. Sampled right after
                  // the card is built, which is before the title can have finished growing — the
                  // one moment at which "did the reveal actually wait?" has an answer.
                  stagedCount: document.querySelectorAll('#levelIntro .li-stage').length,
                  stagedHidden: [...document.querySelectorAll('#levelIntro .li-stage')]
                    .filter((n) => +getComputedStyle(n).opacity < 0.1).length,
                  story: sub ? sub.textContent.trim() : null,
                  // The flavour quote under the story line. Read its SIZE and OPACITY as numbers:
                  // the failure to catch is the two reading as one paragraph, which "a quote is
                  // present" passes on.
                  quote: (document.querySelector('#levelIntro .li-quote-t') || {}).textContent || null,
                  quoteBy: (document.querySelector('#levelIntro .li-quote-by') || {}).textContent || null,
                  quoteSize: (() => { const q = document.querySelector('#levelIntro .li-quote-t');
                    return q ? parseFloat(getComputedStyle(q).fontSize) : null; })(),
                  quoteItalic: (() => { const q = document.querySelector('#levelIntro .li-quote-t');
                    return q ? getComputedStyle(q).fontStyle : null; })(),
                  pool: (window.__game.levelQuotes || []).map((q) => q.text) };
    window.__cfg.dev.enabled = was;
    document.querySelectorAll('#levelIntro').forEach((n) => n.remove());
    return out;
  });
  ok('the level intro appears with the dev flag off', intro.shown === true);
  ok('the intro counts the level out of the campaign length', intro.text === '4/9',
     intro.text || '(no counter)');
  // Screen readers keep the long form: "4/10" is a page number to look at, "Level 4 of 10" is the
  // sentence you would say out loud, and the wordmark's aria-label is the only place it is said.
  ok('...and a screen reader still hears it as a sentence', intro.aria === 'Level 4 of 9', intro.aria);
  // ---- the campaign card's own shape (owner) ---------------------------------
  ok('the campaign card drops the threat portraits', intro.portraits === 0, String(intro.portraits));
  ok('...and moves the counter out of the title block to the foot',
     intro.ofFooter === true && intro.ofInHead === false,
     `footClass=${intro.ofFooter} stillInHead=${intro.ofInHead}`);
  // WHITE, not the counter's old mint — and this is the assertion that caught the real bug. The
  // foot rule was written ABOVE `.li-of` in the stylesheet, same specificity, so source order won
  // and "4/10" came out mint. Third collision of this kind in this sheet, and the third that only
  // a rendered frame showed; measuring the channels is how it becomes a check instead.
  const orgb = intro.ofRGB || [0, 0, 0];
  ok('...in white, not the mint it used to be',
     Math.abs(orgb[0] - orgb[1]) < 12 && Math.abs(orgb[1] - orgb[2]) < 12 && orgb[0] > 180,
     intro.color);
  ok('...and smaller than the rock name above it', intro.ofSize > 0 && intro.ofSize < intro.rockSize,
     `${intro.ofSize}px vs rock ${intro.rockSize}px`);
  // Pinned to the viewport, not to the end of the stack.
  ok('...and sits at the very bottom of the screen', intro.ofBottomFrac > 0.9,
     `bottom edge at ${Math.round((intro.ofBottomFrac || 0) * 100)}% of the viewport`);
  // The rock the level is cut from. Asserted against the MODEL's answer rather than a literal, so
  // renaming a map or re-slotting the campaign does not fail this for the wrong reason.
  ok('the card names the rock under the title',
     !!intro.rock && intro.rock === String(intro.rockFromModel || '').toUpperCase(),
     `${intro.rock} vs model ${intro.rockFromModel}`);
  ok('...in caps, and in dark red', intro.rockCaps === 'uppercase'
     && (intro.rockRGB || [0])[0] - (intro.rockRGB || [0, 0])[1] > 60
     && (intro.rockRGB || [0, 0, 0])[0] < 200,
     `${intro.rockCaps} ${JSON.stringify(intro.rockRGB)}`);
  ok('the prompt is just "click"', intro.hint === 'click', intro.hint || '(none)');
  // The staged reveal. Sampled the instant the card is built — before the wordmark can have
  // finished — so this measures that the parts WAIT, which is the whole of the owner's ask. A
  // reveal that fired immediately would look identical in a settled screenshot.
  ok('everything after the wordmark is staged', intro.stagedCount === 4, String(intro.stagedCount));
  ok('...and none of it is showing while the title is still growing',
     intro.stagedHidden === intro.stagedCount, `${intro.stagedHidden} of ${intro.stagedCount} hidden`);
  // ---- no prose subtitle -----------------------------------------------------
  // The per-level story lines were dropped (owner). Asserted as the slot being EMPTY rather than as
  // the old text being absent: `.li-sub` still exists for the ladder's taunt, so "the sentence is
  // gone" has to mean "nothing is in that slot on a campaign card" or a stray taunt would pass it.
  ok('the campaign card carries no prose subtitle any more', intro.story === null,
     intro.story || '(none)');

  // ---- the flavour quote ----------------------------------------------------
  // A line drawn at random from the owner's accepted set, under the story line. Asserted against
  // the POOL rather than against a name, so weeding the list again doesn't fail this.
  const qText = (intro.quote || '').replace(/^“|”$/g, '');
  ok('the level card carries a flavour quote', !!intro.quote, intro.quote || '(none)');
  ok('...and it came from the accepted pool',
     (intro.pool || []).includes(qText), qText.slice(0, 50));
  ok('...attributed on its own line', /^—\s+\S/.test(intro.quoteBy || ''), intro.quoteBy || '(none)');
  // With the story lines gone the quote is the only prose on the card, so it is no longer sized
  // against something above it — but it must still read as a QUOTATION rather than as a heading,
  // which is what the italic and staying under the rock-name's tracking-and-caps weight do.
  ok('...set as a quotation, not as a heading',
     intro.quoteSize > 0 && intro.quoteItalic === 'italic' && intro.quoteSize < 24,
     `${intro.quoteSize}px ${intro.quoteItalic}`);

  // The bag, not a flat draw: nine quotes over ten levels repeat about two runs in three under a
  // flat draw, and a repeat one card later reads as a bug.
  // Asserted as EVENNESS over many draws, and the tolerance is 2 rather than 0 for a reason worth
  // writing down: the probe starts MID-BAG (the card just drawn took one), so the run is a partial
  // bag, then whole laps, then another partial — the head partial lifts its ids by one and the tail
  // partial lifts a different, random subset by one again. Spread 2 is what a bag guarantees from
  // an arbitrary offset; "ten laps, ten each" measured the offset and came back 9/10/11.
  // Discriminating all the same: over 450 draws a flat 1-in-9 has a standard deviation near 6.7, so
  // its spread lands around 20.
  // Fifty laps of whatever the pool currently holds — derived, because weeding the list again is
  // the expected way it changes and a pinned count would fail on a longer list rather than on a bug.
  const poolSize = (intro.pool || []).length;
  const bag = await page.evaluate((n) => {
    const g = window.__game;
    return Array.from({ length: n }, () => g.randomLevelQuote().id);
  }, poolSize * 50);
  const counts = {};
  for (const id of bag) counts[id] = (counts[id] || 0) + 1;
  const tally = Object.values(counts);
  ok(`the draw is a bag — over ${poolSize * 50} draws the ${poolSize} come up evenly, not at random`,
     poolSize > 0 && tally.length === poolSize && Math.max(...tally) - Math.min(...tally) <= 2,
     `${tally.length} distinct of ${poolSize}, spread ${Math.max(...tally) - Math.min(...tally)}, counts ${[...new Set(tally)].sort((a, b) => a - b).join('/')}`);
  // ...and off the campaign there is no quote at all, for the same reason there is no story: the
  // survival ladder's voice is the taunt, and Rilke under "How are you still alive?" is two jokes.
  const laddered = await page.evaluate(async () => {
    document.querySelectorAll('#levelIntro').forEach((n) => n.remove());
    window.__game.showLevelIntro({ level: 10, of: null, campaign: false,
                                   threats: [{ slug: 'nematode', label: 'Nematodes', count: 3 },
                                             { slug: 'trichoderma', label: 'Trichoderma', count: 2 }],
                                   note: "You're doing well. Time to die.", quote: null });
    await new Promise((r) => setTimeout(r, 200));
    const out = { sub: (document.querySelector('#levelIntro .li-sub') || {}).textContent || null,
                  quote: !!document.querySelector('#levelIntro .li-quote'),
                  portraits: document.querySelectorAll('#levelIntro .li-threat').length,
                  tally: (document.querySelector('#levelIntro .li-count') || {}).textContent || null,
                  hint: (document.querySelector('#levelIntro .li-hint') || {}).textContent || null,
                  rock: !!document.querySelector('#levelIntro .li-rock'),
                  staged: document.querySelectorAll('#levelIntro .li-stage').length };
    document.querySelectorAll('#levelIntro').forEach((n) => n.remove());
    return out;
  });
  ok('off the campaign the card keeps the taunt and takes no quote',
     laddered.quote === false && /Time to die/.test(laddered.sub || ''),
     `quote=${laddered.quote} sub=${laddered.sub}`);
  // THE NEGATIVE CONTROL FOR THE WHOLE CAMPAIGN-CARD BLOCK ABOVE. Without it, "the campaign card
  // has no portraits / says click / stages its parts" would every one of them pass on a build that
  // had done those things to BOTH screens — which is not what was asked for. The ladder's card is
  // the one that must be untouched.
  ok('...and the ladder card is untouched: portraits, tallies, the full prompt, no staging',
     laddered.portraits === 2 && /2|3/.test(laddered.tally || '') && laddered.rock === false
     && /Click anywhere/.test(laddered.hint || '') && laddered.staged === 0,
     `portraits=${laddered.portraits} tally=${laddered.tally} rock=${laddered.rock} hint=${laddered.hint} staged=${laddered.staged}`);

  // ---- the selection screen sends you to level 1 ----------------------------
  const start = await page.evaluate(async () => {
    let got = null;
    document.querySelectorAll('#speciesSelect').forEach((n) => n.remove());
    window.__game.showPicker();
    await new Promise((r) => setTimeout(r, 500));
    const root = document.getElementById('speciesSelect');
    const before = window.__game.campaign.level();
    root.querySelector('#ssAvail .ss-slot:last-child .ss-selbtn').click();
    await new Promise((r) => setTimeout(r, 400));
    got = window.__game.campaign.level();
    return { before, got };
  });
  ok('Start Run starts the run on level 1', start.got === 1, `level ${start.got}`);

  // ---- ending a run deliberately ------------------------------------------
  // "Players decide what cards to keep when they decide to end each run" — the exit is a normal
  // campaign move, so it must reach the keep screen, not a game-over.
  // TWO SCREENS NOW. Ending a run lands on showDeathScreen — what happened, and the two things
  // you can do — and the keep screen is behind its "End run: Choose which cards to keep" button.
  // The check follows the player's route rather than reaching past it, so it would catch either
  // screen going missing.
  const ended = await page.evaluate(async () => {
    document.querySelectorAll('#ssDeath, #loadoutSelect, #ssLevelComplete, #ssGameWon').forEach((n) => n.remove());
    window.__game.campaign.play('marasmius', 2);
    await new Promise((r) => setTimeout(r, 300));
    window.__game.campaign.endRun();
    for (let i = 0; i < 60 && !document.getElementById('ssDeath'); i++) await new Promise((r) => setTimeout(r, 200));
    const death = document.getElementById('ssDeath');
    const dTitle = death ? (death.querySelector('.ss-lc-title') || {}).textContent : null;
    const keepBtn = death ? death.querySelector('#ssDeathKeep') : null;
    if (keepBtn) keepBtn.click();
    for (let i = 0; i < 60 && !document.getElementById('loadoutSelect'); i++) await new Promise((r) => setTimeout(r, 200));
    const root = document.getElementById('loadoutSelect');
    const title = root ? (root.querySelector('.lo-h-title') || {}).textContent : null;
    const instr = root ? (root.querySelector('.lo-h-instr') || {}).textContent : null;
    // ONE button, "Done", and it lands on the species selection / store screen (owner). The
    // DESTINATION is the half worth asserting: the label is a string anyone can change, but a
    // Done that leaves the player on the title screen — where the Spores they just banked can't
    // be spent — is the actual regression, and it looks identical from the button.
    const acts = root ? [...root.querySelectorAll('.lo-actions button')].map((b) => b.textContent.trim()) : [];
    document.querySelectorAll('#speciesSelect').forEach((n) => n.remove());
    if (root) root.querySelector('#loConfirm').click();
    for (let i = 0; i < 60 && !document.getElementById('speciesSelect'); i++) await new Promise((r) => setTimeout(r, 200));
    const landed = !!document.getElementById('speciesSelect');
    const stillUp = !!document.getElementById('loadoutSelect');
    document.querySelectorAll('#speciesSelect, #loadoutSelect').forEach((n) => n.remove());
    if (death) death.remove();
    const keepNote = keepBtn && keepBtn.parentElement ? keepBtn.parentElement.querySelector('.ss-dth-note') : null;
    return { death: !!death, dTitle, keepLabel: keepBtn ? keepBtn.textContent.trim() : null,
             keepNote: keepNote ? keepNote.textContent.trim() : null,
             reached: !!root, title, instr, acts, landed, stillUp };
  });
  ok('ending a run reaches the death screen first', ended.death === true, ended.dTitle || '(never appeared)');
  // "End Run" now, with "Select cards" as its sub-line (owner) — the button is the verb and the
  // line under it is the consequence. Asserted on the pair, so the route it leads to is still
  // named somewhere on screen rather than the check settling for a two-word button.
  ok('...whose first button ends the run', /^end run$/i.test(ended.keepLabel || ''), ended.keepLabel);
  ok('...and its sub-line says where it leads', /select cards/i.test(ended.keepNote || ''), ended.keepNote);
  ok('ending a run reaches the keep screen', ended.reached === true, ended.title || '(never appeared)');
  // The word "deck" is in the screen's TITLE now — the death text moved out to showDeathScreen,
  // so the instruction under it no longer has to carry it.
  ok('...and it asks what to keep in your deck', /deck/i.test((ended.title || '') + ' ' + (ended.instr || '')),
     ((ended.title || '') + ' / ' + (ended.instr || '')).trim());
  ok('the keep screen has exactly ONE button', (ended.acts || []).length === 1,
     (ended.acts || []).join(' | ') || '(none)');
  ok('...and it says Done', (ended.acts || [])[0] === 'Done', (ended.acts || [])[0]);
  ok('...which takes you to the species selection / store screen', ended.landed === true,
     ended.landed ? 'speciesSelect' : 'never got there');
  ok('...and closes the sheet behind it', ended.stillUp === false);

  // ---- retries --------------------------------------------------------------
  // READ THE BASE OFF THE TRACK. Everyone starts with `lives.base` retries bought or not, and the
  // number has moved once already (1 -> 0 -> 1). Written out here, every assertion below would
  // have to be edited by hand the next time it moves, which is how a check ends up asserting last
  // release's design; derived, they only fail if the BEHAVIOUR stops matching the table.
  const LIVES_BASE = await page.evaluate(() =>
    (window.__game.store.upgrades.find((u) => u.id === 'lives') || {}).base || 0);

  // "When a player dies they should be given the option of trying the same level again if they
  // have retries left... if they are out of retries, that option should still be visible on the
  // death screen, just not usable." Every clause of that is an assertion below.
  const die = (level, lives, deck) => page.evaluate(async (a) => {
    const g = window.__game;
    document.querySelectorAll('#ssDeath, #loadoutSelect, #ssLevelComplete, #ssGameWon, #levelIntro').forEach((n) => n.remove());
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
      document.querySelectorAll('#ssDeath, #loadoutSelect, #ssLevelComplete, #ssGameWon, #levelIntro').forEach((n) => n.remove());
      g.store.reset();
      if (a.lives) { g.store.credit(1e6); for (let i = 0; i < a.lives; i++) g.store.buy('lives'); }
      g.campaign.play('marasmius', a.level);
      await new Promise((r) => setTimeout(r, 350));
      const snap = { lives: g.campaign.lives(), entry: g.campaign.entry(), spores: g.store.balance(),
                     level: g.campaign.level() };
      g.campaign.endRun();
      // The retry is showDeathScreen's second button now, not the carousel's third — it is taken
      // BEFORE any deck is curated, which is the point: a retry throws that choice away.
      for (let i = 0; i < 60 && !document.getElementById('ssDeath'); i++) await new Promise((r) => setTimeout(r, 200));
      const btn = document.getElementById('ssDeathRetry');
      // THE COUNT IS THE SUB-LINE NOW, not the button face (owner: the buttons say just "End Run"
      // and "Retry", with small subtitles underneath). So "how many are left" is read off
      // `.ss-dth-note`, and the button is only asked whether it is usable.
      const note = btn && btn.parentElement ? btn.parentElement.querySelector('.ss-dth-note') : null;
      return { ...snap, shown: !!btn, label: btn ? btn.textContent.trim() : null,
               note: note ? note.textContent.trim() : null,
               disabled: btn ? btn.disabled : null, sporesAfterDeath: g.store.balance() };
    }, { level, lives });
    return before;
  };

  // Buying 2 on top of the base 1 → three retries in the run.
  const withLives = await dieAndShow(3, 2);
  // THE FREE RETRY IS BACK (owner: "let the players start with 1 retry"), so a run stocks the
  // track's base PLUS whatever the store sold. Derived from the track rather than written as 3:
  // the base is the thing under test and hard-coding it here would assert the same number twice.
  ok('the run stocks the base retry plus what the store sold',
     withLives.lives === LIVES_BASE + 2, `${withLives.lives} (base ${LIVES_BASE} + 2 bought)`);
  ok('the level records the state it was entered in', !!withLives.entry && withLives.entry.level === 3,
     withLives.entry ? `level ${withLives.entry.level}, ${withLives.entry.hand.length} in hand` : 'no snapshot');
  ok('the death screen offers a retry', withLives.shown === true && withLives.disabled === false, withLives.label);
  ok('...and says how many are left',
     new RegExp('^' + (LIVES_BASE + 2) + ' remaining', 'i').test((withLives.note || '').trim()), withLives.note);

  const retried = await page.evaluate(async () => {
    const g = window.__game;
    const before = { lives: g.campaign.lives(), spores: g.store.balance(), level: g.campaign.level(),
                     entry: g.campaign.entry() };
    document.getElementById('ssDeathRetry').click();
    for (let i = 0; i < 60; i++) {
      if (!document.getElementById('ssDeath') && g.state && g.state.active && !g.state.runOver) break;
      await new Promise((r) => setTimeout(r, 200));
    }
    const st = g.state;
    return { before, lives: g.campaign.lives(), level: g.campaign.level(), spores: g.store.balance(),
             over: !!st.runOver, alive: !!st.active.alive, screen: !!document.getElementById('ssDeath'),
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
  // A death is WORTH half the level's Spores but is not PAID for one: the player only gets it by
  // ending the run, so the wallet must not move at the death screen and must not move on a retry
  // either. This used to be a claw-back — banked on death, handed back by retryLevel — and the
  // assertion below was that the two cancelled out. Now nothing is taken, so nothing has to be
  // given back, and the stronger statement is that the balance never changed at all.
  ok('a death alone pays nothing — the wallet is untouched until the run ends',
     withLives.sporesAfterDeath === withLives.spores,
     `${withLives.spores} → at the death screen ${withLives.sporesAfterDeath}`);
  ok('...and a retry still pays nothing',
     retried.spores === withLives.spores,
     `${withLives.spores} → death ${withLives.sporesAfterDeath} → retry ${retried.spores}`);

  // The map has to come back identical, or "the same level" is only half true. Fixed seeds are
  // what make that so, and this is where it pays off for a player.
  //
  // Both digests are taken once the mask has SETTLED, and that is the whole difficulty: the rock
  // mask fills in over the first frames, so a digest read synchronously (as `__probe` does) and one
  // read after a pause disagree on the same map. Comparing across that gap is a false failure —
  // which is exactly what this assertion did first time round.
  //
  // IT USED TO WAIT A FLAT 400ms, AND THAT IS A BET ABOUT THE MACHINE. Under sweep load the fresh
  // build had not finished settling inside the window, so the read landed mid-fill and the check
  // reported `retried 826625157 vs fresh 2921590830` — i.e. "the campaign's fixed seeds don't
  // work", which is the most alarming thing it could say and was not true. 106/106 standalone on
  // the same build, three runs. Third failure in this family after `core` and `scale`.
  //
  // THREE agreeing samples, not two: a mask still filling in can hold the same value across one
  // pair and then move again, and `core-check`'s hue probe was fixed for exactly that reason.
  const sameMap = await page.evaluate(async () => {
    const g = window.__game;
    const dig = () => { let h = 2166136261 >>> 0;
      for (const c of g.state.substrate.cells) { h ^= c.rock ? 1 : 0; h = Math.imul(h, 16777619) >>> 0; }
      return h; };
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    // Bounded, so a mask that genuinely never settles still trips the assertion rather than hanging.
    const settled = async () => {
      let last = null, runLen = 0;
      for (let i = 0; i < 60; i++) {
        const h = dig();
        runLen = (h === last) ? runLen + 1 : 0;
        last = h;
        if (runLen >= 2) return h;                // this read plus two before it agreed
        await sleep(60);
      }
      return last;
    };
    const retried = await settled();
    const level = g.campaign.level();
    g.campaign.play('marasmius', level);          // a FRESH build of the same level
    const fresh = await settled();
    return { retried, fresh, level, seed: g.state.seed };
  });
  ok('the retried level is the same map as a fresh build of it',
     sameMap.retried === sameMap.fresh,
     `level ${sameMap.level} (seed ${sameMap.seed}): retried ${sameMap.retried} vs fresh ${sameMap.fresh}`);

  // THE FREE RETRY, AND RUNNING OUT OF RETRIES. A fresh save has the track's base (1) and can
  // repeat a level once having bought nothing — which is the point of it: the campaign is built
  // to stop a new player on level 3 or 4, and one with no retry and no spores has nothing left to
  // do but leave. Both halves are exercised, because neither is enough on its own: a fresh save
  // gets exactly the base and a usable button, and SPENDING it reaches zero, where the button is
  // still on screen, disabled, and pointing at the store.
  const spent = await page.evaluate(async () => {
    const g = window.__game;
    document.querySelectorAll('#ssDeath, #loadoutSelect, #levelIntro').forEach((n) => n.remove());
    g.store.reset();                       // no purchases at all
    g.campaign.play('marasmius', 2);
    await new Promise((r) => setTimeout(r, 350));
    const stockedFresh = g.campaign.lives();
    const toDeath = async () => {
      g.campaign.endRun();
      for (let i = 0; i < 60 && !document.getElementById('ssDeath'); i++) await new Promise((r) => setTimeout(r, 200));
      const b = document.getElementById('ssDeathRetry');
      const n = b && b.parentElement ? b.parentElement.querySelector('.ss-dth-note') : null;
      return { label: b ? b.textContent.trim() : null, note: n ? n.textContent.trim() : null,
               disabled: b ? b.disabled : null, shown: !!b };
    };
    const fresh = await toDeath();                          // nothing bought: the base one
    document.querySelectorAll('#ssDeath, #loadoutSelect').forEach((n) => n.remove());
    g.state.runOver = false;
    // ...now spend the free one, which is the only way to reach zero having bought nothing.
    g.campaign.play('marasmius', 2);
    await new Promise((r) => setTimeout(r, 350));
    const stocked = g.campaign.lives();
    const first = await toDeath();
    document.getElementById('ssDeathRetry').click();        // spend the only one
    for (let i = 0; i < 60; i++) { if (!document.getElementById('ssDeath') && !g.state.runOver) break;
      await new Promise((r) => setTimeout(r, 200)); }
    await new Promise((r) => setTimeout(r, 300));
    const after = g.campaign.lives();
    const second = await toDeath();
    document.querySelectorAll('#ssDeath, #loadoutSelect').forEach((n) => n.remove());
    return { stockedFresh, fresh, stocked, first, after, second };
  });
  ok('a run with no purchases still gets the free retry',
     spent.stockedFresh === LIVES_BASE && LIVES_BASE === 1, String(spent.stockedFresh));
  // ...and it is USABLE on the first death, which is the whole point of giving it away. The
  // opposite assertion (present but disabled) is below, on the second death.
  ok('...and it is offered, enabled, on the first death',
     spent.fresh.shown === true && spent.fresh.disabled === false && /1 remaining/i.test(spent.fresh.note || ''),
     `"${spent.fresh.label}" / "${spent.fresh.note}"`);
  ok('...and a re-entered level still carries exactly one',
     spent.stocked === 1 && /1 remaining/i.test(spent.first.note || ''),
     `${spent.stocked} — "${spent.first.label}" / "${spent.first.note}"`);
  ok('spending it leaves none', spent.after === 0, String(spent.after));
  ok('with none left the option is still on screen', spent.second.shown === true, spent.second.label);
  ok('...but not usable', spent.second.disabled === true, `disabled=${spent.second.disabled}`);
  // ...AND POINTS AT THE STORE (owner). "None left" states the problem and stops, which is no use
  // to a player who has just spent their free retry and does not know more are purchasable.
  ok('...and says where to get more', /buy retries at the store/i.test(spent.second.note || ''),
     spent.second.note);
  // The control: that copy must NOT be what a player sees while they still have one, or the
  // sub-line stops being a signal and becomes decoration.
  ok('...and does not say it while a retry is in hand',
     !/buy retries at the store/i.test(spent.fresh.note || ''), spent.fresh.note);
  // AND IT IS READABLE WHILE SAYING IT. The disabled retry was `opacity:.42` over a dark map,
  // which took the text down with the control — the owner could not read it. Asserted as
  // CONTRAST against the screen behind it, because "it is styled differently" was already true
  // and was the bug. A faded-out control passes an existence check and fails a person.
  const lum = (c) => { const m = String(c).match(/[\d.]+/g) || [0,0,0];
    return (0.2126*+m[0] + 0.7152*+m[1] + 0.0722*+m[2]) / 255; };
  // Its own screen, via the dev hook: the probe above removed the real one, and this asks about
  // STYLE rather than about that run.
  const off = await page.evaluate(async () => {
    document.querySelectorAll('#ssDeath').forEach((n) => n.remove());
    window.__game.store.deathScreen({ retryOff: true, retryNote: 'none left' });
    await new Promise((r) => setTimeout(r, 120));
    const b = document.getElementById('ssDeathRetry');
    if (!b) return null;
    const cs = getComputedStyle(b);
    const out = { color: cs.color, opacity: +cs.opacity,
                  note: getComputedStyle(b.parentElement.querySelector('.ss-dth-note')).color,
                  bg: cs.backgroundColor, border: cs.borderStyle };
    document.querySelectorAll('#ssDeath').forEach((n) => n.remove());
    return out;
  });
  ok('the unusable retry is not faded out — it can still be read', !!off && off.opacity >= 0.95,
     off ? `opacity ${off.opacity}, colour ${off.color}` : '(no button)');
  ok('...its text clears a readable brightness over the dark map', !!off && lum(off.color) > 0.45,
     off ? `${off.color} → luminance ${lum(off.color).toFixed(2)} (want > 0.45)` : '(no button)');
  ok('...and so does its sub-line', !!off && lum(off.note) > 0.45,
     off ? `${off.note} → luminance ${lum(off.note).toFixed(2)}` : '(no button)');
  ok('...with the border saying it is unusable instead', !!off && off.border === 'dashed', off && off.border);
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
             rt: !!(root.querySelector('#tsNewRt') || root.querySelector('#tsContRt')),
             ids: ['tsNew', 'tsCont', 'tsNewRt', 'tsContRt', 'tsNewCamp', 'tsContCamp']
               .filter((id) => !!root.querySelector('#' + id)) };
  });
  // TWO GAMES AGAIN (owner: "let's add survival back... while the campaign sits on the top
  // half"), so both rows carry a label. mode-check owns the LAYOUT — which row, which side, how
  // far from the wordmark; what matters HERE is that the campaign is a real entry with a pair of
  // its own, which is this file's whole subject, and that it is the one on top.
  ok('the title screen names both games', !title.missing && title.modes.join(',') === 'Campaign,Survival',
     (title.modes || []).join(' / ') || '(none)');
  ok('Campaign has its own New and Old', title.hasNew === true && title.hasOld === true,
     (title.ids || []).join(', '));
  ok('...and survival has its own beside them', (title.ids || []).join(',') === 'tsNew,tsCont,tsNewCamp,tsContCamp',
     (title.ids || []).join(', '));
  ok('nothing on the title screen is locked any more', title.locked === 0, String(title.locked));
  // REAL TIME IS OFF THE TITLE SCREEN for this release (owner: "not this next release"), and it
  // is a SEPARATE constant from survival's — asserted here because the two coming back together
  // would mean they had been confused. The variant itself is untouched: `#dev` still boots it and
  // mode-check still drives it.
  ok('real time is not offered from the title screen', title.rt === false,
     (title.ids || []).join(', '));
  // "Chapter 1" is back with the CAMPAIGN label, under it. It names the CONTENT rather than the
  // rules — the same word the in-game editor stamps on maps saved from it. It was dropped while
  // the campaign was the only game, when with nothing else on the screen it read as a line of its
  // own rather than as a subtitle; with a label above it, it is a subtitle again.
  ok('...and "Chapter 1" sits under CAMPAIGN', (title.soon || []).join(',') === 'Chapter 1',
     (title.soon || []).join(' | ') || '(nothing there)');
  // THREE RESUME SLOTS, one per (mode, game) pair. Two are reachable from the title now and the
  // real-time one is not, but keeping all three distinct is what stops a campaign start
  // clobbering a half-finished survival run — so they are asserted whatever the title offers.
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
      document.querySelectorAll('#ssDeath, #loadoutSelect, #hsPrompt, .hs-prompt').forEach((n) => n.remove());
      cfg.game = game;
      g.campaign.play('marasmius', 3);
      cfg.game = game;                       // campaign.play forces 'campaign'; put it back for Survival
      await new Promise((r) => setTimeout(r, 300));
      const before = board();
      g.campaign.endRun();
      // Through BOTH screens: the death screen, then its "End run" button, then the keep
      // sheet's one button, "Done" — which is still the door that files a score. Scoring did
      // not move; the route to it gained a step and the button lost its siblings.
      for (let i = 0; i < 60 && !document.getElementById('ssDeath'); i++) await new Promise((r) => setTimeout(r, 200));
      const keep = document.getElementById('ssDeathKeep');
      if (keep) keep.click();
      for (let i = 0; i < 60 && !document.getElementById('loadoutSelect'); i++) await new Promise((r) => setTimeout(r, 200));
      document.getElementById('loConfirm').click();          // "Done" — the door that files a score
      await new Promise((r) => setTimeout(r, 900));
      const out = { before, after: board(),
                    prompt: !!document.querySelector('#hsPrompt, .hs-prompt, [id*="highscorePrompt" i]') };
      document.querySelectorAll('#speciesSelect, #ssDeath, #loadoutSelect').forEach((n) => n.remove());
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

  // The menu's own label. It read "End run & keep cards" and is just "End run" now (owner) —
  // the keep step is the death screen's first button, so naming it here as well described a
  // route rather than the action. What still has to hold is that the ROUTE is unchanged: this
  // is the deliberate exit, and it lands on the same screen a death does.
  const label = await page.evaluate(() => {
    const b = document.getElementById('set-forcefruit');
    return b ? b.textContent.trim() : null;
  });
  ok('the menu offers the deliberate exit', label === 'End run', label || '(button missing)');

  await page.screenshot({ path: path.join(__dirname, '.artifacts', 'campaign.png'),
    animations: 'disabled', timeout: 8000 }).catch(() => {});

  ok('no page errors', errs.length === 0, errs.slice(0, 3).join(' | '));
  console.log(`\n==== ${pass} passed, ${fail} failed ====`);
  await browser.close(); srv.close();
  process.exit(fail ? 1 : 0);
})();
