/* THE RELEASE GATE: unzip dist/mycelium-itch.zip and play the file that will actually be uploaded.
 *
 *   node scripts/make-itch-zip.mjs && node tests/itchzip-check.cjs
 *
 * Every other check in this directory runs against the working tree. This one runs against the
 * ARTEFACT, which is the only thing that can catch a build-step mistake: the dev flag not patched,
 * an asset missed by the copy, the html one folder down (itch then serves a directory listing), a
 * manifest entry whose file was never added.
 *
 * NOT IN THE RUNNER — it needs a zip that exists, and building one is a minute of copying 2,400
 * files. Run it by hand as part of a release cut.
 *
 * What it asserts, in the order the mistakes are easy to make:
 *   1. the zip's SHAPE (index.html at the root, nothing but it and assets/)
 *   2. NO DEV BUTTONS anywhere on the screens that carry them — the one thing the owner's notes
 *      call out by name, and invisible from the outside once it is wrong
 *   3. ...while `window.__game` still exists, because that hook is deliberately kept in a public
 *      build and a blunter "strip the dev stuff" would take it
 *   4. it BOOTS AND PLAYS: title -> campaign -> a level with a live colony, and the same for
 *      survival, with no page errors and no failed requests along the way
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync } = require('child_process');
const { chromium } = require('playwright');

const ROOT = path.resolve(__dirname, '..');
// Which artefact to check. There are two targets now (itch and crazygames), and a gate that can
// only ever look at one of them is a gate the other ships around.
//   node tests/itchzip-check.cjs                     -> dist/mycelium-itch.zip
//   node tests/itchzip-check.cjs crazygames          -> dist/mycelium-crazygames.zip
const PLATFORM = (process.argv[2] || 'itch').toLowerCase();
const ZIP = path.join(ROOT, 'dist', `mycelium-${PLATFORM}.zip`);
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.svg': 'image/svg+xml',
  '.webp': 'image/webp', '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.css': 'text/css' };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let pass = 0, fail = 0;
const ok = (n, c, x) => { c ? (pass++, console.log('  PASS  ' + n + (x ? '  — ' + x : '')))
                            : (fail++, console.log('  FAIL  ' + n + (x ? '  — ' + x : ''))); };

(async () => {
  if (!fs.existsSync(ZIP)) {
    console.log('  FAIL  the zip exists — run: node scripts/make-itch-zip.mjs');
    console.log('\n==== 0 passed, 1 failed ====');
    process.exit(1);
  }

  // ---- 1. the shape ---------------------------------------------------------
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'itchzip-'));
  execFileSync('unzip', ['-q', ZIP, '-d', dir]);
  const entries = execFileSync('unzip', ['-Z1', ZIP], { encoding: 'utf8' })
    .split('\n').map((l) => l.trim()).filter(Boolean);
  const top = [...new Set(entries.map((e) => e.split('/')[0]))].sort();
  ok('index.html is at the zip ROOT', entries.includes('index.html'),
     'otherwise itch serves a directory listing instead of the game');
  ok('...and the zip holds nothing but index.html and assets/',
     top.length === 2 && top[0] === 'assets' && top[1] === 'index.html', top.join(', '));
  // NOT A ZIP OF A ZIP. itch reports this as "Failed to find index.html" and says nothing about
  // the cause, and the way you get one is not by building it wrong: GitHub Actions zips an
  // artifact's CONTENTS on download, so an artifact holding the .zip comes back double-wrapped.
  // Reported from a real upload. The build is uploaded as the STAGE now so both routes are flat,
  // and this refuses anything nested whatever produced it.
  ok('...and is not a zip of a zip', !entries.some((e) => /\.zip$/i.test(e)),
     entries.filter((e) => /\.zip$/i.test(e)).join(', ') || 'no nested archives');
  // THE ONE THING THE TWO ZIPS MUST DIFFER ON, asserted in both directions. An itch build that
  // loads the SDK makes a cross-origin request that can only fail there; a CrazyGames build
  // WITHOUT it is the exact submission failure this target exists to fix, and both look identical
  // from outside.
  const builtHtml = fs.readFileSync(path.join(dir, 'index.html'), 'utf8');
  const loadsSdk = /<script[^>]*sdk\.crazygames\.com/.test(builtHtml);
  ok(PLATFORM === 'crazygames' ? 'the CrazyGames build LOADS the SDK'
                               : 'the itch build does NOT load the SDK',
     loadsSdk === (PLATFORM === 'crazygames'), `script tag present: ${loadsSdk}`);

  // ---- 1b. THE PRUNE DID NOT CUT ANYTHING THE GAME CAN REACH ----------------
  // The build ships only the asset folders a public build can load, because itch caps an HTML5 zip
  // at 1,000 entries and the full tree is 2,450. That prune is the one step here that can silently
  // break a map the player CAN open — and playing two levels below would never see it, since a
  // missing sprite on level 14 is invisible from level 1. So it is checked statically, over every
  // level the build claims to ship: the folder is present, it has sprites in it, and every manifest
  // entry points at a file that is actually in the zip.
  {
    const inZip = new Set(entries);
    const levelsDir = path.join(ROOT, 'docs', 'levels');
    const want = [];
    for (const f of fs.readdirSync(levelsDir).filter((n) => n.endsWith('.json'))) {
      const def = JSON.parse(fs.readFileSync(path.join(levelsDir, f), 'utf8'));
      if (def.campaignLevel || def.survival) want.push({ id: def.id, from: def.assetsFrom || def.id });
    }
    const missing = want.filter((w) => !entries.some((e) => e.startsWith('assets/' + w.from + '/')));
    ok(`every reachable level's art is in the zip (${want.length} levels)`,
       missing.length === 0, missing.map((m) => m.id).join(', '));
    // ...and the manifest agrees with it. A `kind: 'level'` entry whose file is absent 404s the
    // moment that map is opened — the exact failure the manifest note in CLAUDE.md is about.
    const mf = JSON.parse(fs.readFileSync(path.join(dir, 'assets', 'manifest.json'), 'utf8'));
    const dangling = mf.assets.filter((a) => !inZip.has('assets/' + a.file));
    ok('every manifest entry points at a file that is in the zip',
       dangling.length === 0,
       `${mf.assets.length} entries, ${dangling.length} dangling` +
       (dangling.length ? ': ' + dangling.slice(0, 3).map((d) => d.file).join(', ') : ''));
  }

  // ---- serve the UNZIPPED tree, so this is the uploaded bytes ---------------
  const srv = await new Promise((res) => {
    const s = http.createServer((rq, rs) => {
      let p = decodeURIComponent(rq.url.split('?')[0].split('#')[0]);
      if (p === '/') p = '/index.html';
      const fp = path.join(dir, p);
      if (!fp.startsWith(dir) || !fs.existsSync(fp) || fs.statSync(fp).isDirectory()) {
        rs.writeHead(404); rs.end('nf'); return;
      }
      rs.writeHead(200, { 'Content-Type': TYPES[path.extname(fp)] || 'application/octet-stream' });
      fs.createReadStream(fp).pipe(rs);
    });
    s.listen(0, () => res(s));
  });
  const base = 'http://localhost:' + srv.address().port;
  const browser = await chromium.launch({ headless: true, executablePath: '/opt/pw-browsers/chromium' });
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });   // itch's viewport
  const errs = [];
  page.on('pageerror', (e) => errs.push('pageerror:' + String(e && e.message)));
  page.on('console', (m) => {
    if (m.type() !== 'error') return;
    // The browser logs the blocked SDK fetch as a console error too. Its TEXT is only
    // "Failed to load resource: net::ERR_CONNECTION_RESET" — no URL — so the filter has to read
    // `location().url`. Matching on the text was the obvious version and let it through.
    const at = (m.location() && m.location().url) || '';
    if (/sdk\.crazygames\.com/.test(at)) return;
    errs.push('console:' + m.text() + (at ? ' @ ' + at.slice(-40) : ''));
  });
  // A request ABORTED by navigation is not a missing asset. The audio tracks stream, so reloading
  // between the two games kills whichever one was still in flight and Chromium reports it as a
  // failure — `backrooms-vol29.mp3` read as a missing file on a build that has it. Anything else
  // still counts, since a genuinely absent asset is the defect only the artefact can show.
  // THE SDK'S OWN REQUEST IS EXPECTED TO FAIL HERE, and its failing is the point. The CrazyGames
  // build loads the SDK from their CDN, which this sandbox cannot reach — and everything below
  // still passes, which is the whole design: the game must not care whether the SDK is there.
  // Counted separately so it can be ASSERTED rather than merely tolerated.
  let sdkBlocked = 0;
  page.on('requestfailed', (r) => {
    const why = (r.failure() && r.failure().errorText) || '';
    if (/ERR_ABORTED/.test(why)) return;                    // aborted by navigation, not missing
    if (/sdk\.crazygames\.com/.test(r.url())) { sdkBlocked++; return; }
    errs.push('reqfail:' + why + ':' + r.url().slice(-50));
  });
  page.on('response', (r) => { if (r.status() >= 400) errs.push('http' + r.status() + ':' + r.url().slice(-60)); });
  // A public build must never be able to write to the live board from a test.
  await page.addInitScript(() => { window.MYCELIUM_SUPABASE = { url: '', anonKey: '' }; });

  try {
    // ---- 2/3. boots, no dev buttons, hook intact ----------------------------
    await page.goto(base + '/', { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('#loadscreen.ld-ready', { timeout: 60000 }).catch(() => {});
    await page.click('#loadscreen', { timeout: 8000 }).catch(() => {});
    const booted = await page.waitForFunction(() => !!(window.__game || document.getElementById('titleScreen')),
      null, { timeout: 60000 }).then(() => true).catch(() => false);
    ok('the zipped build boots to the title screen', booted && !!(await page.$('#titleScreen')));
    // THE HOOK STAYS. The owner's note is explicit that `window.__game` survives a public cut —
    // it is invisible, it is how a bug gets diagnosed on the live build, and a blunter
    // "strip the dev stuff" would remove it along with the buttons.
    ok('...and window.__cfg still exists (the invisible hook is kept on purpose)',
       await page.evaluate(() => !!window.__cfg));
    ok('...with dev.enabled FALSE', await page.evaluate(() => window.__cfg.dev.enabled === false),
       String(await page.evaluate(() => window.__cfg && window.__cfg.dev.enabled)));

    // Every screen that carries a dev control, checked by ID. Asserting the FLAG alone would pass
    // on a build whose buttons had stopped reading it.
    const DEV_IDS = ['#devWin', '#ssDevSpores', '#ssDevStart', '#ssDevUnlock', '#devEditRocks',
                     '#devMaps', '#devMapPanel', '#rockEditBar'];
    const devOnTitle = await page.evaluate((ids) => ids.filter((i) => !!document.querySelector(i)), DEV_IDS);
    ok('no dev buttons on the title screen', devOnTitle.length === 0, devOnTitle.join(', '));

    // ---- 4. it PLAYS: campaign, then survival ------------------------------
    for (const [row, label] of [['#tsNewCamp', 'campaign'], ['#tsNew', 'survival']]) {
      await page.evaluate(() => {
        document.querySelectorAll('#levelIntro, #speciesSelect, #tutorial, #ssGameWon').forEach((n) => n.remove());
      });
      // Back to the title between the two games. There is no `showTitle` hook, so RELOAD — which is
      // also more honest for a release gate: the second game is played from a cold boot of the same
      // artefact, exactly as a player would arrive at it.
      if (!(await page.$('#titleScreen'))) {
        await page.goto(base + '/', { waitUntil: 'domcontentloaded' });
        await page.waitForSelector('#loadscreen.ld-ready', { timeout: 60000 }).catch(() => {});
        await page.click('#loadscreen', { timeout: 8000 }).catch(() => {});
        await page.waitForSelector('#titleScreen', { timeout: 60000 }).catch(() => {});
      }
      const clicked = await page.click(row, { timeout: 8000 }).then(() => true).catch(() => false);
      ok(`${label}: the title row is there and clickable`, clicked);
      if (!clicked) continue;
      // Name dialog -> picker. Both are real screens on this path; drive them the way a player does.
      // The ids are `tsNameInput` / `tsNameStart` — guessed wrong first time (`#ngName`/`#ngGo`),
      // which presents as "never reaches the picker" rather than as a bad selector.
      await sleep(600);
      const nameBox = await page.$('#tsNameInput');
      if (nameBox) { await nameBox.fill('Cut'); await page.click('#tsNameStart', { timeout: 5000 }).catch(() => {}); }
      // THE CAMPAIGN PUTS ITS OPENING BETWEEN New AND THE PICKER, so this waits for EITHER and
      // clicks the opening away when it is the one that turned up. The first version clicked
      // `.li-story` immediately, found nothing because the screen had not been built yet, gave up,
      // and then waited 30 s for a picker sitting behind an overlay — reported as "campaign never
      // reaches the species selection screen", which is a real-sounding bug that did not exist.
      let gotPicker = false;
      for (let i = 0; i < 60; i++) {
        gotPicker = await page.evaluate(() => {
          if (document.getElementById('speciesSelect')) return true;
          const st = document.querySelector('.li-story');
          if (st) st.click();
          return false;
        });
        if (gotPicker) break;
        await sleep(500);
      }
      ok(`${label}: reaches the species selection screen`, gotPicker);
      if (!gotPicker) continue;
      const devOnPicker = await page.evaluate((ids) => ids.filter((i) => !!document.querySelector(i)), DEV_IDS);
      ok(`${label}: no dev buttons on the selection screen`, devOnPicker.length === 0, devOnPicker.join(', '));
      // Start a run on the first available colony.
      await page.evaluate(() => { const b = document.querySelector('#ssAvail .ss-selbtn'); if (b) b.click(); });
      // The level card is NOT skipped in a public build (that skip is dev-gated), so click it away.
      for (let i = 0; i < 25 && !(await page.$('#game')); i++) await sleep(400);
      // DISPATCHED, not `page.click`. The overlay sits over a full-screen <canvas id="game">, and
      // Playwright's actionability checks refuse a click it believes the canvas intercepts — then
      // the node detaches mid-retry and it throws out of the whole block. A dispatched click is
      // what the overlay's own listener receives either way.
      for (let i = 0; i < 12; i++) {
        const gone = await page.evaluate(() => {
          const n = document.getElementById('levelIntro');
          if (!n) return true;
          n.click();
          return false;
        });
        if (gone) break;
        await sleep(600);
      }
      const live = await page.waitForFunction(() => {
        const s = window.__game && window.__game.state;
        return !!(s && s.active && s.active.nodes && s.active.nodes.length > 0);
      }, null, { timeout: 40000 }).then(() => true).catch(() => false);
      ok(`${label}: a level builds and the colony is alive`, live,
         await page.evaluate(() => { const s = window.__game && window.__game.state;
           return s && s.active ? s.active.nodes.length + ' strand(s)' : 'no state'; }));
      const devInGame = await page.evaluate((ids) => ids.filter((i) => !!document.querySelector(i)), DEV_IDS);
      ok(`${label}: no dev buttons in the running game`, devInGame.length === 0, devInGame.join(', '));
      await page.screenshot({ path: path.join(__dirname, '.artifacts', `itchzip-${label}.png`),
        animations: 'disabled', timeout: 8000 }).catch(() => {});
    }

    // Asset failures matter MORE here than in any other check: the tree has every file, so a
    // missing one only ever shows up in the artefact.
    ok('no page errors or failed requests in the whole run', errs.length === 0,
       errs.slice(0, 4).join(' | '));
    // ...AND, ON THE CRAZYGAMES BUILD, THAT IT SURVIVED THE SDK BEING UNREACHABLE. Everything
    // above — booting, both games, a live colony — happened with the SDK script failing to load
    // outright, which is the strongest available evidence that the guards hold. It is also a real
    // scenario: their CDN can be blocked by an extension or a corporate network, and the game
    // going down with it would be a far worse bug than the one the SDK was added to fix.
    if (PLATFORM === 'crazygames') {
      ok('...and the build played through with the SDK unreachable', sdkBlocked > 0,
         `${sdkBlocked} blocked SDK request(s) — if this is 0 the CDN was reachable and the ` +
         'resilience was not exercised, which is fine but proves less');
    }
  } catch (e) {
    fail++; console.log('  HARNESS ERROR — ' + (e && e.stack || e));
  }

  await browser.close(); srv.close();
  fs.rmSync(dir, { recursive: true, force: true });
  console.log(`\n==== ${pass} passed, ${fail} failed ====`);
  process.exit(fail ? 1 : 0);
})();
