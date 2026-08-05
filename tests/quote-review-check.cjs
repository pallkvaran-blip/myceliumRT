/* Check the generated quote review tool (docs/quote-review.html) renders and behaves.
 *
 * Regenerate the page first if docs/quotes.json changed: `node scripts/gen-quote-review.mjs`.
 *
 * Served over http rather than opened as file:// — a file:// page gets an opaque origin in
 * Chromium and localStorage can throw there, which would make the persistence assertions test the
 * harness instead of the tool. Same server shim as review-check.cjs.
 */
const http = require('http'), fs = require('fs'), path = require('path');
const { chromium } = require('playwright');
const ROOT = path.resolve(__dirname, '..');

(async () => {
  const srv = await new Promise((res) => {
    const s = http.createServer((rq, rs) => {
      let p = decodeURIComponent(rq.url.split('?')[0]);
      if (p === '/') p = '/docs/quote-review.html';
      const fp = path.join(ROOT, p);
      if (!fp.startsWith(ROOT) || !fs.existsSync(fp)) { rs.writeHead(404); rs.end('nf'); return; }
      rs.writeHead(200, { 'Content-Type': 'text/html' });
      fs.createReadStream(fp).pipe(rs);
    });
    s.listen(0, () => res(s));
  });
  const base = 'http://localhost:' + srv.address().port;
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
  const errs = [];
  page.on('pageerror', (e) => errs.push(String(e && e.message)));
  page.on('console', (m) => { if (m.type() === 'error') errs.push('console:' + m.text()); });
  await page.goto(base + '/docs/quote-review.html', { waitUntil: 'load' });
  await page.waitForSelector('.q');

  let pass = 0, fail = 0;
  const ok = (n, c, x) => { c ? (pass++, console.log('  PASS  ' + n + (x ? '  — ' + x : ''))) : (fail++, console.log('  FAIL  ' + n + (x ? '  — ' + x : ''))); };

  // The page is baked from docs/quotes.json, so its own count is the thing to compare against —
  // hard-coding 96 here would go stale the moment a quote is added.
  const data = JSON.parse(fs.readFileSync(path.join(ROOT, 'docs', 'quotes.json'), 'utf8'));
  const QS = data.quotes;
  const nR1 = QS.filter((q) => q.round === 1).length, nR2 = QS.filter((q) => q.round === 2).length;

  const n = await page.locator('.q').count();
  ok('every quote in the data renders', n === QS.length, `${n} cards of ${QS.length}`);
  const rounds = await page.locator('.rnd h2').allTextContents();
  ok('both rounds get their own heading', rounds.join('|') === 'Round 1|Round 2', rounds.join('|'));
  // The owner asked for "both rounds", and round 2 continued the numbering rather than restarting,
  // so a line offered twice has to say so or they say yes to both copies of it.
  const wantDupes = (() => {
    const seen = new Set(), out = [];
    for (const q of QS) {
      const k = q.text.toLowerCase().replace(/[^a-z ]+/g, '').replace(/\s+/g, ' ').trim();
      if (seen.has(k)) out.push(q.id); else seen.add(k);
    }
    return out;
  })();
  const dupes = await page.locator('.dupe').allTextContents();
  ok('a line offered in both rounds is flagged', dupes.length === wantDupes.length,
     `${dupes.length} flagged, ${wantDupes.length} in the data`);

  // --- judging -------------------------------------------------------------------------------
  await page.locator('.q').first().locator('.vb.yes').click();
  ok('a click records a verdict', (await page.locator('#cY').textContent()) === 'yes 1');
  ok('and the card shows it', await page.locator('.q').first().evaluate((e) => e.classList.contains('v-yes')));
  ok('judging advances the selection', (await page.locator('.q.cur .qn').textContent()) === '2');

  await page.keyboard.press('n');
  await page.keyboard.press('m');
  const chips = await page.evaluate(() => ['cY', 'cM', 'cN', 'cLeft'].map((i) => document.getElementById(i).textContent));
  ok('the keyboard judges and the tally follows',
     chips.join(' ') === `yes 1 maybe 1 no 1 unjudged ${QS.length - 3}`, chips.join(' '));

  // Y/N/M must stand down inside the comment field, or the first letter of every comment is a verdict.
  await page.locator('.q').first().locator('.qc').fill('yes but shorten it');
  ok('typing a comment does not judge', (await page.locator('#cY').textContent()) === 'yes 1');

  await page.locator('.q').first().locator('.vb.yes').click();
  ok('clicking the same verdict again clears it', (await page.locator('#cY').textContent()) === 'yes 0');
  await page.locator('.q').first().locator('.vb.yes').click();

  // --- filters -------------------------------------------------------------------------------
  await page.click('#fR2');
  ok('Round 2 shows only round 2',
     (await page.locator('.q').count()) === nR2 && (await page.locator('.rnd h2').allTextContents()).join('|') === 'Round 2',
     await page.locator('.q').count() + ' of ' + nR2);
  await page.click('#fR1');
  ok('Round 1 shows only round 1', (await page.locator('.q').count()) === nR1);
  await page.click('#fLeft');
  ok('Unjudged hides what has been judged', (await page.locator('.q').count()) === QS.length - 3);

  // The list has to be read BEFORE the verdict lands, or under this filter the judged card is
  // already gone, findIndex returns -1, and "the next one" is the top of the page.
  const before = await page.locator('.q').nth(1).locator('.qn').textContent();
  await page.locator('.q').first().locator('.vb.no').click();
  const after = await page.locator('.q.cur .qn').textContent();
  ok('under Unjudged the selection still steps forward', after === before, before + ' -> ' + after);
  await page.click('#fAll');

  // --- export --------------------------------------------------------------------------------
  await page.click('#bExport');
  const out = JSON.parse(await page.locator('#out').inputValue());
  ok('the export is tagged', out.format === 'mycelium-quote-review' && out.version === 1);
  ok('every judged quote is in verdicts', Object.keys(out.verdicts).length === 4, String(Object.keys(out.verdicts).length));
  ok('accepted carries the round', out.accepted.length === 1 && out.accepted[0].round === 1, JSON.stringify(out.accepted));
  ok('maybe is its own list', out.maybe.length === 1);
  const withComment = Object.values(out.verdicts).filter((v) => v.comment);
  ok('a comment survives into the export',
     withComment.length === 1 && withComment[0].comment === 'yes but shorten it', JSON.stringify(withComment));

  // --- persistence ---------------------------------------------------------------------------
  await page.reload({ waitUntil: 'load' });
  await page.waitForSelector('.q');
  const chips2 = await page.evaluate(() => ['cY', 'cM', 'cN'].map((i) => document.getElementById(i).textContent));
  ok('verdicts survive a reload', chips2.join(' ') === 'yes 1 maybe 1 no 2', chips2.join(' '));
  ok('and so does the comment',
     (await page.locator('.q').first().locator('.qc').inputValue()) === 'yes but shorten it');

  ok('no page errors', errs.length === 0, errs.slice(0, 2).join(' | '));
  await page.screenshot({ path: path.join(__dirname, '.artifacts', 'quote-review.png'), animations: 'disabled', timeout: 15000 }).catch(() => {});
  console.log(`\n==== ${pass} passed, ${fail} failed ====`);
  await browser.close(); srv.close(); process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('HARNESS ERROR', e); process.exit(2); });
