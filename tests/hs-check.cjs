/* High scores split by game mode: one table, a tab per game. */
const http = require('http'); const fs = require('fs'); const path = require('path');
const { chromium } = require('playwright');
const ROOT = path.resolve(__dirname, '..');   // the repo root — served as-is
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
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const errs = []; page.on('pageerror', (e) => errs.push(String(e && e.message)));
  page.on('console', (m) => { if (m.type() === 'error') errs.push('console:' + m.text()); });
  // Disable the global backend so this test never touches (or reads from) the live table:
  // the LOCAL board is the thing under test.
  await page.addInitScript(() => { window.MYCELIUM_SUPABASE = { url: '', anonKey: '' }; });
  await page.goto(base + '/index.html#dev', { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#loadscreen.ld-ready', { timeout: 20000 }).catch(() => {});
  await page.click('#loadscreen', { timeout: 5000 }).catch(() => {});
  await page.waitForFunction(() => window.__game && window.__game.state && window.__game.state.active, null, { timeout: 20000 });
  for (let i = 0; i < 4 && await page.$('#levelIntro'); i++) { await page.mouse.click(640, 400); await sleep(1200); }

  // ---- the store keeps two ladders -----------------------------------------
  const store = await page.evaluate(() => {
    const hs = window.__game.scores;
    localStorage.removeItem('mycelium.highscores.v1');
    // A legacy entry with NO mode (written before the game shipped two modes).
    localStorage.setItem('mycelium.highscores.v1', JSON.stringify({ entries: [
      { name: 'Legacy', level: 9, species: 'a', speciesName: 'Alpha', ts: Date.now() - 1000 },
    ] }));
    hs.recordScore({ name: 'Turnip', level: 4, species: 'a', speciesName: 'Alpha', mode: 'turn' });
    hs.recordScore({ name: 'Racer', level: 7, species: 'b', speciesName: 'Beta', mode: 'realtime' });
    return {
      turn: hs.allTimeBoard('turn').map((e) => e.name + ':' + e.level),
      rt: hs.allTimeBoard('realtime').map((e) => e.name + ':' + e.level),
      qTurn5: hs.qualifies(5, 'turn'), qRt5: hs.qualifies(5, 'realtime'),
    };
  });
  ok('turn-based board holds its own scores', store.turn.join(',') === 'Legacy:9,Turnip:4', store.turn.join(','));
  ok('legacy entries (no mode) read as turn-based', store.turn.includes('Legacy:9'), store.turn.join(','));
  ok('real-time board holds only real-time scores', store.rt.join(',') === 'Racer:7', store.rt.join(','));
  ok('the two ladders do not leak into each other',
     !store.turn.includes('Racer:7') && !store.rt.includes('Turnip:4'), `turn=[${store.turn}] rt=[${store.rt}]`);
  ok('qualifying is judged per mode', store.qTurn5 === true && store.qRt5 === true,
     `turn=${store.qTurn5} rt=${store.qRt5}`);

  // A full board in one mode must not block a modest score in the other.
  const isolated = await page.evaluate(() => {
    const hs = window.__game.scores;
    localStorage.removeItem('mycelium.highscores.v1');
    for (let i = 0; i < 12; i++) hs.recordScore({ name: 'T' + i, level: 20 + i, species: 'a', speciesName: 'Alpha', mode: 'turn' });
    return { fullTurn: hs.allTimeBoard('turn').length, emptyRt: hs.allTimeBoard('realtime').length,
             qTurn: hs.qualifies(3, 'turn'), qRt: hs.qualifies(3, 'realtime') };
  });
  ok('a packed turn-based top 10 does not gate the real-time board',
     isolated.qTurn === false && isolated.qRt === true,
     `turn board ${isolated.fullTurn}, rt board ${isolated.emptyRt}, qualifies(3): turn=${isolated.qTurn} rt=${isolated.qRt}`);

  // ---- the overlay: one table, and the board still splits by game ----------
  //
  // THE GAME TABS ARE GONE from the overlay while `OFFER_REALTIME` is off (owner): with real
  // time withheld there is one ladder, so a tab row is a control that cannot be used and a
  // "Real time" tab names a game with no way in. What must NOT have changed is the DATA — the
  // boards are still stored and read per mode, and `showHighScores({mode})` still opens on the
  // one it is asked for. So every assertion below that used to click a tab now re-OPENS the
  // overlay on the other mode: same question, asked through the surviving door.
  await page.evaluate(() => {
    const hs = window.__game.scores;
    localStorage.removeItem('mycelium.highscores.v1');
    hs.recordScore({ name: 'Turnip', level: 4, species: 'a', speciesName: 'Alpha', mode: 'turn' });
    hs.recordScore({ name: 'Racer', level: 7, species: 'b', speciesName: 'Beta', mode: 'realtime' });
  });
  await page.evaluate(() => window.__game.showHighScores({ mode: 'realtime' }));
  await sleep(700);
  const ui = await page.evaluate(() => {
    const periodTabs = [...document.querySelectorAll('#hsOverlay .hs-periods .hs-plink')].map((b) => b.textContent);
    const nt = document.querySelector('#hsOverlay .hs-note');
    return { modeRows: document.querySelectorAll('#hsOverlay .hs-modes').length,
             modeTabs: document.querySelectorAll('#hsOverlay .hs-modes .hs-tab').length,
             rtTab: !!document.getElementById('hsTabRt'),
             periodTabs,
             periodPills: document.querySelectorAll('#hsOverlay .hs-periods .hs-tab').length,
             note: nt ? nt.textContent : null, noteShown: nt ? getComputedStyle(nt).display : null,
             tables: document.querySelectorAll('#hsOverlay .hs-table').length,
             rows: [...document.querySelectorAll('#hsOverlay .hs-row .hs-name')].map((n) => n.textContent) };
  });
  ok('there is no game tab row — one game is offered, so there is nothing to switch between',
     ui.modeRows === 0 && ui.modeTabs === 0, `${ui.modeRows} row(s), ${ui.modeTabs} tab(s)`);
  ok('...and nothing names a game with no way in', ui.rtTab === false);
  ok('Monthly / All-Time are plain clickable text, not pills', ui.periodTabs.join(' | ') === 'Monthly | All-Time' && ui.periodPills === 0,
     `${ui.periodTabs.join(' | ')}; ${ui.periodPills} pill(s)`);
  ok('the "Global" line does not take up space', ui.note === '' && ui.noteShown === 'none', `note="${ui.note}" display=${ui.noteShown}`);
  ok('ONE table, not two', ui.tables === 1, `${ui.tables} table(s)`);
  // The ROWS are how "which ladder is showing" is read now. This is the assertion that keeps
  // the two boards genuinely separate with the tabs gone — the RT entry is still there, still
  // its own ladder, and still reachable by asking for it.
  ok('it opens on the mode it was asked for', ui.rows.join(',') === 'Racer', ui.rows.join(','));

  // With no mode asked for, it opens on TURN-BASED.
  await page.evaluate(() => { const o = document.getElementById('hsOverlay'); if (o) o.remove(); });
  await page.evaluate(() => window.__game.showHighScores({}));
  await sleep(600);
  const dflt = await page.evaluate(() => ({
    rows: [...document.querySelectorAll('#hsOverlay .hs-row .hs-name')].map((n) => n.textContent),
    tables: document.querySelectorAll('#hsOverlay .hs-table').length,
    headers: [...document.querySelectorAll('#hsOverlay .hs-table th')].map((h) => h.textContent),
  }));
  ok('the default view is turn-based', dflt.rows.join(',') === 'Turnip', `rows=[${dflt.rows}]`);
  ok('...in the same single table', dflt.tables === 1, `${dflt.tables} table(s)`);
  ok('the columns are unchanged', dflt.headers.join('|') === '|Name|Lvl|Species', dflt.headers.join('|'));

  // The period tabs still work within the selected game.
  await page.click('#hsTabAll'); await sleep(300);
  const afterAll = await page.evaluate(() => ({
    rows: [...document.querySelectorAll('#hsOverlay .hs-row .hs-name')].map((n) => n.textContent),
    onPeriod: (document.querySelector('#hsOverlay .hs-periods .hs-plink.hs-on') || {}).textContent,
  }));
  ok('All-Time works within the chosen game', afterAll.onPeriod === 'All-Time' && afterAll.rows.join(',') === 'Turnip',
     `${afterAll.onPeriod}: ${afterAll.rows.join(',')}`);

  // ---- a run records against the mode it was played in ---------------------
  await page.evaluate(() => { const o = document.getElementById('hsOverlay'); if (o) o.remove(); });
  const recorded = await page.evaluate(async () => {
    const hs = window.__game.scores, rhs = window.__game.scoresUi;
    localStorage.removeItem('mycelium.highscores.v1');
    const ctx = await rhs.checkHighScore({ level: 5, species: 'b', speciesName: 'Beta', mode: 'realtime' });
    if (ctx) await rhs.recordHighScore({ name: 'RTRun', level: ctx.level, species: ctx.species,
      speciesName: ctx.speciesName, mode: ctx.mode, isGlobal: ctx.isGlobal });
    return { mode: ctx && ctx.mode,
             rt: hs.allTimeBoard('realtime').map((e) => e.name),
             turn: hs.allTimeBoard('turn').map((e) => e.name) };
  });
  ok('a real-time run is stamped real-time', recorded.mode === 'realtime', `mode=${recorded.mode}`);
  ok('...and lands on the real-time board only',
     recorded.rt.join(',') === 'RTRun' && recorded.turn.length === 0,
     `rt=[${recorded.rt}] turn=[${recorded.turn}]`);

  ok('no page errors', errs.length === 0, errs.slice(0, 3).join(' | '));
  await page.screenshot({ path: path.join(__dirname, '.artifacts', 'hs.png') });
  console.log(`\n==== ${pass} passed, ${fail} failed ====`);
  await browser.close(); srv.close();
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('HARNESS ERROR', e); process.exit(2); });
