/* NOTHING UNINVITED. The ten campaign levels get exactly the creatures their JSON places, and
 * never one more, however long the world runs.
 *
 *   node tests/campaign-threats-check.cjs
 *
 * A cloud appeared on campaign level 1 that the designer had not placed, and the cause is a rule
 * that is invisible from the level file. createLevelState places exactly the spawns in the JSON
 * (placeClouds / placeNematodes / placeAntNests — never the seedX generators), so
 * `trichoderma.initialPatches` and `nematodes.initialCount` do not decide what a level OPENS
 * with. What they decide is the RESPAWN CEILING:
 *
 *     spreadTrichoderma:  if (doMove && state.clouds.length < t.initialPatches && rng.chance(t.respawnChance)) spawnFarCloud(state)
 *     stepNematodes:      if (state.nematodes.length < n.initialCount && … && rng.chance(n.respawnChance)) … push(makeWorm(…))
 *
 * and those two numbers arrive from configForLevel — that is, from LEVEL_THREATS, the CAMPAIGN
 * SLOT the map sits in. Level 1's row is { ants: 1, nematodes: 1, trych: 1 }. A level that places
 * no cloud therefore satisfies `0 < 1` on its very first tick and one creeps in from off-screen.
 * Measured across the ten before the fix: nine of them leaked, up to 4 clouds and 6 worms.
 *
 * The fix is the level's own `threats` block (configForLevelDef), and it needs BOTH halves — the
 * counts, so the ceilings describe the population that is actually there, and `respawn: false`,
 * because a count of 0 does not stop a top-up: `0 < ceiling` is precisely the condition that
 * fires it.
 *
 * So this asserts the OUTCOME rather than the setting: run each level far past the point a stray
 * would have arrived and count what is on the map. Turn-based, so a step is one tickWorld and the
 * run length is a number rather than a race with the container.
 */
const http = require('http'), fs = require('fs'), path = require('path');
const { chromium } = require('playwright');
const ROOT = path.resolve(__dirname, '..');
const T = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.webp': 'image/webp', '.mp3': 'audio/mpeg', '.wav': 'audio/wav' };
let pass = 0, fail = 0;
const ok = (n, c, x) => { c ? (pass++, console.log('  PASS  ' + n + (x ? '  — ' + x : ''))) : (fail++, console.log('  FAIL  ' + n + (x ? '  — ' + x : ''))); };

// 300 steps. At trichoderma.respawnChance 0.12 a missing cloud arrives within ~8 steps on
// average and is all but certain inside 60, so 300 is not a close call — a level that still
// reads clean here is not merely lucky.
const STEPS = 300;

const LEVELS = fs.readdirSync(path.join(ROOT, 'docs', 'levels'))
  .filter((f) => /^campaign-\d\d-.*\.json$/.test(f)).sort()
  .map((f) => JSON.parse(fs.readFileSync(path.join(ROOT, 'docs', 'levels', f), 'utf8')));

(async () => {
  const srv = await new Promise((res) => { const s = http.createServer((rq, rs) => { let p = decodeURIComponent(rq.url.split('?')[0].split('#')[0]); if (p === '/') p = '/index.html'; const fp = path.join(ROOT, p); if (!fp.startsWith(ROOT) || !fs.existsSync(fp) || fs.statSync(fp).isDirectory()) { rs.writeHead(404); rs.end('nf'); return; } rs.writeHead(200, { 'Content-Type': T[path.extname(fp)] || 'application/octet-stream' }); fs.createReadStream(fp).pipe(rs); }); s.listen(0, () => res(s)); });
  const base = 'http://localhost:' + srv.address().port;
  const browser = await chromium.launch({ headless: true });

  ok('there are ten campaign levels to check', LEVELS.length === 10, `${LEVELS.length} found`);

  for (const def of LEVELS) {
    const want = {
      clouds: def.objects.filter((o) => o.t === 'trichoderma').length,
      worms: def.objects.filter((o) => o.t === 'nematode').length,
      ants: def.objects.filter((o) => o.t === 'ant').length,
    };
    const page = await browser.newPage({ viewport: { width: 1200, height: 800 } });
    await page.addInitScript(() => { window.MYCELIUM_SUPABASE = { url: '', anonKey: '' }; });
    await page.goto(base + '/index.html#level,' + def.id + ',turn', { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('#loadscreen.ld-ready', { timeout: 60000 }).catch(() => {});
    await page.click('#loadscreen', { timeout: 5000 }).catch(() => {});
    await page.waitForFunction(() => window.__game && window.__game.state && window.__game.state.active, null, { timeout: 30000 }).catch(() => {});

    const res = await page.evaluate((steps) => {
      const g = window.__game, s = g.state;
      const count = () => ({ clouds: s.clouds.length, worms: s.nematodes.length, ants: (s.ants || []).length });
      const at0 = count();
      // Peak rather than final: a cloud is SPENT when it infects and fades, so a stray that
      // arrived and went would leave the closing count looking innocent.
      //
      // Counted only UNTIL A WORM FIRST FEEDS. Breeding is the designed multiplication —
      // nematodes.breedChance splits a worm every tick it is in contact with the colony — so a
      // worm born while one is eating is the level working, not an uninvited arrival, and a peak
      // that ignored the difference would call L7's design a bug. Everything after the first
      // bite is the player's problem; everything before it is the level's promise.
      let peak = { ...at0 }, fed = false, fedAt = -1;
      for (let i = 0; i < steps; i++) {
        g.tickWorld(s, 'both');
        if (!fed && s.nematodes.some((w) => w.feeding)) { fed = true; fedAt = i; }
        if (fed) continue;
        const c = count();
        peak = { clouds: Math.max(peak.clouds, c.clouds), worms: Math.max(peak.worms, c.worms), ants: Math.max(peak.ants, c.ants) };
      }
      const cfg = s.config;
      return { at0, peak, fed, fedAt, endWorms: s.nematodes.length,
        ceilings: { trych: cfg.trichoderma.initialPatches, worms: cfg.nematodes.initialCount, ants: cfg.ants.nestCount },
        respawn: { cloud: cfg.trichoderma.respawnChance, worm: cfg.nematodes.respawnChance } };
    }, STEPS);

    const L = `L${def.campaignLevel} ${def.id}`;
    ok(`${L}: opens with exactly what the JSON places`,
      res.at0.clouds === want.clouds && res.at0.worms === want.worms && res.at0.ants === want.ants,
      `${res.at0.clouds}t/${res.at0.worms}w/${res.at0.ants}a vs JSON ${want.clouds}t/${want.worms}w/${want.ants}a`);
    ok(`${L}: respawn is off, so nothing arrives uninvited`,
      res.respawn.cloud === 0 && res.respawn.worm === 0,
      `cloud ${res.respawn.cloud}, worm ${res.respawn.worm}`);
    // The one that would have caught the reported bug: the peak over a long run.
    ok(`${L}: no extra creature appears${res.fed ? ` in the ${res.fedAt} steps before a worm bites` : ` in ${STEPS} steps`}`,
      res.peak.clouds <= want.clouds && res.peak.worms <= want.worms && res.peak.ants <= want.ants,
      `peak ${res.peak.clouds}t/${res.peak.worms}w/${res.peak.ants}a (placed ${want.clouds}t/${want.worms}w/${want.ants}a)` +
      (res.fed ? `; a worm reached the colony at step ${res.fedAt} and bred to ${res.endWorms} — that is the design, not a stray` : ''));
    await page.close();
  }

  await browser.close();
  srv.close();
  console.log(`\n  ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
