/* The CrazyGames SDK bridge: does the game fire `gameplayStart` at the right moment, and does it
 * stay a no-op everywhere else?
 *
 * WHY THIS EXISTS. CrazyGames rejected a submission on their "first gameplay start" test. Nothing
 * was wrong with the build — measured at the time, it is playable at 16.9 MB against their 50 MB
 * cap — but they measure the initial download as the bytes between load start and the FIRST
 * `gameplayStart` event, and the game never called it, so the metric had no endpoint.
 *
 * THE SDK IS NOT LOADED HERE, AND THAT IS THE POINT OF THE DESIGN. It is injected only by
 * `make-web-zip.mjs --platform crazygames`, and off their domain every real SDK call throws. So
 * this check STUBS `window.CrazyGames` before boot and records the calls — which tests our side of
 * the contract (when we call, in what order, how many times) without depending on their CDN, and
 * runs against the plain repo like every other check.
 *
 * What it guards, in the order the mistakes are easy to make:
 *   1. `gameplayStart` fires AT ALL, and exactly once, when the map is up and the colony is alive.
 *   2. It does NOT fire on the loader, the title screen or the species picker. Their docs are
 *      explicit that the event "excludes menus and additional loading steps" — firing it early is
 *      worse than not firing it, because it makes the measured download look smaller than it is.
 *   3. `gameplayStop` fires when the player leaves the map, and a later return fires start again.
 *   4. Nothing at all happens without the SDK — the itch build and every other check must be
 *      untouched.
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const ROOT = path.resolve(__dirname, '..');
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.svg': 'image/svg+xml',
  '.webp': 'image/webp', '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.css': 'text/css' };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let pass = 0, fail = 0;
const ok = (n, c, x) => { c ? (pass++, console.log('  PASS  ' + n + (x ? '  — ' + x : '')))
                            : (fail++, console.log('  FAIL  ' + n + (x ? '  — ' + x : ''))); };

// The stub. Installed before any of the game's script runs, so `CRAZY.init()` finds it.
const STUB = () => {
  window.__cgCalls = [];
  const log = (n) => { window.__cgCalls.push(n); };
  window.CrazyGames = {
    SDK: {
      init: async () => { log('init'); },
      game: {
        loadingStart: () => log('loadingStart'),
        loadingStop: () => log('loadingStop'),
        gameplayStart: () => log('gameplayStart'),
        gameplayStop: () => log('gameplayStop'),
      },
    },
  };
};

(async () => {
  const srv = await new Promise((res) => {
    const s = http.createServer((rq, rs) => {
      let p = decodeURIComponent(rq.url.split('?')[0].split('#')[0]);
      if (p === '/') p = '/index.html';
      const fp = path.join(ROOT, p);
      if (!fp.startsWith(ROOT) || !fs.existsSync(fp) || fs.statSync(fp).isDirectory()) {
        rs.writeHead(404); rs.end('nf'); return;
      }
      rs.writeHead(200, { 'Content-Type': TYPES[path.extname(fp)] || 'application/octet-stream' });
      fs.createReadStream(fp).pipe(rs);
    });
    s.listen(0, () => res(s));
  });
  const base = 'http://localhost:' + srv.address().port;
  const browser = await chromium.launch({ headless: true, executablePath: '/opt/pw-browsers/chromium' });

  const boot = async (withStub) => {
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
    page.on('pageerror', (e) => { fail++; console.log('  FAIL  page error — ' + e.message); });
    await page.addInitScript(() => { window.MYCELIUM_SUPABASE = { url: '', anonKey: '' }; });
    if (withStub) await page.addInitScript(STUB);
    await page.goto(base + '/index.html', { waitUntil: 'domcontentloaded' });
    return page;
  };
  const calls = (page) => page.evaluate(() => (window.__cgCalls || []).slice());

  try {
    // ---- 1. the loading window, and NOT firing gameplay on the menus -------------------------
    console.log('\nthe loading window, and the menus');
    const page = await boot(true);
    await page.waitForSelector('#loadscreen.ld-ready', { timeout: 60000 }).catch(() => {});
    let c = await calls(page);
    ok('init and loadingStart happen at boot',
       c[0] === 'init' && c.includes('loadingStart'), c.join(' → '));
    ok('...and loadingStop when the assets are ready', c.includes('loadingStop'), c.join(' → '));
    // THE ASSERTION THE SUBMISSION FAILED ON, inverted: their docs say the event excludes menus
    // and loading. Firing it here would make the measured initial download look smaller than the
    // player's real one, which is worse than not firing it at all.
    ok('NOT gameplayStart while the loader is up', !c.includes('gameplayStart'), c.join(' → '));

    await page.click('#loadscreen', { timeout: 8000 }).catch(() => {});
    await page.waitForSelector('#titleScreen', { timeout: 60000 }).catch(() => {});
    await sleep(700);
    c = await calls(page);
    ok('NOT gameplayStart on the title screen', !c.includes('gameplayStart'), c.join(' → '));

    // ---- 2. it fires when the player is actually playing --------------------------------------
    console.log('\nreaching a playable state');
    await page.click('#tsNewCamp', { timeout: 8000 }).catch(() => {});
    await sleep(600);
    const nameBox = await page.$('#tsNameInput');
    if (nameBox) { await nameBox.fill('CG'); await page.click('#tsNameStart', { timeout: 5000 }).catch(() => {}); }
    // The campaign's opening sits between New and the picker; click through whichever turns up.
    for (let i = 0; i < 60; i++) {
      const atPicker = await page.evaluate(() => {
        if (document.getElementById('speciesSelect')) return true;
        const st = document.querySelector('.li-story'); if (st) st.click();
        return false;
      });
      if (atPicker) break;
      await sleep(500);
    }
    c = await calls(page);
    ok('NOT gameplayStart on the species picker', !c.includes('gameplayStart'), c.join(' → '));

    await page.evaluate(() => { const b = document.querySelector('#ssAvail .ss-selbtn'); if (b) b.click(); });
    // The level card is a menu too — dismissed by a click, dispatched rather than page.click
    // because the full-screen canvas "intercepts" it as far as Playwright is concerned.
    for (let i = 0; i < 40; i++) {
      const gone = await page.evaluate(() => {
        const n = document.getElementById('levelIntro'); if (!n) return true; n.click(); return false;
      });
      if (gone) break;
      await sleep(500);
    }
    const playing = await page.waitForFunction(() => {
      const g = window.__game; return !!(g && g.crazy && g.crazy().playing);
    }, null, { timeout: 40000 }).then(() => true).catch(() => false);
    c = await calls(page);
    ok('gameplayStart fires once the colony is alive on the map', playing && c.includes('gameplayStart'),
       c.join(' → '));
    ok('...exactly once (it is edge-triggered, not per frame)',
       c.filter((x) => x === 'gameplayStart').length === 1,
       `${c.filter((x) => x === 'gameplayStart').length} call(s) over ~${c.length} events`);
    ok('...and after loadingStop, never before it',
       c.indexOf('gameplayStart') > c.indexOf('loadingStop'),
       `loadingStop at ${c.indexOf('loadingStop')}, gameplayStart at ${c.indexOf('gameplayStart')}`);

    // ---- 3. leaving the map stops it, and coming back starts it again --------------------------
    console.log('\nleaving and returning');
    await page.evaluate(() => window.__game.showPicker());
    await page.waitForFunction(() => !window.__game.crazy().playing, null, { timeout: 20000 }).catch(() => {});
    c = await calls(page);
    ok('gameplayStop fires on the way back to the picker', c.includes('gameplayStop'), c.slice(-4).join(' → '));

    await page.evaluate(() => {
      document.querySelectorAll('#speciesSelect, #levelIntro').forEach((n) => n.remove());
      window.__game.campaign.play('marasmius', 2);
    });
    for (let i = 0; i < 40; i++) {
      const gone = await page.evaluate(() => {
        const n = document.getElementById('levelIntro'); if (!n) return true; n.click(); return false;
      });
      if (gone) break;
      await sleep(500);
    }
    await page.waitForFunction(() => window.__game.crazy().playing, null, { timeout: 40000 }).catch(() => {});
    c = await calls(page);
    ok('...and gameplayStart again on the next level',
       c.filter((x) => x === 'gameplayStart').length === 2,
       `${c.filter((x) => x === 'gameplayStart').length} start(s), ${c.filter((x) => x === 'gameplayStop').length} stop(s)`);
    await page.close();

    // ---- 4. NOTHING happens without the SDK ----------------------------------------------------
    // The itch build, every other check, and any local boot. If this ever fails, the guards have
    // stopped guarding and the build that has no SDK is throwing on every frame.
    console.log('\nwithout the SDK (the itch build, and every other check)');
    const bare = await boot(false);
    await bare.waitForSelector('#loadscreen.ld-ready', { timeout: 60000 }).catch(() => {});
    await bare.click('#loadscreen', { timeout: 8000 }).catch(() => {});
    await bare.waitForSelector('#titleScreen', { timeout: 60000 }).catch(() => {});
    await sleep(800);
    const bareState = await bare.evaluate(() => ({
      calls: window.__cgCalls || null,
      live: window.__game ? window.__game.crazy().live : null,
      sdk: !!window.CrazyGames,
    }));
    // `live !== true`, not `=== false`: `window.__game` is assigned when a RUN starts, not at boot,
    // so on the title screen there is no bridge to ask and the probe reports null. Both answers
    // mean the same thing here — nothing is live — and demanding `false` failed on a correct build.
    ok('the SDK is absent and the bridge is not live',
       bareState.sdk === false && bareState.live !== true, JSON.stringify(bareState));
    ok('...and no calls were attempted', bareState.calls === null, JSON.stringify(bareState.calls));
    await bare.close();

    // ---- 5. the repo itself must not LOAD the SDK ----------------------------------------------
    // The tag is injected by the CrazyGames build only. index.html names the URL in a comment,
    // which is why this looks for a script TAG rather than the string — the build's own guard made
    // exactly that mistake and refused every itch build over a comment.
    const src = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
    ok('the repo has no SDK script tag (the build injects it)',
       !/<script[^>]*sdk\.crazygames\.com/.test(src));
  } catch (e) {
    fail++; console.log('  HARNESS ERROR — ' + (e && e.stack || e));
  }

  await browser.close(); srv.close();
  console.log(`\n==== ${pass} passed, ${fail} failed ====`);
  process.exit(fail ? 1 : 0);
})();
