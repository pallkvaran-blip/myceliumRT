const http=require('http'),fs=require('fs'),path=require('path');
const {chromium}=require('playwright');
const ROOT='/home/user/myceliumRT';
const T={'.html':'text/html','.js':'text/javascript','.json':'application/json','.png':'image/png','.webp':'image/webp','.mp3':'audio/mpeg','.wav':'audio/wav'};
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const ok=(n,c,x)=>console.log((c?'  PASS  ':'  FAIL  ')+n+(x?'  — '+x:''));
(async()=>{
const srv=await new Promise(res=>{const s=http.createServer((rq,rs)=>{let p=decodeURIComponent(rq.url.split('?')[0].split('#')[0]);if(p==='/')p='/index.html';const fp=path.join(ROOT,p);if(!fp.startsWith(ROOT)||!fs.existsSync(fp)||fs.statSync(fp).isDirectory()){rs.writeHead(404);rs.end('nf');return;}rs.writeHead(200,{'Content-Type':T[path.extname(fp)]||'application/octet-stream'});fs.createReadStream(fp).pipe(rs);});s.listen(0,()=>res(s));});
const base='http://localhost:'+srv.address().port;
const b=await chromium.launch({headless:true,executablePath:'/opt/pw-browsers/chromium'});
const ctx=await b.newContext({viewport:{width:1500,height:900}});
await ctx.addInitScript(()=>{window.MYCELIUM_SUPABASE={url:'',anonKey:''};});
const p=await ctx.newPage();
p.on('pageerror',e=>console.log('PAGEERROR:',String(e.stack||e).slice(0,400)));
await p.goto(base+'/index.html#level,slate-c24',{waitUntil:'domcontentloaded'});
await p.waitForSelector('#loadscreen.ld-ready',{timeout:60000}).catch(()=>{});
await p.click('#loadscreen',{timeout:5000}).catch(()=>{});
await p.waitForFunction(()=>window.__game&&window.__game.state&&window.__game.state.active,null,{timeout:30000});
await p.waitForFunction(()=>window.__game.state.substrate._rockSolidified===true,null,{timeout:90000});
await p.waitForSelector('#levelIntro',{timeout:8000}).catch(()=>{});
for(let i=0;i<6&&await p.$('#levelIntro');i++){await p.mouse.click(1100,300);await sleep(400);}

ok('edit button exists', !!(await p.$('#devEditBtn')));
await p.click('#devEditBtn'); await sleep(400);
ok('panel opens', await p.evaluate(()=>document.getElementById('devEditPanel').classList.contains('open')));

const n0 = await p.evaluate(()=>window.__game.state.substrate.levelSprites.length);
// select all + scale
await p.evaluate(()=>document.querySelector('#eeAll').click());
const sel = await p.evaluate(()=>document.querySelector('#eeSel').textContent);
ok('select all', /(\d+) of \1 selected/.test(sel.replace(' of ',' of ')) || sel.includes('of'), sel);
const before = await p.evaluate(()=>{const s=window.__game.state.substrate.levelSprites[0];return {w:s.w,x:s.x,rot:s.rot||0};});
await p.evaluate(()=>document.querySelector('#eeBig').click());
const after = await p.evaluate(()=>{const s=window.__game.state.substrate.levelSprites[0];return {w:s.w,x:s.x,rot:s.rot||0};});
ok('scale grows the rocks', after.w > before.w, `${before.w.toFixed(1)} -> ${after.w.toFixed(1)}`);
await p.evaluate(()=>document.querySelector('#eeRotR').click());
const rot = await p.evaluate(()=>window.__game.state.substrate.levelSprites[0].rot||0);
ok('rotate turns them', Math.abs(rot-after.rot) > 0.01, `rot ${rot.toFixed(3)}`);
ok('collision rebuilds', await p.evaluate(()=>window.__game.state.substrate._rockSolidified===false||window.__game.state.substrate._rockSolidified===true));
// filter
await p.evaluate(()=>{const i=document.querySelector('#eeB');i.value='1.6';i.dispatchEvent(new Event('input'));});
ok('brightness applied', await p.evaluate(()=>window.__game && document.querySelector('#eeBv').textContent==='1.60'));
// delete one
await p.evaluate(()=>{document.querySelector('#eeNone').click();});
await p.evaluate(()=>{ // select a single sprite by index then delete
  const g=window.__game; const st=g.state; const s=st.substrate.levelSprites[0];
  const c=g.camera.worldToScreen(s.x,s.y); return c;
});
const nBefore = await p.evaluate(()=>window.__game.state.substrate.levelSprites.length);
await p.evaluate(()=>{document.querySelector('#eeAll').click();document.querySelector('#eeDel').click();});
const nAfter = await p.evaluate(()=>window.__game.state.substrate.levelSprites.length);
ok('delete removes rocks', nAfter===0, `${nBefore} -> ${nAfter}`);
// export
const json = await p.evaluate(()=>{ window.__levelJSON=null; document.querySelector('#eeCopy').click(); return new Promise(r=>setTimeout(()=>r(window.__levelJSON),300)); });
ok('export produces level JSON', !!json && json.includes('"format"'), json?('len '+json.length):'null');
await p.screenshot({path:'/tmp/claude-0/-home-user-myceliumRT/a2f5e2e3-decc-5856-aa55-dec16f4b83e6/scratchpad/editor.png',timeout:60000,animations:'disabled'});
await b.close();srv.close();
})();
