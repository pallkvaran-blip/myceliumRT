const http=require('http'),fs=require('fs'),path=require('path');const {chromium}=require('playwright');
const ROOT = path.resolve(__dirname, '..');   // the repo root — served as-is
const T={'.html':'text/html','.js':'text/javascript','.json':'application/json','.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.svg':'image/svg+xml','.webp':'image/webp','.mp3':'audio/mpeg','.wav':'audio/wav'};
const sleep=(ms)=>new Promise(r=>setTimeout(r,ms));
(async()=>{
  const srv=await new Promise(res=>{const s=http.createServer((rq,rs)=>{let p=decodeURIComponent(rq.url.split('?')[0].split('#')[0]);if(p==='/')p='/index.html';const fp=path.join(ROOT,p);if(!fp.startsWith(ROOT)||!fs.existsSync(fp)||fs.statSync(fp).isDirectory()){rs.writeHead(404);rs.end('nf');return;}rs.writeHead(200,{'Content-Type':T[path.extname(fp)]||'application/octet-stream'});fs.createReadStream(fp).pipe(rs);});s.listen(0,()=>res(s));});
  const base='http://localhost:'+srv.address().port;
  const browser=await chromium.launch({headless:true});
  const page=await browser.newPage({viewport:{width:1440,height:900}});
  await page.goto(base+'/index.html',{waitUntil:'domcontentloaded'});
  await page.waitForSelector('#loadscreen.ld-ready',{timeout:20000}).catch(()=>{});
  await page.click('#loadscreen',{timeout:5000}).catch(()=>{});
  await page.waitForSelector('#titleScreen .ts-split',{timeout:20000});
  await sleep(6500);
  // Park low-left, then drift to a second spot so we see both a long reach and a re-arm.
  await page.mouse.move(430, 760); await sleep(16000);
  await page.screenshot({path: path.join(__dirname, '.artifacts', 'lure-long.png')});
  await page.mouse.move(1080, 700); await sleep(14000);
  await page.screenshot({path: path.join(__dirname, '.artifacts', 'lure-two.png')});
  console.log(JSON.stringify(await page.evaluate(()=>window.__tsLure())));
  await browser.close();srv.close();
})();
