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

// ---- draw order (Up / Down) ----------------------------------------------
// levelSprites is drawn in array order, so later = on top. Assert on the sprite's POSITION IN
// THE LIST, and that the selection follows it — the selection is a set of indices, so a
// reorder that forgets to remap it silently starts addressing a different rock.
await p.evaluate(()=>document.querySelector('#eeNone').click());
const zBase = await p.evaluate(()=>{
  const sp=window.__game.state.substrate.levelSprites;
  window.__game.rockEdit.sel = new Set([2]);          // a rock in the middle of the list
  return {key:sp[2].key, n:sp.length};
});
await p.evaluate(()=>document.querySelector('#eeUp').click());
const zUp2 = await p.evaluate((k)=>{
  const sp=window.__game.state.substrate.levelSprites, r=window.__game.rockEdit;
  return {idx:sp.findIndex(s=>s.key===k), sel:[...r.sel]};
}, zBase.key);
ok('Up moves a rock one step later in the draw order',
   zUp2.idx===3 && zUp2.sel.length===1 && zUp2.sel[0]===3, JSON.stringify(zUp2));
await p.evaluate(()=>{document.querySelector('#eeDown').click();document.querySelector('#eeDown').click();});
const zDn = await p.evaluate((k)=>{
  const sp=window.__game.state.substrate.levelSprites, r=window.__game.rockEdit;
  return {idx:sp.findIndex(s=>s.key===k), sel:[...r.sel]};
}, zBase.key);
ok('Down moves it back again', zDn.idx===1 && zDn.sel[0]===1, JSON.stringify(zDn));
// A rock at the very back cannot go further back, and must not fall off the list.
await p.evaluate(()=>{ window.__game.rockEdit.sel=new Set([0]);
  document.querySelector('#eeDown').click(); });
ok('the bottom rock stays put and nothing is lost',
   await p.evaluate((n)=>window.__game.state.substrate.levelSprites.length===n
     && [...window.__game.rockEdit.sel][0]===0, zBase.n));
// A multi-rock selection lifts as a BLOCK — selected rocks never swap with each other, or a
// group would shuffle internally instead of moving.
const grp0 = await p.evaluate(()=>{
  const sp=window.__game.state.substrate.levelSprites;
  window.__game.rockEdit.sel=new Set([4,5]);
  return [sp[4].key, sp[5].key];
});
await p.evaluate(()=>document.querySelector('#eeUp').click());
const grp1 = await p.evaluate((keys)=>{
  const sp=window.__game.state.substrate.levelSprites;
  return {a:sp.findIndex(s=>s.key===keys[0]), b:sp.findIndex(s=>s.key===keys[1]),
          sel:[...window.__game.rockEdit.sel].sort((x,y)=>x-y)};
}, grp0);
ok('a group keeps its internal order when it moves',
   grp1.a===5 && grp1.b===6 && grp1.sel.join()==='5,6', JSON.stringify(grp1));
// The whole point: the order has to survive a save.
const zJson = await p.evaluate(()=>{ document.querySelector('#eeCopy').click(); return window.__levelJSON; });
const zRocks = JSON.parse(zJson).objects.filter(o=>o.t==='boulder'||o.t==='formation').map(o=>o.key);
const zLive = await p.evaluate(()=>window.__game.state.substrate.levelSprites.map(s=>s.key));
ok('the draw order survives the export', zRocks.join()===zLive.join(),
   `${zRocks.length} rocks, first three ${zRocks.slice(0,3).join(' ')}`);
await p.evaluate(()=>document.querySelector('#eeNone').click());
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
// ---- the toolbar carries no prose, and folds away ------------------------
ok('the toolbar has no instruction text',
   await p.evaluate(()=>document.querySelectorAll('#devEditPanel .ee-hint').length)===0);
await p.evaluate(()=>document.querySelector('#eeMin').click()); await sleep(200);
// Assert the CONTROLS are gone, not just that a class landed — the class is my markup, the
// hidden controls are what the owner asked for.
const mini = await p.evaluate(()=>({
  cls:document.getElementById('devEditPanel').classList.contains('min'),
  place:getComputedStyle(document.getElementById('eePlace')).display,
  btn:getComputedStyle(document.getElementById('eeMin')).display,
}));
ok('minimise folds the toolbar away but keeps its own button',
   mini.cls && mini.place==='none' && mini.btn!=='none', JSON.stringify(mini));
await p.evaluate(()=>document.querySelector('#eeMin').click()); await sleep(200);
ok('and unfolds again',
   await p.evaluate(()=>getComputedStyle(document.getElementById('eePlace')).display!=='none'));
// ---- water: one button per ART -------------------------------------------
// Three lake sprites and three reservoir sprites, told apart only by `key`. The bug this
// guards is a single "Lake" button that always wrote lake2 whatever the map wanted.
for (const [label, t, key] of [['Lake 1','lake','lake1'],['Lake 2','lake','lake2'],['Lake 3','lake','lake3'],
                               ['Reservoir 1','reservoir','reservoir1'],['Reservoir 2','reservoir','reservoir2'],
                               ['Reservoir 3','reservoir','reservoir3']]) {
  await p.evaluate((l)=>{ [...document.querySelectorAll('#eePlace button')].find(b=>b.textContent===l).click(); }, label);
  await p.mouse.click(620, 480); await sleep(120);
  const got = await p.evaluate(()=>{ const a=window.__game.rockEdit.added; return {t:a[a.length-1].t, key:a[a.length-1].key}; });
  ok(`"${label}" writes ${t}/${key}`, got.t===t && got.key===key, JSON.stringify(got));
  await p.evaluate(()=>{ window.__game.rockEdit.added.pop(); });
}
await p.evaluate(()=>{ const cur=window.__game.rockEdit.place;
  if (cur) [...document.querySelectorAll('#eePlace button')].find(b=>b.dataset.pk===cur).click(); });
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

// ---- no baked soil pebbles on an authored map ----------------------------
// _bakeRocks scatters ~160 dark ellipses through the soil. That is the procedural game's
// background texture; on a traced map it reads as a second, cruder set of rocks behind the
// real ones. Assert the CONFIG the renderer reads, since the pebbles are baked into an
// offscreen buffer and a pixel probe would be measuring the soil colour.
ok('authored maps bake no soil pebbles',
   await p.evaluate(()=>window.__game.state.config.render.soilPebbles===false),
   String(await p.evaluate(()=>window.__game.state.config.render.soilPebbles)));

// ---- trichoderma radius (regression) -------------------------------------
// A cloud's `r` is in CELLS. The editor used to write 180 — a world-unit value — so ONE
// placement came back after Apply as a 180-cell cloud, i.e. the whole map under mould. The
// object must carry no `r` at all, and the stamped field must stay local.
// Ensure the editor is ON rather than clicking the toggle blind — Apply rebuilds the level
// but leaves rockEdit.on as it was, so a blind click turns the tool OFF and the map click
// below pans the camera instead of placing anything.
await p.evaluate(()=>{ if(!window.__game.rockEdit.on) document.querySelector('#devEditBtn').click(); });
await sleep(300);
await p.evaluate(()=>{ [...document.querySelectorAll('#eePlace button')].find(b=>b.textContent==='Trichoderma').click(); });
await p.mouse.click(700, 520); await sleep(200);
const trObj = await p.evaluate(()=>{ const a=window.__game.rockEdit.added; return a[a.length-1]; });
ok('a placed cloud carries no radius', trObj && trObj.t==='trichoderma' && trObj.r===undefined,
   JSON.stringify(trObj));
await p.evaluate(()=>document.querySelector('#eeApply').click());
await sleep(2500);
await p.waitForFunction(()=>window.__game.state.substrate._rockSolidified===true,null,{timeout:60000}).catch(()=>{});
const tr = await p.evaluate(()=>{
  const s=window.__game.state, cells=s.substrate.cells;
  let n=0; for (const c of cells) if (c.trich>0) n++;
  return {clouds:(s.clouds||[]).length, r:(s.clouds||[]).map(c=>+c.r.toFixed(2)),
          frac:+(n/cells.length).toFixed(3)};
});
ok('one placed cloud covers a corner of the map, not the map',
   tr.clouds>=1 && tr.frac<0.05, `${tr.clouds} cloud(s) r=${tr.r.join(',')} covering ${(tr.frac*100).toFixed(1)}% of cells`);
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
// Give this map a look BEFORE saving, so the saved copy has one to carry. The look is
// per-map; the bug it guards is a module-global filter that survived a map switch.
await p.evaluate(()=>{const i=document.querySelector('#eeB');i.value='1.6';i.dispatchEvent(new Event('input'));});
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
          filter:(d.render||{}).rockFilter||null,
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
ok('the look settings are saved with the map',
   !!sv.filter && Math.abs(sv.filter.brightness-1.6)<0.001, JSON.stringify(sv.filter));

// ---- the look is PER MAP -------------------------------------------------
// rockEdit.filter is module state and a map switch is a full restart, so it used to carry
// over — and since drawLevelRocks prefers the live filter over the level's own while the
// editor is open, the previous map's numbers were imposed on the map you switched to and
// then written into it by the next save. Switch away, switch back, assert both directions.
const readFilter = () => p.evaluate(()=>({
  live:window.__game.rockEdit.filter.brightness,
  slider:+document.querySelector('#eeB').value,
  shown:document.querySelector('#eeBv').textContent,
  id:(window.__game.state.levelDef||{}).id,
}));
const goMap = async (id) => {
  await p.evaluate((i)=>{
    const b=[...document.querySelectorAll('#devMapPanel button')].find(x=>x.title==='#level,'+i);
    if (b) b.click();
  }, id);
  await p.waitForFunction((i)=>(window.__game.state.levelDef||{}).id===i,id,{timeout:30000}).catch(()=>{});
  await p.waitForFunction(()=>window.__game.state.substrate._rockSolidified===true,null,{timeout:90000}).catch(()=>{});
  await sleep(400);
};
const f0 = await readFilter();
ok('the saved map comes up with its own look', Math.abs(f0.live-1.6)<0.001 && Math.abs(f0.slider-1.6)<0.001,
   JSON.stringify(f0));
await goMap('slate-c40');
const f1 = await readFilter();
ok('switching to a map with no look resets the sliders',
   f1.id==='slate-c40' && f1.live===1 && f1.slider===1 && f1.shown==='1.00', JSON.stringify(f1));
await goMap('chapter-one-test');
const f2 = await readFilter();
ok('switching back restores the saved look',
   f2.id==='chapter-one-test' && Math.abs(f2.live-1.6)<0.001 && Math.abs(f2.slider-1.6)<0.001 && f2.shown==='1.60',
   JSON.stringify(f2));
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
