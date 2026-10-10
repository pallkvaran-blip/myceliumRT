/* M14-SHOT — the screens the M14 numbers change, at 390x844 (a tool: writes frames, never fails).
 *
 *   NODE_PATH=/opt/node22/lib/node_modules node tests/m14-shot.cjs
 *
 * tests/.artifacts/m14-store-<k>-390.png  the mine store with every track revealed and a journey-7 save
 *                                         (the v5 prices, the heat tile's '20 m deeper', Water '15 more'),
 *                                         scrolled in screen-high steps
 * tests/.artifacts/m14-leg7-banner-390.png  leg 7's banner ('Twice the worms from 42 to 126 m')
 * tests/.artifacts/m14-leg1-390.png         leg 1's opening frame (E 3, the knot at 18 m)
 */
const path = require('path'), fs = require('fs');
const H = require('./mine-harness.cjs');
const ART = path.join(H.ROOT, 'tests', '.artifacts');
fs.mkdirSync(ART, { recursive: true });
(async () => {
  const E = await H.start();
  try {
    const b = await E.bootMine(4242);
    await b.page.evaluate(() => {
      const S = window.__game.store; S.revealAll();
      const p = JSON.parse(localStorage.getItem('mycelium.progress.v2') || '{}');
      p.mineJourney = { journey: 1, leg: 7, legs: { 1: { runs: 1, landed: true }, 2: { runs: 4, landed: true }, 3: { runs: 5, landed: true },
        4: { runs: 1, landed: true }, 5: { runs: 3, landed: true }, 6: { runs: 4, landed: true } } };
      p.mineSeen = Object.assign(p.mineSeen || {}, { leg: 7, mat_anthracite: true, mat_garnet: true, mat_hematite: true });
      p.mineStoreVisits = 9; p.minerals = 140; p.mats = { anthracite: 30, garnet: 20, hematite: 4 };
      p.mineUpgrades = { water: 5, growSteps: 2, heatTolerance: 2, excreteCharges: 2, amputateCharges: 2, compassIsland: 1 };
      localStorage.setItem('mycelium.progress.v2', JSON.stringify(p));
      for (const e of document.querySelectorAll('#speciesSelect')) e.remove(); window.__menu.showPicker();
    });
    await b.page.waitForSelector('#speciesSelect.ss-mine', { timeout: 20000 }).catch(() => {});
    await H.sleep(900);
    const H0 = await b.page.evaluate(() => { const el = document.querySelector('#speciesSelect'); return el ? el.scrollHeight : 0; });
    for (let k = 0, y = 0; k < 6 && y < H0; k++, y += 760) {
      await b.page.evaluate((y) => { const el = document.querySelector('#speciesSelect'); if (el) el.scrollTop = y; }, y);
      await H.sleep(250);
      await b.page.screenshot({ path: path.join(ART, `m14-store-${k}-390.png`), timeout: 15000, animations: 'disabled' }).catch(() => {});
    }
    const tiles = await b.page.evaluate(() => Array.from(document.querySelectorAll('#ssUpg .ss-upg')).map((t) => t.textContent.replace(/\s+/g, ' ').trim().slice(0, 140)));
    console.log(tiles.join('\n'));
    await b.ctx.close();
    const c = await E.bootMine(4242);
    // A save that has banked runs (the banner stands down on a save's very first descent).
    await c.page.evaluate(() => { const p = JSON.parse(localStorage.getItem('mycelium.progress.v2') || '{}');
      p.mineRuns = 20; p.mineBest = 120; p.runsFinished = 20; localStorage.setItem('mycelium.progress.v2', JSON.stringify(p)); window.__game.mine.playLeg(1, 7); });
    await c.page.waitForFunction(() => { const g = window.__game, s = g && g.state; return s && s.substrate && s.substrate.mine && (s._mineFrameN | 0) > 3; }, { timeout: 30000 }).catch(() => {});
    await H.sleep(500);
    await c.page.screenshot({ path: path.join(ART, 'm14-leg7-banner-390.png'), timeout: 15000, animations: 'disabled' }).catch(() => {});
    console.log('leg 7 banner:', await c.page.evaluate(() => { const e = document.querySelector('#mineBeat'); return e ? e.textContent.replace(/\s+/g, ' ').trim() : null; }));
    await c.page.evaluate(() => window.__game.mine.playLeg(1, 1));
    await c.page.waitForFunction(() => { const g = window.__game, s = g && g.state; return s && s.substrate && s.substrate.mine && (s._mineFrameN | 0) > 3; }, { timeout: 30000 }).catch(() => {});
    await H.sleep(1500);
    await c.page.screenshot({ path: path.join(ART, 'm14-leg1-390.png'), timeout: 15000, animations: 'disabled' }).catch(() => {});
    await c.ctx.close();
  } finally { await E.close(); }
})();
