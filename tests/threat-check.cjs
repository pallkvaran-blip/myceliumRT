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
 *   trichoderma.spreadDepthPerTurn  rings the ESTABLISHED rot races  (16.5 = 5.5 card steps)
 *   trichoderma.firstTouchRings     rings a BREACH claims, on its own (was contactChunk 4)
 *   trichoderma.infectionSpreadChance  MUST be 1, or the depth above is a lie — see the end
 *
 * Plus two rules that are behaviour, not numbers:
 *   - no clean mycelium may hang off rotten mycelium (infectDescendants)
 *   - a worm MOVES AND EATS on the same step, not one or the other
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
              'trichoderma.spreadDepthPerTurn': 12 },
  realtime: { 'trichoderma.moveSpeed': 1.5, 'nematodes.crawlSpeed': 1.0,
              'trichoderma.spreadDepthPerTurn': 3 },
};
// 1 = the configured depth is REAL. Below 1 it CAPS the advance at a geometric ~1/(1-p) rings
// no matter how big the depth is — see the assertions at the end.
const SPREAD_CHANCE = 1;
const SEGMENTS_PER_STEP = 3;   // cards-design: "1 step = 3 segments", and 1 ring = 1 segment
const FIRST_TOUCH = 12;   // one-off, so one value for both modes (like growInfectBurst)
const STRANDS_PER_BITE = 4;   // shared by both modes — not in MODE_TUNING
const ROT_LIFE = 3;           // steps an infected strand survives before falling away
const WORM_REACH = 1.4;       // cells
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
           'trichoderma.firstTouchRings': c.trichoderma.firstTouchRings,
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
ok(`realtime: trichoderma.firstTouchRings is ${FIRST_TOUCH}`,
   rtTable['trichoderma.firstTouchRings']===FIRST_TOUCH, `got ${rtTable['trichoderma.firstTouchRings']}`);
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
// A one-off burst, so it must be the SAME in both modes — a rate scales with steps-per-second,
// a single event does not.
ok(`turn: trichoderma.firstTouchRings is ${FIRST_TOUCH}, the same in both modes`,
   tnTable['trichoderma.firstTouchRings']===FIRST_TOUCH
   && tnTable['trichoderma.firstTouchRings']===rtTable['trichoderma.firstTouchRings'],
   `turn ${tnTable['trichoderma.firstTouchRings']}, realtime ${rtTable['trichoderma.firstTouchRings']}`);
// The rate is authored in RINGS but reasoned about in card STEPS, and the two grow cards it has
// to beat are counted in segments. Assert the relationship, not just the number, so a later
// retune in either unit shows up here.
const stepsPerTurn = WANT.turn['trichoderma.spreadDepthPerTurn'] / SEGMENTS_PER_STEP;
const cardSegs = await p.evaluate(()=>{
  const c=window.__game.state.config.cards;
  return { g4:c.grow4Segments, g5:c.grow5Segments, lance:c.reachSegments };
});
ok(`the rot races ${stepsPerTurn} card steps per action`, Math.abs(stepsPerTurn-4)<1e-9,
   `${WANT.turn['trichoderma.spreadDepthPerTurn']} rings / ${SEGMENTS_PER_STEP} segments per step`);
// Owner-set to be LEVEL with grow-4: that card exactly breaks even, and only the longer grows
// gain ground. Asserted as the relationship so a retune in either unit shows up here.
ok('grow-4 exactly breaks even against the rot',
   cardSegs.g4 === WANT.turn['trichoderma.spreadDepthPerTurn'],
   `grow4 ${cardSegs.g4} segs vs rot ${WANT.turn['trichoderma.spreadDepthPerTurn']} rings`);
ok('...and only the longer grows outrun it',
   cardSegs.g5 > WANT.turn['trichoderma.spreadDepthPerTurn']
   && cardSegs.lance > WANT.turn['trichoderma.spreadDepthPerTurn'],
   `grow5 ${cardSegs.g5}, lance ${cardSegs.lance}, rot ${WANT.turn['trichoderma.spreadDepthPerTurn']}`);

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
    // The usable band is NARROW and gets narrower as speeds go up: further than one step
    // (or the mover clamps) but inside the creature's sight (or it never targets anything).
    // At crawlSpeed 8 that is 288 to 500 units — a worm now covers more than half its own
    // sight radius in a single step. Multipliers, not fixed distances, so this tracks the
    // config; whole-number rings (2x, 3x, 4x) put every candidate past sight and the finder
    // returned null for every map.
    const sight = Math.max(sub.cellSize * 4, s.config.nematodes.sightRadius || 500);
    for (const mult of [1.15, 1.3, 1.5, 1.7, 1.15, 1.4]) {
      const D = step * mult;
      if (D >= sight) continue;                                   // nothing would be in sight
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
          if (bd >= sight) continue;                              // out of sensing range
          if (!sub.segmentClear(x, y, best.x, best.y)) continue;  // can't sense through rock
          const ux = (best.x - x) / bd, uy = (best.y - y) / bd;
          if (!pathOk(x, y, x + ux * step, y + uy * step)) continue;   // would slide, not step
          // The BEARING to what it will aim at. A worm travels along its HEADING, turning at
          // nematodes.turnRate, so a probe that seeds heading 0 and then measures distance is
          // measuring turn latency: the cleared path above runs toward the target, the worm
          // sets off along whatever direction one turn-rate swing allows, and moveWorm stops at
          // the first rock in THAT direction. Read 1.5 and 3.0 cells against a table saying 8,
          // varying with the procedural map. Seed the heading here and it measures speed.
          return { x, y, gap: bd / cs, heading: Math.atan2(best.y - y, best.x - x) };
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
  G.settleEnemyTurn();   // turn-based QUEUES each action's world step for the frame loop to animate; a synchronous probe has to settle it before it measures
  s.nematodes.length=0;
  if (s.clouds) s.clouds.length=0;
  const want=s.config.nematodes.crawlSpeed;
  const spot=window.__stepSpot(want*cs);
  if (!spot) return {err:'no clear spot to measure a crawl from'};
  s.nematodes.push({x:spot.x, y:spot.y, heading:spot.heading, phase:0, stuck:0, feedCd:0, hp:0,
                    sees:false, feeding:false, trailing:false, targetId:null});
  const w=s.nematodes[0], x0=w.x, y0=w.y;
  G.tickWorld(s);
  // The worm THIS PROBE PLACED, by identity — tickWorld respawns worms, and index 0 is not a
  // promise about which one it is.
  const w2=s.nematodes.includes(w) ? w : null;
  if (!w2) return {err:'the measured worm was removed during the step'};
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
  G.settleEnemyTurn();
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

// ---- 4b. a worm MOVES AND EATS on the same step -----------------------------
// This used to be either/or, and because a bite removes the strands within reach, a worm
// settled on the colony alternated bite / crawl / bite / crawl and fed every OTHER step.
// The probe starts it OUT of reach and within one crawl of the colony: under the old code
// that step was a pure move and ate nothing, so "moved AND ate" is the whole assertion.
const both=await p.evaluate(()=>{
  const G=window.__game, s=G.state, sub=s.substrate, net=s.active, cs=sub.cellSize;
  const n=s.config.nematodes;
  s.nematodes.length=0; if (s.clouds) s.clouds.length=0;
  for (const nd of net.nodes) { const c=sub.cellAtWorld(nd.x,nd.y); if (c) c.hardened=0; }
  // The densest node again, so there is more than one bite's worth in reach on arrival.
  const reach=n.reach*cs;
  let tgt=net.nodes[0], dense=-1;
  for (const a of net.nodes) {
    let k=0;
    for (const b of net.nodes) if (Math.hypot(b.x-a.x, b.y-a.y) <= reach) k++;
    if (k > dense) { dense=k; tgt=a; }
  }
  // Out of reach, inside one crawl, on a clear straight line so the mover doesn't slide.
  // "Out of reach" has to mean of the NEAREST STRAND, not of `tgt`: in a 400-strand colony a
  // spot 2 cells from the densest node still has some other strand inside the 0.7-cell reach,
  // and the worm then feeds without moving — which passed the eat assertion while proving
  // nothing about the move.
  let spot=null;
  for (const d of [cs*2, cs*3, cs*4, cs*1.5, cs*5, cs*6]) {
    for (let k=0;k<16 && !spot;k++) {
      const a=k*Math.PI/8, x=tgt.x+Math.cos(a)*d, y=tgt.y+Math.sin(a)*d;
      if (x<cs || x>sub.worldWidth-cs || y<sub.surfaceY+cs || y>sub.worldHeight-cs) continue;
      if (sub.solidAtWorld(x,y)) continue;
      let near=Infinity, nd=null;
      for (const b of net.nodes) { const q=Math.hypot(b.x-x, b.y-y); if (q<near) { near=q; nd=b; } }
      if (near <= reach) continue;                    // already feeding — nothing to prove
      if (near > n.crawlSpeed*cs) continue;           // couldn't arrive in one step
      if (!nd || !sub.segmentClear(x,y,nd.x,nd.y)) continue;
      spot={x,y,d:near};
    }
    if (spot) break;
  }
  if (!spot) return {err:'no out-of-reach spot within one crawl'};
  s.nematodes.push({x:spot.x, y:spot.y, heading:0, phase:0, stuck:0, feedCd:0, hp:0,
                    sees:false, feeding:false, trailing:false, targetId:null});
  const before=net.nodes.length;
  G.tickWorld(s);
  const w=s.nematodes[0];
  return { err:null, startedOutOfReach:spot.d>reach, startGap:spot.d/cs, reachCells:n.reach,
           moved:w?Math.hypot(w.x-spot.x, w.y-spot.y)/cs:0,
           eaten:before-net.nodes.length, want:n.strandsPerBite };
});
ok('the worm started OUT of reach (so the old code would have only moved)',
   !both.err && both.startedOutOfReach===true,
   both.err || `started ${both.startGap.toFixed(2)} cells away, reach is ${both.reachCells}`);
ok('it moved on that step', !both.err && both.moved > 0.1,
   both.err || `moved ${both.moved.toFixed(2)} cells`);
ok('AND it ate a full bite on the same step', !both.err && both.eaten===both.want,
   both.err || `ate ${both.eaten}, want ${both.want}`);

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
// ON A FRESH PAGE. The worm probes above now leave worms that actually reach and eat the colony
// (they used to sit still, which is the bug this session fixed), so a colony grown here on the
// shared page came back at 95 strands instead of ~600 and the rate could not be measured. The
// chain-based probes after this one build their own network and are immune; this one grows a
// real branching colony and needs a clean world.
await ctx.close();
ctx=await b.newContext({viewport:{width:1400,height:800}});
await ctx.addInitScript(()=>{window.MYCELIUM_SUPABASE={url:'',anonKey:''};});
p=await boot(ctx, base+'/index.html#dev,turn');
await p.evaluate(() => { window.__game.state.nematodes.length = 0; window.__game.state.clouds.length = 0; });
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
  G.settleEnemyTurn();
  s.config.trichoderma.infectionSpreadChance=1;
  // rotAge too, not just `infected`: an earlier probe's cloud leaves survivors part-way
  // through their rot deadline, and a strand re-seeded on top of rotAge 2 expires on its
  // very first tick — which read as "1 → 0 infected, rate 16.5 rings".
  for (const n of net.nodes) { n.infected=false; n.rotAge=0; }
  net._spreadAccum=0;
  // Seed a TIP, not the root. Everything downstream of a seed is claimed at once by
  // infectDescendants, so a root seed would claim the whole colony and measure the invariant
  // instead of the rate. A tip has nothing downstream, so what moves is the rootward race.
  let seed=net.nodes[0];
  for (const n of net.nodes) if (n.children.length===0 && !n.colon && !n.side) { seed=n; break; }
  seed.infected=true;
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

// ---- 6b. FIRST TOUCH is its own rate, and does NOT stack with the race -------
// The two rates are separate: a breach costs firstTouchRings and nothing else on that step,
// and every step after costs spreadDepthPerTurn. The old behaviour was ADDITIVE — a breach
// claimed its chunk and the freshly-seeded front then took a full turn's spread on top — so
// the number to prove is the ISOLATION, not just that a breach infects something.
//
// Measured on a LINEAR strand of known length, not the branching colony: a "ring" is one step
// along the filaments, so on a branching network N rings claims far more than N strands and
// the count says nothing about the rate. On a single chain, rings and strands are 1:1 and the
// two numbers can actually be compared. firstTouchRings (20) is well under the race (40), so
// if the breach also raced, the count would come out at the chain's full length instead.
const touch=await p.evaluate(()=>{
  const G=window.__game, s=G.state, sub=s.substrate, cs=sub.cellSize;
  const net=s.active, t=s.config.trichoderma;
  s.nematodes.length=0; s.clouds.length=0;
  // A bare chain, long enough that neither rate can run out of strand to claim.
  const LEN=160;
  net.nodes.length=0; net.byId.clear(); net.nextNodeId=0;
  let parent=net.addNode(sub.worldWidth/2, sub.surfaceY+cs*3, null);
  parent._liveAt=0;
  for (let i=1;i<LEN;i++) {
    // Straight down the middle; y stays inside the world, x never moves.
    parent=net.addNode(sub.worldWidth/2, sub.surfaceY+cs*3+i*4, parent);
    parent._liveAt=0;
  }
  for (const n of net.nodes) { n.infected=false; n.rotAge=0; const c=sub.cellAtWorld(n.x,n.y); if (c) { c.mouldProof=0; c.reinfectGrace=0; c.trich=0; } }
  net._spreadAccum=0;
  t.infectionSpreadChance=1;                 // deterministic, so the ring count is readable
  // A cloud parked ON the far END of the chain, so its breach seeds the tip and the rot has
  // the whole chain in ONE direction to eat — a mid-chain seed would spread both ways and
  // double the count.
  const tip=net.nodes[net.nodes.length-1];
  s.clouds.push({cx:tip.x, cy:tip.y, r:0.4, heading:0, fade:0, sees:true, _budget:0});
  const before=net.nodes.filter(n=>n.infected).length;
  // Now that rot EXPIRES, a probe above can rot a colony to nothing — which ends the run, and
  // tickWorld early-returns on state.runOver. Every tick-driven probe has to clear it or it
  // silently measures zero. This one reported "0 rotten after the breach, wanted 21".
  s.runOver=false; s.winPending=false; s.won=false; net.alive=true;
  G.tickWorld(s);
  const afterTouch=net.nodes.filter(n=>n.infected).length;
  // Second step: no cloud left (it spent itself), so this is the established race alone.
  s.clouds.length=0;
  net._spreadAccum=0;
  s.runOver=false; s.winPending=false; s.won=false; net.alive=true;
  G.tickWorld(s);
  const afterRace=net.nodes.filter(n=>n.infected).length;
  return { len:net.nodes.length, before, afterTouch, afterRace,
           first:t.firstTouchRings, rate:t.spreadDepthPerTurn };
});
ok('the breach seeded a clean chain', touch.before===0 && touch.len>=160,
   `${touch.len} strands, ${touch.before} already rotten`);
// The seeded tip itself, plus firstTouchRings claimed along the chain from it.
ok('first touch costs exactly firstTouchRings + the strand it touched',
   touch.afterTouch === touch.first + 1,
   `${touch.afterTouch} rotten after the breach, wanted ${touch.first + 1} ` +
   `(firstTouchRings ${touch.first})`);
ok('it did NOT also take a full turn\'s race on the same step',
   touch.afterTouch < touch.first + touch.rate,
   `${touch.afterTouch} rotten; additive would be about ${touch.first + touch.rate + 1}`);
// The rate is fractional (16.5) and _spreadAccum advances whole rings only, carrying the
// remainder — so a single step lands on floor OR ceil, never on 16.5 itself.
ok('the step AFTER the breach costs spreadDepthPerTurn',
   (touch.afterRace - touch.afterTouch) >= Math.floor(touch.rate)
   && (touch.afterRace - touch.afterTouch) <= Math.ceil(touch.rate),
   `${touch.afterTouch} → ${touch.afterRace} (+${touch.afterRace-touch.afterTouch}), rate ${touch.rate}`);

// On a BRANCHING colony a ring is one step along the filaments in every direction at once, so
// N rings claims far more than N strands — which is why the exact-rate assertions above run on
// a linear chain. Worth its own assertion because it is the magnitude the owner feels: at 40
// rings, one step of the established race reaches essentially all of a ~550-strand colony.
ok('on a branching colony one step claims far more strands than rings',
   rot.n1 - rot.n0 > rot.rings, `+${rot.n1-rot.n0} strands from ${rot.rings} rings ` +
   `(${rot.n1} of ${rot.total} rotten)`);
// The rot TRAVELS rather than claiming everything reachable — asserted on the chain, where
// "how far did it get" is a real distance rather than a branching factor.
ok('the rot still has to travel: two steps did not reach the end of a 160-strand chain',
   touch.afterRace < touch.len, `${touch.afterRace} of ${touch.len} rotten after two steps`);

// ---- 6c. NOTHING CLEAN HANGS OFF ROT ----------------------------------------
// The rule: everything downstream of an infected strand is infected, at once, whatever the
// rate says. Rate governs the ROOTWARD and sibling direction; the tip direction is topology.
//
// The bug it fixes: a grow card played straight THROUGH a cloud kept its far end. The nodes
// standing in the mould were claimed and growInfectBurst took 18 rings around them, but three
// paths overrun that budget — _bridgeInto's pile runner walks up to 30 nodes,
// colonizeReachablePiles sprays a mat on top, and Rhizomorph Lance is 18 segments by itself —
// so a food pile at the goal, reached through mould, came out cream and could still win.
//
// Measured on a chain far LONGER than growInfectBurst + the race, so a version that only
// claimed the burst radius cannot pass by accident.
const desc=await p.evaluate(()=>{
  const G=window.__game, s=G.state, sub=s.substrate, cs=sub.cellSize, net=s.active;
  s.nematodes.length=0; s.clouds.length=0;
  const LEN=120;
  net.nodes.length=0; net.byId.clear(); net.nextNodeId=0;
  let parent=net.addNode(sub.worldWidth/2, sub.surfaceY+cs*3, null); parent._liveAt=0;
  for (let i=1;i<LEN;i++){ parent=net.addNode(sub.worldWidth/2, sub.surfaceY+cs*3+i*4, parent); parent._liveAt=0; }
  for (const n of net.nodes){ n.infected=false; n.rotAge=0; const c=sub.cellAtWorld(n.x,n.y); if(c){c.mouldProof=0;c.reinfectGrace=0;c.trich=0;} }
  // Infect ONE node a third of the way down. Everything below it is downstream.
  const at=Math.floor(LEN/3);
  net.nodes[at].infected=true;
  const claimed=G.infectDescendants(net, sub);
  let cleanBelow=0, cleanAbove=0;
  for (let i=0;i<net.nodes.length;i++) if (!net.nodes[i].infected) { if (i>at) cleanBelow++; else cleanAbove++; }
  return { len:LEN, at, claimed, cleanBelow, cleanAbove,
           burst:s.config.trichoderma.growInfectBurst };
});
ok('the whole downstream chain is claimed at once', desc.cleanBelow===0,
   `${desc.cleanBelow} clean strands still hanging off the rot`);
ok('it claimed every strand below the seed, not just growInfectBurst rings',
   desc.claimed === desc.len - desc.at - 1 && desc.claimed > desc.burst,
   `claimed ${desc.claimed} of ${desc.len-desc.at-1} downstream (burst radius is ${desc.burst})`);
ok('and does NOT reach upstream — that is what the per-step rate is for',
   desc.cleanAbove === desc.at, `${desc.cleanAbove} clean above the seed, wanted ${desc.at}`);

// A WARD still holds the line, for itself and for everything behind it. Every other infection
// path respects cellProofed and this one has to as well, or a defense card silently stops
// mattering the moment the rot is upstream of it.
const ward=await p.evaluate(()=>{
  const G=window.__game, s=G.state, sub=s.substrate, net=s.active;
  for (const n of net.nodes) { n.infected=false; n.rotAge=0; }
  for (const n of net.nodes) { const c=sub.cellAtWorld(n.x,n.y); if (c) c.mouldProof=0; }
  const at=10, wardAt=20;
  // Ward ONE strand, 10 below the seed. Its own cell and everything past it must survive.
  const wc=sub.cellAtWorld(net.nodes[wardAt].x, net.nodes[wardAt].y);
  if (!wc) return {err:'no cell under the warded node'};
  wc.mouldProof=5;
  net.nodes[at].infected=true;
  G.infectDescendants(net, sub);
  let cleanPast=0;
  for (let i=wardAt;i<net.nodes.length;i++) if (!net.nodes[i].infected) cleanPast++;
  return { wardAt, total:net.nodes.length, cleanPast,
           wardRotten:net.nodes[wardAt].infected,
           betweenRotten:net.nodes[at+1].infected };
});
ok('the rot did reach the strands before the ward', !ward.err && ward.betweenRotten===true);
ok('a warded strand is not claimed', !ward.err && ward.wardRotten===false);
ok('and the ward shelters everything behind it',
   !ward.err && ward.cleanPast === ward.total - ward.wardAt,
   ward.err || `${ward.cleanPast} clean from the ward on, of ${ward.total - ward.wardAt}`);

// ---- 6d. infectionSpreadChance must be 1, or the depth is a lie -------------
// This is the defect behind "the rot chases at uneven speeds, usually about 2 steps". A failed
// roll drops that node from the frontier, killing the branch for the rest of the call, so a
// filament advances a GEOMETRIC number of rings with mean p/(1-p) — deaf to the depth. The
// depth was raised 6 → 18 → 40 across two sessions with almost no effect because of it.
const chance=await p.evaluate(()=>{
  const G=window.__game, s=G.state, sub=s.substrate, cs=sub.cellSize, net=s.active, t=s.config.trichoderma;
  s.nematodes.length=0; s.clouds.length=0;
  const build=()=>{
    // CLEAR THE CLOUDS EVERY TRIAL, not just once before the 60 of them. spreadTrichoderma
    // rolls respawnChance (0.12) on every tick, so over 60 ticks the map re-populates itself
    // to initialPatches — and the chain this measures runs straight down the middle of the
    // map, so a fresh cloud eventually breaches it, claims everything downstream by the
    // no-clean-tissue-off-rot invariant, and one trial reports 318 rings against a rate of 12.
    // The block's own comment already says "no cloud, so no first-touch"; this makes it true.
    s.clouds.length=0;
    net.nodes.length=0; net.byId.clear(); net.nextNodeId=0;
    let parent=net.addNode(sub.worldWidth/2, sub.surfaceY+cs*3, null); parent._liveAt=0;
    for (let i=1;i<400;i++){ parent=net.addNode(sub.worldWidth/2, sub.surfaceY+cs*3+i*4, parent); parent._liveAt=0; }
    for (const n of net.nodes){ n.infected=false; n.rotAge=0; n.health=1; const c=sub.cellAtWorld(n.x,n.y); if(c){c.mouldProof=0;c.reinfectGrace=0;c.trich=0;} }
    // REVIVE IT. A trial that rots the whole chain leaves the colony dead, and infectNetwork
    // skips a dead network entirely — so without this every trial after the first measured 0
    // and the check reported "min 0, median 0, max 399" from one lucky run.
    net.alive=true; net.fruited=false; net._vitalityDip=0;
    net.recomputeVitality();
  };
  const live=t.infectionSpreadChance;
  const measure=(p)=>{
    t.infectionSpreadChance=p;
    const runs=[];
    for (let k=0;k<30;k++){
      build(); net._spreadAccum=0;
      // Seed the TIP end. Everything downstream of a seed is claimed at once by the
      // invariant, so a root seed takes the whole chain and measures nothing about the rate.
      net.nodes[net.nodes.length-1].infected=true;
      // The race only, on the established front: no cloud, so no first-touch.
      s.runOver=false; s.winPending=false; s.won=false; net.alive=true;
      G.tickWorld(s);
      runs.push(net.nodes.filter(n=>n.infected).length - 1);
    }
    runs.sort((a,b)=>a-b);
    return { min:runs[0], med:runs[Math.floor(runs.length/2)], max:runs[runs.length-1] };
  };
  const at1=measure(1);
  const at085=measure(0.85);
  t.infectionSpreadChance=live;
  return { at1, at085, rate:t.spreadDepthPerTurn, chance:live };
});
ok('infectionSpreadChance is 1 in the shipped config', chance.chance===SPREAD_CHANCE,
   `got ${chance.chance}`);
// The rate alternates 16/17 as _spreadAccum carries the .5, so accept either.
ok('at chance 1 the advance IS the configured rate, every time',
   chance.at1.min >= Math.floor(chance.rate) && chance.at1.max <= Math.ceil(chance.rate),
   `min ${chance.at1.min}, median ${chance.at1.med}, max ${chance.at1.max}, rate ${chance.rate}`);
// The negative control, kept as a live measurement rather than a comment: this is the number
// that made the rate meaningless, and it is what a future "let's add some randomness" would
// reintroduce.
// "< half" was calibrated when the rate was 16.5. The cap is ~1/(1-p) ~ 5.7 rings whatever the
// rate, so the LOWER the configured depth the less dramatic the collapse looks — at 12 the
// median lands right on half. What has to hold is that it is both lower AND uneven.
ok('at chance 0.85 it collapses to a fraction of the rate, wildly unevenly',
   chance.at085.med <= chance.at1.med * 0.75 && chance.at085.min < chance.at085.max,
   `0.85 → min ${chance.at085.min}, median ${chance.at085.med}, max ${chance.at085.max}; ` +
   `chance 1 → ${chance.at1.med}`);

// ---- 6e. ROT HAS A LIFESPAN --------------------------------------------------
// An infected strand darkens toward render.rotted over rotLifeTurns steps and is then REMOVED
// from the network. Two things have to hold or the feature is a trap: a strand claimed on step
// N must get its FULL window (claiming and expiring on the same step would delete a limb the
// player never had a chance to cure), and healing must clear the deadline as well as the rot.
const life=await p.evaluate((L)=>{
  const G=window.__game, s=G.state, sub=s.substrate, cs=sub.cellSize, net=s.active;
  s.nematodes.length=0; s.clouds.length=0;
  s.config.trichoderma.rotLifeTurns=L;
  // A short chain, all of it infected at once, so every strand shares a deadline.
  net.nodes.length=0; net.byId.clear(); net.nextNodeId=0;
  let parent=net.addNode(sub.worldWidth/2, sub.surfaceY+cs*3, null); parent._liveAt=0;
  for (let i=1;i<12;i++){ parent=net.addNode(sub.worldWidth/2, sub.surfaceY+cs*3+i*4, parent); parent._liveAt=0; }
  for (const n of net.nodes){ n.infected=true; n.rotAge=0; n.health=1;
    const c=sub.cellAtWorld(n.x,n.y); if(c){c.mouldProof=0;c.reinfectGrace=0;c.trich=0;} }
  net.alive=true; net.recomputeVitality();
  const counts=[net.nodes.length];
  const ages=[];
  for (let k=0;k<L+1;k++){
    // tickWorld EARLY-RETURNS on state.runOver / winPending, and the probes above rot whole
    // colonies on purpose — which ends the run. Reviving net.alive is not enough; without this
    // nothing ticks at all and the "survives its first steps" assertion passes VACUOUSLY while
    // its partner reports rotAge 0.
    s.runOver=false; s.winPending=false; s.won=false;
    net._spreadAccum=0; net.alive=true;
    G.tickWorld(s);
    counts.push(net.nodes.length);
    ages.push(net.nodes.length ? Math.max(...net.nodes.map(n=>n.rotAge||0)) : 0);
  }
  return { life:L, counts, ages };
}, ROT_LIFE);
ok(`rotLifeTurns is ${ROT_LIFE} in the shipped config`,
   await p.evaluate(()=>window.__cfg.trichoderma.rotLifeTurns)===ROT_LIFE,
   `got ${await p.evaluate(()=>window.__cfg.trichoderma.rotLifeTurns)}`);
// Steps 1..L-1 must NOT delete anything: the strand gets its whole window to be cured in.
ok('infected tissue survives its first steps (there is time to cure it)',
   life.counts.slice(0, ROT_LIFE).every((c)=>c===life.counts[0]),
   `counts by step: ${life.counts.join(' → ')}`);
ok(`and is gone by the end of step ${ROT_LIFE}`, life.counts[ROT_LIFE]===0,
   `counts by step: ${life.counts.join(' → ')}`);

// Healing inside the window has to reset the DEADLINE too, or a cured strand is deleted a step
// later by a countdown nobody can see.
const cured=await p.evaluate(()=>{
  const G=window.__game, s=G.state, sub=s.substrate, cs=sub.cellSize, net=s.active;
  s.nematodes.length=0; s.clouds.length=0;
  net.nodes.length=0; net.byId.clear(); net.nextNodeId=0;
  let parent=net.addNode(sub.worldWidth/2, sub.surfaceY+cs*3, null); parent._liveAt=0;
  for (let i=1;i<12;i++){ parent=net.addNode(sub.worldWidth/2, sub.surfaceY+cs*3+i*4, parent); parent._liveAt=0; }
  for (const n of net.nodes){ n.infected=true; n.rotAge=0; n.health=1;
    const c=sub.cellAtWorld(n.x,n.y); if(c){c.mouldProof=0;c.reinfectGrace=0;c.trich=0;} }
  net.alive=true; net.recomputeVitality();
  s.runOver=false; s.winPending=false; s.won=false;   // see above — tickWorld skips a finished run
  net._spreadAccum=0; G.tickWorld(s);                 // one step of rot
  const aged=Math.max(...net.nodes.map(n=>n.rotAge||0));
  // Cure everything the way the cure plays do, then run well past the original deadline.
  for (const n of net.nodes){ n.infected=false; n.rotAge=0; }
  const after=net.nodes.length;
  for (let k=0;k<6;k++){ s.runOver=false; s.winPending=false; s.won=false;
                         net.alive=true; net._spreadAccum=0; G.tickWorld(s); }
  return { aged, after, survived:net.nodes.length };
});
ok('a step of rot did age the strands', cured.aged>=1, `rotAge ${cured.aged}`);
ok('curing resets the deadline, so healed tissue is NOT deleted later',
   cured.survived===cured.after && cured.survived>0,
   `${cured.after} strands cured, ${cured.survived} still there six steps on`);

// ---- 6g. INFECTED TISSUE CANNOT HARVEST, AND THE PILE KEEPS ITS FOOD ---------
// Two halves of one rule: rotten mycelium must not eat, and the pile it failed to eat must
// still be there for clean growth later. The second half is the one that could silently break
// — a claim path that marked the pile "colonized" or zeroed its nutrient before checking
// `infected` would lose the food to tissue that never banked it.
const harvest=await p.evaluate(()=>{
  const G=window.__game, s=G.state, sub=s.substrate, net=s.active, cs=sub.cellSize;
  s.nematodes.length=0; s.clouds.length=0;
  s.runOver=false; s.winPending=false; s.won=false;
  // A clean two-node colony with a pile right beside it.
  net.nodes.length=0; net.byId.clear(); net.nextNodeId=0;
  const x=sub.worldWidth/2, y=sub.surfaceY+cs*4;
  const col=sub.colAtX(x), row=sub.rowAtY(y);
  const cells=[];
  for (let c=col;c<=col+1;c++) for (let r=row;r<=row+1;r++) {
    if (!sub.inBounds(c,r)) continue;
    const i=sub.index(c,r), cell=sub.cells[i];
    cell.rock=0; cell.hazard=0; cell.water=0; cell.colonized=0;
    cell.nutrient=40; cell.maxNutrient=40;
    cells.push(i);
  }
  if (!cells.length) return {err:'no room for a pile'};
  // The strand sits INSIDE the pile — "grew into a food pile", which is the case the rule is
  // about. Beside it is a different question (whether a runner can bridge in) and answers this
  // one only by accident.
  const mid=cells[0], mc=sub.cellCenter(mid%sub.cols, Math.floor(mid/sub.cols));
  let root=net.addNode(mc.x, mc.y, null); root._liveAt=0; root._revSeen=true;
  const nut=()=>cells.reduce((a,i)=>a+sub.cells[i].nutrient,0);
  const claimed=()=>cells.filter((i)=>sub.cells[i].colonized>=1).length;
  // INFECTED: reaches for the pile and must get nothing.
  root.infected=true; root.rotAge=0;
  net.alive=true;
  const e0=net.energy;
  net.colonizeReachablePiles(sub, s.rng);
  const rotten={ nut:nut(), claimed:claimed(), gained:net.energy-e0 };
  // CLEAN: the same colony, cured. The food has to still be there and now be taken.
  root.infected=false; root.rotAge=0;
  const e1=net.energy;
  net.colonizeReachablePiles(sub, s.rng);
  const clean={ nut:nut(), claimed:claimed(), gained:net.energy-e1 };
  // TURN-BASED DRIPS a claimed pile down over the following turns via resolveIncome; only real
  // time banks it whole on arrival. So "was it harvested?" is not "did energy jump" here — it is
  // that the cells are claimed and the nutrient then starts falling.
  s.runOver=false; s.winPending=false; s.won=false;
  net.alive=true; net.energy=0;
  G.tickWorld(s);
  const drained={ nut:nut(), gained:net.energy };
  return { err:null, cells:cells.length, before:40*cells.length, rotten, clean, drained,
           rt:!!(s.config.realtime && s.config.realtime.enabled) };
});
ok('the pile probe built something to eat', !harvest.err && harvest.cells>0,
   harvest.err || `${harvest.cells} cells, ${harvest.before} nutrient`);
ok('infected tissue claims NO cells of the pile', !harvest.err && harvest.rotten.claimed===0,
   harvest.err || `${harvest.rotten.claimed} of ${harvest.cells} cells claimed`);
ok('...and banks none of its energy', !harvest.err && harvest.rotten.gained===0,
   harvest.err || `+${harvest.rotten.gained}`);
ok('...and leaves every scrap of the food behind for later',
   !harvest.err && harvest.rotten.nut===harvest.before,
   harvest.err || `${harvest.rotten.nut} of ${harvest.before} nutrient left`);
ok('clean mycelium can then grow into that same pile and claim it',
   !harvest.err && harvest.clean.claimed===harvest.cells,
   harvest.err || `${harvest.clean.claimed} of ${harvest.cells} cells claimed`);
ok('...and the food it left behind is then actually eaten',
   !harvest.err && (harvest.drained.nut < harvest.clean.nut || harvest.drained.gained > 0),
   harvest.err || `nutrient ${harvest.clean.nut} → ${harvest.drained.nut}, +${harvest.drained.gained.toFixed(1)}⚡`);

// ---- 6g2. GROWING THROUGH MOULD INTO A PILE HARVESTS NOTHING ------------------
// Own page. Verified in isolation this claims 0 of 4 cells; on the shared page — a dozen probes,
// many ticks and several hand-built networks later — it read 4 of 4. Anything that builds a
// network and calls colonizeReachablePiles needs a clean world to be measured in.
await ctx.close();
ctx=await b.newContext({viewport:{width:1400,height:800}});
await ctx.addInitScript(()=>{window.MYCELIUM_SUPABASE={url:'',anonKey:''};});
p=await boot(ctx, base+'/index.html#dev,turn');
// The reported case, and the one 6g above does NOT cover: the strand was CLEAN at the moment it
// touched the pile and only became infected later in the same step. A grow resolves its whole
// path and then claims piles, so the claim ran before infectStrandsInMould (goal check) and
// before infectNetwork (world tick) had marked anything — the pile was banked, and its draft
// granted, by tissue that was already dead in the mould it had just crossed.
const through=await p.evaluate(()=>{
  const G=window.__game, s=G.state, sub=s.substrate, net=s.active, cs=sub.cellSize;
  s.nematodes.length=0; s.clouds.length=0;
  s.runOver=false; s.winPending=false; s.won=false;
  net.nodes.length=0; net.byId.clear(); net.nextNodeId=0;
  // EVERY OTHER PILE OFF THE MAP FIRST. colonizeReachablePiles flood-fills a pile with
  // 8-connectivity, so a procedural pile touching this probe's four cells makes ONE pile with
  // a second entrance — and `entry` then lands somewhere the root can reach without crossing
  // the mould, which claims the four cells by a route the probe never built. That is what read
  // `4 of 4` on one boot and `0 of 4` on the next off identical code.
  sub.forEachCell((cell) => { cell.nutrient=0; cell.maxNutrient=0; cell.trich=0; cell.colonized=0; });
  const x=sub.worldWidth/2, y=sub.surfaceY+cs*4;
  // A short chain: root, then a strand standing IN mould, then the strand that reached the pile.
  let root=net.addNode(x, y, null); root._liveAt=0; root._revSeen=true;
  let mid=net.addNode(x+cs, y, root); mid._liveAt=0; mid._revSeen=true;
  const col=sub.colAtX(x+cs*2), row=sub.rowAtY(y);
  const cells=[];
  for (let c=col;c<=col+1;c++) for (let r=row;r<=row+1;r++) {
    if (!sub.inBounds(c,r)) continue;
    const i=sub.index(c,r), cell=sub.cells[i];
    cell.rock=0; cell.hazard=0; cell.water=0; cell.colonized=0; cell.trich=0;
    cell.nutrient=40; cell.maxNutrient=40;
    cells.push(i);
  }
  if (!cells.length) return {err:'no room for a pile'};
  const pc=sub.cellCenter(cells[0]%sub.cols, Math.floor(cells[0]/sub.cols));
  let tip=net.addNode(pc.x, pc.y, mid); tip._liveAt=0; tip._revSeen=true;
  // Mould on the MIDDLE strand only — the tip is in clean ground, inside the food.
  const mc=sub.cellAtWorld(mid.x, mid.y);
  if (!mc) return {err:'no cell under the mid strand'};
  mc.trich=1; mc.mouldProof=0; mc.reinfectGrace=0;
  const nut=()=>cells.reduce((a,i)=>a+sub.cells[i].nutrient,0);
  const claimed=()=>cells.filter((i)=>sub.cells[i].colonized>=1).length;
  const e0=net.energy;
  net.alive=true;
  net.colonizeReachablePiles(sub, s.rng);
  return { err:null, cells:cells.length, before:40*cells.length,
           midRotten:mid.infected===true, tipRotten:tip.infected===true,
           claimed:claimed(), nut:nut(), gained:net.energy-e0 };
});
ok('the mould probe built a pile beyond a mould-covered strand', !through.err && through.cells>0,
   through.err || `${through.cells} cells`);
ok('the strand standing in mould is claimed as rot at claim time',
   !through.err && through.midRotten===true);
ok('...and so is the strand PAST it that reached the food (downstream of rot is rot)',
   !through.err && through.tipRotten===true);
ok('growing THROUGH mould into a pile claims none of it',
   !through.err && through.claimed===0,
   through.err || `${through.claimed} of ${through.cells} cells claimed`);
ok('...banks no energy, so no pile reward and no draft',
   !through.err && through.gained===0, through.err || `+${through.gained}`);
ok('...and the food is all still there',
   !through.err && through.nut===through.before,
   through.err || `${through.nut} of ${through.before} left`);

// ---- 6g3. WHAT YOU GREW THIS STEP NEAR THE BREACH IS ROT TOO -------------------
// The owner's rule, and the reason it exists: "there is no growth action strong enough to just
// sprint past trych that is about to infect you". Blocking the pile claim (6g2) stops the
// reward; this stops the tissue itself arriving clean. Everything grown DURING the step that
// got infected, within freshGrowthRings of the breach, is claimed with it.
//
// The watermark is what makes it "this step": ids come off nextNodeId in order, so the harness
// can seed an old half and a fresh half of one chain by setting _turnStartId at the join. That
// distinction is the whole rule — established tissue at the same distance must be left to the
// ordinary race, or this becomes a second, much faster spread.
await ctx.close();
ctx=await b.newContext({viewport:{width:1400,height:800}});
await ctx.addInitScript(()=>{window.MYCELIUM_SUPABASE={url:'',anonKey:''};});
p=await boot(ctx, base+'/index.html#dev,turn');
const FRESH_RINGS=24;
ok(`trichoderma.freshGrowthRings is ${FRESH_RINGS} rings`,
   await p.evaluate(()=>window.__cfg.trichoderma.freshGrowthRings)===FRESH_RINGS,
   `got ${await p.evaluate(()=>window.__cfg.trichoderma.freshGrowthRings)}`);
// 3 segments to a card "step", so the ring count only means something as grow-steps: it has to
// out-reach the longest grow in the game or the sprint still works.
ok('...which is 8 grow-steps, longer than any grow card',
   await p.evaluate(()=>{
     const c=window.__cfg;
     let longest=0;
     for (const k of ['reachSegments','grow4Segments','grow5Segments','lungeSegments'])
       if (typeof c.cards[k]==='number') longest=Math.max(longest, c.cards[k]);
     return c.trichoderma.freshGrowthRings/3 >= longest/3;
   }),
   `${FRESH_RINGS/3} steps`);
const sprint=await p.evaluate((RINGS)=>{
  const G=window.__game, s=G.state, sub=s.substrate, net=s.active, cs=sub.cellSize;
  const t=s.config.trichoderma;
  s.nematodes.length=0; s.clouds.length=0;
  s.runOver=false; s.winPending=false; s.won=false;
  sub.forEachCell((cell)=>{ cell.trich=0; cell.mouldProof=0; cell.reinfectGrace=0; });
  // ONLY the fresh-growth rule. firstTouchRings would claim its own neighbourhood around the
  // breach and the established race would claim more again, and neither is what is being
  // measured here — both have their own assertions above.
  // moveSpeed 0 PINS THE CLOUD. tickWorld creeps the clouds BEFORE the contact pass, so a cloud
  // dropped exactly on node 30 had drifted by the time it touched anything and breached node 29
  // instead — which shifts the whole claimed range and read as `34 of 60`.
  t.contactChance=1; t.firstTouchRings=0; t.spreadDepthPerTurn=0; t.freshGrowthRings=RINGS; t.moveSpeed=0;
  net.nodes.length=0; net.byId.clear(); net.nextNodeId=0;
  const y=sub.surfaceY+cs*4;
  let par=null;
  for (let i=0;i<60;i++){ par=net.addNode(400+i*6, y, par); par._liveAt=0; par._revSeen=true; }
  const OLD=20, HIT=30;                       // 0..19 grown before this step, 20..59 during it
  net._turnStartId = net.nodes[OLD].id;
  const c=net.nodes[HIT];
  s.clouds.push({cx:c.x, cy:c.y, r:0.2, strength:1, dying:false, heading:null});   // makeCloud's shape
  net.alive=true;
  G.tickWorld(s);
  const inf=net.nodes.map((n)=>!!n.infected);
  return { hit:inf[HIT],
           freshInRange: inf.slice(OLD, HIT+RINGS+1).every(Boolean),
           oldInRange: inf.slice(HIT-RINGS, OLD).some(Boolean),
           beyond: inf.slice(HIT+RINGS+1).some(Boolean),
           total: inf.filter(Boolean).length };
}, FRESH_RINGS);
ok('the breach itself is rot', sprint.hit===true);
ok('...and every strand grown THIS step within reach of it, however far the grow ran',
   sprint.freshInRange===true,
   `${sprint.total} of 60 claimed`);
ok('...but nothing grown on an EARLIER step, at the same distance',
   sprint.oldInRange===false);
ok('...and nothing past freshGrowthRings, so a long enough grow still outruns it',
   sprint.beyond===false);

// ---- 6g4. THE GREEN STARTS WHERE THE ROT CAME IN ------------------------------
// Reported: "I'd like to see the green infection animation spread from the point of infection.
// Right now it seems to spread from the starting point of growth instead." A breach claims its
// whole firstTouchRings neighbourhood on ONE step, so the renderer's creep gets a set of
// strands none of which has a scheduled neighbour and has to pick where the wave begins. It
// picked the lowest node id — and an id is an AGE, so the oldest strand in the set won and the
// green crawled from the base of the colony out toward the cloud. Exactly backwards.
//
// Order, not wall-clock timing: `_infAt` is compared against its neighbours off a FIXED `now`,
// so nothing here depends on frames headless will not draw (see the animation-timing note in
// tests/README.md).
const creepWave=await p.evaluate(()=>{
  const G=window.__game, s=G.state, sub=s.substrate, net=s.active, cs=sub.cellSize;
  const t=s.config.trichoderma;
  s.nematodes.length=0; s.clouds.length=0;
  s.runOver=false; s.winPending=false; s.won=false;
  sub.forEachCell((cell)=>{ cell.trich=0; cell.mouldProof=0; cell.reinfectGrace=0; });
  // firstTouchRings only, so the rotten set is a clean symmetric band around the breach and
  // "did it start in the middle?" has an unambiguous answer.
  // moveSpeed 0 so the cloud breaches the strand it was placed on — see the note in 6g3.
  t.contactChance=1; t.firstTouchRings=12; t.spreadDepthPerTurn=0; t.freshGrowthRings=0; t.moveSpeed=0;
  net.nodes.length=0; net.byId.clear(); net.nextNodeId=0;
  const y=sub.surfaceY+cs*4;
  let par=null;
  for (let i=0;i<60;i++){ par=net.addNode(400+i*6, y, par); par._liveAt=0; par._revSeen=true; }
  const HIT=30;
  const c=net.nodes[HIT];
  s.clouds.push({cx:c.x, cy:c.y, r:0.2, strength:1, dying:false, heading:null});
  net.alive=true;
  G.tickWorld(s);
  const R=G.netRenderer(), now=1e6;
  const earliest=()=>{ let idx=-1, best=Infinity;
    for (let i=0;i<net.nodes.length;i++){ const n=net.nodes[i];
      if (n.infected && n._infAt!=null && n._infAt<best){ best=n._infAt; idx=i; } }
    return idx; };
  // WHERE THE BREACH ACTUALLY LANDED, read back rather than assumed. `_infSeed` is what the sim
  // stamped, so if a future change lets the cloud drift off the strand it was placed on, the
  // `breach === HIT` assertion says so instead of the creep assertion failing for the wrong
  // reason (it did exactly that: node 29 instead of 30).
  let breach=-1;
  for (let i=0;i<net.nodes.length;i++) if (net.nodes[i]._infSeed) { breach=i; break; }
  R._scheduleInfection(now);
  const first=earliest();
  const at=net.nodes.map((n)=>n.infected ? n._infAt : null);
  let mono=true, rotCount=0, lo=-1;
  for (let i=0;i<at.length;i++) if (at[i]!=null){ rotCount++; if (lo<0) lo=i; }
  for (let i=breach;i>=0 && i+1<at.length && at[i+1]!=null;i++) if (at[i+1] < at[i]) mono=false;
  for (let i=breach;i>0 && at[i-1]!=null;i--) if (at[i-1] < at[i]) mono=false;
  // NEGATIVE CONTROL, in the same probe: strip the marker off the same rot and reschedule. If
  // this does not come back with the oldest strand, the assertion above is not measuring the
  // thing that was fixed.
  for (const n of net.nodes){ n._infAt=null; n._infSeed=false; }
  R._scheduleInfection(now);
  return { hit:HIT, breach, first, mono, rotCount, lo, unmarked:earliest() };
});
ok('the cloud breached the strand it was placed on', creepWave.breach===creepWave.hit,
   `breached strand ${creepWave.breach}, placed on ${creepWave.hit}`);
ok('the creep starts at the strand the cloud touched, not the oldest one',
   creepWave.first===creepWave.breach && creepWave.breach>=0,
   `wave began at strand ${creepWave.first}, the breach was ${creepWave.breach} (${creepWave.rotCount} rotten, oldest is ${creepWave.lo})`);
ok('...and turns green outward from there along the filaments', creepWave.mono===true);
ok('...and without the marker it starts at the oldest strand, which was the bug',
   creepWave.unmarked===creepWave.lo && creepWave.lo!==creepWave.breach,
   `unmarked wave began at ${creepWave.unmarked}, oldest is ${creepWave.lo}`);

// ---- 6f. the worm's reach ----------------------------------------------------
ok(`nematodes.reach is ${WORM_REACH} cells`,
   Math.abs(await p.evaluate(()=>window.__cfg.nematodes.reach)-WORM_REACH)<1e-9,
   `got ${await p.evaluate(()=>window.__cfg.nematodes.reach)}`);
// It has to clear one growth segment, or a worm sitting ON a strand cannot touch that strand's
// own neighbours and strandsPerBite is capped by geometry rather than by the knob.
const reachVsSeg=await p.evaluate(()=>{
  const c=window.__cfg;
  return { reachUnits:c.nematodes.reach*36, seg:c.growth.segmentLength };
});
ok('the reach clears one growth segment, so a bite is not geometry-limited',
   reachVsSeg.reachUnits > reachVsSeg.seg,
   `reach ${reachVsSeg.reachUnits} units vs segment ${reachVsSeg.seg}`);

// ---- 6h. A WORM OUT OF SIGHT STILL CLOSES IN ---------------------------------
// ON A FRESH PAGE, for the same reason section 6 needs one: the probes above leave a hand-built
// three-node network behind, and worms that now actually arrive eat it — the nearest-distance
// metric came back as Infinity because there was no colony left to be near.
await ctx.close();
ctx=await b.newContext({viewport:{width:1400,height:800}});
await ctx.addInitScript(()=>{window.MYCELIUM_SUPABASE={url:'',anonKey:''};});
p=await boot(ctx, base+'/index.html#dev,turn');
// The bug this guards is "nematodes are failing to move at all", and it was never a movement
// bug: worms SEED at seedMinColonyDistFrac of the map width (0.25 x 2600 = 650 units) and see
// only 500, so a fresh worm has never been able to see the colony — and with "hold position
// when nothing is in sight" it sat still forever unless the player grew into its sight.
//
// A worm with no visible target now creeps toward the nearest strand WITHOUT needing line of
// sight, at wanderSpeed. Two things are asserted: that it closes at all, and that it does not
// STALL — straight-line pursuit deadlocks in a pocket where the heading and both axes are
// blocked, which measured as a worm crossing 200 units and then holding the same spot for the
// rest of the run.
const search=await p.evaluate(()=>{
  const G=window.__game, s=G.state, sub=s.substrate, net=s.active, cs=sub.cellSize;
  const n=s.config.nematodes;
  s.clouds.length=0; s.nematodes.length=0;
  // Grow the colony DOWN first. moveWorm's floor is surfaceY + one cell and a fresh colony's
  // root sits at surfaceY + 6, so a worm heading for it is aiming ABOVE its own movement bound
  // and gets deflected sideways instead of closing — 698 to 638 units over twelve steps.
  net.energy=99999; net.water=999;
  const r0n=net.nodes[0], c0n=sub.colAtX(r0n.x), r0r=sub.rowAtY(r0n.y);
  const feed=[];
  for (let c=c0n-2;c<=c0n+2;c++) for (let r=r0r+1;r<=r0r+8;r++) {
    if (!sub.inBounds(c,r)) continue;
    const cell=sub.cells[sub.index(c,r)]; cell.rock=0; cell.hazard=0;
    feed.push(sub.index(c,r));
  }
  for (let i=0;i<10;i++) {
    for (const j of feed) { const cl=sub.cells[j]; cl.nutrient=50; cl.maxNutrient=50; }
    s.runOver=false; s.winPending=false; s.won=false; net.alive=true;
    G.performAction(s,'grow',{});
  }
  G.settleEnemyTurn();
  s.clouds.length=0; s.nematodes.length=0;
  // ANT TRAILS OUT, and the ants with them. A line is a worm's other legitimate target and a
  // procedural map is criss-crossed with them, so a "blind" worm following one is the code
  // working. The per-spot scan at the end of this file has cleared them for the same reason.
  sub.forEachCell((cell)=>{ cell.antTrail=false; });
  if (s.ants) s.ants.length=0;
  const root=net.nodes[0];
  const minD=sub.worldWidth*n.seedMinColonyDistFrac;
  // 0 when the colony is GONE: the worms are dangerous enough now that twelve steps can eat a
  // small colony outright, and "there is nothing left to be near" is them succeeding, not the
  // metric failing. Reporting Infinity there made the closing assertion fail on a win.
  const nearest=()=>{ if (!net.nodes.length) return 0;
    let m=Infinity;
    for (const w of s.nematodes) for (const nd of net.nodes)
      m=Math.min(m, Math.hypot(nd.x-w.x, nd.y-w.y));
    return m===Infinity ? 0 : m; };
  let placed=0;
  for (let tries=0; tries<6000 && placed<6; tries++) {
    const x=cs*2+((tries*97)%Math.max(1,(sub.worldWidth-cs*4)));
    const y=sub.surfaceY+cs*2+((tries*53)%Math.max(1,(sub.growFloorY-sub.surfaceY-cs*4)));
    const c=sub.cellAtWorld(x,y); if (!c||c.rock) continue;
    if (Math.hypot(x-root.x, y-root.y) < minD) continue;
    // BLIND TO EVERY STRAND, not just far from the root. This probe GROWS THE COLONY DOWN ten
    // times before placing anything, so a spot beyond seedMinColonyDistFrac of the root can be
    // a hundred units from the colony's deepest tissue — and a worm that can genuinely see
    // mycelium is SUPPOSED to move, which read as `3 of 6 worms moved` and `nearest 111 -> 51`.
    // Same defect as the per-spot scan further down, which tested node 0 of thirty.
    let sighted=false;
    for (const nd of net.nodes) {
      if (Math.hypot(x-nd.x, y-nd.y) >= n.sightRadius) continue;
      if (!sub.segmentClear(x, y, nd.x, nd.y)) continue;
      sighted=true; break;
    }
    if (sighted) continue;
    s.nematodes.push({x,y,heading:0,phase:0,stuck:0,feedCd:0,hp:0,
                      sees:false,feeding:false,trailing:false,targetId:null});
    placed++;
  }
  if (!placed) return {err:'nowhere beyond the seed distance to place a worm'};
  // ONLY the worms this harness placed. tickWorld RESPAWNS worms, and a respawn arrives near
  // the colony with something in its sensing range — entirely legitimate movement that this
  // assertion is not about. Left in, the run measured 150 worms instead of 6 and read
  // `nearest 24 -> 0` off a worm the harness never positioned. Respawns are also spliced back
  // out after every step so they cannot eat the colony out from under the metric.
  const mine=s.nematodes.slice(-placed);
  const keepMine=()=>{ if (s.nematodes.length!==mine.length) s.nematodes.splice(0, s.nematodes.length, ...mine); };
  keepMine();
  const start=nearest();
  const seesAtStart=s.nematodes.some(w=>w.sees);
  const track=[];
  // PER-WORM stalls, not "did the nearest distance improve": nearest() is a min over every
  // worm, so a different worm becoming the closest one plateaus it while individuals are moving
  // fine — and a worm that ARRIVES and starts eating shortens the colony, which moves the
  // metric on its own. The property that matters is that no single worm sits at the same spot.
  const runs=new Map(), worstOf=new Map();
  const prev=new Map();
  for (const w of s.nematodes) prev.set(w, {x:w.x, y:w.y});
  for (let k=0;k<12;k++){
    s.runOver=false; s.winPending=false; s.won=false; net.alive=true;
    G.tickWorld(s);
    keepMine();
    track.push(nearest());
    for (const w of s.nematodes) {
      const q=prev.get(w); if (!q) { prev.set(w,{x:w.x,y:w.y}); continue; }
      const still=Math.hypot(w.x-q.x, w.y-q.y) < 0.5;
      // A FEEDING worm is meant to sit still — it is on the colony, eating. Only a worm that
      // is neither moving nor feeding is stuck.
      const stuck = still && !w.feeding;
      const r = stuck ? (runs.get(w)||0)+1 : 0;
      runs.set(w, r);
      worstOf.set(w, Math.max(worstOf.get(w)||0, r));
      q.x=w.x; q.y=w.y;
    }
  }
  let worst=0, everMoved=0;
  for (const v of worstOf.values()) worst=Math.max(worst,v);
  for (const [w, v] of worstOf) if (v < 12) everMoved++;
  return { err:null, placed, minSeedCells:minD/cs, sightCells:n.sightRadius/cs,
           start, end:track[track.length-1], worstStall:worst, everMoved,
           total:worstOf.size, seesAtStart };
});
ok('worms seed BEYOND their own sight radius (which is what caused this)',
   !search.err && search.minSeedCells > search.sightCells,
   search.err || `seeded >=${search.minSeedCells.toFixed(1)} cells out, sight is ${search.sightCells.toFixed(1)}`);
ok('...so a fresh worm can see nothing at all', !search.err && search.seesAtStart===false);
// It must MOVE, not close. This assertion used to require the pack to get materially nearer
// over 12 blind steps, which is only achievable by steering at a colony it cannot see — the
// omniscient homing the owner rejected ("they are not supposed to be able to see through
// rocks, lakes, etc"). A searching worm's distance is a random walk, so pinning its direction
// would be pinning the bug. What matters is that it does not sit still: `everMoved` below is
// the assertion that the original "nematodes never move" report is still fixed.
// A worm with nothing in sensing range DOES NOT MOVE. Not "closes in", not "searches" -- both
// of those were asserted here at different times and both are only satisfiable by senses these
// creatures do not have. The colony grows down during these 12 steps and some worms come into
// range legitimately, so this is the coarse "the pack did not converge" version; the rigorous
// per-worm measurement is further down, on a map with the ant trails cleared.
ok('a blind pack does not converge on the colony',
   !search.err && search.end >= search.start * 0.6,
   search.err || `nearest ${Math.round(search.start)} → ${Math.round(search.end)} units over 12 blind steps (homing reached 0)`);
// ...and they are HELD IN PLACE, which is the rule, not a stall to be fixed. This assertion
// used to demand the opposite — "most worms are moving" — which is why a fix for it reached for
// senses these creatures do not have. A worm that cannot sense anything is SUPPOSED to sit
// there. `worstStall` is the whole run for every one of them, and that is correct.
ok('...and every blind worm is held in place, which is the rule',
   !search.err && search.everMoved === 0,
   search.err || `${search.everMoved} of ${search.total} worms moved; longest stall ${search.worstStall} steps`);

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


// ---- A CONTACT BREACH DOES NOT CLAIM THE SUBTREE ---------------------------
// The regression guard for "I got infected and it immediately spread to almost all of my very
// big colony". infectDescendants used to run on EVERY tick, so a touch claimed everything
// downstream of the strand it caught -- and downstream of a node near the base is the colony.
//
// The assertions above this one never caught it because they call infectDescendants DIRECTLY;
// nothing exercised the per-tick path. This one goes through tickWorld, on a BRANCHING colony
// (the defect cannot exist on a linear chain), with the ring rates set to ZERO so the subtree
// claim would be the only mechanism able to act.
const breach = await p.evaluate(() => {
  const G=window.__game, s=G.state, sub=s.substrate, cs=sub.cellSize, net=s.active, t=s.config.trichoderma;
  s.nematodes.length=0; s.clouds.length=0;
  const TR=40, BR=10;
  net.nodes.length=0; net.byId.clear(); net.nextNodeId=0;
  const x0=sub.worldWidth/2, y0=sub.surfaceY+cs*2;
  const trunk=[]; let par=net.addNode(x0,y0,null); par._liveAt=0; trunk.push(par);
  for(let i=1;i<TR;i++){ par=net.addNode(x0,y0+i*4,par); par._liveAt=0; trunk.push(par); }
  for(const tn of trunk){ let q=tn; for(let j=1;j<=BR;j++){ q=net.addNode(tn.x+j*4,tn.y,q); q._liveAt=0; } }
  for(const n of net.nodes){ n.infected=false; n.rotAge=0;
    const c=sub.cellAtWorld(n.x,n.y); if(c){c.mouldProof=0;c.reinfectGrace=0;c.trich=0;} }
  const spread=t.spreadDepthPerTurn, ftr=t.firstTouchRings, life=t.rotLifeTurns;
  t.spreadDepthPerTurn=0; t.firstTouchRings=0; t.rotLifeTurns=999;
  net._spreadAccum=0;
  const at=20;
  trunk[at].infected=true;                      // an established breach, mid-trunk
  const before=net.nodes.filter(n=>n.infected).length;
  G.tickWorld(s);
  const after=net.nodes.filter(n=>n.infected).length;
  // the subtree that WOULD have died under the old rule
  const subtree=(TR-at)*(BR+1);
  t.spreadDepthPerTurn=spread; t.firstTouchRings=ftr; t.rotLifeTurns=life;
  return { total:net.nodes.length, before, after, subtree };
});
ok('a breach with the rates at zero claims nothing extra', breach.after === breach.before,
   `${breach.before} -> ${breach.after} of ${breach.total}`);
ok('and nowhere near the subtree the old per-tick rule took',
   breach.after < breach.subtree / 4,
   `${breach.after} claimed vs a ${breach.subtree}-strand subtree below the breach`);

// ---- BUT THE EXPLOIT IT WAS WRITTEN FOR IS STILL BLOCKED -------------------
// The owner's actual intent: you cannot play a long grow THROUGH a cloud, get caught, and run
// the far end on to the goal. That is now answered per strand at the win test by walking the
// ancestry, so it costs no other tissue.
const thru = await p.evaluate(() => {
  const G=window.__game, s=G.state, sub=s.substrate, cs=sub.cellSize, net=s.active;
  net.nodes.length=0; net.byId.clear(); net.nextNodeId=0;
  let par=net.addNode(sub.worldWidth/2, sub.surfaceY+cs*3, null); par._liveAt=0;
  for(let i=1;i<40;i++){ par=net.addNode(sub.worldWidth/2, sub.surfaceY+cs*3+i*4, par); par._liveAt=0; }
  for(const n of net.nodes){ n.infected=false; n.rotAge=0; }
  const tip=net.nodes[net.nodes.length-1];
  const cleanTip=G.reachedThroughRot(net, tip);          // nothing infected yet
  net.nodes[10].infected=true;                            // the strand that went through mould
  return { cleanTip, throughRot:G.reachedThroughRot(net, tip),
           aboveTheRot:G.reachedThroughRot(net, net.nodes[5]),
           theRotItself:net.nodes[10].infected };
});
ok('a clean strand does not read as reached-through-rot', thru.cleanTip === false);
ok('a strand beyond rot DOES, so it cannot fruit', thru.throughRot === true);
ok('a strand ABOVE the rot is unaffected', thru.aboveTheRot === false);


// ---- NOTHING IN SENSING RANGE => NO MOVEMENT -------------------------------
// Reported twice now in different forms, so it gets an assertion. A worm that cannot SEE the
// colony must not steer at it: measure the angle between its heading after one step and the
// bearing to the colony, over every spot on the map that is out of sightRadius AND has no
// clear line. Homing reads ~0 degrees; searching is spread.
//
// Measured: the omniscient version had a MEDIAN of 1 degree with 90% of worms steering within
// 30 degrees of straight at a colony they could not possibly see. Searching reads ~86 median,
// ~14% within 30 -- which is what chance gives over a 180-degree spread.
// A FRESH page. Everything above this has been rebuilding colonies and clearing cells in the
// live world, and this measurement needs a map that still has its rock: on the reused page the
// scan found ZERO spots that were open, out of range and blind, so it measured nothing and
// reported it as a pass-shaped null.
const sp = await boot(ctx, base + '/index.html?sense#dev,turn');
const sense = await sp.evaluate(() => {
  const G=window.__game,s=G.state,sub=s.substrate,net=s.active,cs=sub.cellSize,n=s.config.nematodes;
  s.clouds.length=0;
  // ANT TRAILS OUT. A worm follows a LINE within sensing range, and that is correct -- leaving
  // them in made 6% of "blind" worms move for a perfectly good reason.
  sub.forEachCell((cell) => { cell.antTrail = false; });
  if (s.ants) s.ants.length = 0;
  net.nodes.length=0; net.byId.clear(); net.nextNodeId=0;
  const cx=400, cy=sub.surfaceY+cs*4;
  let par=net.addNode(cx,cy,null); par._liveAt=0;
  for(let i=1;i<30;i++){ par=net.addNode(cx+(i%5)*6, cy+Math.floor(i/5)*6, par); par._liveAt=0; }
  let n0=0, movedN=0, turnedN=0;
  for (let gx=900; gx<sub.worldWidth-100; gx+=60)
    for (let gy=sub.surfaceY+40; gy<sub.worldHeight-40; gy+=60) {
      if (sub.solidAtWorld(gx,gy)) continue;
      // Against EVERY node, not just the seed. The colony is 30 nodes spanning ~24x36 units,
      // so a spot just outside sightRadius of node 0 can be inside it for the far corner, and
      // one with no clear line to node 0 can have one to another node. That gap put a single
      // legitimately-sighted worm in the sample and read as "1 of 362 blind worms moved".
      let anyNear=false;
      for (const nd of net.nodes) if (Math.hypot(gx-nd.x,gy-nd.y) < n.sightRadius) { anyNear=true; break; }
      if (anyNear) continue;                                   // must be out of range of ALL of it
      let anyClear=false;
      for (const nd of net.nodes) if (sub.segmentClear(gx,gy,nd.x,nd.y)) { anyClear=true; break; }
      if (anyClear) continue;                                  // and blind to ALL of it
      s.nematodes.length=0;
      s.nematodes.push({x:gx,y:gy,hp:n.maxHp,heading:0.75,targetId:null,sees:false,trailing:false});
      const w=s.nematodes[0];
      G.tickWorld(s);
      n0++;
      if (Math.hypot(w.x-gx, w.y-gy) > 0.01) movedN++;
      if (w.heading !== 0.75) turnedN++;                  // seeded with a fixed heading
    }
  return { n:n0, moved:movedN, turned:turnedN };
});
await sp.close();
ok('a blind worm does not move at all', sense.n > 50 && sense.moved === 0,
   `${sense.moved} of ${sense.n} blind worms moved`);
ok('and does not even turn toward the colony', sense.n > 50 && sense.turned === 0,
   `${sense.turned} of ${sense.n} changed heading (the homing version steered 90% within 30°)`);

await b.close(); srv.close();

console.log(`==== ${PASS} passed, ${FAIL} failed ====`);
process.exit(FAIL?1:0);
})();
