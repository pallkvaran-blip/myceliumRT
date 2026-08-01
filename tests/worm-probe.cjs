/* WORM MOVEMENT PROBE — what share of worms can actually move, as crawlSpeed goes up.
 *
 *     node tests/worm-probe.cjs
 *
 * Not a check: it prints numbers, and it also prints WHY each stuck worm was stuck
 * (no-target / already-feeding / mover-refused), which is the part that matters.
 *
 * READ THE `why` BREAKDOWN BEFORE CONCLUDING ANYTHING. The first version of this probe
 * reported the share of immobile worms rising from 18.6% at crawlSpeed 0.375 to 75.7% at 8 and
 * I blamed the mover — wrongly. It reuses ONE colony across every spot and every speed, and the
 * worms EAT it as they go, so later speeds in the loop simply had less colony left to see.
 * Instrumenting showed every stuck worm was `no-target`: the mover was never even reached, and
 * the real bug was that worms seed beyond their own sight radius and had no search behaviour.
 *
 * If you use this to judge a mover change, rebuild the colony between spots first.
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
  const G=window.__game,s=G.state,sub=s.substrate,net=s.active,cs=sub.cellSize;
  s.clouds.length=0;
  net.energy=99999; net.water=999;
  // A decent colony to be seen.
  const nd=net.nodes[0], c0=sub.colAtX(nd.x), r0=sub.rowAtY(nd.y);
  const idx=[];
  for (let c=c0-6;c<=c0+6;c+=3) for (let r=r0;r<=r0+9;r+=3){
    if(!sub.inBounds(c,r)) continue; const cell=sub.cells[sub.index(c,r)];
    cell.rock=0; cell.hazard=0; idx.push(sub.index(c,r));
  }
  for (let i=0;i<14;i++){ for(const j of idx){const cl=sub.cells[j]; cl.nutrient=50; cl.maxNutrient=50;} G.performAction(s,'grow',{}); }
  const out={sight:s.config.nematodes.sightRadius/cs, reach:s.config.nematodes.reach};
  // Candidate worm spots: open ground with a strand in sight but out of reach.
  const spots=[];
  for (let y=sub.surfaceY+cs*2; y<sub.growFloorY-cs*2 && spots.length<140; y+=cs) {
    for (let x=cs*2; x<sub.worldWidth-cs*2 && spots.length<140; x+=cs) {
      // The COARSE cell.rock mask, because that is what moveWorm tests. Picking spots with
      // solidAtWorld (the fine mask) put candidates inside coarse rock, so the worm was
      // walled in before the mover was even asked.
      const c0c=sub.cellAtWorld(x,y);
      if (!c0c || c0c.rock) continue;
      let near=Infinity;
      for (const n of net.nodes) near=Math.min(near, Math.hypot(n.x-x, n.y-y));
      if (near > s.config.nematodes.reach*cs && near < s.config.nematodes.sightRadius) spots.push({x,y});
    }
  }
  out.spots=spots.length;
  for (const speed of [3, 8]) {
    s.config.nematodes.crawlSpeed=speed;
    let moved=0, still=0, sumMove=0;
    for (const sp of spots) {
      s.nematodes.length=0;
      s.nematodes.push({x:sp.x,y:sp.y,heading:0,phase:0,stuck:0,feedCd:0,hp:0,
                        sees:false,feeding:false,trailing:false,targetId:null});
      s.runOver=false; s.winPending=false; s.won=false; net.alive=true;
      G.tickWorld(s);
      const w=s.nematodes[0];
      const d=w?Math.hypot(w.x-sp.x,w.y-sp.y):0;
      if (d>0.5){moved++; sumMove+=d/cs;} else {still++;
        if (!w) sp._why='gone';
        else if (!w.sees) sp._why='no-target';
        else if (w.feeding) sp._why='already-feeding';
        else sp._why='mover-refused';
      }
    }
    const why={};
    for (const sp of spots) if (sp._why) { why[sp._why]=(why[sp._why]||0)+1; sp._why=null; }
    out['crawl'+speed]={moved, still, stuckPct:+(100*still/Math.max(1,spots.length)).toFixed(1),
                        avgMoveCells:+(sumMove/Math.max(1,moved)).toFixed(2), why};
  }
  return out;
}),null,1));
await b.close(); srv.close();
})();
