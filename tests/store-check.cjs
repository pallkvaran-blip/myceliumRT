/* The campaign STORE: four for-sale colonies + five permanent upgrade tracks, bought with Spores.
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
 *   - The SCREEN. It shares the picker's shell rule (`#speciesSelect, #ssStore`), so an id-only
 *     rename in the stylesheet would leave the store unstyled with every element still present —
 *     hence the computed-style assertion rather than a "did the div appear?" one.
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
  // Never let a probe write to the live leaderboard.
  await page.addInitScript(() => { window.MYCELIUM_SUPABASE = { url: '', anonKey: '' }; });

  // A dev boot gets us a live `__game` (the store model hangs off it) without playing anything.
  await page.goto(base + '/index.html#dev', { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#loadscreen.ld-ready', { timeout: 25000 }).catch(() => {});
  await page.click('#loadscreen', { timeout: 5000 }).catch(() => {});
  await page.waitForFunction(() => window.__game && window.__game.store, null, { timeout: 25000 });
  for (let i = 0; i < 4 && await page.$('#levelIntro'); i++) { await page.mouse.click(720, 450); await sleep(1000); }

  const wipe = () => page.evaluate(() => window.__game.store.reset());

  // ---- the tracks themselves ------------------------------------------------
  const shape = await page.evaluate(() => {
    const S = window.__game.store;
    return S.upgrades.map((u) => ({ id: u.id, steps: u.costs.length, step: u.step,
      rising: u.costs.every((c, i) => i === 0 || c > u.costs[i - 1]) }));
  });
  ok('five upgrade tracks, the ones the owner listed',
     shape.map((s) => s.id).join(',') === 'water,phosphorus,carryCards,carryEngines,lives',
     shape.map((s) => s.id).join(','));
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
  // isPlayable = revealed AND purchased, which is what the picker's tier row reads.
  ok('a bought colony is playable from the species picker', spBuy.playable === true, spBuy.id);

  // ---- the EFFECTS, read where the run loop reads them ----------------------
  const res = await page.evaluate(() => {
    const S = window.__game.store;
    S.reset();
    const base = S.speciesById('marasmius');
    const before = { ...(base.res || {}) };
    S.credit(1e6);
    S.buy('water'); S.buy('water'); S.buy('phosphorus');
    const eff = S.effectiveSpecies(base).res;
    return { before, after: { water: eff.water, phosphorus: eff.phosphorus, energy: eff.energy },
             wBonus: S.value('water'), pBonus: S.value('phosphorus'),
             tableUntouched: { water: base.res.water, phosphorus: base.res.phosphorus } };
  });
  ok('bought water reaches the run as starting water',
     res.after.water === res.before.water + res.wBonus, `${res.before.water} + ${res.wBonus} -> ${res.after.water}`);
  ok('bought phosphorus reaches the run as starting phosphorus',
     res.after.phosphorus === (res.before.phosphorus || 0) + res.pBonus,
     `${res.before.phosphorus || 0} + ${res.pBonus} -> ${res.after.phosphorus}`);
  ok('the species\' own energy is untouched by the store', res.after.energy === res.before.energy,
     `${res.before.energy} -> ${res.after.energy}`);
  // The bonus is applied to a COPY at seed time, never written into SPECIES — otherwise it
  // compounds every run and the table stops describing the colony.
  ok('the species table itself is never mutated',
     res.tableUntouched.water === res.before.water && res.tableUntouched.phosphorus === res.before.phosphorus,
     JSON.stringify(res.tableUntouched));

  const zero = await page.evaluate(() => {
    const S = window.__game.store;
    S.reset();
    const base = S.speciesById('marasmius');
    const eff = S.effectiveSpecies(base);
    return { same: eff.res.water === base.res.water && eff.res.phosphorus === (base.res.phosphorus || 0),
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
  await page.evaluate(() => {
    window.__game.store.reset();
    window.__game.store.credit(12000);
    document.querySelectorAll('#ssStore, #speciesSelect, #loadoutSelect').forEach((n) => n.remove());
    window.__game.showStore({});
  });
  await sleep(900);
  const ui = await page.evaluate(() => {
    const root = document.getElementById('ssStore');
    if (!root) return { missing: true };
    const cs = getComputedStyle(root);
    const ref = document.createElement('div'); ref.id = 'speciesSelect'; ref.style.visibility = 'hidden';
    document.body.appendChild(ref);
    const rcs = getComputedStyle(ref);
    const shared = { pos: cs.position === rcs.position, bg: cs.backgroundColor === rcs.backgroundColor,
      font: cs.fontFamily === rcs.fontFamily, color: cs.color === rcs.color };
    ref.remove();
    const btns = [...root.querySelectorAll('.ss-upg-btn')];
    return {
      shared,
      title: !!root.querySelector('.ss-title canvas'),
      wallet: (root.querySelector('#ssStWallet') || {}).textContent,
      speciesTiles: root.querySelectorAll('#ssStSpecies .ss-card').length,
      priced: root.querySelectorAll('#ssStSpecies .ss-buybadge').length,
      tiles: root.querySelectorAll('.ss-upg').length,
      pips: root.querySelectorAll('.ss-upg .ss-upg-pip').length,
      buyable: btns.filter((b) => !b.disabled).length,
      back: !!root.querySelector('#ssStBack'),
    };
  });
  ok('the store screen opens', !ui.missing);
  // The whole point of the shared shell rule: if the stylesheet stops naming #ssStore the
  // markup is all still there and the screen is unstyled, which no element count would catch.
  ok('it inherits the species screen\'s shell, not a copy of it',
     ui.shared && ui.shared.pos && ui.shared.bg && ui.shared.font && ui.shared.color, JSON.stringify(ui.shared));
  ok('it grows its own mycelium wordmark, like the picker', ui.title === true);
  ok('the wallet shows the balance', /12000/.test(ui.wallet || ''), ui.wallet);
  ok('four colony tiles, each with a Spore price', ui.speciesTiles === 4 && ui.priced === 4,
     `${ui.speciesTiles} tiles, ${ui.priced} priced`);
  ok('five upgrade tiles', ui.tiles === 5, String(ui.tiles));
  ok('every tile draws one pip per step it has',
     ui.pips === shape.reduce((a, s) => a + s.steps, 0), `${ui.pips} pips vs ${shape.reduce((a, s) => a + s.steps, 0)} steps`);
  ok('affordable steps are clickable', ui.buyable > 0, `${ui.buyable} buyable at 12000 Spores`);
  ok('there is a way back to the species screen', ui.back === true);

  // A section hint must sit in ITS OWN row label. `.ss-hint` is declared twice in the
  // stylesheet and the later rule (the mystery card's unlock line) wins with position:absolute
  // + bottom:9px — so using that class here silently stacked both hints on top of each other
  // at the foot of the console, past the Back button. Only a rendered frame showed it, which is
  // why the geometry is asserted rather than the presence of the elements.
  const hints = await page.evaluate(() => {
    const root = document.getElementById('ssStore');
    const out = [...root.querySelectorAll('.ss-rowlabel')].map((row) => {
      const h = row.querySelector('.ss-rowhint, .ss-hint');
      if (!h) return null;
      const rb = row.getBoundingClientRect(), hb = h.getBoundingClientRect();
      return { text: h.textContent.trim().slice(0, 24), inside: hb.top >= rb.top - 2 && hb.bottom <= rb.bottom + 2,
               top: Math.round(hb.top), h: Math.round(hb.height) };
    }).filter(Boolean);
    return out;
  });
  ok('each section hint sits inside its own header row', hints.length === 2 && hints.every((h) => h.inside),
     JSON.stringify(hints));
  ok('the two hints do not land on top of one another',
     hints.length === 2 && Math.abs(hints[0].top - hints[1].top) > 20, JSON.stringify(hints.map((h) => h.top)));

  // The buy sheet must quote the STORE's price, not the tier ladder's — a store colony is
  // bought without clearing the tier that reveals it, so TIER_COST has no bearing here and
  // showing it would take the wrong number of Spores.
  const sheet = await page.evaluate(async () => {
    const S = window.__game.store;
    const root = document.getElementById('ssStore');
    const sp = S.species()[0];
    root.querySelector('#ssStSpecies .ss-card').click();
    await new Promise((r) => setTimeout(r, 250));
    const n = document.querySelector('#ssIBuy .ss-buyn');
    const shown = n ? +n.textContent.trim() : null;
    document.querySelector('#ssIClose').click();
    return { shown, store: S.speciesCost(sp), id: sp.id };
  });
  ok('the buy sheet quotes the store\'s own price', sheet.shown === sheet.store,
     `${sheet.id}: sheet ${sheet.shown} vs store ${sheet.store}`);

  // Clicking a real button, on the path a player takes.
  const clicked = await page.evaluate(async () => {
    const S = window.__game.store;
    const before = S.level('water');
    const bal0 = S.balance();
    document.querySelector('#ssStore .ss-upg-btn[data-upg="water"]').click();
    await new Promise((r) => setTimeout(r, 120));
    return { before, after: S.level('water'),
             spent: bal0 - S.balance(),
             pipsOn: document.querySelectorAll('#ssStore .ss-upg.water .ss-upg-pip.on').length,
             wallet: document.querySelector('#ssStWallet').textContent };
  });
  ok('clicking Buy buys one step and re-renders the tile',
     clicked.after === clicked.before + 1 && clicked.pipsOn === clicked.after, JSON.stringify(clicked));
  ok('the wallet on screen follows the purchase',
     clicked.wallet.includes(String(12000 - clicked.spent)), `${clicked.wallet} after spending ${clicked.spent}`);

  // A diagnostic frame, not an assertion — .catch'd and timed out, because a screenshot against
  // a live rAF loop can otherwise wait forever and take the whole tally with it (CLAUDE.md).
  await page.screenshot({ path: path.join(__dirname, '.artifacts', 'store.png'),
    animations: 'disabled', timeout: 8000 }).catch(() => {});
  console.log('  shot → tests/.artifacts/store.png');

  const back = await page.evaluate(async () => {
    document.querySelector('#ssStBack').click();
    await new Promise((r) => setTimeout(r, 200));
    return !document.getElementById('ssStore');
  });
  ok('Back closes the store', back === true);

  await wipe();
  ok('no page errors', errs.length === 0, errs.slice(0, 3).join(' | '));
  // The runner parses EXACTLY this shape (`==== n passed, m failed ====`); anything else reads
  // as "did not report" and the check is counted as broken however green it was.
  console.log(`\n==== ${pass} passed, ${fail} failed ====`);
  await browser.close(); srv.close();
  process.exit(fail ? 1 : 0);
})();
