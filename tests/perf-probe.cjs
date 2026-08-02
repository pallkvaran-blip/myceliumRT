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
await ctx.addInitScript(()=>{window.MYCELIUM_SUPABASE={url:'',anonKey:''};});
const p=await ctx.newPage();
await p.goto(base+'/index.html#dev,turn');
await p.waitForFunction(()=>window.__game&&window.__game.state&&window.__game.state.substrate,null,{timeout:60000});
await p.waitForTimeout(1500);

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
