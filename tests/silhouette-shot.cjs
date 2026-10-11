/* SILHOUETTE SHOT (M15 verify round 2) — a tool, writes frames and prints numbers, never fails. Every band's art
 * answers 404, so every rock is drawn as its mask-table silhouette; the camera is parked mid-band in each of the
 * four bands at 390x844 and a frame written to tests/.artifacts/m15-sil-band<N>-390.png. Prints, per band, the
 * mean colour of silhouette pixels against the bare soil beside them, so "does it read on this soil?" has a
 * number as well as a picture.   node tests/silhouette-shot.cjs [dsf]
 */
const path = require('path'), fs = require('fs');
const H = require('./mine-harness.cjs');
const ART = path.join(__dirname, '.artifacts');
try { fs.mkdirSync(ART, { recursive: true }); } catch (_) {}
(async () => {
  const dsf = +(process.argv[2] || 2);
  const E = await H.start();
  const ctx = await E.browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: dsf });
  const b = await E.boot('#mine,4242', 390, 844, { ctx, before: async (page) => {
    await page.route((u) => /\/assets\/(magnetite|anthracite|garnet|hematite)-c24\//.test(u.pathname), (r) => r.fulfill({ status: 404, body: 'nf' }).catch(() => {}));
    await page.addInitScript(() => { window.MYCELIUM_NO_LOOKAHEAD = true; window.MYCELIUM_NO_IDLE_LOOKAHEAD = true; });
  } });
  await b.page.waitForFunction(() => window.__game && window.__game.state && window.__game.state.substrate && window.__game.state.substrate._rockSolidified, { timeout: 40000 });
  await new Promise((r) => setTimeout(r, 1500));
  for (const [band, m] of [[0, 21], [1, 63], [2, 105], [3, 147]]) {
    const r = await b.page.evaluate(async ([m]) => {
      const g = window.__game, s = g.state, sub = s.substrate, cam = g.camera, cs = sub.cellSize;
      cam.zoom = 0.6; g.mine.lookAt((sub.mineHomeCol + 0.5) * cs, sub.surfaceY + m * cs);
      for (let i = 0; i < 6; i++) await new Promise((q) => requestAnimationFrame(() => q()));
      // Pixels on solid fine cells (the silhouettes) against pixels on open ones (bare soil), sampled on a grid.
      const cv = document.getElementById('game'), c2 = cv.getContext('2d'), dpr = cv.width / cam.viewW;
      const d = c2.getImageData(0, 0, cv.width, cv.height).data, F = sub._fineSize, W = sub._fineCols, fsol = sub._fineSolid;
      const acc = { sol: [0, 0, 0, 0], soil: [0, 0, 0, 0] };
      for (let sy = 140; sy < cam.viewH - 90; sy += 6) for (let sx = 6; sx < cam.viewW - 6; sx += 6) {
        const w = cam.screenToWorld ? cam.screenToWorld(sx, sy) : { x: cam.x + (sx - cam.viewW / 2) / cam.zoom, y: cam.y + (sy - cam.viewH / 2) / cam.zoom };
        const fc = Math.floor(w.x / F), fr = Math.floor((w.y - sub.surfaceY) / F); if (fr < 0) continue;
        const k = fsol[fr * W + fc] === 1 ? 'sol' : 'soil', i = (Math.round(sy * dpr) * cv.width + Math.round(sx * dpr)) * 4;
        acc[k][0] += d[i]; acc[k][1] += d[i + 1]; acc[k][2] += d[i + 2]; acc[k][3]++;
      }
      const mean = (a) => a[3] ? a.slice(0, 3).map((v) => Math.round(v / a[3])) : null;
      return { sol: mean(acc.sol), soil: mean(acc.soil), n: [acc.sol[3], acc.soil[3]], sil: window.__mineMasks.silhouettes() };
    }, [m]);
    await b.page.screenshot({ path: path.join(ART, `m15-sil-band${band}-390.png`), timeout: 8000, animations: 'disabled' }).catch(() => {});
    const lum = (c) => c ? Math.round(0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2]) : null;
    console.log(`band ${band} (${m} m): silhouette pixels mean ${JSON.stringify(r.sol)} (lum ${lum(r.sol)}) against soil ${JSON.stringify(r.soil)} (lum ${lum(r.soil)}); samples ${r.n.join(' / ')}; silhouette draws so far ${r.sil}`);
  }
  console.log('page errors: ' + b.errs.length);
  await b.ctx.close(); await E.close();
})().catch((e) => { console.error(e); process.exit(1); });
