/* Verify in-game card text shows SECONDS, not rounds. */
const http=require('http'),fs=require('fs'),path=require('path');const {chromium}=require('playwright');
const ROOT = path.resolve(__dirname, '..');   // the repo root — served as-is
const T={'.html':'text/html','.js':'text/javascript','.json':'application/json','.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.svg':'image/svg+xml','.webp':'image/webp','.mp3':'audio/mpeg','.wav':'audio/wav','.css':'text/css'};
const sleep=(ms)=>new Promise(r=>setTimeout(r,ms));
(async()=>{
  const srv=await new Promise(res=>{const s=http.createServer((rq,rs)=>{let p=decodeURIComponent(rq.url.split('?')[0].split('#')[0]);if(p==='/')p='/index.html';const fp=path.join(ROOT,p);
    if(!fp.startsWith(ROOT)||!fs.existsSync(fp)||fs.statSync(fp).isDirectory()){rs.writeHead(404);rs.end('nf');return;}
    rs.writeHead(200,{'Content-Type':T[path.extname(fp)]||'application/octet-stream'});fs.createReadStream(fp).pipe(rs);});s.listen(0,()=>res(s));});
  const base='http://localhost:'+srv.address().port;
  const browser=await chromium.launch({headless:true});const page=await browser.newPage({viewport:{width:1280,height:800}});
  const errs=[];page.on('pageerror',e=>errs.push(String(e&&e.message)));
  await page.goto(base+'/index.html#dev',{waitUntil:'domcontentloaded'});
  await page.waitForSelector('#loadscreen.ld-ready',{timeout:15000}).catch(()=>{});
  await page.click('#loadscreen',{timeout:5000}).catch(()=>{});
  await page.waitForFunction(()=>window.__game&&window.__game.state&&window.__game.state.active,null,{timeout:15000});
  for(let i=0;i<3&&await page.$('#levelIntro');i++){await page.mouse.click(400,300);await sleep(2000);}
  let pass=0,fail=0;const ok=(n,c,x)=>{c?(pass++,console.log('  PASS  '+n+(x?'  — '+x:''))):(fail++,console.log('  FAIL  '+n+(x?'  — '+x:'')));};

  const r = await page.evaluate(async () => {
    const g=window.__game, st=g.state, C=st.cards, net=st.active;
    st.runOver=false; net.alive=true; net.energy=1e6; net.water=999; net.phosphorus=999;
    // Put timed cards in hand + install a timed action & engine so all three surfaces render.
    C.hand.length=0;
    for (const n of ['Aquaporin Channels','Constricting Ring','Sclerotial Crust','Rhizomorph Trunkline'])
      C.hand.push({id:C.seq++, name:n});
    C.engines=[{name:'Aquaporin Channels', water:1, every:6, _et:2}];
    C.actions=[{name:'Constricting Ring', effect:'Once per 6 rounds: tap a point where no nematode is within range; the first to enter is digested for +2 P.', every:6, cd:3, used:0, cost:3, res:'phosphorus'}];
    await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
    const faces=[...document.querySelectorAll('.handlist .crules')].map(e=>e.textContent);
    const titles=[...document.querySelectorAll('.handlist .cardbtn')].map(e=>e.title);
    const actEff=[...document.querySelectorAll('.actmenu .acteff, .actrow .acteff')].map(e=>e.textContent);
    const barTitles=[...document.querySelectorAll('.ecad.cad')].map(e=>e.getAttribute('title'));
    return {faces, titles, actEff, barTitles};
  });
  const all=[...r.faces, ...r.titles, ...r.actEff, ...r.barTitles].filter(Boolean);
  ok('card faces / tooltips rendered', all.length>0, `${all.length} strings`);
  const withRounds=all.filter(t=>/\brounds?\b|\bturns?\b/i.test(t));
  ok('no card text still says rounds/turns', withRounds.length===0, withRounds.slice(0,3).join(' || '));
  const withSecs=all.filter(t=>/\b\d+s\b|\d+ min\b/.test(t));
  ok('card text shows seconds', withSecs.length>0, withSecs.slice(0,3).map(s=>s.slice(0,70)).join(' || '));
  console.log('\n  samples:'); all.slice(0,6).forEach(t=>console.log('   ·', t.slice(0,96)));
  ok('no page errors', errs.length===0, errs.slice(0,2).join(' | '));
  console.log(`\n==== ${pass} passed, ${fail} failed ====`);
  await browser.close();srv.close();process.exit(fail?1:0);
})().catch(e=>{console.error('HARNESS ERROR',e);process.exit(2);});
