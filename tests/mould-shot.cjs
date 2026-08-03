/* WHAT THE TWO FADES LOOK LIKE.
 *
 *     node tests/mould-shot.cjs
 *
 * Writes tests/.artifacts/mould-fade-{0..3}.png — a spent cloud fading off the colony it just
 * infected, and the rot falling away behind it. A tool, not a check: mould-check asserts the
 * model (strength runs down, the cloud is dropped, ghosts are stamped and drained), and this is
 * how you see whether it READS as a fade. Both were owner requests phrased visually ("fade away,
 * not just disappear"), so the model passing is not the same as the job being done.
 *
 * Read them as a sequence. Frame 0 is just after the breach (mould at full strength, the limb
 * green), and each later frame is ~600 ms on. By the last the mould should be gone and the rotted
 * strands with it.
 *
 * BOTH FADES ARE SLOWED TO 4 s HERE (fadeMs / render.rotFadeMs) and that is not cheating, it is
 * the only way to see them: at their shipped 700/600 ms the whole thing is over before the first
 * screenshot lands, because a screenshot needs frames and frames are what drive the fade. The
 * first version of this tool captured four identical frames of an empty patch of soil.
 */
const http = require('http'), fs = require('fs'), path = require('path');
const { chromium } = require('playwright');
const ROOT = process.env.MYC_ROOT || '/home/user/myceliumRT';
const OUT = path.join(ROOT, 'tests', '.artifacts');
const T = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.png': 'image/png', '.webp': 'image/webp', '.mp3': 'audio/mpeg', '.wav': 'audio/wav' };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const srv = await new Promise((r) => { const s = http.createServer((rq, rs) => { let p = decodeURIComponent(rq.url.split('?')[0].split('#')[0]); if (p === '/') p = '/index.html'; const fp = path.join(ROOT, p); if (!fs.existsSync(fp) || fs.statSync(fp).isDirectory()) { rs.writeHead(404); rs.end('nf'); return; } rs.writeHead(200, { 'Content-Type': T[path.extname(fp)] || 'application/octet-stream' }); fs.createReadStream(fp).pipe(rs); }); s.listen(0, () => r(s)); });
  const b = await chromium.launch({ headless: true, executablePath: '/opt/pw-browsers/chromium' });
  const ctx = await b.newContext({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 2 });
  await ctx.addInitScript(() => { window.MYCELIUM_SUPABASE = { url: '', anonKey: '' }; });
  const p = await ctx.newPage();
  p.on('pageerror', (e) => console.log('PAGEERROR:', String(e).slice(0, 300)));
  await p.goto('http://localhost:' + srv.address().port + '/index.html#dev,turn', { waitUntil: 'domcontentloaded' });
  await p.waitForSelector('#loadscreen.ld-ready', { timeout: 60000 }).catch(() => {});
  await p.click('#loadscreen', { timeout: 5000 }).catch(() => {});
  await p.waitForFunction(() => window.__game && window.__game.state && window.__game.state.active, null, { timeout: 60000 }).catch(() => {});
  for (let i = 0; i < 6 && await p.$('#levelIntro'); i++) { await p.mouse.click(1100, 300); await sleep(300); }

  const setup = await p.evaluate(() => {
    const G = window.__game, s = G.state, sub = s.substrate, net = s.active, cs = sub.cellSize;
    const t = s.config.trichoderma;
    s.nematodes.length = 0; s.clouds.length = 0; if (s.ants) s.ants.length = 0;
    s.runOver = false; s.winPending = false;
    for (const c of sub.cells) { c.trich = 0; c.mouldProof = 0; c.reinfectGrace = 0; }
    net.energy = 5000; net.water = 999; net.phosphorus = 999;
    t.moveSpeed = 0; t.respawnChance = 0;
    t.fadeMs = 4000; s.config.render.rotFadeMs = 4000;   // see the header — slowed so a shot can catch them
    // A fan of filaments so the disc breach has several to take, at a comfortable zoom.
    net.nodes.length = 0; net.byId.clear(); net.nextNodeId = 0; net._rotGhosts = [];
    const hub = { x: sub.worldWidth / 2, y: sub.surfaceY + cs * 5 };
    for (let a = 0; a < 9; a++) {
      const ang = -Math.PI / 2 + (a - 4) * 0.26;
      let par = null;
      for (let i = 1; i <= 22; i++) {
        const n = net.addNode(hub.x + Math.cos(ang) * i * 9, hub.y + Math.sin(ang) * i * 9 + 60, par);
        n._liveAt = 0; n._revSeen = true; par = n;
      }
    }
    net.alive = true; net.recomputeVitality();
    G.camera.zoom = 2.2;
    G.camera.x = hub.x; G.camera.y = hub.y;
    // Breach the middle of the fan — ON an actual strand, read off the network rather than
    // recomputed from the fan's parameters (the first version put the cloud below every arm and
    // the whole sequence showed a breach that never happened: `rotten: 0`).
    const mid = net.nodes[Math.floor(net.nodes.length / 2)];
    s.clouds.push({ cx: mid.x, cy: mid.y, r: 1.3, strength: 1, dying: false, heading: null });
    G.camera.x = mid.x; G.camera.y = mid.y;
    G.tickWorld(s);                     // contact: the disc rots, the cloud is spent
    const green = net.nodes.filter((n) => n.infected).length;
    G.tickWorld(s);                     // one more step so some of that rot reaches its deadline
    return { greenAfterBreach: green, rotten: net.nodes.filter((n) => n.infected).length, nodes: net.nodes.length,
             ghosts: (net._rotGhosts || []).length, clouds: s.clouds.length,
             spent: s.clouds[0] ? !!s.clouds[0].spent : null, at: { x: Math.round(mid.x), y: Math.round(mid.y) } };
  });
  console.log('setup: ' + JSON.stringify(setup));

  for (let i = 0; i < 4; i++) {
    // animations:'disabled' + an explicit timeout + .catch: Playwright's default screenshot waits
    // for animations to settle, and against a live rAF loop that wait has no end.
    await p.screenshot({ path: path.join(OUT, `mould-fade-${i}.png`), timeout: 8000, animations: 'disabled' })
      .catch((e) => console.log('  shot ' + i + ' failed: ' + String(e).slice(0, 120)));
    const st = await p.evaluate(() => ({
      clouds: window.__game.state.clouds.length,
      strength: window.__game.state.clouds[0] ? +window.__game.state.clouds[0].strength.toFixed(2) : null,
      ghosts: (window.__game.state.active._rotGhosts || []).length,
      trich: +window.__game.state.substrate.cells.reduce((a, c) => a + c.trich, 0).toFixed(1),
    }));
    console.log(`  frame ${i}: ${JSON.stringify(st)}`);
    if (i < 3) await sleep(600);
  }
  console.log('\nwrote ' + OUT + '/mould-fade-0..3.png');
  await b.close(); srv.close();
})();
