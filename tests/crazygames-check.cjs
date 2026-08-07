// The gate for the CrazyGames cut. Like tests/itchzip-check.cjs it runs against the ARTEFACT
// rather than the working tree, because everything it is checking is done BY THE BUILD — the
// SDK adapter, the level prune and the re-encode exist nowhere else, so a working-tree test
// would be testing a file that has none of them.
//
// It unzips, serves the result with a MOCK CrazyGames SDK in front of it, and plays it: title
// -> campaign -> a live colony, with every save landing in the SDK's data module rather than
// in localStorage, and the SDK's mute setting overriding the game's own.
//
//   node scripts/make-crazygames-zip.mjs && node tests/crazygames-check.cjs
//
// Not in tests/run.mjs: it needs a built zip, which the runner has no way to produce.
const { chromium } = require('playwright');
const { execFileSync } = require('child_process');
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const ZIP = path.join(ROOT, 'dist', 'mycelium-crazygames.zip');
const OUT = path.join(ROOT, 'dist', 'cg-verify');
const MAX_MB = 20;

let pass = 0, fail = 0;
const ok = (name, cond, note) => {
  if (cond) { pass++; console.log(`  PASS  ${name}${note ? '  — ' + note : ''}`); }
  else { fail++; console.log(`  FAIL  ${name}${note ? '  — ' + note : ''}`); }
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// The SDK as CrazyGames documents it: a synchronous localStorage-shaped data module and a
// game.settings carrying muteAudio. Installed before any page script so the shim finds it
// exactly as it would on their site. `__cgProbe` is how the assertions see inside it.
function mockSdk(muteAudio) {
  return `(() => {
    const store = new Map();
    const probe = { reads: 0, writes: 0, muteApplied: null, initCalled: 0, listeners: 0 };
    window.__cgProbe = probe;
    window.__cgStore = store;
    window.CrazyGames = { SDK: {
      init: () => { probe.initCalled++; return Promise.resolve(); },
      data: {
        getItem: (k) => { probe.reads++; return store.has(k) ? store.get(k) : null; },
        setItem: (k, v) => { probe.writes++; store.set(k, String(v)); },
        removeItem: (k) => { store.delete(k); },
        clear: () => { store.clear(); },
      },
      game: {
        settings: { muteAudio: ${muteAudio ? 'true' : 'false'} },
        addSettingsChangeListener: (fn) => { probe.listeners++; window.__cgFire = fn; },
        removeSettingsChangeListener: () => {},
      },
    } };
  })()`;
}

function serve(dir) {
  const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json',
    '.webp': 'image/webp', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml',
    '.mp3': 'audio/mpeg', '.wav': 'audio/wav' };
  const srv = http.createServer((req, res) => {
    const rel = decodeURIComponent(req.url.split('?')[0]).replace(/^\/+/, '') || 'index.html';
    const p = path.join(dir, rel);
    if (!p.startsWith(dir) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) { res.statusCode = 404; return res.end('no'); }
    res.setHeader('Content-Type', TYPES[path.extname(p)] || 'application/octet-stream');
    fs.createReadStream(p).pipe(res);
  });
  return new Promise((r) => srv.listen(0, () => r({ srv, port: srv.address().port })));
}

(async () => {
  if (!fs.existsSync(ZIP)) {
    console.log('  FAIL  dist/mycelium-crazygames.zip is missing — run node scripts/make-crazygames-zip.mjs');
    process.exit(1);
  }

  // ---- the artefact, statically ----------------------------------------------
  console.log('-- the zip --');
  const size = fs.statSync(ZIP).size;
  ok(`the zip is under ${MAX_MB} MB, so it reaches the mobile store too`, size <= MAX_MB * 1048576,
     `${(size / 1048576).toFixed(2)} MB`);

  fs.rmSync(OUT, { recursive: true, force: true });
  fs.mkdirSync(OUT, { recursive: true });
  execFileSync('unzip', ['-q', ZIP, '-d', OUT]);
  ok('index.html is at the zip root', fs.existsSync(path.join(OUT, 'index.html')));
  const entries = execFileSync('unzip', ['-Z1', ZIP], { encoding: 'utf8' }).split('\n').map((s) => s.trim()).filter(Boolean);
  ok('no nested archive', !entries.some((e) => /\.(zip|tar|gz)$/i.test(e)));

  const html = fs.readFileSync(path.join(OUT, 'index.html'), 'utf8');
  // Anchored on the comment above the flag, because `enabled: true,` at that indent appears
  // three more times in CONFIG for unrelated features — a bare search made this fail on a
  // build whose dev flag was correctly off.
  ok('the dev flag is off in the shipped copy',
     html.includes('// itch zip, and confirm with scratchpad/verify-nodev.mjs.\n    enabled: false,'));
  ok('the CrazyGames SDK is loaded', html.includes('sdk.crazygames.com/crazygames-sdk-v3.js'));
  ok('the game script is deferred behind the shim', html.includes('id="cgGame" type="text/cg-deferred"'));

  // EVERY MANIFEST ENTRY MUST BE IN THE ZIP. Playing two levels would never notice a sprite
  // missing from the ninth — the same reason itchzip-check asserts this statically.
  const mf = JSON.parse(fs.readFileSync(path.join(OUT, 'assets', 'manifest.json'), 'utf8'));
  const missing = mf.assets.filter((a) => !fs.existsSync(path.join(OUT, 'assets', a.file)));
  ok('every manifest entry is present in the zip', missing.length === 0,
     missing.length ? `${missing.length} missing, e.g. ${missing[0].file}` : `${mf.assets.length} entries`);

  // And every level the build kept must have its sprites, for the same reason.
  const lv0 = html.indexOf('const LEVELS = [') + 'const LEVELS = ['.length - 1;   // land on the '['
  const levels = JSON.parse(html.slice(lv0, html.indexOf('\n];', lv0) + 2));
  const folders = [...new Set(levels.map((l) => l.assetsFrom || l.id))];
  const bare = folders.filter((f) => {
    const d = path.join(OUT, 'assets', f);
    return !fs.existsSync(d) || !fs.readdirSync(d).some((x) => x.endsWith('.webp'));
  });
  ok('every kept level has its sprite folder', bare.length === 0, bare.length ? bare.join(', ') : `${folders.length} folders`);
  // A DROPPED TRACK MUST LEAVE THE SOURCE TOO, not just the folder: the four music paths are
  // string literals in the audio module, so a file removed from the zip while still named in
  // LEVEL_TRACKS makes that level play in silence behind a 404 nobody sees.
  const musicFiles = fs.readdirSync(path.join(OUT, 'assets', 'music'));
  const named = [...new Set((html.match(/assets\/music\/[^'"]+\.mp3/g) || []).map((s) => s.split('/').pop()))];
  const dangling = named.filter((n) => !musicFiles.includes(n));
  ok('every music track the game names is in the zip', dangling.length === 0,
     dangling.length ? `missing: ${dangling.join(', ')}` : `${musicFiles.length} tracks, ${named.length} named`);
  ok('...and at least two level tracks remain to alternate between', named.length >= 3,
     `${named.length} named (1 menu + ${named.length - 1} level)`);

  const camp = levels.filter((l) => l.campaignLevel).length;
  const surv = levels.filter((l) => l.survival).length;
  ok('all 9 campaign levels survived the prune', camp === 9, `${camp} campaign`);
  ok('the survival bag is not empty', surv >= 4, `${surv} survival maps`);

  // ---- the artefact, played ---------------------------------------------------
  console.log('\n-- played, with a mock CrazyGames SDK --');
  const { srv, port } = await serve(OUT);
  const base = `http://127.0.0.1:${port}`;
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });

  const boot = async (muteAudio) => {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const page = await ctx.newPage();
    const errs = [], bad = [];
    page.on('pageerror', (e) => errs.push(String(e && e.message)));
    page.on('requestfailed', (r) => { if (!/sdk\.crazygames\.com/.test(r.url())) bad.push(r.url()); });
    page.on('response', (r) => { if (r.status() >= 400) bad.push(`${r.status()} ${r.url()}`); });
    // The real SDK cannot load here; the mock is what the shim must find instead.
    await page.route('**/sdk.crazygames.com/**', (r) => r.abort());
    await page.addInitScript(mockSdk(muteAudio));
    await page.addInitScript(() => { window.MYCELIUM_SUPABASE = { url: '', anonKey: '' }; });
    await page.goto(base + '/index.html', { waitUntil: 'domcontentloaded' });
    return { ctx, page, errs, bad };
  };

  // THE LOADER NEEDS A CLICK, which is the thing a hand-rolled boot misses: the load screen
  // gates on a user gesture (audio autoplay needs one), so waiting for the title screen without
  // clicking it waits for ever and reads as "the build never boots". Same sequence itchzip-check
  // uses, for the same reason.
  const toTitle = async (page) => {
    await page.waitForSelector('#loadscreen.ld-ready', { timeout: 60000 }).catch(() => {});
    await page.click('#loadscreen', { timeout: 8000 }).catch(() => {});
    return page.waitForSelector('#titleScreen', { timeout: 60000 }).then(() => true).catch(() => false);
  };

  // -- storage goes through the SDK --
  {
    const { ctx, page, errs, bad } = await boot(false);
    await page.waitForFunction(() => window.__cgReady, { timeout: 30000 }).catch(() => {});
    const ready = await page.evaluate(() => window.__cgReady || null);
    ok('the SDK is initialised before the game runs', !!ready && ready.sdk, JSON.stringify(ready));
    ok('...and localStorage is replaced by the SDK data module', !!ready && ready.store);
    const init = await page.evaluate(() => window.__cgProbe.initCalled);
    ok('...init() is called exactly once', init === 1, `${init}`);
    const lis = await page.evaluate(() => window.__cgProbe.listeners);
    ok('...and a settings-change listener is registered', lis === 1, `${lis}`);

    ok('the title screen builds', await toTitle(page));

    // A REAL SAVE, NOT A SYNTHETIC ONE. The game writes its settings and client id during
    // boot; asserting on a value we poked in ourselves would prove only that the shim works
    // when called directly, which is not the thing that can break.
    const wrote = await page.evaluate(() => ({ writes: window.__cgProbe.writes, keys: [...window.__cgStore.keys()] }));
    ok('the game\'s own saves land in the SDK data module', wrote.writes > 0 && wrote.keys.some((k) => k.startsWith('mycelium.')),
       `${wrote.writes} writes, keys: ${wrote.keys.slice(0, 3).join(', ')}`);
    // ...and nothing was left behind in the real localStorage, which would be a save the
    // player loses the moment they open the game on another device.
    const rawKeys = await page.evaluate(() => {
      // A FRESH IFRAME IS HOW YOU REACH THE GENUINE localStorage past the shim — the shim is
      // defined on this window only, so a same-origin child still has the real one.
      try { const f = document.createElement('iframe'); document.body.appendChild(f);
        const real = f.contentWindow.localStorage; const out = [];
        for (let i = 0; i < real.length; i++) out.push(real.key(i));
        f.remove(); return out; } catch (e) { return ['<blocked:' + e.message + '>']; }
    });
    ok('...and not in the browser\'s own localStorage', !rawKeys.some((k) => String(k).startsWith('mycelium.')),
       rawKeys.length ? rawKeys.slice(0, 4).join(', ') : 'empty');

    ok('no page errors', errs.length === 0, errs.slice(0, 2).join(' | '));
    ok('no failed requests', bad.length === 0, bad.slice(0, 3).join(' | '));
    await ctx.close();
  }

  // -- the campaign actually plays --
  {
    const { ctx, page, errs, bad } = await boot(false);
    await toTitle(page);
    // Every screen that carries a dev control, by ID. Asserting the FLAG alone would pass on a
    // build whose buttons had stopped reading it.
    const DEV_IDS = ['#devWin', '#ssDevSpores', '#ssDevStart', '#ssDevUnlock', '#devEditRocks',
                     '#devMaps', '#devMapPanel', '#rockEditBar'];
    const devOnTitle = await page.evaluate((ids) => ids.filter((i) => !!document.querySelector(i)), DEV_IDS);
    ok('no dev buttons on the title screen', devOnTitle.length === 0, devOnTitle.join(', '));
    ok('the invisible __cfg hook survives the cut, with dev off',
       await page.evaluate(() => !!window.__cfg && window.__cfg.dev.enabled === false));

    const clicked = await page.click('#tsNewCamp', { timeout: 8000 }).then(() => true).catch(() => false);
    ok('the campaign row is there and clickable', clicked);
    await sleep(600);
    const nameBox = await page.$('#tsNameInput');
    if (nameBox) { await nameBox.fill('CG'); await page.click('#tsNameStart', { timeout: 5000 }).catch(() => {}); }
    // The campaign puts its story opening BETWEEN New and the picker, so wait for either and
    // click the opening away when that is what turned up.
    let gotPicker = false;
    for (let i = 0; i < 60 && !gotPicker; i++) {
      gotPicker = await page.evaluate(() => {
        if (document.getElementById('speciesSelect')) return true;
        const st = document.querySelector('.li-story');
        if (st) st.click();
        return false;
      });
      if (!gotPicker) await sleep(500);
    }
    ok('...and reaches the species selection screen', gotPicker);
    const devOnPicker = await page.evaluate((ids) => ids.filter((i) => !!document.querySelector(i)), DEV_IDS);
    ok('no dev buttons on the selection screen', devOnPicker.length === 0, devOnPicker.join(', '));

    await page.evaluate(() => { const b = document.querySelector('#ssAvail .ss-selbtn'); if (b) b.click(); });
    for (let i = 0; i < 25 && !(await page.$('#game')); i++) await sleep(400);
    // DISPATCHED, not page.click: the level card sits over a full-screen <canvas id="game"> and
    // Playwright's actionability check refuses a click it believes the canvas intercepts.
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
    ok('a campaign level builds and the colony is alive', live,
       await page.evaluate(() => { const s = window.__game && window.__game.state;
         return s && s.active ? s.active.nodes.length + ' strand(s)' : 'no state'; }));
    ok('no page errors during a run', errs.length === 0, errs.slice(0, 2).join(' | '));
    ok('no failed requests during a run', bad.length === 0, bad.slice(0, 3).join(' | '));
    await ctx.close();
  }

  // -- mute, both directions --
  {
    const { ctx, page } = await boot(true);
    await page.waitForFunction(() => !!window.__cgAudio, { timeout: 40000 });
    await sleep(400);
    const muted = await page.evaluate(() => ({ music: window.__cgAudio.isMusicMuted(), sfx: window.__cgAudio.isSfxMuted() }));
    ok('the SDK mute setting silences the game', muted.music === true && muted.sfx === true, JSON.stringify(muted));

    // AND IT MUST NOT HAVE WRITTEN ITSELF INTO THE SAVE. CrazyGames' mute is their setting,
    // not the player's; persisting it would leave a player muted for good once they play
    // anywhere else, on a save that now syncs across their devices.
    const persisted = await page.evaluate(() => ({
      music: window.__cgStore.get('mycMuted') || null, sfx: window.__cgStore.get('mycSfxMuted') || null }));
    ok('...without overwriting the player\'s own saved choice', persisted.music !== '1' && persisted.sfx !== '1',
       JSON.stringify(persisted));

    // Turning it back off hands control back to what the player chose.
    await page.evaluate(() => {
      window.CrazyGames.SDK.game.settings.muteAudio = false;
      if (window.__cgFire) window.__cgFire(window.CrazyGames.SDK.game.settings);
    });
    await sleep(300);
    const after = await page.evaluate(() => ({ music: window.__cgAudio.isMusicMuted(), sfx: window.__cgAudio.isSfxMuted() }));
    ok('...and unmuting on CrazyGames restores sound', after.music === false && after.sfx === false, JSON.stringify(after));
    await ctx.close();
  }

  // -- and it still runs with NO SDK at all (opened locally, or served anywhere else) --
  {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const page = await ctx.newPage();
    const errs = [];
    page.on('pageerror', (e) => errs.push(String(e && e.message)));
    await page.route('**/sdk.crazygames.com/**', (r) => r.abort());
    await page.addInitScript(() => { window.MYCELIUM_SUPABASE = { url: '', anonKey: '' }; });
    await page.goto(base + '/index.html', { waitUntil: 'domcontentloaded' });
    const built = await toTitle(page);
    // A storage wrapper that can strand the player on a blank page is worse than no wrapper,
    // and the SDK failing to load is the likeliest way that happens.
    ok('with no SDK present the game still boots', built);
    ok('...with no page errors', errs.length === 0, errs.slice(0, 2).join(' | '));
    await ctx.close();
  }

  await browser.close();
  srv.close();
  fs.rmSync(OUT, { recursive: true, force: true });
  console.log(`\n==== ${pass} passed, ${fail} failed ====`);
  process.exit(fail ? 1 : 0);
})();
