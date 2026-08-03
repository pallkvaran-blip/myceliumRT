/* INFECTED MYCELIUM MUST NOT HARVEST OR DRAFT.
 *
 *     node tests/harvest-check.cjs
 *
 * Written for a bug report: "Mycelium infected by trych should not be able to clear a food pile
 * or initiate a draft. This is currently happening."
 *
 * The rule had been implemented INDIRECTLY — infectNetwork zeroes `cell.colonized` under every
 * infected node, and income + the pile draft both key off `colonized`. That misses two ordinary
 * cases, because a CLAIM is not a strand standing there:
 *
 *   - colonizeReachablePiles stamps colonized=1 on a pile cell and then sprays its mat with
 *     tendril steps of up to ~0.6 of a cell, so plenty of a claimed cell's hyphae end up in the
 *     NEIGHBOURING cell. The clearing pass only reaches cells an infected node is *in*, so the
 *     claim on the cell it left outlives the tissue.
 *   - rot that ages out is REMOVED from the network entirely (rotLifeTurns), so from then on
 *     there is no infected node to find at all and the claim is permanent.
 *
 * Either way the pile kept digesting under dead tissue and eventually paid out a card draft.
 * These assertions test the OUTCOME the owner described — did the food go, did an offer appear —
 * so they hold whatever mechanism answers it. Assertion 3 is the one that failed on the report;
 * assertion 1 is its control (clean tissue on the identical pile must still eat).
 *
 * Turn-based, because a turn-based tick is one call to tickWorld with nothing racing it.
 */
const http = require('http'), fs = require('fs'), path = require('path');
const { chromium } = require('playwright');
// Overridable so the NEGATIVE CONTROL can be run without touching the tree: point it at a
// directory holding a pre-fix index.html (plus a symlink to assets/) and these same assertions
// measure the old behaviour. Verified that way — see the header note above.
const ROOT = process.env.MYC_ROOT || '/home/user/myceliumRT';
const T = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.png': 'image/png', '.webp': 'image/webp', '.mp3': 'audio/mpeg', '.wav': 'audio/wav' };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  PASS ' + m); } else { fail++; console.log('  FAIL ' + m); } };

(async () => {
  const srv = await new Promise((r) => { const s = http.createServer((rq, rs) => { let p = decodeURIComponent(rq.url.split('?')[0].split('#')[0]); if (p === '/') p = '/index.html'; const fp = path.join(ROOT, p); if (!fs.existsSync(fp) || fs.statSync(fp).isDirectory()) { rs.writeHead(404); rs.end('nf'); return; } rs.writeHead(200, { 'Content-Type': T[path.extname(fp)] || 'application/octet-stream' }); fs.createReadStream(fp).pipe(rs); }); s.listen(0, () => r(s)); });
  const b = await chromium.launch({ headless: true, executablePath: '/opt/pw-browsers/chromium' });
  const ctx = await b.newContext({ viewport: { width: 1400, height: 800 } });
  await ctx.addInitScript(() => { window.MYCELIUM_SUPABASE = { url: '', anonKey: '' }; });
  const p = await ctx.newPage();
  p.on('pageerror', (e) => console.log('PAGEERROR:', String(e).slice(0, 300)));
  await p.goto('http://localhost:' + srv.address().port + '/index.html#dev,turn', { waitUntil: 'domcontentloaded' });
  await p.waitForSelector('#loadscreen.ld-ready', { timeout: 60000 }).catch(() => {});
  await p.click('#loadscreen', { timeout: 5000 }).catch(() => {});
  await p.waitForFunction(() => window.__game && window.__game.state && window.__game.state.active, null, { timeout: 60000 }).catch(() => {});
  for (let i = 0; i < 6 && await p.$('#levelIntro'); i++) { await p.mouse.click(1100, 300); await sleep(300); }

  const R = await p.evaluate(() => {
    const G = window.__game, s = G.state, sub = s.substrate, net = s.active, cs = sub.cellSize;
    const t = s.config.trichoderma;
    const out = {};

    // --- a bare world -------------------------------------------------------
    // Wipe EVERY cell's food, not just the piles: colonizeReachablePiles flood-fills a pile with
    // 8-connectivity, so a procedural pile touching ours becomes one pile with a second entrance
    // and the claim arrives by a route the probe never built.
    const reset = () => {
      s.clouds.length = 0; s.nematodes.length = 0;
      if (s.ants) s.ants.length = 0;   // an ant would eat the pile out from under the measurement
      for (const c of sub.cells) {
        c.nutrient = 0; c.maxNutrient = 0; c.foodKind = ''; c.energyPerNutrient = null;
        c.colonized = 0; c.trich = 0; c.mouldProof = 0; c.reinfectGrace = 0; c.hazard = false;
        c.antTrail = false;
      }
      sub.foodPiles = [];
      net.nodes.length = 0; net.byId.clear(); net.nextNodeId = 0;
      net._spreadAccum = 0; net.alive = true;
      s.runOver = false; s.winPending = false;
      if (s.cards) { s.cards.pendingOffers.length = 0; s.cards.hand.length = 0; }
      net.energy = 500;
    };

    // An open column of cells with no rock anywhere near, well clear of the edges.
    const findSpot = () => {
      for (let col = 8; col < sub.cols - 8; col++)
        for (let row = 6; row < sub.rows - 6; row++) {
          let clear = true;
          for (let dr = -3; dr <= 3 && clear; dr++) for (let dc = -6; dc <= 3 && clear; dc++) {
            const c = sub.cellAt(col + dc, row + dr);
            if (!c || c.rock || c.water || sub.rockNear(col + dc, row + dr, 1.5)) clear = false;
          }
          if (clear) return { col, row };
        }
      return null;
    };
    const spot = findSpot();
    if (!spot) return { fatal: 'no open ground on this map' };

    // A pile at `spot`, a stem of clean strands running into its western edge, and a DISCONNECTED
    // anchor limb on the far side of the map.
    //
    // The anchor is what makes the rotten cases measurable at all. Rotting the stem is not enough
    // to keep the colony alive on its own end nodes: the rot races along the filaments, so any
    // strand still attached to it is claimed within a step or two, healthyCount() hits 0 and the
    // run ends — and state.runOver short-circuits checkPileRewards, which would pass these
    // assertions for entirely the wrong reason (measured: alive false, runOver true). Rot travels
    // by graph edges, so a limb with no path to the stem stays clean, and it is far enough away
    // (beyond sensingRadius) that it can never reach the pile itself.
    let anchorIds = new Set();
    const build = (radius) => {
      reset();
      const ctr = sub.injectFoodPile(spot.col, spot.row, radius, 6, 50, 'normal');
      const pile = sub.foodPiles[sub.foodPiles.length - 1];
      const far = sub.cellCenter(sub.cols - 4, spot.row);
      let anchor = null; anchorIds = new Set();
      for (let i = 0; i < 4; i++) {
        anchor = net.addNode(far.x, far.y + i * cs * 0.5, anchor);
        anchor._liveAt = 0; anchorIds.add(anchor.id);
      }
      const west = sub.cellCenter(spot.col - radius - 1, spot.row);
      let par = null; const stem = [];
      for (let i = 10; i >= 1; i--) {
        const n = net.addNode(west.x - i * cs * 0.8, west.y, par);
        n._liveAt = 0; par = n; stem.push(n);
      }
      return { pile, ctr, stem, tip: par };
    };
    const rotAllButAnchor = () => {
      for (const n of net.nodes) if (!anchorIds.has(n.id)) { n.infected = true; n.rotAge = 0; }
    };
    // ONE STEP, WITH THE WORLD HELD STILL. tickWorld RESPAWNS threats, and eight to twelve steps
    // is plenty of time for a fresh cloud to drift across the map into the far anchor and rot the
    // one limb keeping the run alive — measured as `4 infected left, alive false` on some boots
    // and not others, which reads as flakiness rather than as a failure. So each step splices the
    // new arrivals back out, wipes the trich they stamped, and re-cleans the anchor. That is
    // scaffolding for the liveness precondition; nothing measured here touches the anchor.
    const step = () => {
      G.tickWorld(s);
      s.clouds.length = 0; s.nematodes.length = 0; if (s.ants) s.ants.length = 0;
      for (const c of sub.cells) c.trich = 0;
      for (const n of net.nodes) if (anchorIds.has(n.id)) { n.infected = false; n.rotAge = 0; }
    };
    const pileNutrient = (pile) => pile.cells.reduce((a, i) => a + (sub.cells[i] ? sub.cells[i].nutrient : 0), 0);
    const claimedCells = (pile) => pile.cells.filter((i) => sub.cells[i] && sub.cells[i].colonized > 0).length;
    // Pile cells that hold a CLAIM but no strand of any kind — the gap the indirect rule
    // could never see. Printed rather than asserted: it is the mechanism, not the symptom.
    const emptyClaims = (pile) => {
      const occupied = new Set();
      for (const n of net.nodes) occupied.add(sub.index(sub.colAtX(n.x), sub.rowAtY(n.y)));
      return pile.cells.filter((i) => sub.cells[i] && sub.cells[i].colonized > 0 && !occupied.has(i)).length;
    };

    const life = t.rotLifeTurns;
    t.rotLifeTurns = 999;                 // don't let the rot fall away mid-measure

    // 1) CONTROL: clean tissue on the pile digests it and is paid a draft.
    {
      const { pile } = build(2);
      net.colonizeReachablePiles(sub, s.rng);
      const claimed = claimedCells(pile), n0 = pileNutrient(pile), e0 = net.energy;
      out.clean = { cells: pile.cells.length, claimed, emptyClaims: emptyClaims(pile), n0 };
      for (let i = 0; i < 8 && pileNutrient(pile) > 0; i++) step();
      out.clean.n1 = pileNutrient(pile);
      out.clean.gained = Math.round(net.energy - e0);
      out.clean.rewarded = !!pile.rewarded;
      out.clean.offers = s.cards ? s.cards.pendingOffers.length : -1;
    }

    // 2) An INFECTED colony sitting on a full pile takes no Energy from it and empties nothing.
    //    The whole colony is rot except the far end of the stem, which keeps the run alive.
    {
      const { pile, stem } = build(2);
      net.colonizeReachablePiles(sub, s.rng);
      const claimed = claimedCells(pile), n0 = pileNutrient(pile);
      rotAllButAnchor();
      const e0 = net.energy, trickle = s.config.energy.baselineTrickle;
      let ticks = 0;
      for (let i = 0; i < 8; i++) { step(); ticks++; }
      out.rotten = {
        claimed, n0, n1: pileNutrient(pile), stillClaimed: claimedCells(pile),
        emptyClaims: emptyClaims(pile),
        // Energy above the baseline trickle is food this rot ate.
        fromFood: Math.round(net.energy - e0 - trickle * ticks),
        rewarded: !!pile.rewarded,
        offers: s.cards ? s.cards.pendingOffers.length : -1,
        alive: net.alive, runOver: !!s.runOver,
      };
    }

    // 3) The DRAFT specifically: an ALREADY-EMPTY pile under rot must not pay out. This is the
    //    reported case at its sharpest — the food is gone, the claim is still stamped, and
    //    checkPileRewards' `touched` test is the only thing between it and a free card.
    {
      const { pile } = build(2);
      net.colonizeReachablePiles(sub, s.rng);
      rotAllButAnchor();
      for (const i of pile.cells) { const c = sub.cells[i]; if (c) { c.nutrient = 0; c.colonized = 1; } }
      const before = s.cards ? s.cards.pendingOffers.length : -1;
      step();
      out.draft = {
        before, after: s.cards ? s.cards.pendingOffers.length : -1,
        rewarded: !!pile.rewarded, alive: net.alive, runOver: !!s.runOver,
      };
    }

    // 3b) THE PERMANENT CASE, at the real rotLifeTurns: the rot ages out and is REMOVED from the
    //     network, so from then on there is no infected node anywhere for a "clear the cell under
    //     every infected strand" pass to find. The claim is left standing over ground that holds
    //     no tissue at all, and it can never be cleared again.
    {
      t.rotLifeTurns = life;
      const { pile } = build(2);
      net.colonizeReachablePiles(sub, s.rng);
      const n0 = pileNutrient(pile), e0 = net.energy;
      rotAllButAnchor();
      const trickle = s.config.energy.baselineTrickle;
      let ticks = 0;
      for (let i = 0; i < 12; i++) { step(); ticks++; }
      out.fallen = {
        n0, n1: pileNutrient(pile), stillClaimed: claimedCells(pile),
        rotLeft: net.nodes.filter((n) => n.infected).length,
        fromFood: Math.round(net.energy - e0 - trickle * ticks),
        rewarded: !!pile.rewarded, offers: s.cards ? s.cards.pendingOffers.length : -1,
        alive: net.alive, runOver: !!s.runOver,
      };
      t.rotLifeTurns = 999;
    }

    // 4) The DIGEST paths (the Digest action and Saprotrophic Digest) read the same claim to
    //    decide what to drain, so they are the same hole by another door.
    {
      const { pile } = build(2);
      net.colonizeReachablePiles(sub, s.rng);
      rotAllButAnchor();
      const n0 = pileNutrient(pile), e0 = net.energy;
      // Through the public action path, so the gate is tested where the game calls it.
      const act = G.performAction(s, 'digest');
      out.digest = {
        n0, n1: pileNutrient(pile), gained: Math.round(net.energy - e0),
        ok: act ? !!act.ok : null, message: act ? act.message : null,
      };
    }

    // 5) CONTROL for 4: clean tissue can still Digest.
    {
      const { pile } = build(2);
      net.colonizeReachablePiles(sub, s.rng);
      const n0 = pileNutrient(pile);
      const act = G.performAction(s, 'digest');
      out.digestClean = { n0, n1: pileNutrient(pile), ok: !!act.ok, message: act.message };
    }

    // 6) AND THE PILE IS STILL THERE TO WIN BACK. Refusing to harvest is only half the rule: the
    //    claim has to be RELEASED as well, or a pile whose tissue rotted is un-harvestable forever
    //    — colonizeReachablePiles skips a pile that is already claimed throughout, so a stale
    //    claim would lock fresh clean growth out of food it can legitimately reach.
    {
      const { pile } = build(2);
      net.colonizeReachablePiles(sub, s.rng);
      rotAllButAnchor();
      step();                                            // the release pass runs
      const held = claimedCells(pile), n0 = pileNutrient(pile);
      // Clean growth comes back the same way round: drop the rot and re-grow the stem.
      const rotten = new Set(net.nodes.filter((n) => n.infected).map((n) => n.id));
      net._removeNodes(rotten);
      const west = sub.cellCenter(spot.col - 3, spot.row);
      let par = null;
      for (let i = 10; i >= 1; i--) { par = net.addNode(west.x - i * cs * 0.8, west.y, par); par._liveAt = 0; }
      net.colonizeReachablePiles(sub, s.rng);
      const reclaimed = claimedCells(pile);
      for (let i = 0; i < 8 && pileNutrient(pile) > 0; i++) step();
      out.regrow = { heldAfterRot: held, n0, reclaimed, cells: pile.cells.length, n1: pileNutrient(pile), rewarded: !!pile.rewarded };
    }

    t.rotLifeTurns = life;
    return out;
  });

  if (R.fatal) { console.log('FATAL: ' + R.fatal); await b.close(); srv.close(); process.exit(1); }
  console.log(JSON.stringify(R, null, 1));

  console.log('\nclean tissue (control)');
  ok(R.clean.claimed === R.clean.cells, `the whole pile is claimed (${R.clean.claimed}/${R.clean.cells})`);
  ok(R.clean.n1 === 0, `clean tissue empties the pile (${R.clean.n0} -> ${R.clean.n1} nutrient)`);
  ok(R.clean.gained > 0, `clean tissue banks its Energy (+${R.clean.gained})`);
  ok(R.clean.rewarded === true, 'clean tissue is paid the pile draft');
  ok(R.clean.offers > 0, `an offer is pending (${R.clean.offers})`);

  console.log('\ninfected tissue must not harvest');
  ok(R.rotten.alive === true && R.rotten.runOver === false, 'the colony is still alive (so the reward path really ran)');
  ok(R.rotten.n1 === R.rotten.n0, `rot empties nothing (${R.rotten.n0} -> ${R.rotten.n1} nutrient)`);
  ok(R.rotten.fromFood <= 0, `rot banks no Energy from food (${R.rotten.fromFood} above the trickle)`);
  ok(R.rotten.rewarded === false, 'rot is not paid the pile draft');
  ok(R.rotten.offers === 0, `no offer is pending (${R.rotten.offers})`);

  console.log('\ninfected tissue must not draft an already-empty pile');
  ok(R.draft.alive === true && R.draft.runOver === false, 'the colony is still alive');
  ok(R.draft.rewarded === false, 'the empty pile under rot is not rewarded');
  ok(R.draft.after === R.draft.before, `no offer was pushed (${R.draft.before} -> ${R.draft.after})`);

  console.log('\nrot that has FALLEN AWAY leaves no harvesting claim behind');
  ok(R.fallen.alive === true && R.fallen.runOver === false, 'the colony is still alive');
  ok(R.fallen.rotLeft === 0, `the rot really did age out and get removed (${R.fallen.rotLeft} infected left)`);
  ok(R.fallen.stillClaimed === 0, `the claim was released (${R.fallen.stillClaimed} cells still claimed)`);
  ok(R.fallen.n1 === R.fallen.n0, `the pile is untouched (${R.fallen.n0} -> ${R.fallen.n1} nutrient)`);
  ok(R.fallen.fromFood <= 0, `no Energy came from food (${R.fallen.fromFood} above the trickle)`);
  ok(R.fallen.rewarded === false, 'no draft was paid');
  ok(R.fallen.offers === 0, `no offer is pending (${R.fallen.offers})`);

  console.log('\nthe Digest paths read the same claim');
  ok(R.digest.n1 === R.digest.n0, `rot digests nothing (${R.digest.n0} -> ${R.digest.n1} nutrient)`);
  ok(R.digest.gained <= 0, `rot gains nothing from Digest (${R.digest.gained})`);
  ok(R.digestClean.n1 < R.digestClean.n0, `clean tissue still Digests (${R.digestClean.n0} -> ${R.digestClean.n1} nutrient)`);

  console.log('\nthe pile survives the rot and can be won back');
  ok(R.regrow.heldAfterRot === 0, `rot released the claim (${R.regrow.heldAfterRot} cells still claimed)`);
  ok(R.regrow.n0 > 0, `the food is still there (${R.regrow.n0} nutrient)`);
  ok(R.regrow.reclaimed === R.regrow.cells, `clean regrowth re-claims the whole pile (${R.regrow.reclaimed}/${R.regrow.cells})`);
  ok(R.regrow.n1 === 0, `and digests it (${R.regrow.n0} -> ${R.regrow.n1} nutrient)`);
  ok(R.regrow.rewarded === true, 'and is paid its draft');

  // The runner greps for exactly this line (tests/run.mjs) — without the rules it reports the
  // check as BROKEN however many assertions passed.
  console.log(`\n==== ${pass} passed, ${fail} failed ====`);
  await b.close(); srv.close();
  process.exit(fail ? 1 : 0);
})();
