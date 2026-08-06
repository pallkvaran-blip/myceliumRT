/* Check the generated review tool renders, and that its buttons/filters/export work. */
const http=require('http'),fs=require('fs'),path=require('path');const {chromium}=require('playwright');
const ROOT = path.resolve(__dirname, '..');   // the repo root — served as-is
(async()=>{
  const srv=await new Promise(res=>{const s=http.createServer((rq,rs)=>{
    let p=decodeURIComponent(rq.url.split('?')[0]); if(p==='/')p='/docs/card-review.html';
    const fp=path.join(ROOT,p);
    if(!fp.startsWith(ROOT)||!fs.existsSync(fp)){rs.writeHead(404);rs.end('nf');return;}
    rs.writeHead(200,{'Content-Type':'text/html'});fs.createReadStream(fp).pipe(rs);});s.listen(0,()=>res(s));});
  const base='http://localhost:'+srv.address().port;
  const browser=await chromium.launch({headless:true});
  const page=await browser.newPage({viewport:{width:1200,height:900}});
  const errs=[];page.on('pageerror',e=>errs.push(String(e&&e.message)));
  page.on('console',m=>{if(m.type()==='error')errs.push('console:'+m.text());});
  await page.goto(base+'/docs/card-review.html',{waitUntil:'load'});
  let pass=0,fail=0;const ok=(n,c,x)=>{c?(pass++,console.log('  PASS  '+n+(x?'  — '+x:''))):(fail++,console.log('  FAIL  '+n+(x?'  — '+x:'')));};

  const cards=await page.$$('.card');
  ok('renders every card', cards.length===71, `${cards.length} cards`);
  const btns=await page.$$eval('.card:first-child .choices button', bs=>bs.map(b=>b.textContent));
  ok('each card has the 5 decision buttons', btns.length===5, btns.join(' | '));

  // Seconds, not rounds, anywhere on the page.
  // The CARD text must be in seconds. (The page header deliberately explains what a "round"
  // used to be, so scope this to the grid.)
  const gridText=await page.$eval('#grid', b=>b.innerText);
  ok('no "round"/"turn" wording left on any card', !/\brounds?\b|\bturns?\b/i.test(gridText),
     (gridText.match(/[^\n]*\brounds?\b[^\n]*/i)||['none'])[0].slice(0,80));
  ok('shows second-based cadences', /usable every\s+\d+s|pays every\s+\d+s/.test(gridText));

  // Click a decision and check it registers + exports.
  const first=await page.$('.card');
  const name=await first.$eval('.nm', e=>e.textContent);
  await first.$eval('.choices button[data-c="2x"]', b=>b.click());
  const sel=await first.$eval('.choices button[data-c="2x"]', b=>b.className);
  ok('clicking a choice selects it', /sel/.test(sel), `class="${sel}"`);
  const json=JSON.parse(await page.$eval('#json', t=>t.value));
  ok('the decision lands in the export', json.cards.length===1 && json.cards[0].name===name && json.cards[0].decision==='2x',
     JSON.stringify(json.cards[0]||{}));
  ok('the export records the round length + current seconds', json.roundSeconds===10 && typeof json.cards[0].currentSeconds==='number',
     `roundSeconds=${json.roundSeconds} currentSeconds=${json.cards[0].currentSeconds}`);

  // Clicking the same choice again clears it.
  await first.$eval('.choices button[data-c="2x"]', b=>b.click());
  const cleared=JSON.parse(await page.$eval('#json', t=>t.value));
  ok('clicking the same choice again clears it', cleared.cards.length===0);

  // Filters + search narrow the grid.
  await first.$eval('.choices button[data-c="1x"]', b=>b.click());
  await page.click('.chip[data-f="done"]');
  const shownDone=await page.$$eval('.card:not(.hidden)', c=>c.length);
  ok('the "Decided" filter shows only decided cards', shownDone===1, `${shownDone} shown`);
  await page.click('.chip[data-f="cooldown"]');
  const shownCd=await page.$$eval('.card:not(.hidden)', c=>c.length);
  // DERIVED, NOT PINNED. This was `=== 21`, and the first card-text edit that moved a card off a
  // cooldown broke it with nothing wrong — Sinker Rhizomorph and Melanized Wall became "once per
  // level", so 21 became 19 and the check reported a regression it had invented. What has to hold
  // is that the filter shows the cooldown cards and only those; the COUNT is card data. The floor
  // is what stops "shows nothing" passing, which is the failure a bare equality was really for.
  // ROWS is the page's own data (a top-level const in a classic script, so a bare reference
  // resolves where `window.ROWS` would not) — the same list the filter itself reads.
  const wantCd=await page.evaluate(()=>ROWS.filter(r=>r.kind==='cooldown').length);
  ok('the "Cooldowns" filter narrows to cooldown cards',
     shownCd===wantCd && wantCd>=10, `${shownCd} shown of ${wantCd} cooldown cards`);
  await page.click('.chip[data-f="all"]');
  await page.fill('#q','aquaporin');
  const shownQ=await page.$$eval('.card:not(.hidden)', c=>c.length);
  ok('search filters by name', shownQ>=1 && shownQ<=3, `${shownQ} shown for "aquaporin"`);

  // Choices survive a reload (localStorage).
  await page.fill('#q','');
  await page.reload({waitUntil:'load'});
  const after=JSON.parse(await page.$eval('#json', t=>t.value));
  ok('decisions persist across a reload', after.cards.length===1 && after.cards[0].decision==='1x', JSON.stringify(after.cards[0]||{}));

  ok('no page errors', errs.length===0, errs.slice(0,2).join(' | '));
  await page.screenshot({path:path.join(__dirname, '.artifacts', 'card-review.png'), fullPage:false});
  console.log(`\n==== ${pass} passed, ${fail} failed ====`);
  await browser.close();srv.close();process.exit(fail?1:0);
})().catch(e=>{console.error('HARNESS ERROR',e);process.exit(2);});
