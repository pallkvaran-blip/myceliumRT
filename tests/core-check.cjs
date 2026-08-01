/* THE CORE — the molten floor under an authored map.
 *
 *     node tests/core-check.cjs
 *
 * A second hard boundary, the mirror of the soil line: at half the content depth the earth
 * turns to molten rock, the colony cannot grow past it, and level rocks are clipped at it the
 * way a rock dragged above the soil line is clipped by the sky.
 *
 * The two things worth guarding here are the ones that would be invisible if they broke:
 *
 *   - The line the player SEES and the line the engine STOPS them at must be the same y.
 *     They are drawn and enforced by different code (SubstrateRenderer._bakeEarth vs
 *     Network._placeOk), so nothing but a test keeps them together — and a growth floor a
 *     hundred units off the visible seam reads as the game refusing a legal move.
 *   - It must stay OFF for procedural maps. The generator spreads food, reservoirs and
 *     formations across the full content depth, so a core at 0.5 would strand about half of
 *     every generated map's resources under a line the colony cannot cross. That is the
 *     shipped 100-level campaign; this check is what stops a later edit turning it on there
 *     by accident.
 */
const http=require('http'),fs=require('fs'),path=require('path');
const {chromium}=require('playwright');
const ROOT=path.resolve(__dirname,'..');
const T={'.html':'text/html','.js':'text/javascript','.json':'application/json','.png':'image/png','.webp':'image/webp','.mp3':'audio/mpeg','.wav':'audio/wav'};
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
let PASS=0, FAIL=0;
const ok=(n,c,x)=>{ c?PASS++:FAIL++; console.log((c?'  PASS  ':'  FAIL  ')+n+(x?'  — '+x:'')); };

const boot = async (ctx, hash) => {
  const p=await ctx.newPage();
  p.on('pageerror',e=>console.log('PAGEERROR:',String(e.stack||e).slice(0,300)));
  await p.goto(hash,{waitUntil:'domcontentloaded'});
  await p.waitForSelector('#loadscreen.ld-ready',{timeout:60000}).catch(()=>{});
  await p.click('#loadscreen',{timeout:5000}).catch(()=>{});
  await p.waitForFunction(()=>window.__game&&window.__game.state&&window.__game.state.active,null,{timeout:30000});
  await p.waitForFunction(()=>window.__game.state.substrate._rockSolidified===true,null,{timeout:90000}).catch(()=>{});
  for(let i=0;i<6&&await p.$('#levelIntro');i++){await p.mouse.click(1100,300);await sleep(400);}
  return p;
};

(async()=>{
const srv=await new Promise(res=>{const s=http.createServer((rq,rs)=>{let p=decodeURIComponent(rq.url.split('?')[0].split('#')[0]);if(p==='/')p='/index.html';const fp=path.join(ROOT,p);if(!fp.startsWith(ROOT)||!fs.existsSync(fp)||fs.statSync(fp).isDirectory()){rs.writeHead(404);rs.end('nf');return;}rs.writeHead(200,{'Content-Type':T[path.extname(fp)]||'application/octet-stream'});fs.createReadStream(fp).pipe(rs);});s.listen(0,()=>res(s));});
const base='http://localhost:'+srv.address().port;
const b=await chromium.launch({headless:true,executablePath:'/opt/pw-browsers/chromium'});

// ---- an authored map has a core -------------------------------------------
let ctx=await b.newContext({viewport:{width:1400,height:800}});
await ctx.addInitScript(()=>{window.MYCELIUM_SUPABASE={url:'',anonKey:''};});
let p=await boot(ctx, base+'/index.html#level,slate-c40');

const geom=await p.evaluate(()=>{const s=window.__game.state.substrate;
  return {surfaceY:s.surfaceY, coreY:s.coreY, growFloorY:s.growFloorY, worldHeight:s.worldHeight,
          frac:s.coreDepthFrac};});
ok('an authored map has a core line', geom.coreY!=null, JSON.stringify(geom));
// DEPTH IS THE WORLD'S HEIGHT. The line cannot go below the cell grid, so the only way to put
// it deeper is a taller content box — extended by CORE_DEPTH_MULT over what the level's JSON
// declares, with the map's own objects keeping their absolute coordinates. Read the declared
// box off the level def, which configForLevelDef must NOT have mutated: the multiplier is
// applied to the config, so a save round-trips the original and cannot compound.
const decl=await p.evaluate(()=>{const d=window.__game.state.levelDef||{};
  return {h:(d.world||{}).height, sy:(d.world||{}).surfaceY};});
ok('the level def keeps the height its tracer wrote', Math.abs(decl.h-1278.6)<0.01,
   `def height ${decl.h}, surfaceY ${decl.sy}`);
const box=await p.evaluate(()=>({d:window.__game.coreBoxDepth, l:window.__game.coreLineDepth}));
ok(`the content box is a fixed ${box.d} deep, whatever the level declares`,
   Math.abs((geom.worldHeight-geom.surfaceY) - box.d) < 1,
   `played depth ${Math.round(geom.worldHeight-geom.surfaceY)} vs declared ${Math.round(decl.h-decl.sy)}`);
// Where the line sits within the box. Lifted off the floor, so the molten band is INSIDE the
// world and rocks dragged into it are clipped by it — on the floor the core showed only below
// the map. Still clamped at 1: a fraction past it would put the growth floor below the cell
// grid, where _placeOk would happily grow into a gridless void.
ok(`the line sits a fixed ${box.l} down, inside the box`,
   Math.abs((geom.coreY-geom.surfaceY) - box.l) < 1 && geom.coreY <= geom.worldHeight,
   `line ${Math.round(geom.coreY-geom.surfaceY)} of a ${Math.round(geom.worldHeight-geom.surfaceY)} box`);
ok('the growth floor IS the core line',
   geom.growFloorY===geom.coreY,
   `floor ${Math.round(geom.growFloorY)}, core ${Math.round(geom.coreY)}`);

// The line drawn and the line enforced must be the same y. Scan ACROSS the map at each depth:
// a single x lands inside a rock and would report "blocked" for the wrong reason.
const reach=await p.evaluate(()=>{
  const s=window.__game.state, sub=s.substrate, net=s.networks[0];
  const anyAt=(y)=>{for(let x=60;x<sub.worldWidth-60;x+=17) if(net._placeOk(sub,x,y)) return true; return false;};
  let deepest=null;
  // Scan PAST the line — with the core clamped to the content floor, stopping short of
  // worldHeight would report a deepest point that is just the loop bound.
  for(let y=sub.surfaceY+20;y<sub.coreY+40;y+=2) if(anyAt(y)) deepest=y;
  return {deepest, core:sub.coreY,
          justAbove:anyAt(sub.coreY-8), atLine:anyAt(sub.coreY),
          below:anyAt(sub.coreY+20), wayBelow:anyAt(sub.coreY+300)};
});
ok('the colony can grow right up to the line', reach.justAbove===true);
ok('and not one step past it',
   reach.atLine===false && reach.below===false && reach.wayBelow===false,
   `at ${reach.atLine}, +20 ${reach.below}, +300 ${reach.wayBelow}`);
ok('the deepest placeable point is the line itself',
   reach.deepest!=null && (reach.core - reach.deepest) <= 4 && reach.deepest < reach.core,
   `deepest ${reach.deepest} vs core ${Math.round(reach.core)}`);

// ---- it LOOKS like the core ----------------------------------------------
// Not "did the pixels change" — the claim is that the earth turns RED, so compare the red
// channel's lead over blue above and below the line. Soil is brown (r>b but modestly); the
// core is a saturated red.
await p.evaluate(()=>{const g=window.__game,s=g.state.substrate;
  g.camera.zoom=1; g.camera.x=s.worldWidth*0.5; g.camera.y=s.coreY; g.camera.clamp();});
await sleep(700);
const hue=await p.evaluate(()=>{
  const g=window.__game, sub=g.state.substrate;
  const c=[...document.querySelectorAll('canvas')].find(n=>n.clientHeight>0);
  const x=c.getContext('2d'), k=c.height/c.clientHeight;
  const patch=(wy)=>{
    const pt=g.camera.worldToScreen(g.camera.x, wy);
    const d=x.getImageData(Math.max(0,Math.round(pt.x*k)-30), Math.max(0,Math.round(pt.y*k)-15), 60, 30).data;
    let r=0,bl=0; for(let i=0;i<d.length;i+=4){r+=d[i];bl+=d[i+2];}
    return {r:Math.round(r/(d.length/4)), b:Math.round(bl/(d.length/4))};
  };
  return {above:patch(sub.coreY-120), below:patch(sub.coreY+120)};
});
// Calibrated against the NULL CASE, not against the observed value: with no core the patch
// below the line is soil and its lead matches the one above it (~28 vs ~28). Observed with the
// core: ~79. The gate sits at 60 and 2x, which leaves better than 2x headroom over "no core at
// all" while not being a number copied off a passing run.
const leadAbove=hue.above.r-hue.above.b, leadBelow=hue.below.r-hue.below.b;
ok('the earth turns red below the line', leadBelow > leadAbove*2 && leadBelow > 60,
   `red-over-blue ${leadAbove} above -> ${leadBelow} below`);

// ---- a rock below the line is clipped by the core -------------------------
// The mirror of the above-ground clip. Sample the rock's OWN centre and compare it against
// bare core in the same frame: what the clip promises is that the spot ends up looking like
// core, not like rock.
const clip=await p.evaluate(()=>{
  const g=window.__game, sub=g.state.substrate, s=sub.levelSprites[0];
  if(!s) return {err:'no sprites'};
  s._y0=s.y; s.y=sub.coreY+200; sub._rockSolidified=false;
  g.camera.x=s.x; g.camera.y=sub.coreY+200; g.camera.clamp();
  return {ok:true};
});
await sleep(800);
const clipped=await p.evaluate(()=>{
  const g=window.__game, sub=g.state.substrate, s=sub.levelSprites[0];
  const c=[...document.querySelectorAll('canvas')].find(n=>n.clientHeight>0);
  const x=c.getContext('2d'), k=c.height/c.clientHeight;
  const mean=(wx,wy)=>{
    const pt=g.camera.worldToScreen(wx,wy);
    const px=Math.max(0,Math.min(c.width-40,Math.round(pt.x*k)-20));
    const py=Math.max(0,Math.min(c.height-40,Math.round(pt.y*k)-20));
    const d=x.getImageData(px,py,40,40).data;
    let sum=0; for(let i=0;i<d.length;i+=4) sum+=d[i]+d[i+1]+d[i+2];
    return Math.round(sum/(d.length/4));
  };
  // The reference has to be bare core that is genuinely ON SCREEN and INSIDE the world. The
  // first version sampled a single point 700 units to the left, which at this zoom is exactly
  // the half-width of the viewport — so it clamped to the canvas edge and sometimes read the
  // background outside the world instead of the core (144 vs 114, a 30-point gap, on a loaded
  // machine). Median of several nearby offsets: one unlucky patch cannot swing it.
  const refs=[];
  for (const dx of [-320,-200,200,320]) {
    const wx=Math.max(60, Math.min(sub.worldWidth-60, s.x+dx));
    const pt=g.camera.worldToScreen(wx, s.y);
    if (pt.x*k < 30 || pt.x*k > c.width-30) continue;      // would clamp to the canvas edge
    refs.push(mean(wx, s.y));
  }
  refs.sort((a,b)=>a-b);
  const bare = refs.length ? refs[Math.floor(refs.length/2)] : null;
  return {onRock:mean(s.x,s.y), bareCore:bare, refs};
});
ok('a rock dragged below the line is cut off by the core',
   !clip.err && clipped.bareCore != null && Math.abs(clipped.onRock-clipped.bareCore) < 30,
   clip.err || `rock centre ${clipped.onRock}, bare core ${clipped.bareCore} of [${(clipped.refs||[]).join(' ')}]`);
await p.evaluate(()=>{const sub=window.__game.state.substrate,s=sub.levelSprites[0];
  if(s&&s._y0!=null){s.y=s._y0;sub._rockSolidified=false;}});

// ---- assets can be placed ALL THE WAY DOWN --------------------------------
// The world is now 1.8x the depth its JSON declares, and the bottom of it is where the extra
// room actually is — so an editor that could only stamp into the top of the map would make the
// whole extension useless. Place one of each stamped kind in the DEEPEST row, Apply, and
// assert the world came back with them: these are the three that go through different paths
// (stampFood writes nutrient cells, stampReservoir carves water and registers a pocket,
// placeClouds seeds a mould field), so one of them working says nothing about the others.
const deep=await p.evaluate(()=>{
  const g=window.__game, sub=g.state.substrate;
  const yDeep = sub.coreY - sub.cellSize;          // the last row of cells above the core
  const x = sub.worldWidth*0.5;
  g.rockEdit.on = true;
  g.rockEdit.added.push({t:'food', kind:'duff', x:Math.round(x-300), y:Math.round(yDeep), r:1, energy:2});
  g.rockEdit.added.push({t:'reservoir', key:'reservoir1', x:Math.round(x), y:Math.round(yDeep), r:72});
  g.rockEdit.added.push({t:'trichoderma', x:Math.round(x+300), y:Math.round(yDeep)});
  return {yDeep:Math.round(yDeep), rows:sub.rows, deepestRow:sub.rowAtY(yDeep)};
});
await p.evaluate(()=>document.querySelector('#eeApply').click());
await sleep(2500);
await p.waitForFunction(()=>window.__game.state.substrate._rockSolidified===true,null,{timeout:90000}).catch(()=>{});
const stamped=await p.evaluate((yDeep)=>{
  const s=window.__game.state, sub=s.substrate;
  const rowOf=(i)=>Math.floor(i/sub.cols);
  const deepRow=sub.rowAtY(yDeep);
  const pile=(sub.foodPiles||[]).find(pp=>pp.cells.some(i=>rowOf(i)>=deepRow-1));
  const res=(sub.reservoirs||[]).find(r=>r.r1>=deepRow-1);
  const cloud=(s.clouds||[]).find(c=>c.cy>=yDeep-60);
  return {deepRow, rows:sub.rows,
          food:!!pile, foodRow:pile?Math.max(...pile.cells.map(rowOf)):null,
          reservoir:!!res, resRow:res?res.r1:null,
          cloud:!!cloud, cloudY:cloud?Math.round(cloud.cy):null};
}, deep.yDeep);
ok('a leaf pile stamps in the deepest row', stamped.food && stamped.foodRow>=stamped.deepRow-1,
   `row ${stamped.foodRow} of ${stamped.rows}`);
ok('a reservoir carves water in the deepest row', stamped.reservoir,
   `row ${stamped.resRow} of ${stamped.rows}`);
ok('a mould cloud seeds in the deepest row', stamped.cloud, `y ${stamped.cloudY} vs ${deep.yDeep}`);
await ctx.close();

// ---- a procedural map has NO core ----------------------------------------
ctx=await b.newContext({viewport:{width:1400,height:800}});
await ctx.addInitScript(()=>{window.MYCELIUM_SUPABASE={url:'',anonKey:''};});
p=await boot(ctx, base+'/index.html#dev,turn');
const proc=await p.evaluate(()=>{const s=window.__game.state.substrate;
  return {coreY:s.coreY, growFloorY:s.growFloorY, worldHeight:s.worldHeight};});
ok('a PROCEDURAL map has no core — its generated food would be stranded below one',
   proc.coreY===null && proc.growFloorY===proc.worldHeight, JSON.stringify(proc));
await ctx.close();

// ---- a level can turn it off ---------------------------------------------
// Via a saved level, which is also the path configForLevelDef takes for `world` overrides.
const def=JSON.parse(fs.readFileSync(path.join(ROOT,'docs','levels','slate-c40.json'),'utf8'));
const off=JSON.parse(JSON.stringify(def));
off.id='core-off'; off.name='Core Off'; off.chapter='Chapter 1';
off.assetsFrom='slate-c40'; off.campaignLevel=null;
off.world=Object.assign({}, off.world, {coreDepthFrac:null});
ctx=await b.newContext({viewport:{width:1400,height:800}});
await ctx.addInitScript((c)=>{window.MYCELIUM_SUPABASE={url:'',anonKey:''};
  try{localStorage.setItem('mycelium.savedLevels.v1',JSON.stringify([c]));}catch(_){}}, off);
p=await boot(ctx, base+'/index.html#level,core-off');
const noCore=await p.evaluate(()=>{const s=window.__game.state.substrate;
  return {id:(window.__game.state.levelDef||{}).id, coreY:s.coreY, growFloorY:s.growFloorY,
          worldHeight:s.worldHeight};});
ok('a level can set coreDepthFrac null and have no core at all',
   noCore.id==='core-off' && noCore.coreY===null && noCore.growFloorY===noCore.worldHeight,
   JSON.stringify(noCore));
await ctx.close();

await b.close();srv.close();
console.log(`==== ${PASS} passed, ${FAIL} failed ====`);
process.exit(FAIL?1:0);
})();
