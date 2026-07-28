/* Every boot destination comes up clean in BOTH modes. */
const http=require('http'),fs=require('fs'),path=require('path');const {chromium}=require('playwright');
const ROOT = path.resolve(__dirname, '..');   // the repo root — served as-is
const T={'.html':'text/html','.js':'text/javascript','.json':'application/json','.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.svg':'image/svg+xml','.webp':'image/webp','.mp3':'audio/mpeg','.wav':'audio/wav'};
const sleep=(ms)=>new Promise(r=>setTimeout(r,ms));
let pass=0,fail=0;
const ok=(n,c,x)=>{c?(pass++,console.log('  PASS  '+n+(x?'  — '+x:''))):(fail++,console.log('  FAIL  '+n+(x?'  — '+x:'')));};
(async()=>{
  const srv=await new Promise(res=>{const s=http.createServer((rq,rs)=>{let p=decodeURIComponent(rq.url.split('?')[0].split('#')[0]);if(p==='/')p='/index.html';const fp=path.join(ROOT,p);if(!fp.startsWith(ROOT)||!fs.existsSync(fp)||fs.statSync(fp).isDirectory()){rs.writeHead(404);rs.end('nf');return;}rs.writeHead(200,{'Content-Type':T[path.extname(fp)]||'application/octet-stream'});fs.createReadStream(fp).pipe(rs);});s.listen(0,()=>res(s));});
  const base='http://localhost:'+srv.address().port;
  const browser=await chromium.launch({headless:true});
  for(const hash of ['#dev','#dev,turn','#puzzle','#puzzle,turn','#notrich','#notrich,turn','#tutorial','#tutorial,turn']){
    const page=await browser.newPage({viewport:{width:1280,height:800}});
    const errs=[];page.on('pageerror',e=>errs.push(String(e&&e.message)));
    page.on('console',m=>{if(m.type()==='error')errs.push('console:'+m.text());});
    await page.goto(base+'/index.html'+hash,{waitUntil:'domcontentloaded'});
    await page.waitForSelector('#loadscreen.ld-ready',{timeout:20000}).catch(()=>{});
    await page.click('#loadscreen',{timeout:5000}).catch(()=>{});
    await sleep(4000);
    const st=await page.evaluate(()=>({
      mode:window.__cfg?window.__cfg.mode:null,
      rt:window.__cfg?window.__cfg.realtime.enabled:null,
      booted:!!(window.__game&&window.__game.state&&window.__game.state.active),
      picker:!!document.getElementById('speciesSelect'),
    }));
    const wantTurn=hash.includes(',turn');
    ok(`${hash} boots clean`,(st.booted||st.picker)&&errs.length===0,
       `mode=${st.mode} booted=${st.booted} picker=${st.picker} errs=${errs.slice(0,2).join(' | ')||'none'}`);
    ok(`${hash} runs in the right mode`, wantTurn ? (st.mode==='turn'&&st.rt===false) : (st.mode==='realtime'&&st.rt===true), `mode=${st.mode} rt=${st.rt}`);
    await page.close();
  }
  console.log(`\n==== ${pass} passed, ${fail} failed ====`);
  await browser.close();srv.close();process.exit(fail?1:0);
})().catch(e=>{console.error('HARNESS ERROR',e);process.exit(2);});
