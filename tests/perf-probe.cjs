/* WHERE THE FRAME TIME GOES.
 *
 *     node tests/perf-probe.cjs            a mid-size colony, the default 1280x720 viewport
 *     node tests/perf-probe.cjs 6000       ...with a bigger colony (target strand count)
 *     node tests/perf-probe.cjs 6000 390 844   ...at a phone viewport (iPhone 14-ish, dpr 3)
 *
 * A MEASUREMENT TOOL, not a check — it prints numbers and never fails. The pass/fail version of
 * this is perf-check.cjs, which pins the budgets this one is used to discover.
 *
 * Two things it measures, separately, because they have different cures:
 *   - `renderFrame` cost, driven SYNCHRONOUSLY through the __game.renderFrame hook. Timing the
 *     real rAF loop here would measure headless's throttle (~1-2Hz), not the game.
 *   - `tickWorld` cost, the sim step.
 * ...and a CDP CPU profile around both, aggregated by SELF time, so the top of the list is the
 * function actually burning the time rather than whatever happens to sit at the top of the tree.
 */
const http=require('http'),fs=require('fs'),path=require('path');
const {chromium}=require('playwright');
const ROOT=path.resolve(__dirname,'..');
const T={'.html':'text/html','.js':'text/javascript','.json':'application/json','.png':'image/png','.webp':'image/webp','.mp3':'audio/mpeg','.wav':'audio/wav'};

const WANT_NODES=+(process.argv[2]||3000);
const WORMS=+(process.env.PERF_WORMS||0);   // late-game threat load; 0 = whatever the map seeded
const VW=+(process.argv[3]||1280), VH=+(process.argv[4]||720);
const DPR=process.argv[3]?3:1;          // a phone viewport implies a phone's pixel ratio

const pct=(a,q)=>{ if(!a.length) return 0; const s=a.slice().sort((x,y)=>x-y);
  return s[Math.min(s.length-1, Math.floor(s.length*q))]; };

(async()=>{
const srv=http.createServer((rq,rs)=>{
  const u=decodeURIComponent(rq.url.split('?')[0]);
  const f=path.join(ROOT, u==='/'?'index.html':u);
  fs.readFile(f,(e,d)=>{ if(e){rs.writeHead(404);rs.end();return;}
    rs.writeHead(200,{'Content-Type':T[path.extname(f)]||'application/octet-stream'}); rs.end(d); });
}).listen(0);
const base='http://127.0.0.1:'+srv.address().port;

const b=await chromium.launch({executablePath:'/opt/pw-browsers/chromium'});
const ctx=await b.newContext({viewport:{width:VW,height:VH}, deviceScaleFactor:DPR});
// ONE MAP, EVERY RUN. startRun() seeds the world from Date.now(), so every boot got a different
// map with a different amount of food on screen — and since food piles were the most expensive
// thing in the frame, the median swung between 91 and 999 ms on identical code. Nothing to
// compare a fix against. Freezing the clock for the boot pins the seed; it is restored as soon
// as the run exists, so nothing that measures elapsed time sees a stopped clock.
await ctx.addInitScript((w)=>{
  window.__perfWorms=w;
  window.MYCELIUM_SUPABASE={url:'',anonKey:''};
  const realNow=Date.now;
  Date.now=()=>1717171717171;
  const free=()=>{ if (window.__game&&window.__game.state) { Date.now=realNow; return; } setTimeout(free,10); };
  setTimeout(free,10);
}, WORMS);
const p=await ctx.newPage();
p.on('pageerror',e=>console.log('PAGEERROR:',String(e.stack||e).slice(0,300)));
await p.goto(base+'/index.html#dev,turn',{waitUntil:'domcontentloaded'});
await p.waitForSelector('#loadscreen.ld-ready',{timeout:60000}).catch(()=>{});
await p.click('#loadscreen',{timeout:5000}).catch(()=>{});
await p.waitForFunction(()=>window.__game&&window.__game.state&&window.__game.state.active,null,{timeout:60000});
for(let i=0;i<6&&await p.$('#levelIntro');i++){await p.mouse.click(1100,300);await p.waitForTimeout(400);}
await p.waitForTimeout(800);

// A colony the size the complaint is about. Feed the cells under it so the grows land, and
// settle the enemy turn each time so the world is in the state a player would actually see.
const built=await p.evaluate((want)=>{
  const G=window.__game,s=G.state,sub=s.substrate,net=s.active;
  net.energy=1e9; net.water=1e9;
  let guard=0;
  while (net.nodes.length<want && guard++<4000) {
    for (const c of sub.cells) if (c.nutrient>0) c.nutrient=Math.max(c.nutrient,20);
    s.runOver=false; s.winPending=false; s.won=false; net.alive=true;
    G.performAction(s,'grow',{});
    if (guard%25===0) { for (const cell of sub.cells) { cell.nutrient=Math.max(cell.nutrient,8); cell.maxNutrient=Math.max(cell.maxNutrient,8); } }
  }
  // A LATE-GAME THREAT LOAD. Threats compound from L7 (L20 is ~66), and worm sensing is the
  // part of the tick that scales with worms x strands — one worm measures nothing about the
  // level the complaint comes from. Placed in open ground, spread over the map.
  const WORMS=+(window.__perfWorms||0);
  if (WORMS) {
    s.nematodes.length=0;
    const n=s.config.nematodes;
    for (let i=0,guard=0; i<WORMS && guard<20000; guard++) {
      const x=sub.cellSize*2+((guard*137)%Math.max(1,sub.worldWidth-sub.cellSize*4));
      const y=sub.surfaceY+sub.cellSize*2+((guard*89)%Math.max(1,sub.worldHeight-sub.surfaceY-sub.cellSize*4));
      const c=sub.cellAtWorld(x,y); if (!c||c.rock) continue;
      s.nematodes.push({x,y,heading:0,phase:0,stuck:0,feedCd:0,hp:n.maxHp,
                        sees:false,feeding:false,trailing:false,targetId:null});
      i++;
    }
  }
  G.settleEnemyTurn();
  return { nodes:net.nodes.length, worms:s.nematodes.length, clouds:(s.clouds||[]).length,
           ants:(s.ants||[]).length, cells:sub.cells.length,
           scale:G.renderScale(), dpr:window.devicePixelRatio,
           canvas:[document.querySelector('canvas').width, document.querySelector('canvas').height] };
}, WANT_NODES);

console.log(`viewport ${VW}x${VH} dpr ${built.dpr} → canvas ${built.canvas[0]}x${built.canvas[1]} ` +
            `(${(built.canvas[0]*built.canvas[1]/1e6).toFixed(2)} Mpx, renderScale ${built.scale.toFixed(2)})`);
console.log(`colony ${built.nodes} strands · ${built.worms} worms · ${built.clouds} clouds · ` +
            `${built.ants} ants · ${built.cells} cells\n`);

const time=async(fn,n)=>p.evaluate(({fn,n})=>{
  const G=window.__game;
  const f=fn==='render' ? (t)=>G.renderFrame(t,1)
                        : ()=>{ const s=G.state; s.runOver=false; s.winPending=false; s.won=false;
                                if (s.active) s.active.alive=true; G.tickWorld(s); };
  for (let i=0;i<5;i++) f(performance.now());       // warm
  const out=[];
  for (let i=0;i<n;i++){ const t0=performance.now(); f(performance.now()); out.push(performance.now()-t0); }
  return out;
},{fn,n});

// WHAT IS BEING BLITTED, and from where. drawImage dominates the profile, but "drawImage" is
// not an answer — the useful question is how many calls one frame makes and which call site
// issues them. Counted by patching the 2D context for exactly one frame.
const blits=await p.evaluate(()=>{
  const C=CanvasRenderingContext2D.prototype, real=C.drawImage;
  const byCaller=new Map(); let calls=0, srcPx=0, dstPx=0;
  C.drawImage=function(img,...a){
    calls++;
    const iw=img.width||img.videoWidth||0, ih=img.height||img.videoHeight||0;
    // The SOURCE RECT, not the whole image — the substrate buffers are world-sized but the
    // draw is already culled to the viewport, and charging it the full buffer said it read
    // 19 Mpx a frame when it reads a screenful. Same measure per caller as in the total.
    let s, d;
    if (a.length>=8) { s=(a[2]||0)*(a[3]||0); d=(a[6]||0)*(a[7]||0); }
    else if (a.length>=4) { s=iw*ih; d=(a[2]||0)*(a[3]||0); }
    else { s=iw*ih; d=iw*ih; }
    srcPx+=s; dstPx+=d;
    // Second frame of the stack is the call site; the first is this wrapper.
    const st=(new Error().stack||'').split('\n');
    let who='?'; for (let i=1;i<st.length;i++){ if (!/drawImage/.test(st[i])) { who=st[i].trim().replace(/^at\s+/,'').replace(/\s*\(.*$/,''); break; } }
    const e=byCaller.get(who)||{n:0,src:0,dst:0}; e.n++; e.src+=s; e.dst+=d; byCaller.set(who,e);
    return real.apply(this,[img,...a]);
  };
  window.__game.renderFrame(performance.now(),1);
  C.drawImage=real;
  return { calls, srcMpx:srcPx/1e6, dstMpx:dstPx/1e6,
           top:[...byCaller.entries()].sort((a,b)=>b[1].src-a[1].src).slice(0,12)
                 .map(([k,v])=>`${String(v.n).padStart(6)} calls  ${(v.src/1e6).toFixed(2).padStart(7)} Mpx src  ${(v.dst/1e6).toFixed(2).padStart(7)} Mpx dst  ${k}`) };
});
console.log(`\n── drawImage in ONE frame: ${blits.calls} calls, ${blits.srcMpx.toFixed(1)} Mpx read, ${blits.dstMpx.toFixed(1)} Mpx written ──`);
for (const l of blits.top) console.log('  '+l);

const session=await ctx.newCDPSession(p);
await session.send('Profiler.enable');
await session.send('Profiler.setSamplingInterval',{interval:100});   // 0.1ms — the frame is ~ms
await session.send('Profiler.start');

const rend=await time('render',60);
const tick=await time('tick',40);

const {profile}=await session.send('Profiler.stop');

const show=(name,a)=>console.log(`${name.padEnd(12)} median ${pct(a,0.5).toFixed(2)} ms · ` +
  `p90 ${pct(a,0.9).toFixed(2)} · max ${Math.max(...a).toFixed(2)} · ` +
  `(60fps budget is 16.7)`);
show('renderFrame',rend);
show('tickWorld',tick);

// Self time by function. The profile's `timeDeltas[i]` is the gap BEFORE sample i+1, so each
// sample's node gets the delta that follows it — close enough at 0.1ms, and the ordering of the
// top of the list is what this is for.
const byId=new Map(); (function walk(n){ byId.set(n.id,n); (n.children||[]).forEach((c)=>walk(byId.get(c)||c)); })(profile.nodes[0]);
for (const n of profile.nodes) byId.set(n.id,n);
const self=new Map();
for (let i=0;i<profile.samples.length;i++){
  const n=byId.get(profile.samples[i]); if (!n) continue;
  const cf=n.callFrame, key=(cf.functionName||'(anonymous)')+'  '+(cf.url||'').replace(/^.*\//,'')+':'+(cf.lineNumber+1);
  self.set(key,(self.get(key)||0)+(profile.timeDeltas[i]||0)/1000);
}
const total=[...self.values()].reduce((a,v)=>a+v,0);
console.log(`\n── self time, top 20 of ${total.toFixed(0)} ms profiled ──`);
for (const [k,v] of [...self.entries()].sort((a,b)=>b[1]-a[1]).slice(0,20))
  console.log(`  ${(100*v/total).toFixed(1).padStart(5)}%  ${v.toFixed(0).padStart(5)} ms  ${k}`);

await b.close(); srv.close();
})();
