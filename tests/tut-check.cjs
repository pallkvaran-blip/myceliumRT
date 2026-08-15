/* The tutorial's starter pile is ORANGE, growing into it drafts, and the draft step
   explains that time stops (real time only). Then the next prompt is red-only. */
const http = require('http'); const fs = require('fs'); const path = require('path');
const { chromium } = require('playwright');
const ROOT = path.resolve(__dirname, '..');   // the repo root — served as-is
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
  const browser = await chromium.launch({ headless: true });

  // Boot a run and start the tutorial by hand (the same entry point New uses).
  const boot = async (hash) => {
    const page = await browser.newPage({ viewport: { width: 1280, height: 860 } });
    const errs = []; page.on('pageerror', (e) => errs.push(String(e && e.message)));
    page.on('console', (m) => { if (m.type() === 'error') errs.push('console:' + m.text()); });
    await page.goto(base + '/index.html' + hash, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('#loadscreen.ld-ready', { timeout: 20000 }).catch(() => {});
    await page.click('#loadscreen', { timeout: 5000 }).catch(() => {});
    await page.waitForFunction(() => window.__game && window.__game.state && window.__game.state.active, null, { timeout: 20000 });
    for (let i = 0; i < 4 && await page.$('#levelIntro'); i++) { await page.mouse.click(640, 400); await sleep(1200); }
    return { page, errs };
  };
  // Walk the script to a step whose text matches, satisfying the forced steps on the way.
  const advanceTo = async (page, re, max = 24) => {
    let txt = null;
    for (let i = 0; i < max; i++) {
      txt = await page.evaluate(() => { const b = document.getElementById('tutBody'); return b ? b.innerText : null; });
      if (txt && re.test(txt)) return txt;
      const nextVisible = await page.evaluate(() => {
        const b = document.getElementById('tutNext');
        return !!(b && getComputedStyle(b).display !== 'none');
      });
      if (nextVisible) { await page.click('#tutNext'); await sleep(400); continue; }
      // A FORCED step: do what it's asking for.
      if (/This is your deck/i.test(txt || '')) {
        await page.evaluate(() => window.__game.armAim('Apical Drive'));
      } else if (/Grow into .?substrate/i.test(txt || '')) {
        // Grow AWAY from the orange pile, so this step doesn't eat it early.
        await page.evaluate(() => {
          const g = window.__game, s = g.state, net = s.active, C = s.cards;
          net.energy = 1e6; net.water = 999; net.phosphorus = 999;
          const fp = net.frontierPoint() || net.nodes[0];
          let i = C.hand.findIndex((h) => h.name === 'Apical Drive');
          if (i < 0) { C.hand.push({ id: C.seq++, name: 'Apical Drive' }); i = C.hand.length - 1; }
          g.play(i, { x: fp.x - 200, y: fp.y + 120, srcX: fp.x, srcY: fp.y });   // down-left, away from the pile
        });
      } else {
        return txt;   // some other forced step we don't know how to satisfy
      }
      await sleep(600);
    }
    return txt;
  };

  for (const [hash, label, wantTimeLine] of [['#dev', 'real time', true], ['#dev,turn', 'turn-based', false]]) {
    console.log(`\n--- ${label} ---`);
    const { page, errs } = await boot(hash);
    await page.evaluate(() => window.__game.startTutorial());
    await sleep(900);

    // The planted pile is an ORANGE cache, not yellow duff.
    const pile = await page.evaluate(() => {
      const g = window.__game, s = g.state, sub = s.substrate, root = s.active.nodes[0];
      // Ask the GAME which pile the tutorial planted — guessing "the nearest orange cache"
      // picks some unrelated map pile once the tutorial's own has been eaten.
      const at = g.starterPile();
      const ctrOf = (q) => { let x = 0, y = 0; for (const i of q.cells) { const c = sub.cellCenter(i % sub.cols, (i / sub.cols) | 0); x += c.x; y += c.y; } return { x: x / q.cells.length, y: y / q.cells.length }; };
      const p = at && (sub.foodPiles || []).filter((q) => q.cells && q.cells.length)
        .sort((a2, b2) => Math.hypot(ctrOf(a2).x - at.x, ctrOf(a2).y - at.y)
                        - Math.hypot(ctrOf(b2).x - at.x, ctrOf(b2).y - at.y))[0];
      if (!p) return { none: true };
      let sx = 0, sy = 0;
      for (const i of p.cells) { const c = sub.cellCenter(i % sub.cols, (i / sub.cols) | 0); sx += c.x; sy += c.y; }
      const ctr = { x: sx / p.cells.length, y: sy / p.cells.length };
      return { kind: p.kind, leaf: sub.cells[p.cells[0]].foodKind, cells: p.cells.length,
               dist: Math.round(Math.hypot(ctr.x - root.x, ctr.y - root.y)) };
    });
    ok(`${label}: an ORANGE cache pile is planted near the colony`,
       !pile.none && pile.kind === 'normal' && pile.leaf === 'cache', JSON.stringify(pile));
    ok(`${label}: ...and it can draft (not skipped as duff)`, !pile.none && pile.kind !== 'duff', `kind=${pile.kind}`);

    // Walk to the "grow into the orange leaves" step. It is FORCED, so Next disappears.
    //
    // It can also be skipped legitimately: the starter pile sits inside sensing range, so an
    // earlier grow in ANY direction can claim it and fire the draft before this step is
    // reached — at which point its gate is already satisfied and the tutorial moves on. That
    // is the right behaviour (don't ask for something already done), so only assert the step's
    // own properties when we actually landed on it.
    const growTxt = await advanceTo(page, /Grow into substrate/i);
    const onGrowStep = /Grow into substrate/i.test(growTxt || '');
    if (!onGrowStep) {
      console.log(`  [info] ${label}: the pile was already claimed by an earlier grow, so the`
        + ` substrate step self-advanced — asserting the draft only`);
    } else {
      // YELLOW ONLY. The orange half is a step of its own now (owner), so a build that still
      // crammed both onto the drag step would fail here rather than quietly pass.
      ok(`${label}: the pile step names the yellow piles, and only those`,
         /Yellow piles/i.test(growTxt || '') && !/Orange/i.test(growTxt || ''), JSON.stringify(growTxt));
      const forced = await page.evaluate(() => {
        const b = document.getElementById('tutNext');
        return { nextHidden: !b || getComputedStyle(b).display === 'none',
                 clockLive: !window.__game.state._simPaused };
      });
      // IT KEEPS ITS GATE BUT NOW SHOWS NEXT TOO (owner: "just to be safe"). It used to hide the
      // button, which is what a gated step normally does — and that is exactly how a player who
      // grew somewhere the gate could not see ended up with no way forward at all.
      ok(`${label}: it offers a Next button as well as its gate`, forced.nextHidden === false,
         JSON.stringify(forced));
      if (wantTimeLine) ok(`${label}: the clock RUNS on that step`, forced.clockLive === true, `simPaused=${!forced.clockLive}`);
    }

    // Grow into the pile: play the aimed grow at it, then let the world digest it.
    const drafted = onGrowStep === false
      ? await page.evaluate(() => ({ offers: (window.__game.state.cards.pendingOffers || []).length, food: 0, skipped: true }))
      : await page.evaluate(async () => {
      const g = window.__game, s = g.state, sub = s.substrate, net = s.active;
      // Ask the GAME which pile the tutorial planted — guessing "the nearest orange cache"
      // picks some unrelated map pile once the tutorial's own has been eaten.
      const at = g.starterPile();
      const ctrOf = (q) => { let x = 0, y = 0; for (const i of q.cells) { const c = sub.cellCenter(i % sub.cols, (i / sub.cols) | 0); x += c.x; y += c.y; } return { x: x / q.cells.length, y: y / q.cells.length }; };
      const p = at && (sub.foodPiles || []).filter((q) => q.cells && q.cells.length)
        .sort((a2, b2) => Math.hypot(ctrOf(a2).x - at.x, ctrOf(a2).y - at.y)
                        - Math.hypot(ctrOf(b2).x - at.x, ctrOf(b2).y - at.y))[0];
      let sx = 0, sy = 0;
      for (const i of p.cells) { const c = sub.cellCenter(i % sub.cols, (i / sub.cols) | 0); sx += c.x; sy += c.y; }
      const ctr = { x: sx / p.cells.length, y: sy / p.cells.length };
      net.energy = 1e6; net.water = 999; net.phosphorus = 999;
      const fp = net.frontierPoint() || net.nodes[0];
      const C = s.cards;
      C.hand.push({ id: C.seq++, name: 'Rhizomorph Lance' });
      g.play(C.hand.length - 1, { x: ctr.x, y: ctr.y, srcX: fp.x, srcY: fp.y });
      // Wait for the pile to be digested. In REAL TIME the wall clock does that on its own;
      // TURN-BASED only advances when the player acts, so waiting alone would hang here
      // forever — keep taking steps, which is what a player at this step would be doing.
      const rt = !!s.config.realtime.enabled;
      for (let i = 0; i < 60; i++) {
        if (C.pendingOffers && C.pendingOffers.length) break;
        if (!rt) g.tickWorld(s);
        await new Promise((r) => setTimeout(r, 150));
      }
      return { offers: (C.pendingOffers || []).length, food: p.cells.reduce((a, i) => a + sub.cells[i].nutrient, 0) };
    });
    ok(`${label}: growing into it digests the pile and offers a DRAFT`, drafted.offers > 0,
       `${drafted.offers} offer(s), ${drafted.food} nutrient left`);

    // THERE IS NO DEDICATED DRAFT STEP ANY MORE. The owner's rewrite folds what it said into the
    // pile step above ("Orange piles give you energy and new cards"), so the two assertions about
    // its wording — and the real-time "time stops when drafts happen" line — describe a screen
    // that no longer exists. The BEHAVIOUR they sat next to is still worth pinning: the pile step
    // is the only `live` one, so the clock must stop again the moment it hands over.
    // POLL FOR THE HANDOVER; do not guess how long it takes. The pile step deliberately HOLDS
    // after its gate is satisfied, so the player sees their own growth finish drawing — a fixed
    // 1400ms wait sampled while the step was still up and read as a regression in both modes.
    const handedOver = await page.evaluate(async () => {
      for (let i = 0; i < 60; i++) {
        const b = document.getElementById('tutBody');
        if (!b || !/Grow into substrate/i.test(b.innerText)) return true;
        await new Promise((r) => setTimeout(r, 250));
      }
      return false;
    });
    ok(`${label}: the pile step hands over once the growth has finished drawing`, handedOver === true);
    if (wantTimeLine) {
      // The pile step is the only `live` one, so the clock must stop again the moment it does.
      ok(`${label}: the clock IS stopped again once the pile step hands over`,
         await page.evaluate(() => !!window.__game.state._simPaused));
    }
    // No click-catcher over the draft, so the cards are actually reachable.
    const reachable = await page.evaluate(() => {
      const c = document.querySelector('.tut-catcher');
      return { catcherOff: !c || getComputedStyle(c).display === 'none' };
    });
    ok(`${label}: the tutorial does not block the draft cards`, reachable.catcherOff, JSON.stringify(reachable));

    // Pick a card → the step ends, and the NEXT prompt is red-only.
    await page.evaluate(() => {
      // Drain EVERY pending offer: an earlier grow can claim more than one pile, and the step
      // only ends when none are left. (Offers carry `choices` — an array of card names.)
      const s = window.__game.state;
      for (let i = 0; i < 6 && s.cards.pendingOffers.length; i++) {
        const off = s.cards.pendingOffers[0];
        const nm = off && off.choices && off.choices[0];
        if (!nm) break;
        window.__game.chooseCard(nm);
      }
      return s.cards.pendingOffers.length;
    });
    // A STEP THAT ARRIVED ON ITS OWN SURVIVES THE NEXT STRAY CLICK. Reported as *"the tip after
    // the orange pile disappear before I was able to read it"*: the pile step hands over on its
    // GATE, while the draft is still on screen and the player is about to click again — and the
    // incoming step's full-screen catcher used to go live immediately, so that click dismissed a
    // tip nobody had read.
    //
    // FIRED THE INSTANT THE DRAFT CLOSES, which is the whole point: the first version of this
    // clicked after the 1200ms wait below and passed on the broken build, because by then the tip
    // is legitimately dismissible. The moment is the assertion.
    //
    // Clicking whatever is under the cursor rather than the catcher element: a build that merely
    // hid the catcher while something else advanced the step would pass an assertion on the
    // element itself.
    const stray = await page.evaluate(async () => {
      const txt = () => { const b = document.getElementById('tutBody'); return b ? b.innerText : null; };
      const hit = () => {
        const el = document.elementFromPoint(40, 40) || document.body;
        for (const t of ['mousedown', 'mouseup', 'click']) {
          el.dispatchEvent(new MouseEvent(t, { bubbles: true, clientX: 40, clientY: 40 }));
        }
      };
      const before = txt();
      hit();
      await new Promise((r) => setTimeout(r, 250));
      return { before, after: txt() };
    });
    ok(`${label}: a click as the step arrives does NOT dismiss it`,
       !!stray.before && stray.after === stray.before,
       `was ${JSON.stringify((stray.before || '').slice(0, 34))}, became ${JSON.stringify((stray.after || '').slice(0, 34))}`);

    await sleep(1200);
    const redTxt = await page.evaluate(() => { const b = document.getElementById('tutBody'); return b ? b.innerText : null; });
    // THE STEP AFTER THE DRAFT IS THE ORANGE ONE NOW — the red-leaves step moved one further
    // along when the orange lesson was split out of the drag step. What this is really guarding is
    // that the walkthrough MOVED ON after the draft rather than sticking, so it follows the script
    // instead of pinning a particular colour.
    ok(`${label}: the walkthrough moves on to the orange-pile lesson`,
       /orange food piles also give new cards/i.test(redTxt || '')
       && !/Grow into substrate/i.test(redTxt || ''),
       JSON.stringify(redTxt));

    // ...AND IT IS NOT FROZEN. Without this the assertion above passes on a tutorial nobody can
    // click out of, which is a worse bug than the one being fixed.
    const released = await page.evaluate(async () => {
      const txt = () => { const b = document.getElementById('tutBody'); return b ? b.innerText : null; };
      const before = txt();
      const el = document.elementFromPoint(40, 40) || document.body;
      for (const t of ['mousedown', 'mouseup', 'click']) {
        el.dispatchEvent(new MouseEvent(t, { bubbles: true, clientX: 40, clientY: 40 }));
      }
      await new Promise((r) => setTimeout(r, 300));
      return { before, after: txt() };
    });
    ok(`${label}: ...and a click a moment later still advances it`,
       released.after !== released.before,
       `${JSON.stringify((released.before || '').slice(0, 30))} -> ${JSON.stringify((released.after || '').slice(0, 30))}`);

    ok(`${label}: no page errors`, errs.length === 0, errs.slice(0, 2).join(' | '));
    await page.close();
  }

  console.log(`\n==== ${pass} passed, ${fail} failed ====`);
  await browser.close(); srv.close();
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('HARNESS ERROR', e); process.exit(2); });
