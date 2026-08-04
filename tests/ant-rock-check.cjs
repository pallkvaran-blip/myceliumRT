/* Ant trails vs DRAWN rock.
 *
 *   node tests/ant-rock-check.cjs            # every level below
 *   node tests/ant-rock-check.cjs antroad    # just the ones whose id matches
 *
 * A nest's trail is a BFS over cells, and a cell is not what the player sees: rock SPRITES
 * overhang the cells they are flagged on, so a path can be legal on the coarse `cell.rock` grid
 * and still run visibly through a boulder. buildTrail already tests each step against the fine
 * `solidAtWorld` mask for exactly that reason — destination and midpoint both.
 *
 * The failure this check exists for is not a missing test, it is a TIMING one, and it is invisible
 * in the code that has the test in it. `solidAtWorld` falls back to the coarse flag whenever the
 * fine mask does not exist yet:
 *
 *     solidAtWorld(x, y) { const fs = this._fineSolid; if (!fs) { …return !!(c && c.rock); } … }
 *
 * and the mask is published by solidifyRock during RENDER, while placeAntNests → retarget →
 * buildTrail runs at BUILD time, before any frame has drawn. So a nest's FIRST trail is always
 * plotted against the coarse grid however carefully buildTrail tests it, and on a map whose rock
 * is a traced sprite — where coarse and fine disagree most — the ants come out walking over the
 * rocks. It corrects itself only if the nest happens to retarget later.
 *
 * So: boot, wait for the mask, let the line lay itself, then assert that no part of the BUILT
 * trail sits on drawn rock. Asserted against `solidAtWorld` rather than against a screenshot
 * because that IS the thing the art is matched to.
 */
const http = require('http'), fs = require('fs'), path = require('path');
const { chromium } = require('playwright');
const ROOT = path.resolve(__dirname, '..');
const ART = path.join(__dirname, '.artifacts');
const T = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.webp': 'image/webp', '.mp3': 'audio/mpeg', '.wav': 'audio/wav' };
let pass = 0, fail = 0;
const ok = (n, c, x) => { c ? (pass++, console.log('  PASS  ' + n + (x ? '  — ' + x : ''))) : (fail++, console.log('  FAIL  ' + n + (x ? '  — ' + x : ''))); };

// Boot hashes that put an ant nest on the map. The procedural dev start is included because the
// campaign's own maps are procedural and carry nests from LEVEL_THREATS; the authored one is
// included because a TRACED map is where the coarse and fine masks disagree most.
const CASES = [
  { id: 'antroad', hash: 'level,challenge-antroad,turn', note: 'authored, traced rock' },
  { id: 'procedural', hash: 'dev,notrich,turn', note: 'procedural dev start' },
];
const only = process.argv.slice(2).filter((a) => !a.startsWith('-'));
const RUN = CASES.filter((c) => !only.length || only.some((o) => c.id.includes(o)));

(async () => {
  fs.mkdirSync(ART, { recursive: true });
  const srv = await new Promise((res) => { const s = http.createServer((rq, rs) => { let p = decodeURIComponent(rq.url.split('?')[0].split('#')[0]); if (p === '/') p = '/index.html'; const fp = path.join(ROOT, p); if (!fp.startsWith(ROOT) || !fs.existsSync(fp) || fs.statSync(fp).isDirectory()) { rs.writeHead(404); rs.end('nf'); return; } rs.writeHead(200, { 'Content-Type': T[path.extname(fp)] || 'application/octet-stream' }); fs.createReadStream(fp).pipe(rs); }); s.listen(0, () => res(s)); });
  const base = 'http://localhost:' + srv.address().port;
  const browser = await chromium.launch({ headless: true });

  for (const c of RUN) {
    console.log(`\n  ── ${c.id} (${c.note}) ──`);
    const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
    const errs = [];
    page.on('pageerror', (e) => errs.push(String(e && e.message)));
    await page.addInitScript(() => { window.MYCELIUM_SUPABASE = { url: '', anonKey: '' }; });
    await page.goto(base + '/index.html#' + c.hash, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('#loadscreen.ld-ready', { timeout: 60000 }).catch(() => {});
    await page.click('#loadscreen', { timeout: 5000 }).catch(() => {});
    await page.waitForFunction(() => window.__game && window.__game.state && window.__game.state.active, null, { timeout: 30000 }).catch(() => {});
    // Nothing below means anything until the fine mask exists — that is the whole subject.
    const solid = await page.waitForFunction(() => window.__game.state.substrate._rockSolidified === true, null, { timeout: 60000 }).then(() => true).catch(() => false);
    ok(`${c.id}: the fine rock mask is built`, solid);

    const nests = await page.evaluate(() => (window.__game.state.ants || []).length);
    ok(`${c.id}: has an ant nest to check`, nests > 0, `${nests} nest(s)`);
    if (!nests) { await page.close(); continue; }

    // Let the line lay itself out. It creeps a couple of cells per step, so a short run leaves
    // most of the path unbuilt and a clean reading that means nothing.
    const res = await page.evaluate(() => {
      const g = window.__game, s = g.state, sub = s.substrate;
      for (let i = 0; i < 40; i++) g.tickWorld(s, 'both');
      const out = [];
      for (const nest of (s.ants || [])) {
        const p = nest.path || [];
        const built = Math.min(p.length - 1, Math.floor(nest.built != null ? nest.built : p.length));
        let onRock = 0; const worst = [];
        for (let k = 0; k <= built && k < p.length; k++) {
          const ctr = sub.cellCenter(p[k].col, p[k].row);
          if (sub.solidAtWorld(ctr.x, ctr.y)) { onRock++; if (worst.length < 4) worst.push(`${p[k].col},${p[k].row}`); }
        }
        // What the path WOULD be if it were planned now, with the mask present. The gap between
        // this and the above is the whole bug: same function, same nest, different answer,
        // because the first run happened before the mask existed.
        out.push({ len: p.length, built, onRock, worst, target: nest.target });
      }
      // Trail CELLS as stamped (what the renderer draws the line from, and what worms follow).
      let trailOnRock = 0, trailCells = 0;
      sub.forEachCell((cell, col, row) => {
        if (!cell.antTrail) return;
        trailCells++;
        const ctr = sub.cellCenter(col, row);
        if (sub.solidAtWorld(ctr.x, ctr.y)) trailOnRock++;
      });
      return { nests: out, trailCells, trailOnRock };
    });

    for (const [i, n] of res.nests.entries()) {
      console.log(`        nest ${i}: path ${n.len} cells, ${n.built} built, ${n.onRock} on drawn rock${n.worst.length ? ' (' + n.worst.join(' ') + ')' : ''}`);
    }
    const totalOnRock = res.nests.reduce((a, n) => a + n.onRock, 0);
    ok(`${c.id}: no built trail cell sits on drawn rock`, totalOnRock === 0,
      `${totalOnRock} of ${res.nests.reduce((a, n) => a + n.built + 1, 0)} built cells are inside a boulder`);
    ok(`${c.id}: no STAMPED trail cell sits on drawn rock`, res.trailOnRock === 0,
      `${res.trailOnRock} of ${res.trailCells} stamped trail cells`);
    ok(`${c.id}: no page errors`, errs.length === 0, errs.slice(0, 2).join(' | ') || 'none');

    await page.screenshot({ path: path.join(ART, `ants-${c.id}.png`), timeout: 15000, animations: 'disabled' }).catch(() => {});
    await page.close();
  }

  await browser.close();
  srv.close();
  console.log(`\n  ${pass} passed, ${fail} failed`);
  console.log('  frames: tests/.artifacts/ants-*.png');
  process.exit(fail ? 1 : 0);
})();
