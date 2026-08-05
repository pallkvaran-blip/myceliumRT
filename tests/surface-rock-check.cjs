/* NO BUILDING STANDS ON ROCK THE SOIL LINE CUTS.
 *
 *   node tests/surface-rock-check.cjs                 # every campaign map
 *   node tests/surface-rock-check.cjs campaign-09     # just the ones whose id matches
 *
 * Owner: "let's not place buildings over underground rocks that are being clipped by the ground
 * line. it looks weird - better to have mountains on those spots."
 *
 * An authored map's rock is a SPRITE, dragged by hand, and drawLevelRocks clips it at surfaceY.
 * A boulder placed high therefore ends in a flat horizontal cut along the horizon, and a city
 * skyline standing on that cut reads as a building balanced on a sawn-off rock. A mountain over
 * the same spot reads as the rock carrying on up into the sky, which is what it looks like it is
 * doing. Survival can never hit this: its rock lives in CELLS, which stop at the soil line by
 * construction, so nothing there is ever cut by it.
 *
 * WHAT MAKES THIS CHECK WORTH ITS RUNTIME is that the rule is invisible in the level JSON. The
 * cut is a property of the sprite's ALPHA, and a boulder's BOUNDING BOX is mostly transparent —
 * the box test (`y - h/2 < surfaceY`) claims 56 of 82 columns on campaign-01 where the drawn
 * rock cuts 50, and claims none at all on campaign-04 where 12 columns still reach the line.
 * So the only way to ask the question is to sample the alpha with the draw's own geometry, and
 * the only place that alpha exists is the running game (`__game.rockArt`).
 *
 * It follows that MOVING A ROCK CAN BREAK THIS WITHOUT TOUCHING A CITY. Re-run
 * `node scripts/author-campaign-surface.mjs` after any rock edit; this is what tells you that
 * you needed to.
 *
 * Two things are asserted, and the second is the one that catches a lazy fix:
 *   • no city column carries cut rock — the rule itself;
 *   • every cut column INSIDE THE BAND is under a mountain — so "delete all the cities" does not
 *     pass. The band is the only place either can go: outside it the home hill and the goal
 *     approach draw their own art, so a cut column out there needs nothing and can have nothing.
 */
const http = require('http'), fs = require('fs'), path = require('path');
const { chromium } = require('playwright');
const ROOT = path.resolve(__dirname, '..');
const T = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.png': 'image/png',
  '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.webp': 'image/webp', '.mp3': 'audio/mpeg', '.wav': 'audio/wav' };
let pass = 0, fail = 0;
const ok = (n, c, x) => { c ? (pass++, console.log('  PASS  ' + n + (x ? '  — ' + x : ''))) : (fail++, console.log('  FAIL  ' + n + (x ? '  — ' + x : ''))); };

const ROCK_ALPHA = 40;   // same cut-off the authoring script uses; this only decides what the eye sees
const LEVELDIR = path.join(ROOT, 'docs', 'levels');
const only = process.argv.slice(2).filter((a) => !a.startsWith('-'));
const LV = fs.readdirSync(LEVELDIR).filter((f) => /^campaign-\d\d-.*\.json$/.test(f)).sort()
  .map((f) => JSON.parse(fs.readFileSync(path.join(LEVELDIR, f), 'utf8')))
  .filter((l) => !only.length || only.some((o) => l.id.includes(o)));

const toRuns = (cols) => {
  const runs = [];
  for (const c of [...cols].sort((a, b) => a - b)) {
    const last = runs[runs.length - 1];
    if (last && c === last[1] + 1) last[1] = c; else runs.push([c, c]);
  }
  return runs;
};

(async () => {
  const srv = await new Promise((res) => { const s = http.createServer((rq, rs) => { let p = decodeURIComponent(rq.url.split('?')[0].split('#')[0]); if (p === '/') p = '/index.html'; const fp = path.join(ROOT, p); if (!fp.startsWith(ROOT) || !fs.existsSync(fp) || fs.statSync(fp).isDirectory()) { rs.writeHead(404); rs.end('nf'); return; } rs.writeHead(200, { 'Content-Type': T[path.extname(fp)] || 'application/octet-stream' }); fs.createReadStream(fp).pipe(rs); }); s.listen(0, () => res(s)); });
  const base = 'http://localhost:' + srv.address().port;
  const browser = await chromium.launch({ headless: true, executablePath: '/opt/pw-browsers/chromium' });

  ok('there is at least one campaign map to check', LV.length > 0, LV.map((l) => l.id).join(', ') || 'none');

  for (const def of LV) {
    const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
    const errs = [];
    page.on('pageerror', (e) => errs.push(String(e && e.message)));
    await page.addInitScript(() => { window.MYCELIUM_SUPABASE = { url: '', anonKey: '' }; });
    await page.goto(base + '/index.html#level,' + def.id, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('#loadscreen.ld-ready', { timeout: 60000 }).catch(() => {});
    await page.click('#loadscreen', { timeout: 5000 }).catch(() => {});
    await page.waitForFunction(() => window.__game && window.__game.state && window.__game.state.active, null, { timeout: 30000 }).catch(() => {});

    const r = await page.evaluate(async (A) => {
      const g = window.__game, sub = g.state.substrate;
      // Nothing below means anything until every sprite has decoded — solidifyRock runs during
      // RENDER and loadLevelAssets is not awaited, so measuring early reads an empty map and
      // every assertion here passes vacuously.
      for (let i = 0; i < 200 && !sub._rockSolidified; i++) {
        try { g.renderFrame(); } catch (_) {}
        await new Promise((r) => setTimeout(r, 50));
      }
      const cs = sub.cellSize, cols = sub.cols, sy = sub.surfaceY;
      const cut = new Set();
      for (const s of sub.levelSprites) {
        if ((s.y - s.h / 2) >= sy) continue;
        const m = g.rockArt(s.key); if (!m) continue;
        const cos = Math.cos(-(s.rot || 0)), sin = Math.sin(-(s.rot || 0));
        for (let py = 0; py < m.mh; py++) for (let px = 0; px < m.mw; px++) {
          if (m.data[(py * m.mw + px) * 4 + 3] < A) continue;
          const lx = (px + 0.5) / m.mw * s.w - s.w / 2, ly = (py + 0.5) / m.mh * s.h - s.h / 2;
          const wx = s.x + lx * cos + ly * sin, wy = s.y - lx * sin + ly * cos;
          if (wy >= sy) continue;
          const c = Math.floor(wx / cs);
          if (c >= 0 && c < cols) cut.add(c);
        }
      }
      // The spans the loader itself derived, not the JSON's x/w — this asks about the world that
      // was built, which is what the player sees.
      const span = (o) => [Math.floor((o.x - o.w / 2) / cs), Math.ceil((o.x + o.w / 2) / cs) - 1];
      const objs = (g.state.levelDef && g.state.levelDef.objects) || [];
      const cityCols = new Set(), mtnCols = new Set();
      for (const o of objs) {
        if (o.t !== 'city' && o.t !== 'mountain') continue;
        const [a, b] = span(o);
        for (let c = Math.max(0, a); c <= Math.min(cols - 1, b); c++) (o.t === 'city' ? cityCols : mtnCols).add(c);
      }
      // The band the dark-world surface may decorate — the same bounds the authoring script uses.
      const lay = g.state.levelDef && g.state.levelDef.layout || {};
      const goalCols = Math.max(2, Math.min(cols - 4, lay.goalCols || 6));
      const startCols = Math.max(1, Math.min(cols - goalCols - 1, lay.startCols || 2));
      const goalStart = cols - goalCols;
      const summerCols = Math.max(0, Math.min(goalStart - startCols - 2, lay.summerCols != null ? lay.summerCols : 7));
      const bandLo = Math.max(6, startCols + 4), bandHi = goalStart - summerCols - 1;
      return { solid: !!sub._rockSolidified, cols, bandLo, bandHi,
               cut: [...cut].sort((a, b) => a - b),
               cities: [...cityCols].sort((a, b) => a - b),
               mountains: [...mtnCols].sort((a, b) => a - b),
               nCity: objs.filter((o) => o.t === 'city').length,
               nMtn: objs.filter((o) => o.t === 'mountain').length };
    }, ROCK_ALPHA);

    ok(`${def.id}: the rock mask is built (nothing below means anything otherwise)`, r.solid === true);
    const cutSet = new Set(r.cut);
    const onCut = r.cities.filter((c) => cutSet.has(c));
    ok(`${def.id}: no city stands on rock the soil line cuts`, onCut.length === 0,
      `${onCut.length} of ${r.cities.length} city column(s) over cut rock` +
      (onCut.length ? ': ' + JSON.stringify(toRuns(onCut)) : ` · ${r.nCity} skyline(s), ${r.cut.length} cut col(s)`));

    const mtnSet = new Set(r.mountains);
    const bare = r.cut.filter((c) => c >= r.bandLo && c <= r.bandHi && !mtnSet.has(c));
    ok(`${def.id}: every cut column in the band has a mountain on it`, bare.length === 0,
      bare.length ? `${bare.length} bare: ${JSON.stringify(toRuns(bare))}` :
        `${r.nMtn} mountain(s) cover cols ${r.bandLo}-${r.bandHi}`);
    ok(`${def.id}: no page errors`, errs.length === 0, errs.slice(0, 2).join(' | ') || 'none');
    await page.close();
  }

  await browser.close();
  srv.close();
  console.log(`\n==== ${pass} passed, ${fail} failed ====`);
  process.exit(fail ? 1 : 0);
})();
