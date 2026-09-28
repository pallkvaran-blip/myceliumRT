/* JOURNEY I, PART 2: LANDFALL, THE NEXT LEG, VISIBLE PROGRESS — the finishing plan's M8, as assertions.
 *
 *   land     '#leg,1,1' on a fresh save: real growth (legprobe's follower, `mine.growFrom`) walks the
 *            cheapest route to within a dig of the taproot, then ONE growFrom lands a clean strand within
 *            54 units of the knot — the run is over within 1 mine frame with cause 'island'; the wallet
 *            rises by exactly max(5, floor(depth/5) + floor(east/10)) + seam P + 20 (depth and east read
 *            off the colony independently of the result); the island celebration fruits the ISLAND hill
 *            with its roots lit; #ssMineEnd grows ROOTED with the landfall copy, an Island bonus row and
 *            the journey strip; p.mineJourney.leg goes 1 -> 2; run_end's detail is 'L1:island:e<east>'
 *            with ms > 0 and there is exactly one 'island' event (n = 1 run). Descend boots leg 2 on its
 *            curated seed with the home column at 36, the leg banner and the east chevron up (the save's
 *            second descent), gone after 5 s. Exit to title: 'Continue · Leg 2 of 8 · The Coal Road' and
 *            the strip with 1 island lit, leg 2 ringed; still one 'island' event.
 *   records  a returning save: the title's DIG starts the journey (leg 1, home 36) with a banner and
 *            chevron; a first run on the leg fires no NEW FARTHEST; a run reaching E m east leaves
 *            records().farthest = E +-1; the store header carries the strip; on the next run the dashed
 *            line draws (a pixel diff of on against off >= 20 px, against an on/on control) and crossing it
 *            fires exactly ONE NEW FARTHEST beat, however far past it the run goes; the island coming into
 *            view fires 'Island 1 / In sight' and the once-per-save tip.
 *   free     '#mine,4242' (the free layout) carries none of it: no east readout, no banner, east 0, and
 *            run_end's detail is 'L0:<cause>:e0'.
 *
 *   hud      (M8 verify) a leg's HUD at its widest (120 water, 168 m, 192 m east, P, three materials) stays
 *            on the play surface at 390x844, 360x640 and 320x568, row 1 clear of the gear — at 360 the east
 *            readout ran under the gear before it moved to row 2 when the rows stack.
 *   fit      (M8 verify) ROOTED at 360x640 fits with nothing scrolling and the strip on screen (the strip
 *            was the last row, 25 px below the fold).
 *   tabs     (M8 verify) two tabs of one profile: a boot that banks a leg descent's pending record puts
 *            it on the leg (runs, farthest east), and the live tab's later LANDFALL is still recorded
 *            (leg 1 -> 2, runs not counted twice, the bonus paid once). Before, the bank skipped the whole
 *            leg record whenever a boot had counted the run.
 *   twice    (M8 verify) a landfall on a leg another descent has landed since this one started pays no
 *            second bonus (checked at the bank, not only at run start); the island event says ':again'.
 *   replay   (M8 verify) a save past the built legs (leg 4) plays leg 3, labelled Leg 3, pays no bonus,
 *            and ROOTED says the next leg is not open yet instead of promising it.
 *
 * Screens: tests/.artifacts/m8-{rooted,leg2-banner,title,store,records,sight,hud-360,rooted-360}-390.png.
 * `LANDFALL_ONLY=land,records,free,hud,fit,tabs,twice,replay` runs a subset.
 */
const path = require('path'), fs = require('fs');
const H = require('./mine-harness.cjs');
const LP = require('./bots/legprobe.cjs');
const { sleep } = H;
let pass = 0, fail = 0;
const ok = (n, c, x) => { c ? (pass++, console.log('  PASS  ' + n + (x ? '  — ' + x : ''))) : (fail++, console.log('  FAIL  ' + n + (x ? '  — ' + x : ''))); };
const ART = path.join(H.ROOT, 'tests', '.artifacts');
fs.mkdirSync(ART, { recursive: true });
const ONLY = (process.env.LANDFALL_ONLY || '').split(',').filter(Boolean);
const want = (k) => !ONLY.length || ONLY.includes(k);
const shot = (page, name) => page.screenshot({ path: path.join(ART, name), animations: 'disabled', timeout: 8000 }).catch(() => {});
const tapTele = (page) => page.evaluate(() => { window.__rows = []; window.__telemetry.tap((r) => window.__rows.push(Object.assign({}, r))); });
const save = (page) => page.evaluate(() => JSON.parse(localStorage.getItem('mycelium.progress.v2') || '{}'));
const waitRun = (page) => page.waitForFunction(() => { const s = window.__game && window.__game.state;
  return !!(s && s.substrate && s.substrate.mine && !s.runOver && s.substrate._fineSolid && s._mineJ !== undefined && s._mineFrameN > 2); },
  { timeout: 40000, polling: 100 }).catch(() => {});

// Grow the colony east along the leg's cheapest lattice route (legprobe's follower: threats out, tank
// topped up) until a clean strand is `toE` metres east of the hill. Returns the colony's east measured by
// a scan of the nodes, and the hook's running maximum.
const digEast = async (page, toE) => {
  const m = await LP.measure(page, { route: true });
  const x = await page.evaluate((toE) => { const sub = window.__game.state.substrate; return (sub.mineHomeCol + 0.5 + toE) * sub.cellSize; }, toE);
  const f = await LP.follow(page, m.route, { stopEastX: x, stopWithin: 200 });
  await sleep(300);
  return page.evaluate(() => {
    const g = window.__game, s = g.state, sub = s.substrate, cs = sub.cellSize, homeX = (sub.mineHomeCol + 0.5) * cs;
    let b = homeX; for (const n of s.active.nodes) if (!n.infected && n.x > b) b = n.x;
    return { east: Math.floor((b - homeX) / cs), hook: g.mine.east() };
  }).then((r) => Object.assign(r, { digs: f.digs }));
};


// Lands the colony on the leg's taproot: the follower to within 280 units, then growFrom at the knot
// from the nearest clean strand. Resolves once the mine frame has ended the run (or not, after 3 s).
const landNow = async (page) => {
  const m = await LP.measure(page, { route: true });
  await LP.follow(page, m.route, { stopWithin: 280 });
  return page.evaluate(async () => {
    const g = window.__game, s = g.state, net = s.active, t = g.mine.taproot();
    const R = (s.config.mine.journey.landfallCells || 1.5) * s.substrate.cellSize;
    const bal0 = g.store.balance();
    for (let k = 0; k < 8 && !net.nodes.some((n) => !n.infected && Math.hypot(n.x - t.x, n.y - t.y) <= R); k++) {
      let src = null, sd = 1e9;
      for (const n of net.nodes) { if (n.infected) continue; const d = Math.hypot(n.x - t.x, n.y - t.y); if (d < sd) { sd = d; src = n; } }
      net.water = 999; g.mine.growFrom(src.x, src.y, t.x, t.y);
    }
    for (let k = 0; k < 30 && !s.runOver; k++) await new Promise((q) => setTimeout(q, 100));
    const r = s.runResult || {};
    return { over: !!s.runOver, cause: r.cause, ore: r.ore, bonus: r.bonus, seams: r.seams, reach: r.reach, leg: r.leg, bal0, bal1: g.store.balance() };
  });
};
const waitLeg = (page) => page.waitForFunction(() => !!(window.__game && window.__game.mine && window.__game.mine.leg && window.__game.mine.leg()
  && window.__game.state.substrate._fineSolid && !window.__game.state.runOver), { timeout: 40000 });

(async () => {
  const E = await H.start();
  try {
    // ======================================================================================
    if (want('land')) {
      console.log('— landfall on leg 1, and the next leg');
      const b = await E.boot('#leg,1,1', 390, 844);
      await b.page.waitForFunction(() => !!(window.__game && window.__game.mine && window.__game.mine.leg && window.__game.mine.leg()
        && window.__game.state.substrate._fineSolid), { timeout: 40000 });
      await tapTele(b.page);
      const m = await LP.measure(b.page, { route: true });
      const f = await LP.follow(b.page, m.route, { stopWithin: 280 });
      ok('real growth follows the cheapest route to within 280 units of the taproot, not landed yet', !f.landed && f.near <= 280 && f.near > 54,
         `${f.digs} digs, nearest strand ${f.near} units from the knot`);
      const land = await b.page.evaluate(async () => {
        const g = window.__game, s = g.state, sub = s.substrate, cs = sub.cellSize, net = s.active;
        const t = g.mine.taproot(), landR = (s.config.mine.journey.landfallCells || 1.5) * cs;
        const bal0 = g.store.balance();
        const homeX = (sub.mineHomeCol + 0.5) * cs;
        const landed = () => net.nodes.some((n) => !n.infected && Math.hypot(n.x - t.x, n.y - t.y) <= landR);
        let tries = 0, frame0 = 0;
        while (!landed() && tries < 8 && !s.runOver) {
          let src = null, sd = Infinity;
          for (const n of net.nodes) { if (n.infected) continue; const d = Math.hypot(n.x - t.x, n.y - t.y); if (d < sd) { sd = d; src = n; } }
          net.water = 999;
          frame0 = g.mine.frameN();
          g.mine.growFrom(src.x, src.y, t.x, t.y);
          tries++;
        }
        const hit = landed();
        // The colony's own depth and east at the landing, scanned here (not read off the result).
        let dy = sub.surfaceY, ex = homeX;
        for (const n of net.nodes) if (!n.infected) { if (n.y > dy) dy = n.y; if (n.x > ex) ex = n.x; }
        const scanDepth = Math.max(s.mineMaxDepth | 0, Math.floor((dy - sub.surfaceY) / cs));
        const scanEast = Math.max(s.mineMaxEast | 0, Math.floor((ex - homeX) / cs));
        const seamP = Math.round(s.mineOre || 0);
        // One mine frame at a time until the run is over (bounded).
        let overAt = null;
        for (let k = 0; k < 12 && overAt == null; k++) {
          await new Promise((q) => requestAnimationFrame(q));
          if (s.runOver) overAt = g.mine.frameN();
        }
        await new Promise((q) => setTimeout(q, 50));
        const r = s.runResult || {};
        return { hit, tries, frame0, overAt, over: s.runOver, cause: r.cause, depth: r.depth, east: r.east, seams: r.seams, ore: r.ore, bonus: r.bonus,
                 scanDepth, scanEast, seamP, bal0, bal1: g.store.balance() };
      });
      ok('one growFrom lands a clean strand within 54 units of the knot', land.hit, `${land.tries} landing dig(s)`);
      ok('...and the run is over within 1 mine frame, cause "island"', land.over && land.cause === 'island' && land.overAt != null && land.overAt - land.frame0 <= 1,
         `frames ${land.frame0} -> ${land.overAt}, cause ${land.cause}`);
      const want2 = Math.max(5, Math.floor(land.scanDepth / 5) + Math.floor(land.scanEast / 10)) + land.seamP + 20;
      ok('the result carries the colony\'s own depth and east', land.depth === land.scanDepth && land.east === land.scanEast,
         `result ${land.depth} m / ${land.east} m east, scan ${land.scanDepth} / ${land.scanEast}`);
      ok('the wallet rises by max(5, floor(depth/5) + floor(east/10)) + seam P + 20', land.bal1 - land.bal0 === want2 && land.ore === want2 && land.bonus === 20,
         `${land.bal0} -> ${land.bal1} (+${land.bal1 - land.bal0}), want max(5, ${Math.floor(land.scanDepth / 5)} + ${Math.floor(land.scanEast / 10)}) + ${land.seamP} + 20 = ${want2}`);
      const sv = await save(b.page);
      ok('p.mineJourney.leg goes 1 -> 2, leg 1 recorded landed', sv.mineJourney && sv.mineJourney.leg === 2 && sv.mineJourney.legs[1] && sv.mineJourney.legs[1].landed === true,
         JSON.stringify(sv.mineJourney));
      // The celebration on the ISLAND hill, roots lit (it starts once the last dig's reveal has played).
      const cele = await b.page.evaluate(async () => {
        for (let k = 0; k < 80; k++) { const c = window.__game.mine.cele(); if (c && c.lit >= 1) break; await new Promise((q) => setTimeout(q, 100)); }
        return { c: window.__game.mine.cele(), h: window.__game.mine.hills().find((x) => x.island) }; });
      ok('the island hill fruits: the celebration stands on the island, its roots lit', cele.c && cele.c.side === 'island' && cele.c.n > 20 && cele.c.lit >= 1
         && cele.c.x0 >= cele.h.x0 && cele.c.x1 <= cele.h.x1 && cele.c.roots === 5,
         JSON.stringify(cele.c) + ' island ' + (cele.h && [cele.h.x0, cele.h.x1]));
      await b.page.waitForSelector('#ssMineEnd', { timeout: 20000 }).catch(() => {});
      await sleep(900);
      const es = await b.page.evaluate(() => { const e = document.getElementById('ssMineEnd'); if (!e) return null;
        const t = e.querySelector('.ss-win-title'), st = e.querySelector('.mj-strip');
        const rows = Array.from(e.querySelectorAll('.ss-me-row')).map((r) => r.innerText.replace(/\s+/g, ' ').trim());
        return { label: t && t.getAttribute('aria-label'), text: e.innerText.replace(/\s+/g, ' '), rows,
                 strip: st ? { lit: st.querySelectorAll('.mj-dot.lit').length, dots: st.querySelectorAll('.mj-dot').length, cur: (st.querySelector('.mj-dot.cur') || {}).dataset } : null }; });
      ok('#ssMineEnd grows ROOTED with the landfall copy', es && es.label === 'Rooted' && /took root on Island 1\. Leg 2, The Coal Road, starts there\./.test(es.text),
         es && (es.label + ' | ' + es.text.slice(0, 140)));
      ok('...with East and Island bonus rows', es && es.rows.some((r) => /^East \d+ m \+\d+/.test(r)) && es.rows.some((r) => /^Island bonus \+20/.test(r)),
         es && es.rows.join(' / '));
      ok('...and the journey strip: 8 islands, 1 lit, leg 2 next', es && es.strip && es.strip.dots === 8 && es.strip.lit === 1 && es.strip.cur && es.strip.cur.leg === '2',
         JSON.stringify(es && es.strip));
      await shot(b.page, 'm8-rooted-390.png');
      const tele = await b.page.evaluate(() => window.__rows.filter((r) => r.kind === 'run_end' || r.kind === 'island'));
      const ends = tele.filter((r) => r.kind === 'run_end'), isl = tele.filter((r) => r.kind === 'island');
      ok('run_end has ms > 0 and detail /^L\\d+:\\w+:e\\d+$/ — L1:island:e<east>', ends.length === 1 && ends[0].ms > 0
         && /^L\d+:\w+:e\d+$/.test(ends[0].detail) && ends[0].detail === 'L1:island:e' + land.east, JSON.stringify(ends.map((r) => [r.detail, r.ms])));
      ok('...and exactly one "island" event, n = the runs the leg took', isl.length === 1 && isl[0].n === 1 && isl[0].level === 1, JSON.stringify(isl.map((r) => [r.level, r.n, r.detail])));
      // THE NEXT DESCEND IS LEG 2.
      await b.page.click('#ssMineDescend');
      await waitRun(b.page);
      await sleep(500);
      const l2 = await b.page.evaluate(() => { const g = window.__game, L = g.mine.leg();
        return { leg: L && L.leg, seed: L && L.seed, home: L && L.homeCol, want: g.mine.legRow(2).seed, hints: g.mine.legHints(),
                 beats: g.mine.beats().filter((x) => x.kind === 'leg').map((x) => [x.d, x.n, x.c]), eastShown: !document.getElementById('hud-east').hidden }; });
      ok('the next Descend boots leg 2 on its curated seed, home column 36', l2.leg === 2 && l2.seed === l2.want && l2.home === 36, JSON.stringify({ leg: l2.leg, seed: l2.seed, want: l2.want, home: l2.home }));
      ok('...opening on the leg banner with its rule line', l2.beats.length === 1 && l2.beats[0][0] === 'Leg 2' && l2.beats[0][1] === 'The Coal Road' && l2.beats[0][2] === 'Worms from 42 m',
         JSON.stringify(l2.beats));
      ok('...and the east chevron (the leg\'s first run), and the HUD\'s east readout', l2.hints && l2.hints.drawn.chevron && l2.hints.chevronUntil > l2.hints.now && l2.eastShown,
         JSON.stringify(l2.hints));
      await shot(b.page, 'm8-leg2-banner-390.png');
      await sleep(5200);
      const gone = await b.page.evaluate(() => window.__game.mine.legHints().drawn.chevron);
      ok('...which is gone after 5 s', gone === false, String(gone));
      // Exit to title: the caption and the strip.
      await b.page.evaluate(() => { document.getElementById('gearbtn').click(); });
      await sleep(300);
      await b.page.evaluate(() => { document.getElementById('set-saveexit').click(); });
      await b.page.waitForSelector('#tsNewMine', { timeout: 20000 }).catch(() => {});
      await sleep(2600);
      const ti = await b.page.evaluate(() => { const c = document.getElementById('tsJourneyCap'), st = document.querySelector('#titleScreen .mj-strip');
        return { cap: c && c.textContent, lit: st ? st.querySelectorAll('.mj-dot.lit').length : -1, litLeg: st ? (st.querySelector('.mj-dot.lit') || {}).dataset : null,
                 cur: st ? (st.querySelector('.mj-dot.cur') || {}).dataset : null, n: window.__rows.filter((r) => r.kind === 'island').length,
                 detail: (window.__rows.filter((r) => r.kind === 'run_end').pop() || {}).detail }; });
      ok("after landfall 1 the title reads 'Continue · Leg 2 of 8'", ti.cap === 'Continue · Leg 2 of 8 · The Coal Road', ti.cap);
      ok('...and the strip shows 1 island lit (island 1), leg 2 ringed', ti.lit === 1 && ti.litLeg && ti.litLeg.leg === '1' && ti.cur && ti.cur.leg === '2', JSON.stringify(ti));
      ok('...the quit is L2:quit, and still exactly one "island" event', /^L2:quit:e\d+$/.test(ti.detail || '') && ti.n === 1, `${ti.detail}, ${ti.n}`);
      await shot(b.page, 'm8-title-390.png');
      ok('no page errors (land)', !b.errs.length, b.errs.slice(0, 2).join(' | '));
      await b.ctx.close();
    }
    // ======================================================================================
    if (want('records')) {
      console.log('— the title DIG, records in the world, the island in sight');
      const b = await E.boot('', 390, 844, { returning: true });
      await b.page.waitForSelector('#tsNewMine', { timeout: 20000 }).catch(() => {});
      await sleep(2600);
      const t0 = await b.page.evaluate(() => { const c = document.getElementById('tsJourneyCap'), st = document.querySelector('#titleScreen .mj-strip');
        return { cap: c && c.textContent, lit: st ? st.querySelectorAll('.mj-dot.lit').length : -1 }; });
      ok('control: before any landfall the title reads Leg 1 with no island lit', t0.cap === 'Leg 1 of 8 · First Light' && t0.lit === 0, JSON.stringify(t0));
      await b.page.click('#tsNewMine');
      await waitRun(b.page);
      await tapTele(b.page);
      await sleep(400);
      const r1 = await b.page.evaluate(() => { const g = window.__game, L = g.mine.leg(), s = g.state;
        return { journey: !!s.substrate.mineJourney, leg: L && L.leg, home: L && L.homeCol, hints: g.mine.legHints(),
                 banner: g.mine.beats().filter((x) => x.kind === 'leg').map((x) => [x.d, x.n, x.c]) }; });
      ok('the title\'s DIG starts the journey: leg 1, home column 36', r1.journey && r1.leg === 1 && r1.home === 36, JSON.stringify(r1));
      ok('...with the leg banner and the chevron (not the save\'s first descent)', r1.banner.length === 1 && r1.banner[0][0] === 'Leg 1'
         && r1.banner[0][2] === 'No threats — the island lies east' && r1.hints.drawn.chevron, JSON.stringify(r1));
      const d1 = await digEast(b.page, 30);
      const fb1 = await b.page.evaluate(() => window.__game.mine.beats().filter((x) => x.d === 'New farthest').length);
      ok('a first run on the leg (no record yet) fires no NEW FARTHEST', fb1 === 0 && d1.east >= 20, `${fb1} beats at ${d1.east} m east (hook ${d1.hook})`);
      await b.page.evaluate(() => window.__game.mine.end());
      await b.page.waitForSelector('#ssMineEnd', { timeout: 20000 }).catch(() => {});
      await sleep(500);
      const rec1 = await b.page.evaluate(() => window.__game.mine.records());
      ok(`after a run that reached ${d1.east} m east, records().farthest equals it +-1`, rec1 && Math.abs(rec1.farthest - d1.east) <= 1, JSON.stringify(rec1));
      const endStrip = await b.page.evaluate(() => !!document.querySelector('#ssMineEnd .mj-strip'));
      await b.page.click('#ssMineDone');
      await b.page.waitForSelector('#ssDescend', { timeout: 20000 }).catch(() => {});
      await sleep(700);
      const store = await b.page.evaluate(() => { const st = document.querySelector('#speciesSelect .mj-strip'); return st ? st.querySelectorAll('.mj-dot').length : 0; });
      ok('the end screen and the store header both carry the strip', endStrip && store === 8, `end ${endStrip}, store dots ${store}`);
      await shot(b.page, 'm8-store-390.png');
      await b.page.click('#ssDescend');
      await waitRun(b.page);
      await sleep(600);
      // THE LINE DRAWS: pixel diff, lines on against off, same clock — and an on/on control.
      const px = await b.page.evaluate(async () => {
        const g = window.__game, s = g.state, sub = s.substrate, cs = sub.cellSize, o = s._mineJ;
        const x = (sub.mineHomeCol + 0.5 + o.lines.east) * cs;
        g.mine.lookAt(x - 40, sub.surfaceY + 8 * cs);
        await new Promise((q) => setTimeout(q, 300));
        const cv = document.getElementById('game'), c2 = cv.getContext('2d');
        const T = performance.now();
        const grab = (on) => { g.mine.recordLines(on); g.renderFrame(T, 0); return c2.getImageData(0, 0, cv.width, cv.height).data; };
        const a = grab(true), drawnOn = g.mine.records().drawn, a2 = grab(true), b0 = grab(false);
        g.mine.recordLines(true);
        const diff = (p, q) => { let n = 0; for (let i = 0; i < p.length; i += 4) if (Math.abs(p[i] - q[i]) + Math.abs(p[i + 1] - q[i + 1]) + Math.abs(p[i + 2] - q[i + 2]) > 24) n++; return n; };
        return { onOff: diff(a, b0), control: diff(a, a2), line: o.lines.east, drawn: drawnOn };
      });
      ok('on the next run the farthest-east line draws: a pixel diff of on against off >= 20 px', px.onOff >= 20 && px.control < px.onOff / 4 && px.drawn.east,
         `on/off ${px.onOff} px, on/on control ${px.control} px, line at ${px.line} m`);
      await shot(b.page, 'm8-records-390.png');
      const d2 = await digEast(b.page, px.line + 8);
      const b2 = await b.page.evaluate(() => ({ n: window.__game.mine.beats().filter((x) => x.d === 'New farthest').length, rec: window.__game.mine.records().beats }));
      const d3 = await digEast(b.page, d2.east + 12);
      const b3 = await b.page.evaluate(() => window.__game.mine.beats().filter((x) => x.d === 'New farthest').length);
      ok('crossing it fires exactly one NEW FARTHEST beat, however far past it the run goes', d2.east > px.line && b2.n === 1 && b2.rec.east === 1 && b3 === 1,
         `line ${px.line} m; east ${d2.east} -> ${d3.east} m; beats ${b2.n} then ${b3}`);
      // THE ISLAND IN SIGHT.
      const sight = await b.page.evaluate(async () => {
        const g = window.__game, h = g.mine.hills().find((x) => x.island), sub = g.state.substrate;
        g.mine.lookAt((h.x0 + h.x1) / 2, sub.surfaceY + 120);
        for (let k = 0; k < 30 && !g.mine.legHints().sight; k++) await new Promise((q) => setTimeout(q, 100));
        // The tip is one line in a queue: another line (a dead-end nudge) can be up first, for up to ~5 s.
        let hint = '', tip = false;
        for (let k = 0; k < 90 && !tip; k++) {
          await new Promise((q) => setTimeout(q, 100));
          const h = (document.getElementById('minehint') || {}).textContent || '';
          if (/Reach the island/.test(h)) hint = h;
          tip = !!((JSON.parse(localStorage.getItem('mycelium.progress.v2')).mineTips || {}).first_island) && !!hint;
        }
        return { sight: g.mine.legHints().sight, chev: g.mine.legHints().drawn.chevron, beats: g.mine.beats().filter((x) => x.d === 'Island 1').map((x) => x.n),
                 hint, tip };
      });
      ok("the island coming into view fires 'Island 1 / In sight' and the once-per-save tip", sight.sight === 1 && sight.beats.length === 1 && sight.beats[0] === 'In sight'
         && /Reach the island's root to move on/.test(sight.hint || '') && sight.tip && sight.chev === false, JSON.stringify(sight));
      await shot(b.page, 'm8-sight-390.png');
      ok('no page errors (records)', !b.errs.length, b.errs.slice(0, 2).join(' | '));
      await b.ctx.close();
    }
    // ======================================================================================
    if (want('free')) {
      console.log('— the free layout is untouched');
      const b = await E.bootMine(4242, 390, 844, { returning: true });
      await tapTele(b.page);
      const d = await b.page.evaluate(async () => { const g = window.__game, s = g.state; let ok = 0;
        for (let i = 0; i < 12; i++) { const ns = s.active.nodes.filter((n) => !n.infected).sort((a, c) => c.x - a.x); s.active.water = 999;
          const r = g.mine.growFrom(ns[0].x, ns[0].y, ns[0].x + 150, ns[0].y + 40); if (r && r.ok) ok++; await new Promise((q) => setTimeout(q, 150)); }
        return { digs: ok }; });
      const fr = await b.page.evaluate(() => ({ east: window.__game.mine.east(), shown: !document.getElementById('hud-east').hidden,
        banners: window.__game.mine.beats().filter((x) => x.kind === 'leg').length, J: window.__game.mine.records() }));
      ok('control: #mine,4242 has no east readout, no leg banner, no records, east 0', fr.east === 0 && !fr.shown && fr.banners === 0 && fr.J === null,
         JSON.stringify(fr) + ' dug ' + JSON.stringify(d));
      await b.page.evaluate(() => window.__game.mine.end());
      const det = await b.page.evaluate(async () => {
        for (let k = 0; k < 80 && !window.__rows.some((r) => r.kind === 'run_end'); k++) await new Promise((q) => setTimeout(q, 100));
        return (window.__rows.filter((r) => r.kind === 'run_end').pop() || {}).detail; });
      ok("...and run_end's detail is 'L0:<cause>:e0'", /^L0:\w+:e0$/.test(det || ''), det);
      ok('no page errors (free)', !b.errs.length, b.errs.slice(0, 2).join(' | '));
      await b.ctx.close();
    }

    // ======================================================================================
    if (want('hud')) {
      console.log('— a leg\'s HUD at its widest stays on the play surface');
      for (const [w, h] of [[390, 844], [360, 640], [320, 568]]) {
        const b = await E.boot('#leg,1,3', w, h);
        await waitLeg(b.page);
        await sleep(800);
        const r = await b.page.evaluate(async () => {
          const s = window.__game.state;
          const push = () => { s.active.water = 120; s.mineMaxEast = 192; s.mineMaxDepth = 168; s.mineDepth = 168; s.mineOre = 327;
            s.mineMats = { anthracite: 18, garnet: 23, hematite: 21 }; };
          push(); await new Promise((q) => setTimeout(q, 1300)); push(); await new Promise((q) => setTimeout(q, 600));
          const box = document.getElementById('ui').getBoundingClientRect(), gear = document.getElementById('gearbtn').getBoundingClientRect();
          const bad = [];
          for (const e of document.querySelectorAll('#ui .minerows *')) {
            if (e.closest('[hidden]')) continue;
            const q = e.getBoundingClientRect(); if (!q.width) continue;
            if (q.left < box.left - 0.5 || q.right > box.right + 0.5) bad.push((e.id || e.className) + ' x ' + Math.round(q.left) + '-' + Math.round(q.right));
          }
          const top = document.querySelector('.hudtop .resrow');
          const t = top.getBoundingClientRect();
          const he = document.getElementById('hud-east'), heq = he.getBoundingClientRect();
          const inRow2 = !!he.closest('#hudrow2');
          return { bad, overflow: top.scrollWidth - top.clientWidth, row1: [Math.round(t.left), Math.round(t.right)], gear: [Math.round(gear.left), Math.round(gear.right)],
                   east: [Math.round(heq.left), Math.round(heq.right), Math.round(heq.top)], text: he.textContent, inRow2,
                   two: document.querySelector('#ui > .hud.minehud').classList.contains('two') };
        });
        ok(`${w}x${h}: every HUD piece on the play surface, row 1 not overflowing and clear of the gear, the east readout showing '→ 192 m'`,
           !r.bad.length && r.overflow <= 0 && r.row1[1] <= r.gear[0] && /192/.test(r.text) && r.east[1] > r.east[0] && (!r.two || r.inRow2),
           JSON.stringify(r));
        if (w === 360) await shot(b.page, 'm8-hud-360.png');
        await b.ctx.close();
      }
    }
    // ======================================================================================
    if (want('fit')) {
      console.log('— ROOTED fits a short phone');
      const b = await E.boot('#leg,1,1', 360, 640);
      await waitLeg(b.page);
      const L = await landNow(b.page);
      await b.page.waitForSelector('#ssMineEnd', { timeout: 25000 }).catch(() => {});
      await sleep(1500);
      const f = await b.page.evaluate(() => { const e = document.getElementById('ssMineEnd'); if (!e) return null;
        const st = e.querySelector('.mj-strip').getBoundingClientRect(), d = document.getElementById('ssMineDescend').getBoundingClientRect();
        return { sh: e.scrollHeight, ch: e.clientHeight, strip: [Math.round(st.top), Math.round(st.bottom)], descend: [Math.round(d.top), Math.round(d.bottom)], vh: innerHeight }; });
      ok('360x640: ROOTED fits with nothing scrolling, the strip and Descend on screen', L.cause === 'island' && f && f.sh <= f.ch && f.strip[1] <= f.vh && f.descend[1] <= f.vh,
         JSON.stringify({ cause: L.cause, f }));
      await shot(b.page, 'm8-rooted-360.png');
      await b.ctx.close();
    }
    // ======================================================================================
    if (want('tabs')) {
      console.log('— two tabs: a boot banks a leg descent, the live tab lands');
      const ctx = await E.browser.newContext({ viewport: { width: 390, height: 844 } });
      const a = await E.boot('#leg,1,1', 390, 844, { ctx });
      await waitLeg(a.page);
      const hide = (page, v) => page.evaluate((v) => { Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => v });
        document.dispatchEvent(new Event('visibilitychange')); }, v);
      const m = await LP.measure(a.page, { route: true });
      await LP.follow(a.page, m.route, { stopWithin: 280 });
      await sleep(400);
      const e0 = await a.page.evaluate(() => window.__game.mine.east());
      await hide(a.page, 'hidden');
      const pend = Object.values((await save(a.page)).minePending || {})[0] || null;
      const bb = await E.boot('', 390, 844, { ctx });
      await bb.page.waitForSelector('#titleScreen', { timeout: 20000 }).catch(() => {});
      await sleep(1200);
      const p1 = await save(bb.page);
      const l1 = (p1.mineJourney && p1.mineJourney.legs && p1.mineJourney.legs[1]) || null;
      ok("the boot that banks the pending record puts the descent on its leg (runs 1, farthest east)", pend && pend.leg === 1 && l1 && l1.runs === 1 && l1.bestEast === e0 && !l1.landed,
         JSON.stringify({ pend, leg1: l1, e0 }));
      await hide(a.page, 'visible');
      const w0 = (await save(a.page)).minerals | 0;
      const L = await a.page.evaluate(async () => {
        const g = window.__game, s = g.state, net = s.active, t = g.mine.taproot();
        for (let k = 0; k < 8 && !s.runOver; k++) { let src = null, sd = 1e9;
          for (const n of net.nodes) { if (n.infected) continue; const d = Math.hypot(n.x - t.x, n.y - t.y); if (d < sd) { sd = d; src = n; } }
          net.water = 999; g.mine.growFrom(src.x, src.y, t.x, t.y); await new Promise((q) => setTimeout(q, 120)); }
        for (let k = 0; k < 30 && !s.runOver; k++) await new Promise((q) => setTimeout(q, 100));
        const r = s.runResult || {}; return { cause: r.cause, ore: r.ore, bonus: r.bonus };
      });
      await sleep(400);
      const p2 = await save(a.page);
      const l2 = p2.mineJourney && p2.mineJourney.legs && p2.mineJourney.legs[1];
      ok('...and the live tab\'s landfall is still recorded: leg 1 -> 2, landed, the run counted once', L.cause === 'island' && p2.mineJourney.leg === 2 && l2 && l2.landed && l2.runs === 1,
         JSON.stringify({ L, journey: p2.mineJourney }));
      ok('...the bonus paid once, on top of what the boot did not bank', L.bonus === 20 && (p2.minerals | 0) - w0 === L.ore - (pend ? pend.P : 0),
         `wallet ${w0} -> ${p2.minerals | 0}, run ore ${L.ore} less the boot's ${pend && pend.P}`);
      ok('no page errors (tabs)', !a.errs.length && !bb.errs.length, a.errs.concat(bb.errs).slice(0, 2).join(' | '));
      await ctx.close();
    }
    // ======================================================================================
    if (want('twice')) {
      console.log('— a second landfall of a leg pays no second bonus');
      const b = await E.boot('#leg,1,1', 390, 844);
      await waitLeg(b.page);
      await tapTele(b.page);
      const cfgBonus = await b.page.evaluate(() => window.__game.state.config.mine.islandBonus);
      // Another descent lands leg 1 while this one is in flight.
      await b.page.evaluate(() => { const p = JSON.parse(localStorage.getItem('mycelium.progress.v2') || '{}');
        p.mineJourney = { journey: 1, leg: 2, legs: { 1: { runs: 1, bestDepth: 30, bestEast: 96, landed: true } } };
        localStorage.setItem('mycelium.progress.v2', JSON.stringify(p)); });
      const L = await landNow(b.page);
      await b.page.waitForSelector('#ssMineEnd', { timeout: 25000 }).catch(() => {});
      await sleep(900);
      const es = await b.page.evaluate(() => Array.from(document.querySelectorAll('#ssMineEnd .ss-me-row')).map((r) => r.innerText.replace(/\s+/g, ' ').trim()));
      const isl = await b.page.evaluate(() => window.__rows.filter((r) => r.kind === 'island').map((r) => r.detail));
      ok('the run started owing 20, and the landfall banks reach + seams only (no Island bonus row), island event L1:again',
         cfgBonus === 20 && L.cause === 'island' && L.bonus === 0 && L.bal1 - L.bal0 === L.reach + L.seams && L.ore === L.reach + L.seams
         && !es.some((r) => /Island bonus/.test(r)) && isl.length === 1 && isl[0] === 'L1:again',
         JSON.stringify({ cfgBonus, L, rows: es, isl }));
      await b.ctx.close();
    }
    // ======================================================================================
    if (want('replay')) {
      console.log('— a save past the built legs replays the last one');
      const b = await E.boot('', 390, 844, { before: async (page) => page.addInitScript(() => { if (!localStorage.getItem('mycelium.progress.v2'))
        localStorage.setItem('mycelium.progress.v2', JSON.stringify({ runsDone: 6, mineRuns: 6, mineBest: 90, migratedMineShelfV2: true,
          mineJourney: { journey: 1, leg: 4, legs: { 1: { runs: 1, landed: true }, 2: { runs: 3, landed: true }, 3: { runs: 2, bestEast: 150, landed: true } } } })); }) });
      await b.page.waitForSelector('#tsNewMine', { timeout: 20000 }).catch(() => {});
      await sleep(2600);
      const t = await b.page.evaluate(() => ({ cap: (document.getElementById('tsJourneyCap') || {}).textContent, lit: document.querySelectorAll('#titleScreen .mj-dot.lit').length }));
      await b.page.click('#tsNewMine');
      await waitLeg(b.page);
      await sleep(600);
      const L0 = await b.page.evaluate(() => ({ leg: window.__game.mine.leg().leg, bonus: window.__game.state.config.mine.islandBonus }));
      const L = await landNow(b.page);
      await b.page.waitForSelector('#ssMineEnd', { timeout: 25000 }).catch(() => {});
      await sleep(900);
      const why = await b.page.evaluate(() => ((document.querySelector('#ssMineEnd .ss-mineend-why') || {}).textContent || ''));
      const sv = await save(b.page);
      ok("save leg 4: the title reads Leg 3, DIG plays leg 3 owing no bonus, and ROOTED says leg 4 is not open yet",
         t.cap === 'Continue · Leg 3 of 8 · Dry Ground' && t.lit === 3 && L0.leg === 3 && L0.bonus === 0 && L.cause === 'island' && L.bonus === 0
         && /Island 3\. Leg 4 is not open yet — the next descent replays Leg 3\./.test(why) && sv.mineJourney.leg === 4,
         JSON.stringify({ t, L0, L: { cause: L.cause, bonus: L.bonus }, why, leg: sv.mineJourney.leg }));
      ok('no page errors (replay)', !b.errs.length, b.errs.slice(0, 2).join(' | '));
      await b.ctx.close();
    }
  } catch (e) { fail++; console.log('  FAIL  harness error: ' + (e && e.stack || e)); }
  await E.close();
  console.log(`\n==== ${pass} passed, ${fail} failed ====`);
  process.exit(fail ? 1 : 0);
})();
