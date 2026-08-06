/* THE CARD TOOL (docs/card-tool.html) AND ITS APPLY SCRIPT.
 *
 * The page is GENERATED from index.html, so the failure that matters is not "does it render" but
 * "does it still describe the game". Three things it guards, each of which has a specific way of
 * going quietly wrong:
 *
 *  · THE ACTIVE LIST IS THE GAME'S. The generator cannot run the cards module, so it reconstructs
 *    `!archived && EFFECTS[name]` from three text shapes (the EFFECTS literal's keys, the
 *    `EFFECTS['X'] =` assignments, the DRAW_ENGINES loop). A fourth shape would drop cards from
 *    the page with nothing to notice it by. This boots the real game and compares against
 *    `__game.cards.active()`.
 *
 *  · THE COSTS AND TEXT ON THE PAGE ARE THE ONES IN CARD_DATA. A stale page is the whole failure
 *    mode of a generated tool — it looks right and describes last week.
 *
 *  · THE REAL-TIME PREVIEW MATCHES `timeify`. The preview exists to be trusted while writing, so
 *    a copy that drifts from the game's own rewrite is worse than none. Both are run over the
 *    same strings, including the ones the game actually ships.
 *
 * And the round trip, which is the point of the pair: edit -> export -> apply -> index.html says
 * it, with a verified refusal on input that should never be written.
 */
const http = require('http'), fs = require('fs'), path = require('path');
const { execFileSync } = require('child_process');
const { chromium } = require('playwright');
const ROOT = path.resolve(__dirname, '..');
const T = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.png': 'image/png',
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.svg': 'image/svg+xml', '.webp': 'image/webp',
  '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.css': 'text/css' };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let pass = 0, fail = 0;
const ok = (n, c, x) => { c ? (pass++, console.log('  PASS  ' + n + (x ? '  — ' + x : ''))) : (fail++, console.log('  FAIL  ' + n + (x ? '  — ' + x : ''))); };
const node = (args) => execFileSync(process.execPath, args, { cwd: ROOT, encoding: 'utf8',
  env: { ...process.env, NODE_PATH: process.env.NODE_PATH || '/opt/node22/lib/node_modules' } });

(async () => {
  const TOOL = path.join(ROOT, 'docs', 'card-tool.html');
  if (!fs.existsSync(TOOL)) { console.log('  FAIL  docs/card-tool.html is missing — run node scripts/gen-card-tool.mjs'); fail++; }

  const srv = await new Promise((res) => { const s = http.createServer((rq, rs) => {
    let p = decodeURIComponent(rq.url.split('?')[0].split('#')[0]); if (p === '/') p = '/index.html';
    const fp = path.join(ROOT, p);
    if (!fp.startsWith(ROOT) || !fs.existsSync(fp) || fs.statSync(fp).isDirectory()) { rs.writeHead(404); rs.end('nf'); return; }
    rs.writeHead(200, { 'Content-Type': T[path.extname(fp)] || 'application/octet-stream' });
    fs.createReadStream(fp).pipe(rs); }); s.listen(0, () => res(s)); });
  const base = 'http://localhost:' + srv.address().port;
  const browser = await chromium.launch({ headless: true, executablePath: '/opt/pw-browsers/chromium' });

  // ---- 1. the page, driven like a mouse ---------------------------------------
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  const errs = []; page.on('pageerror', (e) => errs.push(String(e && e.message)));
  page.on('console', (m) => { if (m.type() === 'error' && !/404/.test(m.text())) errs.push('console:' + m.text()); });
  await page.goto(base + '/docs/card-tool.html', { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.card', { timeout: 15000 });

  const shown = await page.evaluate(() => window.__cardTool.data.cards.map((c) => c.name));
  const rows = await page.evaluate(() => document.querySelectorAll('.card').length);
  ok('every active card gets a row', rows === shown.length && rows > 40, `${rows} rows`);

  // ---- 2. ...and that list IS the game's --------------------------------------
  // The one assertion the generator cannot make about itself.
  const gpage = await (await browser.newContext({ viewport: { width: 1200, height: 800 } })).newPage();
  await gpage.addInitScript(() => { window.MYCELIUM_SUPABASE = { url: '', anonKey: '' }; });
  await gpage.goto(base + '/index.html#dev', { waitUntil: 'domcontentloaded' });
  await gpage.waitForSelector('#loadscreen.ld-ready', { timeout: 25000 }).catch(() => {});
  await gpage.click('#loadscreen', { timeout: 5000 }).catch(() => {});
  await gpage.waitForFunction(() => !!(window.__game && window.__game.cards), { timeout: 25000 });
  const live = await gpage.evaluate(() => ({
    active: window.__game.cards.active(), archived: window.__game.cards.archived(),
    data: window.__game.cards.data(),
  }));
  const missing = live.active.filter((n) => shown.indexOf(n) < 0);
  const extra = shown.filter((n) => live.active.indexOf(n) < 0);
  ok('the page lists exactly the cards the game calls active',
     missing.length === 0 && extra.length === 0,
     missing.length || extra.length ? `missing ${JSON.stringify(missing)} extra ${JSON.stringify(extra)}` : `${live.active.length} cards`);
  // A coverage floor, so "lists nothing" cannot satisfy the equality above.
  ok('...and there are enough of them for that to mean something', live.active.length >= 40, `${live.active.length} active`);
  const pageArch = await page.evaluate(() => window.__cardTool.data.archived);
  ok('archived cards are named but not editable', pageArch.length === live.archived.length
     && pageArch.every((n) => live.archived.indexOf(n) >= 0)
     && pageArch.every((n) => shown.indexOf(n) < 0), `${pageArch.length} archived`);

  // ---- 3. the page is not stale -----------------------------------------------
  const liveBy = new Map(live.data.map((c) => [c.name, c]));
  const pageCards = await page.evaluate(() => window.__cardTool.data.cards);
  const drift = [];
  for (const c of pageCards) {
    const g = liveBy.get(c.name);
    if (!g) { drift.push(c.name + ' (not in CARD_DATA)'); continue; }
    for (const f of ['buyCostEnergy', 'buyP', 'costW', 'costP', 'startCopies'])
      if ((g[f] | 0) !== c[f]) drift.push(`${c.name}.${f} page ${c[f]} vs game ${g[f]}`);
    if ((g.effect || '') !== c.effect) drift.push(`${c.name}.effect differs`);
    if ((g.produces || '') !== c.produces) drift.push(`${c.name}.produces differs`);
  }
  ok('every cost and every line of text on the page is the one in CARD_DATA',
     drift.length === 0, drift.length ? drift.slice(0, 3).join(' | ') : `${pageCards.length} cards checked`);

  // The knob values, likewise — these are the numbers a description edit is really about.
  const knobDrift = await gpage.evaluate((cfg) => {
    const live = window.__cfg.cards, out = [];
    for (const k of Object.keys(cfg)) if (live[k] !== cfg[k]) out.push(k + ' page ' + cfg[k] + ' vs game ' + live[k]);
    return out;
  }, await page.evaluate(() => window.__cardTool.data.config));
  ok('...and so is every CONFIG.cards knob it shows', knobDrift.length === 0,
     knobDrift.length ? knobDrift.slice(0, 3).join(' | ') : 'all knobs match');

  // Cards that read a knob: the feature that answers "what does this description depend on?".
  const withKnobs = pageCards.filter((c) => c.knobs.length).length;
  ok('the cards whose effect reads a knob say which one', withKnobs >= 15,
     `${withKnobs} of ${pageCards.length} carry at least one knob`);
  const badKnob = await page.evaluate(() => {
    const d = window.__cardTool.data;
    return d.cards.flatMap((c) => c.knobs.filter((k) => !(k in d.config))).slice(0, 3);
  });
  ok('...and every knob named exists in CONFIG.cards', badKnob.length === 0, badKnob.join(', ') || 'all resolve');

  // ---- 4. the real-time preview matches the game's own rewrite ----------------
  // Over the SHIPPED strings, not invented ones — the preview only has to be right about the text
  // that exists, and a hand-picked sample can miss the phrasing one card happens to use.
  const strings = live.data.map((c) => c.effect).filter(Boolean)
    .concat(live.data.map((c) => c.produces).filter(Boolean))
    .concat(['every 6 rounds', 'for 12 rounds', '+2 energy/round', 'once per round', 'every 4 turns', '1 round']);
  const mine = await page.evaluate((ss) => ss.map((s) => window.__cardTool.timeify(s)), strings);
  const theirs = await gpage.evaluate((ss) => {
    // The game's own `timeify` only rewrites in real time, and `__cfg` is the live CONFIG.
    const cfg = __m_config;                       // the module object, reachable as a bare global
    const was = window.__cfg.mode; cfg.setMode('realtime');
    const out = ss.map((s) => cfg.timeify(s));
    cfg.setMode(was || 'turn');
    return out;
  }, strings).catch(() => null);
  if (theirs) {
    const bad = strings.map((s, i) => [s, mine[i], theirs[i]]).filter(([, a, b]) => a !== b);
    ok('the page\'s real-time preview says what the game says', bad.length === 0,
       bad.length ? bad.slice(0, 2).map(([s, a, b]) => `"${s}" -> page "${a}" vs game "${b}"`).join(' | ') : `${strings.length} strings agree`);
    const rewritten = strings.filter((s, i) => mine[i] !== s).length;
    ok('...over strings that actually get rewritten', rewritten >= 5, `${rewritten} of ${strings.length} change in real time`);
  } else {
    ok('the page\'s real-time preview says what the game says', false, 'could not reach the game\'s timeify');
  }

  // ---- 5. editing, and what the export carries --------------------------------
  const first = shown[0];
  await page.evaluate((n) => {
    const row = document.querySelector('[data-card="' + CSS.escape(n) + '"]');
    const ta = row.querySelector('textarea[data-field="effect"]');
    ta.value = 'REWRITTEN: grow 9 steps every 3 rounds.';
    ta.dispatchEvent(new Event('input', { bubbles: true }));
  }, first);
  await sleep(120);
  const afterText = await page.evaluate((n) => {
    const row = document.querySelector('[data-card="' + CSS.escape(n) + '"]');
    return { rt: row.querySelector('.rt').textContent, dirty: row.className.indexOf('dirty') >= 0 };
  }, first);
  ok('editing a description marks the card as changed', afterText.dirty === true, afterText.dirty ? 'marked' : 'not marked');
  ok('...and the real-time reading updates as you type', /30s/.test(afterText.rt), afterText.rt);

  // A cost, by typing into the box the way a mouse-and-keyboard user would.
  await page.evaluate((n) => {
    const row = document.querySelector('[data-card="' + CSS.escape(n) + '"]');
    const i = row.querySelectorAll('.cost input')[2];        // costW
    i.value = '7'; i.dispatchEvent(new Event('input', { bubbles: true }));
  }, first);
  await sleep(120);
  await page.click('#copy'); await sleep(200);
  const txt = await page.evaluate(() => window.__cardExport);
  let out = null; try { out = JSON.parse(txt); } catch (e) {}
  ok('the export is the game\'s own shape', !!out && out.format === 'mycelium-cards', out ? out.format : '(unparseable)');
  ok('...and carries the edits', !!out && out.cards[first] && out.cards[first].costW === 7
     && /REWRITTEN/.test(out.cards[first].effect || ''), JSON.stringify(out && out.cards[first]));

  // THE POOL SUMMARY RE-READS THE EDIT. It exists so a cost change is visible against the whole
  // pool it lands in, which it can only do if it is derived on every render rather than baked at
  // generation time — a strip that showed the shipped numbers while you edited would be worse
  // than none, because it would look like the edit had no effect.
  const sum = await page.evaluate((n) => {
    const c = window.__cardTool.data.cards.find((x) => x.name === n);
    const box = document.querySelector('.sump[data-pool="' + CSS.escape(c.pool) + '"]');
    return { pool: c.pool, text: box ? box.textContent.replace(/\s+/g, ' ').trim() : null,
             bars: box ? box.querySelectorAll('.spark i').length : 0,
             cards: window.__cardTool.data.cards.filter((x) => x.pool === c.pool).length };
  }, first);
  ok('the pool summary counts the edit', /1 edited/.test(sum.text || ''), sum.text || '(no summary)');
  ok('...and its Water max has moved to the cost just typed', / max 7\b/.test(sum.text || ''), sum.text || '');
  ok('...with one bar per card in the pool', sum.bars === sum.cards * 3, `${sum.bars} bars for ${sum.cards} cards x 3 costs`);

  // "Changed only" is the filter that makes a 61-card page reviewable.
  await page.click('#changed'); await sleep(150);
  const nChanged = await page.evaluate(() => document.querySelectorAll('.card').length);
  ok('"Changed only" narrows to what was edited', nChanged === 1, `${nChanged} row(s)`);
  await page.click('#changed'); await sleep(150);

  // Edits survive a reload — the page is where a long review is held.
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.card', { timeout: 15000 });
  const kept = await page.evaluate((n) => {
    const row = document.querySelector('[data-card="' + CSS.escape(n) + '"]');
    return row.querySelector('textarea[data-field="effect"]').value;
  }, first);
  ok('edits survive a reload', /REWRITTEN/.test(kept), kept.slice(0, 40));

  ok('no page errors', errs.length === 0, errs.slice(0, 2).join(' | '));

  // ---- 6. apply-cards writes it, and refuses what it should -------------------
  const tmp = path.join(ROOT, 'tests', '.artifacts', 'card-tool-apply.json');
  fs.mkdirSync(path.dirname(tmp), { recursive: true });
  const target = live.data.find((c) => c.name === 'Hyphal Extension') || liveBy.get(shown[1]);
  const good = { format: 'mycelium-cards',
    cards: { [target.name]: { costW: (target.costW | 0) + 3, effect: (target.effect || 'x') + ' TESTMARK' } },
    config: {}, notes: { [target.name]: 'a note that must not be applied' } };
  fs.writeFileSync(tmp, JSON.stringify(good));
  let dry = '';
  try { dry = node(['scripts/apply-cards.mjs', tmp, '--dry']); } catch (e) { dry = 'THREW ' + (e.stdout || '') + (e.stderr || ''); }
  ok('apply-cards --dry reports the change', /costW/.test(dry) && /TESTMARK/.test(dry), dry.split('\n')[1] || dry.slice(0, 80));
  ok('...and writes nothing', /nothing written/.test(dry)
     && !fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8').includes('TESTMARK'), 'index.html untouched');
  ok('...and does NOT apply the behaviour note', /NOT applied/.test(dry), 'notes reported, not written');

  // The refusals. Each is a thing that would otherwise be written and mean nothing, or break.
  const refuse = (name, spec) => {
    fs.writeFileSync(tmp, JSON.stringify(spec));
    try { const o = node(['scripts/apply-cards.mjs', tmp, '--dry']); return { ok: false, out: o }; }
    catch (e) { return { ok: true, out: (e.stdout || '') + (e.stderr || '') }; }
  };
  let r = refuse('unknown card', { format: 'mycelium-cards', cards: { 'Not A Card': { costW: 1 } } });
  ok('apply-cards refuses a card that is not in CARD_DATA', r.ok && /not a card/i.test(r.out), r.out.split('\n')[1] || '');
  r = refuse('archived', { format: 'mycelium-cards', cards: { [live.archived[0]]: { costW: 1 } } });
  ok('...refuses an ARCHIVED card, which is not in the game', r.ok && /ARCHIVED/.test(r.out), r.out.split('\n')[1] || '');
  r = refuse('empty text', { format: 'mycelium-cards', cards: { [target.name]: { effect: '   ' } } });
  ok('...refuses an empty description', r.ok && /empty/.test(r.out), r.out.split('\n')[1] || '');
  r = refuse('negative', { format: 'mycelium-cards', cards: { [target.name]: { costW: -2 } } });
  ok('...refuses a negative cost', r.ok && /whole number/.test(r.out), r.out.split('\n')[1] || '');
  r = refuse('unknown field', { format: 'mycelium-cards', cards: { [target.name]: { name: 'Renamed' } } });
  ok('...refuses to rename a card (the name is what everything joins on)',
     r.ok && /not a field/.test(r.out), r.out.split('\n')[1] || '');
  r = refuse('round clock', { format: 'mycelium-cards', cards: {}, config: { roundSeconds: 4 } });
  ok('...refuses the real-time round clock, which is not a card knob',
     r.ok && /round clock/.test(r.out), r.out.split('\n')[1] || '');
  r = refuse('not an export', { cards: {} });
  ok('...refuses a file that is not a card-tool export', r.ok && /not a card-tool export/.test(r.out), r.out.split('\n')[1] || '');

  // THE REAL WRITE, on a COPY of index.html, so a check can never leave the game edited. This is
  // the assertion the whole pair exists for; the dry run above cannot show that the file parses.
  const backup = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  fs.writeFileSync(tmp, JSON.stringify(good));
  let wrote = '', after = '';
  try {
    wrote = node(['scripts/apply-cards.mjs', tmp]);
    after = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  } finally {
    fs.writeFileSync(path.join(ROOT, 'index.html'), backup);   // always, even if it threw
  }
  ok('a real apply reaches CARD_DATA', /applied/.test(wrote) && after.includes('TESTMARK'), wrote.split('\n')[1] || '');
  let reparsed = null;
  try { reparsed = JSON.parse(after.match(/const CARD_DATA = (\[[\s\S]*?\n\]);\n/)[1]); } catch (e) {}
  ok('...and the file it wrote still parses as CARD_DATA',
     !!reparsed && reparsed.length === live.data.length, reparsed ? `${reparsed.length} cards` : 'unparseable');
  const t2 = reparsed && reparsed.find((c) => c.name === target.name);
  ok('...with exactly the intended values', !!t2 && t2.costW === (target.costW | 0) + 3
     && /TESTMARK$/.test(t2.effect), t2 ? `costW ${t2.costW}` : '(missing)');
  // NOTHING ELSE MOVED. A whole-block rewrite is the risk this pair takes, so measure it.
  const others = reparsed ? reparsed.filter((c) => c.name !== target.name) : [];
  const before = live.data.filter((c) => c.name !== target.name);
  const same = others.length === before.length
    && others.every((c, i) => JSON.stringify(c) === JSON.stringify(before[i]));
  ok('...and not one other card changed', same, `${others.length} others compared`);
  ok('index.html is back as it was', fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8') === backup);

  // ---- 7. the generated page is not behind index.html ------------------------
  // The failure a generated tool always has. Re-running the generator must produce what is
  // committed; if it does not, the page on disk describes an older game.
  const held = fs.readFileSync(TOOL, 'utf8');
  node(['scripts/gen-card-tool.mjs']);
  const fresh = fs.readFileSync(TOOL, 'utf8');
  ok('docs/card-tool.html is up to date with index.html', held === fresh,
     held === fresh ? 'regenerating changes nothing' : 're-run node scripts/gen-card-tool.mjs and commit');
  if (held !== fresh) fs.writeFileSync(TOOL, held);

  await page.screenshot({ path: path.join(ROOT, 'tests', '.artifacts', 'card-tool.png'), fullPage: false, animations: 'disabled', timeout: 15000 }).catch(() => {});
  console.log(`\n==== ${pass} passed, ${fail} failed ====`);
  await browser.close(); srv.close();
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('HARNESS ERROR', e); process.exit(1); });
