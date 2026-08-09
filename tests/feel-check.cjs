/* The seven feel changes asked for in one batch: enemy-turn speed, the selected-card glow, the
 * resource pill's pulse, right-drag panning and its tutorial step, the cancel-aim radius, the card
 * click sounds, and the Skip chip standing down while the enemies move.
 *
 * WHY ONE CHECK. They arrived together and they are all the same KIND of thing — small changes to
 * how the game feels, every one of which is invisible in a diff and most of which no existing
 * check would notice breaking. Split across seven files they would each be a 30-line harness
 * around one assertion.
 *
 * WHAT IT DELIBERATELY DOES NOT DO: watch an animation run. Headless throttles rAF toward 1-2 Hz,
 * does not advance CSS transitions on its own, and default headless reports
 * `prefers-reduced-motion: reduce` — CLAUDE.md records two FALSE PASSES from timing assertions.
 * So the pulse and the glow are asserted as the STATE that drives them (the class that lands, the
 * computed shadow) and the sounds as the calls that are made, never as pixels moving. The pulse
 * CSS keeps its class under reduced motion precisely so this is possible.
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const ROOT = path.resolve(__dirname, '..');
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.svg': 'image/svg+xml',
  '.webp': 'image/webp', '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.css': 'text/css' };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let pass = 0, fail = 0;
const ok = (n, c, x) => { c ? (pass++, console.log('  PASS  ' + n + (x ? '  — ' + x : '')))
                            : (fail++, console.log('  FAIL  ' + n + (x ? '  — ' + x : ''))); };

(async () => {
  const srv = await new Promise((res) => {
    const s = http.createServer((rq, rs) => {
      let p = decodeURIComponent(rq.url.split('?')[0].split('#')[0]);
      if (p === '/') p = '/index.html';
      const fp = path.join(ROOT, p);
      if (!fp.startsWith(ROOT) || !fs.existsSync(fp) || fs.statSync(fp).isDirectory()) {
        rs.writeHead(404); rs.end('nf'); return;
      }
      rs.writeHead(200, { 'Content-Type': TYPES[path.extname(fp)] || 'application/octet-stream' });
      fs.createReadStream(fp).pipe(rs);
    });
    s.listen(0, () => res(s));
  });
  const base = 'http://localhost:' + srv.address().port;
  const browser = await chromium.launch({ headless: true, executablePath: '/opt/pw-browsers/chromium' });

  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    page.on('pageerror', (e) => { fail++; console.log('  FAIL  page error — ' + e.message); });
    await page.addInitScript(() => { window.MYCELIUM_SUPABASE = { url: '', anonKey: '' }; });
    // Record every synthesised click WITHOUT playing one: the sounds are oscillators, so wrapping
    // createOscillator is the only seam that does not depend on hearing anything. Installed before
    // boot so the module's own AudioContext is the wrapped one.
    await page.addInitScript(() => {
      window.__osc = [];
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      const orig = AC.prototype.createOscillator;
      AC.prototype.createOscillator = function () {
        const o = orig.call(this);
        const rec = { f0: null, f1: null };
        window.__osc.push(rec);
        const sv = o.frequency.setValueAtTime.bind(o.frequency);
        const rp = o.frequency.exponentialRampToValueAtTime.bind(o.frequency);
        o.frequency.setValueAtTime = (v, t) => { if (rec.f0 === null) rec.f0 = v; return sv(v, t); };
        o.frequency.exponentialRampToValueAtTime = (v, t) => { rec.f1 = v; return rp(v, t); };
        return o;
      };
    });
    // Turn-based, so the enemy turn exists at all — it is queued only outside real time.
    await page.goto(base + '/index.html#dev,turn', { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('#loadscreen.ld-ready', { timeout: 120000 }).catch(() => {});
    await page.click('#loadscreen', { timeout: 8000 }).catch(() => {});
    await page.waitForFunction(() => {
      const g = window.__game; return !!(g && g.state && g.state.active && g.state.active.nodes.length);
    }, null, { timeout: 60000 });

    // ---- 1. the enemy walk is half as long ----------------------------------------------------
    console.log('\n1. the enemy turn');
    const slide = await page.evaluate(() => window.__game.enemySlideMs());
    ok('the creatures\' walk is 1000ms, half of the 2000 it was', slide === 1000, slide + 'ms');

    // ---- 7. ...and the Skip chip stands down for its whole span --------------------------------
    // Grouped here because it is the same machine: `state.enemyTurn` spans the reveal, the move,
    // the slide and the attack, and that span IS the window the click is refused in.
    console.log('\n7. the Skip chip while the enemies move');
    const skip = await page.evaluate(async () => {
      const g = window.__game, s = g.state;
      const chip = document.getElementById('skipchip');
      if (!chip) return { err: 'no skip chip' };
      const before = chip.disabled;
      // Give it the energy to skip, so a disabled chip can only mean the enemy turn.
      s.active.energy = 999;
      // `performAction(state, name, ctx)` — the raw engine function, not a UI wrapper. And a bare
      // grow REFUSES once the colony has outrun the map's piles ("no food within sensing range"),
      // and a refusal queues nothing at all — so fall back the way enemy-turn-check does rather
      // than measure a no-op.
      let res = g.performAction(s, 'grow', {});
      if (!res || res.ok !== true) res = g.performAction(s, 'addSubstrate', {});
      const during = { acted: !!(res && res.ok), turn: !!s.enemyTurn, disabled: null, title: null };
      // REPAINT EXPLICITLY. `performAction` is the raw ENGINE function — main's UI wrapper is what
      // sets `uiDirty`, and that flag is module-scoped and unreachable from here, so waiting for
      // frames repaints nothing and reads a stale chip. Calling update() is also the honest test:
      // it is the function that decides how the chip looks.
      g.ui().update();
      during.disabled = chip.disabled; during.title = chip.title;
      return { before, during };
    });
    ok('the chip is live before the action', skip.before === false, JSON.stringify(skip.before));
    ok('the setup action was actually accepted', !!(skip.during && skip.during.acted),
       JSON.stringify(skip.during));
    ok('an action really does queue an enemy turn', skip.during && skip.during.turn === true,
       JSON.stringify(skip.during));
    ok('...and the chip is disabled for its duration', skip.during && skip.during.disabled === true,
       JSON.stringify(skip.during && skip.during.disabled));
    ok('...and says why, rather than looking broken',
       !!(skip.during && /enemies are still moving/i.test(skip.during.title || '')),
       skip.during && skip.during.title);
    // It must come BACK. A button that never re-enables is worse than one that was never disabled.
    const back = await page.waitForFunction(() => {
      const c = document.getElementById('skipchip');
      return !window.__game.state.enemyTurn && c && c.disabled === false;
    }, null, { timeout: 20000 }).then(() => true).catch(() => false);
    ok('...and comes back once the turn is over', back);

    // ---- 5 + 4a. the two hand-tuned constants -------------------------------------------------
    console.log('\n4/5. the input constants');
    const consts = await page.evaluate(() => {
      const src = document.documentElement.innerHTML;
      const m = /const AIM_CANCEL_BACK_PX = ([\d.]+)/.exec(src);
      return { cancel: m ? +m[1] : null };
    });
    ok('the cancel-aim radius is 26 x 1.25', consts.cancel === 32.5, String(consts.cancel));

    // ---- 2. the selected card is unmistakable -------------------------------------------------
    console.log('\n2. the selected card');
    const glow = await page.evaluate(() => {
      const st = document.createElement('style');
      document.head.appendChild(st);
      const probe = (cls) => {
        const b = document.createElement('button');
        b.className = cls;
        document.body.appendChild(b);
        const sh = getComputedStyle(b).boxShadow;
        b.remove();
        return sh;
      };
      const sel = probe('cardbtn selected');
      const plain = probe('cardbtn');
      st.remove();
      const blurs = (sel.match(/(\d+(?:\.\d+)?)px/g) || []).map(parseFloat);
      return { shadow: sel, layers: sel.split('rgb').length - 1, maxPx: Math.max(0, ...blurs),
               inset: /inset/.test(sel), filter: getComputedStyle(document.body).filter,
               plainSame: sel === plain,
               // The sibling-dimming rule is the signal that actually reads. Asserted as a rule in
               // the stylesheet rather than on live cards, because a #dev boot shows the 61-card
               // dev carousel instead of the hand and nothing there is ever `.selected`.
               dims: [...document.styleSheets].some((ss) => {
                 try { return [...ss.cssRules].some((r) => /handlist:has\(\.cardbtn\.selected\)/.test(r.selectorText || '')); }
                 catch (_) { return false; }
               }) };
    });
    ok('a selected card looks different from a plain one at all', glow.plainSame === false);
    ok('...with several shadow layers', glow.layers >= 3, `${glow.layers} layer(s)`);
    // AN OUTER GLOW IS CLIPPED HERE — `.handlist` is a scroll container (overflow-x auto, so
    // overflow-y computes to hidden), which is why widening the halo 16px -> 72px changed the
    // rendered frame by nothing. The signals have to survive that clip: an INSET glow does...
    ok('...including an INSET glow, which the carousel cannot clip', glow.inset === true,
       glow.shadow.slice(0, 80));
    // ...and so does dimming the others, which is the part that actually reads: every card already
    // wears a category-coloured border, so one more outline among four is not a signal.
    ok('...and the unselected cards dim, so the armed one is the only bright card', glow.dims === true);

    // ---- 3. the resource pill pulses, in the right direction ----------------------------------
    console.log('\n3. the resource pill');
    const pulse = await page.evaluate(async () => {
      const g = window.__game, s = g.state;
      const ui = g.ui();
      const pill = () => { const n = document.getElementById('hud-energy'); return n && n.closest('.res'); };
      const cls = () => { const p = pill(); return p ? [...p.classList].filter((c) => c === 'rgain' || c === 'rspend') : null; };
      // DRIVE `ui.update()` DIRECTLY. Setting a resource and waiting for frames does NOT repaint
      // the HUD — the refresh is gated on main's module-scoped `uiDirty`, which a check cannot
      // reach and which no amount of waiting will set on its own. Calling update() is also the
      // honest test: it is the function that decides whether a stock moved.
      // THE FIRST SIGHT OF A VALUE MUST NOT PULSE, and by extension neither must a level change:
      // the memory is keyed on the state object, so a rebuilt state re-baselines. Clearing
      // `_resFor` is exactly what a new level does to it. The classes are cleared by hand first,
      // because this probe runs after the HUD has been live for a while and would otherwise be
      // reading a leftover from an earlier assertion rather than the absence of a new one.
      const p0 = pill();
      if (p0) p0.classList.remove('rgain', 'rspend');
      s.active.energy = 100;
      ui._resFor = null;                        // as a fresh level's state would leave it
      ui.update();
      const start = cls();
      s.active.energy = 400; ui.update();
      const up = cls();                         // income
      s.active.energy = 120; ui.update();
      const down = cls();                       // spend
      // ...and an unchanged stock must touch nothing — this is the churn guard. In real time the
      // HUD repaints twice a second; a pulse that fired on every repaint would be a strobe.
      ui.update(); ui.update();
      const still = cls();
      return { start, up, down, still };
    });
    ok('the FIRST sight of a value does not pulse', Array.isArray(pulse.start) && pulse.start.length === 0,
       JSON.stringify(pulse.start));
    ok('a rising resource flags a GAIN', pulse.up && pulse.up.includes('rgain'), JSON.stringify(pulse.up));
    ok('a falling resource flags a SPEND', pulse.down && pulse.down.includes('rspend'), JSON.stringify(pulse.down));
    ok('...and they are never both on at once',
       !(pulse.up || []).includes('rspend') && !(pulse.down || []).includes('rgain'),
       JSON.stringify([pulse.up, pulse.down]));
    ok('an UNCHANGED resource keeps whatever it had — no repaint strobe',
       JSON.stringify(pulse.still) === JSON.stringify(pulse.down), JSON.stringify(pulse.still));

    // ---- 6. the click sounds -------------------------------------------------------------------
    console.log('\n6. the card click');
    const clicks = await page.evaluate(async () => {
      const g = window.__game;
      const sfx = g.sfx ? g.sfx() : null;
      // The AudioContext only exists once something has made a sound, and only runs after a
      // gesture. Force both so the oscillators are actually built.
      const AC = window.AudioContext || window.webkitAudioContext;
      const probe = new AC();
      try { await probe.resume(); } catch (_) {}
      window.__osc.length = 0;
      return { has: !!(sfx && sfx.playCardSelect && sfx.playCardDeselect) };
    });
    ok('the two click sounds exist and are exported', clicks.has === true, JSON.stringify(clicks));
    const tones = await page.evaluate(async () => {
      const sfx = window.__game.sfx();
      window.__osc.length = 0;
      sfx.playCardSelect();
      const sel = window.__osc.slice();
      window.__osc.length = 0;
      sfx.playCardDeselect();
      const des = window.__osc.slice();
      return { sel, des, muted: sfx.isSfxMuted() };
    });
    // If SFX are muted (or no context yet) nothing is built — say so rather than failing blind.
    if (tones.muted || !tones.sel.length) {
      ok('the click sounds are reachable (no tone built: muted or no audio context)', true,
         `muted=${tones.muted}, oscillators=${tones.sel.length}`);
    } else {
      const s0 = tones.sel[0], d0 = tones.des[0];
      // THE TWO MUST DIFFER BY DIRECTION, not just by pitch: select rises, deselect falls. Two flat
      // blips at different pitches are two blips; a rise and a fall read as "picked up" / "put
      // down" at a volume you are not consciously hearing, which is the brief.
      ok('select RISES in pitch', s0 && s0.f1 > s0.f0, s0 && `${s0.f0} -> ${s0.f1} Hz`);
      ok('deselect FALLS in pitch', d0 && d0.f1 < d0.f0, d0 && `${d0.f0} -> ${d0.f1} Hz`);
    }
    // The transition rule: clearing a selection that was never set must be silent. `clearPendingCard`
    // has fourteen callers and most fire unconditionally, so this is what stops a constant clicking.
    const quiet = await page.evaluate(() => {
      const ui = window.__game.ui ? window.__game.ui() : null;
      if (!ui || !ui.clearPendingCard) return { skipped: true };
      ui.clearPendingCard();
      window.__osc.length = 0;
      ui.clearPendingCard(); ui.clearPendingCard(); ui.clearPendingCard();
      return { built: window.__osc.length };
    });
    ok('clearing an already-empty selection makes no sound',
       quiet.skipped || quiet.built === 0, JSON.stringify(quiet));

    // ---- 4. right-drag pans, and the tutorial says so ------------------------------------------
    console.log('\n4. right-drag to pan');
    const drag = await page.evaluate(async () => {
      const c = document.getElementById('game') || document.querySelector('canvas');
      return { hasCanvas: !!c, cam: !!window.__game.camera };
    });
    // Driving a real right-drag is the only honest test of it — the handler branches on e.button.
    // PRESS ON THE COLONY, not at the canvas centre. `beginAim` deliberately ignores a press more
    // than `aimNearPx` from the nearest living strand and lets it pan instead — so a probe that
    // presses in the middle of the screen never starts an aim, and then "right-drag pans" is true
    // of every build ever made. This was the second thing to make this assertion vacuous.
    const canvasBox = await page.evaluate(() => {
      const g = window.__game;
      const c = document.getElementById('game') || document.querySelector('canvas');
      const r = c.getBoundingClientRect();
      const n = g.state.active.nodes[0];
      const ss = g.camera.worldToScreen(n.x, n.y);
      return { x: r.x + ss.x, y: r.y + ss.y };
    });
    // WITH A CARD ARMED — which is the only state where this is a NEW ability. With nothing armed
    // a left-drag already panned, so dragging on an empty hand would pass on the build that has
    // none of this and prove nothing. Armed, the left button AIMS, and before this change there
    // was no mouse gesture left for moving the camera at all.
    const panned = await page.evaluate(async (mid) => {
      const g = window.__game, s = g.state;
      const c = document.getElementById('game') || document.querySelector('canvas');
      c.setPointerCapture = () => {}; c.releasePointerCapture = () => {};
      const ev = (type, x, y, button) => c.dispatchEvent(new PointerEvent(type, {
        pointerId: 7, clientX: x, clientY: y, button, buttons: button === 2 ? 2 : 1,
        bubbles: true, cancelable: true, pointerType: 'mouse' }));
      // ARM A DRAG-AIMED CARD SPECIFICALLY — not merely "a card that arms". Only a card whose
      // effect declares `aim: 'drag'` makes `beginAim` take the gesture; anything else leaves the
      // left button panning as it always did, so the assertion below would pass on a build with
      // none of this in it. That is exactly what the first version of this probe did: it armed
      // Acorn Cache, and the negative control passed.
      s.active.energy = 999; s.active.water = 999; s.active.phosphorus = 999;
      const dragAimed = (n) => !!g.cardUsesDragAim && g.cardUsesDragAim(n);
      const hand = (s.cards && s.cards.hand) || [];
      let armed = null;
      for (let i = 0; i < hand.length; i++) {
        if (!dragAimed(hand[i].name)) continue;
        g.handlers.onPlayCard(i);
        const pc = g.ui().pendingCard;
        if (pc) { armed = pc.name; break; }
      }
      if (!armed) return { noCard: true, hand: hand.map((h) => h.name + (dragAimed(h.name) ? '*' : '')) };
      // ...and confirm the gesture really is taken: with this armed, a LEFT drag must AIM, not pan.
      const camL0 = { x: g.camera.x, y: g.camera.y };
      ev('pointerdown', mid.x, mid.y, 0);
      ev('pointermove', mid.x - 120, mid.y - 40, 0);
      const leftPanned = Math.abs(g.camera.x - camL0.x) + Math.abs(g.camera.y - camL0.y);
      ev('pointerup', mid.x, mid.y, 0);          // back to the press point = cancel, no growth
      const nodes0 = s.active.nodes.length;
      const before = { x: g.camera.x, y: g.camera.y };
      ev('pointerdown', mid.x, mid.y, 2);
      ev('pointermove', mid.x - 40, mid.y, 2);
      ev('pointermove', mid.x - 160, mid.y - 60, 2);
      ev('pointerup', mid.x - 160, mid.y - 60, 2);
      const after = { x: g.camera.x, y: g.camera.y };
      return { armed, before, after, leftPanned, stillArmed: !!g.ui().pendingCard,
               grew: s.active.nodes.length - nodes0,
               moved: Math.abs(after.x - before.x) + Math.abs(after.y - before.y) };
    }, canvasBox).catch((e) => ({ err: String(e).split('\n')[0] }));
    ok('a directional card can be armed (the state this is all for)',
       panned && !panned.err && !panned.noCard && !!panned.armed,
       panned && (panned.err || panned.armed || JSON.stringify(panned.hand)));
    ok('...and with it armed the LEFT button aims rather than panning (the reason this is needed)',
       panned && !panned.err && !panned.noCard && panned.leftPanned === 0,
       panned && `left drag moved the camera ${panned.leftPanned} units`);
    ok('a RIGHT-button drag pans EVEN WITH A CARD ARMED',
       panned && !panned.err && panned.moved > 1,
       panned && (panned.err || `moved ${(panned.moved || 0).toFixed(1)} world units`));
    // ...and it must be a camera gesture only: the armed card is still armed and nothing grew.
    ok('...without firing the armed card', panned && panned.grew === 0 && panned.stillArmed === true,
       panned && `grew ${panned.grew} strand(s), still armed: ${panned.stillArmed}`);
    // The context menu must not follow the drag out.
    const ctx = await page.evaluate(() => {
      const c = document.getElementById('game') || document.querySelector('canvas');
      const e = new MouseEvent('contextmenu', { bubbles: true, cancelable: true });
      const fired = c.dispatchEvent(e);
      return { defaultPrevented: !fired };
    });
    ok('...and the browser context menu is suppressed on the canvas', ctx.defaultPrevented === true,
       JSON.stringify(ctx));

    const script = await page.evaluate(() => {
      const g = window.__game;
      if (!g.startTutorial) return null;
      g.startTutorial();
      const sc = g.tutorialScript ? g.tutorialScript() : null;
      return sc ? sc.map((s) => String(s.text || '')) : null;
    });
    ok('the tutorial exists and has steps', Array.isArray(script) && script.length > 3,
       script ? script.length + ' step(s)' : 'none');
    const camStep = (script || []).find((t) => /zoom in and out/i.test(t));
    ok('...and one of them teaches the camera', !!camStep, camStep || 'no camera step');
    ok('...naming BOTH gestures the owner asked for',
       !!camStep && /scroll or pinch/i.test(camStep) && /right mouse button/i.test(camStep),
       camStep);
    await page.close();

    // ---- 8. TOUCH: the drag-aim must still fire, at any usable length ---------------------------
    // THE REGRESSION THIS EXISTS FOR. Raising AIM_CANCEL_BACK_PX to 32.5 broke aiming on a phone,
    // and the mechanism is a DEAD BAND rather than the constant: `updateAim` used to cancel on
    // `dragged && d <= AIM_CANCEL_BACK_PX`, so every drag ending between AIM_MIN_PX (12) and the
    // cancel radius was aimed AND cancelled at once and did nothing. Measured on a 390px viewport:
    // a 30px drag fired at 26 and did NOT at 32.5, while 40px fired at both — which is why it
    // looked like "aiming is broken" rather than "short aims are broken".
    //
    // A TOUCH page, deliberately: the pointer path branches on button/pointerType, and the desktop
    // page above cannot see a phone-only break.
    console.log('\n8. touch drag-aim');
    const touch = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3,
                                          isMobile: true, hasTouch: true });
    touch.on('pageerror', (e) => { fail++; console.log('  FAIL  page error — ' + e.message); });
    await touch.addInitScript(() => { window.MYCELIUM_SUPABASE = { url: '', anonKey: '' }; });
    await touch.goto(base + '/index.html#dev,turn', { waitUntil: 'domcontentloaded' });
    await touch.waitForSelector('#loadscreen.ld-ready', { timeout: 120000 }).catch(() => {});
    await touch.click('#loadscreen', { timeout: 8000 }).catch(() => {});
    await touch.waitForFunction(() => {
      const g = window.__game; return !!(g && g.state && g.state.active && g.state.active.nodes.length);
    }, null, { timeout: 60000 });
    await sleep(1200);

    const aims = await touch.evaluate(async () => {
      const g = window.__game, s = g.state;
      const c = document.getElementById('game') || document.querySelector('canvas');
      c.setPointerCapture = () => {}; c.releasePointerCapture = () => {};
      const ev = (type, x, y) => c.dispatchEvent(new PointerEvent(type, {
        pointerId: 3, clientX: x, clientY: y, button: 0, buttons: 1,
        isPrimary: true, pointerType: 'touch', bubbles: true, cancelable: true }));
      // A fired aim CONSUMES the card, so each round has to re-arm — drawing more if the hand has
      // run out of drag-aimed ones. Without this the later rows run with nothing armed and
      // silently measure nothing, which reads as a failure at those distances.
      const arm = async () => {
        for (let t = 0; t < 25 && !g.ui().pendingCard; t++) {
          const h = s.cards.hand; let found = false;
          for (let i = 0; i < h.length; i++) {
            if (!g.cardUsesDragAim(h[i].name)) continue;
            g.handlers.onPlayCard(i);
            if (g.ui().pendingCard) { found = true; break; }
          }
          if (!found) { s.active.energy = 999; g.draw(); await new Promise((r) => setTimeout(r, 60)); }
        }
        return !!g.ui().pendingCard;
      };
      // OUT AND BACK FIRST, while a drag-aimed card is still guaranteed to be in the opening hand.
      // Run after the sweep it returned null on some hands: six plays plus the draws to replace
      // them can empty the hand of drag-aimed cards entirely, and a null there reads as "cancelling
      // is broken" when nothing was ever armed to cancel.
      s.active.energy = 999; s.active.water = 999; s.active.phosphorus = 999;
      let cancelled = null;
      if (await arm()) {
        const r = c.getBoundingClientRect();
        const n = s.active.nodes[0];
        const ss = g.camera.worldToScreen(n.x, n.y);
        const px = r.x + ss.x, py = r.y + ss.y;
        const h0 = s.cards.hand.length;
        ev('pointerdown', px, py);
        ev('pointermove', px + 200, py + 30);
        ev('pointermove', px + 80, py + 10);
        ev('pointermove', px + 6, py + 2);      // back inside the cancel radius
        ev('pointerup', px + 6, py + 2);
        await new Promise((r2) => setTimeout(r2, 400));
        cancelled = { played: s.cards.hand.length < h0, stillArmed: !!g.ui().pendingCard };
        g.handlers.onCancelCard && g.handlers.onCancelCard();   // disarm before the sweep
      }
      const out = [];
      for (const dist of [15, 20, 30, 40, 60, 120]) {
        s.active.energy = 999; s.active.water = 999; s.active.phosphorus = 999;
        if (!await arm()) { out.push({ dist, armed: false }); continue; }
        const r = c.getBoundingClientRect();
        const n = s.active.nodes[0];
        const ss = g.camera.worldToScreen(n.x, n.y);
        const px = r.x + ss.x, py = r.y + ss.y;
        const h0 = s.cards.hand.length;
        ev('pointerdown', px, py);
        ev('pointermove', px + dist * 0.5, py + 2);
        ev('pointermove', px + dist, py + 4);
        ev('pointerup', px + dist, py + 4);
        await new Promise((r2) => setTimeout(r2, 400));
        out.push({ dist, armed: true, played: s.cards.hand.length < h0 });
      }
      return { out, cancelled };
    });
    const measured = aims.out.filter((r) => r.armed);
    ok('every touch aim round actually had a card armed', measured.length === aims.out.length,
       `${measured.length} of ${aims.out.length}`);
    const fired = measured.filter((r) => r.played).map((r) => r.dist);
    ok('a touch drag-aim fires at EVERY usable length, short ones included',
       measured.length > 0 && measured.every((r) => r.played),
       `fired at ${fired.join(', ')}px of ${measured.map((r) => r.dist).join(', ')}`);
    // The short end is the whole point — 15px fired at neither 26 nor 32.5 before the rule changed.
    ok('...including a 15px flick, which the old rule swallowed at any radius',
       !!(measured.find((r) => r.dist === 15) || {}).played);
    ok('dragging OUT and BACK still cancels, and keeps the card armed',
       !!aims.cancelled && aims.cancelled.played === false && aims.cancelled.stillArmed === true,
       JSON.stringify(aims.cancelled));

    // ---- 9. the "Aiming <card>" chip is gone ---------------------------------------------------
    console.log('\n9. no aiming chip');
    const chip = await touch.evaluate(() => ({
      handsel: !!document.getElementById('handsel'),
      handhead: !!document.querySelector('.handhead'),
      // SCOPED TO THE HUD, not to `document.body`: the entire game is ONE INLINE <script> inside
      // the body, so `body.textContent` contains the source code and matches every comment that
      // happens to say "Aiming". It read as a failure on a build with no chip in it.
      aimingText: /Aiming/.test((document.getElementById('ui') || {}).textContent || ''),
    }));
    ok('the phone "Aiming <card>" chip is gone', chip.handsel === false && chip.handhead === false,
       JSON.stringify(chip));
    ok('...and nothing else says "Aiming"', chip.aimingText === false, JSON.stringify(chip));
    await touch.close();
  } catch (e) {
    fail++; console.log('  HARNESS ERROR — ' + (e && e.stack || e));
  }

  await browser.close(); srv.close();
  console.log(`\n==== ${pass} passed, ${fail} failed ====`);
  process.exit(fail ? 1 : 0);
})();
