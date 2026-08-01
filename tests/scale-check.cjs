/* ORGANISM SCALE — config.growth.scale, the "how big is the mycelium" knob.
 *
 *     node tests/scale-check.cjs
 *
 * One number scales the colony: every world-unit LENGTH in CONFIG.growth is multiplied by
 * it once at module load (GROWTH_LENGTHS in config), and NetworkRenderer scales its drawn
 * strand width and cottony fuzz off the same number.
 *
 * What is worth guarding is that it stays a SCALE — a uniform one — because every way of
 * getting it wrong is a partial application, and each of those is quiet:
 *
 *   - Lengthen the step alone and the colony overshoots its own attractors. A step longer
 *     than killDistance can land past a food cell without ever satisfying it, so a tip
 *     orbits a pile instead of eating it. Nothing errors; growth just gets stupid.
 *   - Lengthen the step alone and the DRAWN thread stays a hair, so a bigger colony reads
 *     as a sparser one. That is a look regression with no gameplay symptom to catch it.
 *   - Scale minTipSpacing past segmentLength and the colony rejects its own new tips as
 *     "too close to an existing node" — growth simply stops, with no message.
 *
 * So the assertions are the RATIOS (which must survive any scale value) plus the two ends
 * of the pipe: the engine's measured step, and the renderer's stroke width. The base
 * values are pinned too — they are the thing `scale` multiplies, and a silent edit to one
 * of them is the other way this drifts.
 *
 * Also checks the longer step did not weaken rock collision. `_segmentClear` samples by
 * DISTANCE (the fine mask's resolution), not by a fixed number of samples per segment, so
 * a 1.5x segment gets 1.5x the samples — but that is exactly the kind of thing that gets
 * "optimised" later, and a strand inside a wall is the worst bug in this project.
 */
const http=require('http'),fs=require('fs'),path=require('path');
const {chromium}=require('playwright');
const ROOT=path.resolve(__dirname,'..');
const T={'.html':'text/html','.js':'text/javascript','.json':'application/json','.png':'image/png','.webp':'image/webp','.mp3':'audio/mpeg','.wav':'audio/wav'};
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
let PASS=0, FAIL=0;
const ok=(n,c,x)=>{ c?PASS++:FAIL++; console.log((c?'  PASS  ':'  FAIL  ')+n+(x?'  — '+x:'')); };

// The UNSCALED values as written in the CONFIG literal. Pinned here on purpose: `scale`
// is meaningless without them, and the check's job is that base x scale is what the game
// actually runs on.
const BASE = { sensingRadius:135, killDistance:22, segmentLength:17, startDepth:20, minTipSpacing:11, waterContactDist:14 };
// NetworkRenderer's batched-LOD taper, likewise unscaled (BUCKET_W).
const BASE_BUCKET = [1.06, 1.3, 1.52];

const boot = async (ctx, url) => {
  const p=await ctx.newPage();
  p.on('pageerror',e=>console.log('PAGEERROR:',String(e.stack||e).slice(0,300)));
  await p.goto(url,{waitUntil:'domcontentloaded'});
  await p.waitForSelector('#loadscreen.ld-ready',{timeout:60000}).catch(()=>{});
  await p.click('#loadscreen',{timeout:5000}).catch(()=>{});
  await p.waitForFunction(()=>window.__game&&window.__game.state&&window.__game.state.active,null,{timeout:60000}).catch(()=>{});
  await p.waitForFunction(()=>window.__game.state.substrate._rockSolidified===true,null,{timeout:90000}).catch(()=>{});
  for(let i=0;i<6&&await p.$('#levelIntro');i++){await p.mouse.click(1100,300);await sleep(400);}
  return p;
};

(async()=>{
const srv=await new Promise(res=>{const s=http.createServer((rq,rs)=>{let p=decodeURIComponent(rq.url.split('?')[0].split('#')[0]);if(p==='/')p='/index.html';const fp=path.join(ROOT,p);if(!fp.startsWith(ROOT)||!fs.existsSync(fp)||fs.statSync(fp).isDirectory()){rs.writeHead(404);rs.end('nf');return;}rs.writeHead(200,{'Content-Type':T[path.extname(fp)]||'application/octet-stream'});fs.createReadStream(fp).pipe(rs);});s.listen(0,()=>res(s));});
const base='http://localhost:'+srv.address().port;
const b=await chromium.launch({headless:true,executablePath:'/opt/pw-browsers/chromium'});

// ---- 1. the knob reaches every length, and only the lengths -----------------
let ctx=await b.newContext({viewport:{width:1400,height:800}});
await ctx.addInitScript(()=>{window.MYCELIUM_SUPABASE={url:'',anonKey:''};});
let p=await boot(ctx, base+'/index.html#dev,turn');

const g=await p.evaluate(()=>{const x=window.__game.state.config.growth; const o={}; for(const k in x) o[k]=x[k]; return o;});
const K=g.scale;
ok('growth.scale is set', typeof K==='number' && K>0, `scale ${K}`);
for (const key in BASE) {
  ok(`${key} is base x scale`, Math.abs(g[key]-BASE[key]*K) < 1e-9,
     `${BASE[key]} x ${K} = ${(BASE[key]*K).toFixed(3)}, got ${g[key]}`);
}
// Angles, chances and segment COUNTS must not be touched — a scaled angle is a different
// shape, and a scaled count is a different card.
ok('angles are left alone', g.branchJitter===0.22 && g.sideStrandSpread===0.8 && g.matStrandSpread===1.5,
   `jitter ${g.branchJitter}, spread ${g.sideStrandSpread}, mat ${g.matStrandSpread}`);
ok('counts and chances are left alone', g.stepsPerGrow===7 && g.sideStrandChance===0.4 && g.companionMax===9,
   `steps ${g.stepsPerGrow}, sideChance ${g.sideStrandChance}, companionMax ${g.companionMax}`);

// ---- 2. the ratios that make growth work at ANY scale -----------------------
ok('an attractor is consumed, not orbited (killDistance > segmentLength)', g.killDistance > g.segmentLength,
   `kill ${g.killDistance} vs step ${g.segmentLength}`);
ok('a step is never rejected as too close (minTipSpacing < segmentLength)', g.minTipSpacing < g.segmentLength,
   `spacing ${g.minTipSpacing} vs step ${g.segmentLength}`);
ok('a tip still senses several steps ahead', g.sensingRadius / g.segmentLength > 4,
   `${(g.sensingRadius/g.segmentLength).toFixed(2)} steps of sensing`);
// The grid does NOT scale, and the step must stay under a cell or growth skips cells whole.
const cs=await p.evaluate(()=>window.__game.state.substrate.cellSize);
ok('the step still lands inside the (unscaled) cell grid', g.segmentLength < cs,
   `step ${g.segmentLength} vs cell ${cs}`);

// ---- 3. what the ENGINE actually grows ---------------------------------------
// The seed sprout first: it is startDepth deep whatever the segment count works out to.
const seed=await p.evaluate(()=>{const net=window.__game.state.active;
  const ys=net.nodes.map(n=>n.y); return {span:Math.max(...ys)-Math.min(...ys), n:net.nodes.length};});
ok('the seed sprout is startDepth deep', Math.abs(seed.span-g.startDepth) < 1.5,
   `${seed.span.toFixed(1)} deep over ${seed.n} nodes, startDepth ${g.startDepth}`);

// Then a real grow, into food laid just inside sensing range.
const grown=await p.evaluate(() => {
  const G=window.__game, s=G.state, sub=s.substrate, net=s.active;
  net.water=99; net.energy=5000;
  const nd=net.nodes[0], c0=sub.colAtX(nd.x), r0=sub.rowAtY(nd.y);
  for (let c=c0-3; c<=c0+3; c++) for (let r=r0; r<=r0+4; r++) {
    if (!sub.inBounds(c,r)) continue;
    const cell=sub.cells[sub.index(c,r)];
    cell.rock=0; cell.hazard=0; cell.nutrient=50; cell.maxNutrient=50;
  }
  const before=net.nodes.length;
  const seen=new Set(net.nodes.map(n=>n.id));
  for (let i=0;i<8;i++) G.performAction(s,'grow',{});
  // Measure only the strands this grow added, and only the SPACE-COLONISATION ones: the
  // pile-mat and pile-runner primitives deliberately step short as they close on food.
  const d=[];
  for (const n of net.nodes) {
    if (seen.has(n.id) || n.parentId==null || n.colon || n.side) continue;
    const q=net.byId.get(n.parentId); if (!q) continue;
    d.push(Math.hypot(n.x-q.x, n.y-q.y));
  }
  d.sort((a,b)=>a-b);
  return { before, after:net.nodes.length, n:d.length,
           med:d.length?d[Math.floor(d.length/2)]:0, max:d.length?d[d.length-1]:0 };
});
ok('a grow still grows', grown.after > grown.before, `${grown.before} → ${grown.after} nodes`);
ok('it measured enough fresh strands to mean something', grown.n >= 20, `${grown.n} strands`);
// The step is the strand length. A hair of slack for the tip that stops short on its
// attractor; nothing may EXCEED the segment length, which is what a stale hard-coded 17
// (or an unscaled literal left behind in one primitive) would show up as.
ok('each step measures segmentLength', Math.abs(grown.med-g.segmentLength) < 1.0,
   `median ${grown.med.toFixed(2)} vs ${g.segmentLength}`);
ok('no step overshoots segmentLength', grown.max <= g.segmentLength + 0.5,
   `longest ${grown.max.toFixed(2)} vs ${g.segmentLength}`);

// ---- 4. what the RENDERER draws ---------------------------------------------
const drawn=await p.evaluate(()=>{const r=window.__game.netRenderer();
  r.markStructureDirty(); r._rebuildCaches();
  return { cream:r.batches.cream.map(b=>b.w), inf:r.batches.infected.w, prot:r.batches.protected.w, sc:r._sc() };});
ok('the renderer reads the same scale', Math.abs(drawn.sc-K)<1e-9, `renderer ${drawn.sc}, config ${K}`);
ok('the drawn thread is base x scale', drawn.cream.length===BASE_BUCKET.length &&
   drawn.cream.every((w,i)=>Math.abs(w-BASE_BUCKET[i]*K)<1e-9),
   `[${drawn.cream.map(w=>w.toFixed(3))}] vs [${BASE_BUCKET.map(w=>(w*K).toFixed(3))}]`);
ok('infected and warded strands scale with it', Math.abs(drawn.inf-1.2*K)<1e-9 && Math.abs(drawn.prot-1.4*K)<1e-9,
   `infected ${drawn.inf}, warded ${drawn.prot}`);
await ctx.close();

// ---- 5. the longer step has not punched through rock ------------------------
// The assertion the whole change hangs on, and the one that found a real bug: `_growStep`
// — the basic undirected Grow — tested only its ENDPOINT with _placeOk, so any wall
// thinner than one step could be hopped, and lengthening the step widened that hole.
// Swept over slate-c40 / obsidian-c55 / side-veined-c28 (every open point on a 9-unit
// grid, 16 headings): of the steps the endpoint test accepted, 0.17-0.25% crossed rock at
// the old 17-unit step and 0.42-0.58% at 25.5. It now goes through _segmentClear like
// every card grow primitive, which samples by DISTANCE and so scales with the step.
//
// VERIFIED NEGATIVE CONTROL — with that one line put back to _placeOk, this same probe
// reports 3 wall-crossing strands of 865; with _segmentClear, 0 of ~840. So the check can
// actually see the failure it claims to rule out.
//
// The food is a sparse lattice RE-SEEDED before every grow, not one big pile: a pile the
// colony reaches is claimed and matted whole (`colon` hyphae, excluded here — they land
// wherever the pile's cells are, which is a different rule), and food-everywhere ends up
// measuring that instead. Re-seeding keeps attractors alive across open ground, which is
// what makes ~840 of the nodes space-colonisation steps rather than ~20.
ctx=await b.newContext({viewport:{width:1400,height:800}});
await ctx.addInitScript(()=>{window.MYCELIUM_SUPABASE={url:'',anonKey:''};});
p=await boot(ctx, base+'/index.html#level,slate-c40');
const rock=await p.evaluate(()=>{
  const G=window.__game, s=G.state, sub=s.substrate, net=s.active;
  net.water=999; net.energy=99999;
  const idx=[];
  for (let row=0;row<sub.rows;row+=4) for (let col=0;col<sub.cols;col+=4) {
    const ctr=sub.cellCenter(col,row); if (sub.solidAtWorld(ctr.x,ctr.y)) continue;
    const c=sub.cells[sub.index(col,row)]; if (!c||c.water) continue;
    idx.push(sub.index(col,row));
  }
  for (let i=0;i<40;i++) {
    for (const j of idx){ const c=sub.cells[j]; c.nutrient=30; c.maxNutrient=30; }
    G.performAction(s,'grow',{});
  }
  let counted=0, inside=0, crossing=0;
  for (const n of net.nodes) {
    if (n.colon || n.side) continue;
    counted++;
    if (sub.solidAtWorld(n.x,n.y)) inside++;
    if (n.parentId==null) continue; const q=net.byId.get(n.parentId); if (!q) continue;
    if (!net._segmentClear(sub,q.x,q.y,n.x,n.y)) crossing++;
  }
  // Is this map even capable of showing the failure? Count the steps an ENDPOINT-only test
  // would have waved through — if that is zero there are no thin walls here and the two
  // assertions below prove nothing.
  let hoppable=0;
  const seg=s.config.growth.segmentLength;
  for (let y=sub.surfaceY+8; y<sub.growFloorY-8; y+=18) for (let x=8; x<sub.worldWidth-8; x+=18) {
    if (sub.solidAtWorld(x,y)) continue;
    for (let k=0;k<16;k++) { const a=k*Math.PI/8, nx=x+Math.cos(a)*seg, ny=y+Math.sin(a)*seg;
      if (net._placeOk(sub,nx,ny) && !net._segmentClear(sub,x,y,nx,ny)) hoppable++; }
  }
  return { nodes:net.nodes.length, counted, inside, crossing, hoppable, solid:sub._rockSolidified };
});
ok('the traced map really solidified (otherwise nothing below means anything)', rock.solid===true,
   `${rock.nodes} nodes, solidified ${rock.solid}`);
ok('the colony really space-colonised across it', rock.counted>400, `${rock.counted} non-mat nodes of ${rock.nodes}`);
ok('the map HAS walls a step could hop (the control)', rock.hoppable>50,
   `${rock.hoppable} endpoint-legal steps cross rock`);
ok('no node sits inside drawn rock', rock.inside===0, `${rock.inside} of ${rock.counted}`);
ok('no strand crosses a wall between its endpoints', rock.crossing===0, `${rock.crossing} of ${rock.counted}`);

await b.close(); srv.close();
console.log(`==== ${PASS} passed, ${FAIL} failed ====`);   // the runner parses this exact line
process.exit(FAIL?1:0);
})();
