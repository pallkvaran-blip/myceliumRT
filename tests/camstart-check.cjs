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

// The band as the owner set it. Pinned because it is a decision, not a derivation — the
// deepenings were +10%, then +20%, then +10% OF THE BAND each time, and a future "+N%" has to
// start from the number that is actually shipped.
const BAND_ORIG = 978;          // where the ladder started
const BAND_NOW = 1420;          // 978 -> 1076 (+10%) -> 1291 (+20%) -> 1420 (+10%)

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
ok('the red band is where the deepenings left it', (v.totalDepth - v.lineDepth) === BAND_NOW,
   `${v.totalDepth - v.lineDepth} (from ${BAND_ORIG}; +${(((v.totalDepth - v.lineDepth) / BAND_ORIG - 1) * 100).toFixed(1)}% over three asks)`);
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
// Against the ORIGINAL band, not the previous one: by 1291 the line already cleared the cards,
// so a control against that would assert nothing. 978 is where the ladder started and where the
// line was still behind them.
const oldScroll = v.scrollH - BAND_NOW + BAND_ORIG;
const oldZoom = Math.max(v.viewW / v.worldW, v.viewH / oldScroll);
const oldCoreScreenY = (v.coreY - oldScroll / 2) * oldZoom + v.viewH / 2;
ok('the whole play area now sits clear of the cards', v.coreScreenY < v.handTop,
   `core line at y ${v.coreScreenY.toFixed(1)}, cards start at ${Math.round(v.handTop)}`);
ok('control: at the original band it did NOT', oldCoreScreenY >= v.handTop,
   `band ${BAND_ORIG} would have put it at y ${oldCoreScreenY.toFixed(1)} vs cards at ${Math.round(v.handTop)}`);

// ---- ...and the tutorial hands the map back at that same view -------------------------
// Owner: finishing the walkthrough should leave you at the zoomed-out top-left view. The tutorial
// frames one thing at a time, so without this you are left wherever its last step was looking.
//
// IT USED TO PRESS "End", AND THERE IS NO End ANY MORE. The walkthrough is unskippable (owner) —
// one Next button, no Escape — because the skips were concentrated on a single step and a session
// that skipped went on to clear a level 4% of the time against 52% for one that finished. So the
// probe drives `tutorial.end()`, the console-only hook that walks the same `finish('done')` exit;
// clicking Next to the end is not open to a headless probe, since several steps gate on a real
// player action. The absence of the button is asserted below in its own right.
const tut = await ph.evaluate(async () => {
  const g = window.__game, cam = g.camera;
  const survey = { x: cam.x, y: cam.y, zoom: cam.zoom };     // it is sitting there right now
  g.startTutorial();
  await new Promise((r) => setTimeout(r, 400));
  // Frame something the way a step does, so there is a real move to come back from.
  const root = g.state.networks[0] && g.state.networks[0].nodes[0];
  cam.zoom = 1.6; cam.x = root ? root.x + 600 : 900; cam.y = g.state.substrate.surfaceY + 500;
  cam.clamp();
  const moved = { x: cam.x, y: cam.y, zoom: cam.zoom };
  const had = !!(g.tutorial && g.tutorial.active);
  const endBtn = !!document.getElementById('tutEnd');
  const btns = [...document.querySelectorAll('#tutorial .tut-btn')].map((b) => b.textContent.trim());
  if (g.tutorial) g.tutorial.end();
  await new Promise((r) => setTimeout(r, 1200));             // the pull-back eases over 640ms
  return { had, endBtn, btns, survey, moved, after: { x: cam.x, y: cam.y, zoom: cam.zoom },
           stillRunning: !!(g.tutorial && g.tutorial.active) };
});
ok('the tutorial was running', tut.had === true, JSON.stringify(tut.had));
// THE OWNER'S ASK, ASSERTED AS AN ABSENCE. Two ways to get it wrong and only one of them is the
// element: the id could go while a second button survives under another name, so the BUTTON LIST
// is checked as well as `#tutEnd`.
ok('...with no End button on the step', tut.endBtn === false, `#tutEnd present=${tut.endBtn}`);
ok('...and exactly one button, Next', tut.btns.length === 1 && /^(Next|Begin)$/.test(tut.btns[0]),
   JSON.stringify(tut.btns));
ok('...the probe really moved the camera off the survey view first',
   Math.abs(tut.moved.zoom - tut.survey.zoom) > 0.2, `zoom ${tut.survey.zoom.toFixed(3)} -> ${tut.moved.zoom.toFixed(3)}`);
ok('finishing it returns to the survey zoom', Math.abs(tut.after.zoom - tut.survey.zoom) < 1e-3,
   `zoom ${tut.after.zoom.toFixed(4)} vs ${tut.survey.zoom.toFixed(4)}`);
ok('...and to the same corner', Math.abs(tut.after.x - tut.survey.x) < 1 && Math.abs(tut.after.y - tut.survey.y) < 1,
   `(${Math.round(tut.after.x)}, ${Math.round(tut.after.y)}) vs (${Math.round(tut.survey.x)}, ${Math.round(tut.survey.y)})`);
ok('...and the tutorial is over', tut.stillRunning === false, `running=${tut.stillRunning}`);

// FINISHING it walks the same exit — `finish('done')` and `finish('skip')` are one function, and
// both carry a `why`, which is what tells them from the teardown a level change does.
const fin = await ph.evaluate(async () => {
  const g = window.__game, cam = g.camera;
  const survey = { x: cam.x, y: cam.y, zoom: cam.zoom };
  g.startTutorial();
  await new Promise((r) => setTimeout(r, 400));
  cam.zoom = 1.8; cam.x = 1400; cam.y = g.state.substrate.surfaceY + 700; cam.clamp();
  // WAIT FOR THE CAMERA TO BE STILL FIRST. The tutorial's own first step frames its subject with
  // a 640ms tween, and that tween keeps easing over anything the probe sets — the first version
  // of this assertion read 0.675 and blamed destroy(), which had not touched the camera at all.
  // Two agreeing samples, then the teardown.
  let prev = null, held = null;
  for (let i = 0; i < 40; i++) {
    const now = { x: cam.x, y: cam.y, zoom: cam.zoom };
    if (prev && Math.abs(prev.zoom - now.zoom) < 1e-6 && Math.abs(prev.x - now.x) < 0.01) { held = now; break; }
    prev = now;
    await new Promise((r) => setTimeout(r, 150));
  }
  const t = g.tutorial;
  // destroy IS finish() — but with no `why`, so it must NOT move us: a level change sets its own
  // opening camera a moment later, and a pull-back started here would animate away from it.
  if (t) t.destroy();
  await new Promise((r) => setTimeout(r, 900));
  return { survey, held, after: { x: cam.x, y: cam.y, zoom: cam.zoom } };
});
ok('the camera settled before the teardown was measured', !!fin.held,
   fin.held ? `held at zoom ${fin.held.zoom.toFixed(3)}` : 'never settled');
// THE SECOND CLAUSE IS RELATIVE, NOT AN ABSOLUTE 0.2. It only has to say "this is not the survey
// view", and an absolute margin is a bet on how far in the tutorial frames: widening the phone
// framing (0.5 -> 0.42 of the step's zoom) took the gap from 0.43 to 0.17 and failed this on a
// build where the teardown behaved perfectly. A ratio cannot go stale the same way — the survey
// zoom is the floor for the whole map, so anything the tutorial frames is far above it.
ok('a tutorial torn down by a LEVEL CHANGE does not move the camera',
   !!fin.held && Math.abs(fin.after.zoom - fin.held.zoom) < 1e-6
     && fin.after.zoom / fin.survey.zoom > 1.25,
   `zoom stayed ${fin.after.zoom.toFixed(3)} (survey would be ${fin.survey.zoom.toFixed(3)}, ` +
   `ratio ${(fin.after.zoom / fin.survey.zoom).toFixed(2)}x)`);

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
