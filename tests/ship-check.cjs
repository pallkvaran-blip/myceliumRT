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
 *   - `__game.mine.playSeed` built the world twice (it logged ONE run_start either way, so the
 *     run_start count cannot tell the builds apart — the '[mycelium] ... map:' line count does).
 *     The '#mine,<n>' boot did the same and is fixed the same way.
 *   - A seam `stampFood` refused retagged the PREVIOUS pile's material (exercised by a forced refusal).
 *   - A bare ']' on the plain URL swapped a live descent for authored map 0, unbanked.
 *   - A band sprite that never decodes left every dig refused for the run.
 *   - (verifier fixes) Art that was only SLOW was boxed for good; chunks streamed after a forced
 *     mask waited 20 s per missing sprite, their drawn rock uncollided meanwhile.
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
        const b = await E.boot('', 390, 844, { returning: true });
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
    // 1a. THE MAP-STEPPING KEYS — a stray ']' on the plain URL cannot throw the descent away
    // =======================================================================================
    if (want('key')) {
      console.log("--- '[' / ']' step maps only when the URL asks for dev tools");
      const press = async (hash) => {
        const b = await E.boot(hash);
        await H.waitMine(b.page);
        await sleep(600);
        const r = await b.page.evaluate(async () => {
          const g = window.__game, s = g.state, root = s.active.nodes[0];
          const d = g.mine.growFrom(root.x, root.y, root.x, root.y + 300);
          await new Promise((res) => setTimeout(res, 400));
          return { dug: !!d.ok, nodes: s.active.nodes.length, seed: g.mine.seed() };
        });
        await b.page.keyboard.press(']');
        await sleep(2500);
        await b.page.keyboard.press('[');
        await sleep(2500);
        const after = await b.page.evaluate(() => {
          const s = window.__game.state;
          return { mine: !!(s.substrate && s.substrate.mine), nodes: s.active.nodes.length, seed: window.__game.mine.seed(),
                   runOver: !!s.runOver };
        });
        await b.ctx.close();
        return { r, after };
      };
      const plain = await press('#mine,4242');
      ok("'#mine,4242': ']' then '[' leave the descent running (substrate.mine true, same seed, strands kept)",
         plain.r.dug && plain.after.mine && plain.after.seed === plain.r.seed && plain.after.nodes >= plain.r.nodes && !plain.after.runOver,
         JSON.stringify({ before: plain.r, after: plain.after }));
      // THE CONTROL: the same keys on the owner's route still step maps, so the check above is about the
      // gate and not about the keypress failing to arrive.
      const dev = await press('#mine,4242,dev');
      ok("'#mine,4242,dev': the same keys still step to an authored map (the owner's route)", dev.r.dug && !dev.after.mine,
         JSON.stringify({ before: dev.r, after: dev.after }));
    }

    // =======================================================================================
    // 1b. THE RELEASE ZIP KEEPS THE MINE'S BANDS (static: the prune, without building)
    // =======================================================================================
    if (want('zipdry')) {
      console.log('--- the release prune keeps every mine band');
      const out = require('child_process').execFileSync(process.execPath,
        [path.join(H.ROOT, 'scripts', 'make-web-zip.mjs'), '--dry-run'], { encoding: 'utf8' });
      const listed = out.split('dry run')[1] ? out.split('dry run')[1].split('\n').map((l) => l.trim()).filter((l) => /^[a-z0-9-]+$/.test(l)) : [];
      const need = ['magnetite-c24', 'anthracite-c24', 'garnet-c24', 'hematite-c24'];
      const miss = need.filter((f) => !listed.includes(f));
      ok('`make-web-zip --dry-run` lists all four band folders', miss.length === 0 && listed.length > 4,
         `${listed.length} folders listed; missing: ${miss.join(', ') || 'none'}`);
    }

    // =======================================================================================
    // 2. THE LEVEL CARD — a dev-off build goes straight to the map
    // =======================================================================================
    if (want('card')) {
      console.log('--- no level card before a descent, dev flag off');
      const b = await E.boot('', 390, 844, { file: '/index-nodev.html', returning: true });
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
      // THE '#mine,<n>' BOOT HAD THE SAME BUG: beginMineRun() on a clock seed, then startRun() on the
      // pinned one. Every mine check boots this way. (Fixing it moved no pinned number: chunk records,
      // piles, pockets, fine mask, colony and worms fingerprint identically on 4 seeds x 7 chunks.)
      const hl = [];
      const h = await E.boot('#mine,4242', 390, 844, { before: async (page) => page.on('console', (m) => { if (/\[mycelium\].*map:/.test(m.text())) hl.push(m.text()); }) });
      await H.waitMine(h.page);
      const hs = await h.page.evaluate(() => window.__game.mine.seed());
      ok("the '#mine,4242' boot builds the world once, on the pinned seed", hl.length === 1 && hs === 4242, `${hl.length} map line(s), seed ${hs}`);
      await h.ctx.close();
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
      // THE REFUSAL ITSELF, FORCED. On the seeds above `stampFood` refuses no seam at all (0 of 984
      // across 15 seeds, the M2 verifier's count), so they pass on the pre-M2 code too. Here every cell of the next
      // chunk is pre-flagged `hazard` BEFORE it is generated, so every seam it places is refused; the
      // last pile before it carries a sentinel material the old code would have overwritten.
      {
        const b = await E.bootMine(4242);
        const r = await b.page.evaluate(async () => {
          const g = window.__game, s = g.state, sub = s.substrate, cam = g.camera, cs = sub.cellSize;
          const W = s.config.mine.chunkCols;
          const ci = Math.max(...g.mine.chunks()) + 1;
          const n0 = sub.foodPiles.length;
          const last = sub.foodPiles[n0 - 1], real = last.mineMat;
          last.mineMat = 'sentinel';
          const mats0 = sub.foodPiles.map((p) => p.mineMat || null);
          for (let row = 0; row < sub.rows; row++) for (let c = ci * W; c < ci * W + W; c++) {
            const cell = sub.cellAt(c, row); if (cell) cell.hazard = true;
          }
          cam.zoom = 0.6; cam.x = (ci * W + W / 2) * cs;
          for (let i = 0; i < 60 && !(s.mineChunks && s.mineChunks[ci]); i++) await new Promise((res) => setTimeout(res, 60));
          const rec = s.mineChunks[ci];
          const inCi = sub.foodPiles.filter((p) => p.cells.some((idx) => { const c = idx % sub.cols; return c >= ci * W && c < ci * W + W; })).length;
          const changed = mats0.filter((m, i) => sub.foodPiles[i].mineMat !== m).length;
          const out = { ci, made: !!rec, asked: rec ? rec.ore : 0, inCi, changed, lastNow: last.mineMat, real };
          last.mineMat = real;
          return out;
        });
        ok('a chunk whose every seam stampFood refuses retags no earlier pile', r.made && r.asked > 0 && r.inCi === 0 && r.changed === 0 && r.lastNow === 'sentinel',
           `chunk ${r.ci}: ${r.asked} seams asked for, ${r.inCi} registered; ${r.changed} earlier pile(s) changed material; the last one reads '${r.lastNow}' (sentinel ${r.lastNow === 'sentinel' ? 'kept' : 'overwritten'})`);
        await b.ctx.close();
      }
    }

    // =======================================================================================
    // 5. THE COLLISION GATE — no dig before the rock mask, and none inside it after
    // =======================================================================================
    if (want('gate')) {
      console.log('--- no dig lands before the rock is solid');
      const BAND = /\/assets\/(magnetite|anthracite|garnet|hematite)-c24\//;
      // M4 PRELOADS THE BAND ART BEHIND THE GATE, so a delayed band held the % counter instead and
      // every run began on a solid mask (0 samples). The knob skips that preload: this block is about
      // a descent that starts before its art (the loader's 12 s safety net on a slow link).
      const delay = (ms) => async (page) => {
        await page.addInitScript(() => { window.MYCELIUM_NO_BAND_PRELOAD = true; });
        await page.route((u) => BAND.test(u.pathname), async (route) => { await sleep(ms); route.continue().catch(() => {}); });
      };
      const b = await E.boot('#mine,4242', 390, 844, { before: delay(3000) });
      await b.page.waitForFunction(() => !!(window.__game && window.__game.mine && window.__game.state && window.__game.state.substrate
        && window.__game.state.substrate.mine && window.__game.mine.seed() === 4242), { timeout: 40000 });
      // REAL DRAGS DURING THE HOLD, as a player pokes at a black screen (M2 verifier): each is refused
      // and used to queue a 'The ground is settling…' toast under the curtain, still showing after
      // the reveal. Run alongside the probe below until the mask lands.
      let dragging = true, drags = 0;
      const dragLoop = (async () => {
        while (dragging) {
          try {
            const pt = await b.page.evaluate(() => {   // from the root strand, where a press arms the aim
              const g = window.__game, n = g.state.active.nodes[0], sc = g.camera.worldToScreen(n.x, n.y);
              const r = document.getElementById('game').getBoundingClientRect(); return { x: r.left + sc.x, y: r.top + sc.y };
            });
            await b.page.mouse.move(pt.x, pt.y); await b.page.mouse.down();
            for (let i = 1; i <= 5; i++) { await b.page.mouse.move(pt.x, pt.y + i * 20); await sleep(20); }
            await b.page.mouse.up(); drags++;
          } catch (_) {}
          await sleep(250);
        }
      })();
      const early = await b.page.evaluate(async () => {
        const g = window.__game, s = g.state, sub = s.substrate;
        const out = { tries: 0, refused: 0, dw: 0, dn: 0, msgs: new Set(), curtainWhileSoft: true, samples: 0, noteOn: 0, noteText: null };
        while (!sub._rockSolidified && out.tries < 40) {
          const root = s.active.nodes[0], w0 = s.active.water, n0 = s.active.nodes.length;
          const r = g.mine.growFrom(root.x, root.y, root.x, root.y + 300);
          out.tries++; if (!r.ok) out.refused++;
          out.msgs.add(r.message);
          out.dw += w0 - s.active.water; out.dn += s.active.nodes.length - n0;
          if (!sub._rockSolidified) { out.samples++; if (!document.body.classList.contains('handoff') || !g.simPaused()) out.curtainWhileSoft = false; }
          if (!sub._rockSolidified) { const n = g.settleNote(); if (n.on) { out.noteOn++; out.noteText = n.text; } }
          await new Promise((res) => setTimeout(res, 100));
        }
        out.msgs = [...out.msgs];
        out.solidAt = performance.now();
        // The reveal follows within a frame or two: read the toast THERE (a stale one lasts 2.6 s).
        for (let i = 0; i < 120 && document.body.classList.contains('handoff'); i++) await new Promise((r) => requestAnimationFrame(() => r()));
        const t = document.querySelector('.toast'), tm = t && t.querySelector('.tmsg');
        out.revealToast = t && !t.classList.contains('hidden') && t.classList.contains('in') ? (tm ? tm.textContent : '?') : null;
        out.revealed = !document.body.classList.contains('handoff');
        // The reference mask for the slow-art case below: this boot's art arrived at 3 s, un-forced.
        let on = 0; const f = sub._fineSolid; if (f) for (let i = 0; i < f.length; i++) on += f[i];
        out.fineOn = on; out.sprites = (sub.levelSprites || []).length; out.forced = sub._solidForced | 0;
        return out;
      });
      ok('digs before _rockSolidified are all refused', early.tries >= 5 && early.refused === early.tries,
         `${early.refused} of ${early.tries} refused: ${early.msgs.join(' / ')}`);
      ok("...as 'The ground is settling…'", early.msgs.length === 1 && /ground is settling/.test(early.msgs[0]), early.msgs.join(' / '));
      ok('...and water and nodes are unchanged', early.dw === 0 && early.dn === 0, `water -${early.dw}, nodes +${early.dn}`);
      ok('...while the curtain stays up over the unsolid map, the sim paused', early.curtainWhileSoft && early.samples > 0, `${early.samples} samples`);
      // THE HOLD SAYS WHAT IT IS WAITING FOR (M2 fix): a black curtain for seconds reads as a hang.
      ok("...and the held curtain shows 'The ground is settling…' (after its 600 ms grace)", early.noteOn >= 5 && /ground is settling/.test(early.noteText || ''),
         `${early.noteOn} of ${early.samples} samples showed it: ${early.noteText}`);
      dragging = false; await dragLoop;
      await sleep(1200);
      const later = await b.page.evaluate(async (Q) => {
        new Function('return (' + Q + ')')()();
        const g = window.__game, s = g.state;
        s.active.water = 100000;
        const t = document.querySelector('.toast'), tm = t && t.querySelector('.tmsg');
        const toast = t && !t.classList.contains('hidden') && t.classList.contains('in') ? (tm ? tm.textContent : '?') : null;
        return { curtain: document.body.classList.contains('handoff'), paused: g.simPaused(), note: g.settleNote().on, toast };
      }, QUIET.toString());
      ok('...and it lifts once the mask exists, the world running, the line gone', !later.curtain && !later.paused && !later.note, JSON.stringify(later));
      ok('...with no stale settling toast from the drags made under the curtain', drags >= 3 && early.revealed && !/settling/.test(early.revealToast || '') && !/settling/.test(later.toast || ''),
         `${drags} real drags during the hold; toast at the reveal: ${early.revealToast || 'none'}, 1.2 s later: ${later.toast || 'none'}`);
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

      // THE CAP: with the band art held back 24 s, the map is shown at ~15 s and still refuses digs.
      // SLOW IS NOT MISSING (M2 verifier fix): the art lands after solidForceMs (20 s) but never
      // failed, so the mask must wait for it — not stamp 2027 sprites as permanent solid boxes, which
      // is what forcing on elapsed time alone did (on a ~1.6 Mbps link: 925 boxes, +19% solid cells).
      const c = await E.boot('#mine,4242', 390, 844, { before: delay(24000) });
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
      const slow = await c.page.evaluate(async () => {
        const t0 = performance.now(), sub = window.__game.state.substrate;
        while (!sub._rockSolidified && performance.now() - t0 < 30000) await new Promise((r) => setTimeout(r, 100));
        let on = 0; const f = sub._fineSolid; if (f) for (let i = 0; i < f.length; i++) on += f[i];
        return { solid: !!sub._rockSolidified, at: performance.now(), forced: sub._solidForced | 0, fineOn: on, sprites: (sub.levelSprites || []).length };
      });
      ok('art that is only SLOW (lands at 24 s, past solidForceMs) is waited for: 0 sprites boxed', slow.solid && slow.forced === 0,
         `mask ${slow.solid ? 'published' : 'never'}, ${slow.forced} box(es)`);
      ok('...and the mask is the unthrottled one, cell for cell count', early.forced === 0 && slow.fineOn === early.fineOn && slow.sprites === early.sprites,
         `${slow.fineOn} solid fine cells over ${slow.sprites} sprites; reference (art at 3 s) ${early.fineOn} over ${early.sprites}`);
      await c.ctx.close();

      // A SPRITE THAT NEVER DECODES (M2 fix). Every hematite file 404s for good: the mask used to wait
      // for ever, every dig refused for the run. After CONFIG.mine.solidForceMs the missing sprites
      // are stamped as SOLID BOXES and the mask is published — nothing turns passable, the run plays.
      // ...AND THE CHUNKS STREAMED AFTER IT ARE COLLIDED AT ONCE (M2 verifier fix): the incremental
      // pass used to stop at each missing sprite for a fresh 20 s, holding every later sprite (all
      // bands, art loaded) uncollided — ~48 min for a streamed chunk. Then the art comes back and
      // every box is swapped for its silhouette, leaving exactly the mask a full re-stamp builds.
      const HEM = /\/assets\/hematite-c24\//;
      let healed = false;
      const dd = await E.boot('#mine,4242', 390, 844, { before: async (page) => {
        await page.route((u) => HEM.test(u.pathname), (route) => (healed ? route.continue()
          : route.fulfill({ status: 404, body: 'nf' })).catch(() => {}));
      } });
      await dd.page.waitForFunction(() => !!(window.__game && window.__game.mine && window.__game.state && window.__game.state.substrate
        && window.__game.state.substrate.mine && window.__game.mine.seed() === 4242), { timeout: 40000 });
      const dead = await dd.page.evaluate(async () => {
        const t0 = performance.now(), sub = window.__game.state.substrate;
        let early = null;
        while (!sub._rockSolidified && performance.now() - t0 < 45000) {
          await new Promise((r) => setTimeout(r, 200));
          if (early == null && performance.now() - t0 > 16500) {
            const g = window.__game, root = g.state.active.nodes[0];
            early = g.mine.growFrom(root.x, root.y, root.x, root.y + 300).message;
          }
        }
        const at = performance.now() - t0;
        const g = window.__game, s = g.state, root = s.active.nodes[0], w0 = s.active.water;
        s.active.water = Math.max(s.active.water, 50);
        const r = g.mine.growFrom(root.x, root.y, root.x, root.y + 300);
        // Every hematite sprite's box is solid where its silhouette would be: sample its centre.
        const F = sub._fineSize, W = sub._fineCols;
        let hem = 0, solidC = 0;
        for (const sp of (sub.levelSprites || [])) {
          if (!/hematite/.test(sp.key)) continue;
          hem++;
          const fc = Math.floor(sp.x / F), fr = Math.floor((sp.y - sub.surfaceY) / F);
          const cell = sub.cellAtWorld(sp.x, sp.y);
          if ((sub._fineSolid && sub._fineSolid[fr * W + fc] === 1) || (cell && (cell.water || cell.maxNutrient > 0))) solidC++;
        }
        return { at, solid: !!sub._rockSolidified, forced: sub._solidForced | 0, early, ok: r.ok, msg: r.message, hem, solidC };
      });
      ok('a band that 404s for good: the mask is published anyway, after the force delay', dead.solid && dead.forced > 0 && dead.at >= 15000,
         `mask ${dead.solid ? 'published' : 'never'} at ${(dead.at / 1000).toFixed(1)} s, ${dead.forced} sprite(s) stamped as boxes; at 16.5 s a dig read '${dead.early}'`);
      ok('...the missing sprites are solid (box centres in the fine mask)', dead.hem > 0 && dead.solidC === dead.hem, `${dead.solidC} of ${dead.hem} hematite sprites`);
      ok('...and the run plays: a dig lands', dead.ok, dead.msg);
      const strm = await dd.page.evaluate(async () => {
        const frame = () => new Promise((res) => requestAnimationFrame(() => res()));
        const g = window.__game, s = g.state, sub = s.substrate, cam = g.camera;
        const cw = s.config.mine.chunkCols * sub.cellSize, x0 = s.active.nodes[0].x, n0 = sub.levelSprites.length;
        let behind = 0, gen = 0;
        for (let k = 1; k <= 3; k++) {
          cam.zoom = 0.4; cam.x = x0 + k * cw;
          const nA = sub.levelSprites.length;
          for (let f = 0; f < 180 && sub.levelSprites.length === nA; f++) await frame();
          if (sub.levelSprites.length > nA) gen++;
          let lag = 0;
          for (; lag < 30 && (sub._solidFrom | 0) < sub.levelSprites.length; lag++) await frame();
          behind = Math.max(behind, lag);
          await new Promise((res) => setTimeout(res, 250));
        }
        const F = sub._fineSize, W = sub._fineCols, fs = sub._fineSolid;
        let hem = 0, hemSolid = 0, through = 0;
        for (let i = n0; i < sub.levelSprites.length; i++) {
          const sp = sub.levelSprites[i];
          if (!sub.solidAtWorld(sp.x, sp.y) && s.active._segmentClear(sub, sp.x - 12, sp.y, sp.x + 12, sp.y)) through++;
          if (!/hematite/.test(sp.key)) continue;
          hem++;
          const fc = Math.floor(sp.x / F), fr = Math.floor((sp.y - sub.surfaceY) / F), cell = sub.cellAtWorld(sp.x, sp.y);
          if (fs[fr * W + fc] === 1 || (cell && (cell.water || cell.maxNutrient > 0))) hemSolid++;
        }
        return { gen, behind, streamed: sub.levelSprites.length - n0, from: sub._solidFrom | 0, of: sub.levelSprites.length,
          hem, hemSolid, through, forced: sub._solidForced | 0, dirty: sub._mineDirtyC0 != null };
      });
      ok('...chunks streamed after it are collided within 2 frames, missing art boxed at once', strm.gen === 3 && strm.behind <= 2 && strm.from === strm.of && !strm.dirty,
         `${strm.gen} chunks, ${strm.streamed} sprites; watermark ${strm.from} of ${strm.of}, at most ${strm.behind} frame(s) behind; ${strm.forced} box(es) standing`);
      ok('...their missing sprites are solid, and no 24 u segment passes through any streamed sprite centre', strm.hem > 0 && strm.hemSolid === strm.hem && strm.through === 0,
         `${strm.hemSolid} of ${strm.hem} streamed hematite centres solid; ${strm.through} of ${strm.streamed} centres let a segment through`);
      healed = true;
      const heal = await dd.page.evaluate(async () => {
        const g = window.__game, s = g.state, sub = s.substrate, t0 = performance.now();
        const box0 = sub._solidForced | 0;
        while ((sub._solidForced | 0) > 0 && performance.now() - t0 < 30000) await new Promise((r) => setTimeout(r, 250));
        const at = performance.now() - t0, left = sub._solidForced | 0;
        // A living node the swap put inside rock? (It only frees cells, so there must be none.)
        const F = sub._fineSize, W = sub._fineCols, fs = sub._fineSolid;
        let inRock = 0;
        for (const n of s.active.nodes) { if (n.infected) continue; const fc = Math.floor(n.x / F), fr = Math.floor((n.y - sub.surfaceY) / F); if (fr >= 0 && fs[fr * W + fc] === 1) inRock++; }
        // The reference: a full re-stamp of the same sprites, all art present.
        const after = sub._fineSolid.slice();
        sub._rockSolidified = false;
        for (let i = 0; i < 60 && !sub._rockSolidified; i++) await new Promise((r) => requestAnimationFrame(() => r()));
        let diff = 0; const ref = sub._fineSolid;
        for (let i = 0; i < ref.length; i++) if (ref[i] !== after[i]) diff++;
        return { box0, left, at, inRock, diff, rebuilt: !!sub._rockSolidified, unboxed: sub._solidUnboxed | 0 };
      });
      ok('...and when the art comes back every box is swapped for its silhouette', heal.box0 > 0 && heal.left === 0,
         `${heal.box0} boxes -> ${heal.left} in ${(heal.at / 1000).toFixed(1)} s`);
      ok('...leaving the mask a full re-stamp builds (0 cells differ), no living node inside rock', heal.rebuilt && heal.diff === 0 && heal.inRock === 0,
         `${heal.diff} fine cells differ from the full re-stamp; ${heal.inRock} living node(s) in rock`);
      await dd.ctx.close();
    }

    // =======================================================================================
    // 6. THE HEAT BYPASS — a walled press grows from beside the press, at the press's price
    // =======================================================================================
    if (want('heat')) {
      console.log('--- a walled strand cannot buy deep growth at the surface price');
      let presses = 0, okDigs = 0, badOrigin = [], badCharge = [], farNodes = [], oldFar = 0, reachU = 0, acceptProbe = null;
      const audit = { digs: 0, nodes: 0, over: [], side: 0, runner: 0, colonFar: 0, pockets: 0 };
      for (const seed of [4242, 909, 5]) {
        const b = await E.bootMine(seed);
        const r = await b.page.evaluate(async (Q) => {
          new Function('return (' + Q + ')')()();
          const g = window.__game, s = g.state, sub = s.substrate, net = s.active;
          net.water = 100000;
          // EVERY DIG OF THE BLOCK IS AUDITED, not only the presses: the dive, the fans and the presses
          // all go through `growFrom`, and each is held to the plan's bound — no node it grows (chain,
          // side twig, water-seek runner) farther than fallDist + one reach from the strand it pressed.
          // Water pockets are LEFT IN (a runner toward one is the case that overshot before).
          // Pile-claim mat nodes (`.colon`) are counted apart: see mineGrow for why they are not bounded.
          const A = { digs: 0, nodes: 0, over: [], side: 0, runner: 0, colonFar: 0, runnerMade: 0, pockets: 0 };
          // How many nodes the water-seek helper made inside audited digs — so a pass shows runners
          // were actually thrown (and held), not that none happened to fire.
          const rfw = net.reachForWater;
          let inDig = false;
          net.reachForWater = function (...a) { const m = rfw.apply(this, a); if (inDig) A.runnerMade += m; return m; };
          const R = s.config.mine.fallDist + g.mine.steps() * 3 * s.config.growth.segmentLength;
          const orig = g.mine.growFrom;
          g.mine.growFrom = function (...a) {
            const before = net.nextNodeId;
            inDig = true;
            let res;
            try { res = orig.apply(this, a); } finally { inDig = false; }
            if (res && res.ok && res.pressed) {
              A.digs++;
              for (const q of net.nodes) {
                if (q.id < before) continue;
                const d = Math.hypot(q.x - res.pressed.x, q.y - res.pressed.y);
                if (q.colon) { if (d > R) A.colonFar++; continue; }
                A.nodes++;
                if (d > R) {
                  const kind = q.side ? 'side' : 'runner';
                  A[kind]++;
                  if (A.over.length < 6) A.over.push(`${kind} ${Math.round(d)}u`);
                }
              }
            }
            return res;
          };
          window.__heatAudit = A;
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
            const grown = made.filter((q) => !q.colon);
            const farGrown = grown.length ? Math.max(...grown.map(dOf)) : 0;
            const farKinds = grown.filter((q) => dOf(q) > 90 + reach).map((q) => (q.side ? 'side' : 'chain/runner'));
            out.presses.push({ at: depthOf(n.y), ok: res.ok, msg: res.message, charged: w0 - net.water,
              price: g.mine.cost(depthOf(n.y)),
              originDist: res.origin ? Math.hypot(res.origin.x - n.x, res.origin.y - n.y) : null,
              far, farGrown, farKinds, made: made.length, oldDist, oldAt: old ? depthOf(old.y) : null });
          }
          A.pockets = (sub.reservoirs || []).length;
          out.audit = A;
          // THE PRICE STEP IS ASKED OF EVERY CANDIDATE, not only the first (M2 fix). Engine-level: a
          // walled strand with two or more steppable tips within 90 u; `accept` refuses the first tip
          // it is asked about (the case: a nearer neighbour across a heat line) and takes the next.
          // The old find asked once and grew nothing. Then an accept that refuses all: 0 nodes, and
          // `_lastGrowRefusal` names the reason.
          {
            const tips = net.tips().filter((t) => !t.infected);
            const w = net.nodes.find((n) => !n.infected && depthOf(n.y) <= 36 && !canStep(n)
              && tips.filter((t) => t !== n && Math.hypot(t.x - n.x, t.y - n.y) <= 90 && canStep(t)).length >= 2);
            if (w) {
              const calls = [];
              const made = net.growDirected(sub, s.rng, 0, 1, 6, false, w, false, false,
                { maxFallDist: 90, accept: (p) => { calls.push(p.id); return p === w || calls.length >= 2; } });
              const origin = net._lastGrowOrigin ? net._lastGrowOrigin.id : null;
              // jitter off for this one call, so the walled press cannot slip a step through on a lucky
              // random heading and the answer is exactly "nothing grows"
              const gcfg = net.config.growth, j0 = gcfg.branchJitter;
              gcfg.branchJitter = 0;
              let none;
              try {
                none = net.growDirected(sub, s.rng, 0, 1, 6, false, w, false, false,
                  { maxFallDist: 90, accept: (p) => p === w });
              } finally { gcfg.branchJitter = j0; }
              out.acceptProbe = { made, calls: calls.length, origin, second: calls[1], none, reason: net._lastGrowRefusal };
            }
          }
          return out;
        }, QUIET.toString());
        const okN = r.presses.filter((p) => p.ok).length;
        console.log(`    seed ${seed}: dove to ${r.dive} m, ${r.nodes} strands; ${r.presses.length} presses at ${[...new Set(r.presses.map((p) => p.at))].join('/')} m, ${okN} dug`
          + `; the old rule would have grown from ${r.presses.map((p) => Math.round(p.oldDist) + 'u@' + p.oldAt + 'm').slice(0, 4).join(', ')}`);
        reachU = r.reach;
        if (r.acceptProbe && !acceptProbe) acceptProbe = { seed, ...r.acceptProbe };
        for (const k of ['digs', 'nodes', 'side', 'runner', 'colonFar', 'pockets', 'runnerMade']) audit[k] = (audit[k] || 0) + r.audit[k];
        audit.over.push(...r.audit.over.map((o) => `seed ${seed}: ${o}`));
        for (const p of r.presses) {
          presses++;
          if (p.oldDist > 90) oldFar++;
          if (!p.ok) { if (p.charged !== 0) badCharge.push(`refused but charged ${p.charged}`); continue; }
          okDigs++;
          if (!(p.originDist != null && p.originDist <= 90)) badOrigin.push(`${p.originDist == null ? '?' : p.originDist.toFixed(0)}u`);
          if (p.charged !== p.price) badCharge.push(`charged ${p.charged} vs price ${p.price} at ${p.at} m`);
          // THE PLAN'S BOUND, LITERALLY: every node the dig grows — chain, side twig, water runner — within
          // 90 + one reach. (This used to allow twigs an extra ~102 u; they reached 251-288 u against 243.
          // `mineGrow` now passes `within`, which stops twigs and runners at the circle.)
          if (p.farGrown > 90 + r.reach) farNodes.push(`${p.farKinds[0] || '?'} ${p.farGrown.toFixed(0)}u > ${(90 + r.reach).toFixed(0)}`);
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
      ok(`...and no node a press grows (chain, side twig or water runner) lies farther than 90 + one reach (${Math.round(90 + reachU)} u)`,
         okDigs > 0 && farNodes.length === 0, (farNodes.slice(0, 5).join('; ') || 'none past it') + `; reach ${Math.round(reachU)} u`);
      ok('growDirected asks accept() of each steppable candidate: a refused first neighbour falls to the next',
         !!acceptProbe && acceptProbe.made > 0 && acceptProbe.calls >= 2 && acceptProbe.origin === acceptProbe.second,
         JSON.stringify(acceptProbe));
      ok("...and when accept refuses every candidate nothing grows, reason 'accept'",
         !!acceptProbe && acceptProbe.none === 0 && acceptProbe.reason === 'accept', acceptProbe ? `${acceptProbe.none} nodes, reason ${acceptProbe.reason}` : 'no walled strand found');
      ok(`EVERY dig of the block (dive, fans, presses; water pockets in) holds that bound`,
         audit.digs > 300 && audit.nodes > 1000 && audit.over.length === 0 && audit.pockets > 0 && audit.runnerMade > 0,
         `${audit.digs} digs, ${audit.nodes} grown nodes, ${audit.side} twig(s) and ${audit.runner} chain/runner node(s) past ${Math.round(90 + reachU)} u`
         + `${audit.over.length ? ': ' + audit.over.slice(0, 5).join(', ') : ''}; ${audit.pockets} water pockets on the maps, ${audit.runnerMade} water-runner nodes grown; `
         + `${audit.colonFar} pile-claim mat node(s) past it (unbounded by design, see mineGrow)`);
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
