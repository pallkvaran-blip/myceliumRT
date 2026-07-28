/* Focused check: HUD refreshes must not re-create the hovered card / pill rows. */
const http=require('http'),fs=require('fs'),path=require('path');const {chromium}=require('playwright');
const ROOT = path.resolve(__dirname, '..');   // the repo root — served as-is
const T={'.html':'text/html','.js':'text/javascript','.json':'application/json','.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.svg':'image/svg+xml','.webp':'image/webp','.mp3':'audio/mpeg','.wav':'audio/wav','.css':'text/css'};
const sleep=(ms)=>new Promise(r=>setTimeout(r,ms));
(async()=>{
  const srv=await new Promise(res=>{const s=http.createServer((rq,rs)=>{let p=decodeURIComponent(rq.url.split('?')[0].split('#')[0]);if(p==='/')p='/index.html';const fp=path.join(ROOT,p);
    if(!fp.startsWith(ROOT)||!fs.existsSync(fp)||fs.statSync(fp).isDirectory()){rs.writeHead(404);rs.end('nf');return;}
    rs.writeHead(200,{'Content-Type':T[path.extname(fp)]||'application/octet-stream'});fs.createReadStream(fp).pipe(rs);});s.listen(0,()=>res(s));});
  const base='http://localhost:'+srv.address().port;
  const browser=await chromium.launch({headless:true});const page=await browser.newPage();
  await page.goto(base+'/index.html#dev',{waitUntil:'domcontentloaded'});
  await page.waitForSelector('#loadscreen.ld-ready',{timeout:15000}).catch(()=>{});
  await page.click('#loadscreen',{timeout:5000}).catch(()=>{});
  await page.waitForFunction(()=>window.__game&&window.__game.state&&window.__game.state.active,null,{timeout:15000});
  for(let i=0;i<3&&await page.$('#levelIntro');i++){await page.mouse.click(400,300);await sleep(2000);}
  let pass=0,fail=0;const ok=(n,c,x)=>{c?(pass++,console.log('  PASS  '+n+(x?'  — '+x:''))):(fail++,console.log('  FAIL  '+n+(x?'  — '+x:'')));};
  const res=await page.evaluate(async()=>{
    const g=window.__game,st=g.state,net=st.active;
    st.runOver=false;st.winPending=false;st.won=false;net.alive=true;
    net.energy=1e6;net.water=999;net.phosphorus=999;st.clouds=[];st.nematodes=[];st.cards.pendingOffers.length=0;
    st.cards.hand.length=0;st.cards.hand.push({id:st.cards.seq++,name:'Apical Drive'});
    // an installed engine so the ledger pill has a row with a cadence bar
    st.cards.engines=[{name:'Aquifer Tap',water:2,every:6,_et:1}];
    const raf2=()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
    await raf2();
    const list=document.querySelector('.handlist');
    const card=list&&list.firstElementChild;
    const bar=document.querySelector('.engledger .cbar[data-cadkey]');
    const fill=bar&&bar.firstElementChild;
    if(!card)return{noCard:true};
    const t0=st.turn;let refreshed=0;
    for(let i=0;i<5;i++){st.runOver=false;st.winPending=false;net.alive=true;g.tickWorld(st);await raf2();refreshed++;}
    return{refreshed,ticks:st.turn-t0,
      cardSame:document.contains(card)&&document.querySelector('.handlist').firstElementChild===card,
      barSame:!!fill&&document.contains(fill),
      fillPct:fill?fill.style.width:'n/a'};
  });
  ok('the world actually advanced during the probe',!res.noCard&&res.ticks>=4,`${res.ticks} ticks over ${res.refreshed} HUD refreshes`);
  ok('the hovered card element is NOT re-created by HUD refreshes',!res.noCard&&res.cardSame,`same element: ${res.cardSame}`);
  ok('the ledger cadence bar element is NOT re-created either',!res.noCard&&res.barSame,`same element: ${res.barSame}, fill ${res.fillPct}`);
  console.log(`\n==== ${pass} passed, ${fail} failed ====`);
  await browser.close();srv.close();process.exit(fail?1:0);
})().catch(e=>{console.error('HARNESS ERROR',e);process.exit(2);});
