/* THE FRUITING CELEBRATION'S MUSHROOMS STAND ON THE DRAWN HILL.
 *
 * Why this exists: the mushrooms were placed by a FORMULA (`pow(1 - fx, 0.9)` for the home hill,
 * `pow(sin(pi*fx), 0.7)` for the goal hill, both floored at 0.28) while the hill itself is a
 * SPRITE. Where the two disagreed the mushrooms hung in mid-air, and the disagreement is worst
 * exactly where the owner reported it — past the little tree at the home slope's halfway column,
 * where the model still asks for 0.156 of the hill's height and the art offers 0.029.
 *
 * That class of bug shows only in a rendered frame, which is how it shipped. What makes it
 * ASSERTABLE is that the answer lives in the model: each mushroom's world y against the sprite's
 * own alpha silhouette at that x, read through the same call the placement makes.
 *
 * The negative control matters more than usual here. "Every mushroom is at or below the hill top"
 * passes trivially on a build that puts them all flat on the soil line, so the check also insists
 * they actually climb the slope, and that the ones the old model floated are the ones that moved.
 */
const http = require('http'), fs = require('fs'), path = require('path');
const { chromium } = require('playwright');
const ROOT = path.resolve(__dirname, '..');
const T = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.png': 'image/png',
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.svg': 'image/svg+xml', '.webp': 'image/webp',
  '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.css': 'text/css' };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let pass = 0, fail = 0;
const ok = (n, c, x) => { c ? (pass++, console.log('  PASS  ' + n + (x ? '  — ' + x : ''))) : (fail++, console.log('  FAIL  ' + n + (x ? '  — ' + x : ''))); };

(async () => {
  const srv = await new Promise((res) => { const s = http.createServer((rq, rs) => {
    let p = decodeURIComponent(rq.url.split('?')[0].split('#')[0]); if (p === '/') p = '/index.html';
    const fp = path.join(ROOT, p);
    if (!fp.startsWith(ROOT) || !fs.existsSync(fp) || fs.statSync(fp).isDirectory()) { rs.writeHead(404); rs.end('nf'); return; }
    rs.writeHead(200, { 'Content-Type': T[path.extname(fp)] || 'application/octet-stream' });
    fs.createReadStream(fp).pipe(rs); }); s.listen(0, () => res(s)); });
  const base = 'http://localhost:' + srv.address().port;
  const browser = await chromium.launch({ headless: true, executablePath: '/opt/pw-browsers/chromium' });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 950 } });
  const page = await ctx.newPage();
  const errs = []; page.on('pageerror', (e) => errs.push(String(e && e.message)));
  await page.addInitScript(() => { window.MYCELIUM_SUPABASE = { url: '', anonKey: '' }; });
  await page.goto(base + '/index.html#dev,turn', { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#loadscreen.ld-ready', { timeout: 25000 }).catch(() => {});
  await page.click('#loadscreen', { timeout: 5000 }).catch(() => {});
  await page.waitForFunction(() => !!(window.__game && window.__game.cele), { timeout: 25000 });
  await sleep(900);

  // Measure one side: place the mushrooms, then ask the SPRITE where the ground was at each x.
  const measure = (side) => page.evaluate((sd) => {
    const g = window.__game;
    g.cele.stop();
    g.cele.start(sd, () => {});
    const ms = g.cele.mushrooms();
    if (!ms) return null;
    const surfY = g.cele.surfaceY();
    const rows = ms.map((m) => {
      const top = g.cele.hillTop(sd, m.x);       // drawn green above the soil line, world units
      return { x: m.x, rise: surfY - m.y, top, h: m.h, depth: m.depth };
    });
    g.cele.stop();
    return { rows, surfY, probe: g.cele.hillTop(sd, 0) };
  }, side);

  for (const side of ['home', 'goal']) {
    console.log(`\n-- ${side} hill --`);
    const r = await measure(side);
    if (!r || !r.rows.length) { ok(`${side}: mushrooms were placed`, false, r ? '0 placed' : 'no celebration'); continue; }
    ok(`${side}: mushrooms were placed`, r.rows.length >= 20, `${r.rows.length}`);
    // The sprite decoded — without this the placement silently falls back to the old model and
    // every assertion below would be measuring the fallback rather than the fix.
    const sampled = r.rows.filter((m) => m.top >= 0).length;
    ok(`${side}: the hill's own silhouette is what answers "where is the ground?"`,
       sampled === r.rows.length, `${sampled}/${r.rows.length} columns sampled off the sprite`);

    // THE BUG ITSELF. `rise` is how far above the soil line the mushroom's foot sits; `top` is how
    // far the drawn green reaches there. A foot above the green is a mushroom in the air. A
    // half-unit of slack absorbs the profile's one-row quantisation.
    // An UNMEASURED row counts as a failure, not as a skip: `top < 0` means the silhouette read
    // failed, and filtering those out would let this assertion pass vacuously on exactly the
    // build where the placement has fallen back to the old model.
    const floating = r.rows.filter((m) => !(m.top >= 0) || m.rise > m.top + 0.5);
    ok(`${side}: no mushroom stands above the drawn green`, floating.length === 0,
       floating.length ? `${floating.length} floating, worst +${Math.max(...floating.map((m) => (m.rise - m.top).toFixed(1)))}` : `${r.rows.length} checked`);

    // ...AND SPECIFICALLY PAST THE TREE, which is where the owner saw it. The home tree sits at
    // the halfway column, so the far half of the slope is the reported region; on the goal hill
    // the equivalent is the outer edges, where the sin profile's 0.28 floor did the same thing.
    const xs = r.rows.map((m) => m.x), lo = Math.min(...xs), hi = Math.max(...xs);
    const far = r.rows.filter((m) => m.x > lo + (hi - lo) * 0.5);
    const farFloat = far.filter((m) => !(m.top >= 0) || m.rise > m.top + 0.5);
    ok(`${side}: ...including the far half of the slope, where they were reported`,
       far.length > 0 && farFloat.length === 0, `${farFloat.length} of ${far.length} floating`);

    // NEGATIVE CONTROL. Flat on the soil line would satisfy everything above, so insist the
    // mushrooms genuinely spread UP the hill — and that the ones high up are the deep ones.
    const climbers = r.rows.filter((m) => m.rise > 2);
    ok(`${side}: ...while still climbing the slope rather than sitting flat`,
       climbers.length >= Math.max(4, r.rows.length * 0.25),
       `${climbers.length}/${r.rows.length} above the soil line, highest ${Math.max(...r.rows.map((m) => m.rise)).toFixed(1)}`);
    const deep = r.rows.filter((m) => m.depth > 0.66), near = r.rows.filter((m) => m.depth < 0.33);
    const avg = (a) => (a.length ? a.reduce((s, m) => s + m.rise, 0) / a.length : 0);
    ok(`${side}: ...with the far ones higher up it than the near ones`,
       deep.length && near.length && avg(deep) > avg(near),
       `far ${avg(deep).toFixed(1)} vs near ${avg(near).toFixed(1)}`);

    // THE PROFILE IS THE ART'S, NOT A CURVE THAT HAPPENS TO FIT. Where the sprite has descended
    // to a sliver the ceiling must have descended with it — this is the property the old model
    // lacked, and asserting the mushrooms' own heights cannot show it (they may all be shallow).
    const outer = r.rows.filter((m) => m.top >= 0).sort((a, b) => a.top - b.top)[0];
    const inner = r.rows.filter((m) => m.top >= 0).sort((a, b) => b.top - a.top)[0];
    ok(`${side}: the hill has a real slope to stand on`, inner.top > outer.top + 4,
       `lowest ground ${outer.top.toFixed(1)}, highest ${inner.top.toFixed(1)}`);
  }

  // THE SHAPE READ OFF THE SPRITE IS A HILL, checked at the source rather than through a
  // mushroom: sweep the home slope and the ground must fall away monotonically enough to be a
  // slope. A profile that came back flat (a failed alpha read) would pass everything above by
  // pinning every mushroom to the soil line.
  const sweep = await page.evaluate(() => {
    const g = window.__game, sub = window.__game.state.substrate;
    const cs = sub.cellSize, out = [];
    for (let i = 0; i <= 20; i++) out.push(g.cele.hillTop('home', (i / 20) * 10 * cs));
    return out;
  });
  const dropped = sweep[0] > sweep[sweep.length - 1];
  const varied = Math.max(...sweep) - Math.min(...sweep);
  ok('the home slope descends left to right, as the mirrored sprite draws it',
     dropped && varied > 8, `${sweep[0].toFixed(1)} -> ${sweep[sweep.length - 1].toFixed(1)}, range ${varied.toFixed(1)}`);

  // A frame, because this bug was only ever visible in one.
  await page.evaluate(() => { window.__game.cele.start('home', () => {}); });
  await sleep(2600);
  fs.mkdirSync(path.join(__dirname, '.artifacts'), { recursive: true });
  await page.screenshot({ path: path.join(__dirname, '.artifacts', 'cele-home.png'), animations: 'disabled', timeout: 15000 }).catch(() => {});
  await page.evaluate(() => { window.__game.cele.stop(); window.__game.cele.start('goal', () => {}); });
  await sleep(2600);
  await page.screenshot({ path: path.join(__dirname, '.artifacts', 'cele-goal.png'), animations: 'disabled', timeout: 15000 }).catch(() => {});

  ok('no page errors', errs.length === 0, errs.slice(0, 2).join(' | '));
  console.log(`\n==== ${pass} passed, ${fail} failed ====`);
  await browser.close(); srv.close();
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('HARNESS ERROR', e); process.exit(1); });
