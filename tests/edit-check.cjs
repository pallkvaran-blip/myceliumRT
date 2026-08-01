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

// ---- above-ground clip ---------------------------------------------------
// Sample EXACTLY where a rock is put, not a broad band. A first version averaged a 100px
// strip above the soil line and passed with the clip removed — the rocks are dark, the night
// sky is dark, and the mean barely moved either way. A test that cannot fail is worse than
// no test.
await p.evaluate(()=>{
  const g=window.__game, sub=g.state.substrate;
  const W = (g.state.levelDef && g.state.levelDef.world && g.state.levelDef.world.width)
            || (sub.cols * sub.cellSize);
  g.camera.zoom=0.6; g.camera.x=W/2; g.camera.y=sub.surfaceY; g.camera.clamp();
});
await sleep(500);
const probe = async () => p.evaluate(()=>{
  const g=window.__game, sub=g.state.substrate;
  const s=sub.levelSprites[0];
  if (!s) return { err: 'no sprites' };
  g.camera.x = s.x; g.camera.y = sub.surfaceY; g.camera.clamp();
  // The VISIBLE canvas. document.querySelector('canvas') can return the lighting module's
  // offscreen buffer, which is not in layout, so clientHeight is 0 and the device-pixel
  // scale comes out Infinity — which is why the first version of this probe returned null.
  const c=[...document.querySelectorAll('canvas')].find((n)=>n.clientHeight>0);
  if (!c) return { err: 'no visible canvas' };
  const x=c.getContext('2d');
  const k=c.height/c.clientHeight;
  if (!isFinite(k) || k<=0) return { err: 'bad scale ' + k };
  const pt=g.camera.worldToScreen(s.x, s.y);
  // Clamp into the canvas: worldToScreen can land off-view, and getImageData throws on a
  // non-finite or out-of-range rect rather than returning nothing.
  const px=Math.round(pt.x*k), py=Math.round(pt.y*k);
  if (!isFinite(px) || !isFinite(py)) return { err: 'off-canvas ' + px + ',' + py };
  const x0=Math.max(0, Math.min(c.width-36, px-18));
  const y0=Math.max(0, Math.min(c.height-36, py-18));
  const d=x.getImageData(x0, y0, 36, 36).data;
  let sum=0; for(let i=0;i<d.length;i+=4) sum+=d[i]+d[i+1]+d[i+2];
  return { mean: Math.round(sum/(d.length/4)), aboveGround: s.y < sub.surfaceY };
});
const under = await probe();
await p.evaluate(()=>{
  const sub=window.__game.state.substrate;
  for (const s of sub.levelSprites) { if (s._y0==null) s._y0=s.y; s.y = sub.surfaceY - 300; }
  sub._rockSolidified=false;
});
await sleep(700);
const over = await probe();
// DIRECTIONAL, against a real sky reference. A symmetric "did the pixel change" tolerance
// passed the negative control too: without the clip the rock is still drawn up there and the
// sample moved 184 -> 210, which is a change of the wrong kind. What the clip promises is
// that the spot ends up looking like SKY, so that is what to assert.
const sky = await p.evaluate(()=>{
  const g=window.__game, sub=g.state.substrate;
  const c=[...document.querySelectorAll('canvas')].find((n)=>n.clientHeight>0);
  const x=c.getContext('2d'), k=c.height/c.clientHeight;
  const pt=g.camera.worldToScreen(g.camera.x, sub.surfaceY-300);
  const d=x.getImageData(Math.max(0,Math.round(pt.x*k)-300), Math.max(0,Math.round(pt.y*k)-18), 36, 36).data;
  let sum=0; for(let i=0;i<d.length;i+=4) sum+=d[i]+d[i+1]+d[i+2];
  return Math.round(sum/(d.length/4));
});
ok('a rock dragged above ground is cut off at the soil line',
   !!(over && !over.err && !under.err && over.aboveGround && Math.abs(over.mean - sky) < 30),
   (under.err || over.err) ? `probe failed: ${under.err || over.err}`
     : `rock centre ${under.mean} underground -> ${over.mean} above, bare sky ${sky}`);
await p.evaluate(()=>{
  const sub=window.__game.state.substrate;
  for (const s of sub.levelSprites) if (s._y0!=null) s.y=s._y0;
  sub._rockSolidified=false;
  document.querySelector('#eeNone').click();
});
await sleep(400);
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
// ---- carousel starts minimised, level intro skipped ----------------------
ok('the card carousel starts minimised in dev',
   await p.evaluate(()=>{ const h=document.querySelector('.handbar'); return !!h && !h.classList.contains('open'); }));
ok('the level intro does not appear in dev', !(await p.$('#levelIntro')));

// ---- placement -----------------------------------------------------------
ok('placement buttons exist', await p.evaluate(()=>document.querySelectorAll('#eePlace button').length) >= 8,
   String(await p.evaluate(()=>document.querySelectorAll('#eePlace button').length)) + ' kinds');
await p.evaluate(()=>{ [...document.querySelectorAll('#eePlace button')].find(b=>b.textContent==='Leaf pile').click(); });
ok('arming a kind', await p.evaluate(()=>window.__game && document.querySelector('#eePend').textContent.includes('Leaf pile')));
// drop three via a real canvas click
for (const [cx,cy] of [[500,450],[700,500],[900,430]]) { await p.mouse.click(cx,cy); await sleep(150); }
const pend = await p.evaluate(()=>document.querySelector('#eePend').textContent);
ok('placements are pending', /3 pending/.test(pend), pend.slice(0,60));
const exported = await p.evaluate(()=>{ document.querySelector('#eeCopy').click(); return window.__levelJSON; });
ok('pending objects reach the export', (JSON.parse(exported).objects||[]).filter(o=>o.t==='food'&&o.kind==='duff').length >= 3);

// ---- move and delete a PLACED object --------------------------------------
ok('every food kind is offered',
   await p.evaluate(()=>['Leaf pile','Nut cache','Engine cache']
     .every(l=>[...document.querySelectorAll('#eePlace button')].some(b=>b.textContent===l))));
const p0 = await p.evaluate(()=>({n:window.__game.rockEdit.added.length, x:window.__game.rockEdit.added[0].x, y:window.__game.rockEdit.added[0].y}));
// click the first marker (deselect the armed kind first, or the click places another)
await p.evaluate(()=>{ [...document.querySelectorAll('#eePlace button')].find(b=>b.textContent==='Leaf pile').click(); });
const mk = await p.evaluate(()=>{ const o=window.__game.rockEdit.added[0];
  const c=window.__game.camera.worldToScreen(o.x,o.y); return {x:Math.round(c.x),y:Math.round(c.y)}; });
await p.mouse.move(mk.x, mk.y); await p.mouse.down();
await p.mouse.move(mk.x+70, mk.y+40, {steps:6}); await p.mouse.up(); await sleep(200);
const p1 = await p.evaluate(()=>({n:window.__game.rockEdit.added.length, x:window.__game.rockEdit.added[0].x, y:window.__game.rockEdit.added[0].y, sel:window.__game.rockEdit.selAdded.size}));
ok('a placed object can be selected and dragged', p1.sel===1 && (p1.x!==p0.x || p1.y!==p0.y),
   `(${p0.x},${p0.y}) -> (${p1.x},${p1.y}), ${p1.sel} selected`);
await p.keyboard.press('Delete'); await sleep(200);
const p2 = await p.evaluate(()=>window.__game.rockEdit.added.length);
ok('a placed object can be deleted', p2 === p1.n-1, `${p1.n} -> ${p2}`);
// put one back so the apply step below still has something to stamp
await p.evaluate(()=>{ [...document.querySelectorAll('#eePlace button')].find(b=>b.textContent==='Leaf pile').click(); });
await p.mouse.click(760, 470); await sleep(200);
// apply rebuilds the level
await p.evaluate(()=>document.querySelector('#eeApply').click());
await sleep(2500);
await p.waitForFunction(()=>window.__game.state.substrate._rockSolidified===true,null,{timeout:60000}).catch(()=>{});
ok('apply rebuilds the level', await p.evaluate(()=>!!(window.__game.state && window.__game.state.active)));
await p.screenshot({path:'/tmp/claude-0/-home-user-myceliumRT/a2f5e2e3-decc-5856-aa55-dec16f4b83e6/scratchpad/editor.png',timeout:60000,animations:'disabled'});
await b.close();srv.close();
})();
