/* ROT SPREAD PROBE — what the rot ACTUALLY advances per step, vs what the config says.
 *
 *     node tests/spread-probe.cjs
 *
 * Not a check: it prints numbers. Measures the advance on a LINEAR chain (where 1 ring = 1
 * strand, so the count is the rate) over 40 trials at each infectionSpreadChance.
 *
 * This is the tool that found the defect behind "the rot chases at uneven speeds, usually
 * about 2 steps": a failed spread roll drops that node from the frontier and kills the branch
 * for the rest of the call, so a filament advances a GEOMETRIC number of rings with mean
 * p/(1-p) — DEAF to spreadDepthPerTurn. With the depth set to 40, chance 0.85 gave
 * min 0 / median 5 / max 32 / mean 6.1 rings (~2 steps); chance 1 gave exactly 40, every time.
 * The depth had been raised 6 -> 18 -> 40 across two sessions for almost no effect.
 *
 * Re-run it after any change to the spread, and read the result in STEPS (1 ring = 1 segment,
 * 3 segments = 1 card step) — that is the unit the owner thinks in.
 */
const http=require('http'),fs=require('fs'),path=require('path');
const {chromium}=require('playwright');
const ROOT='/home/user/myceliumRT';
const T={'.html':'text/html','.js':'text/javascript','.json':'application/json','.png':'image/png','.webp':'image/webp','.mp3':'audio/mpeg','.wav':'audio/wav'};
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
(async()=>{
const srv=await new Promise(res=>{const s=http.createServer((rq,rs)=>{let p=decodeURIComponent(rq.url.split('?')[0].split('#')[0]);if(p==='/')p='/index.html';const fp=path.join(ROOT,p);if(!fp.startsWith(ROOT)||!fs.existsSync(fp)||fs.statSync(fp).isDirectory()){rs.writeHead(404);rs.end('nf');return;}rs.writeHead(200,{'Content-Type':T[path.extname(fp)]||'application/octet-stream'});fs.createReadStream(fp).pipe(rs);});s.listen(0,()=>res(s));});
const base='http://localhost:'+srv.address().port;
const b=await chromium.launch({headless:true,executablePath:'/opt/pw-browsers/chromium'});
const ctx=await b.newContext({viewport:{width:1400,height:800}});
await ctx.addInitScript(()=>{window.MYCELIUM_SUPABASE={url:'',anonKey:''};});
const p=await ctx.newPage();
p.on('pageerror',e=>console.log('PAGEERROR:',String(e.stack||e).slice(0,300)));
await p.goto(base+'/index.html#dev,turn',{waitUntil:'domcontentloaded'});
await p.waitForSelector('#loadscreen.ld-ready',{timeout:60000}).catch(()=>{});
await p.click('#loadscreen',{timeout:5000}).catch(()=>{});
await p.waitForFunction(()=>window.__game&&window.__game.state&&window.__game.state.active,null,{timeout:60000}).catch(()=>{});
for(let i=0;i<6&&await p.$('#levelIntro');i++){await p.mouse.click(1100,300);await sleep(400);}
console.log(JSON.stringify(await p.evaluate(()=>{
  const G=window.__game,s=G.state,sub=s.substrate,net=s.active,cs=sub.cellSize,t=s.config.trichoderma;
  s.nematodes.length=0; s.clouds.length=0;
  const out={depth:t.spreadDepthPerTurn, segLen:s.config.growth.segmentLength};
  const build=(LEN)=>{
    net.nodes.length=0; net.byId.clear(); net.nextNodeId=0;
    let parent=net.addNode(sub.worldWidth/2, sub.surfaceY+cs*3, null); parent._liveAt=0;
    for (let i=1;i<LEN;i++){ parent=net.addNode(sub.worldWidth/2, sub.surfaceY+cs*3+i*4, parent); parent._liveAt=0; }
    for (const n of net.nodes){ n.infected=false; const c=sub.cellAtWorld(n.x,n.y); if(c){c.mouldProof=0;c.reinfectGrace=0;c.trich=0;} }
  };
  for (const chance of [0.85, 1.0]) {
    t.infectionSpreadChance = chance;
    const runs=[];
    for (let trial=0; trial<40; trial++) {
      build(300);
      net._spreadAccum=0;
      net.nodes[0].infected=true;               // seed at one end; rot has one direction to go
      const n0=1;
      G.tickWorld(s);
      runs.push(net.nodes.filter(n=>n.infected).length - n0);
    }
    runs.sort((a,b)=>a-b);
    const mean=runs.reduce((a,b)=>a+b,0)/runs.length;
    out['chance'+chance]={min:runs[0], med:runs[Math.floor(runs.length/2)], max:runs[runs.length-1],
                          mean:+mean.toFixed(1), steps:+(mean/3).toFixed(1)};
  }
  return out;
}),null,1));
await b.close(); srv.close();
})();
