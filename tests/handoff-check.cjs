/* THE HANDOFF CURTAIN: nothing of the game shows between a menu and the level card.
 *
 * The report: "when I enter the game via old - I'm sometimes getting a flash of the card
 * carousel or of the map before they should appear."
 *
 * The mechanism, and it is not where it looks: `showMainMenu` calls `hideCanvas()` but leaves
 * `#ui` mounted, so returning to the title from a run parks the previous run's card carousel
 * behind a screen that happens to cover it — and the title's own 560 ms fade-out then reveals
 * it, frame by frame, on the way into the next run. The exposure therefore runs from mid-fade
 * (title opacity ~0.33) to the frame the level card arrives on, which is BEFORE `finishFn` does
 * `root.remove(); cb()`. A curtain raised at the run start is a whole fade too late — measured
 * at 21 exposed frames without it and 20 with, which is what sent this check after the timing
 * rather than the covering.
 *
 * So the assertions are about WHEN, not just whether:
 *   - sample every rAF frame across the whole title → Old → level card window and demand ZERO
 *     frames in which the title is effectively transparent, no card is up, and either the HUD's
 *     carousel or the canvas can be seen;
 *   - the curtain LIFTS (a curtain that sticks is a black screen, far worse than the flash);
 *   - and the safety timer is armed by the RUN START, not by the raise — a 4 s timer armed at
 *     the menu would drop the curtain while the player is still reading the title and hand the
 *     flash straight back. That one is invisible in any screenshot and is the reason
 *     `raiseHandoff` and `armHandoffSafety` are two functions.
 */
const http = require('http'), fs = require('fs'), path = require('path');
const { chromium } = require('playwright');
const ROOT = path.resolve(__dirname, '..');
const T = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.png': 'image/png',
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.svg': 'image/svg+xml', '.webp': 'image/webp',
  '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.css': 'text/css' };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let pass = 0, fail = 0;
const ok = (n, c, x) => { c ? (pass++, console.log('  PASS  ' + n + (x ? '  — ' + x : ''))) : (fail++, console.log('  FAIL  ' + n + (x ? '  — ' + x : ''))); };

// Start sampling every rAF frame: what is on screen, and is anything of the game showing?
const startSampling = (page) => page.evaluate(() => {
  window.__F = []; let n = 0;
  const tick = () => {
    const t = document.getElementById('titleScreen');
    const cv = document.getElementById('game'), ui = document.getElementById('ui');
    const us = ui && getComputedStyle(ui);
    window.__F.push({
      n: n++,
      tOp: t ? +(+getComputedStyle(t).opacity).toFixed(3) : 0,   // gone counts as fully faded
      card: !!document.getElementById('levelIntro'),
      menu: !!(t || document.getElementById('speciesSelect')),
      cvOp: cv ? +getComputedStyle(cv).opacity : null,
      uiVis: !!(us && us.display !== 'none' && us.visibility !== 'hidden'),
      cards: document.querySelectorAll('#ui .cardbtn').length,
      curtain: document.body.classList.contains('handoff'),
    });
    if (n < 900) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
});
// EXPOSED = inside the HANDOVER WINDOW, the covering screen is effectively transparent and either
// the HUD or the map can be seen. That is the flash, defined.
//
// THE WINDOW HAS TO END SOMEWHERE, and `!f.card` was doing that job implicitly — the level card takes
// over and every later frame stops counting. The mine's exit has NO CARD (the map's own fade is the
// takeover), so with the campaign's door shut every frame after a perfectly clean handover read as
// exposed: 267 of them, the first one already showing `curtain:false, cvOp:1`, i.e. the game visible
// because the game had legitimately started. The window ends at whichever takeover happened — the
// card, or the curtain coming down — and frames after it are the game being played.
const exposedIn = (F) => {
  let end = F.findIndex((f) => f.card);
  if (end < 0) {
    // The curtain going UP and then DOWN again is the handover, and `revealMap` drops it at the
    // moment something has taken over. Before it has ever gone up there is nothing to hand over.
    const up = F.findIndex((f) => f.curtain);
    end = up < 0 ? F.length : F.findIndex((f, i) => i > up && !f.curtain);
    if (end < 0) end = F.length;
  }
  return F.slice(0, end).filter((f) => f.tOp < 0.35 && !f.card
    && ((f.uiVis && f.cards > 0) || (f.cvOp != null && f.cvOp > 0.05)));
};

(async () => {
  const srv = await new Promise((res) => { const s = http.createServer((rq, rs) => {
    let p = decodeURIComponent(rq.url.split('?')[0].split('#')[0]); if (p === '/') p = '/index.html';
    const fp = path.join(ROOT, p);
    if (!fp.startsWith(ROOT) || !fs.existsSync(fp) || fs.statSync(fp).isDirectory()) { rs.writeHead(404); rs.end('nf'); return; }
    rs.writeHead(200, { 'Content-Type': T[path.extname(fp)] || 'application/octet-stream' });
    fs.createReadStream(fp).pipe(rs); }); s.listen(0, () => res(s)); });
  const base = 'http://localhost:' + srv.address().port;
  const browser = await chromium.launch({ headless: true, executablePath: '/opt/pw-browsers/chromium' });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await ctx.newPage();
  const errs = []; page.on('pageerror', (e) => errs.push(String(e && e.message)));
  await page.addInitScript(() => { window.MYCELIUM_SUPABASE = { url: '', anonKey: '' }; });
  await page.goto(base + '/index.html#dev,turn', { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#loadscreen.ld-ready', { timeout: 25000 }).catch(() => {});
  await page.click('#loadscreen', { timeout: 5000 }).catch(() => {});
  await page.waitForFunction(() => !!(window.__game && window.__game.campaign), { timeout: 25000 });
  await sleep(1200);

  // ---- 1. the dev boot path lifts it -------------------------------------------------------
  // No level card here (the dev flag skips it on a playtest), so `revealMap` falls through to
  // the map's own 1.4 s fade — the exit that has nothing to hand over to. A curtain still up
  // after that is a black screen, so this is the "does it lift at all?" control.
  console.log('\n-- the curtain lifts on a boot with no level card --');
  const booted = await page.evaluate(() => ({
    curtain: document.body.classList.contains('handoff'),
    uiVis: getComputedStyle(document.getElementById('ui')).visibility !== 'hidden',
    cvOp: +getComputedStyle(document.getElementById('game')).opacity,
  }));
  ok('after the map has revealed, the curtain is down', !booted.curtain);
  ok('...and the HUD is visible again', booted.uiVis);
  ok('...and the canvas is opaque', booted.cvOp > 0.9, `opacity ${booted.cvOp}`);

  // ---- 2. the reported path: in a run, back to the title, press Old ------------------------
  console.log('\n-- title → Old, with a run\'s carousel standing behind the title --');
  await page.evaluate(async () => {
    document.querySelectorAll('#speciesSelect,#levelIntro,#tutorial').forEach((n) => n.remove());
    window.__game.campaign.play('marasmius', 3);
    await new Promise((r) => setTimeout(r, 1500));
    document.querySelectorAll('#levelIntro,#tutorial').forEach((n) => n.remove());
    try { window.__game.ui.setHandOpen(true); } catch (_) {}
    await new Promise((r) => setTimeout(r, 600));
  });
  const held = await page.evaluate(() => ({ cards: document.querySelectorAll('#ui .cardbtn').length,
    pills: document.querySelectorAll('#ui .res').length }));
  // WITHOUT SOMETHING BEHIND THE TITLE THERE IS NOTHING FOR THE FADE TO EXPOSE and the whole block
  // passes vacuously — this is the setup assertion, not a nicety. A carousel is what the bug was
  // reported about; the resource pills are what a mine run leaves standing there instead, and either
  // is enough for `exposedIn` (whose other arm is the MAP showing through, which covers both).
  ok('the HUD is holding something to be flashed', held.cards > 0 || held.pills > 0,
     `${held.cards} cards, ${held.pills} pills`);

  await page.evaluate(() => { window.__game.showTitle(); });
  // `.ts-btn` IS THE CLASS EVERY TITLE LAYOUT'S BUTTONS CARRY, and this wait has been broken by a
  // layout change twice now — once when the real-time rows came off and again when the campaign and
  // survival rows did. `#tsContCamp` was only ever standing in for "the title screen is up".
  await page.waitForSelector('#titleScreen .ts-btn', { timeout: 12000 });
  await sleep(1200);

  // The curtain must be up ALREADY, while the title still covers everything — that is the whole
  // fix. Raising it when the run starts is one full 560 ms fade too late.
  const onTitle = await page.evaluate(() => ({
    curtain: document.body.classList.contains('handoff'),
    uiVis: getComputedStyle(document.getElementById('ui')).visibility !== 'hidden',
  }));
  ok('the curtain is up as soon as the title screen is', onTitle.curtain);
  ok('...and the HUD behind it is hidden', !onTitle.uiVis);

  // THE SAFETY TIMER IS ARMED BY THE RUN START, NOT THE RAISE. 4 s is the timer's own length;
  // sit past it on the title and the curtain must still be up, or a player who reads the screen
  // gets the flash back.
  await sleep(4800);
  const stillUp = await page.evaluate(() => document.body.classList.contains('handoff'));
  ok('sitting on the title past the 4 s safety timer does not drop it', stillUp);

  await startSampling(page);
  // THROUGH THE BUTTON THAT EXISTS, and the button matters here more than the destination: what this
  // block measures is the TITLE'S OWN 560 ms FADE-OUT with a finished run's HUD standing behind it,
  // and `consume()` — the strand growing into the pressed word, then `root.remove(); cb()` — is what
  // plays it. Calling the handler directly leaves the title mounted at full opacity, and `exposedIn`
  // then finds nothing and passes VACUOUSLY, which is worse than the failure it replaced.
  //
  // With the campaign's and survival's doors shut (`OFFER_CAMPAIGN`) the one word on the screen is the
  // mine's, so that is the handover a player actually crosses. The curtain is the same mechanism at
  // both ends — raised in `showMainMenu`, dropped at `revealMap`'s exits — and the mine takes the exit
  // with NO LEVEL CARD, which is the harder of the two: there is nothing to cover the map but the
  // curtain itself.
  await page.click('#tsNewMine');
  await sleep(9000);
  const F = await page.evaluate(() => window.__F);
  const exposed = exposedIn(F);
  const cardAt = F.findIndex((f) => f.card);
  ok('frames were sampled across the handoff', F.length > 60, `${F.length} frames`);
  ok('the map was revealed at the far end',
     await page.evaluate(() => +getComputedStyle(document.getElementById('game')).opacity) > 0.9,
     cardAt >= 0 ? `a card came up at frame ${cardAt}` : 'no card — the mine has none');
  ok('NO frame shows the game between the title and the map', exposed.length === 0,
    exposed.length ? `${exposed.length} exposed, first ${JSON.stringify(exposed[0])}` : '0 of ' + F.length);
  // The curtain has to be the reason, not luck: it must have been up across the fade.
  const curtained = F.filter((f) => f.curtain).length;
  ok('the curtain covered the window rather than luck doing it', cardAt < 0 || curtained >= cardAt,
    `${curtained} curtained frames, card at ${cardAt}`);
  // And it must come down once the card is up, or the run is unplayable behind it.
  // THE CURTAIN MUST BE DOWN BY THE TIME SOMETHING HAS TAKEN OVER — the level card where there is
  // one, and the map's own fade where there is not (the mine's exit). A curtain still up at the end
  // is a black screen, which is far worse than the flash it prevents, so this is the other side of
  // every assertion above it.
  const lastF = F[F.length - 1] || {};
  ok('the curtain is down once the takeover has happened',
     cardAt >= 0 ? !F[Math.min(F.length - 1, cardAt)].curtain : lastF.curtain === false,
     cardAt >= 0 ? `curtain at card frame: ${F[Math.min(F.length - 1, cardAt)].curtain}`
                 : `curtain at the last sampled frame: ${lastF.curtain}`);

  await page.evaluate(() => { const li = document.getElementById('levelIntro'); if (li) li.remove(); });
  await sleep(700);
  const after = await page.evaluate(() => {
    // `.cardbtn` in a mine run is legitimately absent (there are no cards), so the visibility test
    // below falls back to the resource pill — what the curtain has to hand back is the HUD, whatever
    // that HUD is made of.
    const c = document.querySelector('#ui .cardbtn') || document.querySelector('#ui .res');
    return {
      curtain: document.body.classList.contains('handoff'),
      uiVis: getComputedStyle(document.getElementById('ui')).visibility !== 'hidden',
      // visibility INHERITS, so the container being visible does not settle it for the carousel
      // — and the carousel is the thing the player has to be able to see and click.
      cardVis: c ? getComputedStyle(c).visibility : null,
    };
  });
  ok('once the level is up the curtain is gone', !after.curtain);
  ok('...the HUD is visible', after.uiVis);
  ok('...and so are the cards in it', after.cardVis === 'visible', String(after.cardVis));

  // ---- 3. the New path: title → picker ----------------------------------------------------
  // Same fade, different destination. The picker mounts on <body> rather than inside `#ui`, so
  // the curtain cannot hide the screen it is protecting — assert that, because hiding the picker
  // would be a far louder bug than the one being fixed.
  console.log('\n-- title → New → the species picker --');
  await page.evaluate(() => { window.__game.showTitle(); });
  // `.ts-btn` IS THE CLASS EVERY TITLE LAYOUT'S BUTTONS CARRY, and this wait has been broken by a
  // layout change twice now — once when the real-time rows came off and again when the campaign and
  // survival rows did. `#tsContCamp` was only ever standing in for "the title screen is up".
  await page.waitForSelector('#titleScreen .ts-btn', { timeout: 12000 });
  await sleep(900);
  await startSampling(page);
  await page.evaluate(() => { window.__game.showPicker(); });
  await sleep(2500);
  const F2 = await page.evaluate(() => window.__F);
  ok('reaching the picker shows no frame of the game either', exposedIn(F2).length === 0,
    `${exposedIn(F2).length} of ${F2.length}`);
  const pick = await page.evaluate(() => {
    const ss = document.getElementById('speciesSelect');
    return { up: !!ss, vis: ss ? getComputedStyle(ss).visibility : null, curtain: document.body.classList.contains('handoff') };
  });
  ok('the picker itself is not hidden by the curtain', pick.up && pick.vis !== 'hidden', `visibility ${pick.vis}`);
  ok('the curtain is up behind the picker', pick.curtain);

  await page.screenshot({ path: path.join(__dirname, '.artifacts', 'handoff-picker.png'), animations: 'disabled', timeout: 15000 }).catch(() => {});

  ok('no page errors', errs.length === 0, errs.slice(0, 2).join(' | '));
  console.log(`\n==== ${pass} passed, ${fail} failed ====`);
  await browser.close(); srv.close();
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('HARNESS ERROR', e); process.exit(1); });
