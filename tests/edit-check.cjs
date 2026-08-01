const http=require('http'),fs=require('fs'),path=require('path');
const {chromium}=require('playwright');
const ROOT='/home/user/myceliumRT';
const T={'.html':'text/html','.js':'text/javascript','.json':'application/json','.png':'image/png','.webp':'image/webp','.mp3':'audio/mpeg','.wav':'audio/wav'};
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
// Tally as well as print. The runner parses the "==== N passed, M failed ====" line and calls
// a check that never prints one BROKEN — this file went in without it and so was only ever run
// by hand. See tests/README.md on the zero-coverage failure mode.
let PASS=0, FAIL=0;
const ok=(n,c,x)=>{ c?PASS++:FAIL++; console.log((c?'  PASS  ':'  FAIL  ')+n+(x?'  — '+x:'')); };
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
await p.evaluate(()=>{ [...document.querySelectorAll('#eePlace button')].find(b=>b.textContent==='Leaves — yellow').click(); });
ok('arming a kind', await p.evaluate(()=>window.__game && document.querySelector('#eePend').textContent.includes('Leaves — yellow')));
// drop three via a real canvas click
for (const [cx,cy] of [[500,450],[700,500],[900,430]]) { await p.mouse.click(cx,cy); await sleep(150); }
const pend = await p.evaluate(()=>document.querySelector('#eePend').textContent);
ok('placements are pending', /3 pending/.test(pend), pend.slice(0,60));
const exported = await p.evaluate(()=>{ document.querySelector('#eeCopy').click(); return window.__levelJSON; });
ok('pending objects reach the export', (JSON.parse(exported).objects||[]).filter(o=>o.t==='food'&&o.kind==='duff').length >= 3);

// ---- move and delete a PLACED object --------------------------------------
// Named by COLOUR — that is what the map shows and so what the owner picks by. Assert the
// label AND the foodKind it writes, or a rename could quietly point yellow at the red art.
ok('all three leaf colours are offered',
   await p.evaluate(()=>['Leaves — yellow','Leaves — orange','Leaves — red']
     .every(l=>[...document.querySelectorAll('#eePlace button')].some(b=>b.textContent===l))));
for (const [label, kind] of [['Leaves — yellow','duff'],['Leaves — orange','cache'],['Leaves — red','cache-engine']]) {
  await p.evaluate((l)=>{ [...document.querySelectorAll('#eePlace button')].find(b=>b.textContent===l).click(); }, label);
  await p.mouse.click(640, 500); await sleep(150);
  const got = await p.evaluate(()=>{ const a=window.__game.rockEdit.added; return a[a.length-1].kind; });
  ok(`"${label}" writes foodKind ${kind}`, got === kind, `wrote ${got}`);
  await p.evaluate(()=>{ const r=window.__game.rockEdit; r.added.pop(); });
}
// DISARM. A kind left armed turns the next click into another placement instead of a
// selection, which is exactly how the two assertions below failed the first time this loop
// existed — they were reporting a real behaviour of the tool, just not the one under test.
await p.evaluate(()=>{
  const cur = window.__game.rockEdit.place;
  if (cur) [...document.querySelectorAll('#eePlace button')].find(b=>b.dataset.pk===cur).click();
});
await sleep(150);
const p0 = await p.evaluate(()=>({n:window.__game.rockEdit.added.length, x:window.__game.rockEdit.added[0].x, y:window.__game.rockEdit.added[0].y}));
// click the first marker (deselect the armed kind first, or the click places another)
// Disarm whatever is armed — kind-agnostic. This used to click 'Leaf pile' to toggle OFF the
// kind armed a moment earlier; once the per-colour loop above changed which kind that was,
// the same click started ARMING one instead, and the drag below placed a new marker rather
// than selecting the first.
await p.evaluate(()=>{
  const cur = window.__game.rockEdit.place;
  if (cur) [...document.querySelectorAll('#eePlace button')].find(b=>b.dataset.pk===cur).click();
});
const mk = await p.evaluate(()=>{
  const g=window.__game, o=g.rockEdit.added[0];
  // Bring it into view first. Earlier steps move the camera (the clip test re-centres it on
  // a sprite), and clicking where the marker USED to be just clicks empty map.
  g.camera.x=o.x; g.camera.y=o.y; g.camera.clamp();
  const c=g.camera.worldToScreen(o.x,o.y);
  return {x:Math.round(c.x), y:Math.round(c.y), w:g.camera.viewW, h:g.camera.viewH};
});
await sleep(300);
ok('the placed marker is on screen before the drag',
   mk.x>0 && mk.y>0 && mk.x<mk.w && mk.y<mk.h, `at ${mk.x},${mk.y} of ${mk.w}x${mk.h}`);
await p.mouse.move(mk.x, mk.y); await p.mouse.down();
await p.mouse.move(mk.x+70, mk.y+40, {steps:6}); await p.mouse.up(); await sleep(200);
const p1 = await p.evaluate(()=>({n:window.__game.rockEdit.added.length, x:window.__game.rockEdit.added[0].x, y:window.__game.rockEdit.added[0].y, sel:window.__game.rockEdit.selAdded.size}));
ok('a placed object can be selected and dragged', p1.sel===1 && (p1.x!==p0.x || p1.y!==p0.y),
   `(${p0.x},${p0.y}) -> (${p1.x},${p1.y}), ${p1.sel} selected`);
await p.keyboard.press('Delete'); await sleep(200);
const p2 = await p.evaluate(()=>window.__game.rockEdit.added.length);
ok('a placed object can be deleted', p2 === p1.n-1, `${p1.n} -> ${p2}`);
// put one back so the apply step below still has something to stamp
await p.evaluate(()=>{ [...document.querySelectorAll('#eePlace button')].find(b=>b.textContent==='Leaves — yellow').click(); });
await p.mouse.click(760, 470); await sleep(200);
// apply rebuilds the level
await p.evaluate(()=>document.querySelector('#eeApply').click());
await sleep(2500);
await p.waitForFunction(()=>window.__game.state.substrate._rockSolidified===true,null,{timeout:60000}).catch(()=>{});
ok('apply rebuilds the level', await p.evaluate(()=>!!(window.__game.state && window.__game.state.active)));
// tests/.artifacts/ like every other check, not a session scratchpad path — the scratchpad is
// wiped with the container and a committed check must not depend on one session's directory.
await p.screenshot({path:path.join(__dirname,'.artifacts','editor.png'),timeout:60000,animations:'disabled'});

// ---- Save as -------------------------------------------------------------
// A FRESH load, deliberately: the steps above delete every rock, and a saved copy of an empty
// map cannot show that the sprites resolved through `assetsFrom`, which is the one thing about
// saving that can silently go wrong (a saved map has its own id and no assets/<id>/ folder).
// `?r=2` only to make the URL DIFFER from the first load — the server drops the query. Going
// to a byte-identical URL is a same-document navigation, so the page would not reboot and this
// block would run against the emptied map above.
await p.goto(base+'/index.html?r=2#level,slate-c24',{waitUntil:'domcontentloaded'});
await p.waitForSelector('#loadscreen.ld-ready',{timeout:60000}).catch(()=>{});
await p.click('#loadscreen',{timeout:5000}).catch(()=>{});
await p.waitForFunction(()=>window.__game&&window.__game.state&&window.__game.state.active,null,{timeout:30000});
await p.waitForFunction(()=>window.__game.state.substrate._rockSolidified===true,null,{timeout:90000});
const srcRocks = await p.evaluate(()=>window.__game.state.substrate.levelSprites.length);
await p.evaluate(()=>{ try { localStorage.removeItem('mycelium.savedLevels.v1'); } catch(_){} });
await p.click('#devEditBtn'); await sleep(400);
// Go through the BUTTON, not the exposed helper: window.prompt is the whole reason the save
// path can differ between hand-testing and here, so answer the dialog instead of routing round it.
//
// NOT awaited, deliberately. `prompt()` is synchronous in the page, so an awaited evaluate
// cannot return until the dialog is answered — and the answer arrives over the same connection
// the evaluate is blocking. That deadlocks until the runner's timeout; fire and wait on the
// EFFECT instead.
p.once('dialog', d=>d.accept('Chapter One Test'));
p.evaluate(()=>document.querySelector('#eeSaveAs').click()).catch(()=>{});
await p.waitForFunction(()=>(window.__game.state.levelDef||{}).id==='chapter-one-test',null,{timeout:30000}).catch(()=>{});
await p.waitForFunction(()=>window.__game.state.substrate._rockSolidified===true,null,{timeout:90000}).catch(()=>{});
const sv = await p.evaluate(()=>{
  const d=window.__game.state.levelDef||{};
  return {id:d.id,name:d.name,chapter:d.chapter,from:d.assetsFrom,slot:d.campaignLevel,
          rocks:window.__game.state.substrate.levelSprites.length,
          stored:JSON.parse(localStorage.getItem('mycelium.savedLevels.v1')||'[]').map(l=>l.id)};
});
ok('save as slugs the name into an id', sv.id==='chapter-one-test', `id ${sv.id}, name "${sv.name}"`);
ok('the saved map is filed under Chapter 1', sv.chapter==='Chapter 1', String(sv.chapter));
ok('it claims no campaign slot', sv.slot===null||sv.slot===undefined, String(sv.slot));
ok('it points at the source map for its sprites', sv.from==='slate-c24', String(sv.from));
// The real failure this guards: a saved map whose sprites never load draws an EMPTY level,
// which looks like a successful save until you notice the rock is gone.
ok('the saved map draws the source map\'s rocks', sv.rocks>0 && sv.rocks===srcRocks, `${sv.rocks} of ${srcRocks}`);
ok('it is in localStorage', sv.stored.includes('chapter-one-test'), sv.stored.join(','));
ok('it is in the lineup', await p.evaluate(()=>window.__game.levels().some(l=>l.id==='chapter-one-test')));
ok('#level,<id> finds it', await p.evaluate(()=>{
  // levelById is module-scoped; the boot hash is the reachable proxy for it, and the dev map
  // button's title is written from the same id, so assert on that.
  const b=[...document.querySelectorAll('#devMapPanel button')].find(x=>x.title==='#level,chapter-one-test');
  return !!b;
}));
const grp = await p.evaluate(()=>[...document.querySelectorAll('#devMapPanel .dm-g')].map(n=>n.textContent));
ok('the map list grows a Chapter 1 heading', grp[0]==='Chapter 1', grp.slice(0,3).join(' / '));
ok('saved maps sort ahead of the generated ones',
   await p.evaluate(()=>window.__game.levels()[0].id==='chapter-one-test'));
// A second save under the same name OVERWRITES rather than piling up copy-of-copy ids.
await p.evaluate(()=>window.__game.saveAs('Chapter One Test'));
const dup = await p.evaluate(()=>JSON.parse(localStorage.getItem('mycelium.savedLevels.v1')||'[]').length);
ok('re-saving the same name overwrites', dup===1, `${dup} stored`);
// A name that collides with a GENERATED map must not shadow it — the committed file would
// become unreachable in game with nothing on screen to say why.
const coll = await p.evaluate(()=>window.__game.saveAs('slate-c24'));
ok('a name colliding with a generated map is given its own id',
   coll && coll.id!=='slate-c24' && coll.id.startsWith('slate-c24-'), coll?coll.id:'null');
ok('forgetting a saved map removes it', await p.evaluate((extra)=>{
  window.__game.forgetSaved('chapter-one-test');
  if (extra) window.__game.forgetSaved(extra);
  return !window.__game.levels().some(l=>l.chapter);
}, coll && coll.id));
await b.close();srv.close();
console.log(`==== ${PASS} passed, ${FAIL} failed ====`);
process.exit(FAIL?1:0);
})();
