/* THE EVENT STREAM — what the game will actually tell you once it is published.
 *
 * Telemetry is the one system whose bugs are invisible until the data is needed and then
 * unfixable, because the sessions it should have described are gone. Everything here is asserted
 * on the ROW THAT WOULD BE POSTED (`__game.telemetry.tap`), which is the same object the POST
 * sends, built by the same function — a tap that rebuilt the row itself would drift the first
 * time a field was clamped differently.
 *
 * `scoresEnabled()` is false throughout: every check blanks the Supabase key so nothing can write
 * to the live project, and the tap runs ahead of that gate precisely so this is still observable.
 *
 * What it guards, and why each one has a way of going quietly wrong:
 *  · EVERY EVENT CARRIES `game`, `mode` AND `device`. Attached centrally rather than at twenty
 *    call sites; one that forgot would produce rows nobody can group by, and you would find out
 *    a month after launch.
 *  · THE FUNNEL HAS A DENOMINATOR AND IT BALANCES. `boot` fires once; every run that ends also
 *    started. `run_start` used to fire only from the picker, so resumed runs ended having never
 *    begun and every continue was silently missing from the numerator.
 *  · `perf` STAYS OUT OF THE LEVEL COLUMN. It used to smuggle frame-ms into `turns` and pixels
 *    into `level`, so "how far do people get" quietly included rows that were never a level.
 *  · NOTHING IDENTIFYING LEAVES. Asserted as a whitelist over the whole stream, so a future
 *    field has to be added here deliberately rather than arriving by accident.
 *  · IT SURVIVES AN UN-MIGRATED TABLE. On a 400 the poster latches and falls back to the seven
 *    original columns, instead of every event disappearing until someone runs the SQL.
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

// The ONLY fields any event may carry. A whitelist rather than a blacklist: the failure worth
// preventing is a new field nobody thought about, and a blacklist cannot see one.
const ALLOWED = new Set(['client_id', 'session_id', 'kind', 'species', 'level', 'cause', 'turns',
  'source', 'game', 'mode', 'device', 'n', 'ms', 'detail']);

(async () => {
  const srv = await new Promise((res) => { const s = http.createServer((rq, rs) => {
    let p = decodeURIComponent(rq.url.split('?')[0].split('#')[0]); if (p === '/') p = '/index.html';
    const fp = path.join(ROOT, p);
    if (!fp.startsWith(ROOT) || !fs.existsSync(fp) || fs.statSync(fp).isDirectory()) { rs.writeHead(404); rs.end('nf'); return; }
    rs.writeHead(200, { 'Content-Type': T[path.extname(fp)] || 'application/octet-stream' });
    fs.createReadStream(fp).pipe(rs); }); s.listen(0, () => res(s)); });
  const base = 'http://localhost:' + srv.address().port;
  const browser = await chromium.launch({ headless: true, executablePath: '/opt/pw-browsers/chromium' });

  // Arm the tap BEFORE anything can fire — `boot` lands during the load sequence, and it is the
  // one event a check that attached afterwards could never see.
  const armTap = () => `(${(() => {
    window.__EV = [];
    const arm = () => {
      if (!(window.__telemetry)) return false;
      window.__telemetry.tap((row) => { window.__EV.push(row); });
      return true;
    };
    if (!arm()) {
      const t = setInterval(() => { if (arm()) clearInterval(t); }, 10);
      setTimeout(() => clearInterval(t), 30000);
    }
  }).toString()})()`;

  const openGame = async (hash, w = 1280, h = 800) => {
    const ctx = await browser.newContext({ viewport: { width: w, height: h } });
    const page = await ctx.newPage();
    await page.addInitScript(() => { window.MYCELIUM_SUPABASE = { url: '', anonKey: '' }; });
    await page.addInitScript(armTap());
    await page.goto(base + '/index.html' + hash, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('#loadscreen.ld-ready', { timeout: 25000 }).catch(() => {});
    await page.click('#loadscreen', { timeout: 5000 }).catch(() => {});
    await page.waitForFunction(() => !!window.__telemetry, { timeout: 25000 });
    return page;
  };
  const evs = (page) => page.evaluate(() => window.__EV.slice());

  // ---- 1. a desktop campaign session ------------------------------------------
  console.log('\n-- a session, start to finish --');
  const page = await openGame('#dev,turn');
  await sleep(1200);
  let rows = await evs(page);
  ok('the boot event fires — the funnel has a denominator',
     rows.filter((r) => r.kind === 'boot').length === 1,
     `${rows.filter((r) => r.kind === 'boot').length} boot row(s) of ${rows.length}`);
  const boot = rows.find((r) => r.kind === 'boot');
  ok('...and says how long the load took', boot && typeof boot.ms === 'number' && boot.ms >= 0, boot && `ms ${boot.ms}`);

  // Drive a real run through the PICKER'S OWN BUTTON, not `campaign.play` — that is a test hook
  // which mimics `onPick` and skips the telemetry, so a check driving it would assert nothing
  // about the path a player takes.
  await page.evaluate(() => {
    document.querySelectorAll('#speciesSelect, #levelIntro, #tutorial, #ssLevelComplete, #ssGameWon').forEach((n) => n.remove());
    window.__game.showPicker();
  });
  await page.waitForSelector('#ssAvail .ss-selbtn', { timeout: 10000 });
  await page.click('#ssAvail .ss-selbtn');
  await sleep(1500);
  await page.evaluate(async () => {
    const g = window.__game;
    document.querySelectorAll('#levelIntro, #tutorial').forEach((n) => n.remove());
    g.winLevel();
    for (let i = 0; i < 60; i++) {
      await new Promise((r) => setTimeout(r, 150));
      if (document.getElementById('ssLevelComplete') || document.getElementById('ssGameWon')) break;
    }
    document.querySelectorAll('#ssLevelComplete, #ssGameWon').forEach((n) => n.remove());
  });
  await sleep(500);
  rows = await evs(page);
  const kinds = [...new Set(rows.map((r) => r.kind))];
  ok('the picker is recorded', rows.some((r) => r.kind === 'picker'), kinds.join(', '));
  ok('a run start is recorded, and says HOW it started',
     rows.some((r) => r.kind === 'run_start' && r.cause === 'new'),
     JSON.stringify(rows.filter((r) => r.kind === 'run_start').map((r) => r.cause)));
  ok('a level start is recorded — so a clear rate has a denominator per level',
     rows.some((r) => r.kind === 'level_start' && r.level >= 1),
     JSON.stringify(rows.filter((r) => r.kind === 'level_start').map((r) => r.level)));
  const clear = rows.find((r) => r.kind === 'level_clear');
  ok('a level clear is recorded with BOTH clocks', !!clear && typeof clear.turns === 'number' && typeof clear.ms === 'number',
     clear ? `level ${clear.level}, ${clear.turns} turns, ${clear.ms} ms` : '(none)');

  // ---- 2. every row is groupable ----------------------------------------------
  console.log('\n-- context on every row --');
  const missing = rows.filter((r) => !r.game || !r.mode || !r.device);
  ok('every event carries game, mode and device', missing.length === 0,
     missing.length ? `${missing.length} without: ${JSON.stringify(missing[0])}` : `${rows.length} rows`);
  ok('...and the mode is always one of the two',
     rows.every((r) => r.mode === 'turn' || r.mode === 'realtime'),
     JSON.stringify([...new Set(rows.map((r) => r.mode))]));
  ok('...and the game is always one of the two', rows.every((r) => r.game === 'campaign' || r.game === 'survival'),
     JSON.stringify([...new Set(rows.map((r) => r.game))]));
  // THE ROWS THAT DESCRIBE A RUN carry that run's mode. `boot` is deliberately NOT among them: it
  // fires before the player has chosen anything, so it reports the config's own defaults — which
  // is the honest answer to "what was set when the page became playable", and pinning it to the
  // booted mode would be asserting the boot hash rather than the telemetry.
  const runRows = rows.filter((r) => ['run_start', 'level_start', 'level_clear', 'run_end'].includes(r.kind));
  ok('...and every row describing a run carries that run\'s mode',
     runRows.length > 0 && runRows.every((r) => r.mode === 'turn'),
     `${runRows.length} run rows: ` + JSON.stringify([...new Set(runRows.map((r) => r.mode))]));
  ok('...on a desktop viewport it says desktop', rows.every((r) => r.device === 'desktop'),
     JSON.stringify([...new Set(rows.map((r) => r.device))]));
  ok('...and every row is tied to a device and a session',
     rows.every((r) => r.client_id && r.session_id), 'ids present');
  const oneSession = new Set(rows.map((r) => r.session_id));
  ok('...all in ONE session', oneSession.size === 1, `${oneSession.size} session id(s)`);

  // ---- 3. nothing identifying -------------------------------------------------
  console.log('\n-- what leaves --');
  const strayKeys = [...new Set(rows.flatMap((r) => Object.keys(r)))].filter((k) => !ALLOWED.has(k));
  ok('no field leaves that is not on the whitelist', strayKeys.length === 0, strayKeys.join(', ') || 'clean');
  // The one string a player types is the high-score name, and it must not reach this table.
  const nameish = rows.filter((r) => JSON.stringify(r).toLowerCase().includes('player') && r.kind !== 'boot');
  ok('...and no player-authored text is anywhere in the stream', nameish.length === 0,
     nameish.length ? JSON.stringify(nameish[0]) : 'no names');
  ok('the device class is a bucket, not a measurement',
     ['phone', 'tablet', 'desktop', 'unknown'].includes(await page.evaluate(() => window.__telemetry.device())),
     await page.evaluate(() => window.__telemetry.device()));

  // ---- 4. perf keeps out of the level column ----------------------------------
  const perf = await page.evaluate(() => {
    window.__EV.length = 0;
    window.__telemetry.log('perf', { ms: 91, n: 230, cause: 'ok' });
    return window.__EV[0];
  });
  ok('a perf row carries no level', perf && perf.level === undefined, JSON.stringify(perf));
  ok('...and no turns — its numbers are in ms and n now',
     perf && perf.turns === undefined && perf.ms === 91 && perf.n === 230, JSON.stringify(perf));

  // ---- 5. clamping ------------------------------------------------------------
  const clamped = await page.evaluate(() => {
    window.__EV.length = 0;
    window.__telemetry.log('x'.repeat(60), { detail: 'y'.repeat(90), species: 'z'.repeat(90), ms: -5, n: 1.7 });
    return window.__EV[0];
  });
  ok('a long kind, detail and species are all cut to length',
     clamped.kind.length <= 24 && clamped.detail.length <= 32 && clamped.species.length <= 32,
     `kind ${clamped.kind.length}, detail ${clamped.detail.length}, species ${clamped.species.length}`);
  ok('...a negative duration cannot be sent, and a count is a whole number',
     clamped.ms === 0 && clamped.n === 2, `ms ${clamped.ms}, n ${clamped.n}`);
  await page.context().close();

  // ---- 6. the phone bucket ----------------------------------------------------
  console.log('\n-- a phone --');
  const phone = await openGame('#dev,turn', 390, 844);
  await sleep(1000);
  const prows = await evs(phone);
  ok('a phone viewport reports device=phone', prows.length > 0 && prows.every((r) => r.device === 'phone'),
     JSON.stringify([...new Set(prows.map((r) => r.device))]) + ` over ${prows.length} rows`);
  await phone.context().close();

  // ---- 7. a resumed run is a run ----------------------------------------------
  // The gap that made starts and ends not balance: `run_start` fired only from the picker.
  console.log('\n-- resume --');
  const rpage = await openGame('#dev,turn');
  await sleep(900);
  // A CAMPAIGN run first, so there is something in the campaign resume slot to continue —
  // the picker's own button starts whatever game CONFIG is on, and a `#dev` boot is Survival, so
  // the campaign Continue would have found nothing. `campaign.play` is the test hook and is the
  // right tool for the SETUP; the thing under test is the resume that follows it.
  await rpage.evaluate(async () => {
    document.querySelectorAll('#speciesSelect, #levelIntro, #tutorial').forEach((n) => n.remove());
    window.__game.campaign.play('marasmius', 2);
    await new Promise((r) => setTimeout(r, 800));
  });
  await sleep(900);
  // ...then out to the title and back in through Continue, which is the route a returning player
  // takes. `showTitle` builds the real screen; the button on it is the real handler.
  await rpage.evaluate(() => {
    document.querySelectorAll('#levelIntro, #tutorial').forEach((n) => n.remove());
    window.__game.showTitle();
  });
  await rpage.waitForSelector('#tsContCamp', { timeout: 10000 }).catch(() => {});
  await rpage.evaluate(() => { window.__EV.length = 0; });
  await rpage.click('#tsContCamp', { timeout: 5000 }).catch(() => {});
  // POLL, DON'T GUESS. The title screen's buttons run their consume animation BEFORE calling the
  // handler — measured at ~2.5 s — so a fixed wait reads an empty list and calls it a missing
  // event. Bounded, so a genuinely broken resume still fails rather than hanging.
  await rpage.waitForFunction(() => window.__EV.some((r) => r.kind === 'run_start'), { timeout: 15000 }).catch(() => {});
  const resumed = await evs(rpage);
  const rs = resumed.filter((r) => r.kind === 'run_start');
  ok('continuing a saved run records a run start', rs.length >= 1,
     rs.length ? JSON.stringify(rs.map((r) => r.cause)) : 'none — starts and ends will not balance');
  ok('...marked as a resume rather than a new run', rs.some((r) => r.cause === 'resume'),
     JSON.stringify(rs.map((r) => r.cause)));
  await rpage.context().close();

  // ---- 8. it survives an un-migrated table ------------------------------------
  // The failure this protects against is total: PostgREST rejects the whole row on one unknown
  // column, so a build ahead of its migration would send nothing at all rather than less.
  console.log('\n-- an old table --');
  const ctx2 = await browser.newContext({ viewport: { width: 1200, height: 800 } });
  const p2 = await ctx2.newPage();
  const posted = [];
  // A fake Supabase that 400s anything carrying a v2 column, exactly as PGRST204 does.
  await p2.route('**/rest/v1/events*', async (route) => {
    const body = JSON.parse(route.request().postData() || '{}');
    posted.push(body);
    const v2 = ['source', 'game', 'mode', 'device', 'n', 'ms', 'detail'].some((k) => k in body);
    await route.fulfill({ status: v2 ? 400 : 201, contentType: 'application/json',
      body: v2 ? '{"code":"PGRST204","message":"column not found"}' : '{}' });
  });
  await p2.addInitScript(() => { window.MYCELIUM_SUPABASE = { url: 'https://example.test', anonKey: 'k' }; });
  await p2.goto(base + '/index.html#dev,turn', { waitUntil: 'domcontentloaded' });
  await p2.waitForSelector('#loadscreen.ld-ready', { timeout: 25000 }).catch(() => {});
  await p2.click('#loadscreen', { timeout: 5000 }).catch(() => {});
  await p2.waitForFunction(() => !!window.__telemetry, { timeout: 25000 });
  await p2.evaluate(async () => {
    for (let i = 0; i < 4; i++) { window.__telemetry.log('probe', { level: i + 1, n: i }); await new Promise((r) => setTimeout(r, 120)); }
  });
  await sleep(700);
  const probes = posted.filter((b) => b.kind === 'probe');
  const slim = probes.filter((b) => !('n' in b) && !('game' in b));
  ok('a rejected row is re-sent in the shape the old table has', slim.length >= 1,
     `${probes.length} probe posts, ${slim.length} slim`);
  // ...and it LATCHES, so it is one wasted request per session and not one per event.
  const fat = probes.filter((b) => 'game' in b);
  ok('...and it latches, so later events go straight to the old shape', fat.length <= 2,
     `${fat.length} full-shape posts of ${probes.length}`);
  ok('...and nothing is lost — every event still arrives', slim.length >= 3,
     `${slim.length} of 4 probes landed`);
  await ctx2.close();

  // ---- which STORE a hostname belongs to ------------------------------------
  // The labels the analytics page groups by. Asserted against hostnames rather than by being
  // served from them, which is the only way to cover a store's domain from here at all.
  {
    // ITS OWN PAGE: the first context is closed long before this point, and reusing a dead `page`
    // fails as "Target page, context or browser has been closed" rather than as a real result.
    const cpage = await openGame('#dev,turn');
    const cls = await cpage.evaluate((hosts) => hosts.map((h) => window.__telemetry.classify(h)),
      ['mycelium.game-files.crazygames.com', 'www.crazygames.com', 'games.crazygames.com',
       'uploads.ungrounded.net', 'www.newgrounds.com',
       'html-classic.itch.zone', 'pallkvaran.itch.io',
       'localhost', 'someone-elses-site.example']);
    const [cg1, cg2, cg3, ng1, ng2, it1, it2, dev, other] = cls;
    // EVERY host a store owns must collapse to ONE label. Under the old `web:<host>` fallback each
    // subdomain was its own chip, so a store serving a review build and a live build from different
    // hosts arrived as two unrelated rows — which is the failure this is guarding.
    ok('every CrazyGames host is one label', cg1 === 'crazygames' && cg2 === 'crazygames' && cg3 === 'crazygames',
       cls.slice(0, 3).join(', '));
    ok('every Newgrounds host is one label', ng1 === 'newgrounds' && ng2 === 'newgrounds',
       cls.slice(3, 5).join(', '));
    ok('itch is unchanged', it1 === 'itch' && it2 === 'itch', cls.slice(5, 7).join(', '));
    ok('local boots stay out of the store numbers', dev === 'dev', String(dev));
    // An unknown host keeps its NAME rather than becoming 'other', so it can be seen and classified
    // later instead of vanishing into a bucket.
    ok('an unknown host is still named, not bucketed', /^web:/.test(other), String(other));
    await cpage.context().close();
  }

  console.log(`\n==== ${pass} passed, ${fail} failed ====`);
  await browser.close(); srv.close();
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('HARNESS ERROR', e); process.exit(1); });
