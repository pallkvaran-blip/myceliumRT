/* THREAT RATES — the four numbers that say how fast a threat takes your colony apart.
 *
 *     node tests/threat-check.cjs
 *
 * Config assertions alone would be worthless here: every one of these numbers is set in TWO
 * places (the CONFIG literal and MODE_TUNING's per-mode table), read through a deep clone,
 * and — for the worm's bite — consumed by code that used to have the value hard-coded. So
 * each one is driven through the real sim and MEASURED:
 *
 *   trichoderma.moveSpeed      cells a cloud creeps per step        (x2)
 *   nematodes.crawlSpeed       cells a worm crawls per step         (x2, then x1.33)
 *   nematodes.strandsPerBite   strands one worm eats per bite       (1 hard-coded → 2 → 4)
 *   trichoderma.spreadDepthPerTurn  rings the rot races per step    (x3)
 *
 * BOTH MODES, always. The two tables are the same rule in different units — RT rates are per
 * 500 ms tick, turn-based rates are per player action — so a change applied to one table only
 * does not make the creature faster, it makes one of the two games harder. That is the single
 * easiest mistake to make in this file and it is invisible from inside either mode.
 *
 * The measurements are all in TURN-BASED, where one action is exactly one world step and
 * nothing moves in between. In real time the same code runs off the wall clock, which headless
 * throttles — so RT is asserted on its CONFIG and turn-based on its BEHAVIOUR.
 */
const http=require('http'),fs=require('fs'),path=require('path');
const {chromium}=require('playwright');
const ROOT=path.resolve(__dirname,'..');
const T={'.html':'text/html','.js':'text/javascript','.json':'application/json','.png':'image/png','.webp':'image/webp','.mp3':'audio/mpeg','.wav':'audio/wav'};
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
let PASS=0, FAIL=0;
const ok=(n,c,x)=>{ c?PASS++:FAIL++; console.log((c?'  PASS  ':'  FAIL  ')+n+(x?'  — '+x:'')); };

// What each table must hold. Pinned, because "did the double land in BOTH modes?" is the
// question, and a value read back out of the same table it was written to cannot answer it.
const WANT = {
  turn:     { 'trichoderma.moveSpeed': 3.0, 'nematodes.crawlSpeed': 8.0,
              'trichoderma.spreadDepthPerTurn': 18 },
  realtime: { 'trichoderma.moveSpeed': 1.5, 'nematodes.crawlSpeed': 1.0,
              'trichoderma.spreadDepthPerTurn': 4.5 },
};
const STRANDS_PER_BITE = 4;   // shared by both modes — not in MODE_TUNING
// nematodes.wanderSpeed is NOT here, and that is the point: it is a DEAD KNOB. It is set in
// three places (the CONFIG literal and both MODE_TUNING tables) and read by no code at all.
// A worm with nothing in sight holds position rather than wandering, and the one non-hunting
// move it still makes — drifting to an ant trail — uses crawlSpeed. Asserting a value for it
// would imply it does something. The two tables are still kept in step by hand, and the
// config comment says why.

const boot = async (ctx, url) => {
  const p=await ctx.newPage();
  p.on('pageerror',e=>console.log('PAGEERROR:',String(e.stack||e).slice(0,300)));
  await p.goto(url,{waitUntil:'domcontentloaded'});
  await p.waitForSelector('#loadscreen.ld-ready',{timeout:60000}).catch(()=>{});
  await p.click('#loadscreen',{timeout:5000}).catch(()=>{});
  await p.waitForFunction(()=>window.__game&&window.__game.state&&window.__game.state.active,null,{timeout:60000}).catch(()=>{});
  for(let i=0;i<6&&await p.$('#levelIntro');i++){await p.mouse.click(1100,300);await sleep(400);}
  return p;
};

(async()=>{
const srv=await new Promise(res=>{const s=http.createServer((rq,rs)=>{let p=decodeURIComponent(rq.url.split('?')[0].split('#')[0]);if(p==='/')p='/index.html';const fp=path.join(ROOT,p);if(!fp.startsWith(ROOT)||!fs.existsSync(fp)||fs.statSync(fp).isDirectory()){rs.writeHead(404);rs.end('nf');return;}rs.writeHead(200,{'Content-Type':T[path.extname(fp)]||'application/octet-stream'});fs.createReadStream(fp).pipe(rs);});s.listen(0,()=>res(s));});
const base='http://localhost:'+srv.address().port;
const b=await chromium.launch({headless:true,executablePath:'/opt/pw-browsers/chromium'});

// ---- 1. both tables, one boot each ------------------------------------------
// setMode is not on the debug hook and is called before a run begins, so the honest way to
// read a mode's table is to BOOT that mode: `#dev` is real time, `#dev,turn` is turn-based,
// and state.config is the deep clone the engine actually runs on.
const readTable = (page) => page.evaluate(() => {
  const c = window.__game.state.config;
  return { mode: c.mode,
           'trichoderma.moveSpeed': c.trichoderma.moveSpeed,
           'nematodes.crawlSpeed': c.nematodes.crawlSpeed,
           'trichoderma.spreadDepthPerTurn': c.trichoderma.spreadDepthPerTurn,
           'nematodes.strandsPerBite': c.nematodes.strandsPerBite };
});
let ctx=await b.newContext({viewport:{width:1400,height:800}});
await ctx.addInitScript(()=>{window.MYCELIUM_SUPABASE={url:'',anonKey:''};});
let p=await boot(ctx, base+'/index.html#dev');
const rtTable=await readTable(p);
ok('real time boots in real time', rtTable.mode==='realtime', rtTable.mode);
for (const k in WANT.realtime) {
  ok(`realtime: ${k} is ${WANT.realtime[k]}`, Math.abs(rtTable[k]-WANT.realtime[k])<1e-9,
     `got ${rtTable[k]}`);
}
ok(`realtime: nematodes.strandsPerBite is ${STRANDS_PER_BITE}`,
   rtTable['nematodes.strandsPerBite']===STRANDS_PER_BITE, `got ${rtTable['nematodes.strandsPerBite']}`);
await ctx.close();

ctx=await b.newContext({viewport:{width:1400,height:800}});
await ctx.addInitScript(()=>{window.MYCELIUM_SUPABASE={url:'',anonKey:''};});
p=await boot(ctx, base+'/index.html#dev,turn');
const tnTable=await readTable(p);
ok('turn-based boots turn-based', tnTable.mode==='turn', tnTable.mode);
for (const k in WANT.turn) {
  ok(`turn: ${k} is ${WANT.turn[k]}`, Math.abs(tnTable[k]-WANT.turn[k])<1e-9, `got ${tnTable[k]}`);
}
ok(`turn: nematodes.strandsPerBite is ${STRANDS_PER_BITE} (one value, both modes)`,
   tnTable['nematodes.strandsPerBite']===STRANDS_PER_BITE, `got ${tnTable['nematodes.strandsPerBite']}`);

// A spot to measure a creature's step FROM. Three ways a naive placement silently reports a
// short step instead of failing, all of them found the hard way:
//   - moveWorm/moveCloud bound themselves at surfaceY + ONE CELL, and the colony's ROOT node
//     sits at surfaceY + 6. A creature level with the root has every step rejected as
//     out-of-bounds and does not move at all.
//   - Both movers CLAMP the step to the remaining distance, so a creature nearer than one
//     step measures the gap rather than the speed.
//   - When the straight step is blocked, both movers SLIDE along one axis instead — which
//     moves a shorter distance and still returns true.
// So the spot has to be in bounds, out of reach, with clear line of sight to its nearest
// strand (or the creature never targets it) AND with the whole first step provably clear.
await p.evaluate(() => {
  window.__stepSpot = function (step) {
    const s = window.__game.state, sub = s.substrate, net = s.active, cs = sub.cellSize;
    const inB = (x, y) => x >= cs && x <= sub.worldWidth - cs
                       && y >= sub.surfaceY + cs && y <= sub.worldHeight - cs;
    // Exactly what the movers test: the COARSE rock flag, sampled at half-cell steps.
    const pathOk = (x0, y0, x1, y1) => {
      const dx = x1 - x0, dy = y1 - y0;
      const n = Math.max(1, Math.ceil(Math.hypot(dx, dy) / (cs * 0.5)));
      for (let i = 1; i <= n; i++) {
        const x = x0 + dx * (i / n), y = y0 + dy * (i / n);
        if (!inB(x, y)) return false;
        const c = sub.cellAtWorld(x, y);
        if (c && c.rock) return false;
      }
      return true;
    };
    const deep = net.nodes.slice().sort((a, b) => b.y - a.y).slice(0, 12);
    for (let ring = 2; ring <= 4; ring++) {
      const D = step * ring;
      for (let k = 0; k < 16; k++) {
        const ang = k * Math.PI / 8;
        for (const T of deep) {
          const x = T.x + Math.cos(ang) * D, y = T.y + Math.sin(ang) * D;
          if (!inB(x, y) || sub.solidAtWorld(x, y)) continue;
          let best = null, bd = Infinity;
          for (const nd of net.nodes) {
            const d = Math.hypot(nd.x - x, nd.y - y);
            if (d < bd) { bd = d; best = nd; }
          }
          if (!best || bd <= step * 1.05) continue;               // would clamp to the gap
          if (!sub.segmentClear(x, y, best.x, best.y)) continue;  // can't sense through rock
          const ux = (best.x - x) / bd, uy = (best.y - y) / bd;
          if (!pathOk(x, y, x + ux * step, y + uy * step)) continue;   // would slide, not step
          return { x, y, gap: bd / cs };
        }
      }
    }
    return null;
  };
});

// ---- 2. a worm CRAWLS crawlSpeed cells per action ---------------------------
const crawl=await p.evaluate(()=>{
  const G=window.__game, s=G.state, sub=s.substrate, net=s.active, cs=sub.cellSize;
  net.energy=99999; net.water=999;
  const nd0=net.nodes[0], c0=sub.colAtX(nd0.x), r0=sub.rowAtY(nd0.y);
  for (let c=c0-3;c<=c0+3;c++) for (let r=r0;r<=r0+6;r++) {
    if (!sub.inBounds(c,r)) continue;
    const cell=sub.cells[sub.index(c,r)]; cell.rock=0; cell.hazard=0;
    cell.nutrient=60; cell.maxNutrient=60;
  }
  for (let i=0;i<10;i++) G.performAction(s,'grow',{});
  s.nematodes.length=0;
  if (s.clouds) s.clouds.length=0;
  const want=s.config.nematodes.crawlSpeed;
  const spot=window.__stepSpot(want*cs);
  if (!spot) return {err:'no clear spot to measure a crawl from'};
  s.nematodes.push({x:spot.x, y:spot.y, heading:0, phase:0, stuck:0, feedCd:0, hp:0,
                    sees:false, feeding:false, trailing:false, targetId:null});
  const w=s.nematodes[0], x0=w.x, y0=w.y;
  G.tickWorld(s);
  const w2=s.nematodes[0] || w;
  return { moved:Math.hypot(w2.x-x0, w2.y-y0)/cs, want, saw:!!w2.sees, gap:spot.gap };
});
ok('the worm could see the colony, from beyond one step',
   !crawl.err && crawl.saw===true && crawl.gap > crawl.want,
   crawl.err || `nearest strand ${crawl.gap.toFixed(1)} cells, one step is ${crawl.want}`);
ok('a worm crawls crawlSpeed cells in one action',
   !crawl.err && Math.abs(crawl.moved-crawl.want)<0.05,
   crawl.err || `moved ${crawl.moved.toFixed(3)} cells, table says ${crawl.want}`);

// ---- 3. a feeding worm eats strandsPerBite strands per action ---------------
// The count used to be hard-coded at 1, so this is the assertion that the knob is wired in
// at all. The worm has to sit where there are MORE strands in reach than it can take, or the
// probe measures `reach` instead of the knob and quietly passes at whatever the local density
// happens to be — worse as the bite grows, because `reach` is 0.7 cells (25 units) while one
// growth segment is now 25.5, so a typical strand has only a neighbour or two that close.
// Hence: find the densest node on the map, sit on it, and assert the density separately.
const bite=await p.evaluate(()=>{
  const G=window.__game, s=G.state, sub=s.substrate, net=s.active, cs=sub.cellSize;
  net.energy=99999; net.water=999;
  const nd=net.nodes[0], c0=sub.colAtX(nd.x), r0=sub.rowAtY(nd.y);
  for (let c=c0-4;c<=c0+4;c++) for (let r=r0;r<=r0+5;r++) {
    if (!sub.inBounds(c,r)) continue;
    const cell=sub.cells[sub.index(c,r)]; cell.rock=0; cell.hazard=0;
    cell.nutrient=60; cell.maxNutrient=60;
  }
  for (let i=0;i<16;i++) G.performAction(s,'grow',{});
  s.nematodes.length=0;
  if (s.clouds) s.clouds.length=0;
  net.energy=99999;
  // The densest node: the one with the most OTHER strands inside a worm's reach of it.
  const reach=s.config.nematodes.reach*cs;
  let tgt=net.nodes[0], dense=-1;
  for (const a of net.nodes) {
    let k=0;
    for (const b of net.nodes) if (Math.hypot(b.x-a.x, b.y-a.y) <= reach) k++;
    if (k > dense) { dense=k; tgt=a; }
  }
  s.nematodes.push({x:tgt.x, y:tgt.y, heading:0, phase:0, stuck:0, feedCd:0, hp:0,
                    sees:false, feeding:false, trailing:false, targetId:null});
  const before=net.nodes.length;
  G.tickWorld(s);
  const after=net.nodes.length;
  return { before, after, eaten:before-after, want:s.config.nematodes.strandsPerBite,
           inReach:dense, reachCells:s.config.nematodes.reach,
           worms:s.nematodes.length, feeding:!!(s.nematodes[0]&&s.nematodes[0].feeding) };
});
// Worms BREED while feeding (breedChance 0.8 per tick), and a newborn does not eat on the
// tick it is born, so exactly one worm bites here — that is what makes the count readable.
ok('a big enough colony was grown to bite into', bite.before>60, `${bite.before} strands`);
ok('the worm fed', bite.feeding===true);
// Without this the next assertion is vacuous whenever the colony is thinner than the bite.
ok('the worm was sat somewhere with more strands in reach than it can take',
   bite.inReach > bite.want,
   `${bite.inReach} strands within ${bite.reachCells} cells, bite is ${bite.want}`);
ok('one feeding worm eats strandsPerBite strands per action', bite.eaten===bite.want,
   `ate ${bite.eaten}, want ${bite.want} (${bite.before} → ${bite.after})`);

// ---- 4. a hardened strand still stops the whole bite ------------------------
// Sclerotial Crust must not be cheapened by the bigger bite: the loop breaks at the first
// protected strand rather than eating around it.
const crust=await p.evaluate(()=>{
  const G=window.__game, s=G.state, sub=s.substrate, net=s.active;
  s.nematodes.length=0;
  for (const n of net.nodes) { const c=sub.cellAtWorld(n.x,n.y); if (c) c.hardened=8; }
  const tgt=net.nodes[Math.floor(net.nodes.length/2)];
  s.nematodes.push({x:tgt.x, y:tgt.y, heading:0, phase:0, stuck:0, feedCd:0, hp:0,
                    sees:false, feeding:false, trailing:false, targetId:null});
  const before=net.nodes.length;
  G.tickWorld(s);
  return { before, after:net.nodes.length };
});
ok('a hardened frontier still eats nothing, however big the bite',
   crust.after>=crust.before, `${crust.before} → ${crust.after}`);

// ---- 5. a cloud creeps moveSpeed cells per action ---------------------------
// Same placement rules as the worm (moveCloud is moveWorm with a different name), so the
// same spot-finder. A cloud prefers MYCELIUM over food when both are in sight, which is
// what makes "nearest strand" the right thing for the finder to aim at.
const creep=await p.evaluate(()=>{
  const G=window.__game, s=G.state, sub=s.substrate, cs=sub.cellSize;
  s.nematodes.length=0;
  s.clouds.length=0;
  const want=s.config.trichoderma.moveSpeed;
  const spot=window.__stepSpot(want*cs);
  if (!spot) return {err:'no clear spot to measure a creep from'};
  s.clouds.push({cx:spot.x, cy:spot.y, r:1, heading:0, fade:0, sees:false, _budget:0});
  const x0=spot.x, y0=spot.y;
  G.tickWorld(s);
  const c=s.clouds[0];
  return { moved:c?Math.hypot(c.cx-x0,c.cy-y0)/cs:-1, want, saw:!!(c&&c.sees), gap:spot.gap };
});
ok('the cloud could see the colony, from beyond one step',
   !creep.err && creep.saw===true && creep.gap > creep.want,
   creep.err || `nearest strand ${creep.gap.toFixed(1)} cells, one step is ${creep.want}`);
ok('a mould cloud creeps moveSpeed cells in one action',
   !creep.err && Math.abs(creep.moved-creep.want)<0.05,
   creep.err || `moved ${creep.moved.toFixed(3)} cells, table says ${creep.want}`);

// ---- 6. the rot races spreadDepthPerTurn rings per action -------------------
// Measured as the GROWTH in infected count over one action from an already-infected seed,
// with infectionSpreadChance forced to 1 so the race is deterministic — at 0.85 the number
// of rings taken is a coin flip per step and the assertion would be flaky by design.
const rot=await p.evaluate(()=>{
  const G=window.__game, s=G.state, sub=s.substrate, net=s.active, cs=sub.cellSize;
  s.nematodes.length=0; if (s.clouds) s.clouds.length=0;
  net.energy=99999; net.water=999;
  const nd=net.nodes[0], c0=sub.colAtX(nd.x), r0=sub.rowAtY(nd.y);
  for (let c=c0-5;c<=c0+5;c++) for (let r=r0;r<=r0+7;r++) {
    if (!sub.inBounds(c,r)) continue;
    const cell=sub.cells[sub.index(c,r)]; cell.rock=0; cell.hazard=0;
    cell.nutrient=60; cell.maxNutrient=60;
  }
  for (let i=0;i<14;i++) G.performAction(s,'grow',{});
  s.config.trichoderma.infectionSpreadChance=1;
  for (const n of net.nodes) n.infected=false;
  net._spreadAccum=0;
  net.nodes[0].infected=true;                    // one seed at the root
  const n0=net.nodes.filter(n=>n.infected).length;
  const total=net.nodes.length;
  G.tickWorld(s);
  const n1=net.nodes.filter(n=>n.infected).length;
  return { total, n0, n1, rings:s.config.trichoderma.spreadDepthPerTurn };
});
// A "ring" is one step along the filaments, and the colony branches — so N rings claims MORE
// than N strands. The measurable, non-brittle statement is that a tripled rate takes a real
// bite out of the colony in ONE action, which at the old 6 rings it did not.
ok('a big enough colony was grown for the rot to race through', rot.total>80, `${rot.total} strands`);
ok('the rot claims at least spreadDepthPerTurn rings in one action',
   rot.n1-rot.n0 >= rot.rings, `${rot.n0} → ${rot.n1} infected, rate ${rot.rings} rings`);
ok('and does not claim the whole colony at once (it still travels)',
   rot.n1 < rot.total, `${rot.n1} of ${rot.total}`);

// ---- 7. the visible creep keeps pace with the sim ---------------------------
// infectCreepMs is the renderer's ms-per-ring. If the sim outruns it the green falls behind
// until infectMaxLagMs clamps it and then jumps a chunk — the exact popping the creep exists
// to remove. So the render rate must be >= the sim rate, in rings per second.
const pace=await p.evaluate(()=>{
  const c=window.__game.config;      // live CONFIG, so this reads whichever mode is loaded
  return { creepMs:c.render.infectCreepMs, stepMs:(c.realtime&&c.realtime.stepMs)||500 };
});
// Against the REAL-TIME rate, which is the only mode with a wall clock for the creep to lag.
const simRings = WANT.realtime['trichoderma.spreadDepthPerTurn'] / (pace.stepMs/1000);
const drawRings = 1000 / pace.creepMs;                       // renderer: rings per second
ok('the render creep is at least as fast as the real-time spread', drawRings >= simRings,
   `draws ${drawRings.toFixed(1)} rings/s vs sim ${simRings.toFixed(1)} rings/s ` +
   `(infectCreepMs ${pace.creepMs}, stepMs ${pace.stepMs})`);

await b.close(); srv.close();
console.log(`==== ${PASS} passed, ${FAIL} failed ====`);
process.exit(FAIL?1:0);
})();
