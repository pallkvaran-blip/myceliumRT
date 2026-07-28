const http=require('http'),fs=require('fs'),path=require('path');const {chromium}=require('playwright');
const ROOT = path.resolve(__dirname, '..');   // the repo root — served as-is
const T={'.html':'text/html','.js':'text/javascript','.json':'application/json','.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.svg':'image/svg+xml','.webp':'image/webp','.mp3':'audio/mpeg','.wav':'audio/wav'};
const sleep=(ms)=>new Promise(r=>setTimeout(r,ms));
(async()=>{
  const srv=await new Promise(res=>{const s=http.createServer((rq,rs)=>{let p=decodeURIComponent(rq.url.split('?')[0].split('#')[0]);if(p==='/')p='/index.html';const fp=path.join(ROOT,p);if(!fp.startsWith(ROOT)||!fs.existsSync(fp)||fs.statSync(fp).isDirectory()){rs.writeHead(404);rs.end('nf');return;}rs.writeHead(200,{'Content-Type':T[path.extname(fp)]||'application/octet-stream'});fs.createReadStream(fp).pipe(rs);});s.listen(0,()=>res(s));});
  const base='http://localhost:'+srv.address().port;
  const browser=await chromium.launch({headless:true});
  const page=await browser.newPage({viewport:{width:1280,height:900}});
  await page.addInitScript(()=>{window.MYCELIUM_SUPABASE={url:'',anonKey:''};});
  await page.goto(base+'/index.html#dev',{waitUntil:'domcontentloaded'});
  await page.waitForSelector('#loadscreen.ld-ready',{timeout:20000}).catch(()=>{});
  await page.click('#loadscreen',{timeout:5000}).catch(()=>{});
  await page.waitForFunction(()=>window.__game&&window.__game.state&&window.__game.state.active,null,{timeout:20000});
  for(let i=0;i<4&&await page.$('#levelIntro');i++){await page.mouse.click(640,400);await sleep(1200);}
  await page.evaluate(()=>{
    const hs=window.__game.scores;
    localStorage.removeItem('mycelium.highscores.v1');
    const names=['Mycia','Fungo','Spore','Hypha','Ruderal'];
    names.forEach((n,i)=>hs.recordScore({name:n,level:11-i*2,species:'a',speciesName:'Ashen Veil',mode:'realtime'}));
    ['Oldtimer','Turnip'].forEach((n,i)=>hs.recordScore({name:n,level:8-i,species:'b',speciesName:'Duff Weaver',mode:'turn'}));
  });
  await page.evaluate(()=>window.__game.showHighScores({mode:'realtime'}));
  await sleep(5000);
  await page.screenshot({path: path.join(__dirname, '.artifacts', 'hs-rt.png')});
  await page.click('#hsTabTurn'); await sleep(600);
  await page.screenshot({path: path.join(__dirname, '.artifacts', 'hs-turn.png')});
  await browser.close();srv.close();console.log('shot');
})();
