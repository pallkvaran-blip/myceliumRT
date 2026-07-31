/* Screenshot every authored level IN GAME, twice, for review.
 *
 *     node tests/level-shots.cjs                 # every level in docs/levels
 *     node tests/level-shots.cjs obsidian rust   # only ids containing these
 *
 * This asserts nothing — traced-check.cjs is the check. This exists because the owner
 * reviews maps by LOOKING at them, and up to now the only in-game frames anywhere were
 * traced-check's artifacts: uncommitted, one zoom pair per map, and buried in a test run.
 * At 59 maps that is not a review, it is an archaeology exercise.
 *
 * Two frames per level, and the pair is the point:
 *   wide  — the whole map at a zoom that fits it, for composition
 *   near  — the zoom the game is actually PLAYED at, for the defects that only exist at
 *           that zoom. Every rendering bug this project has had (the white edge ring, the
 *           grey halo, the mush from tracing the 1x image) was invisible in an overview
 *           and obvious here.
 *
 * Written as WebP via Pillow rather than kept as PNG: 118 frames is 60 MB of PNG and about
 * 6 MB of WebP, and these are reference images for judging art, not inputs to a threshold.
 * They are committed, because the review tool inlines them and the next session should not
 * have to regenerate a set that took twenty minutes.
 */
const http = require('http'), fs = require('fs'), path = require('path');
const { execFileSync } = require('child_process');
const { chromium } = require('playwright');

const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, 'docs', 'shots');
const T = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.webp': 'image/webp', '.mp3': 'audio/mpeg', '.wav': 'audio/wav' };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const only = process.argv.slice(2);
const LEVELDIR = path.join(ROOT, 'docs', 'levels');
const LEVELS = fs.readdirSync(LEVELDIR).filter((f) => f.endsWith('.json'))
  .map((f) => JSON.parse(fs.readFileSync(path.join(LEVELDIR, f), 'utf8')))
  .filter((l) => l && l.id)
  .filter((l) => !only.length || only.some((o) => l.id.includes(o)));

// PNG -> WebP in one Pillow call at the end. Spawning python per frame costs more than the
// screenshot does.
function toWebp(files) {
  if (!files.length) return;
  const py = `
import sys
from PIL import Image
for p in sys.argv[1:]:
    im = Image.open(p).convert('RGB')
    im.save(p[:-4] + '.webp', 'WEBP', quality=86, method=4)
`;
  execFileSync('python3', ['-c', py, ...files], { stdio: 'inherit' });
  for (const f of files) fs.unlinkSync(f);
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const srv = await new Promise((res) => {
    const s = http.createServer((rq, rs) => {
      let p = decodeURIComponent(rq.url.split('?')[0].split('#')[0]);
      if (p === '/') p = '/index.html';
      const fp = path.join(ROOT, p);
      if (!fp.startsWith(ROOT) || !fs.existsSync(fp) || fs.statSync(fp).isDirectory()) { rs.writeHead(404); rs.end('nf'); return; }
      rs.writeHead(200, { 'Content-Type': T[path.extname(fp)] || 'application/octet-stream' });
      fs.createReadStream(fp).pipe(rs);
    });
    s.listen(0, () => res(s));
  });
  const base = 'http://localhost:' + srv.address().port;
  const browser = await chromium.launch({ headless: true, executablePath: '/opt/pw-browsers/chromium' });

  const pngs = [];
  let done = 0, failed = [];
  for (const def of LEVELS) {
    const ID = def.id;
    process.stdout.write(`[${++done}/${LEVELS.length}] ${ID} … `);
    // One context per level. Reusing one has leaked state into later cases before, and a
    // level that ends mid-capture puts an overlay over every frame after it.
    // 1600x900 at deviceScaleFactor 2 -> 3200x1800 frames, so the owner can open one and
    // actually zoom into an edge. DSF 2 timed out on the first attempt, but that was before
    // the screenshot call had an explicit timeout and `animations: 'disabled'`; with those it
    // is fine. CLAUDE.md records 4 as an OOM, so 2 is the ceiling worth using.
    const ctx = await browser.newContext({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 2 });
    // An explicitly EMPTY key disables the score backend; a missing one falls back to live.
    await ctx.addInitScript(() => { window.MYCELIUM_SUPABASE = { url: '', anonKey: '' }; });
    const page = await ctx.newPage();
    try {
      await page.goto(base + '/index.html#level,' + ID, { waitUntil: 'domcontentloaded' });
      // The boot loading screen ends on "Click" — that tap is also the user gesture browsers
      // demand before audio may start, so it is not skippable.
      await page.waitForSelector('#loadscreen.ld-ready', { timeout: 60000 }).catch(() => {});
      await page.click('#loadscreen', { timeout: 5000 }).catch(() => {});
      await page.waitForFunction(() => window.__game && window.__game.state && window.__game.state.active, null, { timeout: 30000 });
      // The mask waits on every sprite decoding; screenshotting before it lands catches a
      // half-drawn map.
      await page.waitForFunction(() => window.__game.state.substrate._rockSolidified === true, null, { timeout: 90000 });
      await page.waitForSelector('#levelIntro', { timeout: 8000 }).catch(() => {});
      for (let i = 0; i < 6 && await page.$('#levelIntro'); i++) { await page.mouse.click(900, 300); await sleep(500); }

      const shoot = async (name, x, y, zoom) => {
        await page.evaluate(({ x, y, zoom }) => {
          const cam = window.__game.camera; cam.zoom = zoom; cam.x = x; cam.y = y; cam.clamp();
        }, { x, y, zoom });
        await sleep(600);
        const p = path.join(OUT, `${ID}-${name}.png`);
        await page.screenshot({ path: p, timeout: 60000, animations: 'disabled' });
        pngs.push(p);
      };
      const W = def.world.width, surf = def.world.surfaceY;
      const H = (def.world.height || 1500) - surf;
      // Fit the whole underground box in the 1400x800 viewport, with a little margin.
      await shoot('wide', W / 2, surf + H / 2, Math.min(1600 / W, 900 / H) * 0.92);
      // Play zoom, a third of the way in — far enough past the entry channel to be looking
      // at traced rock rather than at the dug-clear lane.
      await shoot('near', W * 0.33, surf + H * 0.45, 2.2);
      console.log('ok');
    } catch (e) {
      console.log('FAILED — ' + String(e.message || e).split('\n')[0]);
      failed.push(ID);
    }
    await ctx.close();
  }
  await browser.close(); srv.close();

  toWebp(pngs);
  console.log(`\n${LEVELS.length - failed.length}/${LEVELS.length} shot -> docs/shots/`);
  if (failed.length) console.log('failed: ' + failed.join(', '));
  process.exit(failed.length ? 1 : 0);
})();
