// Play ONE descent with the "sensible player" bot and return a record. Used by run1.cjs and career.cjs.
const { OUT, sleep } = require('./lib.cjs');

// THE ITEMS, PLAYED THROUGH THE UI (M6 verify round 3; `opts.uiItems`). The in-page bot's
// `useItems` is omniscient — a flask the instant a worm attaches, a dose at the densest rot from the
// full node list, through hooks — so acceptance 7 measured an upper bound. This plays them as a player
// would: a flask (a real click on the kit) only after an attached worm has been on for `reactMs`; a
// dose only after `reactMs` of rot, and only on rot that is ON SCREEN below the HUD — if there is
// none, a real click on the rot banner (which pans to it) and try again on a later step; then a real
// click on the kit to arm and a real click on the middle of the visible rot.
async function uiItems(page, ui, reactMs) {
  const v = await page.evaluate(() => {
    const g = window.__game, s = g.state;
    if (s.runOver || !s.active) return null;
    const cv = document.getElementById('game').getBoundingClientRect();
    let top = 0;
    for (const sel of ['.minerows', '#hud-infect', '#minehint']) {
      const e = document.querySelector(sel); if (!e || e.hidden) continue;
      const r = e.getBoundingClientRect(); if (r.height > 0) top = Math.max(top, r.bottom);
    }
    const kit = document.getElementById('kit-amputate');
    const bot = kit ? kit.getBoundingClientRect().top - 8 : cv.bottom;
    const vis = [];
    for (const n of s.active.nodes) {
      if (!n.infected) continue;
      const p = g.camera.worldToScreen(n.x, n.y), x = cv.left + p.x, y = cv.top + p.y;
      if (x > cv.left + 8 && x < cv.right - 8 && y > top + 8 && y < bot) vis.push({ x, y });
    }
    return { attached: g.mine.attached(), infect: !!s.mineInfect, items: g.mine.items(), vis, armed: g.mine.armed() };
  });
  if (!v) return [];
  const acts = [], now = Date.now();
  ui.attSince = v.attached > 0 ? (ui.attSince || now) : 0;
  if (v.attached > 0 && v.items.excrete > 0 && now - ui.attSince >= reactMs) {
    await page.click('#kit-excrete').catch(() => {});
    acts.push('excrete(ui)'); ui.attSince = 0;
  }
  ui.rotSince = v.infect ? (ui.rotSince || now) : 0;
  if (v.infect && v.items.amputate > 0 && now - ui.rotSince >= reactMs) {
    if (!v.vis.length) {
      await page.click('#hud-infect').catch(() => {});      // the banner pans to the rot
      acts.push('rot-banner(ui)');
    } else {
      let cx = 0, cy = 0; for (const q of v.vis) { cx += q.x; cy += q.y; } cx /= v.vis.length; cy /= v.vis.length;
      let best = v.vis[0], bd = Infinity;
      for (const q of v.vis) { const d = (q.x - cx) ** 2 + (q.y - cy) ** 2; if (d < bd) { bd = d; best = q; } }
      if (v.armed !== 'amputate') { await page.click('#kit-amputate').catch(() => {}); await sleep(120); }
      await page.mouse.click(best.x, best.y);
      await sleep(150);
      const r = await page.evaluate(() => ({ items: window.__game.mine.items(), rot: window.__game.state.active.nodes.filter((n) => n.infected).length }));
      acts.push(`amputate(ui) ${v.vis.length} visible, ${r.rot} rotten left, ${r.items.amputate} doses`);
      if (r.items.amputate === v.items.amputate) ui.rotSince = now;   // missed: react again later
    }
  }
  return acts;
}

async function playDescent(page, opts = {}) {
  const label = opts.label || 'run';
  const paceMs = opts.paceMs || 900;
  const t0 = Date.now();
  const steps = [];
  let digs = 0, refusals = 0, boxedAt = null, consecutiveFail = 0, minW = Infinity, maxDepth = 0;
  const start = await page.evaluate(() => window.__qa.snapshot());
  let shot = 0;
  const ui = {};
  for (let i = 0; i < (opts.maxSteps || 400); i++) {
    const stepAt = Date.now();
    const uiActs = opts.uiItems ? await uiItems(page, ui, opts.reactMs || 1500) : [];
    const r = await page.evaluate((o) => { const a = window.__qa.step(o); a.snap = window.__qa.snapshot(); return a; },
                                  opts.uiItems ? Object.assign({}, opts.bot || {}, { useItems: false }) : (opts.bot || {}));
    if (uiActs.length) r.acts = uiActs.map((a) => [a]).concat(r.acts || []);
    if (r.over) break;
    steps.push({ i, t: Math.round((Date.now() - t0) / 100) / 10, mode: r.mode, kind: r.kind, mat: r.mat, ok: r.ok, msg: r.msg, acts: r.acts,
      w: r.snap.water, d: r.snap.depth, cost: r.snap.cost, att: r.snap.attached, worms: r.snap.worms, inf: r.snap.infect.on ? +r.snap.infect.left.toFixed(1) : null,
      frontier: r.frontier, goalM: r.goalM, why: r.why });
    maxDepth = Math.max(maxDepth, r.snap.depth);
    if (r.ok) { digs++; consecutiveFail = 0; } else if (r.mode) { refusals++; consecutiveFail++; }
    if (r.stuck) {
      boxedAt = boxedAt || { i, t: (Date.now() - t0) / 1000, water: r.snap.water, depth: r.snap.depth, why: r.why, digs };
      // A player who is boxed in sits there. Does anything end the run? Watch for a while.
      if (opts.shots) await page.screenshot({ path: `${OUT}/${label}-boxed.png` });
      break;
    }
    // "Not enough water" from every deep strand while the run is still live: that is the dry-for-the-deep-tips state.
    if (r.ok === false && /Not enough water/.test(r.msg || '') && r.snap.water >= r.snap.cheapest && consecutiveFail > 3) {
      boxedAt = { i, t: (Date.now() - t0) / 1000, water: r.snap.water, depth: r.snap.depth, why: 'dry-for-deep: ' + r.msg, digs };
      if (opts.shots) await page.screenshot({ path: `${OUT}/${label}-drystuck.png` });
      break;
    }
    if (consecutiveFail > 12) { boxedAt = { i, t: (Date.now() - t0) / 1000, water: r.snap.water, depth: r.snap.depth, why: 'repeated refusals: ' + r.msg, digs }; if (opts.shots) await page.screenshot({ path: `${OUT}/${label}-refused.png` }); break; }
    if (opts.shots && i % (opts.shotEvery || 20) === 10) await page.screenshot({ path: `${OUT}/${label}-s${String(++shot).padStart(2, '0')}.png` });
    // `periodic` (M5): one dig every `paceMs` INCLUDING the bot's own planning time (the flood can
    // take a few hundred ms), so '1.7 s a dig' means that and not 1.7 s plus the bot thinking.
    await sleep(opts.periodic ? Math.max(0, paceMs - (Date.now() - stepAt)) : paceMs);
  }
  // If boxed with water, wait to see whether the run ends by itself (worms/infection/nothing).
  let sat = null;
  if (boxedAt) {
    const w0 = await page.evaluate(() => window.__qa.snapshot());
    await sleep(opts.sitMs || 8000);
    const w1 = await page.evaluate(() => window.__qa.snapshot());
    sat = { before: w0, after: w1, endedWhileSitting: w1.over };
    // RECOVERY, as a player who worked it out would: burn the rest on the cheapest (shallowest) strands.
    if (!w1.over) {
      const rec = await page.evaluate(async () => {
        const g = window.__game, s = g.state; const out = [];
        // Up to 40 (was 12): a player who worked it out spends the WHOLE tank, and since the M5 fix a
        // voluntary End descent banks only the raw reach — so the bot's forced End (below) must stay
        // the last resort, not a shortcut past the 5 P floor.
        for (let k = 0; k < 40 && !s.runOver; k++) {
          const ns = s.active.nodes.filter((n) => !n.infected).sort((a, b) => a.y - b.y);
          let done = false;
          for (const n of ns.slice(0, 30)) {
            for (const [dx, dy] of [[200, 30], [-200, 30], [0, 200], [150, 150], [-150, 150]]) {
              const r = g.mine.growFrom(n.x, n.y, n.x + dx, n.y + dy);
              if (r.ok) { out.push('dug@' + Math.round((n.y - s.substrate.surfaceY) / 36) + 'm w=' + s.active.water); done = true; break; }
            }
            if (done) break;
          }
          if (!done) break;
          await new Promise((r) => setTimeout(r, 400));
        }
        await new Promise((r) => setTimeout(r, 2200));
        return { digs: out, over: s.runOver, water: s.active.water };
      });
      sat.recovery = rec;
      if (!rec.over) { await page.evaluate(() => document.getElementById('set-forcefruit').click()); sat.forcedEnd = true; }
    }
  }
  // Wait for the run to end (fuel grace + reveal) if it is ending.
  for (let k = 0; k < 20; k++) { const o = await page.evaluate(() => !!window.__game.state.runOver); if (o) break; await sleep(300); }
  const end = await page.evaluate(() => window.__qa.snapshot());
  await sleep(3500);
  const screen = await page.evaluate(() => {
    const e = document.getElementById('ssMineEnd');
    return e ? e.innerText.replace(/\s+/g, ' ').trim() : null;
  });
  if (opts.shots && screen) await page.screenshot({ path: `${OUT}/${label}-end.png` });
  return { label, seconds: Math.round((Date.now() - t0) / 1000), start, end, digs, refusals, maxDepth, boxedAt, sat, screen,
           seed: await page.evaluate(() => window.__game.mine.seed()), steps };
}
module.exports = { playDescent };
