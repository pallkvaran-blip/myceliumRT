/* THE AQUIFER TAP: +1 Water PER TAPPED SOURCE, PER TURN.
 *
 *   node tests/water-check.cjs
 *
 * Owner: "let's change water income per water body touched to 1 water per turn." It was
 * `WATER_SOURCE_EVERY = 3` — a third of a Water per source per turn — which is why tapping a
 * second lake barely registered.
 *
 * WHY THIS IS ASSERTED THROUGH THE ENGINE LOOP AND NOT AS A CONSTANT. `every` is a CADENCE, and
 * three separate things read it: the income loop skips a payout while `_et < every`, the ledger
 * splits `every > 1` into a "cadenced" bucket, and cadenceLightsHTML draws `every` dots. At 1 all
 * three take a different branch from the one they took at 3 — the meter becomes a single
 * always-on light instead of a three-dot countdown — so a check that read the constant would
 * confirm the number and nothing about the payout. What is measured here is Water in the bank,
 * per action, on a real map.
 *
 * TRAPS, both of which produce a confident wrong answer:
 *   • `gain()` SOFT-CAPS. Income above `cards.softCapWater` is throttled, so a probe that starts
 *     with a full tank measures the cap and reads far less than 1. Water is zeroed first.
 *   • A SOURCE TAPS ONCE PER MAP (`state._tappedWater`) and stays tapped for the rest of it. That
 *     is the point of the mechanic, but it means "grow to water twice" is not a way to double the
 *     income — the second source has to be a genuinely DIFFERENT body. The two-source case here
 *     parks nodes on two distinct reservoirs and checks the payout doubles.
 */
const http = require('http'), fs = require('fs'), path = require('path');
const { chromium } = require('playwright');
const ROOT = path.resolve(__dirname, '..');
const T = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.png': 'image/png',
  '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.webp': 'image/webp', '.mp3': 'audio/mpeg', '.wav': 'audio/wav' };
let pass = 0, fail = 0;
const ok = (n, c, x) => { c ? (pass++, console.log('  PASS  ' + n + (x ? '  — ' + x : ''))) : (fail++, console.log('  FAIL  ' + n + (x ? '  — ' + x : ''))); };

(async () => {
  const srv = await new Promise((res) => { const s = http.createServer((rq, rs) => { let p = decodeURIComponent(rq.url.split('?')[0].split('#')[0]); if (p === '/') p = '/index.html'; const fp = path.join(ROOT, p); if (!fp.startsWith(ROOT) || !fs.existsSync(fp) || fs.statSync(fp).isDirectory()) { rs.writeHead(404); rs.end('nf'); return; } rs.writeHead(200, { 'Content-Type': T[path.extname(fp)] || 'application/octet-stream' }); fs.createReadStream(fp).pipe(rs); }); s.listen(0, () => res(s)); });
  const base = 'http://localhost:' + srv.address().port;
  const browser = await chromium.launch({ headless: true, executablePath: '/opt/pw-browsers/chromium' });
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  const errs = [];
  page.on('pageerror', (e) => errs.push(String(e && e.message)));
  await page.addInitScript(() => { window.MYCELIUM_SUPABASE = { url: '', anonKey: '' }; });
  // A campaign map, TURN-BASED: a fixed seed makes the water bodies the same every run, and one
  // action is exactly one round, which is the unit the owner's rule is written in.
  await page.goto(base + '/index.html#level,campaign-01-magnetite-c40,turn', { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#loadscreen.ld-ready', { timeout: 60000 }).catch(() => {});
  await page.click('#loadscreen', { timeout: 5000 }).catch(() => {});
  await page.waitForFunction(() => window.__game && window.__game.state && window.__game.state.active, null, { timeout: 30000 });
  for (let i = 0; i < 5 && await page.$('#levelIntro'); i++) { await page.mouse.click(700, 420); await new Promise((r) => setTimeout(r, 800)); }

  const r = await page.evaluate(async () => {
    const g = window.__game, s = g.state, sub = s.substrate, net = s.active;
    // Threats out of the way: a worm eating the tapped strand would drop the source mid-probe
    // and read as the income stopping. This probe is about arithmetic, not survival.
    s.nematodes = []; s.clouds = []; s.ants = [];
    if (s.config.nematodes) s.config.nematodes.respawnChance = 0;
    if (s.config.trichoderma) s.config.trichoderma.respawnChance = 0;

    // Every distinct water source on the map, with a point just outside its edge to park on.
    const bodies = new Map();
    sub.forEachCell((cell, col, row) => {
      if (!cell.water) return;
      const id = cell.reservoir ? cell.reservoir : 'lake';
      if (!bodies.has(id)) bodies.set(id, { id, col, row });
    });
    const contact = (s.config.growth && s.config.growth.waterContactDist) || 14;
    const park = (b) => {
      const c = sub.cellCenter(b.col, b.row);
      return { x: c.x, y: c.y - sub.cellSize / 2 - contact * 0.4 };   // just above the cell's top edge
    };

    const step = () => { g.tickWorld(s, 'both'); };
    const water = () => net.water;
    const engine = () => (s.cards.engines || []).find((e) => e._waterSource) || null;

    const out = { bodies: bodies.size, contact };
    out.engineBefore = engine();

    // ---- ONE SOURCE ---------------------------------------------------------
    const list = [...bodies.values()];
    const n0 = net.nodes[0];
    const p1 = park(list[0]);
    n0.x = p1.x; n0.y = p1.y;
    net.water = 0;
    step();                                    // resolveIncome -> updateWaterSourceEngine taps it
    const e1 = engine();
    out.tapped1 = (s._tappedWater && s._tappedWater.size) || 0;
    out.e1 = e1 ? { water: e1.water, every: e1.every } : null;
    // Ten more steps: with `every: 1` each one pays, so the bank should rise by 10.
    net.water = 0;
    const w0 = water();
    for (let i = 0; i < 10; i++) step();
    out.oneSource = { from: w0, to: water(), steps: 10 };

    // ---- TWO SOURCES --------------------------------------------------------
    // A second DISTINCT body. Parking another node on the same one would tap nothing new —
    // `_tappedWater` is a Set of source ids and that is the whole design.
    out.twoSource = null;
    if (list.length > 1) {
      const p2 = park(list[1]);
      const n1 = net.nodes[1] || net.nodes[0];
      n1.x = p2.x; n1.y = p2.y;
      step();
      const e2 = engine();
      out.tapped2 = (s._tappedWater && s._tappedWater.size) || 0;
      out.e2 = e2 ? { water: e2.water, every: e2.every } : null;
      net.water = 0;
      const v0 = water();
      for (let i = 0; i < 10; i++) step();
      out.twoSource = { from: v0, to: water(), steps: 10 };
    }

    // ---- THE METER ----------------------------------------------------------
    // At `every: 1` the ledger files the tap under STEADY income, not cadenced, and the cadence
    // meter draws one always-on light rather than an N-dot countdown. Read off the engine the
    // game built, so a future retune of `every` shows up here as well as in the arithmetic.
    const e = engine();
    out.steady = e ? !(e.every && e.every > 1) : null;
    return out;
  });

  ok('the map has water to tap', r.bodies > 0, `${r.bodies} distinct source(s), contact ${r.contact}u`);
  ok('nothing is tapped before the colony reaches water', r.engineBefore == null);
  ok('touching one source taps exactly one', r.tapped1 === 1, `${r.tapped1} tapped`);
  ok('the tap is an engine paying 1 Water per source', !!r.e1 && r.e1.water === 1, JSON.stringify(r.e1));
  ok('...EVERY TURN, not every third turn', !!r.e1 && r.e1.every === 1, `every = ${r.e1 && r.e1.every}`);
  ok('one tapped source pays 1 Water per action', r.oneSource.to - r.oneSource.from === 10,
     `+${r.oneSource.to - r.oneSource.from} over ${r.oneSource.steps} actions (want +10)`);
  if (r.twoSource) {
    ok('a second DISTINCT source taps too', r.tapped2 === 2, `${r.tapped2} tapped`);
    ok('...and the tap pays 1 per source', !!r.e2 && r.e2.water === 2, JSON.stringify(r.e2));
    ok('two tapped sources pay 2 Water per action', r.twoSource.to - r.twoSource.from === 20,
       `+${r.twoSource.to - r.twoSource.from} over ${r.twoSource.steps} actions (want +20)`);
  } else {
    console.log('  note  only one water source on this map — the two-source case did not run');
  }
  ok('the ledger files it as STEADY income, not a countdown', r.steady === true,
     `every > 1 ? ${r.steady === true ? 'no' : 'yes'}`);
  ok('no page errors', errs.length === 0, errs.slice(0, 2).join(' | ') || 'none');

  await browser.close();
  srv.close();
  console.log(`\n==== ${pass} passed, ${fail} failed ====`);
  process.exit(fail ? 1 : 0);
})();
