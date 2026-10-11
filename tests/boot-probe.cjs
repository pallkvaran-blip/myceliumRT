/* BOOT PROBE (M15) — a tool, prints and never fails. What a boot downloads before the gate turns
 * ready (`#loadscreen.ld-ready`), and after it, by phase and by folder; and boot-to-ready.
 *   node tests/boot-probe.cjs [first|returning] [runs]
 */
const path = require('path'), fs = require('fs');
const H = require('./mine-harness.cjs');
const ROOT = path.resolve(__dirname, '..');
(async () => {
  const kind = process.argv[2] || 'first', runs = +process.argv[3] || 3;
  const S = await H.start();
  if (kind === 'ab') { await ab(S); await S.close(); return; }
  for (let r = 0; r < runs; r++) {
    const ctx = await S.browser.newContext({ viewport: { width: 390, height: 844 } });
    const page = await ctx.newPage();
    const reqs = []; let readyAt = null;
    page.on('requestfinished', (rq) => {
      const u = new URL(rq.url()); const p = decodeURIComponent(u.pathname);
      let sz = 0; try { sz = fs.statSync(path.join(ROOT, p === '/' ? 'index.html' : p)).size; } catch (_) {}
      reqs.push({ p, sz, t: Date.now(), ready: readyAt != null });
    });
    if (kind === 'returning') await page.addInitScript(() => { try { if (!localStorage.getItem('mycelium.progress.v2')) localStorage.setItem('mycelium.progress.v2', JSON.stringify({ runsDone: 1, mineBest: 20 })); } catch (_) {} });
    await page.addInitScript(() => { window.MYCELIUM_SUPABASE = { url: '', anonKey: '' }; });
    const t0 = Date.now();
    await page.goto(S.base + '/index.html', { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('#loadscreen.ld-ready', { timeout: 40000 });
    readyAt = Date.now();
    const navT = await page.evaluate(() => { const n = performance.getEntriesByType('navigation')[0]; return n ? n.responseEnd : 0; });
    await new Promise((res) => setTimeout(res, 3000));
    const before = reqs.filter((x) => x.t <= readyAt), after = reqs.filter((x) => x.t > readyAt);
    const by = (L) => { const m = {}; for (const x of L) { const d = x.p.split('/').slice(0, 3).join('/'); m[d] = m[d] || [0, 0]; m[d][0]++; m[d][1] += x.sz; } return Object.entries(m).sort((a, b) => b[1][1] - a[1][1]).map(([k, v]) => `${k} ${v[0]} ${(v[1] / 1024).toFixed(0)}K`).join(' | '); };
    const mb = (L) => (L.reduce((a, x) => a + x.sz, 0) / 1048576).toFixed(2);
    const lastBefore = before.length ? Math.max(...before.map((x) => x.t)) - t0 : 0;
    const lastBase = Math.max(0, ...before.filter((x) => !/-c\d+\//.test(x.p)).map((x) => x.t)) - t0;
    console.log(`run ${r + 1} [${kind}] goto->ready ${readyAt - t0} ms (html responseEnd ${navT.toFixed(0)} ms; last base file ${lastBase} ms, last file ${lastBefore} ms)`);
    console.log(`  before ready: ${before.length} requests, ${mb(before)} MB :: ${by(before)}`);
    console.log(`  after ready (3 s): ${after.length} requests, ${mb(after)} MB :: ${by(after)}`);
    await ctx.close();
  }
  await S.close();
})();

// THE DIET'S A/B: the same leg-1 world booted with the diet and with `MYCELIUM_FULL_BOOT`, the camera parked
// at five places a player looks (the hill and the sky, the island, a seam, a pocket, deep rock), one frame
// drawn at a FIXED clock on each, pixels compared. Any non-zero count means the diet removed art the mine draws.
async function frames(S, full) {
  const b = await S.boot('#leg,1,1', 390, 844, { returning: true, before: (p) => p.addInitScript(([f, sk]) => { if (f) window.MYCELIUM_FULL_BOOT = true; if (sk) window.MYCELIUM_DIET_SKIP = sk; }, [full, process.env.DIET_SKIP || null]) });
  const page = b.page;
  await page.waitForFunction(() => window.__game && window.__game.state && window.__game.state.substrate._rockSolidified, { timeout: 40000 });
  await new Promise((r) => setTimeout(r, 6000));   // the root's reveal and the leg banner settle first
  const out = await page.evaluate(async () => {
    const g = window.__game, s = g.state, sub = s.substrate, cam = g.camera;
    s._mineCamFree = true;
    const J = sub.mineJourney, cs = sub.cellSize;
    const seam = sub.foodPiles.find((p) => p.cells && p.cells.length) || null;
    const seamXY = seam ? { x: (seam.cells[0] % sub.cols + 0.5) * cs, y: sub.surfaceY + (Math.floor(seam.cells[0] / sub.cols) + 0.5) * cs } : null;
    const res = (sub.reservoirs || [])[0];
    const spots = [
      ['hill', (sub.mineHomeCol + 0.5) * cs, sub.surfaceY - 100, 0.6],
      ['island', J ? (J.taproot.col + 0.5) * cs : 2000, sub.surfaceY - 80, 0.6],
      ['seam', seamXY ? seamXY.x : 1500, seamXY ? seamXY.y : 800, 0.9],
      ['pocket', res ? (res.cx + 0.5) * cs : 1300, res ? sub.surfaceY + (res.cy + 0.5) * cs : 1300, 0.9],
      ['deep', (sub.mineHomeCol + 0.5) * cs, sub.surfaceY + 4000, 0.6]];
    const cv = document.getElementById('game');
    const r = {};
    for (const [n, x, y, z] of spots) {
      cam.x = x; cam.y = y; cam.zoom = z; if (cam.clamp) cam.clamp();
      for (let i = 0; i < 4; i++) g.renderFrame(123456, 0);
      const c2 = cv.getContext('2d'); const d = c2.getImageData(0, 0, cv.width, cv.height).data;
      r[n] = Array.from(d.filter((_, i) => i % 4 !== 3 && (i % 64) < 8));
      r[n + '_w'] = cv.width;
    }
    return r;
  });
  await b.ctx.close();
  return out;
}
async function ab(S) {
  const ctl = process.argv[3] === "control";   // full vs full: the noise floor
  const A = await frames(S, ctl), B = await frames(S, true);
  for (const k of Object.keys(A)) {
    if (k.endsWith('_w')) continue;
    let diff = 0, big = 0, y0 = 1e9, y1 = -1, x0 = 1e9, x1 = -1; const n = Math.min(A[k].length, B[k].length);
    const per = (A[k + '_w'] / 16) * 6;   // sampled channels per canvas row (2 px of every 16, 3 channels)
    for (let i = 0; i < n; i++) { const d = Math.abs(A[k][i] - B[k][i]); if (d) diff++;
      if (d > 24) { big++; const y = Math.floor(i / per), x = Math.floor((i % per) / 6) * 16; y0 = Math.min(y0, y); y1 = Math.max(y1, y); x0 = Math.min(x0, x); x1 = Math.max(x1, x); } }
    console.log(`${k}: ${diff} of ${n} sampled channels differ (${big} by > 24${big ? `, device box x ${x0}-${x1} y ${y0}-${y1}` : ''})`);
  }
}
