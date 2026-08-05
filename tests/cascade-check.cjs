/* THE COLONY MUST NOT WALK OFF AND EAT ON ITS OWN.
 *
 *   node tests/cascade-check.cjs
 *
 * Owner's report: "Sometimes when I'm growing mycelium from one part of the network, other parts of
 * the network will also grow if there are food piles close by... it will grow into one pile one
 * turn, then another pile next turn. Even if I am currently focused on a totally different part of
 * the network." And, in the same breath, the half that must SURVIVE any fix: "It's good that the
 * system is forgiving when growing new growth close to food piles, giving extra growth -- but it
 * should not happen from a strand that I did not grow myself."
 *
 * So this measures both directions of one rule, and neither assertion means anything alone: a build
 * that claims nothing passes the cascade half, and a build that claims everything passes the
 * forgiveness half.
 *
 * THE MECHANISM. `colonizeReachablePiles` runs after every grow, sweeps EVERY pile on the map, and
 * for each takes the nearest living strand ANYWHERE within `growth.sensingRadius` (202.5u, about 8
 * growth segments). It bridges a runner in and sprays a mat through every cell — and that mat is
 * then the nearest strand to the NEXT pile. One claim per action, marching away from the player.
 *
 * THE SETUP. A chain: six piles stepping away from the colony, each one just inside a single reach
 * of the previous and out of reach of everything before it. Then grow the OTHER WAY, action after
 * action. Pre-fix the colony took all six in six actions, the last 811 units — 32 growth segments —
 * from anything the player had grown.
 *
 * Traps this harness had to be built around, all of which produced a green run that measured nothing:
 *  • A CHAIN WITH A GAP IN IT MEASURES NOTHING. Rock decides where a link can go, so link #3 landing
 *    inside a boulder stops the march for lack of a next link — which reads exactly like a fix. The
 *    chain is SEARCHED for clear ground, and the number of links placed is asserted.
 *  • The map's own food has to go first. `colonizeReachablePiles` flood-fills a pile with
 *    8-connectivity, so an auto-placed pile touching a hand-set cell becomes ONE pile with a second
 *    entrance and the claim arrives by a route this never built.
 *  • REAL TIME IS A DIFFERENT WINDOW, and it is the one the fix is subtle in. Turn-based calls the
 *    claim once per growth primitive; real time re-runs it from `tickWorld` on every tick of the
 *    grow's arrival window (`_colonizePending`), so a freshness rule scoped to the WORLD STEP goes
 *    stale mid-flight. Both modes are measured.
 *  • An authored map, not a fresh roll: the chain's geometry then repeats run to run. `placeRockface`
 *    still uses Math.random(), but it skips any level with a levelDef.
 */
const http = require('http'), fs = require('fs'), path = require('path');
const { chromium } = require('playwright');
const ROOT = path.resolve(__dirname, '..');
const T = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.webp': 'image/webp', '.mp3': 'audio/mpeg', '.wav': 'audio/wav' };
let pass = 0, fail = 0;
const ok = (n, c, x) => { c ? (pass++, console.log('  PASS  ' + n + (x ? '  — ' + x : ''))) : (fail++, console.log('  FAIL  ' + n + (x ? '  — ' + x : ''))); };

// One of the more open authored maps, so the chain finds six clear spots. Its own food is cleared
// either way, so nothing about its design is being relied on beyond having soil to lay piles in.
const LEVEL = 'campaign-05-anthracite-c24';
const ACTS = 8;

async function boot(browser, base, hash) {
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  const errs = [];
  page.on('pageerror', (e) => errs.push(String(e && e.message)));
  await page.addInitScript(() => { window.MYCELIUM_SUPABASE = { url: '', anonKey: '' }; });
  await page.goto(base + '/index.html#' + hash, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#loadscreen.ld-ready', { timeout: 60000 }).catch(() => {});
  await page.click('#loadscreen', { timeout: 5000 }).catch(() => {});
  await page.waitForFunction(() => window.__game && window.__game.state && window.__game.state.active, null, { timeout: 40000 });
  return { page, errs };
}

(async () => {
  const srv = await new Promise((res) => { const s = http.createServer((rq, rs) => { let p = decodeURIComponent(rq.url.split('?')[0].split('#')[0]); if (p === '/') p = '/index.html'; const fp = path.join(ROOT, p); if (!fp.startsWith(ROOT) || !fs.existsSync(fp) || fs.statSync(fp).isDirectory()) { rs.writeHead(404); rs.end('nf'); return; } rs.writeHead(200, { 'Content-Type': T[path.extname(fp)] || 'application/octet-stream' }); fs.createReadStream(fp).pipe(rs); }); s.listen(0, () => res(s)); });
  const base = 'http://localhost:' + srv.address().port;
  const browser = await chromium.launch({ headless: true });

  for (const mode of ['turn', 'realtime']) {
    console.log(`\n  ── ${mode === 'turn' ? 'turn-based' : 'real time'} ──`);
    const hash = 'level,' + LEVEL + (mode === 'turn' ? ',turn' : '');
    let page, errs;
    try { ({ page, errs } = await boot(browser, base, hash)); }
    catch (e) { ok(`${mode}: the level boots`, false, String(e && e.message).slice(0, 90)); continue; }
    ok(`${mode}: the level boots`, true, LEVEL);

    const r = await page.evaluate(async (ACTS) => {
      const g = window.__game, s = g.state, sub = s.substrate, net = s.active;
      const rt = !!(s.config.realtime && s.config.realtime.enabled);
      // The colony's own behaviour is the subject; keep the threats out entirely, respawns included
      // (tickWorld respawns, and a probe that runs 8 actions is a long time to be lucky).
      s.nematodes = []; s.clouds = []; s.ants = [];
      if (s.config.nematodes) s.config.nematodes.respawnChance = 0;
      if (s.config.trichoderma) s.config.trichoderma.respawnChance = 0;
      const R = s.config.growth.sensingRadius;
      // A clean field — see the 8-connectivity trap in the header.
      sub.forEachCell((c) => { c.nutrient = 0; c.maxNutrient = 0; c.colonized = 0; c.antTrail = false; });
      const root = net.nodes[0];

      const clearQuad = (x, y) => {
        const col = sub.colAtX(x), row = sub.rowAtY(y), out = [];
        for (let dr = 0; dr < 2; dr++) for (let dc = 0; dc < 2; dc++) {
          const cc = col + dc, rr = row + dr;
          if (!sub.inBounds(cc, rr)) return null;
          const cell = sub.cellAt(cc, rr);
          if (!cell || cell.rock || cell.water || cell.hazard) return null;
          out.push({ cell, k: cc + ',' + rr });
        }
        return out;
      };
      const step = Math.round(R * 0.8);   // inside one reach of the previous link, well outside two
      const chain = [];
      let from = { x: root.x, y: root.y };
      for (let k = 1; k <= 6; k++) {
        let placed = null;
        outer:
        for (let rad = 0; rad <= 90 && !placed; rad += 9) {
          for (let a = 0; a < 24; a++) {
            const ang = (a / 24) * Math.PI * 2;
            const x = from.x + Math.cos(ang) * rad, y = from.y + step + Math.sin(ang) * rad;
            if (y <= sub.surfaceY + 20 || y >= sub.worldHeight - 20 || x <= 20 || x >= sub.worldWidth - 20) continue;
            const q = clearQuad(x, y); if (!q) continue;
            const d = Math.hypot(x - from.x, y - from.y);
            if (d > R * 0.95 || d < step * 0.5) continue;
            placed = { x, y, q }; break outer;
          }
        }
        if (!placed) break;
        const cells = new Set();
        for (const c of placed.q) { c.cell.nutrient = 60; c.cell.maxNutrient = 60; c.cell.foodKind = 'duff'; cells.add(c.k); }
        chain.push({ k, x: Math.round(placed.x), y: Math.round(placed.y), cells });
        from = { x: placed.x, y: placed.y };
      }

      const claimedKeys = () => { const set = new Set(); sub.forEachCell((c, col, row) => { if (c.colonized >= 1) set.add(col + ',' + row); }); return set; };
      const which = (set) => chain.filter((L) => [...L.cells].some((k) => set.has(k))).map((L) => L.k);
      const lines = [];
      let prev = claimedKeys();
      const before0 = which(prev);
      for (let act = 1; act <= ACTS; act++) {
        net.energy = 100000; net.water = 100000; net.phosphorus = 100000;
        const before = net.nodes.slice();
        const fp = net.frontierPoint() || root;
        // AIM UP-AND-RIGHT — "a totally different part of the network". Rhizomorph Lance because it
        // is a directed grow: a bare `grow` targets food, which is the opposite of the point here,
        // and refuses outright once the colony has outrun the map's piles.
        let idx = s.cards.hand.findIndex((h) => h.name === 'Rhizomorph Lance');
        if (idx < 0) { s.cards.hand.push({ id: s.cards.seq++, name: 'Rhizomorph Lance' }); idx = s.cards.hand.length - 1; }
        g.play(idx, { x: fp.x + 200, y: Math.max(sub.surfaceY + 20, fp.y - 40) });
        // Turn-based: settle the queued enemy turn. Real time: wait out the ARRIVAL WINDOW, which is
        // the window tickWorld re-runs the claim inside — nothing else advances it, and no frames run
        // inside a synchronous evaluate, so the frame has to be driven by hand.
        for (let i = 0; i < 400; i++) {
          try { g.renderFrame(); } catch (_) {}
          if (rt ? !net._colonizePending : !s.enemyTurn) break;
          await new Promise((res) => setTimeout(res, 15));
        }
        if (rt) for (let i = 0; i < 40; i++) { try { g.renderFrame(); } catch (_) {} await new Promise((res) => setTimeout(res, 25)); }
        const now = claimedKeys();
        const nowList = which(now), prevList = which(prev);
        const det = [];
        for (const k of nowList.filter((k) => !prevList.includes(k))) {
          const L = chain.find((l) => l.k === k);
          const pts = [...L.cells].map((key) => { const [c, rr] = key.split(',').map(Number); return sub.cellCenter(c, rr); });
          // Nearest strand that existed BEFORE this action and is real growth rather than the mat a
          // previous claim sprayed. Past sensingRadius, only that mat could have reached the pile.
          let dReal = Infinity, dAny = Infinity;
          for (const p of pts) for (const n of before) {
            const d = Math.hypot(n.x - p.x, n.y - p.y);
            if (d < dAny) dAny = d;
            if (!n.colon && d < dReal) dReal = d;
          }
          // AND the one the rule is actually about: the nearest strand THIS action's growth laid
          // down, mat and bridge runner excluded. Inside sensingRadius, the claim is the forgiveness
          // working — the player grew near a pile. Outside it, something reached that the player
          // never grew, which is the defect.
          const idBefore = before.length ? Math.max(...before.map((n) => n.id)) : -1;
          let dFresh = Infinity;
          for (const p of pts) for (const n of net.nodes) {
            if (n.colon || n.id <= idBefore) continue;
            const d = Math.hypot(n.x - p.x, n.y - p.y);
            if (d < dFresh) dFresh = d;
          }
          det.push({ k, dReal: Math.round(dReal), dAny: Math.round(dAny), dFresh: Math.round(dFresh) });
        }
        lines.push({ act, claimed: nowList, fresh: det, nodes: net.nodes.length });
        prev = now;
      }
      return { rt, R, step, links: chain.map((L) => ({ k: L.k, x: L.x, y: L.y })), before0, lines };
    }, ACTS);

    console.log(`        sensingRadius ${r.R}, chain step ${r.step}u, ${r.links.length} link(s) placed: ${r.links.map((l) => '#' + l.k + '@' + l.x + ',' + l.y).join(' ')}`);
    for (const L of r.lines) {
      const nw = L.fresh.map((d) => `#${d.k}: ${d.dFresh}u from THIS action's own growth | ${d.dReal}u from pre-existing real growth, ${d.dAny}u from any pre-existing tissue`).join('; ');
      console.log(`        after action ${String(L.act).padStart(2)}: claimed ${L.claimed.length ? L.claimed.map((k) => '#' + k).join(' ') : 'none'}${nw ? '   <-- NEW: ' + nw : ''}`);
    }

    // The harness's own coverage, asserted — a short chain is a vacuous pass, not a green build.
    ok(`${mode}: the chain has enough links to march down`, r.links.length >= 4, `${r.links.length} of 6 placed`);
    ok(`${mode}: the mode under test is the one intended`, r.rt === (mode === 'realtime'), `realtime.enabled=${r.rt}`);
    ok(`${mode}: nothing is claimed before the first action`, r.before0.length === 0, `${r.before0.length} link(s)`);

    const last = r.lines[r.lines.length - 1];
    // THE FORGIVENESS HALF. Link #1 is inside one reach of the colony's start, so the tissue the
    // first grow lays down reaches it — and it must still be taken, or the fix has traded one
    // complaint for another. Without this assertion, "claims nothing" passes the next one.
    ok(`${mode}: a pile the player's own growth reaches IS still claimed`,
      r.lines[0].claimed.includes(1), `after action 1: ${r.lines[0].claimed.map((k) => '#' + k).join(' ') || 'nothing'}`);
    // THE CASCADE HALF, STATED AS THE RULE RATHER THAN AS AN OUTCOME. "Only tissue you grew this
    // action may reach out for a pile" — so EVERY claim must have had that action's own growth within
    // one sensingRadius of it. Asserting "nothing past link #1 is ever claimed" instead was a bet
    // about where the lance's path wanders: a side strand or a dodge can legitimately carry growth
    // down toward link #2, and that claim is the forgiveness working, not the defect.
    // Pre-fix this reads 306u, 450u, 630u, 774u, 954u — the whole chain in ONE real-time action,
    // with nothing the player grew anywhere near any of it.
    const claims = r.lines.flatMap((L) => L.fresh);
    const rogue = claims.filter((d) => d.dFresh > r.R);
    ok(`${mode}: every pile claimed was within reach of THIS action's own growth`, rogue.length === 0,
      rogue.length
        ? rogue.map((d) => `#${d.k} at ${d.dFresh}u ≈ ${(d.dFresh / 25.5).toFixed(0)} segments (reach ${r.R})`).join('; ')
        : `${claims.length} claim(s), furthest ${Math.max(0, ...claims.map((d) => d.dFresh))}u of ${r.R}`);
    // And the outcome, reported and asserted loosely: eight actions aimed away must not walk the
    // whole chain however the path wobbles.
    ok(`${mode}: eight actions aimed away do not walk the whole chain`, last.claimed.length < r.links.length,
      `claimed ${last.claimed.map((k) => '#' + k).join(' ') || 'nothing'} of ${r.links.length} links`);
    ok(`${mode}: no page errors`, errs.length === 0, errs.slice(0, 2).join(' | ') || 'none');

    await page.close();
  }

  await browser.close();
  srv.close();
  console.log(`\n==== ${pass} passed, ${fail} failed ====`);   // the runner parses THIS form
  process.exit(fail ? 1 : 0);
})();
