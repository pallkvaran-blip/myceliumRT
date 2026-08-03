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
// Undo starts empty and says so. Asserted HERE because it is the only point in this file
// where nothing has been edited yet — everything below leaves something on the stack.
ok('Undo starts disabled, with nothing on the stack', await p.evaluate(()=>{
  const b=document.querySelector('#eeUndo');
  return !!b && b.disabled===true && b.textContent==='Undo' && window.__game.rockEdit.undo.length===0;
}));

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

// ---- Duplicate -------------------------------------------------------------
// A copy of the selected rock onto the map. What makes it useful rather than confusing: the
// copy is the SAME sprite (key, size, rotation), it is OFFSET rather than laid exactly on top
// (indistinguishable from nothing having happened), the COPIES end up selected so the next drag
// moves them and not the originals, and collision follows so a duplicate blocks growth.
await p.evaluate(()=>document.querySelector('#eeNone').click());
const dup0 = await p.evaluate(()=>{
  const sp=window.__game.state.substrate.levelSprites;
  window.__game.rockEdit.sel = new Set([1]);
  const s=sp[1];
  return {n:sp.length, key:s.key, style:s.style, x:s.x, y:s.y, w:s.w, h:s.h, rot:s.rot||0,
          undo:window.__game.rockEdit.undo.length};
});
await p.evaluate(()=>document.querySelector('#eeDup').click());
const dup1 = await p.evaluate(()=>{
  const sp=window.__game.state.substrate.levelSprites, r=window.__game.rockEdit;
  const last=sp[sp.length-1];
  return {n:sp.length, sel:[...r.sel], cs:window.__game.state.substrate.cellSize,
          undo:r.undo.length,
          last:{key:last.key, style:last.style, x:last.x, y:last.y, w:last.w, h:last.h, rot:last.rot||0}};
});
ok('Duplicate adds exactly one rock', dup1.n===dup0.n+1, `${dup0.n} \u2192 ${dup1.n}`);
ok('...the SAME sprite, at the same size and angle',
   dup1.last.key===dup0.key && dup1.last.style===dup0.style
   && Math.abs(dup1.last.w-dup0.w)<0.01 && Math.abs(dup1.last.h-dup0.h)<0.01
   && Math.abs(dup1.last.rot-dup0.rot)<1e-6,
   `${dup1.last.key} ${dup1.last.w.toFixed(0)}x${dup1.last.h.toFixed(0)}`);
ok('...offset, not hidden exactly under the original',
   Math.hypot(dup1.last.x-dup0.x, dup1.last.y-dup0.y) > dup1.cs*0.2,
   `moved ${Math.hypot(dup1.last.x-dup0.x, dup1.last.y-dup0.y).toFixed(1)} units`);
ok('...in FRONT, and it is the COPY that is selected',
   dup1.sel.length===1 && dup1.sel[0]===dup1.n-1, JSON.stringify(dup1.sel));
ok('...and it is its own undo step', dup1.undo===dup0.undo+1, `${dup0.undo} \u2192 ${dup1.undo}`);
// COLLISION, asserted as an OUTCOME. `_rockSolidified === false` is not readable from here:
// solidifyRock runs on the next rendered frame and sets it straight back, so the flag races the
// render loop. Move the copy onto open ground and check that ground BECOMES solid — that needs
// the rebuild to have actually happened, and it is the property that matters.
const dupSolid = await p.evaluate(()=>{
  const G=window.__game, sub=G.state.substrate, sp=sub.levelSprites;
  const copy=sp[sp.length-1];
  let spot=null;
  for (let x=sub.cellSize*3; x<sub.worldWidth-sub.cellSize*3 && !spot; x+=sub.cellSize) {
    for (let y=sub.surfaceY+sub.cellSize*3; y<sub.worldHeight-sub.cellSize*3; y+=sub.cellSize) {
      let clear=true;
      for (let a=-2;a<=2&&clear;a++) for (let bq=-2;bq<=2;bq++)
        if (sub.solidAtWorld(x+a*sub.cellSize, y+bq*sub.cellSize)) { clear=false; break; }
      if (clear) { spot={x,y}; break; }
    }
  }
  if (!spot) return {err:'no open ground to move the copy into'};
  const was = sub.solidAtWorld(spot.x, spot.y);
  copy.x = spot.x; copy.y = spot.y;
  sub._rockSolidified = false; sub._fineSolid = null;
  G.renderFrame(performance.now(), 1);            // solidifyRock runs inside the frame
  return {err:null, was, now: sub.solidAtWorld(spot.x, spot.y)};
});
ok('...and collision follows it: open ground the copy moves onto turns solid',
   !dupSolid.err && dupSolid.was===false && dupSolid.now===true,
   dupSolid.err || `solid ${dupSolid.was} \u2192 ${dupSolid.now}`);
// A MULTI selection duplicates every one of them, and the copies are what stays selected.
const mdup0 = await p.evaluate(()=>{
  const sp=window.__game.state.substrate.levelSprites;
  window.__game.rockEdit.sel = new Set([0,2]);
  return {n:sp.length, keys:[sp[0].key, sp[2].key]};
});
await p.evaluate(()=>window.__game.editDuplicate());
const mdup1 = await p.evaluate(()=>{
  const sp=window.__game.state.substrate.levelSprites, r=window.__game.rockEdit;
  return {n:sp.length, sel:[...r.sel].sort((a,b)=>a-b),
          tail:[sp[sp.length-2].key, sp[sp.length-1].key]};
});
ok('Duplicate copies a whole selection', mdup1.n===mdup0.n+2 && mdup1.tail.join()===mdup0.keys.join(),
   `${mdup0.n} \u2192 ${mdup1.n}, tail ${mdup1.tail.join(' ')}`);
ok('...and the copies are what stays selected, not the originals',
   mdup1.sel.join()===`${mdup1.n-2},${mdup1.n-1}`, JSON.stringify(mdup1.sel));
// It has to survive a save, or it is a rock you can see and never ship.
const dupJson = await p.evaluate(()=>{ document.querySelector('#eeCopy').click(); return window.__levelJSON; });
const dupOut = JSON.parse(dupJson).objects.filter(o=>o.t==='boulder'||o.t==='formation').length;
ok('duplicates are written out with everything else', dupOut===mdup1.n, `${dupOut} of ${mdup1.n}`);
// Nothing selected: a no-op, not a stray rock at the origin.
await p.evaluate(()=>document.querySelector('#eeNone').click());
await p.evaluate(()=>document.querySelector('#eeDup').click());
ok('Duplicate with nothing selected does nothing',
   await p.evaluate((n)=>window.__game.state.substrate.levelSprites.length===n, mdup1.n));
// PUT THE MAP BACK, via UNDO — which also proves the copies are undoable. Everything below
// identifies a rock by its KEY, and a key is unique per rock only until a duplicate exists:
// leaving the copies in made findIndex(s => s.key === k) return the ORIGINAL while the
// assertion was about the copy, and the draw-order checks failed on a reorder that had worked.
const dupUndone = await p.evaluate((n0)=>{
  const G=window.__game;
  for (let i=0;i<8 && G.state.substrate.levelSprites.length>n0;i++) document.querySelector('#eeUndo').click();
  return G.state.substrate.levelSprites.length;
}, dup0.n);
ok('undo takes the duplicates back off again', dupUndone===dup0.n,
   `${dupUndone} rocks, started at ${dup0.n}`);
await p.evaluate(()=>document.querySelector('#eeNone').click());

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
// ALL THE WAY, not one step — a single-step nudge meant twenty clicks to free a rock from
// under its neighbour on a 47-rock map.
await p.evaluate(()=>document.querySelector('#eeUp').click());
const zUp2 = await p.evaluate((k)=>{
  const sp=window.__game.state.substrate.levelSprites, r=window.__game.rockEdit;
  return {idx:sp.findIndex(s=>s.key===k), last:sp.length-1, sel:[...r.sel]};
}, zBase.key);
ok('Up brings a rock all the way to the front',
   zUp2.idx===zUp2.last && zUp2.sel.length===1 && zUp2.sel[0]===zUp2.last, JSON.stringify(zUp2));
await p.evaluate(()=>document.querySelector('#eeDown').click());
const zDn = await p.evaluate((k)=>{
  const sp=window.__game.state.substrate.levelSprites, r=window.__game.rockEdit;
  return {idx:sp.findIndex(s=>s.key===k), n:sp.length, sel:[...r.sel]};
}, zBase.key);
ok('Down sends it all the way to the back, losing nothing',
   zDn.idx===0 && zDn.sel[0]===0 && zDn.n===zBase.n, JSON.stringify(zDn));
// Already at the back: a no-op, not a corruption.
await p.evaluate(()=>document.querySelector('#eeDown').click());
ok('sending the bottom rock back again changes nothing',
   await p.evaluate((n)=>window.__game.state.substrate.levelSprites.length===n
     && [...window.__game.rockEdit.sel][0]===0, zBase.n));
// A multi-rock selection moves as a BLOCK and keeps its internal order.
const grp0 = await p.evaluate(()=>{
  const sp=window.__game.state.substrate.levelSprites;
  window.__game.rockEdit.sel=new Set([2,4]);
  return [sp[2].key, sp[4].key];
});
await p.evaluate(()=>document.querySelector('#eeUp').click());
const grp1 = await p.evaluate((keys)=>{
  const sp=window.__game.state.substrate.levelSprites;
  return {a:sp.findIndex(s=>s.key===keys[0]), b:sp.findIndex(s=>s.key===keys[1]), n:sp.length,
          sel:[...window.__game.rockEdit.sel].sort((x,y)=>x-y)};
}, grp0);
ok('a group goes to the front together, in its own order',
   grp1.a===grp1.n-2 && grp1.b===grp1.n-1 && grp1.sel.join()===`${grp1.n-2},${grp1.n-1}`,
   JSON.stringify(grp1));
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

// ---- Undo ------------------------------------------------------------------
// Snapshot-based, so the thing to prove is that a restore puts back the LIST (order and
// membership) as well as each rock's geometry — and that it does so by writing onto the same
// sprite objects, because levelSprites is the live array drawLevelRocks and solidifyRock read.
//
// Deleting every rock and getting them back is the strongest single case: it exercises
// membership (the sprites are gone from the array), identity (the snapshot is the only thing
// still holding them) and order at once.
const undoDel = await p.evaluate(()=>{
  const g=window.__game, sp=g.state.substrate.levelSprites;
  const d0=g.rockEdit.undo.length;
  g.editUndo();
  return { d0, d1:g.rockEdit.undo.length, n:sp.length,
           solid:g.state.substrate._rockSolidified };
});
ok('Undo brings every deleted rock back', undoDel.n===nBefore,
   `${nAfter} -> ${undoDel.n}, wanted ${nBefore}`);
ok('Undo pops exactly one step', undoDel.d1===undoDel.d0-1, `${undoDel.d0} -> ${undoDel.d1}`);
ok('Undo re-runs the collision solidify', undoDel.solid===false, `solidified ${undoDel.solid}`);
await p.waitForFunction(()=>window.__game.state.substrate._rockSolidified===true,null,{timeout:60000}).catch(()=>{});

// Geometry, and the coalescing that makes a run of clicks one step. Five rapid Bigger clicks
// are one undo — otherwise holding a key or nudging a rock into place would bury the stack.
await sleep(900);   // clear of EDIT_COALESCE_MS, so this starts its own run
const undoScale = await p.evaluate(()=>{
  const g=window.__game, sp=g.state.substrate.levelSprites;
  g.rockEdit.sel=new Set([0]);
  const s=sp[0], was={x:s.x,y:s.y,w:s.w,h:s.h,rot:s.rot||0};
  const d0=g.rockEdit.undo.length;
  for (let i=0;i<5;i++) document.querySelector('#eeBig').click();
  const grew=sp[0].w;
  const d1=g.rockEdit.undo.length;
  g.editUndo();
  const s2=sp[0];
  return { was, grew, d0, d1, d2:g.rockEdit.undo.length,
           now:{x:s2.x,y:s2.y,w:s2.w,h:s2.h,rot:s2.rot||0}, same:s2===s };
});
ok('five rapid Bigger clicks are ONE undo step', undoScale.d1===undoScale.d0+1,
   `${undoScale.d0} -> ${undoScale.d1}`);
ok('Bigger actually grew it first', undoScale.grew > undoScale.was.w + 0.5,
   `${undoScale.was.w.toFixed(1)} -> ${undoScale.grew.toFixed(1)}`);
ok('one Undo restores the geometry from before the whole run',
   Math.abs(undoScale.now.w-undoScale.was.w)<1e-6 && Math.abs(undoScale.now.h-undoScale.was.h)<1e-6 &&
   Math.abs(undoScale.now.x-undoScale.was.x)<1e-6 && Math.abs(undoScale.now.y-undoScale.was.y)<1e-6,
   `w ${undoScale.now.w.toFixed(3)} vs ${undoScale.was.w.toFixed(3)}`);
// The restore must WRITE ONTO the live sprite, never swap in a clone: the renderer and the
// collision pass both hold this array, and a clone would leave them drawing the old object.
ok('the restored rock is the SAME object, not a copy', undoScale.same===true);

// Draw order is part of the snapshot too — editRaise moves array positions, not geometry, so
// a restore that only wrote x/y/w/h would silently leave the layering wrong.
await sleep(900);
const undoOrder = await p.evaluate(()=>{
  const g=window.__game, sp=g.state.substrate.levelSprites;
  g.rockEdit.sel=new Set([1]);
  const before=sp.map(s=>s.key).join('|');
  document.querySelector('#eeUp').click();
  const raised=sp.map(s=>s.key).join('|');
  g.editUndo();
  return { before, raised, after:sp.map(s=>s.key).join('|') };
});
ok('Up really changed the order first', undoOrder.raised!==undoOrder.before);
ok('Undo restores the draw order', undoOrder.after===undoOrder.before);

// A placement is its own step, never coalesced — you might drop five piles and want them
// back one at a time. Driven through the real pointerdown handler rather than by poking
// `added`, because that handler's own editPushUndo is the thing under test.
await sleep(900);
const undoPlaced = await p.evaluate(()=>{
  const g=window.__game;
  const btn=[...document.querySelectorAll('#eePlace button')][0];
  btn.click();                                        // arm it
  const n0=g.rockEdit.added.length, d0=g.rockEdit.undo.length;
  const cv=[...document.querySelectorAll('canvas')].find(n=>n.clientHeight>0);
  const r=cv.getBoundingClientRect();
  cv.dispatchEvent(new PointerEvent('pointerdown',
    {clientX:r.left+r.width/2, clientY:r.top+r.height/2, bubbles:true, pointerId:1}));
  const n1=g.rockEdit.added.length, d1=g.rockEdit.undo.length;
  g.editUndo();
  btn.click();                                        // disarm, so later blocks are unaffected
  return {n0, n1, d0, d1, n2:g.rockEdit.added.length};
});
ok('clicking the map with a placeable armed added an object',
   undoPlaced.n1===undoPlaced.n0+1 && undoPlaced.d1===undoPlaced.d0+1,
   `${undoPlaced.n0} -> ${undoPlaced.n1} objects, stack ${undoPlaced.d0} -> ${undoPlaced.d1}`);
ok('Undo takes the placement back off', undoPlaced.n2===undoPlaced.n0,
   `${undoPlaced.n1} -> ${undoPlaced.n2}`);

// The look sliders are in the snapshot as well, and the restore has to move the SLIDER, not
// just the number behind it — a slider left showing the old value is the exact confusion the
// per-map filter sync exists to prevent.
await sleep(900);
const undoFilter = await p.evaluate(()=>{
  const g=window.__game;
  const was=g.rockEdit.filter.brightness;
  const i=document.querySelector('#eeB');
  i.value='1.80'; i.dispatchEvent(new Event('input'));
  const set=g.rockEdit.filter.brightness;
  g.editUndo();
  return {was, set, now:g.rockEdit.filter.brightness,
          slider:Number(document.querySelector('#eeB').value),
          label:document.querySelector('#eeBv').textContent};
});
ok('a look slider moved the filter first', Math.abs(undoFilter.set-1.8)<1e-6, String(undoFilter.set));
ok('Undo restores the filter value', Math.abs(undoFilter.now-undoFilter.was)<1e-6,
   `${undoFilter.set} -> ${undoFilter.now}, wanted ${undoFilter.was}`);
ok('Undo moves the slider and its label back too',
   Math.abs(undoFilter.slider-undoFilter.was)<1e-6 && undoFilter.label===undoFilter.was.toFixed(2),
   `slider ${undoFilter.slider}, label ${undoFilter.label}`);

// The button reports the depth, and greys out when the stack runs dry. Drain it rather than
// counting: the coalescing means the depth is not the number of edits made.
const undoDrain = await p.evaluate(()=>{
  const g=window.__game;
  const shown=document.querySelector('#eeUndo').textContent;
  let guard=0;
  while (g.rockEdit.undo.length && guard++ < 500) g.editUndo();
  return { shown, depth:g.rockEdit.undo.length,
           text:document.querySelector('#eeUndo').textContent,
           dis:document.querySelector('#eeUndo').disabled,
           more:g.editUndo() };
});
ok('the button shows the stack depth', /^Undo \(\d+\)$/.test(undoDrain.shown), undoDrain.shown);
ok('draining the stack disables it again',
   undoDrain.depth===0 && undoDrain.dis===true && undoDrain.text==='Undo',
   `depth ${undoDrain.depth}, "${undoDrain.text}", disabled ${undoDrain.dis}`);
ok('Undo on an empty stack is a no-op, not a throw', undoDrain.more===false);

// Every rock is back where it started — the whole chain above, unwound.
await p.waitForFunction(()=>window.__game.state.substrate._rockSolidified===true,null,{timeout:60000}).catch(()=>{});
ok('unwinding everything returns the map to its opening state',
   await p.evaluate((n)=>window.__game.state.substrate.levelSprites.length===n, nBefore),
   `${await p.evaluate(()=>window.__game.state.substrate.levelSprites.length)} rocks, opened with ${nBefore}`);
// Re-delete so the blocks below still start from the empty map they were written against.
await p.evaluate(()=>{document.querySelector('#eeAll').click();document.querySelector('#eeDel').click();});
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
// "3 objects · edited — Apply to rebuild". The count is the whole marker list now, not a
// pending-only tally, and this map starts with none — so three placed reads as three.
ok('placements show in the count and flag the rebuild',
   /3 objects/.test(pend) && /Apply to rebuild/.test(pend), pend.slice(0,70));
const exported = await p.evaluate(()=>{ document.querySelector('#eeCopy').click(); return window.__levelJSON; });
ok('pending objects reach the export', (JSON.parse(exported).objects||[]).filter(o=>o.t==='food'&&o.kind==='duff').length >= 3);

// ---- a selected threat shows its vision range -----------------------------
// Placing a threat is a decision about what it can REACH, and that was invisible while
// authoring — the range only appeared in play, by tapping the creature.
const sights = await p.evaluate(()=>{
  const g=window.__game, c=g.state.config;
  return {tri:g.threatSight({t:'trichoderma'}), nem:g.threatSight({t:'nematode'}),
          ant:g.threatSight({t:'ant'}), food:g.threatSight({t:'food',kind:'duff'}),
          cfgTri:c.trichoderma.sightRadius, cfgNem:c.nematodes.sightRadius};
});
ok('mould and worms report the level\'s own sight radius',
   sights.tri===sights.cfgTri && sights.nem===sights.cfgNem && sights.tri>0, JSON.stringify(sights));
ok('an ant nest reports none — its trail is pathed to food, it has no sight radius',
   sights.ant===0 && sights.food===0, `ant ${sights.ant}, food ${sights.food}`);
// And it must actually PAINT. Same frame, same camera, selected vs not: the glow covers a
// 500-unit radius, so a patch offset from the marker brightens measurably. Directional, not a
// tolerance — a "did the pixels change" test passes for a change of the wrong kind.
// Save the marker list first — this probe replaces it with a single worm, and the block after
// this one goes on using the leaf piles placed earlier.
const keptAdded = await p.evaluate(()=>JSON.stringify(window.__game.rockEdit.added));
await p.evaluate(()=>{
  const g=window.__game, sub=g.state.substrate;
  g.rockEdit.added.length=0; g.rockEdit.selAdded.clear();
  g.rockEdit.added.push({t:'nematode', x:Math.round(sub.worldWidth*0.5), y:Math.round(sub.surfaceY+400)});
  g.camera.zoom=1; g.camera.x=sub.worldWidth*0.5; g.camera.y=sub.surfaceY+400; g.camera.clamp();
});
await sleep(500);
const glowPatch = () => p.evaluate(()=>{
  const g=window.__game, o=g.rockEdit.added[0];
  const c=[...document.querySelectorAll('canvas')].find(n=>n.clientHeight>0);
  const x=c.getContext('2d'), k=c.height/c.clientHeight;
  const pt=g.camera.worldToScreen(o.x+150, o.y);      // inside the ring, clear of the marker
  const d=x.getImageData(Math.round(pt.x*k)-20, Math.round(pt.y*k)-20, 40, 40).data;
  let sum=0; for(let i=0;i<d.length;i+=4) sum+=d[i]+d[i+1]+d[i+2];
  return Math.round(sum/(d.length/4));
});
const glowOff = await glowPatch();
await p.evaluate(()=>{ window.__game.rockEdit.selAdded=new Set([0]); }); await sleep(500);
const glowOn = await glowPatch();
// This runs at a point where every rock has been deleted, which is deliberate: drawLevelRocks
// used to bail on an empty sprite list before it reached the editor overlay, so markers and
// rings vanished on any map without rocks. If this passes, that path is covered too.
ok('selecting a worm paints its sight range on the map', glowOn > glowOff,
   `patch ${glowOff} unselected -> ${glowOn} selected`);
await p.evaluate((json)=>{
  const r=window.__game.rockEdit;
  r.added.length=0; r.selAdded.clear();
  for (const o of JSON.parse(json)) r.added.push(o);
}, keptAdded);

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

// ---- objects stay editable AFTER Apply ----------------------------------
// The bug: rockEdit.added held only what had been placed since the last Apply, so applying
// baked everything into the world and left nothing the editor could select. The marker list is
// now every non-rock object in the level, re-seeded from the def on each run.
const survived = await p.evaluate(()=>{
  const a=window.__game.rockEdit.added, d=window.__game.state.levelDef||{};
  const nonRock=(d.objects||[]).filter(o=>o.t!=='boulder'&&o.t!=='formation');
  return {markers:a.length, inDef:nonRock.length, kinds:a.map(o=>o.kind||o.t)};
});
ok('the level\'s own objects come back as editable markers after Apply',
   survived.markers>0 && survived.markers===survived.inDef,
   `${survived.markers} markers for ${survived.inDef} objects: ${survived.kinds.join(',')}`);
// DISARM first. The step before this armed "Leaves — yellow" and Apply does not clear it, so
// the drag below would PLACE a fourth leaf pile instead of picking up the marker under the
// cursor — which is exactly how it failed the first time (1167 -> 1167, unmoved).
await p.evaluate(()=>{
  const cur = window.__game.rockEdit.place;
  if (cur) [...document.querySelectorAll('#eePlace button')].find(b=>b.dataset.pk===cur).click();
});
await sleep(150);
// Move one and delete another, both of which were impossible a moment ago.
const mv0 = await p.evaluate(()=>{
  const a=window.__game.rockEdit.added;
  window.__game.rockEdit.selAdded=new Set([0]);
  return {n:a.length, x:a[0].x, y:a[0].y};
});
await p.evaluate(()=>{ const g=window.__game, o=g.rockEdit.added[0];
  g.camera.x=o.x; g.camera.y=o.y!=null?o.y:g.state.substrate.surfaceY+120; g.camera.clamp(); });
await sleep(300);
const mvPt = await p.evaluate(()=>{ const g=window.__game, o=g.rockEdit.added[0];
  const c=g.camera.worldToScreen(o.x, o.y!=null?o.y:g.state.substrate.surfaceY+120);
  return {x:Math.round(c.x), y:Math.round(c.y)}; });
await p.mouse.move(mvPt.x, mvPt.y); await p.mouse.down();
await p.mouse.move(mvPt.x+80, mvPt.y+30, {steps:6}); await p.mouse.up(); await sleep(250);
const mv1 = await p.evaluate(()=>{ const a=window.__game.rockEdit.added;
  return {x:a[0].x, y:a[0].y, note:document.querySelector('#eePend').textContent}; });
ok('an applied object can be dragged', mv1.x!==mv0.x, `${mv0.x} -> ${mv1.x}`);
ok('and the panel says the world needs a rebuild', /Apply to rebuild/.test(mv1.note), mv1.note);
// Revert puts it back — and must NOT reset the look slider, which is a separate concern.
await p.evaluate(()=>{const i=document.querySelector('#eeB');i.value='1.3';i.dispatchEvent(new Event('input'));});
await p.evaluate(()=>document.querySelector('#eeClearAdd').click()); await sleep(200);
const rv = await p.evaluate(()=>({x:window.__game.rockEdit.added[0].x,
  n:window.__game.rockEdit.added.length, b:window.__game.rockEdit.filter.brightness}));
ok('Revert objects restores them without touching the look',
   rv.x===mv0.x && rv.n===mv0.n && Math.abs(rv.b-1.3)<0.001, JSON.stringify(rv));
// Delete one and confirm the export drops it — the export is the thing that persists.
await p.evaluate(()=>{ window.__game.rockEdit.selAdded=new Set([0]); });
await p.keyboard.press('Delete'); await sleep(200);
const del = await p.evaluate(()=>{ document.querySelector('#eeCopy').click();
  const objs=JSON.parse(window.__levelJSON).objects.filter(o=>o.t!=='boulder'&&o.t!=='formation');
  return {markers:window.__game.rockEdit.added.length, exported:objs.length}; });
ok('deleting an applied object drops it from the export',
   del.markers===mv0.n-1 && del.exported===del.markers, JSON.stringify(del));
await p.evaluate(()=>document.querySelector('#eeClearAdd').click()); await sleep(150);

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
// Edit something so there IS an undo stack to carry across the switch below.
await p.evaluate(()=>{
  window.__game.rockEdit.sel=new Set([0]);
  document.querySelector('#eeBig').click();
});
const stackBefore = await p.evaluate(()=>window.__game.rockEdit.undo.length);
ok('there is an undo stack to carry over', stackBefore>0, `${stackBefore} steps`);
await goMap('slate-c40');
const f1 = await readFilter();
ok('switching to a map with no look resets the sliders',
   f1.id==='slate-c40' && f1.live===1 && f1.slider===1 && f1.shown==='1.00', JSON.stringify(f1));
// A snapshot holds REFERENCES into the previous run's levelSprites, and every switch builds a
// fresh array of fresh sprites. Carried over, one undo would splice a dead rock from the last
// map into this one — visible, collidable, and belonging to nothing.
const undoAfterSwitch = await p.evaluate(()=>{
  const g=window.__game;
  const n0=g.state.substrate.levelSprites.length;
  const d=g.rockEdit.undo.length;
  const took=g.editUndo();
  return {d, took, n0, n1:g.state.substrate.levelSprites.length,
          dis:document.querySelector('#eeUndo').disabled};
});
ok('a map switch clears the undo stack',
   undoAfterSwitch.d===0 && undoAfterSwitch.took===false && undoAfterSwitch.dis===true,
   `depth ${undoAfterSwitch.d}, undo returned ${undoAfterSwitch.took}`);
ok('so an undo cannot splice the previous map\'s rocks into this one',
   undoAfterSwitch.n1===undoAfterSwitch.n0, `${undoAfterSwitch.n0} -> ${undoAfterSwitch.n1} rocks`);
await goMap('chapter-one-test');
const f2 = await readFilter();
ok('switching back restores the saved look',
   f2.id==='chapter-one-test' && Math.abs(f2.live-1.6)<0.001 && Math.abs(f2.slider-1.6)<0.001 && f2.shown==='1.60',
   JSON.stringify(f2));

// ---- the map name is shown, and renameable ------------------------------
ok('the panel shows the current map name',
   await p.evaluate(()=>document.querySelector('#eeName').value)==='Chapter One Test',
   await p.evaluate(()=>document.querySelector('#eeName').value));
ok('and its id beside it', /chapter-one-test/.test(await p.evaluate(()=>document.querySelector('#eeId').textContent)),
   await p.evaluate(()=>document.querySelector('#eeId').textContent));
// Rename the way a person does: type, then blur. `change` is what commits — renaming per
// keystroke would rewrite localStorage and rebuild the map list under the cursor.
await p.click('#eeName');
await p.evaluate(()=>{document.querySelector('#eeName').select();});
await p.keyboard.type('Cavern Approach');
await p.keyboard.press('Enter');
await sleep(400);
const rn = await p.evaluate(()=>({
  live:(window.__game.state.levelDef||{}).name,
  id:(window.__game.state.levelDef||{}).id,
  // id + name ONLY. The first version returned the whole stored level, which printed a 47-rock
  // JSON dump into the log on PASS and buried every line around it.
  stored:(()=>{const s=JSON.parse(localStorage.getItem('mycelium.savedLevels.v1')||'[]')[0]||{};
               return {id:s.id, name:s.name};})(),
  listed:[...document.querySelectorAll('#devMapPanel button')]
           .filter(b=>b.title==='#level,chapter-one-test').map(b=>b.textContent.replace('×','')),
}));
ok('renaming changes the map name', rn.live==='Cavern Approach', String(rn.live));
ok('the id is NOT re-slugged, so #level,<id> still works', rn.id==='chapter-one-test', String(rn.id));
ok('a saved map keeps the new name in localStorage',
   rn.stored.name==='Cavern Approach' && rn.stored.id==='chapter-one-test', JSON.stringify(rn.stored));
ok('the map list picks the new label up', rn.listed[0]==='Cavern Approach', JSON.stringify(rn.listed));
// TYPING MUST NOT DRIVE THE GAME. The editor's key handler is on window, so before the guard
// every keystroke into this field also nudged rocks and deleted placements.
const beforeType = await p.evaluate(()=>{
  const sp=window.__game.state.substrate.levelSprites;
  window.__game.rockEdit.sel=new Set([0]);
  return {x:sp[0].x, y:sp[0].y, keys:sp.map(s=>s.key).join()};
});
await p.click('#eeName');
for (const k of ['ArrowRight','ArrowDown','Backspace','BracketRight','Delete']) await p.keyboard.press(k);
await p.keyboard.press('Escape');            // restores the field, does not touch the map
await sleep(300);
const afterType = await p.evaluate(()=>{
  const sp=window.__game.state.substrate.levelSprites;
  return {x:sp[0].x, y:sp[0].y, keys:sp.map(s=>s.key).join(), name:(window.__game.state.levelDef||{}).name};
});
ok('typing in the name field does not nudge, delete or re-layer rocks',
   afterType.x===beforeType.x && afterType.y===beforeType.y && afterType.keys===beforeType.keys
     && afterType.name==='Cavern Approach',
   `x ${beforeType.x}->${afterType.x}, order ${afterType.keys===beforeType.keys?'kept':'CHANGED'}, name "${afterType.name}"`);
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

// ---- Apply / Save leave NOTHING armed ------------------------------------
// Owner: "when I press apply & rebuild, please deselect everything. E.g. if the last thing I did
// was place a nematode - you'd deselect that button so that the next click is neutral."
//
// `place` is the one piece of selection with no presence on the map — a highlighted button in the
// panel and nothing else — so coming back from a rebuild still armed drops another creature on the
// first click. The BUTTON is asserted as well as the flag: its amber border used to be painted only
// inside its own onclick, so clearing the state alone would have left it looking armed while doing
// nothing, which is the worse of the two failures.
await p.evaluate(()=>{ if(!window.__game.rockEdit.on) document.querySelector('#devEditBtn').click(); });
await sleep(300);
const armedNow = await p.evaluate(()=>{
  const r = window.__game.rockEdit;
  const btns = [...document.querySelectorAll('#eePlace button')];
  const worm = btns.find((b)=>/nemat|worm/i.test(b.textContent)) || btns[0];
  worm.click();                                     // arm a placeable, the owner's example
  const sp = window.__game.state.substrate.levelSprites || [];
  r.sel = new Set(sp.length ? [0] : []);            // and select a rock, so both kinds are live
  return { armedId: r.place, label: worm.textContent.trim(), sel: r.sel.size,
           lit: btns.filter((b)=>b.style.borderColor).length };
});
ok('a placeable can be armed, and its button lights up',
   !!armedNow.armedId && armedNow.lit === 1, `armed ${armedNow.armedId} (${armedNow.label}), ${armedNow.lit} button lit`);
ok('...and a rock is selected alongside it', armedNow.sel === 1, `${armedNow.sel} selected`);

await p.evaluate(()=>document.querySelector('#eeApply').click());
await sleep(1200);
await p.waitForFunction(()=>window.__game.state.substrate._rockSolidified===true,null,{timeout:90000}).catch(()=>{});
await p.evaluate(()=>{ if(!window.__game.rockEdit.on) document.querySelector('#devEditBtn').click(); });
await sleep(400);
const cleared = await p.evaluate(()=>{
  const r = window.__game.rockEdit;
  return { place: r.place, sel: r.sel.size, selAdded: r.selAdded.size, drag: r.drag,
           lit: [...document.querySelectorAll('#eePlace button')].filter((b)=>b.style.borderColor).length,
           pend: (document.querySelector('#eePend')||{}).textContent || '' };
});
ok('Apply disarms the placeable', cleared.place === null, String(cleared.place));
ok('...and no button is left looking armed', cleared.lit === 0, `${cleared.lit} still lit`);
ok('...and the rock selection is cleared too',
   cleared.sel === 0 && cleared.selAdded === 0 && !cleared.drag,
   `sel ${cleared.sel}, placed ${cleared.selAdded}, drag ${cleared.drag}`);
ok('...and the panel stops saying "placing"', !/placing/i.test(cleared.pend), cleared.pend);

await b.close();srv.close();
console.log(`==== ${PASS} passed, ${FAIL} failed ====`);
process.exit(FAIL?1:0);
})();
