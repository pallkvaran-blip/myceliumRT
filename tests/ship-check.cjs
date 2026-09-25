/* A BUILD THAT CAN SHIP, AND DIGS THAT LAND WHERE YOU PRESSED — the finishing plan's M2, as assertions.
 *
 * The defects this pins, all measured on `claude/deep-mine-finish` before the fix:
 *   - DEV BUTTONS ON THE PLAIN URL. The Pages build serves the branch with `CONFIG.dev.enabled`
 *     true, so '#mine' showed "Dev: maps" and "Dev: edit rocks" and the store "+10,000 spores".
 *     They now need a `dev` hash token, `?dev=1` or `MYCELIUM_DEV_BUTTONS`.
 *   - THE CAMPAIGN'S 'Level 1' CARD before every descent on a dev-off build (the zip), sim paused.
 *   - DIGS BEFORE THE ROCK MASK. `solidAtWorld` falls back to `cell.rock`, empty on a mine map
 *     until every band sprite decodes: on a slow link strands grew inside drawn rock.
 *   - THE HEAT BYPASS. A walled shallow strand pressed and aimed down fell through to the DEEPEST
 *     tip in the colony (137-142 m) and was charged the 2-water surface price.
 *   - `__game.mine.playSeed` built the world twice and logged two run_starts.
 *   - A seam `stampFood` refused retagged the PREVIOUS pile's material.
 *
 * Every block runs on a fresh context (fresh save).
 */
const path = require('path');
const fs = require('fs');
const H = require('./mine-harness.cjs');
const { sleep } = H;
let pass = 0, fail = 0;
const ok = (n, c, x) => { c ? (pass++, console.log('  PASS  ' + n + (x ? '  — ' + x : ''))) : (fail++, console.log('  FAIL  ' + n + (x ? '  — ' + x : ''))); };
const ART = path.join(H.ROOT, 'tests', '.artifacts');
fs.mkdirSync(ART, { recursive: true });
const ONLY = (process.env.SHIP_ONLY || '').split(',').filter(Boolean);
const want = (k) => !ONLY.length || ONLY.includes(k);

const QUIET = () => {
  const s = window.__game.state;
  s.nematodes.length = 0; s.clouds.length = 0;
  s.config.nematodes.respawnChance = 0; s.config.trichoderma.respawnChance = 0;
  if (s.config.mine.worms) s.config.mine.worms.waterPerSec = 0;
};
// Every VISIBLE element whose own text starts with 'Dev' (the dev buttons' shared prefix).
const visibleDev = (page) => page.evaluate(() => {
  const out = [];
  for (const el of document.querySelectorAll('body *')) {
    const t = (el.textContent || '').trim();
    if (!/^Dev/.test(t)) continue;
    const r = el.getBoundingClientRect(), cs = getComputedStyle(el);
    if (r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none' && +cs.opacity > 0)
      out.push((el.id || el.tagName.toLowerCase()) + ': ' + t.slice(0, 24));
  }
  return [...new Set(out)];
});
const openStore = async (page) => {
  await page.evaluate(() => { document.querySelectorAll('#speciesSelect').forEach((n) => n.remove()); window.__game.showPicker(); });
  await sleep(700);
  return page.evaluate(() => !!document.getElementById('speciesSelect'));
};

(async () => {
  const E = await H.start();
  try {
    // =======================================================================================
    // 1. THE DEV GATE — the plain URL shows no dev button; '#dev' still does
    // =======================================================================================
    if (want('dev')) {
      console.log('--- dev buttons answer to the URL');
      {
        const b = await E.boot('');
        await b.page.waitForSelector('#tsNewMine', { timeout: 20000 }).catch(() => {});
        const onTitle = await visibleDev(b.page);
        ok("'/': the title shows no element starting 'Dev'", onTitle.length === 0, onTitle.join(', ') || 'none');
        await b.page.click('#tsNewMine', { timeout: 8000 }).catch(() => {});
        await H.waitMine(b.page);
        const inMine = await visibleDev(b.page);
        const hook = await b.page.evaluate(() => !!(window.__game && window.__game.mine));
        ok("'/' -> New: the running descent shows none", inMine.length === 0, inMine.join(', ') || 'none');
        ok("...and window.__game.mine exists (installed by the run the plain URL started)", hook);
        const st = await openStore(b.page);
        const inStore = await visibleDev(b.page);
        ok("...and the store shows none (no quick-start, unlock all or +10,000)", st && inStore.length === 0, `store open ${st}; ${inStore.join(', ') || 'none'}`);
        await b.ctx.close();
      }
      {
        const b = await E.boot('#mine,4242');
        await H.waitMine(b.page);
        const inMine = await visibleDev(b.page);
        ok("'#mine,4242': no element starting 'Dev'", inMine.length === 0, inMine.join(', ') || 'none');
        ok('...and window.__game.mine exists', await b.page.evaluate(() => !!(window.__game && window.__game.mine)));
        const st = await openStore(b.page);
        const inStore = await visibleDev(b.page);
        ok('...and its store shows none', st && inStore.length === 0, inStore.join(', ') || 'none');
        await b.ctx.close();
      }
      {
        const b = await E.boot('#dev');
        await b.page.waitForFunction(() => !!(window.__game && window.__game.state && window.__game.state.active), { timeout: 40000 }).catch(() => {});
        await sleep(2500);
        const d = await visibleDev(b.page);
        ok("'#dev': at least one element starts 'Dev'", d.length >= 1, d.join(', '));
        ok('...and window.__game.mine exists', await b.page.evaluate(() => !!(window.__game && window.__game.mine)));
        const st = await openStore(b.page);
        const inStore = await visibleDev(b.page);
        ok("...and its store shows the dev column", st && inStore.some((t) => /ssDev/.test(t)), inStore.join(', '));
        await b.ctx.close();
      }
      {
        // THE TOKEN WORKS ON A MINE HASH TOO — the owner's route to the buttons on the Pages build.
        const b = await E.boot('#mine,4242,dev');
        await H.waitMine(b.page);
        const d = await visibleDev(b.page);
        ok("'#mine,4242,dev': the dev buttons are back", d.length >= 1, d.join(', '));
        await b.ctx.close();
        const q = await E.boot('#mine,4242', 390, 844, { file: '/index.html?dev=1' });
        await H.waitMine(q.page);
        const d2 = await visibleDev(q.page);
        ok("'?dev=1#mine,4242': and with the query flag", d2.length >= 1, d2.join(', '));
        await q.ctx.close();
      }
    }

    // =======================================================================================
    // 2. THE LEVEL CARD — a dev-off build goes straight to the map
    // =======================================================================================
    if (want('card')) {
      console.log('--- no level card before a descent, dev flag off');
      const b = await E.boot('', 390, 844, { file: '/index-nodev.html' });
      const devOff = await b.page.evaluate(() => window.__cfg && window.__cfg.dev.enabled === false);
      ok('the patched build reads dev.enabled false', devOff);
      await b.page.waitForSelector('#tsNewMine', { timeout: 20000 }).catch(() => {});
      await b.page.click('#tsNewMine', { timeout: 8000 }).catch(() => {});
      const seen = await b.page.evaluate(async () => {
        let card = false, t0 = performance.now(), shown = null, ticks0 = null;
        while (performance.now() - t0 < 9000) {
          const li = document.getElementById('levelIntro');
          if (li && li.getBoundingClientRect().height > 0 && getComputedStyle(li).display !== 'none') card = true;
          const g = window.__game;
          const cv = document.getElementById('game');
          if (shown == null && g && g.state && g.state.substrate && g.state.substrate.mine && !document.body.classList.contains('handoff')
              && cv && getComputedStyle(cv).opacity === '1') shown = performance.now() - t0;
          await new Promise((r) => setTimeout(r, 50));
        }
        const g = window.__game;
        return { card, shown, depth0: g && g.mine ? g.mine.depth() : null, solid: !!(g && g.state.substrate._rockSolidified) };
      });
      ok('#levelIntro is never visible', !seen.card);
      ok('...the map is revealed', seen.shown != null, seen.shown == null ? 'never' : Math.round(seen.shown) + ' ms after New');
      // The sim is running: a dig lands (a paused sim would still accept one, so also check a tick).
      const dig = await b.page.evaluate(async () => {
        const g = window.__game, s = g.state, root = s.active.nodes[0];
        const w0 = s.active.water;
        const r = g.mine.growFrom(root.x, root.y, root.x, root.y + 300);
        return { ok: r.ok, msg: r.message, dw: w0 - s.active.water, paused: g.simPaused() };
      });
      ok('...and the descent plays: a dig lands and the world clock runs', dig.ok && dig.paused === false, JSON.stringify(dig));
      const d = await visibleDev(b.page);
      ok('...with no dev button on the dev-off build', d.length === 0, d.join(', ') || 'none');
      await b.ctx.close();
    }

    // =======================================================================================
    // 3. playSeed STARTS ONCE
    // =======================================================================================
    if (want('seed')) {
      console.log('--- playSeed builds one world');
      const b = await E.bootMine(4242);
      const lines = [];
      b.page.on('console', (m) => { if (/\[mycelium\].*map:/.test(m.text())) lines.push(m.text()); });
      const r = await b.page.evaluate(async () => {
        window.__rs = []; window.__telemetry.tap((row) => { if (row.kind === 'run_start') window.__rs.push(row); });
        window.__game.mine.playSeed(909);
        await new Promise((res) => setTimeout(res, 3000));
        return { n: window.__rs.length, seed: window.__game.mine.seed() };
      });
      ok('playSeed logs exactly one run_start', r.n === 1, `${r.n} run_start row(s)`);
      ok('...builds the world once', lines.length === 1, `${lines.length} map line(s)`);
      ok('...on the pinned seed', r.seed === 909, String(r.seed));
      await b.ctx.close();
    }

    // =======================================================================================
    // 4. THE RETAG — every seam's material is its band's
    // =======================================================================================
    if (want('retag')) {
      console.log('--- every seam carries its own band\'s material');
      for (const seed of [4242, 909, 31337]) {
        const b = await E.bootMine(seed);
        const r = await b.page.evaluate(async () => {
          const g = window.__game, s = g.state, cam = g.camera;
          // Walk the camera east until 5 chunks exist (the streamer builds what the camera sees).
          const cw = s.config.mine.chunkCols * s.substrate.cellSize, x0 = s.active.nodes[0].x;
          for (let i = 0; i < 80 && g.mine.chunks().length < 5; i++) {
            const k = Math.floor(i / 8) + 1;
            cam.zoom = 0.4; cam.x = x0 + (i % 2 ? -1 : 1) * k * cw; await new Promise((res) => setTimeout(res, 60));
          }
          const sub = s.substrate, cs = sub.cellSize, cols = sub.cols;
          const mats = g.mine.matTable();
          let checked = 0, wrong = [];
          for (const p of sub.foodPiles) {
            if (!p.mineMat) continue;
            let sr = 0; for (const idx of p.cells) sr += Math.floor(idx / cols);
            const row = sr / p.cells.length;                 // centroid row (0 = the surface row)
            const band = g.mine.band(Math.floor(row));
            const m = mats.find((x) => x.band === band);
            checked++;
            if (!m || m.id !== p.mineMat) wrong.push(`${p.mineMat}@row${row.toFixed(1)}(band ${band})`);
          }
          // Seams the generator ASKED for vs piles that exist: a gap is a stampFood refusal, the case
          // that used to retag the previous pile.
          let asked = 0; for (const ci of g.mine.chunks()) asked += (s.mineChunks[ci] && s.mineChunks[ci].ore) | 0;
          return { chunks: g.mine.chunks().length, checked, wrong, asked };
        });
        ok(`seed ${seed}: ${r.chunks} chunks, every pile.mineMat is its centroid's band material`,
           r.chunks >= 5 && r.checked >= 10 && r.wrong.length === 0, `${r.checked} seams checked (${r.asked} asked for; ${r.asked - r.checked} refused by stampFood), wrong: ${r.wrong.slice(0, 4).join(', ') || 'none'}`);
        await b.ctx.close();
      }
    }

    // =======================================================================================
    // 5. THE COLLISION GATE — no dig before the rock mask, and none inside it after
    // =======================================================================================
    if (want('gate')) {
      console.log('--- no dig lands before the rock is solid');
      const BAND = /\/assets\/(magnetite|anthracite|garnet|hematite)-c24\//;
      const delay = (ms) => async (page) => {
        await page.route((u) => BAND.test(u.pathname), async (route) => { await sleep(ms); route.continue().catch(() => {}); });
      };
      const b = await E.boot('#mine,4242', 390, 844, { before: delay(3000) });
      await b.page.waitForFunction(() => !!(window.__game && window.__game.mine && window.__game.state && window.__game.state.substrate
        && window.__game.state.substrate.mine && window.__game.mine.seed() === 4242), { timeout: 40000 });
      const early = await b.page.evaluate(async () => {
        const g = window.__game, s = g.state, sub = s.substrate;
        const out = { tries: 0, refused: 0, dw: 0, dn: 0, msgs: new Set(), curtainWhileSoft: true, samples: 0 };
        while (!sub._rockSolidified && out.tries < 40) {
          const root = s.active.nodes[0], w0 = s.active.water, n0 = s.active.nodes.length;
          const r = g.mine.growFrom(root.x, root.y, root.x, root.y + 300);
          out.tries++; if (!r.ok) out.refused++;
          out.msgs.add(r.message);
          out.dw += w0 - s.active.water; out.dn += s.active.nodes.length - n0;
          if (!sub._rockSolidified) { out.samples++; if (!document.body.classList.contains('handoff') || !g.simPaused()) out.curtainWhileSoft = false; }
          await new Promise((res) => setTimeout(res, 100));
        }
        out.msgs = [...out.msgs];
        out.solidAt = performance.now();
        return out;
      });
      ok('digs before _rockSolidified are all refused', early.tries >= 5 && early.refused === early.tries,
         `${early.refused} of ${early.tries} refused: ${early.msgs.join(' / ')}`);
      ok("...as 'The ground is settling…'", early.msgs.length === 1 && /ground is settling/.test(early.msgs[0]), early.msgs.join(' / '));
      ok('...and water and nodes are unchanged', early.dw === 0 && early.dn === 0, `water -${early.dw}, nodes +${early.dn}`);
      ok('...while the curtain stays up over the unsolid map, the sim paused', early.curtainWhileSoft && early.samples > 0, `${early.samples} samples`);
      await sleep(1200);
      const later = await b.page.evaluate(async (Q) => {
        new Function('return (' + Q + ')')()();
        const g = window.__game, s = g.state;
        s.active.water = 100000;
        return { curtain: document.body.classList.contains('handoff'), paused: g.simPaused() };
      }, QUIET.toString());
      ok('...and it lifts once the mask exists, the world running', !later.curtain && !later.paused, JSON.stringify(later));
      await H.injectNav(b.page);
      const inside = await b.page.evaluate(async () => {
        const g = window.__game, s = g.state, sub = s.substrate;
        s.active.water = 100000;
        const nav = await window.__navDig({ targetM: 60, maxIters: 400 });
        // a fan of aimed digs from every 7th strand, the way a player pokes at walls
        let fan = 0;
        const live0 = s.active.nodes.filter((n) => !n.infected);
        for (let i = 0; i < live0.length; i += 7) {
          const n = live0[i];
          for (const [dx, dy] of [[1, 0.2], [-1, 0.2], [0, 1]]) {
            const r = g.mine.growFrom(n.x, n.y, n.x + dx * 300, n.y + dy * 300); if (r.ok) fan++;
          }
          if (fan > 60) break;
        }
        await new Promise((res) => setTimeout(res, 800));
        const fs = sub._fineSolid, F = sub._fineSize, W = sub._fineCols, Hh = sub._fineRows;
        let live = 0, hits = [];
        for (const n of s.active.nodes) {
          if (n.infected) continue;
          const fc = Math.floor(n.x / F), fr = Math.floor((n.y - sub.surfaceY) / F);
          if (fr < 0 || fc < 0 || fc >= W || fr >= Hh) continue;
          live++;
          if (fs[fr * W + fc] === 1) hits.push(`${Math.round(n.x)},${Math.round(n.y)}`);
        }
        return { depth: nav.depth, digs: nav.digs, fan, live, hits };
      });
      ok('afterwards, 0 living nodes lie inside _fineSolid (node centres)', inside.live > 100 && inside.hits.length === 0,
         `${inside.hits.length} of ${inside.live} inside, after a dive to ${inside.depth} m (${inside.digs} digs) and ${inside.fan} fan digs` +
         (inside.hits.length ? ': ' + inside.hits.slice(0, 4).join(' ') : ''));
      await b.ctx.close();

      // THE CAP: with the band art held back 20 s, the map is shown at ~15 s and still refuses digs.
      const c = await E.boot('#mine,4242', 390, 844, { before: delay(20000) });
      await c.page.waitForFunction(() => !!(window.__game && window.__game.mine && window.__game.state && window.__game.state.substrate
        && window.__game.state.substrate.mine && window.__game.mine.seed() === 4242), { timeout: 40000 });
      const cap = await c.page.evaluate(async () => {
        const t0 = performance.now(), sub = window.__game.state.substrate;
        while (document.body.classList.contains('handoff') && performance.now() - t0 < 25000) await new Promise((r) => setTimeout(r, 100));
        const at = performance.now() - t0;
        const g = window.__game, s = g.state, root = s.active.nodes[0], w0 = s.active.water;
        const r = g.mine.growFrom(root.x, root.y, root.x, root.y + 300);
        return { at, solid: !!sub._rockSolidified, ok: r.ok, msg: r.message, dw: w0 - s.active.water };
      });
      ok('the reveal gives up waiting at the 15 s cap', cap.at >= 12000 && cap.at <= 16500 && !cap.solid,
         `curtain lifted ${(cap.at / 1000).toFixed(1)} s after the run was built, mask ${cap.solid ? 'present' : 'absent'}`);
      ok('...and a dig there is still refused, free', !cap.ok && /settling/.test(cap.msg) && cap.dw === 0, `${cap.msg}, water -${cap.dw}`);
      await c.ctx.close();
    }

    // =======================================================================================
    // 6. THE HEAT BYPASS — a walled press grows from beside the press, at the press's price
    // =======================================================================================
    if (want('heat')) {
      console.log('--- a walled strand cannot buy deep growth at the surface price');
      let presses = 0, okDigs = 0, badOrigin = [], badCharge = [], farNodes = [], oldFar = 0, twigsPast = 0, reachU = 0;
      for (const seed of [4242, 909, 5]) {
        const b = await E.bootMine(seed);
        const r = await b.page.evaluate(async (Q) => {
          new Function('return (' + Q + ')')()();
          const g = window.__game, s = g.state, sub = s.substrate, net = s.active;
          net.water = 100000;
          const dive = await window.__navDig({ targetM: 130, maxIters: 900 });
          await new Promise((res) => setTimeout(res, 800));
          const seg = s.config.growth.segmentLength;
          const reach = g.mine.steps() * 3 * seg;
          const twig = ((s.config.growth.sideStrandMax | 0) + 1) * seg;
          const DODGE = [0, 0.26, -0.26, 0.52, -0.52, 0.8, -0.8, 1.08, -1.08, 1.4, -1.4];
          const down = Math.PI / 2;
          const canStep = (n) => DODGE.some((o) => net._segmentClear(sub, n.x, n.y, n.x + Math.cos(down + o) * seg, n.y + Math.sin(down + o) * seg));
          const depthOf = (y) => Math.max(0, Math.floor((y - sub.surfaceY) / sub.cellSize));
          // A PLAYER'S SHALLOW FOOTPRINT: side digs off the shaft's upper strands, the way one pokes at
          // walls for seams. The navigator alone cuts a clean corridor with NO walled strand in it
          // (0 of 164 at <= 36 m, measured); these side fans end against rock, which is the case the
          // fall-through bit on.
          // Rounds of fans until there is something walled to press (or the colony nears the cap).
          for (let round = 0; round < 4; round++) {
            const walledNow = net.nodes.filter((n) => !n.infected && depthOf(n.y) <= 36 && !canStep(n)).length;
            if (walledNow >= 4 || net.nodes.length > 7000) break;
            const sh = net.nodes.filter((n) => !n.infected && depthOf(n.y) <= 36);
            for (let i = round; i < sh.length && net.nodes.length < 7500; i += 4) {
              const n = sh[i];
              for (const [dx, dy] of [[1, 0], [-1, 0], [1, -0.6], [-1, -0.6]]) g.mine.growFrom(n.x, n.y, n.x + dx * 300, n.y + dy * 300);
            }
            await new Promise((res) => setTimeout(res, 100));
          }
          net.water = 100000;
          const out = { dive: dive.depth, reach, twig, presses: [], nodes: net.nodes.length };
          const used = new Map();
          for (let k = 0; k < 10; k++) {
            const cands = net.nodes.filter((n) => !n.infected && depthOf(n.y) <= 36 && !canStep(n));
            if (!cands.length) break;
            cands.sort((a, b) => (used.get(a.id) | 0) - (used.get(b.id) | 0) || a.id - b.id);
            const n = cands[0]; used.set(n.id, (used.get(n.id) | 0) + 1);
            // What the OLD rule would have grown from: the first tip, by projection on the aim, that can step.
            const tips = net.tips().filter((t) => !t.infected).sort((a, b) => b.y - a.y);
            const old = tips.find((t) => canStep(t));
            const oldDist = old ? Math.hypot(old.x - n.x, old.y - n.y) : 0;
            const w0 = net.water, before = net.nextNodeId;
            const res = g.mine.growFrom(n.x, n.y, n.x, n.y + 400);
            const made = net.nodes.filter((q) => q.id >= before);
            const dOf = (q) => Math.hypot(q.x - n.x, q.y - n.y);
            const far = made.length ? Math.max(...made.map(dOf)) : 0;
            const main = made.filter((q) => !q.side);
            const farMain = main.length ? Math.max(...main.map(dOf)) : 0;
            const farKinds = made.filter((q) => dOf(q) > 90 + reach).map((q) => (q.side ? 'side' : 'main'));
            out.presses.push({ at: depthOf(n.y), ok: res.ok, msg: res.message, charged: w0 - net.water,
              price: g.mine.cost(depthOf(n.y)),
              originDist: res.origin ? Math.hypot(res.origin.x - n.x, res.origin.y - n.y) : null,
              far, farMain, farKinds, made: made.length, oldDist, oldAt: old ? depthOf(old.y) : null });
          }
          return out;
        }, QUIET.toString());
        const okN = r.presses.filter((p) => p.ok).length;
        console.log(`    seed ${seed}: dove to ${r.dive} m, ${r.nodes} strands; ${r.presses.length} presses at ${[...new Set(r.presses.map((p) => p.at))].join('/')} m, ${okN} dug`
          + `; the old rule would have grown from ${r.presses.map((p) => Math.round(p.oldDist) + 'u@' + p.oldAt + 'm').slice(0, 4).join(', ')}`);
        reachU = r.reach;
        for (const p of r.presses) {
          presses++;
          if (p.oldDist > 90) oldFar++;
          if (!p.ok) { if (p.charged !== 0) badCharge.push(`refused but charged ${p.charged}`); continue; }
          okDigs++;
          if (!(p.originDist != null && p.originDist <= 90)) badOrigin.push(`${p.originDist == null ? '?' : p.originDist.toFixed(0)}u`);
          if (p.charged !== p.price) badCharge.push(`charged ${p.charged} vs price ${p.price} at ${p.at} m`);
          // THE PLAN'S BOUND IS FOR THE GROWN CHAIN. `growDirected` also sprouts decorative side twigs
          // (`_sproutSideStrand`, `.side`) off any chain node, up to sideStrandMax + a 1-segment fork
          // long, so a twig off the chain's last node can sit past one reach (measured 283-288 u
          // against 243, every one `.side`). The chain is held to 90 + reach exactly; twigs to that
          // plus their own longest length.
          if (p.farMain > 90 + r.reach) farNodes.push(`chain ${p.farMain.toFixed(0)}u > ${(90 + r.reach).toFixed(0)}`);
          if (p.far > 90 + r.reach + r.twig) farNodes.push(`twig ${p.far.toFixed(0)}u > ${(90 + r.reach + r.twig).toFixed(0)}`);
          if (p.far > 90 + r.reach) twigsPast++;
        }
        await b.ctx.close();
      }
      ok('30 presses of walled strands at 36 m or shallower, aimed down', presses >= 30,
         `${presses} presses, ${okDigs} dug, ${presses - okDigs} refused`);
      ok('...and the probe bites: the old fall-through would have grown >90 units away on most', presses > 0 && oldFar >= presses * 0.5,
         `${oldFar} of ${presses}`);
      ok("every dig's origin is within 90 units of the pressed strand", okDigs > 0 && badOrigin.length === 0,
         `${okDigs} digs; ${badOrigin.slice(0, 5).join(', ') || 'none outside'}`);
      ok('...the charge equals mineGrowCost at the pressed strand (refusals charge 0)', presses > 0 && badCharge.length === 0,
         badCharge.slice(0, 5).join('; ') || 'all exact');
      ok('...and no grown node lies farther than 90 units plus one reach from it (side twigs: plus their length)', okDigs > 0 && farNodes.length === 0,
         (farNodes.slice(0, 5).join('; ') || 'none') + `; reach ${Math.round(reachU)} u, ${twigsPast} dig(s) with a twig past 90 + reach`);
    }

    // =======================================================================================
    // 7. THE AIM PRICE — at the arrow head, the pressed strand's price
    // =======================================================================================
    if (want('aim')) {
      console.log('--- the arrow head quotes the dig');
      const b = await E.bootMine(4242);
      const pr = async (label) => {
        // press the deepest clean strand and drag down-right 90 px, then read what was drawn
        const pt = await b.page.evaluate(() => {
          const g = window.__game, s = g.state, cam = g.camera;
          let t = null; for (const n of s.active.nodes) if (!n.infected && (!t || n.y > t.y)) t = n;
          const sc = cam.worldToScreen(t.x, t.y), r = document.getElementById('game').getBoundingClientRect();
          return { x: r.left + sc.x, y: r.top + sc.y, m: Math.max(0, Math.floor((t.y - s.substrate.surfaceY) / s.substrate.cellSize)),
                   price: g.mine.cost(Math.max(0, Math.floor((t.y - s.substrate.surfaceY) / s.substrate.cellSize))) };
        });
        await b.page.mouse.move(pt.x, pt.y); await b.page.mouse.down();
        for (let i = 1; i <= 6; i++) { await b.page.mouse.move(pt.x + i * 10, pt.y + i * 15); await sleep(30); }
        await sleep(250);
        const shown = await b.page.evaluate(() => window.__game.mine.aimPrice());
        await b.page.screenshot({ path: path.join(ART, `ship-aim-${label}.png`) });
        // cancel: pull back to the press point before releasing
        await b.page.mouse.move(pt.x, pt.y); await sleep(60); await b.page.mouse.up();
        return { pt, shown };
      };
      const a = await pr('surface');
      ok('at the surface the arrow head reads the pressed strand\'s price', a.shown && a.shown.cost === a.pt.price,
         `${a.shown ? a.shown.cost : 'nothing drawn'} vs ${a.pt.price} at ${a.pt.m} m`);
      await b.page.evaluate(async (Q) => { new Function('return (' + Q + ')')()(); window.__game.state.active.water = 100000;
        await window.__navDig({ targetM: 50, maxIters: 400 }); window.__game.state.active.water = 60; }, QUIET.toString());
      await sleep(1500);
      const d = await pr('deep');
      ok('...and past the heat line it reads the hotter price, orange', d.shown && d.shown.cost === d.pt.price && d.pt.price > a.pt.price && d.shown.hot,
         `${d.shown ? d.shown.cost + (d.shown.hot ? ' (hot)' : '') : 'nothing drawn'} vs ${d.pt.price} at ${d.pt.m} m`);
      ok('...drawn inside the 390x844 view', d.shown && d.shown.x > 0 && d.shown.x < 390 && d.shown.y > 0 && d.shown.y < 844,
         d.shown ? `${Math.round(d.shown.x)},${Math.round(d.shown.y)}` : '');
      await b.ctx.close();
    }
  } catch (e) {
    fail++; console.log('  HARNESS ERROR — ' + (e && e.stack || e));
  }
  await E.close();
  console.log(`\n==== ${pass} passed, ${fail} failed ====`);
  process.exit(fail ? 1 : 0);
})();
