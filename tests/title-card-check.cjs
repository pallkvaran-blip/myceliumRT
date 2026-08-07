/* docs/title-card.html — the itch title card (the wordmark growing in over "-CHAPTER ONE-").
 *
 * It is a marketing asset rather than game code, but it has now produced three defects that a diff
 * cannot show and only a rendered frame can, so they are pinned here:
 *
 *   1. THE WORDMARK CLIPS AT THE FRAME EDGES. `growMyceliumTitle`'s seed() sprays attractors
 *      OUTWARD from each glyph and the mat follows them, so the DRAWN ink is wider than the text
 *      box the font size was picked from. The game's canvas is full-viewport and absorbs that; this
 *      card's box does not, and at the game's 0.9 width factor both M's lost their outer strokes.
 *   2. THE RED FILL COPY DOES NOT PAINT. The line is two copies — a dark stroked one for the edge,
 *      a texture-filled one on top — and the fill is a BACKGROUND clipped to the glyphs. That has
 *      failed twice: once because a negative-z-index child paints ABOVE its parent's background
 *      (so the dark copy came out on top), and once because the fill copy inherited the parent's
 *      black text-shadow, which paints AFTER a background and so landed on its own fill.
 *   3. …and both of those look identical from outside: dark letters with a red rim. Which is why
 *      every assertion below carries a NEGATIVE CONTROL rather than a bare threshold — a floor
 *      picked by hand was met by the broken builds (the first version of the "lit body" assertion
 *      passed on the text-shadow bug, and the first two texture/edge metrics measured the ramp and
 *      the drop shadow rather than the thing they named).
 *
 * Pixels are read by round-tripping a screenshot back into the page as a data URL and sampling it
 * on a canvas; the wordmark's own canvas is read directly, since it is not tainted.
 */
const http = require('http');
const fs = require('fs');
const { chromium } = require('playwright');

const ROOT = '/home/user/myceliumRT';
// TC_PAGE points the check at a copy — how the negative controls in this header were verified.
const PAGE = process.env.TC_PAGE || ROOT + '/docs/title-card.html';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let pass = 0, fail = 0;
const ok = (cond, label, detail) => {
  if (cond) { pass++; console.log('  PASS  ' + label + (detail ? '  — ' + detail : '')); }
  else { fail++; console.log('  FAIL  ' + label + (detail ? '  — ' + detail : '')); }
};

/* One boot. `css` is injected before the growth finishes, so a control build renders from the
 * start rather than being patched into a settled frame. */
async function boot(browser, w, h, css) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1,
                                         reducedMotion: 'no-preference' });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => { fail++; console.log('  FAIL  page error — ' + e.message); });
  // Stamp when the growth canvas first appears, so the lead-in hold can be measured without
  // polling for it. Installed before navigation; costs nothing to the boots that ignore it.
  await page.addInitScript(() => {
    window.__tc = { nav: performance.now() };
    addEventListener('DOMContentLoaded', () => {
      new MutationObserver(() => {
        if (!window.__tc.canvas && document.querySelector('#word canvas')) {
          window.__tc.canvas = performance.now();
        }
      }).observe(document.body, { subtree: true, childList: true });
    });
  });
  await page.goto(boot.base + '/', { waitUntil: 'domcontentloaded' });
  if (css) await page.addStyleTag({ content: css });
  // The line fades in on the wordmark's BLOOM, not on g.done — wait for the class, not a delay.
  await page.waitForFunction(() => document.getElementById('lines').classList.contains('in'),
                             { timeout: 30000 });
  await sleep(1400);                                   // the 900ms fade, plus the growth's tail
  return { ctx, page };
}

/* The wordmark's ink bounding box — its gaps to the canvas edges, and where it sits against the
 * chapter line. Read off the canvas the growth draws into, at alpha >= 24 so the bloom's faintest
 * haze doesn't count as ink. */
async function inkGaps(page) {
  return page.evaluate(() => {
    const c = document.querySelector('#word canvas');
    if (!c) return null;
    const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
    let lo = c.width, hi = -1, top = c.height, bot = -1;
    for (let y = 0; y < c.height; y++) {
      const row = y * c.width * 4;
      for (let x = 0; x < c.width; x++) {
        if (d[row + x * 4 + 3] >= 24) {
          if (x < lo) lo = x; if (x > hi) hi = x;
          if (y < top) top = y; if (y > bot) bot = y;
        }
      }
    }
    if (hi < 0) return null;
    const wb = document.getElementById('word').getBoundingClientRect();
    const sx = c.width / wb.width, sy = c.height / wb.height;    // device px -> css px
    const inkTop = wb.top + top / sy, inkBot = wb.top + bot / sy;
    const soon = document.querySelector('.soon').getBoundingClientRect();
    return { left: Math.round(lo / sx), right: Math.round((c.width - 1 - hi) / sx),
             canvas: c.width + 'x' + c.height,
             inkH: Math.round(inkBot - inkTop),
             // The OPTICAL gap: ink to type, not box to box. #word is taller than the ink in it.
             gap: Math.round(soon.top - inkBot),
             // How far the whole lockup's centre sits off the frame's, in px.
             offCentre: Math.round((inkTop + soon.bottom) / 2 - innerHeight / 2) };
  });
}

/* Stats over the chapter line's own box, from a screenshot sampled back inside the page. */
async function lineStats(page) {
  const rect = await page.evaluate(() => {
    const r = document.querySelector('.soon').getBoundingClientRect();
    // A little headroom each way: the stroke and the drop sit outside the text box.
    return { x: Math.round(r.left) - 4, y: Math.round(r.top) - 4,
             width: Math.round(r.width) + 8, height: Math.round(r.height) + 8 };
  });
  const png = await page.screenshot({ clip: rect, animations: 'disabled', timeout: 15000 });
  return page.evaluate(async (b64) => {
    const img = new Image();
    await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = b64; });
    const c = document.createElement('canvas');
    c.width = img.width; c.height = img.height;
    const x = c.getContext('2d'); x.drawImage(img, 0, 0);
    const d = x.getImageData(0, 0, c.width, c.height).data;
    const W = c.width, H = c.height;

    // "Glyph" = the lit red body of a letter. Deliberately NOT "any non-black pixel": the glow is
    // red too, and a build whose fill never painted still has the glow.
    const R = [];
    const isGlyph = new Uint8Array(W * H);
    for (let i = 0, p = 0; i < d.length; i += 4, p++) {
      if (d[i] > 90 && d[i] > d[i + 1] * 2.0) { isGlyph[p] = 1; R.push(d[i]); }
    }
    R.sort((a, b) => a - b);
    const mean = R.length ? R.reduce((a, v) => a + v, 0) / R.length : 0;
    const sd = R.length ? Math.sqrt(R.reduce((a, v) => a + (v - mean) * (v - mean), 0) / R.length) : 0;

    // THE MOTTLE, isolated from the ramp. A plain spread of R cannot see the texture at all: the
    // vertical ramp runs 56% -> 33% lightness down each letter and dominates the variance, and it
    // MOVES when the texture is switched off (different pixels clear the lit threshold), so the
    // texture-off control measured LARGER. This is the HORIZONTAL high frequency instead — each lit
    // pixel against the mean of its own row within +/-3px. The ramp is vertical and smooth, so it
    // contributes almost nothing here and what is left is grain and blotch.
    let hfSum = 0, hfN = 0;
    for (let y = 0; y < H; y++) for (let xp = 3; xp < W - 3; xp++) {
      const p = y * W + xp;
      if (!isGlyph[p]) continue;
      let s = 0, n = 0;
      for (let dx = -3; dx <= 3; dx++) {
        const q = p + dx;
        if (isGlyph[q]) { s += d[q * 4]; n++; }
      }
      if (n < 5) continue;                                  // skip letter edges: AA is not texture
      hfSum += Math.abs(d[p * 4] - s / n); hfN++;
    }

    // THE DARK EDGE, as the brightness of the 1px ring immediately outside the lit body. Counting
    // "near-black pixels near a letter" does not isolate the stroke — the drop shadow puts plenty
    // there on its own — but the colour of the pixel the letter actually ends on does.
    const ring = [];
    for (let y = 1; y < H - 1; y++) for (let xp = 1; xp < W - 1; xp++) {
      const p = y * W + xp;
      if (isGlyph[p]) continue;
      let near = 0;
      for (let dy = -1; dy <= 1 && !near; dy++) for (let dx = -1; dx <= 1; dx++) {
        if (isGlyph[(y + dy) * W + (xp + dx)]) { near = 1; break; }
      }
      if (near) { const i = p * 4; ring.push(d[i] + d[i + 1] + d[i + 2]); }
    }
    ring.sort((a, b) => a - b);
    return { lit: R.length, area: W * H, meanR: +mean.toFixed(1), sdR: +sd.toFixed(2),
             p95R: R.length ? R[Math.floor(R.length * 0.95)] : 0,
             hf: hfN ? +(hfSum / hfN).toFixed(2) : 0,
             ringLum: ring.length ? ring[Math.floor(ring.length / 2)] : 0, ringN: ring.length };
  }, 'data:image/png;base64,' + png.toString('base64'));
}

(async () => {
  const srv = await new Promise((r) => {
    const s = http.createServer((rq, rs) => {
      rs.writeHead(200, { 'Content-Type': 'text/html' });
      rs.end(fs.readFileSync(PAGE));
    });
    s.listen(0, () => r(s));
  });
  boot.base = 'http://localhost:' + srv.address().port;
  const browser = await chromium.launch({ headless: true, executablePath: '/opt/pw-browsers/chromium' });

  try {
    // ---- 1. the wordmark clears the frame -------------------------------------------------
    // Three shapes, because the failure only appears where `titleSize` resolves WIDTH-limited:
    // 1280x720 is height-limited and had 37/41px of headroom on the build that clipped.
    console.log('\nthe wordmark clears the frame, and the lockup holds together');
    for (const [w, h] of [[630, 500], [900, 900], [1280, 720]]) {
      const { ctx, page } = await boot(browser, w, h);
      const g = await inkGaps(page);
      ok(g && g.left > 4 && g.right > 4, `${w}x${h}: ink clears both edges`,
         g ? `left ${g.left}px, right ${g.right}px (canvas ${g.canvas})` : 'no ink found');
      // `tightenToInk` closes the gap to a quarter of the ink's own height and re-centres the
      // union. Both are COMPUTED at run time, from the drawn pixels — the CSS `gap` cannot express
      // them, because #word carries 49-107px of empty box below the ink depending on the shape.
      // Asserted as a RATIO: a px figure here would just be re-stating one viewport's answer.
      const ratio = g ? g.gap / g.inkH : 0;
      ok(g && ratio > 0.17 && ratio < 0.34, `${w}x${h}: the chapter line sits close under the ink`,
         g ? `gap ${g.gap}px against ${g.inkH}px of ink (${ratio.toFixed(2)}x)` : 'no ink found');
      ok(g && Math.abs(g.offCentre) <= 3, `${w}x${h}: the lockup is centred on the frame`,
         g ? `centre is ${g.offCentre}px off` : 'no ink found');
      await ctx.close();
    }

    // ---- 2. the card opens on a beat of black ---------------------------------------------
    // A creative choice with no other trace in the code, and the loop reads wrong without it, so
    // it is pinned. Asserted as EMPTY FRAME rather than "no canvas element": what matters is that
    // nothing is on screen, and a future version might mount the canvas early and hold it blank.
    console.log('\nthe card opens on a beat of black');
    {
      const ctx = await browser.newContext({ viewport: { width: 630, height: 500 },
                                             deviceScaleFactor: 1, reducedMotion: 'no-preference' });
      const page = await ctx.newPage();
      await page.addInitScript(() => {
        window.__tc = { nav: performance.now() };
        addEventListener('DOMContentLoaded', () => {
          new MutationObserver(() => {
            if (!window.__tc.canvas && document.querySelector('#word canvas')) {
              window.__tc.canvas = performance.now();
            }
          }).observe(document.body, { subtree: true, childList: true });
        });
      });
      await page.goto(boot.base + '/', { waitUntil: 'domcontentloaded' });
      await page.evaluate(() => document.getElementById('hint').remove());   // not part of the art
      await sleep(1200);
      const png = await page.screenshot({ animations: 'disabled', timeout: 15000 });
      const bright = await page.evaluate(async (b64) => {
        const img = new Image();
        await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = b64; });
        const c = document.createElement('canvas');
        c.width = img.width; c.height = img.height;
        const x = c.getContext('2d'); x.drawImage(img, 0, 0);
        const d = x.getImageData(0, 0, c.width, c.height).data;
        let m = 0;
        for (let i = 0; i < d.length; i += 4) m = Math.max(m, d[i], d[i + 1], d[i + 2]);
        return m;
      }, 'data:image/png;base64,' + png.toString('base64'));
      // The background gradient's own lightest channel is 19. Ink lands at 245+ on its first frame.
      ok(bright < 40, 'nothing is drawn 1.2s in — the frame is still the bare gradient',
         `brightest channel ${bright} (gradient tops out at 19, ink arrives at 245+)`);

      await page.waitForFunction(() => window.__tc && window.__tc.canvas, { timeout: 20000 });
      const lead = await page.evaluate(() => Math.round(window.__tc.canvas - window.__tc.nav));
      ok(lead > 1700 && lead < 3200, 'and the growth starts about two seconds in',
         `first canvas at ${lead}ms after navigation`);
      await ctx.close();
    }

    // ---- 3. the chapter line's fill actually paints ----------------------------------------
    // MEASURED AT THE TYPE'S FULL SIZE, not at the export's. `font-size` is
    // clamp(26px, 6.2vw, 92px), so 630x500 gives 39px type with ~5px stems — at that width almost
    // every pixel of a letter is an antialiased edge, and both the mottle and the stroke measure as
    // noise against it (the texture read +18% where it is +155% at the cap). 1500x900 hits the 92px
    // ceiling. The LOOK is the same either way; what changes is whether it can be measured.
    console.log('\nthe chapter line is lit red, not a dark silhouette');
    const LW = 1500, LH = 900;
    const shipped = await (async () => {
      const { ctx, page } = await boot(browser, LW, LH);
      const s = await lineStats(page); await ctx.close(); return s;
    })();
    const noFill = await (async () => {
      const { ctx, page } = await boot(browser, LW, LH, '.soon::after { content: none !important; }');
      const s = await lineStats(page); await ctx.close(); return s;
    })();
    if (process.env.TC_DEBUG) console.log('  shipped ' + JSON.stringify(shipped) +
      '\n  noFill  ' + JSON.stringify(noFill));

    // COVERAGE, not a raw count: what the two real failures did was shrink the lit body to a rim,
    // and a rim still has thousands of pixels. Shipped covers ~21% of the line's box; the
    // inherited-text-shadow build covered 3.5%. A loose absolute floor passed that build.
    const cover = shipped.lit / shipped.area;
    ok(cover > 0.15, 'the line has a lit red BODY, not a rim',
       `${(cover * 100).toFixed(1)}% of the line box is lit red (${shipped.lit} px), ` +
       `mean R ${shipped.meanR}, p95 ${shipped.p95R}`);
    ok(shipped.meanR > 120, 'and it is bright enough to read at thumbnail size',
       `mean R ${shipped.meanR}`);
    ok(shipped.lit > noFill.lit * 3, 'NEGATIVE CONTROL: suppressing the fill copy collapses it',
       `${shipped.lit} lit px shipped vs ${noFill.lit} with .soon::after removed`);

    // ---- 4. the fill is textured, not flat --------------------------------------------------
    console.log('\nthe fill is textured');
    const noTex = await (async () => {
      const { ctx, page } = await boot(browser, LW, LH, ':root { --soon-tex: none !important; }');
      const s = await lineStats(page); await ctx.close(); return s;
    })();
    if (process.env.TC_DEBUG) console.log('  noTex   ' + JSON.stringify(noTex));
    ok(shipped.hf > noTex.hf * 1.6, 'the mottle puts high-frequency variation into the fill',
       `horizontal deviation ${shipped.hf} shipped vs ${noTex.hf} with --soon-tex off`);

    // ---- 5. the dark edge is drawn ----------------------------------------------------------
    console.log('\nthe letters carry a dark edge');
    const noStroke = await (async () => {
      const { ctx, page } = await boot(browser, LW, LH, '.soon { -webkit-text-stroke-width: 0 !important; }');
      const s = await lineStats(page); await ctx.close(); return s;
    })();
    if (process.env.TC_DEBUG) console.log('  noStroke ' + JSON.stringify(noStroke));
    // The margin is ~15% and the gate is 7%, which is as much as this can honestly claim: the ground
    // right beside a letter is ALREADY dark, so the stroke is not adding blackness to a bright
    // surround — it is replacing the glow's lit red (lum ~68, and reddish: R 41 over G+B 27) with the
    // oxblood itself (lum 58, R 43 over G+B 15). That substitution is the whole visible effect, and
    // it is why "count the near-black pixels around a letter" measured nothing (2867 vs 2665).
    ok(shipped.ringLum < noStroke.ringLum * 0.93, 'the pixel a letter ends on is the stroke, not the glow',
       `ring luminance ${shipped.ringLum} shipped vs ${noStroke.ringLum} with the stroke removed`);
  } catch (e) {
    fail++; console.log('  HARNESS ERROR — ' + (e && e.stack || e));
  }

  await browser.close(); srv.close();
  console.log(`\n==== ${pass} passed, ${fail} failed ====`);
  process.exit(fail ? 1 : 0);
})();
