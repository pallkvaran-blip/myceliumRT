/* THE DASHBOARD (docs/analytics.html), driven against a FAKE Supabase.
 *
 * It is generated, so its standing failure is staleness — a page that looks right and describes
 * last month's schema. And its numbers are the ones a launch decision gets made on, so the ways
 * it can lie matter more than the ways it can crash:
 *
 *  · POSTGREST CAPS A GET AT 1000 ROWS AND SAYS NOTHING. A page that does not page silently
 *    analyses the first thousand events and reports them as the whole story — the most dangerous
 *    bug this file can have, because every number stays plausible. Fed 2400 rows here.
 *  · A BAR SCALED TO THE BIGGEST VALUE IS NOT A RATE. The first render printed "88.9%" beside 8
 *    retries on level 1, against nothing in particular. Percentages are only allowed where there
 *    is a real denominator.
 *  · SHARES MUST SUM. Device share was over players, and a browser resized across a bucket
 *    boundary appears under two device classes, so it summed past 100%.
 *  · THE ANON KEY, AND ONLY THE ANON KEY. The generator refuses a JWT whose role is anything
 *    else; the two keys look identical at a glance and one of them is a real secret.
 *
 * The backend is intercepted, so nothing here can reach the live project.
 */
const http = require('http'), fs = require('fs'), path = require('path');
const { execFileSync } = require('child_process');
const { chromium } = require('playwright');
const ROOT = path.resolve(__dirname, '..');
const PAGE = path.join(ROOT, 'docs', 'analytics.html');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let pass = 0, fail = 0;
const ok = (n, c, x) => { c ? (pass++, console.log('  PASS  ' + n + (x ? '  — ' + x : ''))) : (fail++, console.log('  FAIL  ' + n + (x ? '  — ' + x : ''))); };
const node = (args) => execFileSync(process.execPath, args, { cwd: ROOT, encoding: 'utf8',
  env: { ...process.env, NODE_PATH: process.env.NODE_PATH || '/opt/node22/lib/node_modules' } });

// A fortnight of plausible events. Deliberately OVER 1000 so the paging is exercised, and with a
// known shape so the assertions below are arithmetic rather than eyeballing.
function fixture() {
  const rows = [];
  const day = 86400000, now = Date.now();
  let seed = 7;
  const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  let id = 0;
  // THE DEFAULT SOURCE IS `crazygames` NOW (owner), so the main cohort is tagged that way — a
  // fixture whose every row is `itch` would leave the page falling back to "all" on load and every
  // count below would silently be measuring the fallback rather than the default.
  const push = (t, o) => rows.push(Object.assign({ id: ++id, created_at: new Date(t).toISOString(),
    source: 'crazygames', game: 'campaign', mode: 'turn' }, o));
  let boots = 0, starts = 0, clears1 = 0;
  for (let d = 13; d >= 0; d--) {
    for (let p = 0; p < 14; p++) {
      const cid = 'c' + ((d + p) % 40);          // repeats across days → cohorts have returns
      const sid = 's' + d + '-' + p;
      const dev = p % 2 ? 'phone' : (p % 3 ? 'desktop' : 'tablet');
      const t = now - d * day - Math.round(rnd() * day * 0.5);
      const base = { client_id: cid, session_id: sid, device: dev };
      push(t, Object.assign({ kind: 'boot', ms: 3000 }, base)); boots++;
      push(t + 3000, Object.assign({ kind: 'picker' }, base));
      push(t + 6000, Object.assign({ kind: 'run_start', species: 'pleurotus', level: 1, cause: 'new' }, base)); starts++;
      push(t + 9000, Object.assign({ kind: 'level_start', species: 'pleurotus', level: 1 }, base));
      if (p % 3) { push(t + 12000, Object.assign({ kind: 'level_clear', species: 'pleurotus', level: 1, turns: 30, ms: 200000 }, base)); clears1++; }
      else push(t + 12000, Object.assign({ kind: 'retry', level: 1, n: 0 }, base));
      push(t + 15000, Object.assign({ kind: 'run_end', species: 'pleurotus', level: 1, cause: p % 4 ? 'devoured' : 'won', turns: 40, n: 100 }, base));
      push(t + 16000, Object.assign({ kind: 'perf', ms: dev === 'phone' ? 250 : 90, n: 200, cause: dev === 'phone' ? 'bad' : 'ok' }, base));
      push(t + 17000, Object.assign({ kind: 'session_end', ms: 600000, n: 1 }, base));
      push(t + 18000, Object.assign({ kind: 'rate', detail: 'shown' }, base));
      push(t + 19000, Object.assign({ kind: 'tutorial', detail: 'start', n: 0, level: 1 }, base));
      // The two tables whose bars are a SCALE rather than a rate. Without rows here the
      // "prints no percentage" assertion checked nothing and said so as a pass.
      push(t + 20000, Object.assign({ kind: 'draft', level: 1, n: 3, detail: p % 2 ? 'Acorn Cache' : 'Amputate' }, base));
      // ENGINES: TAKEN vs BUILT. `Dew Traps` is drafted by everyone and installed by a third —
      // the shape the panel exists to show, a card people want and cannot afford. `n` on an
      // install is 0 for an engine and 1 for an action, which is how one event kind carries both.
      push(t + 20500, Object.assign({ kind: 'draft', level: 1, n: 3, detail: 'Dew Traps' }, base));
      if (p % 3 === 0) push(t + 20600, Object.assign({ kind: 'install', level: 1, n: 0, detail: 'Dew Traps' }, base));
      // A REAL ACTION CARD. The first version used `Amputate`, which reads like one and is typed
      // `basic` (its `displayCategory` is `event`) — so it landed in neither panel and the
      // assertion failed on a page that was filing it correctly. Check `type` before picking one.
      if (p % 4 === 0) push(t + 20700, Object.assign({ kind: 'install', level: 1, n: 1, detail: 'Constricting Ring' }, base));
      if (p % 5 === 0) push(t + 21000, Object.assign({ kind: 'upgrade', detail: 'water', level: 1, n: 25 }, base));
    }
  }
  // PRE-v2 SESSIONS, i.e. the build that shipped before `game`/`mode`/`device` existed. itch
  // serves whatever zip was last uploaded and browsers cache it, so the two builds genuinely
  // coexist in one table for days after a launch — which is the case the Build filter is for,
  // and the case that made the device table's share column stop summing to 100.
  // Snapshotted BEFORE the pre-v2 loop: the campaign table filters on `game === "campaign"`, which
  // a pre-v2 row cannot satisfy, so its counts are legitimately the new-build ones alone while the
  // run KPIs above it count every build.
  const campStarts = starts, campClears1 = clears1;
  // Counted, not derived: the pre-v2 and untagged loops REUSE client ids, so "everyone minus the
  // survival three" is only accidentally right and would go wrong the moment a loop changed.
  const campPlayers = new Set(rows.filter((r) => r.kind === 'level_start' && r.game === 'campaign'
    && r.level === 1).map((r) => r.client_id)).size;
  let oldSessions = 0;
  for (let d = 3; d >= 1; d--) {
    for (let p = 0; p < 4; p++) {
      const cid = 'c' + (p % 5);                 // reuses existing devices: the player count holds
      const sid = 'old' + d + '-' + p;
      const t = now - d * day - Math.round(rnd() * day * 0.5);
      const base = { client_id: cid, session_id: sid, device: null, game: null, mode: null };
      // NO `boot`, faithfully: the pre-v2 build did not send one, which is what left the live
      // itch view with 44 sessions behind a single boot and a funnel reading 6900%.
      push(t + 6000, Object.assign({ kind: 'run_start', species: 'pleurotus', level: 1, cause: 'new' }, base)); starts++;
      push(t + 9000, Object.assign({ kind: 'level_start', species: 'pleurotus', level: 1 }, base));
      push(t + 12000, Object.assign({ kind: 'level_clear', species: 'pleurotus', level: 1, turns: 30, ms: 200000 }, base)); clears1++;
      push(t + 15000, Object.assign({ kind: 'run_end', species: 'pleurotus', level: 1, cause: 'devoured', turns: 40, n: 100 }, base));
      push(t + 17000, Object.assign({ kind: 'session_end', ms: 600000, n: 1 }, base));
      oldSessions++;
    }
  }

  // A SURVIVAL COHORT, deliberately SMALLER than the campaign one and reaching a different depth.
  // "How far people get" was hard-coded to campaign rows while claiming to cover everything, so
  // picking Game=survival left it filtering survival sessions for a campaign tag and the table
  // read a single level-1 attempt against 120 real ones. A fixture with no survival rows at all
  // cannot see that — every assertion about the table passed on a page that could only ever draw
  // one game.
  let survStarts = 0, survClears1 = 0, survL2 = 0, survRuns = 0;
  const survPlayers = new Set();
  for (let d = 9; d >= 1; d--) {
    for (let p = 0; p < 3; p++) {
      const cid = 'sv' + p;                      // three players, several sessions each
      const sid = 'sv' + d + '-' + p;
      const t = now - d * day - Math.round(rnd() * day * 0.5);
      const base = { client_id: cid, session_id: sid, device: 'desktop', game: 'survival', mode: 'turn' };
      survPlayers.add(cid);
      push(t, Object.assign({ kind: 'boot', ms: 3000 }, base)); boots++;
      push(t + 6000, Object.assign({ kind: 'run_start', species: 'marasmius', level: 1, cause: 'new' }, base));
      starts++; survRuns++;
      push(t + 9000, Object.assign({ kind: 'level_start', species: 'marasmius', level: 1 }, base)); survStarts++;
      if (p === 0) {
        push(t + 12000, Object.assign({ kind: 'level_clear', species: 'marasmius', level: 1, turns: 30, ms: 200000 }, base)); survClears1++;
        push(t + 13000, Object.assign({ kind: 'level_start', species: 'marasmius', level: 2 }, base)); survL2++;
      }
      push(t + 15000, Object.assign({ kind: 'run_end', species: 'marasmius', level: 1, cause: 'energy', turns: 40, n: 100 }, base));
      push(t + 17000, Object.assign({ kind: 'session_end', ms: 300000, n: 1 }, base));
    }
  }

  // A SMALL `itch` COHORT, so the Source chip has a second side and "a source filter narrows"
  // is a real assertion rather than one that passes because everything is one source.
  let itchSessions = 0;
  for (let d = 5; d >= 1; d--) {
    for (let p = 0; p < 2; p++) {
      const t = now - d * day - Math.round(rnd() * day * 0.5);
      const base = { client_id: 'it' + p, session_id: 'it' + d + '-' + p, device: 'desktop',
        source: 'itch', game: 'campaign', mode: 'turn' };
      push(t, Object.assign({ kind: 'boot', ms: 3000 }, base)); boots++;
      push(t + 6000, Object.assign({ kind: 'run_start', species: 'pleurotus', level: 1, cause: 'new' }, base));
      starts++; itchSessions++;
      push(t + 15000, Object.assign({ kind: 'run_end', species: 'pleurotus', level: 1, cause: 'devoured', turns: 40, n: 100 }, base));
      push(t + 17000, Object.assign({ kind: 'session_end', ms: 400000, n: 1 }, base));
    }
  }

  // THE OLDEST ERA: no `source` EITHER. The two column sets landed at different times on the real
  // table — source tagging first, the game/mode/device columns days later — so there are three
  // eras, not two, and the untagged one is the launch week. It reuses existing client_ids so the
  // player count under the default itch filter is unmoved by rows that filter cannot see.
  let untagged = 0;
  for (let d = 20; d >= 18; d--) {
    for (let p = 0; p < 5; p++) {
      const t = now - d * day - Math.round(rnd() * day * 0.5);
      const base = { client_id: 'c' + (p % 5), session_id: 'raw' + d + '-' + p,
        source: null, device: null, game: null, mode: null };
      push(t, Object.assign({ kind: 'boot', ms: 3000 }, base));
      push(t + 6000, Object.assign({ kind: 'run_start', species: 'pleurotus', level: 1, cause: 'new' }, base));
      push(t + 15000, Object.assign({ kind: 'run_end', species: 'pleurotus', level: 1, cause: 'devoured', turns: 40 }, base));
      untagged++;
    }
  }

  rows.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  // Counted, not assumed: the first version of this hard-coded 40 because that is the modulus in
  // the id, and the loop only ever produces 27 of them.
  const devices = new Set(rows.map((r) => r.client_id)).size;
  // ...and the same two counts restricted to the DEFAULT source, which is what the page opens on.
  const cg = rows.filter((r) => r.source === 'crazygames');
  const devicesCG = new Set(cg.map((r) => r.client_id)).size;
  const startsCG = cg.filter((r) => r.kind === 'run_start').length;
  return { rows, boots, starts, clears1, devices, oldSessions, campStarts, campClears1, untagged,
    survStarts, survClears1, survL2, survRuns, survPlayers: survPlayers.size, campPlayers,
    itchSessions, devicesCG, startsCG };
}

(async () => {
  if (!fs.existsSync(PAGE)) { console.log('  FAIL  docs/analytics.html is missing — run node scripts/gen-analytics.mjs'); fail++; }

  // ---- the generator's own guards --------------------------------------------
  console.log('-- the generator --');
  const src = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const held = fs.readFileSync(PAGE, 'utf8');
  node(['scripts/gen-analytics.mjs']);
  const fresh = fs.readFileSync(PAGE, 'utf8');
  ok('docs/analytics.html is up to date with index.html', held === fresh,
     held === fresh ? 'regenerating changes nothing' : 're-run node scripts/gen-analytics.mjs and commit');
  if (held !== fresh) fs.writeFileSync(PAGE, held);

  // THE ONLY KEY THAT MAY BE IN A PUBLIC PAGE. `service_role` and `anon` are both JWTs and look
  // the same; one of them is a real secret. Asserted on the page, not on the generator's intent.
  const keys = [...held.matchAll(/eyJ[A-Za-z0-9_-]+\.([A-Za-z0-9_-]+)\./g)].map((m) => m[1]);
  const roles = keys.map((b) => { try { return JSON.parse(Buffer.from(b, 'base64').toString('utf8')).role; } catch (e) { return '?'; } });
  ok('the only Supabase key in the page is the ANON key', keys.length > 0 && roles.every((r) => r === 'anon'),
     roles.join(', ') || 'no key found');
  ok('...and it is the same one index.html uses',
     keys.length > 0 && src.includes(held.match(/(eyJ[A-Za-z0-9_.-]+)/)[1]), 'single-sourced');
  // The campaign length is read, not repeated — a 9-level campaign shown as 10 rows is a chart
  // with a permanent empty row at the bottom that everyone reads as "nobody finishes".
  const want = +(src.match(/const CAMPAIGN_LEVELS = (\d+)/) || [])[1];
  ok('the campaign length comes from index.html', held.includes('var CAMPAIGN_LEVELS = ' + want + ';'),
     `${want} levels`);

  // ---- the page, against a fake backend --------------------------------------
  console.log('\n-- the dashboard --');
  const srv = await new Promise((res) => { const s = http.createServer((rq, rs) => {
    let p = decodeURIComponent(rq.url.split('?')[0]); if (p === '/') p = '/index.html';
    const fp = path.join(ROOT, p);
    if (!fp.startsWith(ROOT) || !fs.existsSync(fp) || fs.statSync(fp).isDirectory()) { rs.writeHead(404); rs.end('nf'); return; }
    rs.writeHead(200, { 'Content-Type': p.endsWith('.html') ? 'text/html' : 'application/octet-stream' });
    fs.createReadStream(fp).pipe(rs); }); s.listen(0, () => res(s)); });
  const base = 'http://localhost:' + srv.address().port;
  const browser = await chromium.launch({ headless: true, executablePath: '/opt/pw-browsers/chromium' });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 1000 } });
  const page = await ctx.newPage();
  const errs = []; page.on('pageerror', (e) => errs.push(String(e && e.message)));
  page.on('console', (m) => { if (m.type() === 'error') errs.push('console:' + m.text()); });

  const F = fixture();
  let requests = 0;
  await page.route('**/rest/v1/events*', async (route) => {
    requests++;
    const rg = route.request().headers()['range'] || '0-999';
    const [a, z] = rg.split('-').map(Number);
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(F.rows.slice(a, z + 1)) });
  });
  await page.goto(base + '/docs/analytics.html', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => !/Loading/.test(document.getElementById('sub').textContent), { timeout: 25000 });
  await sleep(500);

  const sub = await page.$eval('#sub', (e) => e.textContent);
  ok('every row is loaded, not just the first page', new RegExp('^' + F.rows.length + ' events').test(sub),
     `${sub.split('·')[0].trim()} of ${F.rows.length} — ${requests} request(s)`);
  ok('...which took more than one request', requests >= 2, `${requests} pages fetched`);
  ok('no page errors', errs.length === 0, errs.slice(0, 2).join(' | '));

  // The numbers are arithmetic on the fixture, so a wrong one is wrong rather than surprising.
  const kpis = await page.$$eval('.kpi', (ks) => ks.map((k) => ({ v: k.querySelector('.v').textContent, k: k.querySelector('.k').textContent })));
  const kv = (label) => (kpis.find((x) => x.k === label) || {}).v;
  // AGAINST THE DEFAULT SOURCE, not the whole fixture. The page opens on `crazygames`, so the itch
  // cohort is legitimately outside these numbers — counting the fixture whole would assert that the
  // default filter does nothing.
  ok('players is the distinct-device count', kv('players') === String(F.devicesCG),
     `${kv('players')} (want ${F.devicesCG} on the default source)`);
  ok('runs started matches the fixture', kv('runs started') === String(F.startsCG),
     `${kv('runs started')} of ${F.startsCG}`);
  ok('runs ended matches the fixture', kv('runs ended') === String(F.startsCG), `${kv('runs ended')}`);
  // MEAN AND MEDIAN, SIDE BY SIDE — and they must be different numbers. The owner could not
  // reconcile this page with CrazyGames' own dashboard ("overall average playtime during the first
  // 24h was 4:25") because the page reported medians throughout and the store reports a mean over
  // GAMEPLAY time. Both were right. The mean is on the page now so the two can be compared without
  // anyone wondering which is broken, labelled as the store's statistic, and it is the PLAYED mean
  // because a store's clock starts when play does.
  ok('the funnel reports the store-comparable mean as well as the median',
     kv('median visit') != null && kv('mean PLAYED visit') != null
       && kv('median visit') !== kv('mean PLAYED visit'),
     `median ${kv('median visit')} · mean ${kv('mean PLAYED visit')}`);

  // HOW FAR PEOPLE GET — the headline table, and there is one PER GAME now. Every read below is
  // scoped to the panel whose lede names the game, because "the first table with a clear rate"
  // stopped being unambiguous the moment survival got a table of its own.
  // FOUND BY `data-game`, NOT BY ITS LEDE. The first version matched the panel's explanatory
  // sentence, which made the assertion hostage to the copy — and it duly broke when the survival
  // lede was removed, reporting a missing table on a page that drew it perfectly.
  const levelTable = (game) => page.evaluate((g) => {
    const p = document.querySelector('.panel[data-game="' + g + '"]');
    if (!p || !p.querySelector('table')) return null;
    const t = p.querySelector('table');
    return { rows: [...t.tBodies[0].rows].map((r) => [...r.children].map((td) => td.textContent.trim())),
             head: t.tHead.textContent.toLowerCase() };
  }, game);
  const campT = await levelTable('campaign');
  const campL1 = campT && campT.rows.find((r) => r[0] === 'Level 1');
  // A PRE-v2 ROW IS NOT ATTRIBUTABLE TO A GAME, so this table is smaller than "runs started" above
  // it and that is correct rather than a leak. Asserted against the campaign-only counters, with
  // the gap itself pinned below so the two can never silently converge.
  ok('the campaign table reports level 1 players, attempts and clears',
     campL1 && campL1[1] === String(F.campPlayers) && campL1[2] === String(F.campStarts)
       && campL1[3] === String(F.campClears1),
     campL1 ? campL1.slice(0, 5).join(' | ') : '(no Level 1 row)');
  ok('...and it excludes pre-v2 rows, which name no game, and survival rows, which name another',
     F.starts - F.campStarts === F.oldSessions + F.survRuns + F.itchSessions,
     `${F.starts} runs, ${F.campStarts} campaign, ${F.oldSessions} pre-v2, ${F.survRuns} survival, ${F.itchSessions} itch`);
  ok('...with exactly one row per campaign level', campT && campT.rows.length === want,
     `${campT ? campT.rows.length : -1} rows, campaign is ${want}`);

  // THE SURVIVAL TABLE, which did not exist: the section filtered every row for a campaign tag
  // whatever the Game chip said, so survival read as a game nobody had ever started.
  const survT = await levelTable('survival');
  const survL1 = survT && survT.rows.find((r) => r[0] === 'Level 1');
  ok('survival gets a level table of its own',
     survL1 && survL1[2] === String(F.survStarts) && survL1[3] === String(F.survClears1),
     survL1 ? survL1.slice(0, 5).join(' | ') : '(no survival panel)');
  ok('...counting PLAYERS separately from attempts, which is the question that was asked',
     survL1 && survL1[1] === String(F.survPlayers) && survL1[1] !== survL1[2],
     survL1 ? `${survL1[1]} players over ${survL1[2]} attempts (want ${F.survPlayers} of ${F.survStarts})` : '—');
  // An open ladder has no fixed length, so the table has to stop where the data does rather than
  // printing 90 empty rows — and it must not borrow the campaign's length either.
  ok('...and it stops at the deepest level anyone started, not at the campaign length',
     survT && survT.rows.length === 2, `${survT ? survT.rows.length : -1} rows (want 2, campaign is ${want})`);

  // THE BUG ITSELF, on the chip that surfaced it. Under Game=survival the campaign panel must go
  // and the survival numbers must be unchanged — the broken page kept the campaign panel and fed
  // it survival-attributed rows, which is how 120 attempts by 72 players rendered as 1.
  await page.click('.chip[data-f="game"][data-v="survival"]');
  await sleep(300);
  const survOnly = await levelTable('survival');
  const campGone = await levelTable('campaign');
  const survOnlyL1 = survOnly && survOnly.rows.find((r) => r[0] === 'Level 1');
  ok('picking Game=survival keeps the survival numbers whole',
     survOnlyL1 && survOnlyL1[1] === String(F.survPlayers) && survOnlyL1[2] === String(F.survStarts),
     survOnlyL1 ? survOnlyL1.slice(0, 4).join(' | ') : '(no level table under Game=survival)');
  ok('...and drops the campaign panel rather than filtering it to nothing', !campGone,
     campGone ? campGone.rows.slice(0, 1).join(' | ') : 'gone');
  await page.click('.chip[data-f="game"][data-v="campaign"]');
  await sleep(300);
  const campOnly = await levelTable('campaign');
  const campOnlyL1 = campOnly && campOnly.rows.find((r) => r[0] === 'Level 1');
  ok('...and Game=campaign is the mirror image', campOnlyL1 && !(await levelTable('survival'))
     && campOnlyL1[2] === String(F.campStarts),
     campOnlyL1 ? campOnlyL1.slice(0, 4).join(' | ') : '(no campaign table)');
  await page.click('.chip[data-f="game"][data-v=""]');
  await sleep(300);

  // SHARES MUST SUM. The device table's share column is the one that did not.
  const shares = await page.evaluate(() => {
    const h = [...document.querySelectorAll('#body table')].find((t) => /share of sessions/i.test(t.tHead.textContent));
    if (!h) return null;
    return [...h.tBodies[0].rows].map((r) => parseFloat(r.lastElementChild.textContent) || 0);
  });
  const total = shares ? shares.reduce((a, b) => a + b, 0) : 0;
  ok('the device shares add up to 100%', shares && Math.abs(total - 100) < 1.5, `${total.toFixed(1)}%`);

  // A PERCENTAGE ONLY WHERE THERE IS A DENOMINATOR. The retries table is scaled per attempt now;
  // the "most-drafted"/"which upgrades" tables are scales and must print counts alone.
  const scaleRows = await page.evaluate(() => {
    const out = [];
    for (const t of document.querySelectorAll('#body table')) {
      const head = t.tHead.textContent.toLowerCase();
      if (!/bought|taken/.test(head)) continue;
      for (const r of t.tBodies[0].rows) { const s = r.querySelector('.track span'); if (s) out.push(s.textContent); }
    }
    return out;
  });
  // ZERO ROWS IS A FAILURE HERE. The first version of this fixture had no draft or upgrade
  // events, so the tables never rendered and "none of them printed a percentage" was true of
  // nothing at all — a green line asserting the absence of a table.
  ok('a bar scaled to the biggest value prints no percentage',
     scaleRows.length >= 2 && scaleRows.every((t) => !/%/.test(t)),
     scaleRows.length < 2 ? `only ${scaleRows.length} scaled row(s) rendered — nothing was checked`
       : (scaleRows.filter((t) => /%/.test(t)).slice(0, 2).join(' | ') || `${scaleRows.length} rows checked`));

  // ---- THE ENGINES: TAKEN vs BUILT ------------------------------------------
  // Two numbers that are easy to confuse and mean different things: `draft` is what was offered
  // and taken, `install` is what reached the board. The panel exists for the GAP between them.
  const eng = await page.evaluate(() => {
    const h = [...document.querySelectorAll('#body > h2')].find((x) => /engines/i.test(x.textContent));
    if (!h) return null;
    let n = h.nextElementSibling, t = null;
    while (n && n.tagName !== 'H2' && !t) { t = n.querySelector && n.querySelector('table'); n = n.nextElementSibling; }
    if (!t) return { rows: [] };
    return { rows: [...t.querySelectorAll('tbody tr')].map((tr) => [...tr.children].map((td) => td.textContent.trim())) };
  });
  const dew = eng && eng.rows.find((r) => /Dew Traps/.test(r[0]));
  ok('the engines panel separates TAKEN from BUILT', !!dew, JSON.stringify(eng && eng.rows.slice(0, 2)));
  // 14 players x 14 days took it; every third installed it. The exact ratio is the fixture's, but
  // what matters is that the two columns DIFFER — a panel that reprinted the draft count twice
  // would pass any "it renders" check and answer nothing.
  ok('...and they are different numbers', !!dew && dew[1] !== dew[2] && +dew[2] > 0,
     dew ? `${dew[1]} taken, ${dew[2]} built (${dew[3]})` : '—');
  // ONLY ENGINES. Constricting Ring is an ACTION and is installed in the fixture — it belongs in
  // the abilities panel, not this one, and `type` (the badge) is what decides, not
  // `displayCategory` (the pool it is drafted from), which disagrees per card.
  ok('...and an installed ACTION is not listed among the engines',
     !!eng && !eng.rows.some((r) => /Constricting Ring/.test(r[0])), JSON.stringify(eng && eng.rows.map((r) => r[0])));
  const abil = await page.evaluate(() => {
    // `.panel h2` is how every sub-panel on this page titles itself, but `querySelector('h2')`
    // on a panel whose heading is its first child still needs the panel to BE the parent — the
    // abilities panel is a sibling of the engines one, not a child, so find it by heading text
    // across the whole body and then walk to its own table.
    const hs = [...document.querySelectorAll('#body h2')];
    const h = hs.find((x) => /Installed abilities/.test(x.textContent));
    if (!h) return null;
    const t = h.parentElement && h.parentElement.querySelector('table');
    return t ? [...t.querySelectorAll('tbody tr')].map((tr) => tr.children[0].textContent.trim()) : [];
  });
  ok('...and it IS listed under installed abilities', !!abil && abil.includes('Constricting Ring'),
     JSON.stringify(abil));

  // Filters narrow, and the default keeps dev traffic out of a launch number.
  const before = await page.$$eval('.kpi .v', (v) => v[0].textContent);
  await page.click('.chip[data-f="device"][data-v="phone"]');
  await sleep(300);
  const after = await page.$$eval('.kpi .v', (v) => v[0].textContent);
  ok('a device filter narrows the numbers', +after < +before, `${before} players → ${after} on phone`);
  const srcOn = await page.$eval('.chip[data-f="source"].on', (b) => b.textContent);
  // DEFAULTS TO `crazygames` (owner) — that is where the players are. The point of a default at all
  // is that the same table carries dev boots and Playwright runs; opening on "all" is how you
  // convince yourself the game has ten times the players it has.
  ok('...and Source defaults to crazygames', srcOn === 'crazygames', srcOn);

  // THE `Era` AND `Release` CHIPS ARE GONE (owner: "this is all useless now"). Era split on a
  // COLUMN SET — the schema change that added game/mode/device — and Release listed every build
  // stamp. Both are asserted ABSENT rather than merely untested, since a chip group that comes
  // back would be a filter nobody asked for silently narrowing every number on the page.
  await page.click('.chip[data-f="device"][data-v=""]');           // undo the phone filter above
  await page.click('.chip[data-f="days"][data-v="0"]');
  await sleep(300);
  const groups = await page.$$eval('#bar .grp b', (bs) => bs.map((b) => b.textContent));
  ok('the filter bar carries no Era or Release chips',
     !groups.includes('Era') && !groups.includes('Release'), groups.join(' / '));
  ok('...and still carries the ones that earn their place',
     ['Window', 'Source', 'Game', 'Mode', 'Device'].every((g) => groups.includes(g)), groups.join(' / '));
  const rAll = await page.$$eval('.kpi', (ks) => {
    const k = ks.find((x) => x.querySelector('.k').textContent === 'runs started');
    return k ? +k.querySelector('.v').textContent : -1;
  });

  // A 1d window, and it has to actually cut: the fixture spans a fortnight.
  const has1d = await page.$('.chip[data-f="days"][data-v="1"]');
  ok('there is a 1-day window', !!has1d);
  await page.click('.chip[data-f="days"][data-v="1"]');
  await sleep(300);
  const r1d = await page.$$eval('.kpi', (ks) => {
    const k = ks.find((x) => x.querySelector('.k').textContent === 'runs started');
    return k ? +k.querySelector('.v').textContent : -1;
  });
  ok('...and it narrows a fortnight of events to the last day', r1d > 0 && r1d < rAll,
     `${r1d} runs in 1d vs ${rAll} all-time`);

  // ---- the era before `source` existed ----------------------------------------
  // A SOURCE FILTER DROPS IT SILENTLY, and on the real table that era IS the launch week — the
  // itch all-time figure was wrong by a bigger population than the one it showed. The banner is
  // the fix; asserted with Source `all` as the control, or "it warns" would pass on a page that
  // warns unconditionally.
  await page.click('.chip[data-f="days"][data-v="0"]');
  await sleep(350);
  const caveatOnItch = await page.$eval('#body', (b) => {
    const c = b.querySelector('.caveat');
    return c ? c.textContent.replace(/\s+/g, ' ').trim() : null;
  });
  ok('an untagged era is called out rather than silently dropped', !!caveatOnItch,
     caveatOnItch ? caveatOnItch.slice(0, 96) + '…' : '(no banner on Source: itch)');
  ok('...and it counts the events it is excluding',
     !!caveatOnItch && caveatOnItch.includes(String(F.untagged * 3)),
     `${F.untagged * 3} expected in: ${String(caveatOnItch).slice(0, 60)}…`);

  // ---- a denominator smaller than its population is not a denominator ---------
  // The pre-v2 sessions in the fixture send no `boot`, exactly as the shipped one did not. Before
  // the guard the funnel divided 44 sessions by 1 boot and printed rows in the thousands of
  // percent, which reads as a bug in the game rather than in the page's own arithmetic.
  const funnel = await page.$$eval('#body table tr', (trs) => trs.map((tr) =>
    [...tr.children].map((td) => td.textContent.trim()).join(' | ')).filter((t) => /reach|%/.test(t)).slice(0, 5));
  const overHundred = funnel.filter((t) => {
    const m = /(\d+(?:\.\d+)?)%/.exec(t);
    return m && +m[1] > 100;
  });
  ok('no funnel row exceeds 100% when boots are missing', overHundred.length === 0,
     overHundred.length ? overHundred.join(' ;; ') : `${funnel.length} rows, all <= 100%`);
  const bootNote = await page.$$eval('#body .empty', (ps) => ps.map((p) => p.textContent).find((t) => /sent a `boot`/.test(t)) || null);
  ok('...and the funnel says it is over sessions instead, and why', !!bootNote,
     bootNote ? bootNote.slice(0, 88) + '…' : '(no note)');

  const hasNone = await page.$('.chip[data-f="source"][data-v="__none"]');
  ok('...and the era has a chip of its own, so it is reachable', !!hasNone);
  if (hasNone) {
    await page.click('.chip[data-f="source"][data-v="__none"]');
    await sleep(350);
    const rUn = await page.$$eval('.kpi', (ks) => {
      const k = ks.find((x) => x.querySelector('.k').textContent === 'runs started');
      return k ? +k.querySelector('.v').textContent : -1;
    });
    ok('...and selecting it shows exactly that era', rUn === F.untagged, `${rUn} of ${F.untagged}`);
  }
  await page.click('.chip[data-f="source"][data-v=""]');
  await sleep(350);
  const caveatOnAll = await page.$('#body .caveat');
  ok('...and Source: all excludes nothing, so it carries no warning', !caveatOnAll,
     caveatOnAll ? 'banner shown on Source: all' : 'no banner, correctly');

  // ---- an empty table says so rather than breaking -----------------------------
  const ctx2 = await browser.newContext({ viewport: { width: 1100, height: 800 } });
  const p2 = await ctx2.newPage();
  const errs2 = []; p2.on('pageerror', (e) => errs2.push(String(e && e.message)));
  await p2.route('**/rest/v1/events*', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: '[]' }));
  await p2.goto(base + '/docs/analytics.html', { waitUntil: 'domcontentloaded' });
  await p2.waitForFunction(() => !/Loading/.test(document.getElementById('sub').textContent), { timeout: 20000 });
  await sleep(300);
  const emptyTxt = await p2.$eval('#body', (e) => e.textContent);
  ok('an empty table renders an explanation, not a crash',
     /No events yet/.test(emptyTxt) && errs2.length === 0, errs2[0] || emptyTxt.slice(0, 60));

  // ...and a missing table (the pre-migration case) explains itself too.
  const ctx3 = await browser.newContext();
  const p3 = await ctx3.newPage();
  await p3.route('**/rest/v1/events*', (r) => r.fulfill({ status: 404, contentType: 'application/json', body: '{}' }));
  await p3.goto(base + '/docs/analytics.html', { waitUntil: 'domcontentloaded' });
  await p3.waitForFunction(() => /Could not load/.test(document.getElementById('sub').textContent), { timeout: 20000 }).catch(() => {});
  const errTxt = await p3.$eval('#sub', (e) => e.textContent);
  ok('a missing events table points at the migration', /does not exist yet/.test(errTxt), errTxt.slice(0, 90));

  fs.mkdirSync(path.join(ROOT, 'tests', '.artifacts'), { recursive: true });
  await page.screenshot({ path: path.join(ROOT, 'tests', '.artifacts', 'analytics-check.png'), animations: 'disabled', timeout: 20000 }).catch(() => {});
  // ---- RETENTION, on a fixture whose answer is known by hand ----------------
  // Five players, built so every rule the section rests on is exercised by exactly one of them.
  // A separate page: the main fixture is shaped for the funnel, and reusing it would mean asserting
  // against numbers nobody worked out on paper.
  {
    const DAY = 86400000, H = 3600000, now = Date.now();
    const rows = []; let id = 0;
    const ev = (cid, t) => rows.push({ id: ++id, created_at: new Date(t).toISOString(),
      client_id: cid, session_id: 'x' + (++id), kind: 'boot', ms: 1000,
      source: 'itch', game: 'campaign', mode: 'turn', device: 'desktop' });
    // P1 arrived 2 HOURS ago: has not had a chance to return, so must not be in the denominator.
    ev('P1', now - 2 * H);
    // P2: one visit, 3 days ago. Mature, did not come back.
    ev('P2', now - 3 * DAY);
    // P3: 3 days ago and again 2 days ago. Mature, came back.
    ev('P3', now - 3 * DAY); ev('P3', now - 2 * DAY);
    // P4: 5 days ago, three events 5 MINUTES apart — a reload, which is ONE visit, not a return.
    ev('P4', now - 5 * DAY); ev('P4', now - 5 * DAY + 5 * 60000); ev('P4', now - 5 * DAY + 10 * 60000);
    // P5: three visits over four days.
    ev('P5', now - 4 * DAY); ev('P5', now - 3 * DAY); ev('P5', now - 1 * DAY);
    // Hand-computed: 5 players, 4 mature (all but P1), 2 of those came back (P3, P5) = 50%.
    const rp = await ctx.newPage();
    const rerrs = []; rp.on('pageerror', (e) => rerrs.push(String(e && e.message)));
    await rp.route('**/rest/v1/events*', async (route) => {
      const rg = route.request().headers()['range'] || '0-999';
      const [a, z] = rg.split('-').map(Number);
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(rows.slice(a, z + 1)) });
    });
    await rp.goto(base + '/docs/analytics.html', { waitUntil: 'domcontentloaded' });
    await rp.waitForFunction(() => !/Loading/.test(document.getElementById('sub').textContent), { timeout: 25000 });
    await sleep(400);
    const kpiOf = (label) => rp.evaluate((l) => {
      const k = [...document.querySelectorAll('.kpi')].find((n) => (n.querySelector('.k') || {}).textContent === l);
      return k ? { v: k.querySelector('.v').textContent, note: (k.querySelector('.note') || {}).textContent || '' } : null;
    }, label);
    ok('the retention section is on the page',
       await rp.evaluate(() => [...document.querySelectorAll('h2')].some((h) => /Coming back/.test(h.textContent))));
    const kPlayers = await kpiOf('players');
    const kBack = await kpiOf('came back');
    ok('every player is counted', kPlayers && kPlayers.v === '5', kPlayers && kPlayers.v);
    // IT OPENS ON A SENTENCE (owner: the retention numbers were "very confusing"). Five KPIs and
    // four tables across two identically-titled sections never said what the answer WAS; the lead
    // line does, and it carries the denominator rule with it in words a reader cannot misread.
    const lead = await rp.evaluate(() => {
      const h = [...document.querySelectorAll('h2')].find((x) => /Coming back/.test(x.textContent));
      let n = h && h.nextElementSibling, p = null;
      while (n && !p) { p = n.querySelector && n.querySelector('.lead'); n = n.nextElementSibling; }
      return p ? p.textContent.replace(/\s+/g, ' ').trim() : null;
    });
    ok('...and the section opens by SAYING the answer, not implying it',
       !!lead && /4 players who first played more than a day ago/.test(lead) && /2 \(50%\) came back/.test(lead),
       lead || '(no lead sentence)');
    // THE DENOMINATOR RULE. P1 arrived two hours ago and has not failed to return — they have not
    // been asked. Counting them would print 40% where the truth is 50%, and right after a launch
    // that error is much larger, because almost everyone is brand new.
    ok('...with the players too new to judge named separately, not folded in',
       !!lead && /A further 1 arrived too recently/.test(lead), lead || '(no lead sentence)');
    ok('...and the return rate is over THAT denominator',
       kBack && kBack.v === '50%', kBack && (kBack.v + ' — ' + kBack.note));
    // P4's three events five minutes apart are one visit. Counting sessions instead of visits would
    // call that a returning player and print 75%.
    ok('...with a reload counted as one visit, not as coming back',
       kBack && /2 of 4/.test(kBack.note), kBack && kBack.note);
    // ONE SECTION, NOT TWO. There were two headings called "Coming back" measuring the same thing
    // several screens apart, which is what made it unreadable — asserted so they cannot drift back.
    const backHeads = await rp.evaluate(() =>
      [...document.querySelectorAll('#body > h2')].filter((h) => /Coming back/.test(h.textContent)).length);
    ok('...and there is exactly ONE retention section', backHeads === 1, `${backHeads} heading(s)`);
    ok('no page errors in the retention section', rerrs.length === 0, rerrs.slice(0, 2).join(' | '));
    await rp.close();
  }

  // ---- the before/after RELEASE comparison, on a fixture worked out by hand ----
  // The owner's question after shipping: did play time move? It replaced "did the update change
  // spending?", which had answered the question before it. PLAY TIME is `session_end.ms` — one
  // visit, boot to close — and it is the closest thing in this table to "did they enjoy it".
  {
    const DAY = 86400000, now = Date.now();
    const rows = []; let id = 0;
    // `boot.detail` is the build stamp; a session with none predates the change that added it.
    const boot = (cid, sid, t, build) => rows.push({ id: ++id, created_at: new Date(t).toISOString(),
      client_id: cid, session_id: sid, kind: 'boot', ms: 1000, detail: build || null,
      source: 'crazygames', game: 'campaign', mode: 'turn', device: 'desktop' });
    const ev = (cid, sid, t, kind, n, ms) => rows.push({ id: ++id, created_at: new Date(t).toISOString(),
      client_id: cid, session_id: sid, kind, n: n == null ? null : n, ms: ms == null ? null : ms,
      source: 'crazygames', game: 'campaign', mode: 'turn', device: 'desktop' });
    // BEFORE (no stamp): 3 players, sessions of 55s / 95s / 125s -> median 95s = "1m 35s".
    //                    2 of 3 start a run.
    // DELIBERATELY NOT ROUND. The old formatter collapsed to one unit, so 100s and 149s both
    // printed "2m" and a release that moved play time by half a minute was invisible. A fixture
    // whose medians land on whole minutes would pass either way and prove nothing.
    [['b1', 's1', 55000], ['b2', 's2', 95000], ['b3', 's3', 125000]].forEach(([c, sid, ms], i) => {
      boot(c, sid, now - 5 * DAY);
      // b3 loads and leaves: no run, no level. It is the bouncer the played median must drop —
      // and it is the LONGEST of the three, so a broken filter reads higher, not lower.
      if (i < 2) { ev(c, sid, now - 5 * DAY, 'run_start', null, null); ev(c, sid, now - 5 * DAY, 'level_start', null, null); }
      if (c === 'b2') ev(c, sid, now - 5 * DAY, 'upgrade', 250);
      ev(c, sid, now - 5 * DAY, 'session_end', 1, ms);
    });
    // A SECOND, OLDER STAMPED BUILD — the case that made the table wrong. Two uploads in one day
    // gave the previous build a row of its own, which split the baseline and left the release
    // being judged against a handful of sessions. It must fold into "everything before it".
    boot('p1', 's7', now - 2 * DAY, '2026-08-08-old0001');
    ev('p1', 's7', now - 2 * DAY, 'run_start', null, null);   // a run but no level: not a played visit
    ev('p1', 's7', now - 2 * DAY, 'session_end', 1, 90000);
    // ONE SPENDER ON EACH SIDE, and on the AFTER side they spend TWICE — a per-event count would
    // read 2 of 3 as spenders where the truth is 1 of 3, which is the same defect as counting
    // clears instead of players.
    // AFTER (stamped): 3 players at 240s / 305s / 370s -> median 305s = "5m 5s", and all three run.
    [['a1', 's4', 240000], ['a2', 's5', 305000], ['a3', 's6', 370000]].forEach(([c, sid, ms]) => {
      boot(c, sid, now - 1 * DAY, '2026-08-09-abc1234');
      ev(c, sid, now - 1 * DAY, 'run_start', null, null);
      ev(c, sid, now - 1 * DAY, 'level_start', null, null);
      ev(c, sid, now - 1 * DAY, 'level_clear', null, null);
      if (c === 'a3') ev(c, sid, now - 1 * DAY, 'level_clear', null, null);   // clears twice: still one player
      if (c === 'a1') { ev(c, sid, now - 1 * DAY, 'upgrade', 100); ev(c, sid, now - 1 * DAY, 'purchase', 350); }
      ev(c, sid, now - 1 * DAY, 'session_end', 1, ms);
    });
    const sp = await ctx.newPage();
    const serrs = []; sp.on('pageerror', (e) => serrs.push(String(e && e.message)));
    await sp.route('**/rest/v1/events*', async (route) => {
      const rg = route.request().headers()['range'] || '0-999';
      const [a, z] = rg.split('-').map(Number);
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(rows.slice(a, z + 1)) });
    });
    await sp.goto(base + '/docs/analytics.html', { waitUntil: 'domcontentloaded' });
    await sp.waitForFunction(() => !/Loading/.test(document.getElementById('sub').textContent), { timeout: 25000 });
    await sleep(400);
    const cmp = await sp.evaluate(() => {
      const h = [...document.querySelectorAll('h2')].find((x) => /Before and after the last release/i.test(x.textContent));
      if (!h) return null;
      // The panel this heading owns, not `h.parentElement` — every section lives in the same
      // #body, so a query from the parent finds the FIRST .empty on the page (which was the
      // retention section's, several screens up) and the assertion tested the wrong sentence.
      let n = h.nextElementSibling, pan = null;
      while (n && n.tagName !== 'H2' && !pan) { if (n.querySelector && n.querySelector('table')) pan = n; n = n.nextElementSibling; }
      if (!pan) return { rows: [] };
      const t = pan.querySelector('table');
      return { rows: [...t.querySelectorAll('tbody tr')].map((tr) => [...tr.children].map((td) => td.textContent.trim())),
               head: t.tHead ? t.tHead.textContent : '',
               note: [...pan.querySelectorAll('.empty, .lead')].map((p) => p.textContent).join(' ') };
    });
    ok('the before/after release section exists', !!cmp && cmp.rows.length > 0, JSON.stringify(cmp && cmp.rows));
    const after = cmp && cmp.rows.find((r) => /abc1234/.test(r[0]));
    const before = cmp && cmp.rows.find((r) => /everything before/i.test(r[0]));
    // EXACTLY TWO ROWS (owner: "the proper cutoff point is now, not earlier today"). The fixture
    // carries a SECOND stamped build from two days before; a row-per-stamp table would draw three
    // and judge the release against whichever fragment happened to be adjacent.
    ok('...cut into exactly two rows, the release and one baseline',
       !!after && !!before && cmp.rows.length === 2 && cmp.rows.indexOf(after) === 0,
       JSON.stringify(cmp && cmp.rows.map((r) => r[0])));
    // ...and the older stamp is IN the baseline, not missing from the page. A fold that dropped it
    // would look identical in the two rows above and quietly lose a build's worth of sessions.
    ok('...with the previous build folded into it, and named',
       !!before && before[2] === '4' && /old0001/.test(cmp.note) && /1 session\b/.test(cmp.note),
       `${before && before[2]} baseline sessions · ${(cmp && cmp.note || '').slice(0, 90)}`);
    // The cut has to say WHERE it is: "the latest build" is not a date anyone can check.
    ok('...and the section names the build it cuts at',
       !!cmp && /Cut at 2026-08-09-abc1234/.test(cmp.note), (cmp && cmp.note || '').slice(0, 60));
    // THE HEADLINE COLUMN. Median, not mean: one player who leaves a tab open overnight moves a
    // mean by minutes and a median not at all, and on a table this small it would be the whole
    // result. 60/120/180 -> 2m; 300/360/420 -> 6m.
    // 55 / 90 / 95 / 125 -> median (90+95)/2 = 92.5s, which rounds to 1m 33s. The 90 is the folded
    // older build's session, so this number is also the fold doing its job.
    // TWO MEDIANS NOW (owner: "not including people who bounce without starting a level"), and the
    // fixture is arranged so they DIFFER — b3 and p1 never start a level, so they are in the
    // all-visits median and out of the played one. Identical columns would pass any "it renders"
    // check while the filter did nothing.
    //   all:    55 / 90 / 95 / 125 -> median 92.5s -> "1m 33s" over 4
    //   played: 55 / 95            -> median 75s   -> "1m 15s" over 2
    ok('the median visit includes the bouncers', !!before && /^1m 33s/.test(before[3]), before && before[3]);
    ok('...and the PLAYED median excludes them', !!before && /^1m 15s/.test(before[4]), before && before[4]);
    ok('...so the two columns are not the same number',
       !!before && before[3] !== before[4], `${before && before[3]} vs ${before && before[4]}`);
    ok('...and the count travels with each median', !!before && /\(4\)/.test(before[3]) && /\(2\)/.test(before[4]),
       `${before && before[3]} / ${before && before[4]}`);
    ok('the release side reports both too', !!after && /^5m 5s/.test(after[3]) && /^5m 5s/.test(after[4]),
       (after && after[3]) + ' / ' + (after && after[4]));
    // BOTH UNITS (owner: "need more detail"). Asserted as a shape rather than only as the exact
    // strings above, so a formatter that went back to one unit fails here under a name that says
    // what it lost. Anchored at the START of the cell, not the whole of it: the cell carries the
    // visit count in brackets after the duration, and matching to `$` made this a test of the
    // layout instead of the formatter.
    ok('...and a duration carries minutes AND seconds, not one rounded unit',
       !!before && /^\d+m \d+s\b/.test(before[3]) && !!after && /^\d+m \d+s\b/.test(after[3]),
       (before && before[3]) + ' / ' + (after && after[3]));
    // 4 on the baseline: the three pre-stamp players plus the folded older build's one.
    ok('players and sessions are counted per side',
       !!before && before[1] === '4' && before[2] === '4' && !!after && after[1] === '3',
       (before && before.slice(1, 3).join('/')) + ' vs ' + (after && after.slice(1, 3).join('/')));
    // "Reached a run" is per SESSION: 3 of 4 on the baseline (b1, b2 and the folded p1), 3 of 3 after.
    ok('...as is the share of sessions that reached a run',
       !!before && /75%/.test(before[5]) && !!after && /100%/.test(after[5]),
       (before && before[5]) + ' vs ' + (after && after[5]));
    // AND "CLEARED A LEVEL" IS PER PLAYER, WHICH IS A DIFFERENT DENOMINATOR ON PURPOSE (owner:
    // "% who cleared at least one level"). Nobody clears before, all three clear after. Asserted
    // as DISTINCT PLAYERS: a3 clears twice in the fixture, so a per-event count would read 4 of 3
    // and print 133% — the same defect as counting attempts where the question said people.
    ok('...and the share of PLAYERS who cleared at least one level',
       !!before && /^0\b/.test(before[6]) && /0%/.test(before[6])
         && !!after && /^3\b/.test(after[6]) && /100%/.test(after[6]),
       (before && before[6]) + ' vs ' + (after && after[6]));
    ok('...counting a player who cleared twice ONCE', !!after && !/^4\b/.test(after[6]), after && after[6]);
    // SPENDING, in the release table rather than a section of its own — the campaign is built to
    // stop a new player at level 3 or 4 and the answer is the store, so it is much of what a
    // release is judged on. One spender of three on each side; the AFTER one spends TWICE.
    // 1 of 4 on the baseline (the three pre-stamp players plus the folded older build's one),
    // 1 of 3 on the release.
    ok('...and the share of PLAYERS who spent anything',
       !!before && /^1\b/.test(before[7]) && /25%/.test(before[7])
         && !!after && /^1\b/.test(after[7]) && /33\.3%/.test(after[7]),
       (before && before[7]) + ' vs ' + (after && after[7]));
    ok('...counting a player who spent twice ONCE', !!after && !/^2\b/.test(after[7]), after && after[7]);
    ok('...and the two percentage columns name their denominators in the header',
       !!cmp && /reached a run \(sessions\)/i.test(cmp.head) && /cleared a level \(players\)/i.test(cmp.head),
       cmp && cmp.head);
    // A SMALL SAMPLE MUST SAY SO. Three sessions on a new build is not a result, and a table that
    // prints it with the same confidence as a month of data invites exactly the wrong conclusion.
    ok('...and a thin newest release warns about itself',
       !!cmp && /too few to read as a result/.test(cmp.note), (cmp && cmp.note || '').slice(0, 80));

    // ---- THE CUT POINT MUST NOT MOVE WHEN A FILTER DOES -------------------------
    // Reported: "I still see 13 players today doing survival after the update". Taken from the
    // FILTERED rows, the cut moved whenever a filter excluded the newest build — pick Game=survival
    // and the release (which has no survival in it) contributed nothing, so the newest stamp still
    // standing was the PREVIOUS build, and the section relabelled that as "the last release" and
    // showed its survival players as if they were on the new one.
    //
    // The fixture's release is CAMPAIGN-ONLY and the baseline carries a survival session, which is
    // the shape that reproduces it.
    ev('a1', 's4b', now - 1 * DAY, 'run_start', null, null);
    rows.filter((r) => r.session_id === 's4b').forEach((r) => { r.game = 'campaign'; });
    boot('z1', 's8', now - 3 * DAY, '2026-08-08-old0001');
    rows.push({ id: ++id, created_at: new Date(now - 3 * DAY).toISOString(), client_id: 'z1',
      session_id: 's8', kind: 'run_start', game: 'survival', mode: 'turn', device: 'desktop',
      source: 'crazygames', n: null, ms: null });
    await sp.reload({ waitUntil: 'domcontentloaded' });
    await sp.waitForFunction(() => !/Loading/.test(document.getElementById('sub').textContent), { timeout: 25000 });
    await sleep(400);
    const cutOf = () => sp.evaluate(() => {
      const h = [...document.querySelectorAll('#body > h2')].find((x) => /Before and after/.test(x.textContent));
      let n = h && h.nextElementSibling, pan = null;
      while (n && n.tagName !== 'H2' && !pan) { if (n.querySelector && n.querySelector('table')) pan = n; n = n.nextElementSibling; }
      if (!pan) return null;
      return { lead: (pan.querySelector('.lead') || {}).textContent || '',
               first: [...pan.querySelectorAll('tbody tr')].map((tr) => tr.children[0].textContent.trim()),
               note: [...pan.querySelectorAll('.empty')].map((p) => p.textContent).join(' ') };
    });
    const cutBoth = await cutOf();
    await sp.click('.chip[data-f="game"][data-v="survival"]');
    await sleep(500);
    const cutSurv = await cutOf();
    ok('the cut point does not move when a filter excludes the release',
       !!cutBoth && !!cutSurv && /abc1234/.test(cutBoth.lead) && /abc1234/.test(cutSurv.lead),
       `both: ${(cutBoth && cutBoth.lead || '').slice(0, 40)} · survival: ${(cutSurv && cutSurv.lead || '').slice(0, 40)}`);
    // ...and the release keeps its row, empty, because an empty row IS the finding here.
    ok('...and the release row is still drawn, with nothing in it',
       !!cutSurv && cutSurv.first[0] === '2026-08-09-abc1234' && /No sessions on/.test(cutSurv.note),
       JSON.stringify(cutSurv && cutSurv.first));
    await sp.click('.chip[data-f="game"][data-v=""]');
    await sleep(400);

    // ---- `dev` IS NOT A RELEASE -------------------------------------------------
    // BUILD_ID is the literal "dev" in the repo, so every local run and Playwright boot posts
    // `detail: "dev"` — a perfectly good string that sorts AFTER any date. Taken as the newest
    // stamp it made the section read "Cut at dev" with an empty release row and every real release
    // folded into the baseline.
    boot('d1', 's9', now, 'dev');
    rows.push({ id: ++id, created_at: new Date(now).toISOString(), client_id: 'd1', session_id: 's9',
      kind: 'run_start', game: 'campaign', mode: 'turn', device: 'desktop', source: 'crazygames', n: null, ms: null });
    await sp.reload({ waitUntil: 'domcontentloaded' });
    await sp.waitForFunction(() => !/Loading/.test(document.getElementById('sub').textContent), { timeout: 25000 });
    await sleep(400);
    const cutDev = await cutOf();
    ok('a `dev` stamp is not mistaken for the latest release',
       !!cutDev && /abc1234/.test(cutDev.lead) && !/Cut at dev/.test(cutDev.lead),
       (cutDev && cutDev.lead || '').slice(0, 60));

    ok('no page errors in the release comparison', serrs.length === 0, serrs.slice(0, 2).join(' | '));
    await sp.close();
  }

  console.log(`\n==== ${pass} passed, ${fail} failed ====`);
  await browser.close(); srv.close();
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('HARNESS ERROR', e); process.exit(1); });
