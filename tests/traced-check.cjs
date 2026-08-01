/* The TRACED maps — every docs/levels/*.json carrying a `traced` block, i.e. every level
 * whose geometry came out of scripts/trace-map.py rather than a designer's hands.
 *
 * A traced map fails differently from a hand-authored one. Nobody chose these shapes, so
 * the questions aren't "is the design intact" but "did the trace survive contact with the
 * engine":
 *   • does the open space still run entry -> goal once collision comes from the sprites'
 *     ALPHA at 9px rather than from the pixels the tracer flood-filled?
 *   • is every food pile reachable, or did one land in a sealed pocket?
 *   • does any sprite overlap a pathClear channel — rock you can see and walk through?
 *   • does the map reach both channels, or is there a free lane down one side?
 *   • did every sprite decode at all (the mask waits for all of them)?
 *
 * It walks the folder rather than naming maps, so tracing another one is covered the
 * moment its JSON lands. Screenshots (tests/.artifacts/traced-<id>-*.png) are the other
 * half — look at them; several defects here were only ever visible in a rendered frame.
 */
const http = require('http'), fs = require('fs'), path = require('path');
const { chromium } = require('playwright');
const ROOT = path.resolve(__dirname, '..');
const ART = path.join(__dirname, '.artifacts');
const T = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.svg': 'image/svg+xml', '.webp': 'image/webp', '.mp3': 'audio/mpeg', '.wav': 'audio/wav' };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let pass = 0, fail = 0;
const ok = (n, c, x) => { c ? (pass++, console.log('  PASS  ' + n + (x ? '  — ' + x : ''))) : (fail++, console.log('  FAIL  ' + n + (x ? '  — ' + x : ''))); };

const LEVELDIR = path.join(ROOT, 'docs', 'levels');
const ALL = fs.readdirSync(LEVELDIR).filter((f) => f.endsWith('.json'))
  .map((f) => JSON.parse(fs.readFileSync(path.join(LEVELDIR, f), 'utf8')));
const TRACED = ALL.filter((l) => l && l.traced);

(async () => {
  fs.mkdirSync(ART, { recursive: true });
  const srv = await new Promise((res) => { const s = http.createServer((rq, rs) => { let p = decodeURIComponent(rq.url.split('?')[0].split('#')[0]); if (p === '/') p = '/index.html'; const fp = path.join(ROOT, p); if (!fp.startsWith(ROOT) || !fs.existsSync(fp) || fs.statSync(fp).isDirectory()) { rs.writeHead(404); rs.end('nf'); return; } rs.writeHead(200, { 'Content-Type': T[path.extname(fp)] || 'application/octet-stream' }); fs.createReadStream(fp).pipe(rs); }); s.listen(0, () => res(s)); });
  const base = 'http://localhost:' + srv.address().port;
  const browser = await chromium.launch({ headless: true });

  ok('there is at least one traced map to check', TRACED.length > 0,
    TRACED.map((l) => l.id).join(', ') || 'none — did gen-levels/trace-map run?');

  // ---------------------------------------------------- JSON ↔ manifest ↔ disk ----
  // A traced map is written in three places that must agree: the level JSON names sprite
  // keys, the manifest maps each key to a file, and the file has to exist. trace-map.py
  // writes all three, so they only diverge when it dies part-way — which it does silently
  // if you pipe it through `head`, since the level JSON is written before the manifest.
  // The symptom is a 404 per missing sprite at boot and a mask that never solidifies, and
  // it is worth naming rather than rediscovering.
  const MAN = JSON.parse(fs.readFileSync(path.join(ROOT, 'assets', 'manifest.json'), 'utf8'));
  const byKey = new Map(MAN.assets.map((e) => [e.key, e.file]));
  // Traced maps carry NO food, threats or rockface — the tracer stopped placing them and the
  // owner does it by hand in the editor. The food assertion below therefore passes on 0 of 0
  // for a fresh trace, which is correct but says nothing; it starts meaning something again
  // the moment a map has food placed in it.
  for (const def of TRACED) {
    const keys = def.objects.filter((o) => o.key).map((o) => o.key);
    const noEntry = keys.filter((k) => !byKey.has(k));
    const noFile = keys.filter((k) => byKey.has(k) && !fs.existsSync(path.join(ROOT, 'assets', byKey.get(k))));
    const orphans = MAN.assets.filter((e) => e.key.startsWith(def.id + 'R') && !keys.includes(e.key));
    ok(`${def.id}: every sprite key is in the manifest`, noEntry.length === 0,
      `${noEntry.length} missing: ${noEntry.slice(0, 3).join(', ')}`);
    ok(`${def.id}: every manifest file exists on disk`, noFile.length === 0,
      `${noFile.length} missing: ${noFile.slice(0, 3).join(', ')}`);
    ok(`${def.id}: no stale manifest entries left behind`, orphans.length === 0,
      `${orphans.length} orphaned: ${orphans.slice(0, 3).map((e) => e.key).join(', ')}`);
  }

  for (const def of TRACED) {
    const ID = def.id;
    console.log(`\n  ── ${ID} (${def.name}) ──`);
    const page = await browser.newPage({ viewport: { width: 1800, height: 1100 } });
    const errs = [];
    page.on('pageerror', (e) => errs.push(String(e && e.message)));
    page.on('console', (m) => { if (m.type() === 'error') errs.push('console:' + m.text()); });
    await page.addInitScript(() => { window.MYCELIUM_SUPABASE = { url: '', anonKey: '' }; });
    await page.goto(base + '/index.html#level,' + ID, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('#loadscreen.ld-ready', { timeout: 60000 }).catch(() => {});
    await page.click('#loadscreen', { timeout: 5000 }).catch(() => {});
    await page.waitForFunction(() => window.__game && window.__game.state && window.__game.state.active, null, { timeout: 30000 }).catch(() => {});

    // The mask is built on the first frame where EVERY rock sprite has decoded. That is
    // the slowest part of the boot, and until it lands every wall reads as open — so
    // nothing below means anything until this resolves.
    const solid = await page.waitForFunction(() => window.__game.state.substrate._rockSolidified === true, null, { timeout: 60000 }).then(() => true).catch(() => false);

    ok(`${ID}: boots from #level,${ID}`, await page.evaluate((id) => {
      const s = window.__game.state;
      return !!(s && s.levelDef && s.levelDef.id === id && s.substrate.authored);
    }, ID));
    ok(`${ID}: boots with no page errors`, errs.length === 0, errs.slice(0, 3).join(' | ') || 'none');
    ok(`${ID}: every sprite decoded (mask solidified)`, solid);

    // Compare against the JSON on disk rather than numbers typed in here: the tracer's
    // blob count moves whenever the threshold, --min-area or --trim does, and a check that
    // needs hand-editing after every re-trace is one that goes stale instead of run.
    const wantSprites = def.objects.filter((o) => o.t === 'boulder' || o.t === 'formation').length;
    const geo = await page.evaluate(() => {
      const sub = window.__game.state.substrate;
      return { cols: sub.cols, rows: sub.rows, sprites: sub.levelSprites.length };
    });
    ok(`${ID}: every rock in the JSON reached the level list`, geo.sprites === wantSprites,
      `${geo.sprites}/${wantSprites} sprites, ${geo.cols}×${geo.rows} cells`);

    // Everything below floods the FINE mask (substrate._fineSolid, 9px cells — the grid
    // growth actually collides against), inside the page so the mask never crosses the
    // bridge. This is the assertion the tracer's own flood-fill can only approximate: it
    // filled image pixels, this fills what the game built out of the sprite alpha.
    const res = await page.evaluate(() => {
      const sub = window.__game.state.substrate;
      const fsz = sub._fineSize, FC = sub._fineCols, FR = sub._fineRows, mask = sub._fineSolid;
      const surfaceY = sub.surfaceY, cs = sub.cellSize;
      const openAt = (fc, fr) => fc >= 0 && fr >= 0 && fc < FC && fr < FR && mask[fr * FC + fc] === 0;

      function flood(x, y) {
        const seen = new Uint8Array(FC * FR);
        const c0 = Math.floor(x / fsz), r0 = Math.floor((y - surfaceY) / fsz);
        if (!openAt(c0, r0)) return null;
        const q = [c0 * FR + r0]; seen[r0 * FC + c0] = 1;
        let n = 0;
        while (q.length) {
          const v = q.pop(), c = (v / FR) | 0, r = v % FR; n++;
          for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
            const nc = c + dc, nr = r + dr;
            if (!openAt(nc, nr) || seen[nr * FC + nc]) continue;
            seen[nr * FC + nc] = 1; q.push(nc * FR + nr);
          }
        }
        return { n, reaches: (x2, y2) => !!seen[Math.floor((y2 - surfaceY) / fsz) * FC + Math.floor(x2 / fsz)] };
      }

      const root = window.__game.state.active.nodes[0];
      const f = flood(root.x, root.y);
      const goalX = sub.worldWidth - cs * 2;
      const piles = [];
      for (let c = 0; c < sub.cols; c++) for (let r = 0; r < sub.rows; r++) {
        const cell = sub.cellAt(c, r);
        if (cell && cell.maxNutrient > 0) piles.push(sub.cellCenter(c, r));
      }
      const unreachable = f ? piles.filter((p) => !f.reaches(p.x, p.y)).length : piles.length;

      // Sprites drawn over a pathClear channel render as rock you walk through. The
      // channels are cols [0, startCols+1) and the last goalCols+1 — buildLevel's own
      // clearChannel bounds, not the layout numbers, which are one cell narrower.
      const lay = (window.__game.state.levelDef || {}).layout || {};
      const entryX = (sub.startCols + 1) * cs;
      const goalEdge = sub.worldWidth - ((lay.goalCols != null ? lay.goalCols : 6) + 1) * cs;
      // EPS because a sprite flush with a channel reconstructs as x - w/2 = 107.99999999999999
      // against an entry of 108: x and w are stored, the edge is recomputed, and IEEE754 does
      // the rest. A hundredth of a world unit is far below the 9px grid collision samples.
      const EPS = 0.01;
      const overlap = sub.levelSprites.filter((s) =>
        (s.x - s.w / 2) < entryX - EPS || (s.x + s.w / 2) > goalEdge + EPS).length;
      const gapL = Math.min(...sub.levelSprites.map((s) => s.x - s.w / 2)) - entryX;
      const gapR = goalEdge - Math.max(...sub.levelSprites.map((s) => s.x + s.w / 2));

      let solidN = 0;
      for (let i = 0; i < mask.length; i++) if (mask[i]) solidN++;

      return {
        floods: !!f, size: f ? f.n : 0, total: FC * FR,
        reachesGoal: f ? [60, 300, 700].some((dy) => f.reaches(goalX, surfaceY + dy)) : false,
        piles: piles.length, unreachable, overlap,
        gapL: Math.round(gapL), gapR: Math.round(gapR), cs,
        rockPct: Math.round(1000 * solidN / mask.length) / 10,
      };
    });

    ok(`${ID}: the colony sits in open soil`, res.floods);
    ok(`${ID}: open space runs colony → goal channel`, res.reachesGoal,
      `reachable region is ${Math.round(100 * res.size / res.total)}% of the underground`);
    ok(`${ID}: every food cell is reachable`, res.unreachable === 0, `${res.unreachable} of ${res.piles} sealed off`);
    ok(`${ID}: no sprite overlaps a pathClear channel`, res.overlap === 0, `${res.overlap} overlapping`);
    ok(`${ID}: reaches both channels (no free lane down either side)`,
      res.gapL < res.cs && res.gapR < res.cs, `${res.gapL}px / ${res.gapR}px (< ${res.cs} = one cell)`);
    ok(`${ID}: rock covers a playable share`, res.rockPct > 15 && res.rockPct < 60, `${res.rockPct}% solid`);

    // ------------------------------------------------------------- screenshots ----
    await page.waitForSelector('#levelIntro', { timeout: 15000 }).catch(() => {});
    for (let i = 0; i < 6 && await page.$('#levelIntro'); i++) { await page.mouse.click(900, 300); await sleep(1000); }
    ok(`${ID}: the level intro dismisses`, !(await page.$('#levelIntro')));

    const shoot = async (name, x, y, zoom) => {
      await page.evaluate(({ x, y, zoom }) => {
        const cam = window.__game.camera; cam.zoom = zoom; cam.x = x; cam.y = y; cam.clamp();
      }, { x, y, zoom });
      await sleep(700);
      // timeout + animations:disabled, or this hangs. Playwright's default screenshot waits
      // for fonts and for animations to settle, and against a live rAF loop it can wait
      // forever — at 59 levels the run died here, on the 47th, AFTER that level had passed
      // all its assertions. The check then printed no tally at all, which the runner reports
      // as "did not report" and is easy to read as a pass. Same fix as tests/level-shots.cjs.
      await page.screenshot({ path: path.join(ART, `traced-${ID}-${name}.png`),
                              timeout: 30000, animations: 'disabled' }).catch(() => {});
    };
    await shoot('overview', def.world.width / 2, def.world.surfaceY + 550, 0.6);
    // The zoom the game is actually PLAYED at — where both the resolution and the bright
    // edge-ring defects showed up, and neither was visible in an overview.
    await shoot('closeup', 900, 700, 2.2);
    console.log(`  shots → tests/.artifacts/traced-${ID}-*.png`);
    await page.close();
  }

  // ------------------------------------------------- the picker's dev button ----
  // The only in-game route to a map with no campaign slot. Fresh page: this one goes
  // through the title screen, and the runs above left a level up.
  console.log('\n  ── picker dev buttons ──');
  const page2 = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  const errs2 = [];
  page2.on('pageerror', (e) => errs2.push(String(e && e.message)));
  await page2.addInitScript(() => { window.MYCELIUM_SUPABASE = { url: '', anonKey: '' }; });
  await page2.goto(base + '/index.html', { waitUntil: 'domcontentloaded' });
  await page2.waitForSelector('#loadscreen.ld-ready', { timeout: 60000 }).catch(() => {});
  await page2.click('#loadscreen', { timeout: 5000 }).catch(() => {});
  await page2.waitForSelector('#tsNewRt', { timeout: 20000 }).catch(() => {});
  await page2.click('#tsNewRt').catch(() => {});
  // "New" opens the name prompt first — the picker is behind it, not behind the button.
  await page2.waitForSelector('#tsNameStart', { timeout: 20000 }).catch(() => {});
  await page2.fill('#tsNameInput', 'DEV').catch(() => {});
  await page2.click('#tsNameStart').catch(() => {});
  await page2.waitForSelector('#speciesSelect', { timeout: 20000 }).catch(() => {});

  const btns = await page2.$$eval('.ss-dev-l', (els) => els.map((e) => ({
    text: e.textContent.trim(), left: Math.round(e.getBoundingClientRect().left),
    top: Math.round(e.getBoundingClientRect().top),
  }))).catch(() => []);
  ok('one dev button per authored map', btns.length === ALL.length,
    `${btns.length} buttons for ${ALL.length} maps: ${btns.map((b) => b.text).join(' / ') || 'none'}`);
  ok('they sit on the LEFT edge', btns.length > 0 && btns.every((b) => b.left < 60), btns.map((b) => b.left + 'px').join(', '));
  ok('they stack without overlapping', new Set(btns.map((b) => b.top)).size === btns.length,
    btns.map((b) => b.top + 'px').join(', '));
  await page2.screenshot({ path: path.join(ART, 'traced-picker.png') });

  const first = TRACED[0] && btns.findIndex((b) => b.text.includes(TRACED[0].name));
  if (first >= 0) {
    await page2.click('#ssDevMap' + first);
    const started = await page2.waitForFunction((id) => {
      const s = window.__game && window.__game.state;
      return !!(s && s.levelDef && s.levelDef.id === id);
    }, TRACED[0].id, { timeout: 30000 }).then(() => true).catch(() => false);
    ok('clicking one starts that map', started, TRACED[0].id);
    ok('no page errors on that route', errs2.length === 0, errs2.slice(0, 2).join(' | ') || 'none');
  }

  await browser.close();
  srv.close();
  console.log(`\n==== ${pass} passed, ${fail} failed ====`);
  process.exit(fail ? 1 : 0);
})();
