/* The roster tool (docs/species-tool.html) — does it actually edit anything?
 *
 *   node scripts/gen-species-tool.mjs && node tests/species-tool-check.cjs
 *
 * The tool is how the owner sets the opening three, the store prices and every starting hand, and
 * `scripts/apply-species.mjs` writes its export back into index.html. So the export is the contract,
 * and these assertions are all of the form "make an edit the way a mouse would, then read the export".
 *
 * The rules worth pinning, each of which the first version got wrong somewhere:
 *  - THREE starter slots and no more. Taking an occupied slot has to SWAP, not leave two colonies
 *    claiming slot 1 — `starterSpecies()` would then return the same colony twice.
 *  - A price belongs to a for-sale colony and nothing else, so the field is disabled otherwise.
 *  - Edits survive a reload (localStorage) and Revert really goes back to index.html's values.
 *
 * It runs against the GENERATED page, so re-run the generator first — a stale page passes this while
 * showing last week's roster, which is the one failure it cannot see.
 */
const http=require('http'),fs=require('fs'),path=require('path');
const {chromium}=require('playwright');
const ROOT='/home/user/myceliumRT';
// charset on the .html type deliberately: the page carries the game's own energy glyph, and a server
// that omits it renders the middots as mojibake — which is a real thing that happened here.
const T={'.html':'text/html; charset=utf-8','.js':'text/javascript','.json':'application/json','.png':'image/png','.webp':'image/webp'};
let pass=0,fail=0;
const ok=(n,c,x)=>{c?(pass++,console.log('  PASS  '+n+(x?'  — '+x:''))):(fail++,console.log('  FAIL  '+n+(x?'  — '+x:'')));};
(async()=>{
 const srv=await new Promise(r=>{const s=http.createServer((rq,rs)=>{let p=decodeURIComponent(rq.url.split('?')[0].split('#')[0]);if(p==='/')p='/index.html';const fp=path.join(ROOT,p);if(!fp.startsWith(ROOT)||!fs.existsSync(fp)||fs.statSync(fp).isDirectory()){rs.writeHead(404);rs.end('nf');return;}rs.writeHead(200,{'Content-Type':T[path.extname(fp)]||'application/octet-stream'});fs.createReadStream(fp).pipe(rs);});s.listen(0,()=>r(s));});
 const base='http://localhost:'+srv.address().port;
 const b=await chromium.launch({headless:true,executablePath:'/opt/pw-browsers/chromium'});
 const page=await b.newPage({viewport:{width:1240,height:900}});
 const errs=[]; page.on('pageerror',e=>errs.push(String(e&&e.message)));
 await page.goto(base+'/docs/species-tool.html',{waitUntil:'load'});
 await page.waitForSelector('.sp');

 // 1) taking an occupied starter slot SWAPS rather than making two
 const swap=await page.evaluate(()=>{
   const cards=[...document.querySelectorAll('.sp')];
   const before=cards.map(c=>[...c.querySelectorAll('.rb')].find(b=>b.getAttribute('aria-pressed')==='true').textContent);
   // ganoderma (3rd card) is Locked; give it Starter 1, which marasmius holds
   cards[2].querySelectorAll('.rb')[0].click();
   const after=[...document.querySelectorAll('.sp')].map(c=>[...c.querySelectorAll('.rb')].find(b=>b.getAttribute('aria-pressed')==='true').textContent);
   const chip=document.getElementById('cStart').textContent;
   const okChip=document.getElementById('cStart').className;
   return {before,after,chip,okChip,exp:JSON.parse(document.getElementById('out').value)};
 });
 ok('a locked colony can take a starter slot', swap.after[2]==='Starter 1', swap.before[2]+' -> '+swap.after[2]);
 ok('...and the colony that held it is displaced, not duplicated',
    swap.after.filter(t=>t==='Starter 1').length===1, swap.after.join(' | '));
 ok('...the roster is still exactly 3 slots', /^starters: 1\..*2\..*3\./.test(swap.chip) && /ok/.test(swap.okChip), swap.chip);
 ok('...and the export lists 3 starter ids in slot order',
    Array.isArray(swap.exp.STARTER_SPECIES_IDS) && swap.exp.STARTER_SPECIES_IDS.length===3,
    JSON.stringify(swap.exp.STARTER_SPECIES_IDS));

 // 2) Store enables the price; Locked disables it
 const price=await page.evaluate(()=>{
   const c=[...document.querySelectorAll('.sp')][5];   // schizophyllum, Locked
   const inp=c.querySelector('.price input');
   const wasDisabled=inp.disabled;
   c.querySelectorAll('.rb')[3].click();               // Store
   const now=[...document.querySelectorAll('.sp')][5];
   const inp2=now.querySelector('.price input');
   inp2.value='2750'; inp2.dispatchEvent(new Event('input',{bubbles:true}));
   const exp=JSON.parse(document.getElementById('out').value);
   return {wasDisabled, nowDisabled:inp2.disabled, cost:exp.STORE_SPECIES_COST, ids:exp.STORE_SPECIES_IDS};
 });
 ok('a locked colony has no price field to fill in', price.wasDisabled===true);
 ok('moving it to the Store enables the price', price.nowDisabled===false);
 ok('...and the price reaches the export', price.cost.schizophyllum===2750, JSON.stringify(price.cost));
 ok('...as does its place in the store list', price.ids.includes('schizophyllum'), price.ids.join(', '));

 // 3) hand editing: count, card swap, remove, add
 const hand=await page.evaluate(()=>{
   const c=document.querySelectorAll('.sp')[0];
   const q=c.querySelectorAll('.row input')[0];
   q.value='9'; q.dispatchEvent(new Event('input',{bubbles:true}));
   // READ THE EXPORT BEFORE THE ROW IS REMOVED — the first version edited row 0 and then deleted
   // row 0, so the count it was asserting had been thrown away by its own next step.
   const afterCount=JSON.parse(document.getElementById('out').value);
   const rows0=document.querySelectorAll('.sp')[0].querySelectorAll('.row').length;
   document.querySelectorAll('.sp')[0].querySelector('.row .x').click();
   const rows1=document.querySelectorAll('.sp')[0].querySelectorAll('.row').length;
   document.querySelectorAll('.sp')[0].querySelector('.hand .btn').click();   // + add a card
   const rows2=document.querySelectorAll('.sp')[0].querySelectorAll('.row').length;
   const exp=JSON.parse(document.getElementById('out').value);
   const id=Object.keys(exp.hands)[0];
   return {rows0,rows1,rows2,counted:afterCount.hands[Object.keys(afterCount.hands)[0]],first:exp.hands[id],label:document.querySelectorAll('.sp')[0].querySelector('.hlab .tot').textContent};
 });
 ok('a count edit reaches the export', hand.counted.some(h=>h.count===9), JSON.stringify(hand.counted.slice(0,2)));
 ok('removing a card removes a row', hand.rows1===hand.rows0-1, hand.rows0+' -> '+hand.rows1);
 ok('adding a card adds one back', hand.rows2===hand.rows1+1, hand.rows1+' -> '+hand.rows2);
 ok('the row counter follows', /cards, \d+ copies/.test(hand.label), hand.label);

 // 4) it survives a reload (localStorage), and Revert throws it away
 await page.reload({waitUntil:'load'});
 await page.waitForSelector('.sp');
 const kept=await page.evaluate(()=>JSON.parse(document.getElementById('out').value));
 ok('edits survive a reload', kept.STORE_SPECIES_COST.schizophyllum===2750, JSON.stringify(kept.STORE_SPECIES_IDS));
 await page.evaluate(()=>{ window.confirm=()=>true; document.getElementById('bReset').click(); });
 const rev=await page.evaluate(()=>JSON.parse(document.getElementById('out').value));
 ok('Revert goes back to the game’s own values',
    JSON.stringify(rev.STARTER_SPECIES_IDS)===JSON.stringify(['marasmius','armillaria','pleurotus'])
    && !rev.STORE_SPECIES_IDS.includes('schizophyllum'), rev.STARTER_SPECIES_IDS.join(', '));

 ok('no page errors throughout', errs.length===0, errs.slice(0,2).join(' | ')||'none');
 await b.close(); srv.close();
 console.log(`\n==== ${pass} passed, ${fail} failed ====`);   // the runner parses THIS form
 process.exit(fail?1:0);
})();
