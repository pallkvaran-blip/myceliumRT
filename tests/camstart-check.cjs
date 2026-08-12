/* WHERE A MAP OPENS, AND HOW DEEP THE UNREACHABLE RED GOES.
 *
 *     node tests/camstart-check.cjs
 *
 * Two owner asks that land on the same picture, which is why they are checked together:
 *
 *   1. the red band below the core line — the part the colony can never reach — is 20% deeper
 *      (1076 -> 1291; the playable box above the line is untouched at 1630);
 *   2. a PHONE opens a map fully zoomed out, at the far left and top, instead of the desktop's
 *      0.85 parked on the colony root.
 *
 * They meet at the bottom of a phone screen. The band is `bottomBuffer`, so it is part of what
 * the camera can scroll through, and on a portrait phone `minZoomForBounds` is viewH/worldH — so
 * deepening the band lowers the zoom floor and pushes the PLAY AREA up the screen, out from
 * behind the card carousel. That is the assertion worth having, and it is measured rather than
 * asserted as a constant: the core line's screen y at the opening view, against the carousel's
 * own top edge, with the pre-change band recomputed beside it as a control.
 *
 * Traps: the level intro covers the map and swallows clicks, and `#dev` skips it — but the dev
 * MAP buttons are off by default now (CONFIG.dev.inGameButtons), so nothing here needs them. The
 * camera is read through `__game.camera`, and the depths through `__game.coreLineDepth` /
 * `coreTotalDepth` rather than repeated here, so moving them is one edit in index.html.
 */
const http = require('http'), fs = require('fs'), path = require('path');
const { chromium } = require('playwright');
const ROOT = path.resolve(__dirname, '..');
const T = { '.html':'text/html', '.js':'text/javascript', '.json':'application/json', '.png':'image/png',
  '.webp':'image/webp', '.mp3':'audio/mpeg', '.wav':'audio/wav', '.svg':'image/svg+xml' };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let pass = 0, fail = 0;
const ok = (n, c, x) => { c ? (pass++, console.log('  PASS  ' + n + (x ? '  — ' + x : '')))
                            : (fail++, console.log('  FAIL  ' + n + (x ? '  — ' + x : ''))); };

// The band as the owner set it. Pinned because it is a decision, not a derivation — the two
// deepenings were +10% and then +20% OF THE BAND, and a future "+N%" has to start from the
// number that is actually shipped.
const BAND_WAS = 1076;          // before this change (itself 978 +10%)
const BAND_NOW = 1291;          // 1076 + 20%

const boot = async (ctx, url, w, h) => {
  const p = await ctx.newPage();
  p.on('pageerror', (e) => console.log('PAGEERROR:', String(e.message).slice(0, 200)));
  await p.goto(url, { waitUntil: 'domcontentloaded' });
  await p.waitForSelector('#loadscreen.ld-ready', { timeout: 60000 }).catch(() => {});
  await p.click('#loadscreen', { timeout: 5000 }).catch(() => {});
  await p.waitForFunction(() => window.__game && window.__game.state && window.__game.state.active, null, { timeout: 60000 }).catch(() => {});
  for (let i = 0; i < 6 && await p.$('#levelIntro'); i++) { await p.mouse.click(w / 2, h / 2); await sleep(400); }
  await sleep(600);
  return p;
};

const view = (p) => p.evaluate(() => {
  const g = window.__game, cam = g.camera, sub = g.state.substrate;
  const tl = cam.screenToWorld(0, 0), br = cam.screenToWorld(cam.viewW, cam.viewH);
  const hand = document.querySelector('.handbar');
  const root = g.state.networks[0] && g.state.networks[0].nodes[0];
  return {
    zoom: cam.zoom, floor: cam.minZoomForBounds(),
    left: tl.x, top: tl.y, right: br.x, bottom: br.y,
    camX: cam.x, camY: cam.y, viewW: cam.viewW, viewH: cam.viewH,
    worldW: sub.worldWidth, worldH: sub.worldHeight, scrollH: sub.viewHeight,
    surfaceY: sub.surfaceY, coreY: sub.coreY,
    rootX: root ? root.x : null,
    // Where the core line lands on screen, and where the cards start.
    coreScreenY: cam.worldToScreen(0, sub.coreY).y,
    handTop: hand ? hand.getBoundingClientRect().top : null,
    lineDepth: g.coreLineDepth, totalDepth: g.coreTotalDepth,
  };
});

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

// ---- the phone -----------------------------------------------------------------------
const ctxP = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
await ctxP.addInitScript(() => { window.MYCELIUM_SUPABASE = { url: '', anonKey: '' }; });
// An AUTHORED map, so the core exists at all — it is off for procedural rolls, and every
// assertion about the red band would be vacuous on one.
const ph = await boot(ctxP, base + '/index.html#level,2-obsidian', 390, 844);
const v = await view(ph);
console.log('\nphone 390x844');
console.log(`  zoom ${v.zoom.toFixed(4)} (floor ${v.floor.toFixed(4)}), view x ${Math.round(v.left)}..${Math.round(v.right)} y ${Math.round(v.top)}..${Math.round(v.bottom)}`);
console.log(`  world ${Math.round(v.worldW)}x${Math.round(v.worldH)}, scrollable ${Math.round(v.scrollH)}, coreY ${Math.round(v.coreY)}`);

ok('the map has a core to measure', v.coreY != null && v.coreY > v.surfaceY,
   `surface ${Math.round(v.surfaceY)}, core ${Math.round(v.coreY)}`);
ok('the playable box is untouched by the change', Math.round(v.coreY - v.surfaceY) === v.lineDepth,
   `${Math.round(v.coreY - v.surfaceY)} deep vs CORE_LINE_DEPTH ${v.lineDepth}`);
ok('the red band is 20% deeper than it was', (v.totalDepth - v.lineDepth) === BAND_NOW,
   `${v.totalDepth - v.lineDepth} (was ${BAND_WAS}; +${(((v.totalDepth - v.lineDepth) / BAND_WAS - 1) * 100).toFixed(1)}%)`);
ok('...and the band is what you scroll through, not cells',
   Math.round(v.scrollH - v.worldH) === (v.totalDepth - v.lineDepth),
   `scrollable ${Math.round(v.scrollH)} - world ${Math.round(v.worldH)} = ${Math.round(v.scrollH - v.worldH)}`);

// A phone opens as far out as the map allows...
ok('a phone opens fully zoomed out', Math.abs(v.zoom - v.floor) < 1e-6,
   `zoom ${v.zoom.toFixed(4)} vs floor ${v.floor.toFixed(4)}`);
// ...at the corner. The view's own left/top edges on the world's, not the camera CENTRE at 0,0 —
// clamp() pulls the centre to the nearest legal spot, which is what puts the edges there.
ok('...at the far left', Math.round(v.left) === 0, `view starts at x ${Math.round(v.left)}`);
ok('...and the top', Math.round(v.top) === 0, `view starts at y ${Math.round(v.top)}`);
ok('the colony start is on screen where it opens', v.rootX != null && v.rootX >= v.left && v.rootX <= v.right,
   v.rootX != null ? `root x ${Math.round(v.rootX)} within ${Math.round(v.left)}..${Math.round(v.right)}` : 'no root');

// THE PAYOFF, and the reason the two asks are one check. The deeper band lowers the zoom floor,
// which lifts the core line up the screen — out from behind the card carousel. Measured against
// the carousel's real top edge, with the PRE-CHANGE band recomputed beside it as a control: at
// 1076 the line sat below that edge, i.e. the bottom of the play area was behind the cards.
ok('the card carousel is on screen to measure against', v.handTop != null && v.handTop > 0,
   v.handTop != null ? `cards start at y ${Math.round(v.handTop)}` : 'no .handbar');
const oldScroll = v.scrollH - BAND_NOW + BAND_WAS;
const oldZoom = Math.max(v.viewW / v.worldW, v.viewH / oldScroll);
const oldCoreScreenY = (v.coreY - oldScroll / 2) * oldZoom + v.viewH / 2;
ok('the whole play area now sits clear of the cards', v.coreScreenY < v.handTop,
   `core line at y ${v.coreScreenY.toFixed(1)}, cards start at ${Math.round(v.handTop)}`);
ok('control: at the old band it did NOT', oldCoreScreenY >= v.handTop,
   `would have been y ${oldCoreScreenY.toFixed(1)} vs cards at ${Math.round(v.handTop)}`);

await ph.screenshot({ path: path.join(__dirname, '.artifacts', 'camstart-phone.png'),
  animations: 'disabled', timeout: 8000 }).catch(() => {});
await ctxP.close();

// ---- the desktop, unchanged ------------------------------------------------------------
// The control for the whole camera half: without it "opens zoomed out" could be true because the
// game always does, which would be a regression for every desktop player.
const ctxD = await b.newContext({ viewport: { width: 1280, height: 720 } });
await ctxD.addInitScript(() => { window.MYCELIUM_SUPABASE = { url: '', anonKey: '' }; });
const dk = await boot(ctxD, base + '/index.html#level,2-obsidian', 1280, 720);
const d = await view(dk);
console.log('\ndesktop 1280x720');
console.log(`  zoom ${d.zoom.toFixed(4)} (floor ${d.floor.toFixed(4)}), view x ${Math.round(d.left)}..${Math.round(d.right)} y ${Math.round(d.top)}..${Math.round(d.bottom)}`);
ok('a desktop still opens at its working zoom, not the floor', d.zoom > d.floor + 0.05,
   `zoom ${d.zoom.toFixed(4)} vs floor ${d.floor.toFixed(4)}`);
// NOT "the camera centre is the root": the colony starts near the left edge, so clamp() parks
// the centre at minX + halfW (753 at this zoom) and the assertion would fail on a build doing
// exactly the right thing. What the desktop opening promises is that the colony is IN VIEW and
// that this is a working zoom rather than the survey one.
ok('...with the colony in view', d.rootX != null && d.rootX >= d.left && d.rootX <= d.right,
   d.rootX != null ? `root x ${Math.round(d.rootX)} within ${Math.round(d.left)}..${Math.round(d.right)}` : 'no root');
ok('...and not the whole depth on screen the way the phone gets it',
   (d.bottom - d.top) < d.scrollH * 0.5,
   `view spans ${Math.round(d.bottom - d.top)} of ${Math.round(d.scrollH)} scrollable`);
ok('...and below the surface line', d.camY > d.surfaceY,
   `camera y ${Math.round(d.camY)}, surface ${Math.round(d.surfaceY)}`);
await ctxD.close();

await b.close(); srv.close();
console.log(`\n==== ${pass} passed, ${fail} failed ====`);
process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('HARNESS ERROR', e); process.exit(2); });
