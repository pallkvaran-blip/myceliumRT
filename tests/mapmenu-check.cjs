/* The "Dev: maps ▾" panel — what it lists, in what order, under what headings.
 *
 *   node tests/mapmenu-check.cjs
 *
 * The panel is how the owner reaches 75 authored maps, so its ORDER and its HEADINGS are the whole
 * feature. Two defects it is here to keep fixed, both of which only ever showed up in a rendered
 * frame:
 *
 *  - THE CAMPAIGN GROUP LOST MAPS TO THE OWNER'S OWN DRAFTS. `allLevels()` merges localStorage saves
 *    over the committed list and a saved id REPLACES the committed entry — while Save as… always
 *    writes `campaignLevel: null`. So a draft of a campaign map removed that slot's claimant from the
 *    list, and the panel read "Campaign · 7 levels" for an owner holding drafts of three of them.
 *    (Play was never affected: `levelForNumber` scans LEVELS, the committed array.) A saved draft
 *    that shadows a committed map now inherits its slot. The MYC_DRAFTS block below reproduces that
 *    state exactly, and it is the assertion that matters most here.
 *  - HEADINGS DUPLICATED AND HEADINGS WITH NO LETTER IN THEM. A heading is emitted whenever the group
 *    changes from the previous row, so a theme split across the file order got two of them; and the
 *    fallback heading is the first word of the name, which for a "<slot> — <Theme>" map that had lost
 *    its slot was the bare number.
 */
const http = require('http'), fs = require('fs'), path = require('path');
const { chromium } = require('playwright');
const ROOT = path.resolve(__dirname, '..');
const T = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.webp': 'image/webp', '.mp3': 'audio/mpeg', '.wav': 'audio/wav' };
let pass = 0, fail = 0;
const ok = (n, c, x) => { c ? (pass++, console.log('  PASS  ' + n + (x ? '  — ' + x : ''))) : (fail++, console.log('  FAIL  ' + n + (x ? '  — ' + x : ''))); };

// Drafts of three campaign maps, written the way Save as… writes them: same ids as the committed
// files, and `campaignLevel: null`.
//
// DERIVED FROM DISK, not typed out. The first version hard-coded ids and names, and both went
// stale the moment the owner archived a map and the seven behind it moved up a slot: it was
// shadowing a level that is no longer in the campaign, under a name a slot out of date, and the
// slot-order assertion failed on a build that was correct. The point of the fixture is "a draft
// shadows a COMMITTED CAMPAIGN MAP", so it should ask disk which those are.
const DRAFTS = fs.readdirSync(path.join(ROOT, 'docs', 'levels'))
  .filter((f) => f.endsWith('.json'))
  .map((f) => { try { return JSON.parse(fs.readFileSync(path.join(ROOT, 'docs', 'levels', f), 'utf8')); } catch (_) { return null; } })
  .filter((d) => d && d.campaignLevel != null)
  .sort((a, b) => a.campaignLevel - b.campaignLevel)
  .slice(0, 3)
  .map((d) => [d.id, d.name, d.assetsFrom || d.id]);

(async () => {
  const srv = await new Promise((res) => { const s = http.createServer((rq, rs) => { let p = decodeURIComponent(rq.url.split('?')[0].split('#')[0]); if (p === '/') p = '/index.html'; const fp = path.join(ROOT, p); if (!fp.startsWith(ROOT) || !fs.existsSync(fp) || fs.statSync(fp).isDirectory()) { rs.writeHead(404); rs.end('nf'); return; } rs.writeHead(200, { 'Content-Type': T[path.extname(fp)] || 'application/octet-stream' }); fs.createReadStream(fp).pipe(rs); }); s.listen(0, () => res(s)); });
  const base = 'http://localhost:' + srv.address().port;
  const browser = await chromium.launch({ headless: true });

  const read = async (withDrafts) => {
    const page = await browser.newPage({ viewport: { width: 1500, height: 1000 } });
    const errs = [];
    page.on('pageerror', (e) => errs.push(String(e && e.message)));
    // This check clicks "Dev: maps", which is off by default now — see CONFIG.dev.inGameButtons.
    await page.addInitScript(() => { window.MYCELIUM_SUPABASE = { url: '', anonKey: '' }; window.MYCELIUM_DEV_BUTTONS = true; });
    if (withDrafts) {
      await page.addInitScript((drafts) => {
        localStorage.setItem('mycelium.savedLevels.v1', JSON.stringify(drafts.map(([id, name, af]) => ({
          format: 'mycelium-level', version: 1, id, name, chapter: 'Chapter 1', assetsFrom: af,
          campaignLevel: null,
          world: { width: 2952, height: 1467, surfaceY: 380, cellSize: 36 },
          layout: { startCols: 2, goalCols: 6, summerCols: 7, clearChannels: false },
          threats: { trych: 0, nematodes: 0, ants: 0, respawn: false }, objects: [] }))));
      }, DRAFTS);
    }
    await page.goto(base + '/index.html#dev,turn', { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('#loadscreen.ld-ready', { timeout: 60000 }).catch(() => {});
    await page.click('#loadscreen', { timeout: 5000 }).catch(() => {});
    await page.waitForFunction(() => window.__game && window.__game.state && window.__game.state.active, null, { timeout: 40000 });
    await page.waitForSelector('#devMapBtn', { timeout: 20000 });
    await page.click('#devMapBtn');
    await page.waitForTimeout(400);
    const out = await page.evaluate(() => {
      const pn = document.getElementById('devMapPanel');
      const rows = [...pn.children].map((n) => ({ g: n.className === 'dm-g', t: n.textContent.replace(/×$/, '').trim(), id: (n.title || '').replace('#level,', '') }));
      const groups = [];
      for (const r of rows) { if (r.g) groups.push({ name: r.t, items: [] }); else if (groups.length) groups[groups.length - 1].items.push(r); }
      return { groups, total: rows.filter((r) => !r.g).length, levels: window.__game.campaign.levels };
    });
    await page.close();
    return { ...out, errs };
  };

  for (const withDrafts of [false, true]) {
    const label = withDrafts ? "with the owner's drafts shadowing 3 campaign maps" : 'clean profile';
    console.log(`\n  ── ${label} ──`);
    const r = await read(withDrafts);
    const first = r.groups[0] || { name: '', items: [] };

    ok(`${label}: the panel lists the maps`, r.total > 20, `${r.total} map buttons, ${r.groups.length} headings`);
    ok(`${label}: the FIRST group is the campaign`, /^Campaign/.test(first.name), first.name);
    // THE ONE THAT MATTERS: every slot is represented, drafts or no drafts.
    ok(`${label}: it holds every campaign level`, first.items.length === r.levels,
      `${first.items.length} of ${r.levels}`);
    const slots = first.items.map((i) => parseInt(i.t, 10));
    ok(`${label}: ...in slot order`, slots.every((n, i) => n === i + 1),
      first.items.map((i) => i.t).join(' · '));
    // ...and only the campaign is in it, which is the other half of the owner's ask.
    const rest = r.groups.slice(1).flatMap((g) => g.items.map((i) => i.id));
    const firstIds = new Set(first.items.map((i) => i.id));
    ok(`${label}: no map is listed twice`, rest.every((id) => !firstIds.has(id)),
      rest.filter((id) => firstIds.has(id)).join(', ') || 'none duplicated');
    // Headings: one per theme, and each one a word.
    const names = r.groups.map((g) => g.name);
    const dupes = names.filter((n, i) => names.indexOf(n) !== i);
    ok(`${label}: no heading appears twice`, dupes.length === 0, dupes.join(', ') || 'all distinct');
    const numeric = names.filter((n) => !/[A-Za-z]/.test(n));
    ok(`${label}: no heading is a bare number`, numeric.length === 0, numeric.map((n) => JSON.stringify(n)).join(', ') || 'none');
    ok(`${label}: no page errors`, r.errs.length === 0, r.errs.slice(0, 2).join(' | ') || 'none');
  }

  await browser.close();
  srv.close();
  console.log(`\n==== ${pass} passed, ${fail} failed ====`);   // the runner parses THIS form
  process.exit(fail ? 1 : 0);
})();
