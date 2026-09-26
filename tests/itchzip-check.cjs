/* THE RELEASE GATE: unzip dist/mycelium-itch.zip and play the file that will actually be uploaded.
 *
 *   node scripts/make-itch-zip.mjs && node tests/itchzip-check.cjs
 *
 * Every other check in this directory runs against the working tree. This one runs against the
 * ARTEFACT, which is the only thing that can catch a build-step mistake: the dev flag not patched,
 * an asset missed by the copy, the html one folder down (itch then serves a directory listing), a
 * manifest entry whose file was never added.
 *
 * IN THE RUNNER as 'zip' (finishing plan M2), called with `--fresh`: it builds a throwaway
 * `--no-shrink` zip of the working tree (about 2 s) and checks that. By hand, with no flag, it checks
 * the release zip in dist/ that will actually be uploaded.
 *
 * What it asserts, in the order the mistakes are easy to make:
 *   1. the zip's SHAPE (index.html at the root, nothing but it and assets/)
 *   1b. the prune kept every reachable level's art AND every mine band's folder, whole
 *   2. NO DEV BUTTONS anywhere on the screens that carry them — the one thing the owner's notes
 *      call out by name, and invisible from the outside once it is wrong
 *   3. ...while `window.__cfg` / `window.__game` still exist, because those hooks are deliberately
 *      kept in a public build and a blunter "strip the dev stuff" would take them
 *   4. it PLAYS THE MINE: title -> New -> a navigator descent on the real tank -> the end screen ->
 *      the store -> Descend -> run 2, with the band rock collided (`_fineSolid`), the campaign's
 *      level card never shown, and no page errors or failed requests along the way
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync } = require('child_process');
const { chromium } = require('playwright');

const ROOT = path.resolve(__dirname, '..');
// Does this build offer survival at all? The one constant that decides it lives in index.html.
const OFFERS_SURVIVAL = (() => {
  const m = /\bconst OFFER_SURVIVAL = (true|false);/.exec(fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8'));
  if (!m) throw new Error('could not find `const OFFER_SURVIVAL = <bool>;` in index.html');
  return m[1] === 'true';
})();
// Which artefact to check. There are two targets now (itch and crazygames), and a gate that can
// only ever look at one of them is a gate the other ships around.
//   node tests/itchzip-check.cjs                     -> dist/mycelium-itch.zip
//   node tests/itchzip-check.cjs crazygames          -> dist/mycelium-crazygames.zip
const ARGS = process.argv.slice(2);
const PLATFORM = (ARGS.find((a) => !a.startsWith('--')) || 'itch').toLowerCase();
// `--fresh` (how the runner calls it, as 'zip'): build a THROWAWAY zip of the working tree first —
// `make-web-zip --no-shrink --out <tmp>` — and check that. Same prune, same dev-flag patch, same
// manifest filter; only the re-encode is skipped (it changes bytes, not which files ship), and a
// release zip already in dist/ is never overwritten by a test build.
const FRESH = ARGS.includes('--fresh');
let ZIP = path.join(ROOT, 'dist', `mycelium-${PLATFORM}.zip`);
if (FRESH) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'zipbuild-'));
  ZIP = path.join(tmp, `mycelium-${PLATFORM}.zip`);
  execFileSync(process.execPath, [path.join(ROOT, 'scripts', 'make-web-zip.mjs'), '--platform', PLATFORM,
    '--no-shrink', '--out', ZIP], { stdio: 'inherit' });
}
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
      // Survival's maps ship only while survival is OFFERED — the build prunes them otherwise, so
      // asking for them here would fail a correct build. Read from index.html for the same reason
      // the build does: one constant restores the mode, and this must follow it.
      if (def.campaignLevel || (OFFERS_SURVIVAL && def.survival)) want.push({ id: def.id, from: def.assetsFrom || def.id });
    }
    // THE MINE'S BANDS are not level files: their folders are named in CONFIG.mine.bands[].assetsFrom.
    // Each must ship WHOLE — a folder with some sprites missing is a band with holes in its walls.
    {
      const html0 = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
      const at = html0.indexOf('\n  mine: {'), b0 = html0.indexOf('\n    bands: [', at), b1 = html0.indexOf('\n    ],', b0);
      const bands = [...html0.slice(b0, b1).matchAll(/assetsFrom:\s*'([^']+)'/g)].map((m) => m[1]);
      const short = bands.map((f) => {
        const src = fs.readdirSync(path.join(ROOT, 'assets', f)).length;
        const got = entries.filter((e) => e.startsWith('assets/' + f + '/')).length;
        return { f, src, got };
      });
      ok(`every mine band's folder ships whole (${bands.length} bands)`,
         bands.length === 4 && short.every((x) => x.got === x.src && x.src > 0),
         short.map((x) => `${x.f} ${x.got}/${x.src}`).join(', '));
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
    // Watch for the campaign's level card for the WHOLE session: it must never show on a mine run.
    await page.addInitScript(() => {
      window.__sawLevelIntro = 0;
      const look = () => {
        const n = document.getElementById('levelIntro');
        if (n && n.getBoundingClientRect().height > 0 && getComputedStyle(n).display !== 'none') window.__sawLevelIntro++;
      };
      setInterval(look, 50);
      // run_start rows, tapped from the moment the telemetry module exists: a FIRST VISIT (M4) starts
      // run 1 from the gate tap itself, so a tap installed after the gate would miss it.
      window.__rs = [];
      const hook = setInterval(() => { if (window.__telemetry && window.__telemetry.tap) {
        clearInterval(hook); window.__telemetry.tap((row) => { if (row.kind === 'run_start') window.__rs.push(row.level); }); } }, 5);
    });
    await page.goto(base + '/', { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('#loadscreen.ld-ready', { timeout: 60000 }).catch(() => {});
    await page.click('#loadscreen', { timeout: 8000 }).catch(() => {});
    // A FRESH SAVE'S FIRST VISIT SKIPS THE TITLE (M4): the gate tap goes straight into run 1. The
    // title (and its dev-button sweep) is visited after the second run, through `__menu.showTitle`.
    const booted = await page.waitForFunction(() => !!(window.__game && window.__game.state && window.__game.state.substrate
      && window.__game.state.substrate.mine), null, { timeout: 60000 }).then(() => true).catch(() => false);
    ok('the zipped build\'s first visit goes straight into a descent (no title)', booted
       && await page.evaluate(() => !document.getElementById('titleScreen')));
    // THE HOOK STAYS. The owner's note is explicit that `window.__game` survives a public cut —
    // it is invisible, it is how a bug gets diagnosed on the live build, and a blunter
    // "strip the dev stuff" would remove it along with the buttons.
    ok('...and window.__cfg still exists (the invisible hook is kept on purpose)',
       await page.evaluate(() => !!window.__cfg));
    // A BUILD THAT REPORTS ITSELF AS `dev` IS UNMEASURABLE. The stamp rides on every `boot` row and
    // is what lets one release be compared against the last; shipping the placeholder looks identical
    // from the outside and is only discovered when the comparison turns out to be impossible.
    ok('the build stamps itself, and not as `dev`',
       /const BUILD_ID = '(?!dev')[^']{4,32}'/.test(builtHtml),
       (/const BUILD_ID = '([^']*)'/.exec(builtHtml) || [])[1] || 'absent');
    ok('...with dev.enabled FALSE', await page.evaluate(() => window.__cfg.dev.enabled === false),
       String(await page.evaluate(() => window.__cfg && window.__cfg.dev.enabled)));

    // Every screen that carries a dev control, checked by ID AND by the 'Dev' label every one of them
    // carries. Asserting the FLAG alone would pass on a build whose buttons had stopped reading it.
    const DEV_IDS = ['#devWin', '#ssDev', '#ssDevSpores', '#ssDevStart', '#ssDevUnlock', '#devEditBtn', '#devMapBtn',
                     '#devEditRocks', '#devMaps', '#devMapPanel', '#rockEditBar', '#tsDevTut'];
    const devHere = () => page.evaluate((ids) => {
      const out = ids.filter((i) => { const n = document.querySelector(i); return n && n.getBoundingClientRect().width > 0; });
      for (const el of document.querySelectorAll('button, a')) {
        const r = el.getBoundingClientRect();
        if (r.width > 0 && /^Dev/.test((el.textContent || '').trim())) out.push('"' + el.textContent.trim().slice(0, 20) + '"');
      }
      return [...new Set(out)];
    }, DEV_IDS);

    // ---- 4. it PLAYS THE MINE: first visit -> a descent -> the end screen -> the store -> Descend ----
    const live = await page.waitForFunction(() => {
      const g = window.__game, s = g && g.state;
      return !!(g && g.mine && s && s.substrate && s.substrate.mine && s.active && s.active.nodes.length > 0 && !s.runOver);
    }, null, { timeout: 40000 }).then(() => true).catch(() => false);
    ok('a descent builds and the colony is alive', live, 'seed ' + await page.evaluate(() => window.__game && window.__game.mine && window.__game.mine.seed()));
    // THE ROCK IS REAL: every band's sprites decoded and stamped into the fine mask. This is the one
    // a pruned folder breaks — the zip used to ship bands 1 and 3 with no walls at all.
    const solid = await page.waitForFunction(() => !!(window.__game.state.substrate._fineSolid && window.__game.state.substrate._rockSolidified),
      null, { timeout: 30000 }).then(() => true).catch(() => false);
    const mask = await page.evaluate(() => {
      const g = window.__game, s = g.state, sub = s.substrate, f = sub._fineSolid;
      if (!f) return { set: false, bands: [], sprites: 0 };
      // PER BAND, over the home chunk's columns: a pruned band folder reads 0% here.
      const K = Math.round(sub.cellSize / sub._fineSize), cw = s.config.mine.chunkCols, br = s.config.mine.bandRows;
      const hc = g.mine.homeChunk(), x0 = hc * cw * K, x1 = (hc + 1) * cw * K;
      const bands = g.mine.bands().map((_, b) => {
        let on = 0, n = 0;
        for (let y = b * br * K; y < (b + 1) * br * K && y < sub._fineRows; y++)
          for (let x = x0; x < x1; x++) { n++; on += f[y * sub._fineCols + x]; }
        return n ? on / n : 0;
      });
      return { set: true, bands, sprites: (sub.levelSprites || []).length };
    });
    ok('_fineSolid is set: every band\'s rock is collided', solid && mask.set && mask.bands.length === 4 && mask.bands.every((x) => x > 0.1),
       `${mask.sprites} sprites; solid share per band in the home chunk: ${mask.bands.map((x) => (x * 100).toFixed(0) + '%').join(' / ')}`);
    const devInGame = await devHere();
    ok('no dev buttons in the running descent', devInGame.length === 0, devInGame.join(', '));
    await page.screenshot({ path: path.join(__dirname, '.artifacts', 'itchzip-mine.png'), animations: 'disabled', timeout: 8000 }).catch(() => {});

    // The navigator (mine-check's own) digs on the REAL tank until the water says stop, and then
    // nothing is touched: the stuck rule has to end the run by itself.
    await require('./mine-harness.cjs').injectNav(page);
    await sleep(300);
    const dive = await page.evaluate(async () => {
      const g = window.__game, s = g.state;
      // A quiet shaft (no worms, no mould, nothing respawning), so the tank is the only thing that
      // ends it — this is a release gate for the build, not a balance probe.
      s.nematodes.length = 0; s.clouds.length = 0;
      s.config.nematodes.respawnChance = 0; s.config.trichoderma.respawnChance = 0;
      const r = await window.__navDig({ tank: true, maxIters: 400 });
      return { depth: r.depth, digs: r.digs, water: s.active.water };
    });
    ok('a navigator descent digs on the real tank', dive.digs >= 10 && dive.depth >= 10,
       `${dive.depth} m on ${dive.digs} digs, ${dive.water} water left`);
    const ended = await page.waitForSelector('#ssMineEnd', { timeout: 45000 }).then(() => true).catch(() => false);
    const endInfo = await page.evaluate(() => { const g = window.__game, s = g.state;
      return { cause: s.runResult && s.runResult.cause,
      text: ((document.getElementById('ssMineEnd') || {}).innerText || '').split('\n').slice(0, 3).join(' | '),
      // What the run looked like if it did NOT end: the numbers the stuck rule reads.
      diag: s.runOver ? '' : ` [live: water ${s.active.water}, cost here ${g.mine.costHere()}, cheapest ${g.mine.cheapest()}, `
        + `stuck ${JSON.stringify(g.mine.stuck())}, revealing ${g.mine.revealing()}, paused ${g.simPaused && g.simPaused()}, `
        + `depth ${g.mine.depth()}, nodes ${s.active.nodes.length}, worms ${s.nematodes.length}, clouds ${s.clouds.length}]` }; });
    ok('...the run ends by itself on the end screen', ended, `${endInfo.cause}: ${endInfo.text}${endInfo.diag}`);
    const toStore = await page.evaluate(() => { const b = document.getElementById('ssMineDone'); if (b) b.click(); return !!b; });
    const store = await page.waitForSelector('#speciesSelect.ss-mine', { timeout: 15000 }).then(() => true).catch(() => false);
    ok('the store opens from the end screen', toStore && store);
    const devOnStore = await devHere();
    ok('no dev buttons in the store', devOnStore.length === 0, devOnStore.join(', '));
    const seed1 = await page.evaluate(() => window.__game.mine.seed());
    const desc = await page.evaluate(() => { const b = document.getElementById('ssDescend'); if (b) b.click(); return !!b; });
    const run2 = await page.waitForFunction((s1) => {
      const g = window.__game, s = g && g.state;
      return !!(s && s.substrate && s.substrate.mine && !s.runOver && g.mine.seed() !== s1 && s.substrate._rockSolidified && !document.getElementById('speciesSelect'));
    }, seed1, { timeout: 40000 }).then(() => true).catch(() => false);
    const rs = await page.evaluate(() => window.__rs.slice());
    ok('Descend starts run 2 on a fresh shaft', desc && run2 && rs.length === 2, `${rs.length} run_start row(s)`);
    await sleep(1500);
    const saw = await page.evaluate(() => window.__sawLevelIntro);
    ok('#levelIntro was never visible, on either run', saw === 0, `${saw} sample(s) with it up`);
    // THE TITLE, now that this save has finished a descent: it offers the Deep Mine, and no dev button.
    await page.evaluate(() => window.__menu.showTitle());
    const clicked = await page.waitForSelector('#tsNewMine', { timeout: 15000 }).then(() => true).catch(() => false);
    ok('the title (a returning save) offers the Deep Mine', clicked);
    const devOnTitle = await devHere();
    ok('no dev buttons on the title screen', devOnTitle.length === 0, devOnTitle.join(', '));

    // Asset failures matter MORE here than in any other check: the tree has every file, so a
    // missing one only ever shows up in the artefact.
    ok('0 page errors or failed requests in the whole run', errs.length === 0,
       errs.slice(0, 4).join(' | ') || 'none');
    // ...AND, ON THE CRAZYGAMES BUILD, THAT IT SURVIVED THE SDK BEING UNREACHABLE. Everything
    // above — booting, a descent, the store — happened with the SDK script failing to load
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
  if (FRESH) fs.rmSync(path.dirname(ZIP), { recursive: true, force: true });
  console.log(`\n==== ${pass} passed, ${fail} failed ====`);
  process.exit(fail ? 1 : 0);
})();
