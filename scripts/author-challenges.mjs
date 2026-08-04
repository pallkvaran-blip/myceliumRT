#!/usr/bin/env node
// =============================================================================
// author-challenges.mjs — generate the CHALLENGE levels into docs/levels/.
//
//   NODE_PATH=/opt/node22/lib/node_modules node scripts/author-challenges.mjs
//   ... --only spoiling          # one design
//   ... --dry                    # validate + report, write nothing
//   then: node scripts/gen-levels.mjs && node tests/challenge-check.cjs
//
// Each design REUSES a traced map's rock (via `assetsFrom`, so no sprite is copied) and adds
// the two things a trace ships without: FOOD, which is what actually defines the route, and
// THREATS, which are the challenge. Re-running overwrites the JSON — put hand-tweaks here.
//
// WHY THIS DRIVES A BROWSER. Rock collision is stamped from each sprite's ALPHA into a 9px
// mask at render time, so the only place the truth exists is a running page: the boxes in the
// source JSON overstate rock badly (a sprite is mostly transparent) and say nothing about the
// thin tapered edges where a sight ray grazes. Placing from the JSON puts piles inside walls
// and threats in sealed pockets. So every coordinate below is a REQUEST that gets snapped to
// genuinely open ground, and every relationship the design depends on is then measured.
//
// The two rules that make a level playable at all, both checked per design:
//
//   ROUTE. A basic grow only reaches an attractor within growth.sensingRadius (135 x 1.5
//   scale = 202.5 units) of a tip, so a colony crosses a map by hopping food. Consecutive
//   waypoints must therefore be inside that AND have a clear line between them — otherwise
//   the player stalls on "no food within sensing range" with a card-less hand. This is why a
//   freshly traced map is unplayable rather than merely empty, and why the empty rows below
//   the traced art are not the free bypass they look like: nothing down there is an attractor.
//
//   SENSE. "In sensing range" is within sightRadius AND segmentClear. A cloud placed 400
//   units from the pile it is supposed to race you for, with a rock in between, sits still
//   for the whole level — a silent dead design that looks fine in the JSON and in a
//   screenshot. Every threat/target pair is measured here instead.
// =============================================================================
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';

// Playwright lives outside the repo here (/opt/node22/lib/node_modules) and ESM does not honour
// NODE_PATH — only CommonJS resolution does, which is why every tests/*.cjs finds it and an
// `import` from this file cannot. createRequire borrows that resolution.
const require = createRequire(import.meta.url);
const { chromium } = (() => {
  for (const p of ['playwright', '/opt/node22/lib/node_modules/playwright']) {
    try { return require(p); } catch (_) { /* try the next */ }
  }
  throw new Error('playwright not found — try NODE_PATH=/opt/node22/lib/node_modules');
})();

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');
const LEVELS = resolve(ROOT, 'docs/levels');
const argv = process.argv.slice(2);
const DRY = argv.includes('--dry');
const ONLY = (() => { const i = argv.indexOf('--only'); return i >= 0 ? argv[i + 1] : null; })();

const CS = 36;                       // world units per cell — every design below thinks in cells
const SENSE = 202.5;                 // growth.sensingRadius x growth.scale: the route hop limit
const HOP = 150;                     // what we actually space food at, comfortably inside SENSE

// -----------------------------------------------------------------------------
// THE DESIGNS.
//
// `spine` is the route: a list of {col,row} the colony hops along, filled in at ~HOP spacing
// and stamped as small duff (yellow — plain energy) piles. `branches` hang a prize off the
// spine. `threats` is the population, which is the thing a level could not previously control
// (see configForLevelDef's `threats` block: respawn tops up to the CAMPAIGN's ceiling, so a
// level that places two worms used to get a third from nowhere).
// -----------------------------------------------------------------------------
const DESIGNS = [
  {
    key: 'spoiling',
    id: 'challenge-spoiling', name: 'Spoiling Ground', from: 'obsidian-c15',
    // A cloud clears a 5-cell pile in 6 steps (trichoderma.leavesPerRound 0.85, set by the
    // owner from exactly that outcome). So a red pile at food r:1 — a 5-cell diamond — IS a
    // six-step fuse, and a cloud that can see one is a visible clock on the player's REWARD
    // rather than on their tissue. Three fuses, lit at once, at staggered distances: the
    // near one is already half gone by the time it could be reached, so the level is a
    // triage decision and not a completeness exercise.
    blurb: 'Three engine piles, three clouds already eating them. You cannot have all three.',
    spine: [{ col: 1, row: 1 }, { col: 1, row: 16 }, { col: 2, row: 38 }, { col: 20, row: 38 }, { col: 45, row: 38 }, { col: 65, row: 38 }, { col: 74, row: 38 }, { col: 75, row: 18 }, { col: 75, row: 1 }],
    branches: [
      { at: { col: 20, row: 38 }, to: { col: 20, row: 24 }, prize: 'cache-engine', prizeR: 3, cloudFrom: 480 },
      { at: { col: 45, row: 38 }, to: { col: 45, row: 24 }, prize: 'cache-engine', prizeR: 2, cloudFrom: 360 },
      { at: { col: 65, row: 38 }, to: { col: 65, row: 24 }, prize: 'cache-engine', prizeR: 1, cloudFrom: 250 },
    ],
    threats: { trych: 3, nematodes: 0, ants: 0, respawn: false },
  },
  {
    key: 'swarm',
    id: 'challenge-swarm', name: 'Don\'t Feed Them', from: 'rust-c90',
    // nematodes.breedChance is 0.8 PER TICK IN CONTACT, capped at 150 — so the cost of this
    // level is paid entirely at the FIRST bite, and a clean run is trivial. Two worms sit
    // watching the open ground; the prize (an orange draft pile) is out there with them, and
    // the safe route threads the rock where they have no line of sight. The lesson only
    // lands if the worms cannot see the colony at the start, which is measured below.
    blurb: 'Two worms watching open ground. The first bite is the expensive one, not the last.',
    spine: [{ col: 1, row: 1 }, { col: 1, row: 15 }, { col: 2, row: 30 }, { col: 18, row: 30 }, { col: 33, row: 30 }, { col: 50, row: 30 }, { col: 66, row: 30 }, { col: 74, row: 30 }, { col: 75, row: 16 }, { col: 75, row: 1 }],
    branches: [
      { at: { col: 33, row: 30 }, to: { col: 33, row: 40 }, prize: 'cache', wormFrom: 300 },
      { at: { col: 50, row: 30 }, to: { col: 50, row: 41 }, prize: 'cache', wormFrom: 300 },
    ],
    threats: { trych: 0, nematodes: 2, ants: 0, respawn: false },
  },
  {
    key: 'antroad',
    id: 'challenge-antroad', name: 'The Ants\' Road', from: 'glacier-c40',
    // The one mechanic nothing in the game currently uses. stepNematodes falls back to ant
    // TRAIL cells only when no strand is in sight, and the feed block bails before biting
    // ("the fallbacks never feed") — so a worm parked on a trail is a defused worm. The ants
    // are meanwhile draining the pile the player wants (harvestRate 40 per action). So the
    // trail is simultaneously the player's shield and the reason they are losing food, and
    // Excreting the nest to stop the drain removes the shield. Three worms, so the choice
    // has weight; the nest goes over the pile it should work (placeAntNests paths its trail
    // at build time, before the rock mask exists, so it wants its food close).
    blurb: 'The worms are shadowing the ant trail. Kill the ants and they come looking for you.',
    spine: [{ col: 1, row: 1 }, { col: 1, row: 16 }, { col: 2, row: 32 }, { col: 20, row: 32 }, { col: 36, row: 32 }, { col: 52, row: 32 }, { col: 68, row: 32 }, { col: 74, row: 32 }, { col: 75, row: 18 }, { col: 75, row: 1 }],
    branches: [
      // Three worms at staggered distances around the trail's far end. A pack, because the
      // choice ("leave the ants alone and they keep the worms busy") has to cost something
      // real to be a choice at all.
      { at: { col: 36, row: 32 }, to: { col: 36, row: 14 }, prize: 'cache-engine', prizeR: 2, wormsFrom: [260, 320, 380], antNest: true },
    ],
    threats: { trych: 0, nematodes: 3, ants: 1, respawn: false },
  },
];

// -----------------------------------------------------------------------------
const T = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.png': 'image/png', '.webp': 'image/webp', '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.svg': 'image/svg+xml' };

// Injected into the page: everything here has to run where the mask exists.
const HELPERS = () => {
  const g = window.__game, sub = g.state.substrate;
  const cs = sub.cellSize;
  window.__A = {
    cs, cols: sub.cols, rows: sub.rows, surfaceY: sub.surfaceY,
    xy: (col, row) => ({ x: col * cs + cs / 2, y: sub.surfaceY + row * cs + cs / 2 }),
    // Open means open for a DISC, not for a point: a pile stamps a diamond of cells and a
    // creature needs room to sit, so a spot one fine-cell from a wall is not a spot.
    free: (x, y, rad) => {
      if (sub.solidAtWorld(x, y)) return false;
      for (let a = 0; a < 12; a++) {
        const t = (a / 12) * Math.PI * 2;
        if (sub.solidAtWorld(x + Math.cos(t) * rad, y + Math.sin(t) * rad)) return false;
      }
      const c = sub.cellAtWorld(x, y);
      return !!c && !c.water && !c.rock;
    },
    // Nearest genuinely open spot to a request, searched as expanding rings so the answer is
    // the closest one rather than the first one found in some scan order.
    snap: (x, y, rad, maxR) => {
      if (window.__A.free(x, y, rad)) return { x: Math.round(x), y: Math.round(y), moved: 0 };
      for (let r = cs * 0.5; r <= maxR; r += cs * 0.5) {
        for (let a = 0; a < 32; a++) {
          const t = (a / 32) * Math.PI * 2;
          const nx = x + Math.cos(t) * r, ny = y + Math.sin(t) * r;
          if (window.__A.free(nx, ny, rad)) return { x: Math.round(nx), y: Math.round(ny), moved: Math.round(r) };
        }
      }
      return null;
    },
    clear: (a, b) => sub.segmentClear(a.x, a.y, b.x, b.y),
    // A threat spot at `dist` from its target WITH a clear line to it — the whole point being
    // that a threat which cannot see its target never moves.
    //
    // AND OUT OF SENSING RANGE OF THE MAIN ROUTE (`avoid` = the spine piles, `avoidR` = the
    // creature's sightRadius). This second condition is what separates every design here from
    // the gauntlet level the campaign already has, and it is the one that is invisible once
    // the level is written. A guard that can see the route does not guard its prize:
    //   • a WORM prefers mycelium over everything (the trail fallback only fires when no
    //     strand is in sight), so it abandons the ant road and hunts the player — which
    //     deletes the entire lesson of both worm designs;
    //   • a CLOUD heads for its NEAREST visible food, so a stepping-stone crumb in view
    //     outranks the prize it was placed to eat, and the six-step fuse never lights.
    // Both read as "the threat wandered off" and neither is visible in the JSON.
    watcher: (target, dist, rad, avoid, avoidR) => {
      const out = [];
      for (let a = 0; a < 96; a++) {
        const t = (a / 96) * Math.PI * 2;
        const x = target.x + Math.cos(t) * dist, y = target.y + Math.sin(t) * dist;
        if (!window.__A.free(x, y, rad)) continue;
        if (!sub.segmentClear(x, y, target.x, target.y)) continue;
        // Blocked line OR out of range both count as "cannot sense" — that is the engine's
        // own rule (within sightRadius AND segmentClear), so it is the rule to test.
        let exposed = false;
        for (const p of avoid || []) {
          if (Math.hypot(p.x - x, p.y - y) > avoidR) continue;
          if (sub.segmentClear(x, y, p.x, p.y)) { exposed = true; break; }
        }
        if (exposed) continue;
        out.push({ x: Math.round(x), y: Math.round(y), a: t });
      }
      return out;
    },
    root: () => (g.state.active && g.state.active.root ? { x: g.state.active.root.x, y: g.state.active.root.y } : null),
    sight: { cloud: g.state.config.trichoderma.sightRadius, worm: g.state.config.nematodes.sightRadius },
    // Already scaled: applyOrganismScale multiplies growth lengths into CONFIG at module
    // load, so this is the live 202.5 and not the 135 written in the literal.
    sense: g.state.config.growth.sensingRadius,
  };
  return true;
};

async function boot(page, base, id) {
  await page.addInitScript(() => { window.MYCELIUM_SUPABASE = { url: '', anonKey: '' }; });
  await page.goto(base + '/index.html#level,' + id, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#loadscreen.ld-ready', { timeout: 60000 }).catch(() => {});
  await page.click('#loadscreen', { timeout: 5000 }).catch(() => {});
  await page.waitForFunction(() => window.__game && window.__game.state && window.__game.state.active, null, { timeout: 30000 });
  // Nothing below means anything until every sprite has decoded and the mask is stamped.
  const ok = await page.waitForFunction(() => window.__game.state.substrate._rockSolidified === true, null, { timeout: 60000 }).then(() => true).catch(() => false);
  if (!ok) throw new Error(`${id}: rock mask never solidified — cannot place against it`);
  await page.evaluate(HELPERS);
}

(async () => {
  const srv = await new Promise((res) => {
    const s = createServer((rq, rs) => {
      let p = decodeURIComponent(rq.url.split('?')[0].split('#')[0]);
      if (p === '/') p = '/index.html';
      const fp = resolve(ROOT, '.' + p);
      if (!fp.startsWith(ROOT) || !existsSync(fp)) { rs.writeHead(404); rs.end('nf'); return; }
      const ext = fp.slice(fp.lastIndexOf('.'));
      rs.writeHead(200, { 'Content-Type': T[ext] || 'application/octet-stream' });
      rs.end(readFileSync(fp));
    });
    s.listen(0, () => res(s));
  });
  const base = 'http://localhost:' + srv.address().port;
  const browser = await chromium.launch({ headless: true });
  let bad = 0;

  for (const d of DESIGNS) {
    if (ONLY && d.key !== ONLY) continue;
    const srcPath = resolve(LEVELS, d.from + '.json');
    if (!existsSync(srcPath)) { console.log(`SKIP ${d.id}: source ${d.from}.json missing`); bad++; continue; }
    const src = JSON.parse(readFileSync(srcPath, 'utf8'));

    const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
    const errs = [];
    page.on('pageerror', (e) => errs.push(String(e && e.message)));
    await boot(page, base, d.from);
    console.log(`\n=== ${d.id}  (${d.name})  <- ${d.from} ===`);

    const built = await page.evaluate((design) => {
      const A = window.__A, notes = [];

      // ---- collect every pile as a REQUEST, then resolve conflicts ----------
      // stampFood skips a cell another pile already owns, so two piles whose diamonds overlap
      // do not merge — the second one silently comes out SMALLER. That matters here because a
      // prize's size IS its fuse length (a 5-cell pile is the 6-step pile the eating rate was
      // tuned against), so a crumb stealing two of its cells shortens the fuse with nothing to
      // say so. Two r:1 diamonds need their centres 3 cells apart to be disjoint: centres 2
      // apart still share the cell between them.
      const MIN_SEP = A.cs * 3;
      const reqs = [];
      // Diamonds must not touch: two piles of radius rA and rB need (rA + rB + 1) cells between
      // their centres. Only food is consulted — a creature standing near a pile is fine.
      const fits = (x, y, r) => !reqs.some((q) => q.t === 'food'
        && Math.hypot(q.x - x, q.y - y) < A.cs * ((q.r == null ? 1 : q.r) + (r == null ? 1 : r) + 1));

      // THE ROUTE, laid as a SEQUENTIAL WALK rather than as interpolated points.
      //
      // Interpolating and then dropping whatever collided was the obvious version and it is
      // wrong in a way that is invisible until the level is played: the chain is LINEAR, so one
      // dropped pile doubles a gap to ~270 units, the colony cannot hop it, and every pile
      // beyond that point is orphaned. Measured — a single drop near the top of the entry
      // descent orphaned 31 of 33 piles.
      //
      // So the walk carries the constraint instead. It marches the polyline in small steps and
      // places a pile only where the spot is legal on BOTH bounds at once: at least MIN_SEP from
      // the last one (or their diamonds merge and both come out the wrong size) and no more than
      // MAX_HOP with a clear line (or the colony cannot reach it). Where rock makes that
      // impossible it keeps marching, which is what routes the food through a gap instead of
      // into a wall.
      const MAX_HOP = A.sense - 12;              // stay inside the real limit, not level with it
      const walk = (poly, role, startFrom, jitter) => {
        const placed = [];
        let last = startFrom || null;
        for (let i = 0; i + 1 < poly.length; i++) {
          const a = poly[i], b = poly[i + 1];
          const len = Math.hypot(b.x - a.x, b.y - a.y);
          for (let t = 0; t <= len; t += 18) {
            const px = a.x + (b.x - a.x) * (t / len), py = a.y + (b.y - a.y) * (t / len);
            // SCATTER THE STONES OFF THE CENTRELINE. Laid exactly on the polyline the route
            // reads as a machine-placed ladder of identical piles — most obviously down the
            // entry descent and the goal ascent, which are straight vertical lines hugging the
            // channel walls, and it was the first thing visible in a rendered frame while all
            // 50 assertions were perfectly happy. Offset perpendicular by up to ~1.2 cells,
            // from a HASH of the position rather than Math.random so re-running the script
            // reproduces the same level rather than a new one each time.
            const h = Math.sin((px * 0.017 + py * 0.031 + i * 7.3)) * 43758.5453;
            // Only the long ROUTE is scattered. A branch is a few piles bridging a verified
            // straight line to its prize, so pushing them sideways costs the clearance the line
            // was chosen for and breaks the chain at one link — it orphaned a prize on the first
            // attempt, which the connectivity gate caught.
            const j = jitter ? ((h - Math.floor(h)) - 0.5) * 2 * A.cs * 1.2 : 0;
            const nx = -(b.y - a.y) / len, ny = (b.x - a.x) / len;   // unit normal to the leg
            const want = { x: px + nx * j, y: py + ny * j };
            // Nothing to do until we are far enough from the last pile to want another.
            if (last && Math.hypot(want.x - last.x, want.y - last.y) < MIN_SEP) continue;
            // Modest clearance, and only a short search. A stepping stone is an ATTRACTOR, not
            // a chamber: stampFood simply skips the cells it cannot use, so a crumb in a narrow
            // corridor comes out smaller and works exactly as well. Demanding a 1.2-cell disc
            // made the snap shove crumbs several cells sideways to find room, which is what
            // broke chains inside corridors that segmentClear had already proved passable.
            const s2 = A.snap(want.x, want.y, A.cs * 0.7, A.cs * 2);
            if (!s2 || !fits(s2.x, s2.y, 0)) continue;
            if (last) {
              const d = Math.hypot(s2.x - last.x, s2.y - last.y);
              if (d < MIN_SEP) continue;
              // Past the hop limit (or behind rock) the chain is BROKEN here. Re-anchor so the
              // rest of the route still gets laid — a truncated route looks like a shorter
              // level, while a recorded break says which stretch of spine to move.
              if (d > MAX_HOP || !A.clear(last, s2)) {
                notes.push(`${role} chain breaks before ${s2.x},${s2.y} — ${Math.round(d)} units from the last pile (limit ${Math.round(MAX_HOP)}), re-anchoring`);
                reqs.push({ x: s2.x, y: s2.y, t: 'food', kind: 'duff', r: 0, energy: 2, role });
                placed.push(s2); last = s2;
                continue;
              }
            }
            reqs.push({ x: s2.x, y: s2.y, t: 'food', kind: 'duff', r: 0, energy: 2, role });
            placed.push(s2); last = s2;
          }
        }
        return { placed, last };
      };
      // Start the walk AT THE COLONY. The colony seeds at the surface, so a route whose first
      // pile is deep is unreachable on turn one however tidy its own spacing is.
      const route = walk(design.spine.map((sp) => A.xy(sp.col, sp.row)), 'route', A.root(), true).placed;

      // THE PRIZES, placed after the route because each one is chosen BY its line back to the
      // route (see below) — but still EMITTED first, via the `order` map, so a prize wins every
      // cell of its diamond and a crumb gives way rather than the other way round.
      const plans = [];
      for (const br of design.branches) {
        const pr = br.prizeR || 1;
        // FIND A POCKET WITH A CLEAR SHOT FROM THE ROUTE, rather than insisting on the column
        // the design named. A branch has to climb off the route into the traced art, and on a
        // map whose lower edge is a near-continuous band (obsidian-c15) no straight vertical
        // line gets through anywhere — shifting columns just fails in a different column. What
        // a branch actually needs is a spot that is open, near where the design wanted it, and
        // joined to SOME existing route pile by a clear straight line long enough to need a few
        // crumbs. Then the walk along that line cannot be blocked, by construction.
        //
        // Deliberately searched against the route piles that EXIST rather than the requested
        // junction: the route was itself placed by the mask, so the junction is wherever the
        // mask allowed, not where the spine said.
        const wantAt = A.xy(br.to.col, br.to.row);
        let pz = null, anchor = null, moved = 0;
        for (let k = 0; k <= 20 && !pz; k++) {
          for (const sg of (k === 0 ? [0] : [-k, k])) {
            for (const dr of [0, -2, 2, -4, 4]) {
              const cand = A.xy(br.to.col + sg, br.to.row + dr);
              const sp = A.snap(cand.x, cand.y, A.cs * (pr + 0.3), A.cs * 2);
              if (!sp || !fits(sp.x, sp.y, pr)) continue;
              // The join: a route pile with an unobstructed line, far enough away that the
              // branch is a real detour and close enough that a few crumbs bridge it.
              // The join has to leave ROOM FOR A CRUMB. A big prize pushes MIN_SEP out (an r:2
              // diamond reaches 2 cells), so an anchor ~250 away is simultaneously too far for
              // a direct hop (MAX_HOP 191) and too close to fit anything between — the walk
              // places nothing and the branch is orphaned by a gap of exactly one link.
              const roomForOne = A.cs * (pr + 2) + MIN_SEP + 20;
              const near = Math.max(300, roomForOne);
              let best = null, bd = Infinity;
              for (const rp of route) {
                const dd = Math.hypot(rp.x - sp.x, rp.y - sp.y);
                if (dd < near || dd > 700 || dd >= bd) continue;
                if (!A.clear(rp, sp)) continue;
                bd = dd; best = rp;
              }
              if (!best) continue;
              pz = sp; anchor = best; moved = Math.round(Math.hypot(sp.x - wantAt.x, sp.y - wantAt.y));
              break;
            }
            if (pz) break;
          }
        }
        if (!pz) { notes.push(`no pocket near col ${br.to.col} with a clear line back to the route — the ${br.prize} branch is dropped`); continue; }
        if (moved > A.cs) notes.push(`${br.prize} prize moved ${moved} units from the requested spot to find a clear line back to the route`);
        reqs.push({ x: pz.x, y: pz.y, t: 'food', kind: br.prize, r: pr, role: 'prize' });
        plans.push({ br, pz, anchor });
      }

      // ---- the branches: crumbs up to each prize, then its guards -----------
      const prizes = [];
      for (const { br, pz, anchor } of plans) {
        // WALKED OUTWARD FROM THE PRIZE, not inward from the route. The walk stops placing once
        // `fits` rejects everything within MIN_SEP of an existing pile, so whichever end it
        // finishes at is the end that ends up with a full-width gap in front of it. Starting at
        // the prize puts that gap next to the ANCHOR — a pile the walk marches right up to, so
        // the last crumb lands MIN_SEP-ish from it and connects. Starting at the anchor instead
        // left the gap in front of the PRIZE, which is the one pile that must be reachable.
        const branch = walk([{ x: pz.x, y: pz.y }, anchor], 'branch', pz).placed;

        const rec = { at: { x: pz.x, y: pz.y }, kind: br.prize, r: br.prizeR || 1, guards: [], branch };
        // A guard must see its prize and NOT sense THE ROUTE. Deliberately the route only, not
        // the branch crumbs: the branch is the detour that exposes you, so a guard seeing it is
        // the design working. Testing against the branch too is unsatisfiable — the crumbs run
        // right up to the prize the guard is required to see.
        const place = (dist, t) => {
          const sr = t === 'cloud' ? A.sight.cloud : A.sight.worm;
          let cands = [], used = dist;
          for (let k = 0; k <= 8 && !cands.length; k++) {
            for (const sg of (k === 0 ? [0] : [-k, k])) {
              const dd = dist + sg * A.cs;
              if (dd < A.cs * 1.5) continue;
              cands = A.watcher(pz, dd, A.cs * 0.9, route, sr);
              if (cands.length) { used = dd; break; }
            }
          }
          if (!cands.length) { notes.push(`no spot that can see the ${br.prize} prize at ~${dist} units AND cannot sense the route — move the branch further from the spine`); return null; }
          if (used !== dist) notes.push(`${t} moved to ${used} units from the ${br.prize} prize (asked ${dist}) to stay blind to the route`);
          // Furthest from the colony root, so the creature sits BEYOND its prize rather than
          // between the player and it — being ambushed on the approach is a different level.
          const root = A.root();
          cands.sort((p, q) => (Math.hypot(q.x - root.x, q.y - root.y) - Math.hypot(p.x - root.x, p.y - root.y)));
          const c = cands[0];
          reqs.push({ x: c.x, y: c.y, t: t === 'cloud' ? 'trichoderma' : 'nematode', role: 'guard' });
          rec.guards.push({ t, x: c.x, y: c.y, dist: Math.round(Math.hypot(c.x - pz.x, c.y - pz.y)) });
          return c;
        };
        if (br.cloudFrom) place(br.cloudFrom, 'cloud');
        if (br.wormFrom) place(br.wormFrom, 'worm');
        for (const dist of br.wormsFrom || []) place(dist, 'worm');
        if (br.antNest) { reqs.push({ x: pz.x, t: 'ant', role: 'nest' }); rec.ant = Math.round(pz.x); }
        prizes.push(rec);
      }

      // ---- is the food a CONNECTED route from the colony's own root? --------
      // The real playability question, and not the same as "are the waypoints evenly spaced":
      // the colony seeds at the SURFACE, so a spine that starts deep is unreachable from turn
      // one however tidy its internal spacing is. Edges are sensingRadius AND a clear line,
      // which is exactly what a tip can reach.
      const foodPts = reqs.filter((r) => r.t === 'food');
      const root = A.root();
      const nodes = [root, ...foodPts];
      const seen = new Array(nodes.length).fill(false);
      const SENSE_R = window.__A.sense;
      seen[0] = true;
      const stack = [0];
      while (stack.length) {
        const i = stack.pop();
        for (let j = 0; j < nodes.length; j++) {
          if (seen[j]) continue;
          if (Math.hypot(nodes[j].x - nodes[i].x, nodes[j].y - nodes[i].y) > SENSE_R) continue;
          if (!A.clear(nodes[i], nodes[j])) continue;
          seen[j] = true; stack.push(j);
        }
      }
      const orphans = [];
      for (let j = 1; j < nodes.length; j++) if (!seen[j]) orphans.push({ x: nodes[j].x, y: nodes[j].y, role: foodPts[j - 1].role });

      // Emit prizes before route/branch food so the prizes win their cells.
      const order = { prize: 0, route: 1, branch: 2, guard: 3, nest: 4 };
      const objects = reqs.slice().sort((a, b) => order[a.role] - order[b.role]).map((r) => {
        const o = { t: r.t };
        if (r.x != null) o.x = r.x;
        if (r.t !== 'ant' && r.y != null) o.y = r.y;
        if (r.t === 'food') { o.kind = r.kind; o.r = r.r; if (r.energy != null) o.energy = r.energy; }
        return o;
      });

      return {
        objects, prizes, notes, root, sense: SENSE_R,
        route: route.map((p) => ({ x: p.x, y: p.y })),
        counts: { route: route.length, branch: reqs.filter((r) => r.role === 'branch').length, food: foodPts.length },
        orphans,
      };
    }, d);

    // ---- report + gate ------------------------------------------------------
    console.log(`  food: ${built.counts.food} piles — ${built.counts.route} on the route, ${built.counts.branch} on branches, ${built.prizes.length} prizes`);
    console.log(`  every pile reachable from the colony root by ${built.sense.toFixed(1)}-unit hops: ${built.orphans.length === 0 ? 'yes' : 'NO — ' + built.orphans.length + ' orphaned'}`);
    for (const o of built.orphans.slice(0, 5)) console.log(`      orphan (${o.role}) at ${o.x},${o.y}`);
    for (const p of built.prizes) {
      console.log(`  prize ${p.kind} r${p.r} at ${p.at.x},${p.at.y}` + (p.ant != null ? `  + ant nest at x=${p.ant}` : ''));
      for (const g of p.guards) console.log(`      ${g.t} at ${g.x},${g.y} — ${g.dist} units to its prize, sees it; CANNOT sense the route`);
    }
    for (const n of built.notes) console.log(`  NOTE: ${n}`);
    if (errs.length) console.log(`  page errors: ${errs.slice(0, 3).join(' | ')}`);
    if (built.orphans.length) {
      console.log(`  ** ${d.id} is NOT playable as laid out — food the colony can never hop to means the run stalls. Adjust the spine. **`);
      bad++;
    }

    const out = {
      format: 'mycelium-level', version: 1,
      id: d.id, name: d.name,
      campaignLevel: null,                 // a prototype claims no slot — reachable by #level,<id>
      // Sprites stay in the source map's folder; start() loads `assetsFrom || id`.
      assetsFrom: src.assetsFrom || src.id,
      derivedFrom: src.id,
      challenge: d.blurb,
      // Roles, for tests/challenge-check.cjs. buildLevel ignores unknown top-level fields, and
      // sub.foodPiles carries no role of its own — but "no worm can sense the SAFE ROUTE" needs
      // the route told apart from the branch that is meant to be exposed.
      design: {
        route: built.route,
        prizes: built.prizes.map((p) => ({ kind: p.kind, r: p.r, at: p.at, guards: p.guards, branch: p.branch })),
      },
      world: src.world,
      layout: src.layout,
      render: src.render || undefined,
      threats: d.threats,
      // Rock first and unchanged, then water (none here), then food — stampFood yields to
      // water, and solidifyRock skips food cells, so this order is the one that behaves.
      objects: [...src.objects, ...built.objects],
    };
    if (!out.render) delete out.render;
    if (!DRY) {
      writeFileSync(resolve(LEVELS, d.id + '.json'), JSON.stringify(out, null, 2) + '\n');
      console.log(`  wrote docs/levels/${d.id}.json  (${out.objects.length} objects)`);
    } else console.log(`  --dry: would write ${out.objects.length} objects`);
    await page.close();
  }

  await browser.close();
  srv.close();
  if (bad) { console.log(`\n${bad} design(s) need adjusting.`); process.exit(1); }
  console.log('\nAll designs laid out. Next: node scripts/gen-levels.mjs && node tests/challenge-check.cjs');
})();
