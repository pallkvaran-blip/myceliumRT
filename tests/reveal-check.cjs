/* GROWTH ANIMATES AT EVERY ZOOM — including the one a phone actually plays at.
 *
 *     node tests/reveal-check.cjs
 *
 * Reported as "growth is not animating properly when zoomed out on phone", and it was exactly
 * that: a grow appeared whole, in one frame, with no filaments extending.
 *
 * The cause is the batched LOD. `detailAmt = smoothstep(0.42, 0.62, zoom) * …` selects
 * `_strokeBatched` below zoom ~0.44, which draws the colony from Path2Ds baked in
 * `_rebuildCaches` — and a rebuild is triggered by the structure CHANGING, i.e. by the grow
 * itself, so the new strands were baked complete before their first frame. `revealFactor` and
 * `isRevealing` then returned "already there" / "nothing revealing" whenever that LOD was
 * drawing, which took the glow, the nutrient pulse and the enemy turn's wait with them.
 *
 * WHY THE PHONE: the fit zoom is `max(minZoom, viewW/worldW, viewH/worldH)`. At 390x844 that is
 * ~0.28 — under the 0.42 where detail begins — so a phone zoomed out is ALWAYS on the batched
 * path. A 1280x720 desktop fits at ~0.43 and is only just inside it, which is why this read as a
 * phone bug rather than a zoom bug. It also hit any colony past ~1900 nodes at any zoom, since
 * node count fades the same `detailAmt`.
 *
 * So the assertions are: at a phone's own zoom-out a grow ARRIVES OVER TIME rather than at once,
 * on screen (cream pixels, not just the model), while the batched LOD is confirmed to be the one
 * drawing — with the detail path measured the same way as a control, so a green run cannot mean
 * "the probe measures the LOD" instead of "the LOD animates".
 *
 * Traps this check was written around:
 *   - A bare `grow` refuses once the colony has outrun the map's food ("no food within sensing
 *     range") and a refusal queues nothing, so the food lattice is re-seeded before every grow.
 *   - Headless throttles rAF, so every sample is driven through `__game.renderFrame`, which
 *     draws one frame synchronously. The reveal runs on the real clock, so the SLEEPS between
 *     frames are what advance it — not the frame count.
 *   - Bright pixels above the soil line are the SKY. Cream is only counted below it.
 */
const http = require('http'), fs = require('fs'), path = require('path');
const { chromium } = require('playwright');
const ROOT = path.resolve(__dirname, '..');
const T = { '.html':'text/html', '.js':'text/javascript', '.json':'application/json', '.png':'image/png', '.webp':'image/webp', '.mp3':'audio/mpeg', '.wav':'audio/wav' };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let PASS = 0, FAIL = 0;
const ok = (n, c, x) => { c ? PASS++ : FAIL++; console.log((c ? '  PASS  ' : '  FAIL  ') + n + (x ? '  — ' + x : '')); };

// The LOD threshold from NetworkRenderer.draw's `detailAmt`. Kept here so a retune of the
// smoothstep shows up as this check disagreeing rather than as the phone case quietly leaving
// the batched path (which would make every assertion below vacuously true).
const DETAIL_FROM = 0.42;

const boot = async (ctx, url) => {
  const p = await ctx.newPage();
  p.on('pageerror', (e) => console.log('PAGEERROR:', String(e.stack || e).slice(0, 300)));
  await p.goto(url, { waitUntil: 'domcontentloaded' });
  await p.waitForSelector('#loadscreen.ld-ready', { timeout: 60000 }).catch(() => {});
  await p.click('#loadscreen', { timeout: 5000 }).catch(() => {});
  await p.waitForFunction(() => window.__game && window.__game.state && window.__game.state.active, null, { timeout: 60000 }).catch(() => {});
  await p.waitForFunction(() => window.__game.state.substrate._rockSolidified === true, null, { timeout: 90000 }).catch(() => {});
  for (let i = 0; i < 6 && await p.$('#levelIntro'); i++) { await p.mouse.click(200, 200); await sleep(400); }
  return p;
};

// One grow at a given zoom, sampled across the reveal window. Returns the per-frame series:
// how many of the colony's strands are drawn at all, how many are mid-extension, whether the
// renderer says a reveal is running, which LOD drew it, and the cream pixels on screen.
const GROW_AND_SAMPLE = async (p, zoom, frames = 16, gap = 130) => p.evaluate(async ({ zoom, frames, gap }) => {
  const G = window.__game, s = G.state, net = s.active, sub = s.substrate;
  G.camera.zoom = zoom;
  net.water = 99; net.energy = 5000;
  // A lattice of food around the root, re-stocked before the grow — a grow with nothing in
  // sensing range refuses, and a refusal is indistinguishable from an animation that never ran.
  const nd = net.nodes[0], c0 = sub.colAtX(nd.x), r0 = sub.rowAtY(nd.y);
  for (let c = c0 - 7; c <= c0 + 7; c += 3) for (let r = r0; r <= r0 + 9; r += 3) {
    if (!sub.inBounds(c, r)) continue;
    const cell = sub.cells[sub.index(c, r)];
    cell.rock = 0; cell.hazard = 0; cell.nutrient = 50; cell.maxNutrient = 50;
  }
  // Cream pixels BELOW THE SOIL LINE — above it is sky, which is brighter than any filament.
  const canvas = [...document.querySelectorAll('canvas')].find((n) => n.clientHeight > 0);
  const cx = canvas.getContext('2d');
  const cream = () => {
    const k = canvas.height / canvas.clientHeight;
    const top = Math.max(0, Math.round(G.camera.worldToScreen(0, sub.surfaceY + 20).y * k));
    const h = canvas.height - top;
    if (h <= 0) return 0;
    const d = cx.getImageData(0, top, canvas.width, h).data;
    let n = 0;
    for (let i = 0; i < d.length; i += 4) if (d[i] > 170 && d[i + 1] > 160 && d[i + 2] > 140) n++;
    return n;
  };

  const before = new Set(net.nodes.map((n) => n.id));
  G.performAction(s, 'grow', {});
  const out = [];
  for (let i = 0; i < frames; i++) {
    G.renderFrame();
    const r = G.netRenderer(), now = performance.now();
    let drawnNew = 0, partial = 0, totalNew = 0;
    for (const n of net.nodes) {
      if (before.has(n.id)) continue;
      totalNew++;
      const f = r.revealFactor(n, now);
      if (f > 0) drawnNew++;
      if (f > 0 && f < 1) partial++;
    }
    out.push({ drawnNew, partial, totalNew, cream: cream(),
               revealing: r.isRevealing(now), simplify: r._lastSimplify,
               pending: (r._growingStrands || []).length });
    await new Promise((res) => setTimeout(res, gap));
  }
  return { grew: net.nodes.length - before.size, out };
}, { zoom, frames, gap });

// How many times the drawn count ROSE across the series. Two is the gate, not three: the
// stagger window is 1-2.4 s and the sample gap is fixed, so how many samples land inside it is
// a property of the machine — one run of the same build read 4 rises and the next 2. The
// assertions that carry the weight are "not whole on the first frame" and "caught
// mid-extension"; this one only says it arrived in pieces.
const ramps = (xs) => {
  let ups = 0;
  for (let i = 1; i < xs.length; i++) if (xs[i] > xs[i - 1]) ups++;
  return ups;
};

(async () => {
const srv = await new Promise((res) => { const s = http.createServer((rq, rs) => {
  let u = decodeURIComponent(rq.url.split('?')[0].split('#')[0]); if (u === '/') u = '/index.html';
  const fp = path.join(ROOT, u);
  if (!fp.startsWith(ROOT) || !fs.existsSync(fp) || fs.statSync(fp).isDirectory()) { rs.writeHead(404); rs.end('nf'); return; }
  rs.writeHead(200, { 'Content-Type': T[path.extname(fp)] || 'application/octet-stream' });
  fs.createReadStream(fp).pipe(rs);
}); s.listen(0, () => res(s)); });
const base = 'http://localhost:' + srv.address().port;
const b = await chromium.launch({ headless: true, executablePath: '/opt/pw-browsers/chromium' });

// ---- a phone, zoomed out as far as it goes --------------------------------------------
const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3 });
await ctx.addInitScript(() => { window.MYCELIUM_SUPABASE = { url: '', anonKey: '' }; });
const p = await boot(ctx, base + '/index.html#dev,turn');

const lod = await p.evaluate(() => {
  const G = window.__game, cam = G.camera;
  cam.zoom = cam.minZoomForBounds();
  G.renderFrame();
  return { fit: cam.zoom, minZoom: cam.minZoom, simplify: G.netRenderer()._lastSimplify };
});
ok('a phone fully zoomed out sits below the detail threshold', lod.fit < DETAIL_FROM,
   `fit zoom ${lod.fit.toFixed(3)} vs detail from ${DETAIL_FROM}`);
ok('...so the batched LOD is what draws it', lod.simplify === true, `_lastSimplify ${lod.simplify}`);

const phone = await GROW_AND_SAMPLE(p, lod.fit);
const first = phone.out[0], last = phone.out[phone.out.length - 1];
console.log(`  (phone) grew ${phone.grew} strands; drawn ` +
  phone.out.map((s) => s.drawnNew).join(' → '));
console.log(`  (phone) cream px ` + phone.out.map((s) => s.cream).join(' → '));

ok('the grow actually happened', phone.grew > 20, `${phone.grew} new strands`);
ok('it does NOT arrive whole on the first frame', first.drawnNew < first.totalNew * 0.35,
   `${first.drawnNew} of ${first.totalNew} drawn immediately`);
ok('it arrives over several frames instead', ramps(phone.out.map((s) => s.drawnNew)) >= 2,
   `${ramps(phone.out.map((s) => s.drawnNew))} rises across ${phone.out.length} frames`);
ok('strands are caught mid-extension', Math.max(...phone.out.map((s) => s.partial)) >= 2,
   `peak ${Math.max(...phone.out.map((s) => s.partial))} extending at once`);
// The point of the whole fix: the animation happens ON the batched path, not by falling back to
// the detail one. Without this a future "fix" that just widened the LOD threshold would pass.
ok('...while the batched LOD is still the one drawing', phone.out.every((s) => s.simplify === true),
   `simplify ${phone.out.map((s) => s.simplify ? 1 : 0).join('')}`);
ok('the renderer reports a reveal in progress at this zoom', phone.out.some((s) => s.revealing === true),
   `revealing ${phone.out.map((s) => s.revealing ? 1 : 0).join('')}`);
ok('every strand of the grow ends up drawn', last.drawnNew === last.totalNew,
   `${last.drawnNew}/${last.totalNew}`);
// POLLED, NOT READ OFF THE LAST SAMPLE. The stagger window is up to REVEAL_SPREAD_MAX (2400ms)
// plus a segment's 340, and the fixed sample loop is ~2.1s — so a big grow legitimately outlives
// it and the last sample says `revealing true` on a build that is working perfectly. That is a
// bet about the machine, which is the harness trap this file already warns about; wait for the
// condition instead, bounded so a reveal that never ends still fails.
const finished = await p.evaluate(async () => {
  const g = window.__game;
  for (let i = 0; i < 60; i++) {
    g.renderFrame();
    if (!g.netRenderer().isRevealing(performance.now())) return { done: true, ms: i * 100 };
    await new Promise((r) => setTimeout(r, 100));
  }
  return { done: false, ms: 6000 };
});
ok('...and the reveal ends', finished.done === true,
   finished.done ? `settled ${finished.ms}ms after the samples` : 'still revealing after 6s');

// ON SCREEN, not only in the model — the model is what the fix changed, so a check that reads
// only the model is checking its own edit.
const midCream = Math.min(...phone.out.slice(0, 3).map((s) => s.cream));
ok('the picture fills in with it', midCream < last.cream * 0.9,
   `${midCream} cream px early vs ${last.cream} at the end`);

// The pending strands are folded back into the baked paths when they land, and that must not be
// visible: same frame, same picture, one rebuild apart.
//
// BOTH FRAMES ARE RENDERED AT THE SAME CLOCK, and that is not a nicety: the nutrient pulse is a
// bright ring sweeping the colony on a 3.8 s cycle, so consecutive frames of an IDLE board swing
// the cream count by ±30% (measured 1708 → 1541 → 1162 → 1647 on one run). `renderFrame(t)` takes
// the time, so pinning it removes the pulse from the comparison and leaves the fold-in as the
// only difference between the two pictures.
const fold = await p.evaluate(() => {
  const G = window.__game, sub = G.state.substrate, r = G.netRenderer();
  const canvas = [...document.querySelectorAll('canvas')].find((n) => n.clientHeight > 0);
  const cx = canvas.getContext('2d');
  const cream = () => {
    const k = canvas.height / canvas.clientHeight;
    const top = Math.max(0, Math.round(G.camera.worldToScreen(0, sub.surfaceY + 20).y * k));
    const d = cx.getImageData(0, top, canvas.width, canvas.height - top).data;
    let n = 0; for (let i = 0; i < d.length; i += 4) if (d[i] > 170 && d[i + 1] > 160 && d[i + 2] > 140) n++;
    return n;
  };
  const t = performance.now();
  G.renderFrame(t); const a = cream();
  r.markStructureDirty(); G.renderFrame(t);
  return { pending: (G.netRenderer()._growingStrands || []).length, before: a, after: cream() };
});
ok('the finished strands end up in the batch', fold.pending === 0, `${fold.pending} still pending`);
ok('...and folding them in changes nothing on screen',
   Math.abs(fold.after - fold.before) <= Math.max(30, fold.before * 0.02),
   `${fold.before} → ${fold.after} cream px`);

// A frame mid-reveal, for eyeballing — several bugs in this project were only visible in one.
await p.evaluate(() => { const G = window.__game, s = G.state;
  const net = s.active, sub = s.substrate;
  net.water = 99; net.energy = 5000;
  const nd = net.nodes[0], c0 = sub.colAtX(nd.x), r0 = sub.rowAtY(nd.y);
  for (let c = c0 - 7; c <= c0 + 7; c += 3) for (let r = r0; r <= r0 + 9; r += 3) {
    if (!sub.inBounds(c, r)) continue;
    const cell = sub.cells[sub.index(c, r)];
    cell.rock = 0; cell.hazard = 0; cell.nutrient = 50; cell.maxNutrient = 50;
  }
  G.performAction(s, 'grow', {}); G.renderFrame();
});
await sleep(700);
await p.evaluate(() => window.__game.renderFrame());
fs.mkdirSync(path.join(__dirname, '.artifacts'), { recursive: true });
await p.screenshot({ path: path.join(__dirname, '.artifacts', 'reveal-phone-zoomedout.png'),
  animations: 'disabled', timeout: 8000 }).catch(() => {});

await ctx.close();

// ---- CONTROL: the detail path, measured identically ------------------------------------
// If this did not ramp, the assertions above would be measuring the harness rather than the LOD.
// A FRESH PAGE, not the same one zoomed in: the colony above has eaten and colonised its
// lattice, and a second grow on top of it came back with 0 new strands — which would have read
// as "the detail path does not animate either".
const ctx2 = await b.newContext({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 2 });
await ctx2.addInitScript(() => { window.MYCELIUM_SUPABASE = { url: '', anonKey: '' }; });
const p2 = await boot(ctx2, base + '/index.html#dev,turn');
const detail = await GROW_AND_SAMPLE(p2, 1.0, 12);
console.log(`  (zoom 1.0) grew ${detail.grew} strands; drawn ` + detail.out.map((s) => s.drawnNew).join(' → '));
ok('the detail path is what the control measured', detail.out.every((s) => s.simplify === false),
   `simplify ${detail.out.map((s) => s.simplify ? 1 : 0).join('')}`);
ok('the control grew something to measure', detail.grew > 20, `${detail.grew} new strands`);
ok('the control does not arrive whole on the first frame either',
   detail.out[0].drawnNew < detail.out[0].totalNew * 0.35,
   `${detail.out[0].drawnNew} of ${detail.out[0].totalNew} drawn immediately`);
ok('the control ramps the same way', ramps(detail.out.map((s) => s.drawnNew)) >= 2,
   `${ramps(detail.out.map((s) => s.drawnNew))} rises`);

await ctx2.close();
await b.close(); srv.close();
console.log(`\n${PASS} passed, ${FAIL} failed`);
process.exit(FAIL ? 1 : 0);
})();
