#!/usr/bin/env node
/* THE DAILY END SCREEN'S FIT, with the local board and with a global board answering five rows (M13 verify 2).
 * A TOOL: prints, never fails, not in the runner. For each viewport it plays a paid daily (a touch context,
 * so the coarse-pointer 44 px buttons are in), gives the run three deep materials so the rows are at their
 * fullest, ends it, and prints the end screen's scrollHeight against the viewport and where Practice
 * (#ssMineDescend) and Store (#ssMineDone) land. `node tests/dailyend-probe.cjs [local|global|both]`.
 * Measured on the first verify build (global, five rows stacked): 640x360 467/360, 844x390 473/390,
 * 360x640 734/640, buttons below the fold on all three.
 */
const H = require('./mine-harness.cjs');
const { sleep } = H;
const which = process.argv[2] || 'both';
const D25 = Date.UTC(2026, 8, 25, 12, 0, 0);
const LANDED = { runsDone: 4, mineRuns: 4, mineBest: 40, migratedMineShelfV2: true, mineStoreVisits: 3,
  mineJourney: { journey: 1, leg: 2, legs: { 1: { runs: 2, bestDepth: 30, bestEast: 96, landed: true } } }, mineSeen: { leg: 2, line42: true } };
const SIZES = [[640, 360], [844, 390], [360, 640], [320, 568], [390, 844], [1280, 720]];
(async () => {
  const E = await H.start();
  for (const board of which === 'both' ? ['local', 'global'] : [which]) {
    for (const [w, h] of SIZES) {
      const ctx = await E.browser.newContext({ viewport: { width: w, height: h }, hasTouch: true, isMobile: true });
      if (board === 'global') await ctx.route('https://board.test/**', (rt) => {
        const u = rt.request().url(), m = rt.request().method();
        if (m === 'POST') return rt.fulfill({ status: 201, body: '' });
        if (u.includes('/rest/v1/mine_daily') || u.includes('/rest/v1/scores')) return rt.fulfill({ status: 200, contentType: 'application/json',
          body: JSON.stringify(['Pal', 'Ana', 'Bo', 'Cy', 'Dee'].map((n, i) => ({ name: n, level: 120 - i * 9, created_at: '2026-09-25T10:00:00Z' }))) });
        return rt.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
      });
      const b = await E.boot('', w, h, { ctx, supabase: board === 'global' ? { url: 'https://board.test', anonKey: 'k' } : null, before: async (page) => {
        await page.addInitScript((t) => { const real = Date.now.bind(Date), t0 = real(); Date.now = () => t + (real() - t0); }, D25);
        await page.addInitScript((sv) => { try { if (!localStorage.getItem('mycelium.progress.v2')) localStorage.setItem('mycelium.progress.v2', JSON.stringify(sv)); } catch (_) {} }, LANDED);
      } });
      const p = b.page;
      await p.waitForSelector('#tsDaily', { timeout: 20000 }).catch(() => {});
      await sleep(2200);
      await p.click('#tsDaily').catch(() => {});
      await p.waitForFunction(() => { const s = window.__game && window.__game.state; return s && s.config.mine.daily && s.substrate._rockSolidified && (s._mineFrameN | 0) > 2; }, null, { timeout: 40000 }).catch(() => {});
      await H.injectNav(p);
      await p.evaluate(async () => { await window.__digTo(14, 120); const s = window.__game.state;
        s.mineMats = Object.assign({}, s.mineMats || {}, { anthracite: 3, garnet: 2, hematite: 1 }); s.nematodes.length = 0; window.__game.mine.end(); });
      await p.waitForSelector('#ssMineEnd', { timeout: 30000 }).catch(() => {});
      await sleep(2500);
      const m = await p.evaluate(() => {
        const root = document.getElementById('ssMineEnd'); const sc = root && (root.querySelector('.ss-mineend') || root);
        const r = (id) => { const e = document.getElementById(id); if (!e) return null; const q = e.getBoundingClientRect(); return [Math.round(q.top), Math.round(q.bottom), Math.round(q.height)]; };
        const bd = document.getElementById('ssDailyBoard');
        return { sh: sc ? sc.scrollHeight : null, ch: sc ? sc.clientHeight : null, practice: r('ssMineDescend'), store: r('ssMineDone'), copy: r('ssDailyCopy'),
                 board: bd && bd.dataset.board, boardText: bd && bd.innerText.replace(/\s+/g, ' ').slice(0, 80), tag: (document.getElementById('ssDailyTag') || {}).textContent };
      });
      const fits = m.practice && m.store && m.practice[1] <= h && m.store[1] <= h;
      console.log(`${board.padEnd(6)} ${w}x${h}: scroll ${m.sh}/${h}  practice ${JSON.stringify(m.practice)} store ${JSON.stringify(m.store)} copy ${JSON.stringify(m.copy)}  ${fits ? 'FITS' : 'OFF'}  [${m.board}] ${m.boardText}`);
      if (w === 640 || w === 360) await p.screenshot({ path: require('path').join(H.ROOT, 'tests', '.artifacts', `m13-dailyend-${board}-${w}x${h}.png`), animations: 'disabled', timeout: 8000 }).catch(() => {});
      await ctx.close();
    }
  }
  await E.close();
})();
