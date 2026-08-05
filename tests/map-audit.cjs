/* Per-map audit: ant trails on drawn rock, and food/water that holes a wall.
 *
 *   node tests/map-audit.cjs                       # every campaign level, in slot order
 *   node tests/map-audit.cjs 2-obsidian rust-c90   # just these
 *
 * A TOOL, not a check: it prints numbers and never fails, so it is not in the runner. It exists
 * because these two questions come up after every hand-off of maps and the answers are only
 * reachable from inside the running game:
 *
 *   ants   — `__game.auditAnts()` samples each nest's BUILT trail against `solidAtWorld`, the mask
 *            stamped from the sprites' own alpha. Read at level OPEN with no action taken, which is
 *            the window the trail bug lived in: the opening trail is planned at BUILD time, before
 *            any frame has drawn, so it is planned against the COARSE grid however carefully
 *            buildTrail tests it. Two numbers, because they failed independently — sampled points
 *            along the drawn line, and stamped `cell.antTrail` cells (which are also the nematodes'
 *            secondary attractor, so a wrong stamp is not merely cosmetic).
 *   rock   — `__game.auditRocks()` finds food and water markers sitting inside rock. markCoverGrid
 *            skips any cell holding either ("never bury a food pile"), while the art still draws
 *            over it — so a pile dropped inside a boulder leaves a hole you can see through and grow
 *            through in a wall that still looks solid. It cannot be caught at stamp time (buildLevel
 *            runs before the sprites load), which is why it is caught here.
 */
const http = require('http'), fs = require('fs'), path = require('path');
const { chromium } = require('playwright');
const ROOT = path.resolve(__dirname, '..');
const T = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.webp': 'image/webp', '.mp3': 'audio/mpeg', '.wav': 'audio/wav' };

// Default: the campaign, in slot order, read from the levels the game actually ships.
function campaignIds() {
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const m = html.match(/const LEVELS = (\[[\s\S]*?\n\]);/);
  if (!m) return [];
  const levels = JSON.parse(m[1]);
  return levels.filter((l) => l.campaignLevel != null)
    .sort((a, b) => a.campaignLevel - b.campaignLevel).map((l) => l.id);
}

const args = process.argv.slice(2).filter((a) => !a.startsWith('-'));
const IDS = args.length ? args : campaignIds();

(async () => {
  const srv = await new Promise((res) => { const s = http.createServer((rq, rs) => { let p = decodeURIComponent(rq.url.split('?')[0].split('#')[0]); if (p === '/') p = '/index.html'; const fp = path.join(ROOT, p); if (!fp.startsWith(ROOT) || !fs.existsSync(fp) || fs.statSync(fp).isDirectory()) { rs.writeHead(404); rs.end('nf'); return; } rs.writeHead(200, { 'Content-Type': T[path.extname(fp)] || 'application/octet-stream' }); fs.createReadStream(fp).pipe(rs); }); s.listen(0, () => res(s)); });
  const base = 'http://localhost:' + srv.address().port;
  const browser = await chromium.launch({ headless: true });
  console.log(`auditing ${IDS.length} map(s)\n`);
  let dirty = 0;
  for (const id of IDS) {
    const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
    const errs = [];
    page.on('pageerror', (e) => errs.push(String(e && e.message)));
    await page.addInitScript(() => { window.MYCELIUM_SUPABASE = { url: '', anonKey: '' }; });
    await page.goto(base + '/index.html#level,' + id + ',turn', { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('#loadscreen.ld-ready', { timeout: 60000 }).catch(() => {});
    await page.click('#loadscreen', { timeout: 5000 }).catch(() => {});
    await page.waitForFunction(() => window.__game && window.__game.state && window.__game.state.active, null, { timeout: 40000 }).catch(() => {});
    // Both audits need the FINE mask, which solidifyRock publishes during a render — so wait for it
    // rather than for a timer. Nothing is stepped: this is the state the level opens in.
    const solid = await page.waitForFunction(() => window.__game.state.substrate._rockSolidified === true, null, { timeout: 60000 }).then(() => true).catch(() => false);
    const r = await page.evaluate((ok) => {
      const G = window.__game, s = G.state;
      const ants = ok && G.auditAnts ? G.auditAnts() : null;
      const rocks = ok && G.auditRocks ? G.auditRocks() : null;
      const count = (t) => (s.levelDef && s.levelDef.objects || []).filter((o) => o.t === t).length;
      return {
        ants, rocks, solid: ok,
        nests: (s.ants || []).length, worms: (s.nematodes || []).length, clouds: (s.clouds || []).length,
      };
    }, solid);
    const a = r.ants || {};
    const onRock = (a.nests || []).reduce((x, n) => x + (n.onRock || 0), 0);
    const holing = r.rocks ? (r.rocks.holing != null ? r.rocks.holing : (r.rocks.bad || []).length) : '?';
    const bad = onRock > 0 || a.trailOnRock > 0 || (typeof holing === 'number' && holing > 0);
    if (bad) dirty++;
    console.log(`${id.padEnd(28)} nests ${String(r.nests).padStart(2)} · worms ${String(r.worms).padStart(2)} · clouds ${String(r.clouds).padStart(2)}` +
      ` | trail on rock: ${onRock} pts, ${a.trailOnRock == null ? '?' : a.trailOnRock}/${a.trailCells == null ? '?' : a.trailCells} cells` +
      ` | food/water holing rock: ${holing}` +
      (r.solid ? '' : '  (MASK NEVER BUILT)') + (bad ? '   *** LOOK ***' : ''));
    if (errs.length) console.log('    page errors: ' + errs.slice(0, 2).join(' | '));
    await page.close();
  }
  console.log(`\n${dirty} of ${IDS.length} map(s) want a look.`);
  await browser.close();
  srv.close();
})();
