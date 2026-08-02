/* FRAME COST UNDER MOVEMENT — zoom, pan, and a grow revealing.
 *
 *     node tests/perf-scenes.cjs                 desktop 1280x720
 *     node tests/perf-scenes.cjs 390 844         phone (implies dpr 3)
 *
 * A measuring tool, not a check. perf-probe.cjs times a STILL camera, which is the easy case
 * and the one every cache looks good in. This one times the cases where a cache can turn into
 * a liability: anything keyed on the camera misses on every frame while the camera is moving,
 * and if the miss also ALLOCATES then moving is worse than never caching at all.
 *
 * Scenes, each timed over N frames:
 *   still-out / still-in      camera parked, fully zoomed out / in
 *   pan-out / pan-in          camera.x marching, at each zoom
 *   zoom-tween                zoom sweeping between the two, which is what a level intro does
 *   grow-out / grow-in        a long grow revealing (nodes appearing with _appearAt staggered)
 *
 * Also counts how many offscreen canvases each scene MINTS (document.createElement('canvas')),
 * because that is the difference between a cache and a leak with extra steps.
 */
const http=require('http'),fs=require('fs'),path=require('path');
const {chromium}=require('playwright');
const ROOT=process.env.SCENES_ROOT||path.resolve(__dirname,'..');
const T={'.html':'text/html','.js':'text/javascript','.json':'application/json','.png':'image/png','.webp':'image/webp','.mp3':'audio/mpeg','.wav':'audio/wav'};
const VW=+(process.argv[2]||1280), VH=+(process.argv[3]||720);
const DPR=process.argv[2]?3:1;
const pct=(a,q)=>{ if(!a.length) return 0; const s=a.slice().sort((x,y)=>x-y); return s[Math.min(s.length-1,Math.floor(s.length*q))]; };

(async()=>{
const srv=http.createServer((rq,rs)=>{
  const u=decodeURIComponent(rq.url.split('?')[0]);
  const f=path.join(ROOT,u==='/'?'index.html':u);
  fs.readFile(f,(e,d)=>{ if(e){rs.writeHead(404);rs.end();return;}
    rs.writeHead(200,{'Content-Type':T[path.extname(f)]||'application/octet-stream'}); rs.end(d); });
}).listen(0);
const base='http://127.0.0.1:'+srv.address().port;
const b=await chromium.launch({executablePath:'/opt/pw-browsers/chromium'});
const ctx=await b.newContext({viewport:{width:VW,height:VH},deviceScaleFactor:DPR});
await ctx.addInitScript(()=>{
  window.MYCELIUM_SUPABASE={url:'',anonKey:''};
  const realNow=Date.now; Date.now=()=>1717171717171;          // pin the map seed
  const free=()=>{ if(window.__game&&window.__game.state){Date.now=realNow;return;} setTimeout(free,10); };
  setTimeout(free,10);
  // Count offscreen canvases minted, so "the cache is thrashing" is a number and not a hunch.
  const realCreate=document.createElement.bind(document);
  window.__canvasMade=0;
  document.createElement=function(t,...r){ if(String(t).toLowerCase()==='canvas') window.__canvasMade++; return realCreate(t,...r); };
});
const p=await ctx.newPage();
p.on('pageerror',e=>console.log('PAGEERROR:',String(e.stack||e).slice(0,300)));
await p.goto(base+'/index.html#dev,turn',{waitUntil:'domcontentloaded'});
await p.waitForSelector('#loadscreen.ld-ready',{timeout:60000}).catch(()=>{});
await p.click('#loadscreen',{timeout:5000}).catch(()=>{});
await p.waitForFunction(()=>window.__game&&window.__game.state&&window.__game.state.active,null,{timeout:60000});
for(let i=0;i<6&&await p.$('#levelIntro');i++){await p.mouse.click(1100,300);await p.waitForTimeout(400);}
await p.waitForTimeout(800);

const built=await p.evaluate(()=>{
  const G=window.__game,s=G.state,sub=s.substrate,net=s.active;
  net.energy=1e9; net.water=1e9;
  for(let i=0;i<220 && net.nodes.length<3000;i++){
    for(const c of sub.cells) if(c.nutrient>0) c.nutrient=Math.max(c.nutrient,20);
    s.runOver=false;s.winPending=false;s.won=false;net.alive=true;
    G.performAction(s,'grow',{});
  }
  G.settleEnemyTurn();
  return {nodes:net.nodes.length, zmin:G.camera.minZoomForBounds(), zmax:G.camera.maxZoom};
});
console.log(`${VW}x${VH} dpr ${DPR} · ${built.nodes} strands · zoom ${built.zmin.toFixed(2)}..${built.zmax}\n`);

const scene=(name,setup,step,frames)=>p.evaluate(({name,setup,step,frames})=>{
  const G=window.__game, cam=G.camera, s=G.state;
  // eslint-disable-next-line no-new-func
  const doSetup=new Function('G','cam','s',setup), doStep=new Function('G','cam','s','i',step);
  doSetup(G,cam,s);
  for(let i=0;i<4;i++){ doStep(G,cam,s,i); G.renderFrame(performance.now(),1); }   // warm
  const c0=window.__canvasMade, out=[];
  for(let i=0;i<frames;i++){
    doStep(G,cam,s,i);
    const t0=performance.now(); G.renderFrame(performance.now(),1); out.push(performance.now()-t0);
  }
  return {out, canvases: window.__canvasMade-c0};
},{name,setup,step,frames});

const ZOUT=`cam.zoom=cam.minZoomForBounds(); cam.x=s.substrate.worldWidth*0.5; cam.y=s.substrate.surfaceY+300; cam.clamp();`;
const ZIN =`cam.zoom=Math.min(4,cam.minZoomForBounds()*4); cam.x=s.substrate.worldWidth*0.5; cam.y=s.substrate.surfaceY+300; cam.clamp();`;
const HOLD=`;`;
const PAN =`cam.x += 9; cam.clamp();`;
const TWEEN=`cam.zoom = cam.minZoomForBounds()*(1+2.5*(0.5+0.5*Math.sin(i*0.25))); cam.clamp();`;
// A grow with its reveal still running: clear _revSeen/_appearAt so the renderer stages them in.
const GROW=`for(const n of s.active.nodes){ n._revSeen=false; n._appearAt=null; n._liveAt=null; } G.state.active._revealFrom=null;`;

const scenes=[
  ['still-out', ZOUT, HOLD, 40],
  ['still-in',  ZIN,  HOLD, 40],
  ['pan-out',   ZOUT, PAN,  40],
  ['pan-in',    ZIN,  PAN,  40],
  ['zoom-tween',ZOUT, TWEEN,40],
  ['grow-out',  ZOUT+GROW, HOLD, 40],
  ['grow-in',   ZIN +GROW, HOLD, 40],
];
console.log('scene         median    p90     max   canvases minted');
for(const [n,setup,step,frames] of scenes){
  const r=await scene(n,setup,step,frames);
  console.log(`${n.padEnd(12)} ${pct(r.out,0.5).toFixed(1).padStart(6)} ${pct(r.out,0.9).toFixed(1).padStart(6)} ${Math.max(...r.out).toFixed(1).padStart(7)}   ${String(r.canvases).padStart(6)}`);
}

await b.close(); srv.close();
})();
