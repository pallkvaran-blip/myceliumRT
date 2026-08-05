/* The campaign store, which IS the species-selection screen: three colonies you start with,
 * four for sale, six permanent upgrade tracks, all bought with Spores.
 *
 * What this is really guarding, in the order the mistakes are easy to make:
 *   - THE MONEY. A purchase must debit exactly the listed price, once, and must be refused when
 *     the wallet is short or the track is maxed. A shop that can be clicked twice on one balance
 *     is the only bug here the player would report as theft.
 *   - THE EFFECT, NOT THE SETTING. Every track is capped by something else downstream (see
 *     CLAUDE.md: `freshGrowthRings` 24 -> 80 moved 5 strands in 870), so each assertion reads the
 *     thing the run loop reads — `effectiveSpecies().res`, the death-carry caps — never
 *     `upgrades.water` on its own. Two of these fail if only the number moves.
 *   - ADDITIVE ONLY. At zero upgrades every one of these paths must behave exactly as it did
 *     before the store existed. Engines staying in the main death-carry pool until the engine
 *     track is bought is the case that needed the negative control.
 *   - The SCREEN's shape, which is now the owner's spec rather than an accident: THREE colonies
 *     you own and FOUR for sale, both visible from the start, no "?" tiles and no tier rows; a
 *     Select button UNDER each tile; and a detail sheet with NO buttons but the X. Each of those
 *     is a thing a later refactor could quietly undo, so each is asserted directly.
 *
 * Runs entirely on the picker (no run needed), so it is seconds rather than minutes.
 */
const http = require('http'); const fs = require('fs'); const path = require('path');
const { chromium } = require('playwright');
const ROOT = path.resolve(__dirname, '..');
const TYPES = { '.html':'text/html','.js':'text/javascript','.json':'application/json','.png':'image/png',
  '.jpg':'image/jpeg','.jpeg':'image/jpeg','.svg':'image/svg+xml','.webp':'image/webp','.mp3':'audio/mpeg','.wav':'audio/wav','.css':'text/css' };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let pass = 0, fail = 0;
const ok = (n, c, x) => { c ? (pass++, console.log('  PASS  ' + n + (x ? '  — ' + x : ''))) : (fail++, console.log('  FAIL  ' + n + (x ? '  — ' + x : ''))); };

(async () => {
  const srv = await new Promise((res) => { const s = http.createServer((rq, rs) => {
    let p = decodeURIComponent(rq.url.split('?')[0].split('#')[0]); if (p === '/') p = '/index.html';
    const fp = path.join(ROOT, p);
    if (!fp.startsWith(ROOT) || !fs.existsSync(fp) || fs.statSync(fp).isDirectory()) { rs.writeHead(404); rs.end('nf'); return; }
    rs.writeHead(200, { 'Content-Type': TYPES[path.extname(fp)] || 'application/octet-stream' });
    fs.createReadStream(fp).pipe(rs); }); s.listen(0, () => res(s)); });
  const base = 'http://localhost:' + srv.address().port;
  const browser = await chromium.launch({ headless: true, executablePath: '/opt/pw-browsers/chromium' });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const errs = []; page.on('pageerror', (e) => errs.push(String(e && e.message)));
  page.on('console', (m) => { if (m.type() === 'error') errs.push('console:' + m.text()); });
  page.on('requestfailed', (r) => errs.push('reqfail:' + r.url().slice(-70)));
  page.on('response', (r) => { if (r.status() >= 400) errs.push('http' + r.status() + ':' + r.url().slice(-70)); });
  // Never let a probe write to the live leaderboard.
  await page.addInitScript(() => { window.MYCELIUM_SUPABASE = { url: '', anonKey: '' }; });

  // A dev boot gets us a live `__game` (the store model hangs off it) without playing anything.
  await page.goto(base + '/index.html#dev', { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#loadscreen.ld-ready', { timeout: 25000 }).catch(() => {});
  await page.click('#loadscreen', { timeout: 5000 }).catch(() => {});
  await page.waitForFunction(() => window.__game && window.__game.store && window.__game.showPicker, null, { timeout: 25000 });
  for (let i = 0; i < 4 && await page.$('#levelIntro'); i++) { await page.mouse.click(720, 450); await sleep(1000); }

  const wipe = () => page.evaluate(() => window.__game.store.reset());

  // ---- the tracks themselves ------------------------------------------------
  const shape = await page.evaluate(() => {
    const S = window.__game.store;
    return S.upgrades.map((u) => ({ id: u.id, steps: u.costs.length, step: u.step, base: u.base || 0,
      costs: u.costs.slice(), name: u.name, effect: u.effect,
      rising: u.costs.every((c, i) => i === 0 || c > u.costs[i - 1]) }));
  });
  // Order matters as well as membership: the three resource tracks come first, in the game's own
  // energy / water / phosphorus order, so the store reads in the order of the numbers it raises.
  ok('six upgrade tracks, in the owner\'s order',
     shape.map((s) => s.id).join(',') === 'energy,water,phosphorus,carryCards,carryEngines,lives',
     shape.map((s) => s.id).join(','));
  // The owner set these three by hand; they are the whole point of the last pass.
  const stepOf = (id) => (shape.find((s) => s.id === id) || {}).step;
  ok('the resource steps are the ones the owner asked for',
     stepOf('energy') === 3 && stepOf('water') === 5 && stepOf('phosphorus') === 3,
     `energy +${stepOf('energy')}, water +${stepOf('water')}, phosphorus +${stepOf('phosphorus')}`);
  // The owner set every ladder by hand. Pinned ABSOLUTELY, not as a shape: these are the prices
  // the store is being played at, and a diff against the previous commit would pass trivially.
  const track = (id) => shape.find((t) => t.id === id) || {};
  const ladder = (id) => (track(id).costs || []).join(',');
  // A CHEAPER FIRST RUNG, then the old +50 ladder shifted down one (owner: "reduce the cost of
  // the first resource purchases and basic/event memory to 25 (so it now goes 25, 50, 100, …)").
  // The step COUNT is unchanged and only the bottom moved, so the top of each track comes down a
  // rung — 450 rather than 500, 950 rather than 1000, 1000 rather than 1200. Pinned in full,
  // because "25 then double" fits those same three numbers and would put the 20th basic/event
  // step at 13 million Spores; the shape has to be readable from the assertion, not inferred.
  const RES = '25,50,100,150,200,250,300,350,400,450';
  ok('the three resource tracks open at 25, then run the +50 ladder',
     ladder('energy') === RES && ladder('water') === RES && ladder('phosphorus') === RES,
     ladder('energy'));
  ok('Basic/Event Memory runs the same ladder to twenty',
     track('carryCards').steps === 20 && ladder('carryCards').startsWith('25,50,100')
       && ladder('carryCards').endsWith('900,950'), `${track('carryCards').steps} steps, ${ladder('carryCards')}`);
  ok('Engine Memory opens at 100, then six steps of +200',
     ladder('carryEngines') === '100,200,400,600,800,1000', ladder('carryEngines'));
  // The first rung of every track a run can open with is now ONE level's clear rather than two.
  // That is the change the owner asked for, stated as the thing it does rather than as a number.
  ok('the first purchase on every carry/resource track is 25 or 100',
     [track('energy'), track('water'), track('phosphorus'), track('carryCards')].every((t) => t.costs[0] === 25)
       && track('carryEngines').costs[0] === 100,
     `resources/cards ${track('energy').costs[0]}, engines ${track('carryEngines').costs[0]}`);
  ok('Retries are four steps at 100/250/400/600',
     ladder('lives') === '100,250,400,600', ladder('lives'));
  ok('every track has at least one step and a per-step value',
     shape.every((s) => s.steps > 0 && s.step > 0), JSON.stringify(shape.map((s) => s.id + ':' + s.steps + 'x' + s.step)));
  // Not a taste judgement: a flat price ladder means the last step of a track costs what the
  // first did, and there is then no reason to ever buy anything else first.
  ok('each track\'s prices rise step by step', shape.every((s) => s.rising),
     shape.filter((s) => !s.rising).map((s) => s.id).join(',') || 'all rising');

  // The tile copy is the owner's, word for word — it is what a player reads to decide.
  const names = shape.map((t) => t.name).join(' | ');
  ok('the tracks are named the way the owner named them',
     names === 'Energy | Water | Phosphorus | Basic/Event Carry | Engine Carry | Retries', names);
  // ALL SIX SUB-LINES ARE THE OWNER'S, word for word, and every one of them now opens with
  // "Increase" — they describe what BUYING A STEP does rather than what a run starts with, which
  // is the question a player standing in front of a Buy button is asking. Pinned in full rather
  // than by keyword: this is the copy, so a rewording should have to be a deliberate edit here.
  const sub = (id) => (shape.find((t) => t.id === id) || {}).effect || '';
  ok('each resource track says what buying a step increases',
     sub('energy') === 'Increase starting energy by <b>3</b>.'
       && sub('water') === 'Increase starting water by <b>5</b>.'
       && sub('phosphorus') === 'Increase starting phosphorus by <b>3</b>.',
     sub('energy') + ' / ' + sub('water') + ' / ' + sub('phosphorus'));
  ok('the memory tracks say what they carry between runs',
     sub('carryCards') === 'Increase the number of basic or event cards you carry over between runs by <b>1</b>.'
       && sub('carryEngines') === 'Increase the number of engine cards you carry over between runs by <b>1</b>.',
     sub('carryCards') + ' / ' + sub('carryEngines'));
  ok('Retries says what it increases',
     sub('lives') === 'Increase the number of times you can retry a level by <b>1</b>.', sub('lives'));
  // THE NUMBER IN THE SENTENCE IS THE TRACK'S OWN `step`, not a literal that happens to agree.
  // Phosphorus went 2 → 3 in the same breath as the rewording, and a sub-line saying "by 2" over
  // a track that grants 3 is the one failure this copy can have that reads as fine.
  const stepInSub = (id) => { const m = /<b>(\d+)<\/b>/.exec(sub(id)); return m ? +m[1] : null; };
  ok('...and every sentence quotes its own step',
     ['energy', 'water', 'phosphorus', 'carryCards', 'carryEngines', 'lives']
       .every((id) => stepInSub(id) === stepOf(id)),
     ['energy', 'water', 'phosphorus', 'carryCards', 'carryEngines', 'lives']
       .map((id) => `${id}: says ${stepInSub(id)}, grants ${stepOf(id)}`).join(' · '));
  const bases = {};
  for (const t of shape) bases[t.id] = t.base || 0;
  // TWO tracks have a base — what you have before buying a step. Retries is 1 (everyone gets
  // one), Basic/Event Memory is 3. The memory baseline used to be a bare `3 +` at the run loop,
  // where the store could not see it, so the tile reported "none yet" about an allowance the
  // player already had. Asserted per track rather than as "only lives has one", because that
  // phrasing is what silently went stale when the second base arrived.
  ok('the tracks with a base are Retries (1) and Basic/Event Memory (3)',
     bases.lives === 1 && bases.carryCards === 3
       && bases.energy === 0 && bases.water === 0 && bases.phosphorus === 0 && bases.carryEngines === 0,
     Object.entries(bases).map(([k, v]) => k + ':' + v).join(' '));

  // THE ROSTER SIZE IS A DESIGN DECISION, NOT AN INVARIANT — 3 starters and 4 for sale is today's
  // shape, and it is edited from docs/species-tool.html. Six assertions here hard-coded 3 and 4, so
  // the first deliberate lineup change would have produced six red lines with nothing wrong. What is
  // asserted now is the RULE (the screen shows exactly the starter list as owned and exactly the
  // store list as for sale, each colony priced, no overlap) with a coverage floor so "shows nothing"
  // cannot pass. The counts are printed on every line, so a change is visible rather than silent.
  const roster = await page.evaluate(() => ({
    starters: window.__game.store.starters().map((s) => s.id),
    store: window.__game.store.species().map((s) => s.id),
  }));
  const N_START = roster.starters.length, N_SALE = roster.store.length;
  ok('there is an opening roster at all', N_START >= 1, `${N_START}: ${roster.starters.join(', ')}`);
  const four = await page.evaluate(() => window.__game.store.species().map((s) => s.id + '@' + window.__game.store.speciesCost(s)));
  ok('the store has colonies for sale', four.length === N_SALE && N_SALE >= 1, four.join(', '));
  ok('every for-sale colony carries a price', four.every((s) => +s.split('@')[1] > 0), four.join(', '));
  ok('no colony is both free and for sale', roster.store.every((id) => roster.starters.indexOf(id) < 0),
     `starters ${roster.starters.join('/')} vs store ${roster.store.join('/')}`);

  // ---- buying: the wallet ---------------------------------------------------
  const money = await page.evaluate(() => {
    const S = window.__game.store;
    S.reset();
    const cost = S.nextCost('water');
    S.credit(cost);                                      // exactly enough for one step
    const before = S.balance();
    const first = S.buy('water');
    const afterOne = S.balance();
    const second = S.buy('water');                        // broke now — must be refused
    return { cost, before, first: first.ok, afterOne, lvl1: S.level('water'),
             second: second.ok, afterTwo: S.balance(), lvl2: S.level('water') };
  });
  ok('a step debits exactly its listed price',
     money.first === true && money.afterOne === money.before - money.cost,
     `${money.before} - ${money.cost} -> ${money.afterOne}`);
  ok('a second click on an empty wallet is refused, and costs nothing',
     money.second === false && money.afterTwo === money.afterOne && money.lvl2 === money.lvl1,
     `ok=${money.second} balance ${money.afterOne} -> ${money.afterTwo}, level ${money.lvl1} -> ${money.lvl2}`);

  const maxed = await page.evaluate(() => {
    const S = window.__game.store;
    S.reset(); S.credit(1e6);
    const steps = S.upgrades.find((u) => u.id === 'lives').costs.length;
    let bought = 0;
    for (let i = 0; i < steps + 3; i++) if (S.buy('lives').ok) bought++;     // over-buy on purpose
    return { steps, bought, level: S.level('lives'), next: S.nextCost('lives'), value: S.value('lives'),
             base: S.upgrades.find((u) => u.id === 'lives').base || 0 };
  });
  ok('a track stops at its last step however often it is bought',
     maxed.bought === maxed.steps && maxed.level === maxed.steps && maxed.next === null,
     `bought ${maxed.bought} of ${maxed.steps}, level ${maxed.level}, next ${maxed.next}`);
  // Retries carry a BASE of 1 on top of what is bought — everyone starts with one.
  ok('a maxed track reports its full bonus, base included',
     maxed.value === maxed.steps + maxed.base, `+${maxed.value} retries (${maxed.steps} bought + ${maxed.base} base)`);

  // A hand-edited (or retuned-away) level must not report a bonus with no price behind it.
  const clamp = await page.evaluate(() => {
    const S = window.__game.store;
    const p = JSON.parse(localStorage.getItem('mycelium.progress.v2'));
    p.upgrades.lives = 99; localStorage.setItem('mycelium.progress.v2', JSON.stringify(p));
    return { level: S.level('lives'), max: S.upgrades.find((u) => u.id === 'lives').costs.length };
  });
  ok('an out-of-range saved level is clamped to the track', clamp.level === clamp.max, `${clamp.level} of ${clamp.max}`);

  // ---- buying a colony ------------------------------------------------------
  const spBuy = await page.evaluate(() => {
    const S = window.__game.store;
    S.reset();
    const sp = S.species()[0];
    const cost = S.speciesCost(sp);
    const poor = S.buySpecies(sp);                        // 0 spores
    S.credit(cost);
    const rich = S.buySpecies(sp);
    const again = S.buySpecies(sp);                       // already owned — must be free
    const prog = JSON.parse(localStorage.getItem('mycelium.progress.v2'));
    return { id: sp.id, cost, poor: poor.ok, rich: rich.ok, again: again.ok, playable: S.playable(sp),
             balance: S.balance(), owned: !!prog.purchased[sp.id], revealed: !!prog.revealedSpecies[sp.id] };
  });
  ok('a colony cannot be bought without the Spores', spBuy.poor === false, `${spBuy.id} at ${spBuy.cost}`);
  ok('paying for a colony buys it and empties the wallet',
     spBuy.rich === true && spBuy.owned === true && spBuy.balance === 0, JSON.stringify(spBuy));
  // The store is the campaign's own unlock path: it must NOT wait on the tier that reveals the
  // species, and it has to record the reveal so the old picker shows it as playable rather than
  // as a "?" it can never open.
  ok('a store purchase reveals the colony as well as owning it', spBuy.revealed === true, JSON.stringify(spBuy));
  ok('buying an owned colony again is free and harmless',
     spBuy.again === true && spBuy.balance === 0, `ok=${spBuy.again}, balance ${spBuy.balance}`);
  // isPlayable = revealed AND purchased, which is what "Your colonies" reads.
  ok('a bought colony is playable from the species picker', spBuy.playable === true, spBuy.id);

  // With the tier rows retired, REVEALING a species no longer means the screen can offer it —
  // a level clear still walks the old ladder, and the troll rock still reveals Magic Mushroom.
  // Both announcements filter on `isObtainable`, so a reward is never promised with nowhere to
  // collect it. This is the assertion that the dead end stays closed.
  // PICKED FROM THE LISTS, NOT NAMED. This used to hard-code marasmius / cortinarius / suillus, so
  // moving any one of the three in the species tool made the assertion measure the opposite of what
  // it says (a "tier only" colony that is now a starter is obtainable, correctly, and read as the
  // dead end having opened). It asks the game which colonies are in which category instead.
  const reach = await page.evaluate(() => {
    const S = window.__game.store;
    S.reset();
    const by = (id) => S.speciesById(id);
    const starterIds = S.starters().map((s) => s.id);
    const saleIds = S.species().map((s) => s.id);
    const all = S.all ? S.all() : null;
    // A colony that is neither free nor for sale — the dead end this assertion is about. On a roster
    // where every colony is obtainable there is nothing to measure, which is reported rather than
    // passed silently.
    const tierOnlyId = (all || []).map((s) => s.id)
      .find((id) => starterIds.indexOf(id) < 0 && saleIds.indexOf(id) < 0) || null;
    const before = {
      starterId: starterIds[0], forSaleId: saleIds[0], tierOnlyId,
      starter: S.obtainable(by(starterIds[0])),
      forSale: S.obtainable(by(saleIds[0])),
      tierOnly: tierOnlyId ? S.obtainable(by(tierOnlyId)) : null,
      rockOnly: S.obtainable(by('psilocybe')),
    };
    // A tier species the player ALREADY OWNS stays reachable — it just has no row of its own.
    if (!tierOnlyId) return { ...before, ownedTier: null };
    const p = JSON.parse(localStorage.getItem('mycelium.progress.v2') || '{}');
    p.purchased = p.purchased || {}; p.revealedSpecies = p.revealedSpecies || {};
    p.purchased[tierOnlyId] = true; p.revealedSpecies[tierOnlyId] = true;
    localStorage.setItem('mycelium.progress.v2', JSON.stringify(p));
    return { ...before, ownedTier: S.obtainable(by(tierOnlyId)) };
  });
  ok('there is an unobtainable colony to measure the dead end on', reach.tierOnlyId != null,
     reach.tierOnlyId || 'every colony is a starter or for sale — nothing to assert');
  ok('a starter and a for-sale colony are obtainable',
     reach.starter === true && reach.forSale === true, JSON.stringify(reach));
  // THE RULE, not a list of ids: nothing the screen cannot offer may be announced as a reward. This
  // used to name psilocybe as the unobtainable case (`rockOnly === false`) — and the owner has since
  // PUT MAGIC MUSHROOM IN THE STORE at 350, so it is obtainable now and that reading is simply wrong.
  // Which is a real behaviour change worth knowing about rather than asserting away: the troll rock's
  // `showSpeciesUnlocked` filters on isObtainable, so buying psilocybe back into the store REOPENS a
  // reward moment that had been a dead end. Asserted as the invariant instead — a colony that is
  // neither a starter, nor for sale, nor owned is not obtainable — with psilocybe's own status merely
  // reported, so the next roster change reads as information and not as a failure.
  ok('a colony with no row and no price is NOT announced as a reward', reach.tierOnly === false,
     `${reach.tierOnlyId} obtainable=${reach.tierOnly}` +
     ` · psilocybe (the troll rock's reveal) obtainable=${reach.rockOnly}` +
     `${reach.rockOnly ? ' — it is in the store, so that reward moment is live again' : ''}`);
  ok('a tier colony already owned stays obtainable', reach.ownedTier === true, JSON.stringify(reach));

  // ---- the EFFECTS, read where the run loop reads them ----------------------
  const res = await page.evaluate(() => {
    const S = window.__game.store;
    S.reset();
    const base = S.speciesById('marasmius');
    // The opening is UNIVERSAL now — CONFIG's base plus the tracks — so it is read from the
    // store, not off the species. `base.res` used to be the number here and is undefined today;
    // reading it would have thrown, which is exactly how this check reported the change.
    const before = S.start();
    S.credit(1e6);
    S.buy('water'); S.buy('water'); S.buy('phosphorus'); S.buy('energy'); S.buy('energy');
    const eff = S.effectiveSpecies(base).res;
    return { before, after: { water: eff.water, phosphorus: eff.phosphorus, energy: eff.energy },
             wBonus: S.value('water'), pBonus: S.value('phosphorus'), eBonus: S.value('energy'),
             // A species must still carry no resources of its own after a seed — effectiveSpecies
             // builds a COPY, and writing the sum back onto the table would compound it every run.
             tableStillBare: base.res === undefined };
  });
  ok('bought water reaches the run as starting water',
     res.after.water === res.before.water + res.wBonus, `${res.before.water} + ${res.wBonus} -> ${res.after.water}`);
  ok('bought phosphorus reaches the run as starting phosphorus',
     res.after.phosphorus === (res.before.phosphorus || 0) + res.pBonus,
     `${res.before.phosphorus || 0} + ${res.pBonus} -> ${res.after.phosphorus}`);
  ok('bought energy reaches the run as starting energy',
     res.after.energy === res.before.energy + res.eBonus, `${res.before.energy} + ${res.eBonus} -> ${res.after.energy}`);
  ok('the species table still declares no resources of its own', res.tableStillBare === true,
     'marasmius.res is undefined after a seed');

  const zero = await page.evaluate(() => {
    const S = window.__game.store;
    S.reset();
    const base = S.speciesById('marasmius');
    const eff = S.effectiveSpecies(base);
    const c = window.__cfg;
    // With nothing bought, a run opens on the CONFIG base exactly — no species contribution and
    // no stray bonus. This is the assertion that would catch the base being applied twice.
    return { same: eff.res.water === c.cards.startWater && eff.res.phosphorus === c.cards.startPhosphorus
                   && eff.res.energy === c.energy.start,
             opening: eff.res, bonuses: S.bonuses() };
  });
  // With nothing bought every track reads 0 except the two with a base: Retries 1, and
  // Basic/Event Memory 3.
  ok('with nothing bought a run opens on the universal base',
     zero.same === true && ['energy', 'water', 'phosphorus', 'carryEngines']
       .every((k) => zero.bonuses[k] === 0) && zero.bonuses.lives === 1 && zero.bonuses.carryCards === 3,
     JSON.stringify(zero.opening) + ' ' + JSON.stringify(zero.bonuses));

  // ---- the death-carry caps ------------------------------------------------
  const carry = await page.evaluate(() => {
    const g = window.__game, S = g.store;
    // THE COUNTER MOVED INTO THE TITLE on the death layout (owner: "move the 0/3 to the title line
    // so it says Choose cards to add to your next deck (0/3)"), which closed the gap between the two
    // carousel frames. It is `#loTitleCount` there and `.lo-count` on the memory layout; read either,
    // or these three assertions go to `null` and read as the whole carry feature being broken.
    const read = () => {
      const el = document.querySelector('#loadoutSelect .lo-count')
              || document.querySelector('#loadoutSelect #loTitleCount');
      const instr = document.querySelector('#loadoutSelect .lo-h-instr');
      return { count: el ? el.textContent : null, instr: instr ? instr.textContent : null };
    };
    const shut = () => { const r = document.getElementById('loadoutSelect'); if (r) r.remove(); };
    const out = {};
    // A death carousel needs a run whose `runPlayed` has something in it. Fake exactly that:
    // one engine (Cord Capillary) and one basic, then open the screen through the real path.
    const seed = () => { g.state.cards.runPlayed = { 'Cord Capillary': 1, 'Turgor Thrust': 2 }; };
    S.reset();
    seed(); S.deathCarry({ cause: 'devoured', runSpores: 0 }); out.none = read(); shut();
    S.credit(1e6);
    S.buy('carryCards'); S.buy('carryCards');
    seed(); S.deathCarry({ cause: 'devoured', runSpores: 0 }); out.cards = read(); shut();
    S.buy('carryEngines');
    seed(); S.deathCarry({ cause: 'devoured', runSpores: 0 }); out.eng = read();
    // With an engine allowance the pool row shows both categories; the engine has to be there.
    const row = document.querySelector('#loadoutSelect .lo-list');
    out.engPool = row ? [...row.querySelectorAll('[data-name]')].map((n) => n.getAttribute('data-name')) : [];
    out.engHasEngine = out.engPool.includes('Cord Capillary');
    shut();
    out.bonus = S.bonuses();
    return out;
  }).catch((e) => ({ err: String(e && e.message) }));
  if (carry.err) {
    ok('the death carousel opens for the carry assertions', false, carry.err);
  } else {
    // At zero upgrades the cap is the baseline 3 (the track's `base`) and there is NO engine
    // meter — the negative control for the whole feature. Parenthesised in the title ("(0/3)") and
    // bare in the mid block ("0 / 3"), so the digits and the cap are what is asserted, not the
    // punctuation around them.
    ok('with nothing bought the carry cap is unchanged and has no engine meter',
       /^\s*\(?\s*\d+\s*\/\s*3\s*\)?\s*$/.test((carry.none.count || '').replace(/ /g, ' ')) && !/engine/i.test(carry.none.count || ''),
       JSON.stringify(carry.none));
    // NO `3 +` here any more: the baseline is the carryCards track's own `base`, so
    // `bonuses.carryCards` already includes it and adding 3 again expects a cap twice the size.
    ok('bought card memory widens the basic/event cap',
       (carry.cards.count || '').includes('/ ' + carry.bonus.carryCards) ||
       (carry.cards.count || '').includes('/' + carry.bonus.carryCards),
       `${carry.cards.count} (cap = base 3 + bought = ${carry.bonus.carryCards})`);
    // The "(N from the Store)" note is GONE (owner) — it explained an allowance nobody had
    // asked about, next to a heading that already says how many to pick. What still has to be
    // true is the thing it was evidence for, and that is the CAP asserted just above: buying the
    // track widens the meter. Nothing about the wording is load-bearing, so nothing replaces it.
    ok('bought engine memory adds a SEPARATE engine meter',
       /engines?/i.test(carry.eng.count || '') && (carry.eng.count || '').includes('/' + carry.bonus.carryEngines),
       `${carry.eng.count} (bonus +${carry.bonus.carryEngines})`);
    // ...and the engine actually goes IN it. Cord Capillary is `type: engine` but
    // `displayCategory: event`, so splitting on the draft field left the engine meter permanently
    // empty and the assertion above passed on an empty pool.
    ok('an engine card is metered as an engine', carry.engHasEngine === true,
       `engine pool: ${(carry.engPool || []).join(', ') || 'empty'}`);
  }

  // ---- the screen ----------------------------------------------------------
  // ONE screen: the colonies you own, the colonies for sale, and the upgrades.
  await page.evaluate(() => {
    window.__game.store.reset();
    window.__game.store.credit(12000);
    document.querySelectorAll('#speciesSelect, #ssStore, #loadoutSelect').forEach((n) => n.remove());
    window.__game.showPicker();
  });
  await page.waitForSelector('#speciesSelect #ssUpg .ss-upg', { timeout: 15000 });
  await sleep(600);
  const ui = await page.evaluate(() => {
    const root = document.getElementById('speciesSelect');
    if (!root) return { missing: true };
    const slots = (sel) => [...root.querySelectorAll(sel + ' .ss-slot')];
    const own = slots('#ssAvail'), sale = slots('#ssForSale');
    const btnText = (l) => l.map((sl) => (sl.querySelector('.ss-selbtn') || {}).textContent.trim().replace(/\s+/g, ' '));
    return {
      title: !!root.querySelector('.ss-title canvas'),
      wallet: (root.querySelector('#ssWallet') || {}).textContent,
      lede: root.querySelectorAll('.ss-lede').length,
      // The owner's spec, in numbers.
      owned: own.length, forSale: sale.length,
      ownNames: own.map((sl) => sl.querySelector('.ss-sp-name').textContent),
      ownBtns: btnText(own), saleBtns: btnText(sale),
      // Every tile has exactly one commit button, under its card, not inside it.
      buttonsUnderCards: [...own, ...sale].every((sl) => {
        const c = sl.querySelector('.ss-card'), b = sl.querySelector('.ss-selbtn');
        return !!c && !!b && !c.contains(b) &&
          b.getBoundingClientRect().top >= c.getBoundingClientRect().bottom - 1;
      }),
      // Retired with the tier rows: no "?" tiles, no "Complete level N" headers.
      mystery: root.querySelectorAll('.ss-lock-card').length,
      tierRows: [...root.querySelectorAll('.ss-lk')].filter((n) => /complete level|\?/i.test(n.textContent)).length,
      headers: [...root.querySelectorAll('.ss-lk')].map((n) => n.textContent),
      tracks: root.querySelectorAll('#ssUpg .ss-upg').length,
      pips: root.querySelectorAll('#ssUpg .ss-upg-pip').length,
      buyable: [...root.querySelectorAll('.ss-upg-btn')].filter((b) => !b.disabled).length,
      storeScreen: !!document.getElementById('ssStore'),
      hints: root.querySelectorAll('.ss-rowhint, .ss-hint').length,
    };
  });
  ok('the species screen opens', !ui.missing);
  ok('there is no separate store screen any more', ui.storeScreen === false);
  ok('it still grows its mycelium wordmark', ui.title === true);
  ok('the wallet shows the balance', /12000/.test(ui.wallet || ''), ui.wallet);
  // The owner's spec: "the campaign mode only has a total of 3 species at start and then N more
  // available for purchase (viewable from the start)". Asserted against the LISTS (see N_START /
  // N_SALE above) rather than against the numbers, so editing the lineup from the species tool does
  // not turn four green lines red for no reason.
  ok('the screen owns exactly the opening roster', ui.owned === N_START, `${ui.owned} of ${N_START}: ${ui.ownNames.join(', ')}`);
  ok('...and offers exactly the store list, visible from the start', ui.forSale === N_SALE, `${ui.forSale} of ${N_SALE}`);
  ok('every available species has a Start Run button',
     ui.ownBtns.length === N_START && ui.ownBtns.every((t) => t === 'Start Run'), ui.ownBtns.join(' | '));
  ok('every for-sale colony has an Unlock button with a price',
     ui.saleBtns.length === N_SALE && ui.saleBtns.every((t) => /^Unlock\s*\d+$/.test(t)), ui.saleBtns.join(' | '));
  // "below each is a Select button" — geometry, not just presence.
  ok('the button sits BELOW its card, not inside it', ui.buttonsUnderCards === true);
  ok('no "?" tiles remain', ui.mystery === 0, String(ui.mystery));
  ok('no "Complete level N" tier rows remain', ui.tierRows === 0, ui.headers.join(' / '));
  ok('the three sections are named the way the owner named them',
     ui.headers.join('|') === 'Available|Purchase|Upgrades', ui.headers.join(' / '));
  ok('six upgrade tiles', ui.tracks === 6, String(ui.tracks));
  ok('the sections carry no sub-headings any more', ui.hints === 0, String(ui.hints));
  // ...and neither does the screen itself: the header is the title and the two chips, nothing else.
  ok('there is no blurb under the title', ui.lede === 0, String(ui.lede));
  ok('every tile draws one pip per step it has',
     ui.pips === shape.reduce((a, s) => a + s.steps, 0), `${ui.pips} pips vs ${shape.reduce((a, s) => a + s.steps, 0)} steps`);
  ok('affordable steps are clickable', ui.buyable > 0, `${ui.buyable} buyable at 12000 Spores`);

  // The dev wallet top-up. It exists so the store can be TRIED — "unlock all" hands you every
  // species and leaves the shop with nothing to sell, so it is no substitute.
  const devSpores = await page.evaluate(async () => {
    const S = window.__game.store;
    S.reset();
    document.querySelectorAll('#speciesSelect').forEach((n) => n.remove());
    window.__game.showPicker();
    await new Promise((r) => setTimeout(r, 400));
    const btn = document.getElementById('ssDevSpores');
    const before = S.balance();
    if (btn) btn.click();
    await new Promise((r) => setTimeout(r, 200));
    const wallet = (document.getElementById('ssWallet') || {}).textContent || '';
    // ...and it must not have unlocked anything: the store still has four colonies to sell.
    const forSale = document.querySelectorAll('#ssForSale .ss-slot').length;
    return { present: !!btn, label: btn ? btn.textContent.trim() : null, before, after: S.balance(), wallet, forSale };
  });
  ok('there is a dev button for Spores', devSpores.present === true, devSpores.label);
  ok('it credits 10,000', devSpores.after === devSpores.before + 10000,
     `${devSpores.before} → ${devSpores.after}`);
  ok('...and the wallet on screen follows', /10000/.test(devSpores.wallet), devSpores.wallet);
  ok('...without unlocking anything, so there is still a store to test',
     devSpores.forSale === N_SALE, `${devSpores.forSale} of ${N_SALE} still for sale`);

  // ---- the deck: the button, the count, and the sheet ----------------------
  // The deck IS the campaign's persistence, so the viewer has to be honest about it: the count is
  // COPIES not names, the sheet lists every card, and an empty deck teaches the mechanic instead
  // of showing a blank box.
  const deckEmpty = await page.evaluate(async () => {
    window.__game.deck.clear();
    document.querySelectorAll('#speciesSelect').forEach((n) => n.remove());
    window.__game.showPicker();
    await new Promise((r) => setTimeout(r, 400));
    const btn = document.getElementById('ssDeckBtn');
    btn.click();
    await new Promise((r) => setTimeout(r, 350));
    const wrap = document.getElementById('ssDeckWrap');
    return { n: document.getElementById('ssDeckN').textContent, dim: btn.classList.contains('empty'),
             btn: btn.textContent, open: !!(wrap && wrap.classList.contains('open')),
             title: (wrap.querySelector('.ss-deckhead h2') || {}).textContent || '',
             sub: ((wrap.querySelector('#ssDeckSub') || {}).textContent || '').trim(),
             body: (wrap.querySelector('#ssDeckBody') || {}).textContent || '',
             faces: wrap.querySelectorAll('#ssDeckBody .ss-gc').length };
  });
  ok('an empty deck reads 0 and the button dims', deckEmpty.n === '0' && deckEmpty.dim === true,
     `"${deckEmpty.n}", dim=${deckEmpty.dim}`);
  ok('the button is labelled Deck', /^Deck\s*0$/.test((deckEmpty.btn || '').replace(/\s+/g, ' ').trim()),
     deckEmpty.btn);
  ok('the sheet is titled Your Deck', deckEmpty.title === 'Your Deck', deckEmpty.title);
  ok('an empty deck says so, and says where cards come from',
     deckEmpty.open === true && deckEmpty.faces === 0 && deckEmpty.sub === 'No cards.'
       && /add a certain number of cards to your deck at the end of each run/i.test(deckEmpty.body),
     `"${deckEmpty.sub}" / ${deckEmpty.body.slice(0, 70)}`);

  const deckFull = await page.evaluate(async () => {
    const g = window.__game;
    document.querySelector('#ssDeckClose').click();
    // One of each category, and a card with several copies, so the grouping and the copies
    // count are both exercised.
    g.deck.set([{ name: 'Turgor Thrust', count: 4 }, { name: 'Cord Capillary', count: 1 },
                { name: 'Rhizomorph Lance', count: 2 }]);
    document.querySelectorAll('#speciesSelect').forEach((n) => n.remove());
    g.showPicker();
    await new Promise((r) => setTimeout(r, 400));
    document.getElementById('ssDeckBtn').click();
    await new Promise((r) => setTimeout(r, 350));
    const wrap = document.getElementById('ssDeckWrap');
    const names = [...wrap.querySelectorAll('#ssDeckBody .ss-gc-name')].map((n) => n.textContent);
    return { n: document.getElementById('ssDeckN').textContent, size: g.deck.size(),
             dim: document.getElementById('ssDeckBtn').classList.contains('empty'),
             names, groups: [...wrap.querySelectorAll('.ss-deckgrp')].map((n) => n.textContent.replace(/\s+/g, ' ').trim()),
             sub: (wrap.querySelector('#ssDeckSub') || {}).textContent || '',
             counts: [...wrap.querySelectorAll('#ssDeckBody .ss-gc-count')].map((n) => n.textContent) };
  });
  // 4 + 1 + 2 = 7 COPIES across 3 names. A viewer that counts names says 3, which is the bug
  // this pins: "how big is my deck" has one answer and it is copies.
  ok('the button counts COPIES, not distinct cards', deckFull.n === '7' && deckFull.size === 7,
     `button "${deckFull.n}", model ${deckFull.size}, from ${deckFull.names.length} names`);
  ok('a non-empty deck undims the button', deckFull.dim === false);
  ok('every card in the deck is shown', deckFull.names.length === 3, deckFull.names.join(', '));
  // Alphabetical inside a group, so the order is Rhizomorph Lance (2), Turgor Thrust (4), then
  // the Engine group's Cord Capillary (1). Pinned because a stable order is the point of sorting.
  ok('copies are shown per card, in a stable order', deckFull.counts.join(',') === '×4,×2,×1',
     deckFull.counts.join(',') + ' (want ×4,×2,×1: Turgor Thrust, then Event, then Engine)');
  // Grouped by the card's own `type` badge, in play order — a deck is judged by its shape, not
  // as a pile. Rhizomorph Lance is the card that pins this: `type: event` but
  // `displayCategory: basic`, so grouping by the wrong field files an EVENT-badged card under a
  // BASIC heading and the sheet contradicts itself.
  ok('the deck is grouped by the card\'s own type badge',
     deckFull.groups.length === 3 && /^Basic/.test(deckFull.groups[0])
       && /^Event/.test(deckFull.groups[1]) && /^Engine/.test(deckFull.groups[2]),
     deckFull.groups.join(' / '));
  ok('the sheet states the total', /7 cards/.test(deckFull.sub), deckFull.sub.slice(0, 70));

  await page.evaluate(() => { document.querySelector('#ssDeckClose').click(); window.__game.deck.clear(); });

  // ---- the end-of-run pool: played, drafted AND already owned ---------------
  // The pool used to be what you CAST, which made the deck impossible to hold on to — an owned
  // card you never drew was gone at the end of the run. All three sources must reach the screen.
  const keepPool = await page.evaluate(async () => {
    const g = window.__game;
    g.deck.clear();
    const st = g.state;
    st.cards.runPlayed = { 'Turgor Thrust': 1 };
    st.cards.runDrafted = { 'Foraging Fan': 2 };
    st.cards.runDraftedEngines = { 'Cord Capillary': 1 };
    // What the run seeded with. `withDeathCarry` consumed the stored copy, so this is the only
    // record of it — the assertion is that showDeathCarry reads it back.
    const owned = g.deck.owned();
    g.store.deathCarry({ cause: 'devoured', runSpores: 0 });
    await new Promise((r) => setTimeout(r, 250));
    // Death layout = pool on TOP, selection below (showLoadoutSelect's `poolTop`), so the pool
    // is the FIRST .lo-list. Taking the last one silently reads the empty selection row.
    const lower = document.querySelector('#loadoutSelect .lo-list');
    const names = lower ? [...lower.querySelectorAll('[data-name]')].map((n) => n.getAttribute('data-name')) : [];
    const label = (document.querySelectorAll('#loadoutSelect .lo-label')[0] || {}).textContent || '';
    const instr = (document.querySelector('#loadoutSelect .lo-h-instr') || {}).textContent || '';
    // The screen's own title. The death title and sub-line moved out to showDeathScreen, so
    // "deck" now lives here rather than in the instruction under it.
    const htitle = (document.querySelector('#loadoutSelect .lo-h-title') || {}).textContent || '';
    document.getElementById('loadoutSelect').remove();
    return { names, label, instr, htitle, ownedAtSeed: owned.length };
  });
  ok('cards you PLAYED are offered to keep', keepPool.names.includes('Turgor Thrust'), keepPool.names.join(', '));
  ok('cards you DRAFTED are offered to keep', keepPool.names.includes('Foraging Fan'), keepPool.names.join(', '));
  ok('engines you drafted are offered too', keepPool.names.includes('Cord Capillary'), keepPool.names.join(', '));
  // The label over the pool is "Cards from this run: click to add" now (owner) — the old one
  // spelled out the three sources ("Played, drafted and already owned"), which is accurate and
  // is not what a label is for. The three sources are still asserted where it matters: by the
  // three assertions directly above, which check each one is actually IN the pool.
  ok('the pool label says these are this run\'s cards, and that clicking adds them',
     /this run/i.test(keepPool.label) && /add/i.test(keepPool.label), keepPool.label);
  // Against the HEADER. There is ONE heading now (owner) — the instruction is the title, and
  // "Your deck for the next run" above it said the same thing in the abstract.
  ok('it asks you to add cards to your DECK, not just carry them',
     /deck/i.test(keepPool.htitle + ' ' + keepPool.instr), (keepPool.htitle + ' / ' + keepPool.instr).trim());

  // The case the whole `runDeck` variable exists for: a card you OWNED coming in but never drew,
  // never played and never drafted. Seeding consumes the stored deck, so without remembering it
  // that card is gone at the end of the run and the deck resets itself every time.
  const ownedKept = await page.evaluate(async () => {
    const g = window.__game, st = g.state;
    g.deck.set([{ name: 'Acorn Cache', count: 3 }]);
    g.deck.seed(g.store.speciesById('marasmius'));   // ← loads, remembers, and CLEARS storage
    const storedAfterSeed = g.deck.size();
    st.cards.runPlayed = { 'Turgor Thrust': 1 };     // Acorn Cache never cast, never drafted
    st.cards.runDrafted = {}; st.cards.runDraftedEngines = {};
    g.store.deathCarry({ cause: 'devoured', runSpores: 0 });
    await new Promise((r) => setTimeout(r, 250));
    const lower = document.querySelector('#loadoutSelect .lo-list');
    const faces = lower ? [...lower.querySelectorAll('[data-name]')] : [];
    const acorn = faces.find((n) => n.getAttribute('data-name') === 'Acorn Cache');
    const out = { storedAfterSeed, offered: !!acorn, names: faces.map((n) => n.getAttribute('data-name')),
                  remembered: g.deck.owned().length };
    document.getElementById('loadoutSelect').remove();
    g.deck.clear();
    return out;
  });
  ok('seeding a run consumes the stored deck', ownedKept.storedAfterSeed === 0, String(ownedKept.storedAfterSeed));
  ok('but the run REMEMBERS what it opened with', ownedKept.remembered === 1, String(ownedKept.remembered));
  ok('a card you owned and never drew is still offered to keep',
     ownedKept.offered === true, ownedKept.names.join(', '));

  // ---- the detail sheet: no buttons but the X ------------------------------
  const sheet = await page.evaluate(async () => {
    const root = document.getElementById('speciesSelect');
    root.querySelector('#ssAvail .ss-card').click();
    await new Promise((r) => setTimeout(r, 350));
    const wrap = document.getElementById('ssInspector');
    const open = !!(wrap && wrap.classList.contains('open'));
    // Every button inside the sheet, and whether the actions row survived at all.
    const btns = wrap ? [...wrap.querySelectorAll('button')].map((b) => (b.id || b.className) + ':' + b.textContent.trim().slice(0, 14)) : [];
    const acts = wrap ? wrap.querySelector('#ssIActions') : null;
    const actsShown = !!(acts && acts.offsetParent !== null);
    const name = wrap ? wrap.querySelector('#ssIName').textContent : null;
    const hand = wrap ? wrap.querySelectorAll('#ssIHand .ss-gc').length : 0;
    // #ssIRes is gone entirely — not merely emptied — so this counts the ELEMENT, which is
    // what would come back if the pills were ever restored.
    const res = wrap ? wrap.querySelectorAll('#ssIRes, .ss-respill').length : 0;
    return { open, btns, actsShown, name, hand, res };
  });
  ok('pressing a colony opens its details', sheet.open === true, sheet.name);
  // The owner's ask, and the one most likely to be undone by a later "helpful" addition.
  ok('the details carry NO buttons but the X',
     sheet.btns.length === 1 && /ssIClose/.test(sheet.btns[0]), sheet.btns.join(' | ') || '(none)');
  ok('the actions row is gone rather than merely empty', sheet.actsShown === false);
  // NO resource pills. Starting energy / water / phosphorus are universal — CONFIG's base plus
  // the store's three tracks — so a figure printed beside a mushroom's portrait would describe
  // the player, not the colony. The store tiles carry those numbers instead. The hand stays: it
  // IS the species.
  ok('the details show the hand and no starting resources',
     sheet.hand > 0 && sheet.res === 0, `${sheet.hand} cards, ${sheet.res} resource elements`);

  const closed = await page.evaluate(() => {
    document.querySelector('#ssIClose').click();
    return !document.querySelector('#ssInspector.open');
  });
  ok('the X closes it', closed === true);

  // ---- buying through the real buttons -------------------------------------
  const clicked = await page.evaluate(async () => {
    const S = window.__game.store;
    const before = S.level('water');
    const bal0 = S.balance();
    document.querySelector('#speciesSelect .ss-upg-btn[data-upg="water"]').click();
    await new Promise((r) => setTimeout(r, 150));
    return { before, bal0, after: S.level('water'), spent: bal0 - S.balance(),
             pipsOn: document.querySelectorAll('#speciesSelect .ss-upg.water .ss-upg-pip.on').length,
             wallet: document.querySelector('#ssWallet').textContent };
  });
  ok('clicking Buy buys one step and re-renders the tile',
     clicked.after === clicked.before + 1 && clicked.pipsOn === clicked.after, JSON.stringify(clicked));
  // Against the balance READ AT THE TIME, not a number written up the file — an earlier probe
  // that credits or resets the wallet would otherwise break this from a distance.
  ok('the wallet on screen follows the purchase',
     clicked.wallet.includes(String(clicked.bal0 - clicked.spent)),
     `${clicked.bal0} - ${clicked.spent} → ${clicked.wallet}`);

  // Unlocking a colony MOVES it: out of New colonies and up into Your colonies, where its button
  // is now a Select. That is the whole shape of the merged screen in one assertion.
  const moved = await page.evaluate(async () => {
    const root = document.getElementById('speciesSelect');
    const btn = root.querySelector('#ssForSale .ss-selbtn');
    const nameBefore = root.querySelector('#ssForSale .ss-sp-name').textContent;
    btn.click();
    await new Promise((r) => setTimeout(r, 200));
    const names = (sel) => [...root.querySelectorAll(sel + ' .ss-sp-name')].map((n) => n.textContent);
    const own = names('#ssAvail');
    return { nameBefore, owned: own.length, has: own.includes(nameBefore), forSale: names('#ssForSale').length,
             btn: (root.querySelector('#ssAvail .ss-slot:nth-child(4) .ss-selbtn') || {}).textContent };
  });
  // One MOVES: owned goes up by one and for-sale down by one, whatever the roster's size.
  ok('unlocking a colony moves it into Your colonies with a Select button',
     moved.has === true && moved.owned === N_START + 1 && moved.forSale === N_SALE - 1,
     `${moved.nameBefore}: owned ${moved.owned} (want ${N_START + 1}), for sale ${moved.forSale} (want ${N_SALE - 1})`);

  await page.screenshot({ path: path.join(__dirname, '.artifacts', 'store.png'),
    animations: 'disabled', timeout: 8000 }).catch(() => {});
  console.log('  shot → tests/.artifacts/store.png');

  await wipe();
  ok('no page errors', errs.length === 0, errs.slice(0, 3).join(' | '));
  // The runner parses EXACTLY this shape (`==== n passed, m failed ====`); anything else reads
  // as "did not report" and the check is counted as broken however green it was.
  console.log(`\n==== ${pass} passed, ${fail} failed ====`);
  await browser.close(); srv.close();
  process.exit(fail ? 1 : 0);
})();
