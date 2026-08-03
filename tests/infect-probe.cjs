/* HOW MUCH OF A COLONY DOES ONE CONTACT BREACH CLAIM?
 *
 *     node tests/infect-probe.cjs
 *
 * Written for a bug report: "I got infected and it immediately spread to almost all of my very
 * big colony." It prints numbers, not PASS/FAIL, and is not in the runner.
 *
 * It builds a BUSHY colony (a 40-node trunk with a 10-node branch off every trunk node, 440
 * strands) rather than the linear chain spread-probe uses, because the defect only exists on a
 * branching network: `infectDescendants` claims everything downstream of an infected strand in
 * one step, and "downstream" of a node near the base is the whole colony.
 *
 * The attribution is the point. Run with firstTouchRings at 0 and the ring spread contributes
 * NOTHING, so whatever still dies is the downstream claim alone. Measured:
 *
 *     contact at trunk 20/40 -> 220 of 440 (50%)   = exactly the subtree of trunk[20]
 *     contact at trunk 35/40 ->  55 of 440 (13%)   = exactly the subtree of trunk[35]
 *     contact at trunk  5/40 -> 440 of 440 (100%)
 *
 * Those first two match the subtree sizes to the strand, which is what identifies
 * infectDescendants as the mechanism rather than either of the rates.
 *
 * DO NOT READ THIS PROBE FOR ANYTHING GEOMETRIC. Its colony is hand-built at 4-UNIT spacing against
 * the game's real 25.5-unit segment, which is fine for a rule measured in graph RINGS (that is the
 * point — rings and strands stay comparable) and badly wrong for a rule measured in world units.
 * The breach disc (`firstTouchRadius`, 1.5 cells = 54 units) covers ~6 strands along a real filament
 * and ~27 along one of these, so this probe reports it claiming 42-94% of the colony and overstates
 * it by roughly an order of magnitude. `tests/breach-probe.cjs` grows a real colony for that.
 */
const http=require('http'),fs=require('fs'),path=require('path');
const {chromium}=require('playwright');
const ROOT='/home/user/myceliumRT';
const T={'.html':'text/html','.js':'text/javascript','.json':'application/json','.png':'image/png','.webp':'image/webp','.mp3':'audio/mpeg','.wav':'audio/wav'};
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
(async()=>{
const srv=await new Promise(r=>{const s=http.createServer((rq,rs)=>{let p=decodeURIComponent(rq.url.split('?')[0].split('#')[0]);if(p==='/')p='/index.html';const fp=path.join(ROOT,p);if(!fs.existsSync(fp)||fs.statSync(fp).isDirectory()){rs.writeHead(404);rs.end('nf');return;}rs.writeHead(200,{'Content-Type':T[path.extname(fp)]||'application/octet-stream'});fs.createReadStream(fp).pipe(rs);});s.listen(0,()=>r(s));});
const b=await chromium.launch({headless:true,executablePath:'/opt/pw-browsers/chromium'});
const ctx=await b.newContext({viewport:{width:1400,height:800}});
await ctx.addInitScript(()=>{window.MYCELIUM_SUPABASE={url:'',anonKey:''};});
const p=await ctx.newPage();
p.on('pageerror',e=>console.log('PAGEERROR:',String(e).slice(0,200)));
await p.goto('http://localhost:'+srv.address().port+'/index.html#dev,turn',{waitUntil:'domcontentloaded'});
await p.waitForSelector('#loadscreen.ld-ready',{timeout:60000}).catch(()=>{});
await p.click('#loadscreen',{timeout:5000}).catch(()=>{});
await p.waitForFunction(()=>window.__game&&window.__game.state&&window.__game.state.active,null,{timeout:60000}).catch(()=>{});
for(let i=0;i<6&&await p.$('#levelIntro');i++){await p.mouse.click(1100,300);await sleep(300);}
const R = await p.evaluate(()=>{
  const G=window.__game,s=G.state,sub=s.substrate,net=s.active,cs=sub.cellSize,t=s.config.trichoderma;
  s.nematodes.length=0;
  const TR=40, BR=10;
  const build=()=>{
    s.clouds.length=0;
    net.nodes.length=0; net.byId.clear(); net.nextNodeId=0;
    const x0=sub.worldWidth/2, y0=sub.surfaceY+cs*2;
    const trunk=[]; let par=net.addNode(x0,y0,null); par._liveAt=0; trunk.push(par);
    for(let i=1;i<TR;i++){ par=net.addNode(x0,y0+i*4,par); par._liveAt=0; trunk.push(par); }
    for(const tn of trunk){ let q=tn; for(let j=1;j<=BR;j++){ q=net.addNode(tn.x+j*4,tn.y,q); q._liveAt=0; } }
    // Clear the WHOLE field, not just the cells under the nodes. The trich a previous
    // iteration's cloud stamped, and the reinfect grace its infection left behind, both
    // persist in cells the new colony also occupies -- so sweeping several settings in one
    // run gave order-dependent numbers (the same case read 440, then 242, then 1).
    for(const c of sub.cells){ if(c){ c.trich=0; c.mouldProof=0; c.reinfectGrace=0; } }
    for(const n of net.nodes){ n.infected=false; n.rotAge=0; }
    net._spreadAccum=0;
    return trunk;
  };
  const N=()=>net.nodes.length;
  const inf=()=>net.nodes.filter(n=>n.infected).length;
  const rows=[];
  const life=t.rotLifeTurns; t.rotLifeTurns=999;      // don't let strands fall away mid-measure
  for (const ftr of [0, 4, 12]) {
    t.firstTouchRings=ftr;
    for (const k of [5, 20, 35]) {
      const trunk=build(); const total=N();
      const hit=trunk[k];
      s.clouds.push({cx:hit.x, cy:hit.y, r:0.4, strength:1, dying:false, heading:null});
      G.tickWorld(s);
      rows.push({firstTouchRings:ftr, contactAtTrunk:k+'/'+TR, of:total, infected:inf(), pct:Math.round(100*inf()/total)});
    }
  }
  t.rotLifeTurns=life; t.firstTouchRings=12;
  return {note:'trunk 40 x branch 10', spreadDepthPerTurn:t.spreadDepthPerTurn, rows};
});
console.log(JSON.stringify(R,null,1));
await b.close();srv.close();
})();
