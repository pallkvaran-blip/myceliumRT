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
    spine: [{ col: 4, row: 31 }, { col: 20, row: 31 }, { col: 45, row: 31 }, { col: 65, row: 31 }, { col: 74, row: 31 }],
    branches: [
      { at: { col: 20, row: 31 }, to: { col: 20, row: 21 }, prize: 'cache-engine', cloudFrom: 480 },
      { at: { col: 45, row: 31 }, to: { col: 45, row: 21 }, prize: 'cache-engine', cloudFrom: 360 },
      { at: { col: 65, row: 31 }, to: { col: 65, row: 21 }, prize: 'cache-engine', cloudFrom: 250 },
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
    spine: [{ col: 4, row: 30 }, { col: 18, row: 30 }, { col: 33, row: 30 }, { col: 50, row: 30 }, { col: 66, row: 30 }, { col: 74, row: 30 }],
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
    spine: [{ col: 4, row: 32 }, { col: 20, row: 32 }, { col: 36, row: 32 }, { col: 52, row: 32 }, { col: 68, row: 32 }, { col: 74, row: 32 }],
    branches: [
      // Three worms at staggered distances around the trail's far end. A pack, because the
      // choice ("leave the ants alone and they keep the worms busy") has to cost something
      // real to be a choice at all.
      { at: { col: 36, row: 32 }, to: { col: 36, row: 14 }, prize: 'cache-engine', wormsFrom: [260, 320, 380], antNest: true },
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
      if (window.__A.free(x, y, rad)) return { x, y, moved: 0 };
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
      const A = window.__A, notes = [], objects = [];
      const PILE_RAD = A.cs * 1.2;      // room for a small pile's diamond plus its mat
      const CREEP_RAD = A.cs * 0.9;     // room for a creature to sit and move off

      // ---- the route: hop-spaced duff along the spine ----------------------
      const route = [];
      const pts = design.spine.map((s) => A.xy(s.col, s.row));
      for (let i = 0; i + 1 < pts.length; i++) {
        const a = pts[i], b = pts[i + 1];
        const seg = Math.hypot(b.x - a.x, b.y - a.y);
        const n = Math.max(1, Math.ceil(seg / 150));
        for (let k = 0; k < n; k++) {
          const t = k / n;
          const want = { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
          const s = A.snap(want.x, want.y, PILE_RAD, A.cs * 5);
          if (!s) { notes.push(`spine point ${i}.${k} had no open spot within 5 cells`); continue; }
          route.push(s);
        }
      }
      const last = pts[pts.length - 1];
      const ls = A.snap(last.x, last.y, PILE_RAD, A.cs * 5);
      if (ls) route.push(ls);

      // Dedupe spots that snapped onto each other (stampFood skips a cell another pile owns,
      // so a duplicate is a silently empty pile rather than an error).
      const kept = [];
      for (const p of route) if (!kept.some((q) => Math.hypot(q.x - p.x, q.y - p.y) < A.cs * 0.9)) kept.push(p);

      // The gaps are the thing that decides whether the level is playable at all.
      const gaps = [];
      for (let i = 0; i + 1 < kept.length; i++) {
        const a = kept[i], b = kept[i + 1];
        gaps.push({ d: Math.round(Math.hypot(b.x - a.x, b.y - a.y)), clear: A.clear(a, b) });
      }
      for (const p of kept) objects.push({ t: 'food', kind: 'duff', x: p.x, y: p.y, r: 1, energy: 2 });

      // ---- branches: a prize, its guard, and the crumbs to reach it --------
      const prizes = [];
      for (const br of design.branches) {
        const from = A.xy(br.at.col, br.at.row), to = A.xy(br.to.col, br.to.row);
        const pz = A.snap(to.x, to.y, PILE_RAD, A.cs * 6);
        if (!pz) { notes.push(`branch prize at ${br.to.col},${br.to.row} had no open spot`); continue; }
        // Crumbs from the spine up to the prize, same hop rule.
        const seg = Math.hypot(pz.x - from.x, pz.y - from.y);
        const n = Math.max(1, Math.ceil(seg / 150));
        const crumbs = [];
        for (let k = 1; k < n; k++) {
          const s = A.snap(from.x + (pz.x - from.x) * (k / n), from.y + (pz.y - from.y) * (k / n), PILE_RAD, A.cs * 4);
          if (s && !crumbs.some((q) => Math.hypot(q.x - s.x, q.y - s.y) < A.cs * 0.9)) crumbs.push(s);
        }
        for (const c of crumbs) objects.push({ t: 'food', kind: 'duff', x: c.x, y: c.y, r: 1, energy: 2 });
        objects.push({ t: 'food', kind: br.prize, x: pz.x, y: pz.y, r: 1 });

        const rec = { at: { x: pz.x, y: pz.y }, kind: br.prize, guards: [] };
        // A guard has to SEE its target or it never moves. Take the candidate furthest from
        // the colony root, so the creature sits beyond the prize rather than between the
        // player and it — being ambushed on the approach is a different level.
        const place = (dist, t) => {
          const sr = t === 'cloud' ? A.sight.cloud : A.sight.worm;
          // Widen the ring until a spot satisfies BOTH conditions; report if none ever does,
          // because the honest answer is "this branch is too close to the route" and the fix
          // is the design, not a relaxed constraint.
          // Search the ring OUTWARD AND INWARD. Only growing it is wrong for the failure that
          // actually happens here: the constraint that bites is "too close to the route", and
          // a wider ring reaches further toward the route, so growing makes the very case it
          // is meant to rescue strictly worse. Alternating means the requested distance is
          // still preferred and the nearest satisfiable one wins.
          let cands = [], used = dist;
          for (let k = 0; k <= 8 && !cands.length; k++) {
            for (const s of (k === 0 ? [0] : [-k, k])) {
              const dd = dist + s * A.cs;
              if (dd < A.cs * 1.5) continue;                 // closer than this is "on top of it"
              cands = A.watcher(pz, dd, CREEP_RAD, kept, sr);
              if (cands.length) { used = dd; break; }
            }
          }
          if (cands.length && used !== dist) notes.push(`${t} moved to ${used} units from the ${br.prize} prize (asked ${dist}) to stay blind to the route`);
          if (!cands.length) { notes.push(`no spot that can see the ${br.prize} prize at ~${dist} units AND cannot sense the route — move the branch further from the spine`); return null; }
          const root = A.root();
          cands.sort((p, q) => (Math.hypot(q.x - root.x, q.y - root.y) - Math.hypot(p.x - root.x, p.y - root.y)));
          const c = cands[0];
          objects.push(t === 'cloud' ? { t: 'trichoderma', x: c.x, y: c.y } : { t: 'nematode', x: c.x, y: c.y });
          rec.guards.push({ t, x: c.x, y: c.y, dist: Math.round(Math.hypot(c.x - pz.x, c.y - pz.y)) });
          return c;
        };
        if (br.cloudFrom) place(br.cloudFrom, 'cloud');
        if (br.wormFrom) place(br.wormFrom, 'worm');
        // Staggered pack. Each is placed independently, so two can land close together; that
        // is fine (a pack reads as a pack) as long as each has its own line to the target.
        for (const dist of br.wormsFrom || []) place(dist, 'worm');
        if (br.antNest) {
          // A nest is a COLUMN and sits at the surface; its trail is pathed to the nearest
          // food at build time, so it belongs over the pile it should be working.
          objects.push({ t: 'ant', x: pz.x });
          rec.ant = Math.round(pz.x);
        }
        prizes.push(rec);
      }
      return { objects, kept: kept.length, gaps, prizes, notes, root: A.root(), sight: A.sight };
    }, d);

    // ---- report + gate ------------------------------------------------------
    const overlong = built.gaps.filter((g) => g.d > 202);
    const blocked = built.gaps.filter((g) => !g.clear);
    console.log(`  route: ${built.kept} stepping-stone piles, longest hop ${Math.max(0, ...built.gaps.map((g) => g.d))} units (limit 202)`);
    console.log(`  hops over the sensing limit: ${overlong.length}   hops crossing rock: ${blocked.length}`);
    for (const p of built.prizes) {
      console.log(`  prize ${p.kind} at ${p.at.x},${p.at.y}` + (p.ant != null ? `  + ant nest at x=${p.ant}` : ''));
      for (const g of p.guards) console.log(`      ${g.t} at ${g.x},${g.y} — ${g.dist} units to its prize, sees it; CANNOT sense the route`);
    }
    for (const n of built.notes) console.log(`  NOTE: ${n}`);
    if (errs.length) console.log(`  page errors: ${errs.slice(0, 3).join(' | ')}`);
    if (overlong.length || blocked.length) {
      console.log(`  ** ${d.id} is NOT playable as laid out — a hop the basic grow cannot make means the run stalls. Adjust the spine. **`);
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
