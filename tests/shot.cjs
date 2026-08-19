const http=require('http'),fs=require('fs'),path=require('path');const {chromium}=require('playwright');
const ROOT = path.resolve(__dirname, '..');   // the repo root — served as-is
const T={'.html':'text/html','.js':'text/javascript','.json':'application/json','.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.svg':'image/svg+xml','.webp':'image/webp','.mp3':'audio/mpeg','.wav':'audio/wav'};
const sleep=(ms)=>new Promise(r=>setTimeout(r,ms));
(async()=>{
  const srv=await new Promise(res=>{const s=http.createServer((rq,rs)=>{let p=decodeURIComponent(rq.url.split('?')[0].split('#')[0]);if(p==='/')p='/index.html';const fp=path.join(ROOT,p);if(!fp.startsWith(ROOT)||!fs.existsSync(fp)||fs.statSync(fp).isDirectory()){rs.writeHead(404);rs.end('nf');return;}rs.writeHead(200,{'Content-Type':T[path.extname(fp)]||'application/octet-stream'});fs.createReadStream(fp).pipe(rs);});s.listen(0,()=>res(s));});
  const base='http://localhost:'+srv.address().port;
  const browser=await chromium.launch({headless:true});
  for (const [w,h,tag] of [[1440,900,'wide'],[1024,700,'mid'],[390,844,'phone']]) {
    const page=await browser.newPage({viewport:{width:w,height:h}});
    await page.goto(base+'/index.html',{waitUntil:'domcontentloaded'});
    await page.waitForSelector('#loadscreen.ld-ready',{timeout:20000}).catch(()=>{});
    await page.click('#loadscreen',{timeout:5000}).catch(()=>{});
    // `.ts-actions` — the row itself, which every title layout has. It used to wait on
    // `.ts-split`, the four-button Survival row, which has not shipped since OFFER_REALTIME went
    // off: this tool has been timing out for releases rather than capturing anything.
    await page.waitForSelector('#titleScreen .ts-actions',{timeout:20000});
    await sleep(4500);
    await page.screenshot({path:`title-${tag}.png`});
    await page.close();
  }
  await browser.close();srv.close();console.log('shot');
})();
