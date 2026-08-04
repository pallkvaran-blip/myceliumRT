/* Screenshots of every CAMPAIGN screen, in one run → tests/.artifacts/campaign-*.png
 *
 *     node tests/campaign-shot.cjs
 *
 * Not a check — it asserts nothing and the runner doesn't call it. It exists because several
 * bugs this feature had were invisible in a diff and obvious in a frame: two silent CSS class
 * collisions (`.ss-hint`, `.li-count`) that rendered the right text in the wrong element's
 * style, and a click handler that got the event instead of the species so the detail sheet
 * simply never opened. Every one of those was found by looking.
 *
 * It sets up a WORTH-LOOKING-AT state rather than a fresh save — some Spores, a few upgrades,
 * a deck, retries banked — because most of these screens say nothing at zero.
 *
 * Traps, all of which cost time when this was four throwaway scripts in a scratchpad:
 *   • The dev build SKIPS the level intro. `__cfg.dev.enabled` has to go off BEFORE the level
 *     starts — `state.config` is a deep clone taken at run start.
 *   • The mycelium wordmarks GROW, and headless throttles rAF toward 1-2 Hz, so a shot taken
 *     too early catches half-grown letters. Hence the long waits; they are not padding.
 *   • Every screenshot is timed out and .catch()'d. Playwright's default waits for animations
 *     to settle, and against a live rAF loop that wait has no end (CLAUDE.md).
 */
const http = require('http'); const fs = require('fs'); const path = require('path');
const { chromium } = require('playwright');
const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(__dirname, '.artifacts');
const TYPES = { '.html':'text/html','.js':'text/javascript','.json':'application/json','.png':'image/png',
  '.jpg':'image/jpeg','.jpeg':'image/jpeg','.svg':'image/svg+xml','.webp':'image/webp','.mp3':'audio/mpeg','.wav':'audio/wav','.css':'text/css' };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const srv = await new Promise((res) => { const s = http.createServer((rq, rs) => {
    let p = decodeURIComponent(rq.url.split('?')[0].split('#')[0]); if (p === '/') p = '/index.html';
    const fp = path.join(ROOT, p);
    if (!fp.startsWith(ROOT) || !fs.existsSync(fp) || fs.statSync(fp).isDirectory()) { rs.writeHead(404); rs.end('nf'); return; }
    rs.writeHead(200, { 'Content-Type': TYPES[path.extname(fp)] || 'application/octet-stream' });
    fs.createReadStream(fp).pipe(rs); }); s.listen(0, () => res(s)); });
  const base = 'http://localhost:' + srv.address().port;
  const browser = await chromium.launch({ headless: true, executablePath: '/opt/pw-browsers/chromium' });
  // deviceScaleFactor 2 for a readable frame; NEVER 4 — it OOMs (CLAUDE.md).
  const newPage = async (hash) => {
    const pg = await browser.newPage({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 2 });
    await pg.addInitScript(() => { window.MYCELIUM_SUPABASE = { url: '', anonKey: '' }; });
    await pg.goto(base + '/index.html' + hash, { waitUntil: 'domcontentloaded' });
    await pg.waitForSelector('#loadscreen.ld-ready', { timeout: 30000 }).catch(() => {});
    await pg.click('#loadscreen', { timeout: 5000 }).catch(() => {});
    return pg;
  };
  let page;
  const shot = (name, clip) => page.screenshot({ path: path.join(OUT, 'campaign-' + name + '.png'),
    clip, animations: 'disabled', timeout: 15000 })
    .then(() => console.log('  → tests/.artifacts/campaign-' + name + '.png'))
    .catch((e) => console.log('  ×  ' + name + ': ' + e.message));
  const FULL = { x: 0, y: 0, width: 1440, height: 1000 };

  // ---- 1. the TITLE screen: two games, Survival and Campaign ----------------
  // Its OWN page. Going from /index.html to /index.html#dev is a same-document hash change, so
  // `goto` does not re-boot and the dev hooks never arrive — the wait for `__game` just times out.
  page = await newPage('');
  await page.waitForSelector('#titleScreen', { timeout: 30000 }).catch(() => {});
  await sleep(8000);                       // the wordmark grows; headless does it slowly
  await shot('title', FULL);
  await page.close();

  // ---- boot into a dev run so __game is live, then dress the save ----------
  page = await newPage('#dev');
  await page.waitForFunction(() => window.__game && window.__game.campaign, null, { timeout: 30000 });
  for (let i = 0; i < 4 && await page.$('#levelIntro'); i++) { await page.mouse.click(720, 450); await sleep(900); }

  const dress = () => page.evaluate(() => {
    const g = window.__game, S = g.store;
    S.reset(); S.credit(9400);
    S.buy('energy'); S.buy('water'); S.buy('water'); S.buy('carryCards'); S.buy('carryEngines'); S.buy('lives');
    g.deck.set([{ name: 'Turgor Thrust', count: 4 }, { name: 'Rhizomorph Lance', count: 2 },
                { name: 'Foraging Fan', count: 3 }, { name: 'Acorn Cache', count: 2 },
                { name: 'Cord Capillary', count: 1 }, { name: 'Prospecting Cords', count: 1 }]);
    document.querySelectorAll('#speciesSelect, #loadoutSelect, #ssDeckWrap, #levelIntro').forEach((n) => n.remove());
    g.showPicker();
  });

  // ---- 2-4. the selection screen, top and bottom, and the deck sheet -------
  await dress();
  await page.waitForSelector('#ssUpg .ss-upg', { timeout: 15000 });
  await sleep(4500);                       // ...this wordmark grows too
  await shot('picker-top', FULL);
  await page.evaluate(() => { const r = document.getElementById('speciesSelect'); r.scrollTop = r.scrollHeight; });
  await sleep(600);
  await shot('picker-bottom', FULL);

  await page.evaluate(() => { const r = document.getElementById('speciesSelect'); r.scrollTop = 0; });
  await sleep(400);
  await page.click('#ssDeckBtn'); await sleep(900);
  await shot('deck', { x: 230, y: 60, width: 980, height: 940 });
  await page.evaluate(() => document.querySelector('#ssDeckClose').click()); await sleep(500);

  // ---- 5. a species detail sheet (read-only: the X and nothing else) -------
  await page.evaluate(() => document.querySelector('#ssAvail .ss-card').click());
  await sleep(900);
  await shot('detail', { x: 220, y: 20, width: 1000, height: 960 });
  await page.evaluate(() => document.querySelector('#ssIClose').click()); await sleep(400);

  // ---- 6-7. the level intro (dev flag OFF or it never appears) + the level -
  await page.evaluate(async () => {
    const was = window.__cfg.dev.enabled;
    window.__cfg.dev.enabled = false;
    document.querySelectorAll('#levelIntro, #speciesSelect').forEach((n) => n.remove());
    window.__game.campaign.play('marasmius', 4);
    for (let i = 0; i < 60 && !document.getElementById('levelIntro'); i++) await new Promise((r) => setTimeout(r, 150));
    window.__cfg.dev.enabled = was;
  });
  await sleep(3800);
  await shot('intro', FULL);
  await page.mouse.click(720, 500); await sleep(2600);      // dismiss → the map itself
  await shot('level', FULL);

  // ---- 8-9. the death screen, with retries banked and with none left ------
  const death = async (lives, name) => {
    await page.evaluate(async (l) => {
      const g = window.__game;
      document.querySelectorAll('#loadoutSelect, #levelIntro').forEach((n) => n.remove());
      g.store.reset();
      if (l) { g.store.credit(1e6); for (let i = 0; i < l; i++) g.store.buy('lives'); }
      g.campaign.play('marasmius', 3);
      await new Promise((r) => setTimeout(r, 500));
      // Play a few cards so the keep pool has something in it — an empty carousel shows nothing.
      for (let i = 0; i < 4; i++) {
        const h = g.state.cards.hand, idx = h.findIndex((x) => x.name === 'Turgor Thrust');
        if (idx < 0) break;
        g.state.active.energy = 99; g.state.active.water = 99;
        const fp = g.state.active.frontierPoint(); if (!fp) break;
        g.play(idx, { x: fp.x + 80, y: fp.y });
      }
      g.state.runResult = { won: false, died: true, cause: 'devoured', turns: g.state.turn };
      g.campaign.endRun();
      for (let i = 0; i < 60 && !document.getElementById('loadoutSelect'); i++) await new Promise((r) => setTimeout(r, 200));
      // Spend every retry, so the "none left" frame is the real disabled state rather than a
      // build with the track removed.
      if (!l) {
        for (let n = 0; n < 4 && g.campaign.lives() > 0; n++) {
          const b = document.getElementById('loTertiary'); if (!b || b.disabled) break;
          b.click();
          for (let i = 0; i < 60; i++) { if (!document.getElementById('loadoutSelect') && !g.state.runOver) break;
            await new Promise((r) => setTimeout(r, 200)); }
          await new Promise((r) => setTimeout(r, 300));
          g.state.runResult = { won: false, died: true, cause: 'devoured', turns: g.state.turn };
          g.campaign.endRun();
          for (let i = 0; i < 60 && !document.getElementById('loadoutSelect'); i++) await new Promise((r) => setTimeout(r, 200));
        }
      }
    }, lives);
    await sleep(900);
    await shot(name, FULL);
  };
  await death(2, 'death-retry');
  await death(0, 'death-noretry');

  console.log('\n  done');
  await browser.close(); srv.close();
})();
