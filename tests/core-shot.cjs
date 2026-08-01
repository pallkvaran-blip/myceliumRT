/* The core line — one whole-world frame of an authored map and a procedural one.
 *
 *     node tests/core-shot.cjs        -> tests/.artifacts/core-{traced,proc}.png
 *
 * Not a check; core-check.cjs asserts. This exists because every depth decision in this area
 * was made by LOOKING: the lava-lamp ramp, the mud-brown ramp, the pebbles, and the fact that
 * the owner measures depth against the whole scrollable underground rather than the content
 * box were all things a number could not have told us. It frames surface -> the very bottom
 * of the buffer, which is what is on screen, and prints the geometry beside the frame.
 */
const http=require('http'),fs=require('fs'),path=require('path');
const {chromium}=require('playwright');
const ROOT=path.resolve(__dirname,'..');
const OUT=path.join(__dirname,'.artifacts');
const T={'.html':'text/html','.js':'text/javascript','.json':'application/json','.png':'image/png','.webp':'image/webp','.mp3':'audio/mpeg','.wav':'audio/wav'};
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
(async()=>{
fs.mkdirSync(OUT,{recursive:true});
const srv=await new Promise(res=>{const s=http.createServer((rq,rs)=>{let p=decodeURIComponent(rq.url.split('?')[0].split('#')[0]);if(p==='/')p='/index.html';const fp=path.join(ROOT,p);if(!fp.startsWith(ROOT)||!fs.existsSync(fp)||fs.statSync(fp).isDirectory()){rs.writeHead(404);rs.end('nf');return;}rs.writeHead(200,{'Content-Type':T[path.extname(fp)]||'application/octet-stream'});fs.createReadStream(fp).pipe(rs);});s.listen(0,()=>res(s));});
const base='http://localhost:'+srv.address().port;
const b=await chromium.launch({headless:true,executablePath:'/opt/pw-browsers/chromium'});
const MAP=process.argv[2]||'slate-c40';
for (const [name, hash] of [['core-traced','#level,'+MAP], ['core-proc','#dev,turn']]) {
  const ctx=await b.newContext({viewport:{width:1500,height:850},deviceScaleFactor:2});
  await ctx.addInitScript(()=>{window.MYCELIUM_SUPABASE={url:'',anonKey:''};});
  const p=await ctx.newPage();
  p.on('pageerror',e=>console.log('PAGEERROR:',String(e.stack||e).slice(0,300)));
  await p.goto(base+'/index.html'+hash,{waitUntil:'domcontentloaded'});
  await p.waitForSelector('#loadscreen.ld-ready',{timeout:60000}).catch(()=>{});
  await p.click('#loadscreen',{timeout:5000}).catch(()=>{});
  await p.waitForFunction(()=>window.__game&&window.__game.state&&window.__game.state.active,null,{timeout:30000});
  await p.waitForFunction(()=>window.__game.state.substrate._rockSolidified===true,null,{timeout:90000}).catch(()=>{});
  for(let i=0;i<6&&await p.$('#levelIntro');i++){await p.mouse.click(1100,300);await sleep(400);}
  const info=await p.evaluate(()=>{const s=window.__game.state.substrate;
    return {surfaceY:s.surfaceY, coreY:s.coreY, growFloorY:s.growFloorY, worldHeight:s.worldHeight};});
  console.log(name, JSON.stringify(info));
  // Whole world, surface to a little past the core.
  // The WHOLE scrollable underground: surface to the very bottom of the buffer, which is what
  // the owner measures on screen.
  await p.evaluate(()=>{const g=window.__game,s=g.state.substrate;
    const top=s.surfaceY-60, bot=s.viewHeight;
    g.camera.zoom=Math.min(1500/s.worldWidth, 850/(bot-top))*0.98;
    g.camera.x=s.worldWidth/2; g.camera.y=(top+bot)/2; g.camera.clamp();});
  await sleep(900);
  await p.screenshot({path:path.join(OUT,name+'.png'),timeout:60000,animations:'disabled'});
  await ctx.close();
}
await b.close();srv.close();
})();
