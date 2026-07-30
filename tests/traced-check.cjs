/* The TRACED map "Maze One" (docs/levels/maze-one.json, from docs/maps/maze-1.png).
 *
 * A traced map fails differently from a hand-authored one. Nobody chose these 68
 * shapes, so the questions aren't "is the design intact" but "did the trace survive
 * contact with the engine":
 *   • does the open space still run entry -> goal once collision comes from the
 *     sprites' ALPHA at 9px rather than from the pixels the tracer flood-filled?
 *   • is every food pile actually reachable, or did one land in a sealed pocket?
 *   • does any sprite overlap a pathClear channel — rock you can see and walk through?
 *   • did 68 extra sprites decode at all (the mask waits for every one of them)?
 *
 * Screenshots (tests/.artifacts/traced-*.png) are the other half — look at them.
 */
const http = require('http'), fs = require('fs'), path = require('path');
const { chromium } = require('playwright');
const ROOT = path.resolve(__dirname, '..');
const ART = path.join(__dirname, '.artifacts');
const T = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.svg': 'image/svg+xml', '.webp': 'image/webp', '.mp3': 'audio/mpeg', '.wav': 'audio/wav' };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let pass = 0, fail = 0;
const ok = (n, c, x) => { c ? (pass++, console.log('  PASS  ' + n + (x ? '  — ' + x : ''))) : (fail++, console.log('  FAIL  ' + n + (x ? '  — ' + x : ''))); };

const ID = 'maze-one';

(async () => {
  fs.mkdirSync(ART, { recursive: true });
  const srv = await new Promise((res) => { const s = http.createServer((rq, rs) => { let p = decodeURIComponent(rq.url.split('?')[0].split('#')[0]); if (p === '/') p = '/index.html'; const fp = path.join(ROOT, p); if (!fp.startsWith(ROOT) || !fs.existsSync(fp) || fs.statSync(fp).isDirectory()) { rs.writeHead(404); rs.end('nf'); return; } rs.writeHead(200, { 'Content-Type': T[path.extname(fp)] || 'application/octet-stream' }); fs.createReadStream(fp).pipe(rs); }); s.listen(0, () => res(s)); });
  const base = 'http://localhost:' + srv.address().port;
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1800, height: 1100 } });
  const errs = [];
  page.on('pageerror', (e) => errs.push(String(e && e.message)));
  page.on('console', (m) => { if (m.type() === 'error') errs.push('console:' + m.text()); });
  await page.addInitScript(() => { window.MYCELIUM_SUPABASE = { url: '', anonKey: '' }; });
  await page.goto(base + '/index.html#level,' + ID, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#loadscreen.ld-ready', { timeout: 60000 }).catch(() => {});
  await page.click('#loadscreen', { timeout: 5000 }).catch(() => {});
  await page.waitForFunction(() => window.__game && window.__game.state && window.__game.state.active, null, { timeout: 30000 }).catch(() => {});

  // The mask is built on the first frame where EVERY rock sprite has decoded. With 68
  // of them that is the slowest part of the boot, and until it lands every wall reads
  // as open — so nothing below means anything until this resolves.
  const solid = await page.waitForFunction(() => window.__game.state.substrate._rockSolidified === true, null, { timeout: 60000 }).then(() => true).catch(() => false);

  ok(`#level,${ID} boots the traced map`, await page.evaluate((id) => {
    const s = window.__game.state;
    return !!(s && s.levelDef && s.levelDef.id === id && s.substrate.authored);
  }, ID));
  ok('boots with no page errors', errs.length === 0, errs.slice(0, 3).join(' | ') || 'none');
  ok('every traced sprite decoded (mask solidified)', solid);

  // Compare against the JSON on disk rather than a number typed in here: the tracer's
  // blob count moves whenever the threshold or --min-area does, and a check that has to
  // be hand-edited after every re-trace is a check that gets stale instead of run.
  const def = JSON.parse(fs.readFileSync(path.join(ROOT, 'docs', 'levels', `${ID}.json`), 'utf8'));
  const wantSprites = def.objects.filter((o) => o.t === 'boulder' || o.t === 'formation').length;

  const geo = await page.evaluate(() => {
    const sub = window.__game.state.substrate;
    return { cols: sub.cols, rows: sub.rows, w: sub.worldWidth, h: sub.worldHeight, sprites: sub.levelSprites.length };
  });
  ok('every rock in the JSON reached the level list', geo.sprites === wantSprites,
    `${geo.sprites}/${wantSprites} sprites, ${geo.cols}×${geo.rows} cells`);

  // ------------------------------------------------------- geometry ----
  // Everything below floods the FINE mask (substrate._fineSolid, 9px cells — the grid
  // growth actually collides against), inside the page so the mask never crosses the
  // bridge. This is the assertion the tracer's own flood-fill can only approximate:
  // it filled image pixels, this fills what the game built out of the sprite alpha.
  const geoRes = await page.evaluate(() => {
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
      return { seen, n, reaches: (x2, y2) => !!seen[Math.floor((y2 - surfaceY) / fsz) * FC + Math.floor(x2 / fsz)] };
    }

    // Start from the colony itself, not from a guessed point in the entry channel.
    const net = window.__game.state.active;
    const root = net.nodes[0];
    const f = flood(root.x, root.y);
    const goalX = sub.worldWidth - cs * 2;          // inside the goal channel
    const piles = [];
    for (let c = 0; c < sub.cols; c++) for (let r = 0; r < sub.rows; r++) {
      const cell = sub.cellAt(c, r);
      if (cell && cell.maxNutrient > 0) piles.push(sub.cellCenter(c, r));
    }
    // One representative point per pile-ish cluster is enough; test them all, it's cheap.
    const unreachable = f ? piles.filter((p) => !f.reaches(p.x, p.y)).length : piles.length;

    // Sprites drawn over a pathClear channel render as rock you walk through. The
    // channels are cols [0, startCols+1) and the last goalCols+1 — buildLevel's own
    // clearChannel() bounds, not the layout numbers, which are one cell narrower.
    const lay = (window.__game.state.levelDef || {}).layout || {};
    const entryX = (sub.startCols + 1) * cs;
    const goalEdge = sub.worldWidth - ((lay.goalCols != null ? lay.goalCols : 6) + 1) * cs;
    const overlap = sub.levelSprites.filter((s) => (s.x - s.w / 2) < entryX || (s.x + s.w / 2) > goalEdge).length;
    // …and the other half of "end to end": the rock must actually REACH both channels,
    // or the map has a free lane down each side.
    const gapL = Math.min(...sub.levelSprites.map((s) => s.x - s.w / 2)) - entryX;
    const gapR = goalEdge - Math.max(...sub.levelSprites.map((s) => s.x + s.w / 2));

    // How much of the underground the rock actually took.
    let solidN = 0;
    for (let i = 0; i < mask.length; i++) if (mask[i]) solidN++;

    return {
      floods: !!f, size: f ? f.n : 0, total: FC * FR,
      reachesGoal: f ? f.reaches(goalX, surfaceY + 60) || f.reaches(goalX, surfaceY + 300) || f.reaches(goalX, surfaceY + 700) : false,
      piles: piles.length, unreachable, overlap,
      gapL: Math.round(gapL), gapR: Math.round(gapR), cs,
      rockPct: Math.round(1000 * solidN / mask.length) / 10,
    };
  });

  ok('the colony sits in open soil', geoRes.floods);
  ok('open space runs colony → goal channel', geoRes.reachesGoal,
    `reachable region is ${Math.round(100 * geoRes.size / geoRes.total)}% of the underground`);
  ok('every food cell is reachable', geoRes.unreachable === 0, `${geoRes.unreachable} of ${geoRes.piles} sealed off`);
  ok('no sprite overlaps a pathClear channel', geoRes.overlap === 0, `${geoRes.overlap} overlapping`);
  ok('the map reaches both channels (no free lane down either side)',
    geoRes.gapL < geoRes.cs && geoRes.gapR < geoRes.cs,
    `${geoRes.gapL}px to the entry channel, ${geoRes.gapR}px to the goal channel (< ${geoRes.cs} = one cell)`);
  ok('rock covers a playable share of the map', geoRes.rockPct > 20 && geoRes.rockPct < 60, `${geoRes.rockPct}% solid`);

  // ----------------------------------------------------------- screenshots ----
  await page.waitForSelector('#levelIntro', { timeout: 15000 }).catch(() => {});
  for (let i = 0; i < 6 && await page.$('#levelIntro'); i++) { await page.mouse.click(900, 300); await sleep(1000); }
  ok('the level intro dismisses', !(await page.$('#levelIntro')));

  const shoot = async (name, x, y, zoom) => {
    await page.evaluate(({ x, y, zoom }) => {
      const cam = window.__game.camera;
      cam.zoom = zoom; cam.x = x; cam.y = y; cam.clamp();
    }, { x, y, zoom });
    await sleep(700);
    await page.screenshot({ path: path.join(ART, `traced-${name}.png`) });
  };
  await shoot('overview', 1296, 930, 0.6);
  // The zoom the game is actually PLAYED at — the one that showed the first trace was cut
  // from an image too small for the world it covers.
  await shoot('closeup', 900, 700, 2.2);
  await shoot('entry', 420, 800, 1.3);
  await shoot('mid', 1300, 900, 1.3);
  await shoot('goal', 2200, 800, 1.3);
  console.log('  shots → tests/.artifacts/traced-*.png');

  await page.close();

  // ------------------------------------------------- the picker's dev button ----
  // The only in-game route to a map with no campaign slot. Fresh page: this one goes
  // through the title screen, and the run above left a level up.
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
  }))).catch(() => []);
  ok('the picker offers a dev button per authored map', btns.length === 2, btns.map((b) => b.text).join(' / ') || 'none');
  ok('they sit on the LEFT edge', btns.length > 0 && btns.every((b) => b.left < 60), btns.map((b) => b.left + 'px').join(', '));
  const mazeBtn = btns.findIndex((b) => /Maze One/.test(b.text));
  ok('one of them names the traced map', mazeBtn >= 0, btns.map((b) => b.text).join(' / '));

  await page2.screenshot({ path: path.join(ART, 'traced-picker.png') });

  if (mazeBtn >= 0) {
    await page2.click('#ssDevMap' + mazeBtn);
    const started = await page2.waitForFunction((id) => {
      const s = window.__game && window.__game.state;
      return !!(s && s.levelDef && s.levelDef.id === id);
    }, ID, { timeout: 30000 }).then(() => true).catch(() => false);
    ok('clicking it starts the traced map', started);
    ok('no page errors on that route', errs2.length === 0, errs2.slice(0, 2).join(' | ') || 'none');
  }

  await browser.close();
  srv.close();
  console.log(`==== ${pass} passed, ${fail} failed ====`);
  process.exit(fail ? 1 : 0);
})();
