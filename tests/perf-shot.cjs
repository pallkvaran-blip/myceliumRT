/* One deterministic frame, for eyeballing the leaf/rock render changes. */
const http=require('http'),fs=require('fs'),path=require('path');
const {chromium}=require('playwright');
const ROOT='/home/user/myceliumRT';
const OUT=process.argv[2];
const T={'.html':'text/html','.js':'text/javascript','.json':'application/json','.png':'image/png','.webp':'image/webp','.mp3':'audio/mpeg','.wav':'audio/wav'};
(async()=>{
const srv=http.createServer((rq,rs)=>{
  const u=decodeURIComponent(rq.url.split('?')[0]);
  const f=path.join(ROOT,u==='/'?'index.html':u);
  fs.readFile(f,(e,d)=>{ if(e){rs.writeHead(404);rs.end();return;}
    rs.writeHead(200,{'Content-Type':T[path.extname(f)]||'application/octet-stream'}); rs.end(d); });
}).listen(0);
const base='http://127.0.0.1:'+srv.address().port;
const b=await chromium.launch({executablePath:'/opt/pw-browsers/chromium'});
const ctx=await b.newContext({viewport:{width:1280,height:720},deviceScaleFactor:2});
await ctx.addInitScript(()=>{
  window.MYCELIUM_SUPABASE={url:'',anonKey:''};
  const realNow=Date.now; Date.now=()=>1717171717171;
  const free=()=>{ if(window.__game&&window.__game.state){Date.now=realNow;return;} setTimeout(free,10); };
  setTimeout(free,10);
});
const p=await ctx.newPage();
await p.goto(base+'/index.html#dev,turn',{waitUntil:'domcontentloaded'});
await p.waitForSelector('#loadscreen.ld-ready',{timeout:60000}).catch(()=>{});
await p.click('#loadscreen',{timeout:5000}).catch(()=>{});
await p.waitForFunction(()=>window.__game&&window.__game.state&&window.__game.state.active,null,{timeout:60000});
for(let i=0;i<6&&await p.$('#levelIntro');i++){await p.mouse.click(1100,300);await p.waitForTimeout(400);}
await p.waitForTimeout(1200);
await p.evaluate(()=>{
  const G=window.__game,s=G.state,net=s.active,sub=s.substrate;
  net.energy=1e9; net.water=1e9;
  for(let i=0;i<40;i++){ for(const c of sub.cells) if(c.nutrient>0) c.nutrient=Math.max(c.nutrient,20);
    s.runOver=false;s.winPending=false;s.won=false;net.alive=true; G.performAction(s,'grow',{}); }
  G.settleEnemyTurn();
  G.renderFrame(performance.now(),1);
});
// The CANVAS, not the page. page.screenshot waits for fonts and animations to settle, and
// against a live rAF loop that wait has no end — the baseline build, at ~520ms a frame, kept
// the rasteriser busy enough that it never returned. toDataURL is synchronous and cannot hang.
console.log('rockface:', JSON.stringify(await p.evaluate(()=>{const r=window.__game.state.rockface; return r?{done:!!r.done}:null;})));

console.log('RF', JSON.stringify(await p.evaluate(()=>{
  const G=window.__game, st=G.state, rf=st.rockface;
  const C=CanvasRenderingContext2D.prototype, real=C.drawImage;
  const near=[];
  let total=0;
  C.drawImage=function(img,...a){
    total++;
    let dx,dy,dw,dh;
    if (a.length>=8){dx=a[4];dy=a[5];dw=a[6];dh=a[7];}
    else if (a.length>=4){dx=a[0];dy=a[1];dw=a[2];dh=a[3];}
    else {dx=a[0];dy=a[1];dw=img.width;dh=img.height;}
    const st2=(new Error().stack||'').split('\n');
    let who='?'; for(let i=1;i<st2.length;i++){ if(!/drawImage/.test(st2[i])){who=st2[i].trim().replace(/^at\s+/,'').replace(/\s*\(.*$/,'');break;} }
    if (dx!=null && dx<720 && dx+dw>640 && dy<360 && dy+dh>280) near.push({who,dx:Math.round(dx),dy:Math.round(dy),dw:Math.round(dw),dh:Math.round(dh)});
    return real.apply(this,[img,...a]);
  };
  G.renderFrame(performance.now(),1);
  C.drawImage=real;
  const scr = rf ? G.camera.worldToScreen(rf.x, rf.y) : null;
  return { rf: rf?{x:Math.round(rf.x),y:Math.round(rf.y),done:!!rf.done}:null,
           screen: scr?{x:Math.round(scr.x),y:Math.round(scr.y)}:null, total, near };
})));
const durl=await p.evaluate(()=>document.querySelector('canvas').toDataURL('image/png'));
fs.writeFileSync(OUT, Buffer.from(durl.split(',')[1],'base64'));
await b.close(); srv.close();
})();
