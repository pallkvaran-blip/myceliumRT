/* THE TUTORIAL SCRIPT — the level-1 walkthrough and the later-level tips.
 *
 * What this guards, and why each one is here rather than obvious:
 *   - THE SCRIPT IS THE OWNER'S. Every line was dictated; a paraphrase is a regression even when
 *     it reads fine, so each step is matched on its own wording rather than on "a step exists".
 *   - IT ADVANCES. Two steps are FORCED (no Next button) and wait on the player doing something —
 *     arming a card, then growing. A gate that can never be satisfied strands the walkthrough with
 *     no way out but End, and nothing else in the game would notice.
 *   - THE TIPS ARE ON THE RIGHT LEVELS. Ants on 2 and Trichoderma on 3 (owner). They used to be
 *     steps of the level-1 walkthrough, so "the ant step exists somewhere" is exactly the assertion
 *     that would pass on the old build.
 *
 * Runs the walkthrough headless by satisfying each forced step the way a player would.
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

(async () => {
  const srv = await new Promise((res) => { const s = http.createServer((rq, rs) => {
    let p = decodeURIComponent(rq.url.split('?')[0].split('#')[0]); if (p === '/') p = '/index.html';
    const fp = path.join(ROOT, p);
    if (!fp.startsWith(ROOT) || !fs.existsSync(fp) || fs.statSync(fp).isDirectory()) { rs.writeHead(404); rs.end('nf'); return; }
    rs.writeHead(200, { 'Content-Type': T[path.extname(fp)] || 'application/octet-stream' });
    fs.createReadStream(fp).pipe(rs); }); s.listen(0, () => res(s)); });
  const base = 'http://localhost:' + srv.address().port;
  const browser = await chromium.launch({ headless: true, executablePath: '/opt/pw-browsers/chromium' });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errs = []; page.on('pageerror', (e) => errs.push(String(e && e.message)));
  page.on('console', (m) => { if (m.type() === 'error') errs.push('console:' + m.text()); });
  await page.addInitScript(() => { window.MYCELIUM_SUPABASE = { url: '', anonKey: '' }; });
  await page.goto(base + '/index.html#dev,turn', { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#loadscreen.ld-ready', { timeout: 25000 }).catch(() => {});
  await page.click('#loadscreen', { timeout: 5000 }).catch(() => {});
  await page.waitForFunction(() => !!(window.__game && window.__game.state && window.__game.state.active), { timeout: 30000 });
  await page.evaluate(() => document.querySelectorAll('#levelIntro').forEach((n) => n.remove()));

  // Resources up front: several steps are only reachable by actually growing.
  await page.evaluate(() => { const n = window.__game.state.active; n.energy = 1e6; n.water = 999; n.phosphorus = 999; });
  await page.evaluate(() => window.__game.startTutorial());
  await sleep(600);

  // Walk it. A step with a visible Next is explanatory; one without is FORCED and has to be
  // satisfied the way a player would.
  const seen = [];
  const shots = [];
  for (let guard = 0; guard < 40; guard++) {
    const st = await page.evaluate(() => {
      const r = document.getElementById('tutorial');
      if (!r) return null;
      const b = document.getElementById('tutBody');
      const nx = document.getElementById('tutNext');
      const ring = document.querySelector('.tut-ring');
      return { text: b ? b.textContent.trim() : '',
               next: nx ? getComputedStyle(nx).display !== 'none' : false,
               nextLabel: nx ? nx.textContent.trim() : null,
               nextFont: nx ? parseFloat(getComputedStyle(nx).fontSize) : null,
               zoom: (() => { try { return +window.__game.camera.zoom.toFixed(3); } catch (_) { return null; } })(),
               // How many creatures are pulsing a range. ONE (owner) — every range at once on a
               // zoomed-out map is a wash of green with no edge to read.
               flashing: (() => { const g = window.__game;
                 return g.sightFlashCount ? g.sightFlashCount() : null; })(),
               img: (() => { const f = document.getElementById('tutFig');
                 return f && getComputedStyle(f).display !== 'none' ? (document.getElementById('tutImg') || {}).src || '' : null; })(),
               ringW: ring && getComputedStyle(ring).display !== 'none' ? Math.round(ring.getBoundingClientRect().width) : null };
    });
    if (!st) break;
    if (!seen.length || seen[seen.length - 1].text !== st.text) seen.push(st);
    if (seen.length === 1 && !shots.length) {
      await page.screenshot({ path: path.join(__dirname, '.artifacts', 'tutorial-step1.png'), animations: 'disabled', timeout: 15000 }).catch(() => {});
      shots.push(1);
    }
    if (st.next) { await page.click('#tutNext'); await sleep(350); continue; }
    // Forced steps, in script order.
    if (/This is your deck/i.test(st.text)) {
      await page.evaluate(() => window.__game.armAim('Apical Drive'));
    } else if (/Grow into .?substrate/i.test(st.text)) {
      // GROW INTO THE PILE, and keep the world ticking. This step ends on the REWARD, not on
      // "the colony grew" — growing off in some other direction leaves it up forever, which is
      // exactly the stall this loop's guard would report.
      await page.evaluate(async () => {
        const g = window.__game, s = g.state, sub = s.substrate, net = s.active, C = s.cards;
        const at = g.starterPile();
        const ctrOf = (q) => { let x = 0, y = 0; for (const i of q.cells) { const c = sub.cellCenter(i % sub.cols, (i / sub.cols) | 0); x += c.x; y += c.y; } return { x: x / q.cells.length, y: y / q.cells.length }; };
        const p = at && (sub.foodPiles || []).filter((q) => q.cells && q.cells.length)
          .sort((a, b) => Math.hypot(ctrOf(a).x - at.x, ctrOf(a).y - at.y) - Math.hypot(ctrOf(b).x - at.x, ctrOf(b).y - at.y))[0];
        if (!p) return;
        const ctr = ctrOf(p);
        net.energy = 1e6; net.water = 999; net.phosphorus = 999;
        const fp = net.frontierPoint() || net.nodes[0];
        C.hand.push({ id: C.seq++, name: 'Rhizomorph Lance' });
        g.play(C.hand.length - 1, { x: ctr.x, y: ctr.y, srcX: fp.x, srcY: fp.y });
        for (let i = 0; i < 60; i++) {
          if (C.pendingOffers && C.pendingOffers.length) break;
          g.tickWorld(s);
          await new Promise((r) => setTimeout(r, 100));
        }
        // Take the draft so the walkthrough is not held behind an open offer.
        for (let i = 0; i < 6 && C.pendingOffers.length; i++) {
          const off = C.pendingOffers[0], nm = off && off.choices && off.choices[0];
          if (!nm) break;
          g.chooseCard(nm);
        }
      });
    } else { ok('the walkthrough never stalls on a gate nothing can satisfy', false, st.text.slice(0, 70)); break; }
    await sleep(500);
  }

  const texts = seen.map((s) => s.text);
  console.log('  note  ' + texts.length + ' step(s): ' + texts.map((t) => t.slice(0, 34)).join(' | '));

  // ---- the owner's wording, step by step -------------------------------------
  const has = (re) => texts.some((t) => re.test(t));
  ok('1. "This is your colony. You are mycelium. Mycelium is you."',
     /This is your colony\.\s*You are mycelium\. Mycelium is you\./.test(texts[0] || ''), texts[0] || '(none)');
  ok('3. "This is your deck. Click a card to play it."',
     /This is your deck\.\s*Click a card to play it\./.test(texts[2] || ''), texts[2] || '(none)');
  ok('4. the substrate line names both pile colours',
     /Grow into substrate to consume it\./.test(texts[3] || '')
     && /Yellow piles give you energy/.test(texts[3] || '')
     && /Orange piles give you energy and new cards/.test(texts[3] || ''), texts[3] || '(none)');
  ok('5. red leaves are engine cards', has(/Red leaves are rare and give you engine cards\.\s*Very valuable\./));
  ok('6. water harvests 1 per round, and running out kills',
     has(/harvest 1 water per round/) && has(/won.t survive for long without water/));
  // ...ON ONE LINE at a desktop width. The sentence is 486px wide at this font and the popup used
  // to give it 434, so it wrapped — and `text-wrap: balance` then evened the halves and put the
  // break after the dangling "to" ("…bodies of water to / harvest 1 water per round"). Asserted by
  // MEASURING the sentence against the box, because no wrap mode fixes text that does not fit and
  // the failure is a box width rather than anything in the copy.
  const fitsOneLine = await page.evaluate(() => {
    const pop = document.createElement('div');
    pop.className = 'tut-pop tut-pop--side tut-pop--left';
    pop.style.visibility = 'hidden';
    const body = document.createElement('div'); body.className = 'tut-body';
    pop.appendChild(body); document.body.appendChild(pop);
    const avail = body.getBoundingClientRect().width;
    const probe = document.createElement('span');
    probe.className = 'tut-body';
    probe.style.cssText = 'position:absolute;visibility:hidden;white-space:nowrap;left:-9999px';
    probe.innerHTML = 'Grow into bodies of <b>water</b> to harvest 1 water per round.';
    document.body.appendChild(probe);
    const natural = probe.getBoundingClientRect().width;
    probe.remove(); pop.remove();
    return { avail: Math.round(avail), natural: Math.round(natural) };
  });
  ok('...and the popup is wide enough to hold that sentence on one line',
     fitsOneLine.avail >= fitsOneLine.natural,
     `${fitsOneLine.natural}px of text in ${fitsOneLine.avail}px of box`);
  ok('7. nematodes', has(/Nematodes love eating mycelium\.\s*Be careful around them\./));
  ok('8. click enemies to see their sensing range', has(/Click on enemies to see their sensing range\./));
  // THE STEP'S CAMERA AND ITS RING. A sensing radius is 500 world units across, so at the
  // walkthrough's usual 1.1 the circle is wider than the screen and reads as a tint over
  // everything rather than as a range with an edge.
  const sight = seen.find((s2) => /sensing range/.test(s2.text)) || {};
  const other = seen.find((s2) => /This is your colony/.test(s2.text)) || {};
  ok('...seen from much further out than the rest of the walkthrough',
     sight.zoom > 0 && other.zoom > 0 && sight.zoom < other.zoom * 0.6,
     `zoom ${sight.zoom} vs ${other.zoom} on step 1`);
  ok('...with exactly one creature pulsing its range', sight.flashing === 1, String(sight.flashing));
  // ...and it must not survive the step.
  const afterFlash = await page.evaluate(() => window.__game.sightFlashCount());
  ok('...and nothing is left pulsing once the walkthrough ends', afterFlash === 0, String(afterFlash));
  ok('9. it ends on "Good luck…"', /^Good luck…$/.test((texts[texts.length - 1] || '').trim()),
     texts[texts.length - 1] || '(none)');
  // MOVED OFF LEVEL 1 (owner). "an ant step exists" would pass on the old build, which is why this
  // asserts their ABSENCE from the walkthrough and their presence as tips further down.
  ok('ants and Trichoderma are NOT in the level-1 walkthrough',
     !has(/\bAnts\b/) && !has(/Trichoderma/), texts.filter((t) => /Ants|Trichoderma/.test(t)).join(' | ') || 'absent');

  // ---- the popup's furniture --------------------------------------------------
  const step1 = seen[0] || {};
  const pile = seen.find((s2) => /Grow into substrate/.test(s2.text)) || {};
  ok('the substrate step offers a Next button as well as its gate', pile.next === true,
     `next visible = ${pile.next}`);
  ok('the Next button has no chevron on it', (seen.find((s) => s.nextLabel) || {}).nextLabel === 'Next',
     (seen.find((s) => s.nextLabel) || {}).nextLabel || '(none)');
  const fsz = (seen.find((s) => s.nextFont) || {}).nextFont;
  ok('...and the buttons are smaller than they were', fsz > 0 && fsz <= 13, `${fsz}px (was 14)`);
  // The ring sat ON the colony rather than around it (owner). 52px radius was the default for a
  // world target; step 1 asks for its own.
  ok('the first step rings the colony well clear of it', step1.ringW >= 150,
     `${step1.ringW}px across (default is 104)`);
  ok('the nematode step carries its portrait',
     (seen.find((s) => /Nematodes love/.test(s.text)) || {}).img || '' , 'nematode.jpg expected');

  // ---- the reported stall ----------------------------------------------------
  // "I grew into the substrate, but the message failed to move on." The gate waited on the
  // REWARD, and in turn-based the world only ticks when the player acts — so after growing in
  // there was nothing left to do and no reason to act, the pile never finished digesting, and the
  // step stayed up forever. It ends on the CLAIM now, which lands inside the grow itself.
  // Asserted with NO further ticking, which is the whole point: the previous build only passed
  // because the harness kept the world moving on the player's behalf.
  const stall = await page.evaluate(async () => {
    const g = window.__game, s = g.state, sub = s.substrate, net = s.active, C = s.cards;
    document.querySelectorAll('#tutorial').forEach((n) => n.remove());
    const t = g.tutorial; if (t) { try { t.destroy(); } catch (_) {} }
    g.startTutorial();
    await new Promise((r) => setTimeout(r, 400));
    // Walk to the substrate step the way a player would.
    for (let i = 0; i < 12; i++) {
      const b = document.getElementById('tutBody');
      if (b && /Grow into substrate/.test(b.textContent)) break;
      const nx = document.getElementById('tutNext');
      if (nx && getComputedStyle(nx).display !== 'none') nx.click();
      else if (/This is your deck/.test((b || {}).textContent || '')) g.armAim('Apical Drive');
      await new Promise((r) => setTimeout(r, 260));
    }
    const before = (document.getElementById('tutBody') || {}).textContent || '';
    const at = g.starterPile();
    const ctrOf = (q) => { let x = 0, y = 0; for (const i of q.cells) { const c = sub.cellCenter(i % sub.cols, (i / sub.cols) | 0); x += c.x; y += c.y; } return { x: x / q.cells.length, y: y / q.cells.length }; };
    const p2 = at && (sub.foodPiles || []).filter((q) => q.cells && q.cells.length)
      .sort((a, b) => Math.hypot(ctrOf(a).x - at.x, ctrOf(a).y - at.y) - Math.hypot(ctrOf(b).x - at.x, ctrOf(b).y - at.y))[0];
    if (!p2) return { skipped: true };
    const ctr = ctrOf(p2);
    net.energy = 1e6; net.water = 999; net.phosphorus = 999;
    const fp = net.frontierPoint() || net.nodes[0];
    C.hand.push({ id: C.seq++, name: 'Rhizomorph Lance' });
    g.play(C.hand.length - 1, { x: ctr.x, y: ctr.y, srcX: fp.x, srcY: fp.y });
    // NO tickWorld here, deliberately. Just wait, the way a player who has done what they were
    // asked would. Long enough to outlast the reveal AND the deliberate hold after it.
    // SAMPLED ALONG THE WAY, because "it advanced" and "it advanced only after the growth had
    // finished drawing" are different claims and the owner asked for the second one.
    const marks = [];
    for (let i = 0; i < 40; i++) {
      await new Promise((r) => setTimeout(r, 250));
      const t = (document.getElementById('tutBody') || {}).textContent || '';
      marks.push({ ms: (i + 1) * 250, on: /Grow into substrate/.test(t) });
      if (!marks[marks.length - 1].on) break;
    }
    const after = (document.getElementById('tutBody') || {}).textContent || '';
    const leftAt = (marks.find((m) => !m.on) || {}).ms || null;
    return { before, after, leftAt,
             moved: /Grow into substrate/.test(before) && !/Grow into substrate/.test(after) };
  });
  ok('growing into the substrate advances the step with no further action',
     stall.skipped === true || stall.moved === true,
     stall.skipped ? '(no pile on this map)' : `"${(stall.before || '').slice(0, 30)}" -> "${(stall.after || '').slice(0, 30)}" after ${stall.leftAt}ms`);
  // ...BUT NOT INSTANTLY (owner). The gate answers a question about the MODEL, which has the growth
  // the moment the card resolves — so without the hold the step vanished while the player's own
  // grow was still walking out on screen. The floor is 900ms; anything under that means the hold
  // was dropped.
  ok('...and not before the growth has had time to finish drawing',
     stall.skipped === true || (stall.leftAt != null && stall.leftAt >= 900),
     stall.skipped ? '(no pile on this map)' : `left the step after ${stall.leftAt}ms`);

  // ---- the tips, on their own levels -----------------------------------------
  // A SECOND PAGE, ON A MAP THAT HAS THE CREATURES. Each tip `skip`s when its subject is absent —
  // correctly — and the dev boot rolls a level 1 with no ants and no mould, so the first version of
  // this block hand-pushed fakes into `state.ants` / `state.clouds` and took the renderer down with
  // it ("Cannot read properties of undefined"). A creature is a lot more than an {x,y}; use a map
  // that already has real ones. `4-rust` carries 1 ant and 2 Trichoderma.
  const p2 = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errs2 = []; p2.on('pageerror', (e) => errs2.push(String(e && e.message)));
  p2.on('console', (m) => { if (m.type() === 'error') errs2.push('console:' + m.text()); });
  await p2.addInitScript(() => { window.MYCELIUM_SUPABASE = { url: '', anonKey: '' }; });
  await p2.goto(base + '/index.html#level,4-rust', { waitUntil: 'domcontentloaded' });
  await p2.waitForSelector('#loadscreen.ld-ready', { timeout: 25000 }).catch(() => {});
  await p2.click('#loadscreen', { timeout: 5000 }).catch(() => {});
  await p2.waitForFunction(() => !!(window.__game && window.__game.state && window.__game.state.active), { timeout: 30000 });
  await p2.evaluate(() => document.querySelectorAll('#levelIntro').forEach((n) => n.remove()));
  const census = await p2.evaluate(() => ({ ants: (window.__game.state.ants || []).length,
                                            clouds: (window.__game.state.clouds || []).length }));
  console.log(`  note  tip map 4-rust: ${census.ants} ant(s), ${census.clouds} cloud(s)`);

  const tip = async (level) => p2.evaluate(async ({ level }) => {
    // DESTROY, don't just remove the node. `beginLevelTip` refuses to open on top of a live
    // walkthrough, and a controller whose DOM was ripped out is still `active` — so the second
    // tip silently did nothing and read as "level 3 has no tip".
    const t = window.__game.tutorial; if (t) { try { t.destroy(); } catch (_) {} }
    document.querySelectorAll('#tutorial').forEach((n) => n.remove());
    window.__game.levelTip(level);
    await new Promise((r) => setTimeout(r, 400));
    const b = document.getElementById('tutBody');
    const f = document.getElementById('tutFig');
    const out = { text: b ? b.textContent.trim() : null,
                  img: f && getComputedStyle(f).display !== 'none' ? (document.getElementById('tutImg') || {}).src || '' : null };
    document.querySelectorAll('#tutorial').forEach((n) => n.remove());
    return out;
  }, { level });

  const t2 = await tip(2);
  ok('level 2 gets the ant tip',
     /Ants are harmless to you/.test(t2.text || '') && /attract nematodes/.test(t2.text || ''),
     t2.text || '(none)');
  ok('...with the ant portrait', /ant\.jpg/.test(t2.img || ''), t2.img || '(none)');
  const t3 = await tip(3);
  ok('level 3 gets the Trichoderma tip',
     /Trichoderma/.test(t3.text || '') && /Approach at your own risk/.test(t3.text || ''),
     t3.text || '(none)');
  ok('...with the Trichoderma portrait', /trichoderma\.jpg/.test(t3.img || ''), t3.img || '(none)');
  // AN UNKNOWN LEVEL MUST DO NOTHING. Without its own guard `LEVEL_TIPS[n] || MAIN_STEPS` fell
  // through and started the entire level-1 walkthrough — on level 4, mid-run.
  const t4 = await tip(4);
  ok('no tip on a level that has none, and no walkthrough either', t4.text === null, t4.text || '(none)');
  errs.push(...errs2);
  await p2.close();

  ok('no page errors', errs.length === 0, errs.slice(0, 2).join(' | '));
  console.log(`\n==== ${pass} passed, ${fail} failed ====`);
  await browser.close(); srv.close(); process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('HARNESS ERROR', e); process.exit(2); });
