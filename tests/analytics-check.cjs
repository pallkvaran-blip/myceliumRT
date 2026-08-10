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
  const push = (t, o) => rows.push(Object.assign({ id: ++id, created_at: new Date(t).toISOString(),
    source: 'itch', game: 'campaign', mode: 'turn' }, o));
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
  return { rows, boots, starts, clears1, devices, oldSessions, campStarts, campClears1, untagged };
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
  ok('players is the distinct-device count', kv('players') === String(F.devices), `${kv('players')} (want ${F.devices})`);
  ok('runs started matches the fixture', kv('runs started') === String(F.starts), `${kv('runs started')} of ${F.starts}`);
  ok('runs ended matches the fixture', kv('runs ended') === String(F.starts), `${kv('runs ended')}`);

  // HOW FAR PEOPLE GET — the headline table.
  const lvl1 = await page.$$eval('#body table tr', (trs) => {
    for (const tr of trs) if (tr.children[0] && tr.children[0].textContent === 'Level 1')
      return [...tr.children].map((td) => td.textContent.trim());
    return null;
  });
  // A PRE-v2 ROW IS NOT ATTRIBUTABLE TO A GAME, so this table is smaller than "runs started" above
  // it and that is correct rather than a leak. Asserted against the campaign-only counters, with
  // the gap itself pinned below so the two can never silently converge.
  ok('the campaign table reports level 1 attempts and clears',
     lvl1 && lvl1[1] === String(F.campStarts) && lvl1[2] === String(F.campClears1),
     lvl1 ? lvl1.slice(0, 4).join(' | ') : '(no Level 1 row)');
  ok('...and it excludes pre-v2 rows, which name no game',
     F.starts - F.campStarts === F.oldSessions, `${F.starts} runs, ${F.campStarts} attributable`);
  // Scoped to the CAMPAIGN table — the retries table also has "Level N" rows, so a loose count
  // over the whole page passed at 10 for a 9-level campaign and would have kept passing at 20.
  const levelRows = await page.evaluate(() => {
    const t = [...document.querySelectorAll('#body table')].find((x) => /clear rate/i.test(x.tHead.textContent));
    return t ? [...t.tBodies[0].rows].filter((r) => /^Level \d+$/.test(r.children[0].textContent)).length : -1;
  });
  ok('...with exactly one row per campaign level', levelRows === want, `${levelRows} rows, campaign is ${want}`);

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

  // Filters narrow, and the default keeps dev traffic out of a launch number.
  const before = await page.$$eval('.kpi .v', (v) => v[0].textContent);
  await page.click('.chip[data-f="device"][data-v="phone"]');
  await sleep(300);
  const after = await page.$$eval('.kpi .v', (v) => v[0].textContent);
  ok('a device filter narrows the numbers', +after < +before, `${before} players → ${after} on phone`);
  const srcOn = await page.$eval('.chip[data-f="source"].on', (b) => b.textContent);
  ok('...and Source defaults to itch, so dev boots stay out of a launch number', srcOn === 'itch', srcOn);

  // ---- before vs after the update ---------------------------------------------
  // THE TWO SIDES MUST PARTITION THE TABLE. Asserting only that "after update" narrows would pass
  // on a filter that drops rows it should keep — the sum is what says every row landed on exactly
  // one side of the launch. Window goes to `all` first: a 30d window would clip whichever side of
  // the launch happens to fall outside it and the sum would be a coincidence.
  const runsWith = async (build) => {
    await page.click(`.chip[data-f="build"][data-v="${build}"]`);
    await sleep(300);
    return +(await page.$$eval('.kpi', (ks) => {
      const k = ks.find((x) => x.querySelector('.k').textContent === 'runs started');
      return k ? k.querySelector('.v').textContent : '0';
    }));
  };
  await page.click('.chip[data-f="device"][data-v=""]');           // undo the phone filter above
  await page.click('.chip[data-f="days"][data-v="0"]');
  await sleep(300);
  const rAll = await runsWith('');
  const rNew = await runsWith('new');
  const rOld = await runsWith('old');
  ok('before/after the update partition the table', rNew + rOld === rAll && rAll > 0,
     `${rNew} after + ${rOld} before = ${rNew + rOld}, all = ${rAll}`);
  ok('...and each side is non-empty, so neither chip is a no-op', rNew > 0 && rOld > 0,
     `after ${rNew}, before ${rOld}`);
  // The build stamp is the COLUMN SET, not a date — a pre-v2 row is exactly one with no `game`.
  ok('...and "before update" is the pre-v2 sessions, counted from the fixture',
     rOld === F.oldSessions, `${rOld} of ${F.oldSessions}`);
  await page.click('.chip[data-f="build"][data-v=""]');
  await sleep(300);

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
    const kAsked = await kpiOf('asked the question');
    const kBack = await kpiOf('came back');
    ok('every player is counted', kPlayers && kPlayers.v === '5', kPlayers && kPlayers.v);
    // THE DENOMINATOR RULE. P1 arrived two hours ago and has not failed to return — they have not
    // been asked. Counting them would print 40% where the truth is 50%, and right after a launch
    // that error is much larger, because almost everyone is brand new.
    ok('...but only those who have had a day to come back are asked',
       kAsked && kAsked.v === '4', kAsked && kAsked.v);
    ok('...and the return rate is over THAT denominator',
       kBack && kBack.v === '50%', kBack && (kBack.v + ' — ' + kBack.note));
    // P4's three events five minutes apart are one visit. Counting sessions instead of visits would
    // call that a returning player and print 75%.
    ok('...with a reload counted as one visit, not as coming back',
       kBack && /2 of 4/.test(kBack.note), kBack && kBack.note);
    ok('no page errors in the retention section', rerrs.length === 0, rerrs.slice(0, 2).join(' | '));
    await rp.close();
  }

  console.log(`\n==== ${pass} passed, ${fail} failed ====`);
  await browser.close(); srv.close();
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('HARNESS ERROR', e); process.exit(1); });
