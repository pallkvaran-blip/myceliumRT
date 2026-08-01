/* WALL-HOP PROBE — how often a growth step passes the ENDPOINT test while crossing rock.
 *
 *     node tests/hop-probe.cjs
 *
 * Not a check: it prints numbers. Sweeps every open point on a 9-unit grid, 16 headings, over
 * three traced maps, and counts steps that _placeOk accepts but _segmentClear rejects.
 *
 * This is the tool that justified routing _growStep through _segmentClear: of the steps the
 * endpoint test accepted, 0.17-0.25% crossed rock at the old 17-unit segment and 0.42-0.58% at
 * 25.5, so lengthening the step widened a hole that was already open. Re-run it if the segment
 * length or the collision sampling changes.
 */
const http=require('http'),fs=require('fs'),path=require('path');
const {chromium}=require('playwright');
const ROOT='/home/user/myceliumRT';
const T={'.html':'text/html','.js':'text/javascript','.json':'application/json','.png':'image/png','.webp':'image/webp','.mp3':'audio/mpeg','.wav':'audio/wav'};
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const MAPS=['slate-c40','obsidian-c55','side-veined-c28'];
(async()=>{
const srv=await new Promise(res=>{const s=http.createServer((rq,rs)=>{let p=decodeURIComponent(rq.url.split('?')[0].split('#')[0]);if(p==='/')p='/index.html';const fp=path.join(ROOT,p);if(!fp.startsWith(ROOT)||!fs.existsSync(fp)||fs.statSync(fp).isDirectory()){rs.writeHead(404);rs.end('nf');return;}rs.writeHead(200,{'Content-Type':T[path.extname(fp)]||'application/octet-stream'});fs.createReadStream(fp).pipe(rs);});s.listen(0,()=>res(s));});
const base='http://localhost:'+srv.address().port;
const b=await chromium.launch({headless:true,executablePath:'/opt/pw-browsers/chromium'});
for (const MAP of MAPS) {
  const ctx=await b.newContext({viewport:{width:1400,height:800}});
  await ctx.addInitScript(()=>{window.MYCELIUM_SUPABASE={url:'',anonKey:''};});
  const p=await ctx.newPage();
  p.on('pageerror',e=>console.log('PAGEERROR:',String(e.stack||e).slice(0,200)));
  await p.goto(base+'/index.html#level,'+MAP,{waitUntil:'domcontentloaded'});
  await p.waitForSelector('#loadscreen.ld-ready',{timeout:60000}).catch(()=>{});
  await p.click('#loadscreen',{timeout:5000}).catch(()=>{});
  await p.waitForFunction(()=>window.__game&&window.__game.state&&window.__game.state.active,null,{timeout:60000}).catch(()=>{});
  await p.waitForFunction(()=>window.__game.state.substrate._rockSolidified===true,null,{timeout:90000}).catch(()=>{});
  for(let i=0;i<6&&await p.$('#levelIntro');i++){await p.mouse.click(1100,300);await sleep(400);}
  const r=await p.evaluate(()=>{
    const s=window.__game.state, sub=s.substrate, net=s.active;
    const scale=s.config.growth.scale;
    const out={};
    for (const seg of [17, 25.5]) {
      let tried=0, epOk=0, hop=0;
      for (let y=sub.surfaceY+8; y<sub.growFloorY-8; y+=9) {
        for (let x=8; x<sub.worldWidth-8; x+=9) {
          if (sub.solidAtWorld(x,y)) continue;              // a tip can only stand in open ground
          for (let k=0;k<16;k++) {
            const a=k*Math.PI/8;
            const nx=x+Math.cos(a)*seg, ny=y+Math.sin(a)*seg;
            tried++;
            if (!net._placeOk(sub,nx,ny)) continue;          // what _growStep actually tests
            epOk++;
            if (!net._segmentClear(sub,x,y,nx,ny)) hop++;    // ... but the line crosses rock
          }
        }
      }
      out['seg'+seg]={tried,epOk,hop,pct:+(100*hop/Math.max(1,epOk)).toFixed(3)};
    }
    out.scale=scale;
    return out;
  });
  console.log(MAP, JSON.stringify(r));
  await ctx.close();
}
await b.close(); srv.close();
})();
