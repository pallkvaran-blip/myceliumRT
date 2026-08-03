/* DOES EACH MAP'S ROCK COLLISION MATCH ITS ROCK ART?
 *
 *     node tests/rock-audit.cjs garnet-c40 rust-c90        # named maps
 *     node tests/rock-audit.cjs $(ls docs/levels/*.json | xargs -n1 basename | sed 's/.json//')
 *
 * Prints MEASUREMENTS, not PASS/FAIL, and is not in the runner (59 maps is ~20 minutes).
 *
 * It re-derives the truth from each sprite's own alpha through `__game.rockArt`, so it does NOT
 * inherit a bug in `markCoverGrid` — which is the only way to ask "does the mask match the
 * picture?" without trusting the thing under test. Then it attributes every mismatch.
 *
 * Run over all 59 committed maps: 58 are EXACT, zero mismatched cells. The one exception is the
 * hand-authored `three-ways`, and all 1,162 of its gap cells are explained and intended —
 * 1,065 sit in the `pathClear` entry/goal channels (buildLevel digs those and they beat rock, so a
 * slab poking in draws rock you walk through) and 97 are the documented food-holes-a-wall rule.
 * The traced maps avoid the first because the tracer SIZES THE WORLD so no sprite can reach a
 * channel.
 *
 * The second half is what to watch: `holingObjects` counts food/water objects that punch a hole in
 * a rock. `markCoverGrid` skips every cell holding food or water ("never bury a food pile"), but
 * the art still draws — so an overlapping pile leaves a see-through, grow-through hole in a wall
 * that looks solid. Measured on garnet-c40: one cache inside a rock took the solid area under it
 * from 81 of 81 fine cells to 25. The traced maps ship with NO food, so they cannot show this; a
 * map you have placed food on can. `__game.auditRocks()` runs the same check on whatever map is
 * loaded, including a saved Chapter 1 map that only exists in one browser's localStorage.
 */
const http=require('http'),fs=require('fs'),path=require('path');
const {chromium}=require('playwright');
const ROOT='/home/user/myceliumRT';
const T={'.html':'text/html','.js':'text/javascript','.json':'application/json','.png':'image/png','.webp':'image/webp','.mp3':'audio/mpeg','.wav':'audio/wav'};
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const AUDIT = () => {
  const s=window.__game.state, sub=s.substrate;
  if(!sub._fineSolid) return {err:'fine mask not built'};
  const fSz=sub._fineSize, fC=sub._fineCols, fR=sub._fineRows, fs_=sub._fineSolid;
  const sprites=sub.levelSprites||[];
  let drawnSolid=0, missing=0, noArt=0;
  const cause={water:0, food:0, surface:0, oob:0, unexplained:0};
  const worst=[];
  // Walk each sprite's own alpha at the FINE grid resolution — the same geometry markCoverGrid
  // uses, minus its skip rules, so a gap shows up as a gap.
  for(const sp of sprites){
    const m=window.__game.rockArt(sp.key);
    if(!m){ noArt++; continue; }
    const rot=sp.rot||0, cr=Math.cos(rot), sr=Math.sin(rot);
    const hwR=Math.abs(sp.w/2*cr)+Math.abs(sp.h/2*sr), hhR=Math.abs(sp.w/2*sr)+Math.abs(sp.h/2*cr);
    const c0=Math.max(0,Math.floor((sp.x-hwR)/fSz)), c1=Math.min(fC-1,Math.floor((sp.x+hwR)/fSz));
    const r0=Math.max(0,Math.floor((sp.y-hhR-sub.surfaceY)/fSz)), r1=Math.min(fR-1,Math.floor((sp.y+hhR-sub.surfaceY)/fSz));
    let spMiss=0;
    for(let gc=c0;gc<=c1;gc++) for(let gr=r0;gr<=r1;gr++){
      const wx=gc*fSz+fSz/2, wy=sub.surfaceY+gr*fSz+fSz/2;
      if(wy<=sub.surfaceY){ continue; }
      const dx=wx-sp.x, dy=wy-sp.y;
      const lx=cr*dx+sr*dy, ly=-sr*dx+cr*dy;
      const u=(lx+sp.w/2)/sp.w, v=(ly+sp.h/2)/sp.h;
      if(u<0||u>1||v<0||v>1) continue;
      const px=Math.min(m.mw-1,Math.max(0,Math.floor(u*m.mw)));
      const py=Math.min(m.mh-1,Math.max(0,Math.floor(v*m.mh)));
      if(m.data[(py*m.mw+px)*4+3]<128) continue;      // sprite transparent here
      drawnSolid++;
      if(fs_[gr*fC+gc]===1) continue;                  // mask agrees
      missing++; spMiss++;
      const cell=sub.cellAtWorld(wx,wy);
      if(!cell) cause.oob++;
      else if(cell.water) cause.water++;
      else if(cell.nutrient>0||cell.maxNutrient>0) cause.food++;
      else cause.unexplained++;
    }
    if(spMiss>0) worst.push({key:sp.key, x:Math.round(sp.x), y:Math.round(sp.y), miss:spMiss});
  }
  worst.sort((a,b)=>b.miss-a.miss);
  // AND THE OTHER DIRECTION: objects that HOLE a rock. markCoverGrid skips any cell holding food
  // or water ("never bury a food pile"), but the rock ART still draws over it — so a pile or
  // reservoir overlapping rock leaves a see-through, grow-through hole in a wall that looks solid.
  // Measured by asking, for each object, how much of the rock art around it is no longer solid.
  const def=s.levelDef||{}; const objs=(def.objects||[]);
  const holes=[];
  for(const o of objs){
    if(o.t!=='food' && o.t!=='water' && o.t!=='reservoir' && o.t!=='lake') continue;
    const ox=+o.x||0, oy=(o.y!=null?+o.y:sub.surfaceY+40);
    // Is the ART solid here, while the MASK is not? That is exactly a punched hole.
    let artSolid=0, punched=0;
    const R=Math.max(2,Math.round(((+o.r||1)+1)*sub.cellSize/fSz));
    for(let dx=-R;dx<=R;dx++) for(let dy=-R;dy<=R;dy++){
      const wx=ox+dx*fSz, wy=oy+dy*fSz;
      if(wy<=sub.surfaceY) continue;
      const gc=Math.floor(wx/fSz), gr=Math.floor((wy-sub.surfaceY)/fSz);
      if(gc<0||gr<0||gc>=fC||gr>=fR) continue;
      // "art solid" = some sprite's opaque silhouette covers this point
      let art=false;
      for(const sp of sprites){
        const m=window.__game.rockArt(sp.key); if(!m) continue;
        const rot=sp.rot||0, cr=Math.cos(rot), sr=Math.sin(rot);
        const dxs=wx-sp.x, dys=wy-sp.y;
        const lx=cr*dxs+sr*dys, ly=-sr*dxs+cr*dys;
        const u=(lx+sp.w/2)/sp.w, v=(ly+sp.h/2)/sp.h;
        if(u<0||u>1||v<0||v>1) continue;
        const px=Math.min(m.mw-1,Math.max(0,Math.floor(u*m.mw)));
        const py=Math.min(m.mh-1,Math.max(0,Math.floor(v*m.mh)));
        if(m.data[(py*m.mw+px)*4+3]>=128){ art=true; break; }
      }
      if(!art) continue;
      artSolid++;
      if(fs_[gr*fC+gc]!==1) punched++;
    }
    if(punched>0) holes.push({t:o.t, kind:o.kind||null, x:Math.round(ox), y:Math.round(oy),
                              artSolid, punched, pct:+(100*punched/Math.max(1,artSolid)).toFixed(0)});
  }
  holes.sort((a,b)=>b.punched-a.punched);
  return { level:(s.levelDef||{}).id, sprites:sprites.length, noArt, drawnSolid, missing,
           missPct:+(100*missing/Math.max(1,drawnSolid)).toFixed(2), cause,
           worst:worst.slice(0,5),
           objects:objs.length, holingObjects:holes.length, holedFineCells:holes.reduce((t,h)=>t+h.punched,0),
           holes:holes.slice(0,6) };
};
(async()=>{
const maps=process.argv.slice(2);
const srv=await new Promise(r=>{const s=http.createServer((rq,rs)=>{let p=decodeURIComponent(rq.url.split('?')[0].split('#')[0]);if(p==='/')p='/index.html';const fp=path.join(ROOT,p);if(!fs.existsSync(fp)||fs.statSync(fp).isDirectory()){rs.writeHead(404);rs.end('nf');return;}rs.writeHead(200,{'Content-Type':T[path.extname(fp)]||'application/octet-stream'});fs.createReadStream(fp).pipe(rs);});s.listen(0,()=>r(s));});
const b=await chromium.launch({headless:true,executablePath:'/opt/pw-browsers/chromium'});
const out=[];
for(const id of maps){
  const ctx=await b.newContext({viewport:{width:1200,height:700}});
  await ctx.addInitScript(()=>{window.MYCELIUM_SUPABASE={url:'',anonKey:''};});
  const p=await ctx.newPage();
  p.on('pageerror',e=>console.log('  PAGEERROR',id,String(e).slice(0,120)));
  await p.goto('http://localhost:'+srv.address().port+'/index.html#level,'+id,{waitUntil:'domcontentloaded'});
  await p.waitForSelector('#loadscreen.ld-ready',{timeout:60000}).catch(()=>{});
  await p.click('#loadscreen',{timeout:5000}).catch(()=>{});
  await p.waitForFunction(()=>window.__game&&window.__game.state&&window.__game.state.active,null,{timeout:60000}).catch(()=>{});
  const built=await p.waitForFunction(()=>window.__game.state.substrate._rockSolidified===true,null,{timeout:120000}).then(()=>true).catch(()=>false);
  const r=built ? await p.evaluate(AUDIT) : {level:id, err:'rock never solidified'};
  r.level=r.level||id;
  out.push(r);
  console.log(JSON.stringify(r));
  await ctx.close();
}
fs.writeFileSync(process.env.AUDIT_OUT||'/tmp/audit.json', JSON.stringify(out,null,1));
await b.close();srv.close();
})();
