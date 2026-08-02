/* Focused check: HUD refreshes must not re-create the hovered card / pill rows. */
const http=require('http'),fs=require('fs'),path=require('path');const {chromium}=require('playwright');
const ROOT = path.resolve(__dirname, '..');   // the repo root — served as-is
const T={'.html':'text/html','.js':'text/javascript','.json':'application/json','.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.svg':'image/svg+xml','.webp':'image/webp','.mp3':'audio/mpeg','.wav':'audio/wav','.css':'text/css'};
const sleep=(ms)=>new Promise(r=>setTimeout(r,ms));
(async()=>{
  const srv=await new Promise(res=>{const s=http.createServer((rq,rs)=>{let p=decodeURIComponent(rq.url.split('?')[0].split('#')[0]);if(p==='/')p='/index.html';const fp=path.join(ROOT,p);
    if(!fp.startsWith(ROOT)||!fs.existsSync(fp)||fs.statSync(fp).isDirectory()){rs.writeHead(404);rs.end('nf');return;}
    rs.writeHead(200,{'Content-Type':T[path.extname(fp)]||'application/octet-stream'});fs.createReadStream(fp).pipe(rs);});s.listen(0,()=>res(s));});
  const base='http://localhost:'+srv.address().port;
  const browser=await chromium.launch({headless:true});const page=await browser.newPage();
  await page.goto(base+'/index.html#dev',{waitUntil:'domcontentloaded'});
  await page.waitForSelector('#loadscreen.ld-ready',{timeout:15000}).catch(()=>{});
  await page.click('#loadscreen',{timeout:5000}).catch(()=>{});
  await page.waitForFunction(()=>window.__game&&window.__game.state&&window.__game.state.active,null,{timeout:15000});
  for(let i=0;i<3&&await page.$('#levelIntro');i++){await page.mouse.click(400,300);await sleep(2000);}
  let pass=0,fail=0;const ok=(n,c,x)=>{c?(pass++,console.log('  PASS  '+n+(x?'  — '+x:''))):(fail++,console.log('  FAIL  '+n+(x?'  — '+x:'')));};
  const res=await page.evaluate(async()=>{
    const g=window.__game,st=g.state,net=st.active;
    st.runOver=false;st.winPending=false;st.won=false;net.alive=true;
    net.energy=1e6;net.water=999;net.phosphorus=999;st.clouds=[];st.nematodes=[];st.cards.pendingOffers.length=0;
    st.cards.hand.length=0;st.cards.hand.push({id:st.cards.seq++,name:'Apical Drive'});
    // an installed engine so the ledger pill has a row with a cadence bar
    st.cards.engines=[{name:'Aquifer Tap',water:2,every:6,_et:1}];
    const raf1=()=>new Promise(r=>requestAnimationFrame(r));
    // WAIT FOR A RENDER, NOT FOR A FRAME. The HUD is refreshed inside renderFrame, and the
    // frame loop PACES an idle board to IDLE_FPS — so a requestAnimationFrame callback is not a
    // promise that anything was drawn. While frames cost ~500 ms every rAF rendered and two of
    // them were plenty; once frames got cheap, both callbacks of a raf2() landed inside the same
    // 30fps window, nothing rendered, ui.update() never ran, and the probe captured DOM from
    // before its own mutations — the handlist still held the dev carousel's 61 cards. It then
    // reported the HUD as re-creating the hovered card, which is the opposite of what happened.
    // paceInfo().renders is the render counter, so this waits on the thing that matters.
    const raf2=async(n=1)=>{
      const r0=g.paceInfo().renders;
      for (let i=0;i<600 && g.paceInfo().renders<r0+n;i++) await raf1();
    };
    // SETTLE THE HUD ON THE NEW HAND BEFORE CAPTURING ANYTHING, and capture nothing until it
    // has. The lines above replace the hand and install an engine; until the HUD catches up,
    // `.handlist` still holds the dev carousel's 61 cards, so a card captured then is from
    // BEFORE the mutation and the first real refresh replaces it — which the assertions below
    // would report as the HUD re-creating the hovered card, the exact opposite of the truth.
    // Drive ticks until the HUD actually SHOWS the new hand and the engine row, rather than
    // assuming some number of frames or ticks gets there. In REAL TIME the HUD rebuilds when a
    // world tick marks it dirty, and a tick comes from the wall clock — which a slow frame
    // supplied for free (one ~500 ms frame always spanned a 500 ms step) and a fast one does
    // not. Waiting on the DOM condition is the only form of this that does not encode a frame
    // cost. Bounded, so a genuine HUD break fails the assertions below instead of hanging.
    const settled=await (async()=>{
      for (let i=0;i<400;i++){
        const hl=document.querySelector('.handlist');
        const cb=document.querySelector('.engledger .cbar[data-cadkey]');
        if (hl && hl.children.length===st.cards.hand.length && cb && cb.firstElementChild) return true;
        st.runOver=false;st.winPending=false;net.alive=true;g.tickWorld(st);
        await raf1();
      }
      return false;
    })();
    const list=document.querySelector('.handlist');
    const card=list&&list.firstElementChild;
    const bar=document.querySelector('.engledger .cbar[data-cadkey]');
    const fill=bar&&bar.firstElementChild;
    if(!card)return{noCard:true};
    // Start the round clock from zero so the fill can only climb over the probe (it resets
    // once a full round elapses, and 5 ticks is far short of that).
    st.cards._engTick=0;
    await raf2();
    const fill0=fill?fill.style.width:'n/a';
    const trans=fill?getComputedStyle(fill).transitionDuration:'n/a';
    // LET REAL TIME PASS. This is a REAL-TIME probe and the round clock is a slice of wall
    // clock, so the bar can only fill if the wall clock moves. It used to get that for free:
    // one tickWorld per rAF pair, plus ~15 more ticks from the sim advancing while it waited
    // on ~500 ms frames. So the probe's tick count was really a measure of frame cost, and
    // when frames got ~6x cheaper it collected 6 ticks instead of 20 and the bar sat still.
    // Calling tickWorld directly is not a substitute — it advances the sim but never marks the
    // HUD dirty, so the model moves and the DOM does not. Sleeping drives the real loop, which
    // ticks, marks dirty and refreshes, exactly as it does for a player.
    const t0=st.turn;let refreshed=0;
    for(let i=0;i<5;i++){
      await new Promise(r=>setTimeout(r,1100));
      await raf2();refreshed++;
    }
    return{refreshed,ticks:st.turn-t0,settled,
      cardSame:document.contains(card)&&document.querySelector('.handlist').firstElementChild===card,
      barSame:!!fill&&document.contains(fill),
      fill0,trans,fillPct:fill?fill.style.width:'n/a'};
  });
  ok('the HUD caught up with the probe\'s hand before anything was captured',
     !res.noCard&&res.settled===true,
     res.noCard?'no card':`settled: ${res.settled}`);
  ok('the world actually advanced during the probe',!res.noCard&&res.ticks>=4,`${res.ticks} ticks over ${res.refreshed} HUD refreshes`);
  ok('the hovered card element is NOT re-created by HUD refreshes',!res.noCard&&res.cardSame,`same element: ${res.cardSame}`);
  ok('the ledger cadence bar element is NOT re-created either',!res.noCard&&res.barSame,`same element: ${res.barSame}, fill ${res.fillPct}`);
  ok('the bar FILLS as the round clock advances',!res.noCard&&parseFloat(res.fillPct)>parseFloat(res.fill0),`fill ${res.fill0} → ${res.fillPct}`);
  ok('the fill GLIDES (a CSS transition) rather than jumping',!res.noCard&&parseFloat(res.trans)>0,`transition-duration ${res.trans}`);
  console.log(`\n==== ${pass} passed, ${fail} failed ====`);
  await browser.close();srv.close();process.exit(fail?1:0);
})().catch(e=>{console.error('HARNESS ERROR',e);process.exit(2);});
