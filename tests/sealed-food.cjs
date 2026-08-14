/* WHICH food is sealed off, and which marker put it there.
 *
 *   node tests/sealed-food.cjs [<id> …]     # default: campaign-10-ember-c30-5
 *
 * A TOOL, not a check: it prints and never fails, so it is not in the runner. `traced-check`
 * already asserts that every food cell is reachable and reports "10 of 128 sealed off" — a
 * number you cannot act on. This is the other half: the world position of each sealed cell and
 * the nearest food marker in the level JSON, which is the thing to move.
 *
 * Two traps, both shared with traced-check and both worth not rediscovering:
 *   - it boots `#level,<id>,turn`. `#level,<id>` alone boots REAL TIME, and the threats then eat
 *     the food while it is being counted — measured on ember, 105 cells to 10 in two and a half
 *     seconds, with the sealed count reading 2 or 4 depending on which tick it landed on.
 *   - it waits for the FINE mask. Collision on an authored map is stamped from each sprite's own
 *     alpha during RENDER, so a flood run at build time floods the coarse grid and answers a
 *     different question.
 */
const http = require('http'), fs = require('fs'), path = require('path');
const { chromium } = require('playwright');
const ROOT = path.resolve(__dirname, '..');
const T = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.webp': 'image/webp', '.mp3': 'audio/mpeg', '.wav': 'audio/wav' };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const IDS = process.argv.slice(2).length ? process.argv.slice(2) : ['campaign-10-ember-c30-5'];

(async () => {
  const srv = await new Promise((res) => { const s = http.createServer((rq, rs) => {
    let p = decodeURIComponent(rq.url.split('?')[0].split('#')[0]); if (p === '/') p = '/index.html';
    const fp = path.join(ROOT, p);
    if (!fp.startsWith(ROOT) || !fs.existsSync(fp) || fs.statSync(fp).isDirectory()) { rs.writeHead(404); rs.end('nf'); return; }
    rs.writeHead(200, { 'Content-Type': T[path.extname(fp)] || 'application/octet-stream' });
    fs.createReadStream(fp).pipe(rs); }); s.listen(0, () => res(s)); });
  const base = 'http://localhost:' + srv.address().port;
  const browser = await chromium.launch({ headless: true, executablePath: '/opt/pw-browsers/chromium' });
  for (const ID of IDS) {
  const page = await browser.newPage({ viewport: { width: 1800, height: 1100 } });
  await page.addInitScript(() => { window.MYCELIUM_SUPABASE = { url: '', anonKey: '' }; });
  await page.goto(base + `/index.html#level,${ID},turn`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#loadscreen.ld-ready', { timeout: 30000 }).catch(() => {});
  await page.click('#loadscreen', { timeout: 5000 }).catch(() => {});
  await page.waitForFunction(() => window.__game && window.__game.state && window.__game.state.substrate, null, { timeout: 30000 });
  await sleep(2500);   // let solidifyRock publish the fine mask

  const out = await page.evaluate(() => {
    const st = window.__game.state, sub = st.substrate;
    // The fine mask the game itself collides against, flooded from the colony's own root —
    // the same shape traced-check uses, so a cell it calls sealed is sealed here too.
    const fsz = sub._fineSize, FC = sub._fineCols, FR = sub._fineRows, mask = sub._fineSolid;
    const surfaceY = sub.surfaceY;
    const openAt = (c, r) => c >= 0 && r >= 0 && c < FC && r < FR && mask[r * FC + c] === 0;
    const root = st.active.nodes[0];
    const seen = new Uint8Array(FC * FR);
    const c0 = Math.floor(root.x / fsz), r0 = Math.floor((root.y - surfaceY) / fsz);
    const q = [[c0, r0]]; seen[r0 * FC + c0] = 1;
    while (q.length) {
      const [c, r] = q.pop();
      for (const [dc, dr] of [[1,0],[-1,0],[0,1],[0,-1]]) {
        const nc = c + dc, nr = r + dr;
        if (!openAt(nc, nr) || seen[nr * FC + nc]) continue;
        seen[nr * FC + nc] = 1; q.push([nc, nr]);
      }
    }
    const reaches = (x, y) => !!seen[Math.floor((y - surfaceY) / fsz) * FC + Math.floor(x / fsz)];
    const bad = [];
    for (let c = 0; c < sub.cols; c++) for (let r = 0; r < sub.rows; r++) {
      const cell = sub.cellAt(c, r);
      if (!cell || !(cell.maxNutrient > 0)) continue;
      const p = sub.cellCenter(c, r);
      if (!reaches(p.x, p.y)) bad.push({ c, r, x: Math.round(p.x), y: Math.round(p.y), kind: cell.foodKind });
    }
    const objs = ((st.levelDef || {}).objects || []).filter((o) => /duff|cache/.test(o.kind || o.t || ''));
    return { bad, objs: objs.map((o) => ({ kind: o.kind || o.t, x: Math.round(o.x), y: Math.round(o.y) })) };
  });

  console.log(`${ID}: ${out.bad.length} sealed food cell(s)`);
  for (const b of out.bad) {
    let best = null, bd = 1e9;
    for (const o of out.objs) { const d = Math.hypot(o.x - b.x, o.y - b.y); if (d < bd) { bd = d; best = o; } }
    console.log(`  cell ${b.c},${b.r}  world ${b.x},${b.y}  ${b.kind}  ← nearest marker ${best.kind} at ${best.x},${best.y} (${Math.round(bd)}u)`);
  }
  await page.close();
  }
  await browser.close(); srv.close();
})();
