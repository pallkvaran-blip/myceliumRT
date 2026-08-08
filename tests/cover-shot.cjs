/* Export docs/title-card.html at a store's cover sizes. A TOOL, not a check — it writes files and
 * never asserts. Companion to title-card-shot.cjs, which does itch's ONE size; this does the three
 * CrazyGames asks for.
 *
 *   node tests/cover-shot.cjs docs/cover-1920x1080.png 1920 1080
 *   node tests/cover-shot.cjs docs/cover-800x1200.png   800 1200
 *   node tests/cover-shot.cjs docs/cover-800x800.png    800  800
 *
 * WHY IT RENDERS BIG AND DOWNSAMPLES, rather than setting the viewport to the target:
 *
 *  - THE GROWTH SIM'S DETAIL IS SET BY CANVAS BACKING PIXELS, and that is the whole reason this
 *    tool is not two lines. Set the viewport to target/2 and 800x1200 gives the wordmark a glyph
 *    118 backing px tall — too little room for the filaments to branch, so they merge and
 *    "MYCELIUM" comes out a faintly furry stencil font with none of the mycelium in it. The
 *    landscape at those same settings gets 284 px and looks like the game. Rendering at the
 *    target's own CSS size with dsf 2 doubles the room the sim has, and the downsample then keeps
 *    that detail as anti-aliasing instead of never simulating it. Supersampling, for the reason
 *    anything else supersamples.
 *  - THE COMPOSITION IS WRITTEN IN `vw`, so the viewport is the layout, not a scale. `#word` is
 *    `min(1240px, 94vw)` and `.soon` is `clamp(26px, 6.2vw, 92px)`. Past about 1320 CSS px the word
 *    hits its cap while the line keeps growing, and the balance the card was tuned at (about
 *    2.4 : 1) closes toward 2.1 : 1 — so the render width is CAPPED at 1280 and the downsample
 *    makes up the rest. Same reason title-card-shot.cjs pins its own viewport.
 *  - THE WORDMARK'S CANVAS CAPS ITS OWN dpr AT 2.5 (`dpr = Math.min(2.5, devicePixelRatio)`), so a
 *    scale factor of 3 renders the mycelium at 2.5x and lets the screenshot upscale it — soft ink
 *    in a cover that is mostly ink. 2 is under the cap, which is why that is the factor used.
 *
 * THE ASPECT RATIO GENUINELY RE-FLOWS, and that is wanted: 16:9 and 2:3 are different pictures, not
 * one picture stretched. What must survive the re-flow is the ink clearing the frame edges — the
 * 0.78 width factor exists because `seed()` sprays attractors OUTWARD and the drawn ink is wider
 * than its text box. `title-card-check.cjs` measures that clearance; this tool prints the same gaps
 * per size so a bad shape shows up here rather than on the store page.
 *
 * The downsample is Pillow (LANCZOS), as everywhere else in this repo that resizes.
 */
const http = require('http');
const fs = require('fs');
const { execFileSync } = require('child_process');
const { chromium } = require('playwright');

const ROOT = '/home/user/myceliumRT';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const OUT = process.argv[2];
const TW = +process.argv[3], TH = +process.argv[4];
const DSF = 2;
const MAX_CSS_W = 1280;          // past ~1320 `#word` hits its 1240px cap and the balance shifts

if (!OUT || !TW || !TH) {
  console.error('usage: node tests/cover-shot.cjs <out.png> <targetW> <targetH>');
  process.exit(2);
}
try { execFileSync('python3', ['-c', 'import PIL'], { stdio: 'ignore' }); }
catch (_) {
  console.error('cover-shot: Pillow is required for the downsample (pip install Pillow)');
  process.exit(2);
}

// CSS viewport at the target's aspect, never wider than MAX_CSS_W; dsf 2 on top of it.
const cssW = Math.min(TW, MAX_CSS_W);
const cssH = Math.round(TH * (cssW / TW));

(async () => {
  const srv = await new Promise((r) => {
    const s = http.createServer((rq, rs) => {
      rs.writeHead(200, { 'Content-Type': 'text/html' });
      rs.end(fs.readFileSync(ROOT + '/docs/title-card.html'));
    });
    s.listen(0, () => r(s));
  });
  const browser = await chromium.launch({ headless: true, executablePath: '/opt/pw-browsers/chromium' });
  const page = await (await browser.newContext({
    viewport: { width: cssW, height: cssH }, deviceScaleFactor: DSF,
    reducedMotion: 'no-preference',
  })).newPage();

  await page.goto('http://localhost:' + srv.address().port + '/', { waitUntil: 'domcontentloaded' });
  // Wait on the BLOOM, not on a guessed duration: the line fades in when the growth's activity
  // falls off its peak, about a second before `g.done`, and that moment is not a fixed length.
  await page.waitForFunction(() => document.getElementById('lines').classList.contains('in'),
                             { timeout: 60000 });
  await sleep(1600);                              // the line's 900ms fade, plus the growth's tail
  await page.evaluate(() => { const h = document.getElementById('hint'); if (h) h.remove(); });
  await sleep(250);

  // Two measurements per shape. The gaps answer "does the ink clear the frame?" and are read off
  // the canvas's own alpha, not off the text box — the box is not where the ink ends. `inkBackingH`
  // answers the other one: whether the sim had room to look like mycelium rather than like a font.
  const shot = await page.evaluate(() => {
    const c = document.querySelector('#word canvas');
    if (!c) return null;
    const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
    let left = c.width, right = -1, top = c.height, bot = -1;
    for (let y = 0; y < c.height; y++) {
      for (let x = 0; x < c.width; x++) {
        if (d[(y * c.width + x) * 4 + 3] > 8) {
          if (x < left) left = x; if (x > right) right = x;
          if (y < top) top = y; if (y > bot) bot = y;
        }
      }
    }
    const box = c.getBoundingClientRect();
    const s = box.width / c.width;                // canvas backing px -> CSS px
    const soon = document.querySelector('.soon');
    return { left: Math.round(box.left + left * s), right: Math.round(innerWidth - (box.left + right * s)),
             top: Math.round(box.top + top * s), bottom: Math.round(innerHeight - (box.top + bot * s)),
             inkBackingH: bot - top,
             soonPx: soon ? Math.round(parseFloat(getComputedStyle(soon).fontSize)) : null,
             wordBoxCSS: Math.round(box.width) };
  });

  const raw = OUT.replace(/\.png$/, '') + '.raw.png';
  await page.screenshot({ path: raw });
  await browser.close(); srv.close();

  execFileSync('python3', ['-c',
    'import sys;from PIL import Image;' +
    'im=Image.open(sys.argv[1]).convert("RGB");' +
    'im.resize((int(sys.argv[3]),int(sys.argv[4])),Image.LANCZOS).save(sys.argv[2])',
    raw, OUT, String(TW), String(TH)]);
  fs.rmSync(raw);

  const capW = cssW * DSF;
  console.log(`${OUT}  ${TW}x${TH}   rendered ${capW}x${cssH * DSF} ` +
              `(css ${cssW}x${cssH} at dsf ${DSF}), downsampled ${(capW / TW).toFixed(2)}x`);
  if (shot) {
    const min = Math.min(shot.left, shot.right);
    console.log(`   ink to frame, CSS px:  left ${shot.left}  right ${shot.right}  ` +
                `top ${shot.top}  bottom ${shot.bottom}` +
                (min <= 0 ? '   ← CLIPPED, the M is losing its outer stroke' : ''));
    // Under ~200 the filaments start merging into solid strokes; the landscape sits near 370.
    console.log(`   glyph the sim had: ${shot.inkBackingH} backing px` +
                (shot.inkBackingH < 200 ? '   ← thin, the mycelium will read as a font' : '') +
                `  ·  word box ${shot.wordBoxCSS}px, chapter line ${shot.soonPx}px ` +
                `(${(shot.wordBoxCSS / shot.soonPx).toFixed(1)} : 1)`);
  }
})();
