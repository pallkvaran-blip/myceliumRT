/* SLOW-LINK PROBE (M15 verify round 2) — a tool, prints and never fails. A fresh FIRST VISIT on the plain
 * URL (the release build's dev flag off, `/index-nodev.html`), on a throttled link (CDP network emulation),
 * timed end to end: navigation -> the loader's gate (`ld-ready`) -> the player's tap (at once) -> the curtain
 * lifting (`body.handoff` dropped, the map on screen) -> a dig the game would accept (the mask landed and no
 * art hold). Bytes on the wire (encoded) are summed before each moment.
 *
 *   node tests/slowlink-probe.cjs [runs] [--mbps 1.5] [--lat 150] [--gzip] [--index <path to an index.html>]
 *                                 [--route-masks <ms>] [--fail-band <folder>] [--root <unpacked zip dir>]
 *
 * `--gzip` serves text (html/json/js) gzip-encoded, as a CDN would; without it the server sends raw bytes,
 * the worst case (the M15 verifier's measurement: ld-ready ~28 s through the 12 s safety net). `--index`
 * serves a different index.html (e.g. an older build kept in the scratchpad) for a before/after. `--route-masks`
 * holds assets/mine-masks.json back that many ms (a stalled table); `--fail-band` answers a band folder 404.
 * `--root` serves an UNPACKED release zip instead of the tree (its index.html is already the release page: the dev
 * flag patched, comments stripped, the boot PNGs as webp) — the artefact a player downloads.
 */
const http = require('http'), fs = require('fs'), path = require('path'), zlib = require('zlib');
const { chromium } = require('playwright');
const ROOT = path.resolve(__dirname, '..');
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const has = (k) => process.argv.includes(k);
const RUNS = +(process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : 1);
const MBPS = +arg('--mbps', 1.5), LAT = +arg('--lat', 150), GZ = has('--gzip');
const INDEX = arg('--index', path.join(ROOT, 'index.html'));
const MASK_DELAY = +arg('--route-masks', 0), FAIL_BAND = arg('--fail-band', null);
const SROOT = arg('--root', null) ? path.resolve(arg('--root')) : ROOT;
const T = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.webp': 'image/webp', '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.svg': 'image/svg+xml', '.css': 'text/css' };
const A = '// itch zip, and confirm with scratchpad/verify-nodev.mjs.\n    enabled: true,';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const srv = await new Promise((res) => { const s = http.createServer(async (rq, rs) => {
    let p = decodeURIComponent(rq.url.split('?')[0].split('#')[0]); if (p === '/') p = '/index.html';
    let body = null, type = null;
    if (p === '/index-nodev.html' && SROOT !== ROOT) { body = fs.readFileSync(path.join(SROOT, 'index.html')); type = 'text/html'; }
    else if (p === '/index-nodev.html') {
      const html = fs.readFileSync(INDEX, 'utf8');
      if (!html.includes(A)) { rs.writeHead(500); rs.end('dev anchor moved'); return; }
      body = Buffer.from(html.replace(A, A.replace('enabled: true,', 'enabled: false,'))); type = 'text/html';
    } else {
      if (FAIL_BAND && p.startsWith('/assets/' + FAIL_BAND + '/')) { rs.writeHead(404); rs.end('nf'); return; }
      const fp = path.join(SROOT, p);
      if (!fp.startsWith(SROOT) || !fs.existsSync(fp) || fs.statSync(fp).isDirectory()) { rs.writeHead(404); rs.end('nf'); return; }
      if (MASK_DELAY && /mine-masks\.json$/.test(p)) await sleep(MASK_DELAY);
      body = fs.readFileSync(fp); type = T[path.extname(fp)] || 'application/octet-stream';
    }
    const hdr = { 'Content-Type': type, 'Cache-Control': 'no-store' };
    if (GZ && /^(text\/|application\/json)/.test(type) && /gzip/.test(rq.headers['accept-encoding'] || '')) { body = zlib.gzipSync(body); hdr['Content-Encoding'] = 'gzip'; }
    hdr['Content-Length'] = body.length;
    rs.writeHead(200, hdr); rs.end(body);
  }); s.listen(0, () => res(s)); });
  const base = 'http://localhost:' + srv.address().port;
  const browser = await chromium.launch({ headless: true, executablePath: '/opt/pw-browsers/chromium' });
  console.log(`slow link: ${MBPS} Mbps down, ${LAT} ms latency, ${GZ ? 'gzip' : 'raw (no compression)'}; index ${path.relative(ROOT, INDEX) || INDEX}`
    + (SROOT !== ROOT ? `; serving the unpacked zip ${SROOT}` : '') + (MASK_DELAY ? `; mask table held ${MASK_DELAY} ms` : '') + (FAIL_BAND ? `; ${FAIL_BAND} answers 404` : ''));
  for (let r = 0; r < RUNS; r++) {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const page = await ctx.newPage();
    const errs = []; page.on('pageerror', (e) => errs.push(String(e && e.message)));
    const cdp = await ctx.newCDPSession(page);
    await cdp.send('Network.enable');
    await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: LAT, downloadThroughput: MBPS * 1e6 / 8, uploadThroughput: MBPS * 1e6 / 16 });
    const reqUrl = new Map(), fin = [];
    cdp.on('Network.requestWillBeSent', (e) => reqUrl.set(e.requestId, e.request.url));
    cdp.on('Network.loadingFinished', (e) => fin.push({ url: reqUrl.get(e.requestId) || '', bytes: e.encodedDataLength, t: Date.now() }));
    const marks = {};
    await page.exposeFunction('__slowMark', (k, t) => { if (!(k in marks)) marks[k] = { node: Date.now(), page: t }; });
    await page.addInitScript(() => {
      window.MYCELIUM_SUPABASE = { url: '', anonKey: '' };
      let sawHand = false;
      new MutationObserver(() => {
        const l = document.getElementById('loadscreen');
        if (l && l.classList.contains('ld-ready')) window.__slowMark('ready', performance.now());
        if (document.body) { const h = document.body.classList.contains('handoff'); if (h) sawHand = true; else if (sawHand) window.__slowMark('reveal', performance.now()); }
      }).observe(document, { subtree: true, attributes: true, attributeFilter: ['class'] });
    });
    const t0 = Date.now();
    await page.goto(base + '/index-nodev.html', { waitUntil: 'commit' });
    await page.waitForSelector('#loadscreen.ld-ready', { timeout: 120000 }).catch(() => {});
    const atReady = await page.evaluate(() => {
      const n = performance.getEntriesByType('navigation')[0];
      const K = window.__mineMasks;
      return { html: n ? Math.round(n.responseEnd) : null, table: K ? K.tableSize() : null };
    }).catch(() => ({}));
    const readyNode = Date.now();
    await page.click('#loadscreen', { timeout: 5000 }).catch(() => {});
    marks.tap = { node: Date.now() };
    // Poll for the run, the reveal, and a dig the game would accept (mask landed, no art hold, curtain gone).
    let play = null, view = null;
    for (let i = 0; i < 1200; i++) {
      const st = await page.evaluate(() => {
        const g = window.__game, s = g && g.state, sub = s && s.substrate;
        if (!sub || !sub.mine) return null;
        const hand = document.body.classList.contains('handoff');
        return { solid: !!sub._rockSolidified, hold: !!sub._mineArtHold, hand, t: performance.now(),
                 sil: window.__mineMasks ? window.__mineMasks.silhouettes() : 0 };
      }).catch(() => null);
      if (st && st.solid && !st.hold && !st.hand) { play = st; break; }
      await sleep(100);
    }
    if (play) marks.play = { node: Date.now(), page: play.t };
    view = await page.evaluate(() => {
      const g = window.__game, sub = g && g.state && g.state.substrate; if (!sub) return null;
      const cam = g.camera, z = cam.zoom, x0 = cam.x - cam.viewW / 2 / z, x1 = cam.x + cam.viewW / 2 / z, y0 = cam.y - cam.viewH / 2 / z, y1 = cam.y + cam.viewH / 2 / z;
      let inView = 0, missing = 0;
      for (const s of sub.levelSprites || []) { const b = Math.hypot(s.w, s.h) / 2;
        if (s.x + b < x0 || s.x - b > x1 || s.y + b < y0 || s.y - b > y1 || s.y + b < sub.surfaceY) continue;
        inView++; if (!window.__mineMasks.hasArt(s.key)) missing++; }
      return { inView, missing, sil: window.__mineMasks.silhouettes() };
    }).catch(() => null);
    const by = (tNode) => { const L = fin.filter((x) => x.t <= tNode); const band = {};
      for (const x of L) { const m = /\/assets\/(\w+)-c24\//.exec(x.url); if (m) band[m[1]] = (band[m[1]] | 0) + 1; }
      return { n: L.length, mb: (L.reduce((a, x) => a + (x.bytes || 0), 0) / 1048576).toFixed(2), band }; };
    const ms = (k) => marks[k] ? marks[k].node - t0 : null;
    const R = by(readyNode), P = marks.play ? by(marks.play.node) : null;
    console.log(`run ${r + 1}: html responseEnd ${atReady.html} ms; gate ready ${ms('ready')} ms (page clock ${marks.ready ? Math.round(marks.ready.page) : '-'}), mask table ${atReady.table};`
      + ` tap ${ms('tap')}; curtain lifted ${ms('reveal')} ms; playable ${ms('play')} ms (navigation -> first dig accepted)`);
    console.log(`  before the gate: ${R.n} requests finished, ${R.mb} MB on the wire, band files ${JSON.stringify(R.band)}`);
    if (P) console.log(`  before playable: ${P.n} requests finished, ${P.mb} MB on the wire, band files ${JSON.stringify(P.band)}`);
    console.log(`  at playable: ${view ? `${view.inView} sprites in view, ${view.missing} without art, ${view.sil} silhouette draws so far` : '-'}; page errors ${errs.length}${errs.length ? ' ' + errs.slice(0, 3).join(' | ') : ''}`);
    await ctx.close();
  }
  await browser.close(); srv.close();
})().catch((e) => { console.error(e); process.exit(1); });
