/* Card-review tool: the severity pills only appear on the cards that earned one. */
const http = require('http'), fs = require('fs'), path = require('path');
const { chromium } = require('playwright');
const ROOT = path.resolve(__dirname, '..');   // the repo root — served as-is
let pass = 0, fail = 0;
const ok = (n, c, x) => { c ? (pass++, console.log('  PASS  ' + n + (x ? '  — ' + x : ''))) : (fail++, console.log('  FAIL  ' + n + (x ? '  — ' + x : ''))); };

(async () => {
  const srv = await new Promise((res) => { const s = http.createServer((rq, rs) => {
    const fp = path.join(ROOT, decodeURIComponent(rq.url.split('?')[0]));
    if (!fp.startsWith(ROOT) || !fs.existsSync(fp)) { rs.writeHead(404); rs.end('nf'); return; }
    rs.writeHead(200, { 'Content-Type': 'text/html' }); fs.createReadStream(fp).pipe(rs); }); s.listen(0, () => res(s)); });
  const base = 'http://localhost:' + srv.address().port;
  const b = await chromium.launch({ headless: true });
  const p = await b.newPage({ viewport: { width: 1200, height: 900 } });
  const errs = []; p.on('pageerror', (e) => errs.push(String(e && e.message)));
  await p.goto(base + '/docs/card-review.html', { waitUntil: 'load' });
  const r = await p.evaluate(() => ({
    high: document.querySelectorAll('.sevpill.high').length,
    mid: document.querySelectorAll('.sevpill.mid').length,
    anyPill: document.querySelectorAll('.sevpill').length,
    stripes: document.querySelectorAll('.card.sev-high, .card.sev-mid').length,
    onClock: document.querySelectorAll('.sum .sum-n')[0].textContent,
    hotSummary: document.querySelectorAll('.sum .sum-n')[1].textContent,
  }));
  ok('pills only on high/mid cards', r.anyPill === r.high + r.mid,
     `${r.anyPill} pill(s) = ${r.high} high + ${r.mid} mid`);
  ok('each pilled card also gets its edge stripe', r.stripes === r.anyPill, `${r.stripes} striped`);
  ok('the summary count agrees with the cards', +r.hotSummary === r.high + r.mid,
     `summary says ${r.hotSummary}; ${r.onClock} cards on a clock`);
  ok('no page errors', errs.length === 0, errs.slice(0, 2).join(' | '));
  await p.screenshot({ path: path.join(__dirname, '.artifacts', 'card-review.png') });
  console.log(`\n==== ${pass} passed, ${fail} failed ====`);
  await b.close(); srv.close();
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('HARNESS ERROR', e); process.exit(2); });
