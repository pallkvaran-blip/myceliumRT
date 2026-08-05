/* SPECIES SPECIALS that the player fires — Fly Agaric's Berserk and Blue Bonnet's Toxic Burst.
 *
 *   node tests/special-check.cjs
 *
 * Both are "once per level, tap a point", and both go through the ordinary installed-action
 * framework rather than a mechanism of their own. What that framework was missing is the CLOCK:
 * `per` is per ROUND (produceCardEngines zeroes `used` on every round boundary), so a special
 * written with `per: 1` would come back every round and be worth roughly ten times what it says.
 * Hence `perLevel` / `usedLevel`, cleared only by applyCarry on the step onto a new map.
 *
 * So "once per level" needs BOTH halves asserted and neither is enough alone:
 *   - a second use on the same level is refused, and forty more actions do not hand it back
 *     (a per-round counter passes the first and fails the second);
 *   - and the use is RENEWED on the next level (a never-resetting counter passes the first two
 *     and fails this one).
 *
 * Two traps this cost:
 *   - `activateAction` is not on `__game`, and `play()` cannot reach a special — it is an action,
 *     not a card. Hence the `__game.activate(i, ctx)` hook, called twice like the UI does: no ctx
 *     arms it, {x,y} resolves it.
 *   - `winLevel()` only PUTS THE LEVEL-COMPLETE SCREEN UP. The advance is deferred to its Proceed
 *     button, with the "species unlocked" card sometimes in front, so a probe that merely waits
 *     reads `level 1 -> 1` and never measures the renewal at all.
 */
const http=require('http'),fs=require('fs'),path=require('path');
const {chromium}=require('playwright');
const ROOT='/home/user/myceliumRT';
const T={'.html':'text/html; charset=utf-8','.js':'text/javascript','.json':'application/json','.png':'image/png','.jpg':'image/jpeg','.svg':'image/svg+xml','.webp':'image/webp','.mp3':'audio/mpeg','.wav':'audio/wav'};
let pass=0,fail=0;
const ok=(n,c,x)=>{c?(pass++,console.log('  PASS  '+n+(x?'  — '+x:''))):(fail++,console.log('  FAIL  '+n+(x?'  — '+x:'')));};
(async()=>{
 const srv=await new Promise(r=>{const s=http.createServer((rq,rs)=>{let p=decodeURIComponent(rq.url.split('?')[0].split('#')[0]);if(p==='/')p='/index.html';const fp=path.join(ROOT,p);if(!fp.startsWith(ROOT)||!fs.existsSync(fp)||fs.statSync(fp).isDirectory()){rs.writeHead(404);rs.end('nf');return;}rs.writeHead(200,{'Content-Type':T[path.extname(fp)]||'application/octet-stream'});fs.createReadStream(fp).pipe(rs);});s.listen(0,()=>r(s));});
 const base='http://localhost:'+srv.address().port;
 const b=await chromium.launch({headless:true,executablePath:'/opt/pw-browsers/chromium'});
 for (const [id,name,special] of [['amanita','Berserk','berserk'],['pruinomycena','Toxic Burst','toxic']]) {
  console.log(`\n  ── ${id} (${name}) ──`);
  const page=await b.newPage({viewport:{width:1400,height:900}});
  const errs=[]; page.on('pageerror',e=>errs.push(String(e&&e.message)));
  await page.addInitScript(()=>{window.MYCELIUM_SUPABASE={url:'',anonKey:''};});
  await page.goto(base+'/index.html#dev,turn',{waitUntil:'domcontentloaded'});
  await page.waitForSelector('#loadscreen.ld-ready',{timeout:60000}).catch(()=>{});
  await page.click('#loadscreen',{timeout:5000}).catch(()=>{});
  await page.waitForFunction(()=>window.__game&&window.__game.campaign,null,{timeout:40000});
  const r=await page.evaluate(async(args)=>{
    const [id,name]=args;
    const g=window.__game;
    g.store.reset(); g.store.credit(20000);
    const buy=g.store.buySpecies(g.store.speciesById(id));
    const playable=g.store.playable(g.store.speciesById(id));
    g.campaign.play(id, 1);
    await new Promise(r=>setTimeout(r,900));
    const s=g.state, C=s.cards, net=s.active;
    const act=(C.actions||[]).find(a=>a.name===name);
    const out={bought:!!(buy&&buy.ok), playable, installed:!!act,
               perLevel:act&&act.perLevel, usedLevel:act&&act.usedLevel, target:act&&act.target,
               isCard:!!(g.cardData? g.cardData.some(c=>c.name===name):false)};
    if(!act) return out;
    const idx=(C.actions||[]).indexOf(act);
    // grow a bit so there is tissue to cut / worms to reach
    net.energy=99999; net.water=999; net.phosphorus=99;
    for(let i=0;i<6;i++){ g.performAction(s,'grow',{}); await new Promise(r=>setTimeout(r,60)); }
    out.strandsBefore=net.nodes.length;
    // arming: the first call must ask for a target and change nothing
    const armed=g.activate ? g.activate(idx) : null;
    out.armAsksTarget = armed ? !!armed.needTarget : null;
    // fire it at our own frontier (berserk) / at a worm we place (toxic)
    let pt;
    if(name==='Toxic Burst'){
      const fp=net.frontierPoint();
      s.nematodes=[]; for(let i=0;i<9;i++) s.nematodes.push({x:fp.x+i*3,y:fp.y+i*2,hp:3,heading:0});
      out.wormsBefore=s.nematodes.length; out.pBefore=Math.floor(net.phosphorus);
      pt=fp;
    } else { pt=net.frontierPoint(); }
    const res1=g.activate(idx,{x:pt.x,y:pt.y});
    out.fired=!!(res1&&res1.ok); out.msg1=(res1&&res1.message)||'';
    out.usedAfter=act.usedLevel;
    if(name==='Toxic Burst'){ out.wormsAfter=s.nematodes.length; out.pAfter=Math.floor(net.phosphorus); }
    else { out.strandsAfter=net.nodes.length; }
    // and a SECOND use in the same level must be refused
    const res2=g.activate(idx,{x:pt.x,y:pt.y});
    out.secondOk=!!(res2&&res2.ok); out.msg2=(res2&&res2.message)||'';
    // a round boundary must NOT hand it back
    for(let i=0;i<Math.max(2,(s.config.cards.roundSeconds?1:1));i++){}
    const before=act.usedLevel;
    for(let i=0;i<40;i++){ g.performAction(s,'grow',{}); }
    out.usedAfterRounds=act.usedLevel; out.roundsHeld=(act.usedLevel>=1);
    out.round=C.round;
    // ...AND IT COMES BACK ON THE NEXT LEVEL, which is the other half of "once per level" and the
    // half a per-round counter would also satisfy. Win the level and look again — the ability object
    // survives the transition (applyCarry carries `cards` whole), so this is the same object.
    out.lvlBefore=g.campaign.level();
    // winLevel() only puts the level-complete screen up — the level advance is DEFERRED to its
    // Proceed button (and the "species unlocked" card can sit in front of it), so a probe that just
    // waits reads `level 1 -> 1` and the renewal it wanted to measure never happened.
    if (g.winLevel) {
      g.winLevel();
      for (let i=0;i<90;i++){
        const b=document.getElementById('ssWinProceed')||document.getElementById('ssUnlockProceed');
        if (b) { b.click(); }
        if (g.campaign.level()>out.lvlBefore) break;
        await new Promise(r=>setTimeout(r,200));
      }
      await new Promise(r=>setTimeout(r,600));
    }
    const C2=g.state.cards;
    const act2=(C2.actions||[]).find(a=>a.name===name);
    out.lvlAfter=g.campaign.level();
    out.stillThere=!!act2; out.usedNextLevel=act2?act2.usedLevel:null;
    return out;
  },[id,name]);
  ok(`${id}: buying it for 500 works and makes it playable`, r.bought && r.playable, `bought=${r.bought} playable=${r.playable}`);
  ok(`${id}: the special is installed in the Actions menu`, r.installed===true);
  ok(`${id}: it is once per LEVEL, not per round`, r.perLevel===1, `perLevel=${r.perLevel}`);
  ok(`${id}: it needs a target — the Use button arms rather than firing`, r.armAsksTarget===true);
  ok(`${id}: firing it works`, r.fired===true, r.msg1);
  if(name==='Berserk') ok(`${id}: Berserk cut strands away`, r.strandsAfter < r.strandsBefore, `${r.strandsBefore} -> ${r.strandsAfter} strands`);
  else { ok(`${id}: Toxic Burst digested the worms`, r.wormsAfter < r.wormsBefore, `${r.wormsBefore} -> ${r.wormsAfter} worms`);
         ok(`${id}: ...and paid Phosphorus, capped at 7`, r.pAfter-r.pBefore>0 && r.pAfter-r.pBefore<=7, `+${r.pAfter-r.pBefore} P from ${r.wormsBefore} worms (cap 7)`); }
  ok(`${id}: a second use on the same level is refused`, r.secondOk===false, r.msg2);
  ok(`${id}: and 40 more actions do not hand it back`, r.roundsHeld===true, `usedLevel ${r.usedAfterRounds} at round ${r.round}`);
  ok(`${id}: the ability survives the step onto the next level`, r.stillThere===true, `level ${r.lvlBefore} -> ${r.lvlAfter}`);
  ok(`${id}: ...and its once-per-level use is RENEWED there`, r.usedNextLevel===0,
     `usedLevel ${r.usedAfterRounds} on level ${r.lvlBefore} -> ${r.usedNextLevel} on level ${r.lvlAfter}`);
  ok(`${id}: no page errors`, errs.length===0, errs.slice(0,2).join(' | ')||'none');
  await page.close();
 }
 await b.close(); srv.close();
 console.log(`\n==== ${pass} passed, ${fail} failed ====`);   // the runner parses THIS form
 process.exit(fail?1:0);
})();
