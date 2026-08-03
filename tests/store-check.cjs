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
    return S.upgrades.map((u) => ({ id: u.id, steps: u.costs.length, step: u.step,
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
     stepOf('energy') === 3 && stepOf('water') === 5 && stepOf('phosphorus') === 2,
     `energy +${stepOf('energy')}, water +${stepOf('water')}, phosphorus +${stepOf('phosphorus')}`);
  ok('every track has at least one step and a per-step value',
     shape.every((s) => s.steps > 0 && s.step > 0), JSON.stringify(shape.map((s) => s.id + ':' + s.steps + 'x' + s.step)));
  // Not a taste judgement: a flat price ladder means the last step of a track costs what the
  // first did, and there is then no reason to ever buy anything else first.
  ok('each track\'s prices rise step by step', shape.every((s) => s.rising),
     shape.filter((s) => !s.rising).map((s) => s.id).join(',') || 'all rising');

  const four = await page.evaluate(() => window.__game.store.species().map((s) => s.id + '@' + window.__game.store.speciesCost(s)));
  ok('four colonies are for sale', four.length === 4, four.join(', '));
  ok('every for-sale colony carries a price', four.every((s) => +s.split('@')[1] > 0), four.join(', '));

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
    return { steps, bought, level: S.level('lives'), next: S.nextCost('lives'), value: S.value('lives') };
  });
  ok('a track stops at its last step however often it is bought',
     maxed.bought === maxed.steps && maxed.level === maxed.steps && maxed.next === null,
     `bought ${maxed.bought} of ${maxed.steps}, level ${maxed.level}, next ${maxed.next}`);
  ok('a maxed track reports its full bonus', maxed.value === maxed.steps, `+${maxed.value} retries`);

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
  const reach = await page.evaluate(() => {
    const S = window.__game.store;
    S.reset();
    const by = (id) => S.speciesById(id);
    const before = { starter: S.obtainable(by('marasmius')), forSale: S.obtainable(by('cortinarius')),
                     tierOnly: S.obtainable(by('suillus')), rockOnly: S.obtainable(by('psilocybe')) };
    // A tier species the player ALREADY OWNS stays reachable — it just has no row of its own.
    const p = JSON.parse(localStorage.getItem('mycelium.progress.v2') || '{}');
    p.purchased = p.purchased || {}; p.revealedSpecies = p.revealedSpecies || {};
    p.purchased.suillus = true; p.revealedSpecies.suillus = true;
    localStorage.setItem('mycelium.progress.v2', JSON.stringify(p));
    return { ...before, ownedTier: S.obtainable(by('suillus')) };
  });
  ok('a starter and a for-sale colony are obtainable',
     reach.starter === true && reach.forSale === true, JSON.stringify(reach));
  ok('a colony with no row and no price is NOT announced as a reward',
     reach.tierOnly === false && reach.rockOnly === false, JSON.stringify(reach));
  ok('a tier colony already owned stays obtainable', reach.ownedTier === true, JSON.stringify(reach));

  // ---- the EFFECTS, read where the run loop reads them ----------------------
  const res = await page.evaluate(() => {
    const S = window.__game.store;
    S.reset();
    const base = S.speciesById('marasmius');
    const before = { ...(base.res || {}) };
    S.credit(1e6);
    S.buy('water'); S.buy('water'); S.buy('phosphorus'); S.buy('energy'); S.buy('energy');
    const eff = S.effectiveSpecies(base).res;
    return { before, after: { water: eff.water, phosphorus: eff.phosphorus, energy: eff.energy },
             wBonus: S.value('water'), pBonus: S.value('phosphorus'), eBonus: S.value('energy'),
             tableUntouched: { water: base.res.water, phosphorus: base.res.phosphorus, energy: base.res.energy } };
  });
  ok('bought water reaches the run as starting water',
     res.after.water === res.before.water + res.wBonus, `${res.before.water} + ${res.wBonus} -> ${res.after.water}`);
  ok('bought phosphorus reaches the run as starting phosphorus',
     res.after.phosphorus === (res.before.phosphorus || 0) + res.pBonus,
     `${res.before.phosphorus || 0} + ${res.pBonus} -> ${res.after.phosphorus}`);
  ok('bought energy reaches the run as starting energy',
     res.after.energy === res.before.energy + res.eBonus, `${res.before.energy} + ${res.eBonus} -> ${res.after.energy}`);
  // The bonus is applied to a COPY at seed time, never written into SPECIES — otherwise it
  // compounds every run and the table stops describing the colony.
  ok('the species table itself is never mutated',
     res.tableUntouched.water === res.before.water && res.tableUntouched.phosphorus === res.before.phosphorus
       && res.tableUntouched.energy === res.before.energy,
     JSON.stringify(res.tableUntouched));

  const zero = await page.evaluate(() => {
    const S = window.__game.store;
    S.reset();
    const base = S.speciesById('marasmius');
    const eff = S.effectiveSpecies(base);
    return { same: eff.res.water === base.res.water && eff.res.phosphorus === (base.res.phosphorus || 0)
                   && eff.res.energy === base.res.energy,
             bonuses: S.bonuses() };
  });
  ok('with nothing bought a species opens exactly as it always did',
     zero.same === true && Object.values(zero.bonuses).every((v) => v === 0), JSON.stringify(zero.bonuses));

  // ---- the death-carry caps ------------------------------------------------
  const carry = await page.evaluate(() => {
    const g = window.__game, S = g.store;
    const read = () => {
      const el = document.querySelector('#loadoutSelect .lo-count');
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
    seed(); S.deathCarry({ cause: 'devoured', runSpores: 0 }); out.eng = read(); shut();
    out.bonus = S.bonuses();
    return out;
  }).catch((e) => ({ err: String(e && e.message) }));
  if (carry.err) {
    ok('the death carousel opens for the carry assertions', false, carry.err);
  } else {
    // At zero upgrades the cap is the old "3 + levels cleared" and there is NO engine meter —
    // the negative control for the whole feature.
    ok('with nothing bought the carry cap is unchanged and has no engine meter',
       /^\s*\d+\s*\/\s*3\s*$/.test((carry.none.count || '').replace(/ /g, ' ')) && !/engine/i.test(carry.none.count || ''),
       JSON.stringify(carry.none));
    ok('bought card memory widens the basic/event cap',
       (carry.cards.count || '').includes('/ ' + (3 + carry.bonus.carryCards)) ||
       (carry.cards.count || '').includes('/' + (3 + carry.bonus.carryCards)),
       `${carry.cards.count} (bonus +${carry.bonus.carryCards})`);
    ok('the instruction says where the extra slots came from',
       /from the Store/i.test(carry.cards.instr || ''), carry.cards.instr);
    ok('bought engine memory adds a SEPARATE engine meter',
       /engines?/i.test(carry.eng.count || '') && (carry.eng.count || '').includes('/' + carry.bonus.carryEngines),
       `${carry.eng.count} (bonus +${carry.bonus.carryEngines})`);
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
    };
  });
  ok('the species screen opens', !ui.missing);
  ok('there is no separate store screen any more', ui.storeScreen === false);
  ok('it still grows its mycelium wordmark', ui.title === true);
  ok('the wallet shows the balance', /12000/.test(ui.wallet || ''), ui.wallet);
  // The owner's spec: "the campaign mode only has a total of 3 species at start and then 4 more
  // available for purchase (viewable from the start)".
  ok('three colonies to start with', ui.owned === 3, `${ui.owned}: ${ui.ownNames.join(', ')}`);
  ok('four more for sale, visible from the start', ui.forSale === 4, String(ui.forSale));
  ok('every owned colony has a Select button', ui.ownBtns.length === 3 && ui.ownBtns.every((t) => t === 'Select'),
     ui.ownBtns.join(' | '));
  ok('every for-sale colony has an Unlock button with a price',
     ui.saleBtns.length === 4 && ui.saleBtns.every((t) => /^Unlock\s*\d+$/.test(t)), ui.saleBtns.join(' | '));
  // "below each is a Select button" — geometry, not just presence.
  ok('the button sits BELOW its card, not inside it', ui.buttonsUnderCards === true);
  ok('no "?" tiles remain', ui.mystery === 0, String(ui.mystery));
  ok('no "Complete level N" tier rows remain', ui.tierRows === 0, ui.headers.join(' / '));
  ok('three sections: owned, for sale, upgrades',
     ui.headers.join('|') === 'Your colonies|New colonies|Colony upgrades', ui.headers.join(' / '));
  ok('six upgrade tiles', ui.tracks === 6, String(ui.tracks));
  ok('every tile draws one pip per step it has',
     ui.pips === shape.reduce((a, s) => a + s.steps, 0), `${ui.pips} pips vs ${shape.reduce((a, s) => a + s.steps, 0)} steps`);
  ok('affordable steps are clickable', ui.buyable > 0, `${ui.buyable} buyable at 12000 Spores`);

  // A section hint must sit in ITS OWN row label. `.ss-hint` used to be declared twice in the
  // stylesheet, and the later rule (the "?" tile's unlock line) won with position:absolute +
  // bottom:9px — so using that class in a header silently stacked every hint on top of the
  // others at the foot of the console. Both those rules are gone now; the geometry stays
  // asserted, because no element count would have caught it.
  const hints = await page.evaluate(() => {
    const root = document.getElementById('speciesSelect');
    return [...root.querySelectorAll('.ss-rowlabel')].map((row) => {
      const h = row.querySelector('.ss-rowhint, .ss-hint');
      if (!h) return null;
      const rb = row.getBoundingClientRect(), hb = h.getBoundingClientRect();
      return { text: h.textContent.trim().slice(0, 22), inside: hb.top >= rb.top - 2 && hb.bottom <= rb.bottom + 2,
               top: Math.round(hb.top) };
    }).filter(Boolean);
  });
  ok('each section hint sits inside its own header row', hints.length === 3 && hints.every((h) => h.inside),
     JSON.stringify(hints));
  ok('the hints do not land on top of one another',
     new Set(hints.map((h) => h.top)).size === hints.length, JSON.stringify(hints.map((h) => h.top)));

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
    const res = wrap ? wrap.querySelectorAll('#ssIRes .ss-respill').length : 0;
    return { open, btns, actsShown, name, hand, res };
  });
  ok('pressing a colony opens its details', sheet.open === true, sheet.name);
  // The owner's ask, and the one most likely to be undone by a later "helpful" addition.
  ok('the details carry NO buttons but the X',
     sheet.btns.length === 1 && /ssIClose/.test(sheet.btns[0]), sheet.btns.join(' | ') || '(none)');
  ok('the actions row is gone rather than merely empty', sheet.actsShown === false);
  ok('the details still show the hand and the starting resources',
     sheet.hand > 0 && sheet.res > 0, `${sheet.hand} cards, ${sheet.res} resource pills`);

  const closed = await page.evaluate(async () => {
    document.querySelector('#ssIClose').click();
    await new Promise((r) => setTimeout(r, 350));
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
    return { before, after: S.level('water'), spent: bal0 - S.balance(),
             pipsOn: document.querySelectorAll('#speciesSelect .ss-upg.water .ss-upg-pip.on').length,
             wallet: document.querySelector('#ssWallet').textContent };
  });
  ok('clicking Buy buys one step and re-renders the tile',
     clicked.after === clicked.before + 1 && clicked.pipsOn === clicked.after, JSON.stringify(clicked));
  ok('the wallet on screen follows the purchase',
     clicked.wallet.includes(String(12000 - clicked.spent)), `${clicked.wallet} after spending ${clicked.spent}`);

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
  ok('unlocking a colony moves it into Your colonies with a Select button',
     moved.has === true && moved.owned === 4 && moved.forSale === 3,
     `${moved.nameBefore}: owned ${moved.owned}, for sale ${moved.forSale}`);

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
