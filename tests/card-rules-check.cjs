/* THE CARDS DO WHAT THEIR DESCRIPTIONS NOW SAY.
 *
 * A batch of card text was rewritten in the card tool, and several of the new lines promise
 * behaviour the code did not have: two cards went from a cooldown to ONCE PER LEVEL, three
 * cadences moved, a trap that caught one worm now catches five, a snap that took one now takes
 * three, and a burst's Phosphorus cap halved. `card-tool-check` guards the DATA — that the page
 * and CARD_DATA agree — and cannot see any of this: the promise is in CARD_DATA and the behaviour
 * is in EFFECTS, and nothing joins them but a reader.
 *
 * So this measures the behaviour through the real sim and, where the number is quotable, checks
 * the card's own text still quotes it. That second half is the point: a retune that moves the
 * code and leaves the text is exactly as wrong as one that moves the text and leaves the code,
 * and it is the direction this batch travelled in.
 *
 * `__game.play`/`activate` go straight to the engine (ungated), which is what a rules check wants.
 */
const http = require('http'), fs = require('fs'), path = require('path');
const { chromium } = require('playwright');
const ROOT = path.resolve(__dirname, '..');
const T = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.png': 'image/png',
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.svg': 'image/svg+xml', '.webp': 'image/webp',
  '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.css': 'text/css' };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let pass = 0, fail = 0;
const ok = (n, c, x) => { c ? (pass++, console.log('  PASS  ' + n + (x ? '  — ' + x : ''))) : (fail++, console.log('  FAIL  ' + n + (x ? '  — ' + x : ''))); };

(async () => {
  const srv = await new Promise((res) => { const s = http.createServer((rq, rs) => {
    let p = decodeURIComponent(rq.url.split('?')[0].split('#')[0]); if (p === '/') p = '/index.html';
    const fp = path.join(ROOT, p);
    if (!fp.startsWith(ROOT) || !fs.existsSync(fp) || fs.statSync(fp).isDirectory()) { rs.writeHead(404); rs.end('nf'); return; }
    rs.writeHead(200, { 'Content-Type': T[path.extname(fp)] || 'application/octet-stream' });
    fs.createReadStream(fp).pipe(rs); }); s.listen(0, () => res(s)); });
  const base = 'http://localhost:' + srv.address().port;
  const browser = await chromium.launch({ headless: true, executablePath: '/opt/pw-browsers/chromium' });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await ctx.newPage();
  const errs = []; page.on('pageerror', (e) => errs.push(String(e && e.message)));
  await page.addInitScript(() => { window.MYCELIUM_SUPABASE = { url: '', anonKey: '' }; });
  // TURN-BASED: a world step is one player action, so the cadences below are countable. In real
  // time the same numbers are wall-clock and could only be measured with a stopwatch.
  await page.goto(base + '/index.html#dev,turn', { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#loadscreen.ld-ready', { timeout: 25000 }).catch(() => {});
  await page.click('#loadscreen', { timeout: 5000 }).catch(() => {});
  await page.waitForFunction(() => !!(window.__game && window.__game.cards), { timeout: 25000 });
  await sleep(900);

  const CARD = await page.evaluate(() => {
    const o = {}; for (const c of window.__game.cards.data()) o[c.name] = c; return o;
  });
  const CFG = await page.evaluate(() => JSON.parse(JSON.stringify(window.__cfg.cards)));
  // Read once: does applyCarry still clear `usedLevel` for EVERY perLevel action? That line is
  // what makes "once per level" renew, and it is the one part of this rule a page cannot show.
  const SRC = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const CLEARS_ON_CARRY = /for \(const a of \(st\.cards\.actions \|\| \[\]\)\) if \(a\.perLevel\) a\.usedLevel = 0;/.test(SRC);

  // ---- 1. the two cards that became ONCE PER LEVEL ----------------------------
  // Both halves, because neither alone distinguishes the three plausible implementations:
  // a second use must be refused, forty more actions must not hand it back (a per-ROUND
  // counter passes the first and fails the second), and the next level must renew it (a
  // never-resetting counter passes both and fails that).
  for (const name of ['Sinker Rhizomorph', 'Melanized Wall']) {
    console.log(`\n-- ${name} --`);
    ok(`${name}: the card says once per level`, /once per level/i.test(CARD[name].effect), CARD[name].effect);
    const r = await page.evaluate(async (n) => {
      const g = window.__game, s = g.state;
      // Install it directly: playing it needs the resources and a hand slot, and the install is
      // not what is under test.
      s.cards.actions.length = 0;
      const res = g.effects[n].apply(s, null, {});
      const a = res.installAction; a.name = n; a.used = 0; a.cd = 0; a.usedLevel = 0;
      s.cards.actions.push(a);
      const spec = { every: a.every || null, perLevel: a.perLevel || null, cost: a.cost, res: a.res };
      // Make the effect itself always succeed, so what is measured is the GATE and not whether
      // there happened to be a rock or a mould patch under the tap.
      a.apply = () => ({ ok: true, message: 'ok' });
      s.active.phosphorus = 999; s.active.water = 999; s.active.energy = 999;
      const first = g.activate(0, { x: s.active.nodes[0].x + 40, y: s.active.nodes[0].y + 40 });
      const second = g.activate(0, { x: s.active.nodes[0].x + 40, y: s.active.nodes[0].y + 40 });
      return { spec, first: !!(first && first.ok), second: !!(second && second.ok),
               secondMsg: (second && second.message) || '', usedLevel: a.usedLevel };
    }, name);
    ok(`${name}: ...and carries perLevel rather than a per-round cap`,
       r.spec.perLevel === 1 && !r.spec.every, JSON.stringify(r.spec));
    ok(`${name}: the first use works`, r.first === true);
    ok(`${name}: ...and the second is refused`, r.second === false && /spent for this level/i.test(r.secondMsg),
       r.secondMsg || '(no message)');
    // A per-ROUND counter would come back here. `produceCardEngines` zeroes `used` on every round
    // boundary, so this is the assertion that tells the two apart.
    const back = await page.evaluate(async () => {
      const g = window.__game, s = g.state;
      for (let i = 0; i < 40; i++) g.tickWorld(s);
      const a = s.cards.actions[0];
      return { used: a.used, usedLevel: a.usedLevel, again: !!(g.activate(0, { x: s.active.nodes[0].x + 40, y: s.active.nodes[0].y + 40 }) || {}).ok };
    });
    ok(`${name}: ...and 40 world steps do not hand it back`, back.again === false,
       `used ${back.used}, usedLevel ${back.usedLevel}`);
    // ...but the next LEVEL renews it, and this is where a check can lie to itself. Re-running
    // applyCarry's line here and then watching the counter go to zero asserts nothing — it is the
    // test doing the work. So: the SOURCE must carry the clearing line (over every `perLevel`
    // action, not just the two specials it was written for), and the BEHAVIOUR is exercised on a
    // real level transition by `special-check`, which shares this exact mechanism.
    ok(`${name}: ...and applyCarry clears usedLevel for every perLevel action`,
       CLEARS_ON_CARRY, CLEARS_ON_CARRY ? 'applyCarry clears it' : 'no clearing line found in applyCarry');
  }

  // ---- 2. the three cadences that moved --------------------------------------
  console.log('\n-- cadences --');
  const cad = await page.evaluate(() => {
    const g = window.__game, s = g.state, out = {};
    for (const n of ['Crust Reserve', 'Capillary Runners', 'Dew Traps']) {
      const res = g.effects[n].apply(s, null, {});
      const o = res.installAction || res.install;
      out[n] = { every: o.every, water: o.water != null ? o.water : null };
    }
    return out;
  });
  const want = { 'Crust Reserve': 8, 'Capillary Runners': 8, 'Dew Traps': 7 };
  for (const [n, e] of Object.entries(want)) {
    ok(`${n}: fires every ${e} rounds`, cad[n].every === e, `every ${cad[n].every}`);
    // AND THE CARD SAYS SO. This is the half that would have caught the drift this batch fixed.
    // Two phrasings in the shipped text — an engine says "every 8 rounds", an action says "Once
    // per 8 rounds". Match the NUMBER against the cadence rather than one house style.
    ok(`${n}: ...and the card text agrees`,
       new RegExp('(every|once per) ' + e + ' rounds', 'i').test(CARD[n].effect), CARD[n].effect);
  }
  ok('Capillary Runners still pays +3 Water', cad['Capillary Runners'].water === 3, String(cad['Capillary Runners'].water));
  ok('Dew Traps still pays +2 Water', cad['Dew Traps'].water === 2, String(cad['Dew Traps'].water));

  // ---- 3. Constricting Ring: five worms, +1 P each, paid in WATER -------------
  console.log('\n-- Constricting Ring --');
  ok('the trap knob says 5', CFG.trapCharges === 5, String(CFG.trapCharges));
  ok('...and the card text says 5', /first 5 to enter/i.test(CARD['Constricting Ring'].effect), CARD['Constricting Ring'].effect);
  // AN INSTALLED ACTION'S costW/costP ON THE CARD FACE **IS** ITS PER-USE PRICE, and the two live
  // in different files — CARD_DATA and the EFFECTS spec — with nothing joining them. The card now
  // says 2 W, so the spec has to charge 2 W or the card lies about what it takes.
  const ring = await page.evaluate(() => {
    const g = window.__game, s = g.state;
    const a = g.effects['Constricting Ring'].apply(s, null, {}).installAction;
    return { cost: a.cost, res: a.res, every: a.every };
  });
  ok('the per-use price is what the card face prints',
     ring.cost === CARD['Constricting Ring'].costW && ring.res === 'water' && CARD['Constricting Ring'].costP === 0,
     `spec ${ring.cost} ${ring.res}, face ${CARD['Constricting Ring'].costW}W/${CARD['Constricting Ring'].costP}P`);
  const trap = await page.evaluate(() => {
    const g = window.__game, s = g.state;
    s.clouds = []; s.config.trichoderma.respawnChance = 0; s.config.nematodes.respawnChance = 0;
    s.active.phosphorus = 0; s.active.energy = 9999;
    const root = s.active.nodes[0];
    const tx = root.x + 200, ty = root.y + 200;
    s.traps = [];
    const a = g.effects['Constricting Ring'].apply(s, null, {}).installAction;
    a.name = 'Constricting Ring'; a.used = 0; a.cd = 0;
    s.cards.actions.length = 0; s.cards.actions.push(a);
    s.active.water = 999;
    const set = g.activate(0, { x: tx, y: ty });
    const laid = (s.traps || [])[0];
    // READ THE TRAP BEFORE THE TICK — the tick is what spends it, so `charges` read afterwards is
    // whatever is LEFT and always looked like 0.
    const laidWith = { charges: laid && laid.charges, reward: laid && laid.reward };
    // Eight worms parked in the ring: more than it can hold, so "five" is measurable rather than
    // "however many happened to be nearby".
    s.nematodes = [];
    for (let i = 0; i < 8; i++) s.nematodes.push({ x: tx + (i % 3) - 1, y: ty + ((i / 3) | 0) - 1, dir: 0, hp: 3, _probe: 1 });
    // A PROBE MEASURES WHATEVER THE WORLD PUT THERE. `tickWorld` respawns worms AND breeds them
    // (`breedChance` 0.8 on a feeding tick), so counting the array afterwards read "ate 2" while
    // the Phosphorus said five. Count the ones this probe PLACED, and turn breeding off as well.
    s.config.nematodes.breedChance = 0;
    const before = s.nematodes.filter((w) => w._probe).length, p0 = s.active.phosphorus;
    g.tickWorld(s);
    return { set: !!(set && set.ok), charges: laidWith.charges, reward: laidWith.reward,
             ate: before - s.nematodes.filter((w) => w._probe).length,
             gained: Math.round(s.active.phosphorus - p0),
             trapLeft: (s.traps || []).length };
  });
  ok('setting the ring works', trap.set === true);
  ok('...and the trap is laid with 5 charges at +1 P each', trap.charges === 5 && trap.reward === 1,
     `charges ${trap.charges}, reward ${trap.reward}`);
  ok('...it digests exactly 5 of the 8 worms standing in it', trap.ate === 5, `ate ${trap.ate}`);
  ok('...paying +1 P each, so +5', trap.gained === 5, `+${trap.gained} P`);
  ok('...and is spent afterwards', trap.trapLeft === 0, `${trap.trapLeft} trap(s) left`);

  // ---- 4. Constricting Snap: the nearest 3, +1 P each -------------------------
  console.log('\n-- Constricting Snap --');
  ok('the knob says 3', CFG.snapTargets === 3, String(CFG.snapTargets));
  ok('...and the card text says 3', /nearest 3 nematodes/i.test(CARD['Constricting Snap'].effect), CARD['Constricting Snap'].effect);
  const snap = await page.evaluate(() => {
    const g = window.__game, s = g.state;
    const root = s.active.nodes[0], tx = root.x + 300, ty = root.y + 150;
    const R = s.config.cards.snapRadius;
    s.nematodes = [];
    for (let i = 0; i < 5; i++) s.nematodes.push({ x: tx + i * 6, y: ty, dir: 0, hp: 3 });     // all in range
    s.nematodes.push({ x: tx + R * 4, y: ty, dir: 0, hp: 3 });                                 // far out of range
    s.active.phosphorus = 0;
    const before = s.nematodes.length, p0 = s.active.phosphorus;
    const r = g.effects['Constricting Snap'].apply(s, null, { x: tx, y: ty });
    return { ok: !!(r && r.ok), msg: r && r.message, ate: before - s.nematodes.length,
             gained: Math.round(s.active.phosphorus - p0), farLeft: s.nematodes.length };
  });
  ok('it digests 3 of the 5 in range', snap.ok && snap.ate === 3, `ate ${snap.ate} — ${snap.msg}`);
  ok('...for +1 P each, so +3', snap.gained === 3, `+${snap.gained} P`);
  ok('...leaving the out-of-range worm alone', snap.farLeft === 3, `${snap.farLeft} worms left of 6`);
  // Fewer than 3 in range must still work — a card that refused unless three were there would be
  // dead most of the time, and the owner's wording ("the nearest 3") does not promise a minimum.
  const snapOne = await page.evaluate(() => {
    const g = window.__game, s = g.state;
    const root = s.active.nodes[0], tx = root.x + 300, ty = root.y + 150;
    s.nematodes = [{ x: tx, y: ty, dir: 0, hp: 3 }];
    s.active.phosphorus = 0;
    const r = g.effects['Constricting Snap'].apply(s, null, { x: tx, y: ty });
    return { ok: !!(r && r.ok), left: s.nematodes.length, gained: Math.round(s.active.phosphorus) };
  });
  ok('...and one worm in range is still a legal play', snapOne.ok && snapOne.left === 0 && snapOne.gained === 1,
     `${snapOne.left} left, +${snapOne.gained} P`);

  // ---- 5. Toxocyst Burst: the KILL is uncapped, the PAY caps at 5 -------------
  console.log('\n-- Toxocyst Burst --');
  ok('the cap knob says 5', CFG.toxocystCapP === 5, String(CFG.toxocystCapP));
  ok('...and the card text says max 5 P', /max 5 P/i.test(CARD['Toxocyst Burst'].effect), CARD['Toxocyst Burst'].effect);
  const burst = await page.evaluate(() => {
    const g = window.__game, s = g.state;
    const root = s.active.nodes[0], tx = root.x + 300, ty = root.y + 150;
    s.nematodes = [];
    for (let i = 0; i < 9; i++) s.nematodes.push({ x: tx + (i % 3) * 4, y: ty + ((i / 3) | 0) * 4, dir: 0, hp: 3 });
    s.active.phosphorus = 0;
    const before = s.nematodes.length;
    const r = g.effects['Toxocyst Burst'].apply(s, null, { x: tx, y: ty });
    return { ok: !!(r && r.ok), killed: before - s.nematodes.length, gained: Math.round(s.active.phosphorus), msg: r && r.message };
  });
  ok('nine worms in range all die', burst.ok && burst.killed === 9, `killed ${burst.killed} — ${burst.msg}`);
  ok('...but it pays only 5 P', burst.gained === 5, `+${burst.gained} P`);
  // THE BLUE BONNET SPECIAL HAS ITS OWN, LOWER CAP AND MUST NOT FOLLOW THIS ONE. Its 7 used to sit
  // BELOW the card's 10; the card is at 5 now, so the special is the more generous of the two and
  // a shared constant would silently have changed it.
  const special = await page.evaluate(() => {
    const src = String(window.__game.specialSource || '');
    return { has: src.length > 0 };
  }).catch(() => ({ has: false }));
  const spCap = await page.evaluate(() => {
    const g = window.__game, s = g.state;
    const sp = (g.cards.special && g.cards.special('toxic')) || null;
    return sp ? sp.cap : null;
  }).catch(() => null);
  ok('...and the Blue Bonnet special keeps its own cap of 7', spCap === null || spCap === 7,
     spCap === null ? 'not exposed — asserted by special-check instead' : String(spCap));

  // ---- 5b. a tab-close must not hand a once-per-level use back ----------------
  // Installed actions are stored by NAME and rebuilt by replaying the install, which restores
  // `used` and `cd` and knows nothing about `usedLevel`. That is exactly how the species specials
  // once handed out a second free use, and these two cards walked into the same hole. The
  // snapshot carries `actionsUsedLevel` now; an OLDER save has no such key and must still load.
  console.log('\n-- resume --');
  const resumed = await page.evaluate(() => {
    const g = window.__game, s = g.state;
    s.cards.actions.length = 0;
    const a = g.effects['Sinker Rhizomorph'].apply(s, null, {}).installAction;
    a.name = 'Sinker Rhizomorph'; a.used = 0; a.cd = 0; a.usedLevel = 1;   // spent this level
    s.cards.actions.push(a);
    const snap = g.snapshot();
    const carried = (snap.cards || {}).actionsUsedLevel || {};
    g.rebuildCards(s, snap);
    const back = (s.cards.actions || []).find((x) => x.name === 'Sinker Rhizomorph');
    // ...and the old-save shape: the same snapshot with the key deleted must still rebuild.
    const old = JSON.parse(JSON.stringify(snap)); delete old.cards.actionsUsedLevel;
    g.rebuildCards(s, old);
    const legacy = (s.cards.actions || []).find((x) => x.name === 'Sinker Rhizomorph');
    return { carried: carried['Sinker Rhizomorph'] || 0, after: back ? back.usedLevel : null,
             legacy: legacy ? legacy.usedLevel : null };
  });
  ok('the resume snapshot records that it was spent', resumed.carried === 1, `actionsUsedLevel = ${resumed.carried}`);
  ok('...and a rebuild does not hand the use back', resumed.after === 1, `usedLevel ${resumed.after} after rebuild`);
  ok('...while an older save with no such key still loads', resumed.legacy === 0, `usedLevel ${resumed.legacy}`);

  // ---- 6. the pure-wording edits changed nothing they should not --------------
  console.log('\n-- wording only --');
  // "anywhere in direct line of sight" is a more accurate description of a rule that was already
  // there (dropDecoyCache tests segmentClear from a colony node). Asserted so the wording stops
  // being a claim nobody checked.
  const los = await page.evaluate(() => {
    const g = window.__game, s = g.state;
    const root = s.active.nodes[0];
    const near = g.effects['Decoy Cache'].apply(s, null, { x: root.x + 60, y: root.y + 60 });
    // Far across the map: on a rocky level the line is very unlikely to be clear, but do not
    // assert a refusal — assert that the REASON, when it refuses, is line of sight.
    const far = g.effects['Decoy Cache'].apply(s, null, { x: s.substrate.worldWidth - 40, y: root.y + 500 });
    return { near: !!(near && near.ok), farOk: !!(far && far.ok), farMsg: (far && far.message) || '', losHint: !!(far && far.losHint) };
  });
  ok('Decoy Cache drops beside the colony', los.near === true);
  ok('...and when it refuses, it refuses on line of sight',
     los.farOk || (/clear line/i.test(los.farMsg) && los.losHint), los.farOk ? 'reached it (clear line)' : los.farMsg);

  ok('no page errors', errs.length === 0, errs.slice(0, 2).join(' | '));
  console.log(`\n==== ${pass} passed, ${fail} failed ====`);
  await browser.close(); srv.close();
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('HARNESS ERROR', e); process.exit(1); });
