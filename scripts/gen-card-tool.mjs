#!/usr/bin/env node
// Generate docs/card-tool.html — the review + edit page for every card CURRENTLY IN THE GAME.
//
//   node scripts/gen-card-tool.mjs                 # -> docs/card-tool.html
//   node scripts/gen-card-tool.mjs --no-art        # skip the inlined thumbnails (much smaller file)
//
// It reads index.html and NOTHING ELSE — CARD_DATA is embedded JSON there and that inline copy is
// the source of truth (docs/cards.json is an upstream snapshot that changes nothing). So
// re-running this is how the page stops being stale, exactly like the species tool.
//
// THE PAIR MATTERS MORE THAN THE PAGE. `scripts/apply-cards.mjs` writes the export back into
// index.html — costs, effect text, `produces`, opening copies, and the CONFIG knobs. The
// card-TIMING review (docs/card-review.html) has had exported decisions nobody applied for months
// because "export JSON" and "hand-edit a 30k-line file" are not the same distance apart.
//
// THREE THINGS ON THE PAGE THAT ARE NOT OBVIOUS:
//
//  · "ACTIVE" IS `!archived && EFFECTS[name]`, and this script cannot run the module, so it
//    reconstructs that set from the text: the EFFECTS literal's own keys, the `EFFECTS['X'] =`
//    assignments after it, and the DRAW_ENGINES loop. Three shapes, and a fourth would silently
//    drop cards from the page. `tests/card-tool-check.cjs` compares this list against the LIVE
//    `__game.cards.active()` for that reason — the drift fails an assertion rather than showing a
//    short page nobody counts.
//
//  · EVERY CARD SHOWS THE CONFIG KNOBS ITS EFFECT READS. This is the "editing a description may
//    lead to function changes" half. The effect functions take their numbers from
//    `s.config.cards.*` — "Grow 2 steps" is `foodSeekSteps`, "6 steps" is `reachSegments` — so
//    rewording a card to promise something different usually means moving a knob, not writing
//    code, and the page says which one and what it is now. Where a reword needs actual new
//    BEHAVIOUR there is a note field, and that is the honest limit of what a page can do.
//
//  · CARD TEXT IS AUTHORED IN ROUNDS AND REWRITTEN AT DISPLAY TIME (`timeify`). A card that says
//    "every 6 rounds" reads as "every 60s" in real time. The page shows both, so a rewrite that
//    reads well in turn-based and badly in real time is visible while it is being written rather
//    than after it ships.

import { readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const IDX = join(ROOT, 'index.html');
const OUT = join(ROOT, 'docs', 'card-tool.html');
const NO_ART = process.argv.includes('--no-art');

const html = readFileSync(IDX, 'utf8');
const die = (m) => { console.error('gen-card-tool: ' + m); process.exit(1); };
const grab = (re, what) => { const m = html.match(re); if (!m) die(`${what} not found in index.html`); return m; };

// ---- the data ---------------------------------------------------------------
const CARDS = JSON.parse(grab(/const CARD_DATA = (\[[\s\S]*?\n\]);\n/, 'CARD_DATA')[1]);
const ARCHIVED = new Set(new Function('return ' + grab(/const ARCHIVED = new Set\((\[[\s\S]*?\n\])\);/, 'ARCHIVED')[1])());

// The EFFECTS names, in the three shapes the file writes them. See the header.
const effStart = html.indexOf('\nconst EFFECTS = {');
if (effStart < 0) die('EFFECTS not found in index.html');
const effEnd = html.indexOf('\n};', effStart);                    // `};` at column 0 closes the literal
const literal = html.slice(effStart, effEnd);
const after = html.slice(effEnd);
const litKeys = [...literal.matchAll(/\n  '([^']+)':/g)];
const asgKeys = [...after.matchAll(/\nEFFECTS\['([^']+)'\] =/g)];
const drawEngineKeys = [...grab(/const DRAW_ENGINES = \{([\s\S]*?)\n\};/, 'DRAW_ENGINES')[1]
  .matchAll(/'([^']+)':/g)].map((m) => m[1]);
const HAS_EFFECT = new Set([...litKeys.map((m) => m[1]), ...asgKeys.map((m) => m[1]), ...drawEngineKeys]);

// Per card, the `config.cards.*` knobs its effect body mentions. Sliced key-to-next-key, which is
// exact for the literal and for every assignment but the last (bounded, since the file continues
// past it with unrelated code).
const knobsFor = {};
const scan = (text, hits, hardTail) => {
  for (let i = 0; i < hits.length; i++) {
    const a = hits[i].index;
    const b = i + 1 < hits.length ? hits[i + 1].index : Math.min(text.length, a + hardTail);
    knobsFor[hits[i][1]] = [...new Set([...text.slice(a, b).matchAll(/config\.cards\.(\w+)/g)].map((m) => m[1]))];
  }
};
scan(literal, litKeys, literal.length);
scan(after, asgKeys, 2500);

// CONFIG.cards, for the knob values. Read as `name: number` lines inside the block, because the
// block is full of trailing comments and nested structure that a JSON parse would choke on.
const cfgStart = html.indexOf('  cards: {', html.indexOf('const CONFIG'));
if (cfgStart < 0) die('CONFIG.cards not found in index.html');
const cfgEnd = html.indexOf('\n  },', cfgStart);
const CFG = {};
for (const m of html.slice(cfgStart, cfgEnd).matchAll(/\n {4}(\w+): (-?\d+(?:\.\d+)?),/g)) CFG[m[1]] = +m[2];

const ACTIVE = CARDS.filter((c) => !ARCHIVED.has(c.name) && HAS_EFFECT.has(c.name));
if (!ACTIVE.length) die('no active cards found — the EFFECTS scan must have missed its target');

// ---- art --------------------------------------------------------------------
// Inlined as data URIs: the page is meant to be published as an Artifact, and a strict CSP blocks
// every external request, so a relative `assets/cards/x.jpg` renders as nothing. Downscaled hard
// (96px wide) because 61 full-size faces would be several MB of base64 for a thumbnail.
const slug = (n) => String(n).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const ART = {};
if (!NO_ART) {
  const dir = join(ROOT, 'assets', 'cards');
  const have = existsSync(dir) ? new Set(readdirSync(dir)) : new Set();
  let ok = 0, miss = 0;
  for (const c of ACTIVE) {
    const f = slug(c.name) + '.jpg';
    if (!have.has(f)) { miss++; continue; }
    try {
      const b = execFileSync('python3', ['-c', `
import sys, io, base64
from PIL import Image
im = Image.open(sys.argv[1]).convert('RGB')
w = 96
im = im.resize((w, max(1, round(im.height * w / im.width))), Image.LANCZOS)
buf = io.BytesIO(); im.save(buf, 'JPEG', quality=68)
sys.stdout.write(base64.b64encode(buf.getvalue()).decode())
`, join(dir, f)], { encoding: 'utf8', maxBuffer: 1 << 24 });
      ART[c.name] = 'data:image/jpeg;base64,' + b.trim(); ok++;
    } catch (e) { miss++; }
  }
  console.log(`gen-card-tool: inlined ${ok} thumbnails (${miss} missing)`);
}

// ---- the page ---------------------------------------------------------------
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
// Every card the page can see, plus the knobs and their current values, handed to the script as
// one JSON blob rather than baked into markup — the page rebuilds its own rows, so a filter or a
// sort never has to reconcile two copies of the truth.
const PAYLOAD = {
  generated: 'from index.html',
  cards: ACTIVE.map((c) => ({
    name: c.name, type: c.type, pool: c.displayCategory || c.type, category: c.category,
    family: c.family, timing: c.timing, threat: c.threat,
    buyCostEnergy: c.buyCostEnergy | 0, buyP: c.buyP | 0, costW: c.costW | 0, costP: c.costP | 0,
    startCopies: c.startCopies | 0, effect: c.effect || '', produces: c.produces || '',
    knobs: (knobsFor[c.name] || []).filter((k) => k in CFG),
    art: ART[c.name] || '',
  })),
  config: CFG,
  archived: CARDS.filter((c) => ARCHIVED.has(c.name)).map((c) => c.name),
};

// NOTE ON BACKTICKS: this file builds the page with ordinary string concatenation and the page's
// own script uses none either. A template literal inside a template literal has broken this
// generator family three times; the fix each time was to stop nesting them.
const POOL_LABEL = { basic: 'Basic', event: 'Event', engine: 'Engine', action: 'Action', extender: 'Extender' };

const page = [
'<meta charset="utf-8">',
// The Artifact wrapper supplies the <head>, but a static server that omits the charset renders the
// em-dashes as mojibake — the sniffer reads the first 1024 bytes wherever the tag sits.
'<title>Mycelium — card tool</title>',
'<style>',
'  :root { color-scheme: light dark; --bg:#faf9f7; --panel:#fff; --ink:#17201c; --dim:#5d6b63;',
'    --line:#e2e5e1; --acc:#1f7a52; --acc-soft:#e8f4ee; --warn:#a8571b; --chip:#f0f2ef; }',
'  @media (prefers-color-scheme: dark) { :root { --bg:#12140f; --panel:#191c17; --ink:#e8ece6;',
'    --dim:#9aa89f; --line:#2b2f29; --acc:#7fe6a3; --acc-soft:#17251d; --warn:#e8a55f; --chip:#22261f; } }',
'  :root[data-theme="dark"] { --bg:#12140f; --panel:#191c17; --ink:#e8ece6; --dim:#9aa89f;',
'    --line:#2b2f29; --acc:#7fe6a3; --acc-soft:#17251d; --warn:#e8a55f; --chip:#22261f; }',
'  :root[data-theme="light"] { --bg:#faf9f7; --panel:#fff; --ink:#17201c; --dim:#5d6b63;',
'    --line:#e2e5e1; --acc:#1f7a52; --acc-soft:#e8f4ee; --warn:#a8571b; --chip:#f0f2ef; }',
'  body { margin:0; background:var(--bg); color:var(--ink); font:15px/1.5 ui-sans-serif,system-ui,-apple-system,Segoe UI,Roboto,sans-serif; }',
'  .wrap { max-width:1180px; margin:0 auto; padding:26px 18px 90px; }',
'  h1 { font-size:24px; margin:0 0 4px; letter-spacing:-0.01em; }',
'  .lede { color:var(--dim); margin:0 0 14px; max-width:68ch; }',
'  .lede code { background:var(--chip); padding:1px 5px; border-radius:4px; font-size:13px; }',
'  h1 { text-wrap:balance; }',
'  input, textarea, button { font-variant-numeric:tabular-nums; }',
'  :is(input,textarea,button,summary):focus-visible { outline:2px solid var(--acc); outline-offset:2px; border-radius:6px; }',
'  /* THE ECONOMY, BEFORE THE 61 ROWS OF IT. A cost review is a question about the SHAPE of the',
'     curve, not about one card — and the strip re-reads live, so an edit is visible against the',
'     whole pool it lands in rather than only in its own box. Bars are share of the pool, so the',
'     three pools stay comparable at very different sizes. */',
'  .sum { display:grid; grid-template-columns:repeat(auto-fit,minmax(232px,1fr)); gap:10px; margin:0 0 18px; }',
'  .sump { background:var(--panel); border:1px solid var(--line); border-radius:11px; padding:11px 13px; }',
'  .sump h3 { margin:0 0 2px; font-size:13px; letter-spacing:0.04em; text-transform:uppercase; color:var(--acc); }',
'  .sump .n { font-size:12px; color:var(--dim); margin-bottom:9px; }',
'  .sump dl { display:grid; grid-template-columns:auto 1fr auto; gap:4px 8px; margin:0; align-items:center; }',
'  .sump dt { font-size:11.5px; color:var(--dim); white-space:nowrap; }',
'  .sump dd { margin:0; font-size:12px; text-align:right; font-variant-numeric:tabular-nums; }',
'  .spark { display:flex; gap:1px; height:9px; align-items:flex-end; }',
'  .spark i { flex:1; background:var(--acc); opacity:0.28; border-radius:1px 1px 0 0; min-height:1px; }',
'  .spark i.hot { opacity:0.85; }',
'  .bar { position:sticky; top:0; z-index:5; background:var(--bg); border-bottom:1px solid var(--line);',
'    padding:10px 0; margin-bottom:16px; display:flex; flex-wrap:wrap; gap:8px; align-items:center; }',
'  .bar input[type=search] { flex:1 1 200px; min-width:150px; padding:7px 10px; border:1px solid var(--line);',
'    border-radius:8px; background:var(--panel); color:inherit; font:inherit; }',
'  .chip { border:1px solid var(--line); background:var(--panel); color:var(--dim); border-radius:999px;',
'    padding:5px 12px; font-size:13px; cursor:pointer; }',
'  .chip.on { background:var(--acc-soft); border-color:var(--acc); color:var(--acc); font-weight:600; }',
'  .btn { border:1px solid var(--acc); background:var(--acc); color:var(--bg); border-radius:8px;',
'    padding:6px 13px; font:inherit; font-size:13px; font-weight:600; cursor:pointer; }',
'  .btn.ghost { background:var(--panel); color:var(--dim); border-color:var(--line); font-weight:500; }',
'  .count { color:var(--dim); font-size:13px; margin-left:auto; }',
'  .card { background:var(--panel); border:1px solid var(--line); border-radius:12px; padding:13px;',
'    margin-bottom:11px; display:grid; grid-template-columns:64px 1fr 246px; gap:13px; align-items:start; }',
'  .card.dirty { border-color:var(--acc); box-shadow:0 0 0 1px var(--acc) inset; }',
'  .art { width:64px; height:64px; border-radius:8px; object-fit:cover; background:var(--chip); display:block; }',
'  .noart { width:64px; height:64px; border-radius:8px; background:var(--chip); }',
'  .nm { font-weight:650; font-size:15px; margin-bottom:3px; }',
'  .tags { display:flex; flex-wrap:wrap; gap:5px; margin-bottom:7px; }',
'  .tag { font-size:11px; letter-spacing:0.03em; text-transform:uppercase; color:var(--dim);',
'    background:var(--chip); border-radius:5px; padding:2px 6px; }',
'  .tag.pool { color:var(--acc); background:var(--acc-soft); font-weight:600; }',
'  textarea { width:100%; box-sizing:border-box; border:1px solid var(--line); border-radius:8px;',
'    background:var(--bg); color:inherit; font:inherit; font-size:14px; padding:7px 9px; resize:vertical; }',
'  textarea.note { font-size:13px; color:var(--warn); min-height:34px; }',
'  .rt { font-size:12px; color:var(--dim); margin:5px 0 0; }',
'  .rt b { color:var(--warn); font-weight:600; }',
'  .row { display:flex; gap:8px; align-items:center; margin-top:7px; flex-wrap:wrap; }',
'  .row label { font-size:12px; color:var(--dim); }',
'  .row input[type=text] { flex:1 1 160px; min-width:120px; padding:5px 8px; border:1px solid var(--line);',
'    border-radius:7px; background:var(--bg); color:inherit; font:inherit; font-size:13px; }',
'  .costs { display:grid; grid-template-columns:1fr 1fr; gap:7px; }',
'  .cost { display:flex; align-items:center; gap:6px; background:var(--bg); border:1px solid var(--line);',
'    border-radius:8px; padding:5px 7px; }',
'  .cost span { font-size:10.5px; color:var(--dim); flex:1; line-height:1.25; }',
'  .cost span b { font-size:11.5px; color:var(--ink); }',
'  .cost input { width:52px; padding:4px 5px; border:1px solid var(--line); border-radius:6px;',
'    background:var(--panel); color:inherit; font:inherit; font-size:14px; text-align:right; }',
'  .cost input.moved { border-color:var(--acc); color:var(--acc); font-weight:700; }',
'  .knobs { grid-column:2 / -1; margin-top:9px; border-top:1px dashed var(--line); padding-top:8px; }',
'  .knobs h4 { margin:0 0 5px; font-size:11px; letter-spacing:0.05em; text-transform:uppercase; color:var(--dim); font-weight:600; }',
'  .knobs .k { display:inline-flex; align-items:center; gap:6px; margin:0 10px 6px 0; font-size:13px; }',
'  .knobs .k code { color:var(--dim); font-size:12px; }',
'  .knobs .k input { width:64px; padding:3px 5px; border:1px solid var(--line); border-radius:6px;',
'    background:var(--bg); color:inherit; font:inherit; font-size:13px; text-align:right; }',
'  .knobs .k input.moved { border-color:var(--acc); color:var(--acc); font-weight:700; }',
'  .knobs .shared { color:var(--dim); font-size:12px; }',
'  details.arch { margin-top:22px; color:var(--dim); font-size:13px; }',
'  .foot { position:fixed; left:0; right:0; bottom:0; background:var(--panel); border-top:1px solid var(--line);',
'    padding:9px 18px; display:flex; gap:9px; align-items:center; font-size:13px; }',
'  .foot .n { color:var(--dim); margin-right:auto; }',
'  #out { width:100%; box-sizing:border-box; height:190px; margin-top:12px; font-family:ui-monospace,Menlo,Consolas,monospace; font-size:12px; }',
'  @media (max-width:820px) { .card { grid-template-columns:48px 1fr; } .art,.noart { width:48px; height:48px; }',
'    .costs { grid-column:1 / -1; grid-template-columns:repeat(4,1fr); } .knobs { grid-column:1 / -1; } }',
'</style>',
'<div class="wrap">',
'<h1>Card tool</h1>',
'<p class="lede">Every card <b>currently in the game</b> — not archived, and with an effect behind it. Edit the',
'  costs, the description, what the ledger says it produces, and how many copies the deck opens with.',
'  Export, then <code>node scripts/apply-cards.mjs &lt;file.json&gt;</code> writes it all back into',
'  <code>index.html</code>. Edits are kept in this browser as you type.</p>',
'<p class="lede"><b>Descriptions that promise something new usually mean moving a number, not writing code.</b>',
'  Each card lists the <code>CONFIG.cards</code> knobs its effect actually reads, with their current values —',
'  edit those here too. Where a rewrite needs behaviour that no knob can express, say so in the card’s note',
'  and it rides along in the export.</p>',
'<div class="sum" id="sum"></div>',
'<div class="bar" id="bar"></div>',
'<div id="list"></div>',
'<details class="arch"><summary id="archsum">Archived cards</summary><p id="archlist"></p></details>',
'<textarea id="out" readonly hidden></textarea>',
'</div>',
'<div class="foot"><span class="n" id="nfoot"></span>',
'  <button class="btn ghost" id="reset">Reset all</button>',
'  <button class="btn ghost" id="show">Show JSON</button>',
'  <button class="btn" id="copy">Copy export</button></div>',
'<script>',
'const DATA = ' + JSON.stringify(PAYLOAD) + ';',
'const KEY = "mycelium.cardtool.v1";',
'const POOL_LABEL = ' + JSON.stringify(POOL_LABEL) + ';',
'// The four cost fields, in the order the card face prints them. buyCostEnergy is what you pay to',
'// PLAY or INSTALL; buyP is a Phosphorus install gate charged for any card type; costW/costP are',
'// the play cost, and for an ACTION card they are per activation rather than at install.',
'const COSTS = [',
'  ["buyCostEnergy", "\\u26a1 Energy", "to play / install"],',
'  ["buyP", "\\u2726 Phos", "install gate"],',
'  ["costW", "\\u25c6 Water", "to play"],',
'  ["costP", "\\u2726 Phos", "to play"],',
'];',
'let edits = {};',
'try { edits = JSON.parse(localStorage.getItem(KEY) || "{}") || {}; } catch (e) { edits = {}; }',
'if (!edits.cards) edits.cards = {};',
'if (!edits.config) edits.config = {};',
'if (!edits.notes) edits.notes = {};',
'const save = () => { try { localStorage.setItem(KEY, JSON.stringify(edits)); } catch (e) {} };',
'const cardOf = (n) => DATA.cards.find((c) => c.name === n);',
'const val = (c, f) => (edits.cards[c.name] && edits.cards[c.name][f] !== undefined ? edits.cards[c.name][f] : c[f]);',
'const cfgVal = (k) => (edits.config[k] !== undefined ? edits.config[k] : DATA.config[k]);',
'const setField = (c, f, v) => {',
'  const e = edits.cards[c.name] || (edits.cards[c.name] = {});',
'  if (v === c[f]) delete e[f]; else e[f] = v;',
'  if (!Object.keys(e).length) delete edits.cards[c.name];',
'  save();',
'};',
'const dirty = (c) => !!edits.cards[c.name] || !!(edits.notes[c.name] || "").trim();',
'// ROUNDS -> SECONDS, the same rewrite `timeify` does in real time. Kept in step with the game by',
'// `tests/card-tool-check.cjs`, which runs both over the same strings — a preview that drifts from',
'// the real one is worse than no preview, because it is the thing being trusted while writing.',
'const RS = 10;',
'function timeify(t) {',
'  if (!t) return t;',
'  return String(t)',
'    .replace(/(\\d+(?:\\.\\d+)?)\\s*\\b(rounds?|turns?)\\b/gi, function (m, n) {',
'      // EXACTLY `roundsToTime`: "min" only at 120s and up, and only on a whole minute. Written',
'      // out rather than approximated because the whole point of the preview is being trusted.',
'      const s = Math.round((+n || 0) * RS);',
'      return (s >= 120 && s % 60 === 0) ? (s / 60) + " min" : s + "s";',
'    })',
'    .replace(/\\/\\s*\\b(round|turn)\\b/gi, "/" + RS + "s")',
'    .replace(/\\b(every|per|each|a)\\s+\\b(round|turn)\\b/gi, function (m, w) { return w + " " + RS + "s"; });',
'}',
'let filter = { q: "", pool: "", changed: false };',
'function matches(c) {',
'  if (filter.pool && c.pool !== filter.pool) return false;',
'  if (filter.changed && !dirty(c)) return false;',
'  if (filter.q) {',
'    const h = (c.name + " " + c.category + " " + c.family + " " + val(c, "effect")).toLowerCase();',
'    if (h.indexOf(filter.q) < 0) return false;',
'  }',
'  return true;',
'}',
'const el = (t, cls, txt) => { const n = document.createElement(t); if (cls) n.className = cls; if (txt != null) n.textContent = txt; return n; };',
'function buildBar() {',
'  const bar = document.getElementById("bar");',
'  bar.innerHTML = "";',
'  const s = el("input"); s.type = "search"; s.placeholder = "Search name, text, family\\u2026"; s.id = "q";',
'  s.addEventListener("input", () => { filter.q = s.value.trim().toLowerCase(); render(); });',
'  bar.appendChild(s);',
'  const pools = [""].concat(Array.from(new Set(DATA.cards.map((c) => c.pool))));',
'  for (const p of pools) {',
'    const b = el("button", "chip" + (filter.pool === p ? " on" : ""), p ? (POOL_LABEL[p] || p) : "All");',
'    b.dataset.pool = p;',
'    b.addEventListener("click", () => { filter.pool = p; render(); });',
'    bar.appendChild(b);',
'  }',
'  const ch = el("button", "chip" + (filter.changed ? " on" : ""), "Changed only");',
'  ch.id = "changed";',
'  ch.addEventListener("click", () => { filter.changed = !filter.changed; render(); });',
'  bar.appendChild(ch);',
'  bar.appendChild(el("span", "count", "")).id = "count";',
'}',
'function numInput(get, set, cls) {',
'  const i = el("input"); i.type = "number"; i.step = "any"; i.value = get();',
'  if (cls) i.className = cls;',
'  i.addEventListener("input", () => { set(i.value === "" ? 0 : +i.value); render(); });',
'  return i;',
'}',
'function cardRow(c) {',
'  const root = el("div", "card" + (dirty(c) ? " dirty" : ""));',
'  root.dataset.card = c.name;',
'  if (c.art) { const a = el("img", "art"); a.src = c.art; a.alt = ""; root.appendChild(a); }',
'  else root.appendChild(el("div", "noart"));',
'  const mid = el("div");',
'  mid.appendChild(el("div", "nm", c.name));',
'  const tags = el("div", "tags");',
'  tags.appendChild(el("span", "tag pool", POOL_LABEL[c.pool] || c.pool));',
'  if (c.type !== c.pool) tags.appendChild(el("span", "tag", "type " + c.type));',
'  tags.appendChild(el("span", "tag", c.category));',
'  tags.appendChild(el("span", "tag", c.timing));',
'  if (c.threat && c.threat !== "none") tags.appendChild(el("span", "tag", "vs " + c.threat));',
'  mid.appendChild(tags);',
'  const ta = el("textarea"); ta.rows = 2; ta.value = val(c, "effect"); ta.dataset.field = "effect";',
'  ta.addEventListener("input", () => { setField(c, "effect", ta.value); rt.innerHTML = rtHTML(ta.value); root.className = "card" + (dirty(c) ? " dirty" : ""); });',
'  mid.appendChild(ta);',
'  const rt = el("p", "rt");',
'  const rtHTML = (t) => { const o = timeify(t); return o === t ? "reads the same in real time" : "real time: <b>" + o.replace(/[&<>]/g, (m) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[m])) + "</b>"; };',
'  rt.innerHTML = rtHTML(ta.value);',
'  mid.appendChild(rt);',
'  const prow = el("div", "row");',
'  prow.appendChild(el("label", "", "Ledger line"));',
'  const pi = el("input"); pi.type = "text"; pi.value = val(c, "produces"); pi.placeholder = "(nothing shown in the ledger)"; pi.dataset.field = "produces";',
'  pi.addEventListener("input", () => { setField(c, "produces", pi.value); root.className = "card" + (dirty(c) ? " dirty" : ""); });',
'  prow.appendChild(pi);',
'  mid.appendChild(prow);',
'  const nrow = el("div", "row");',
'  nrow.appendChild(el("label", "", "Behaviour note"));',
'  const nt = el("textarea", "note"); nt.rows = 1; nt.value = edits.notes[c.name] || "";',
'  nt.placeholder = "what this wording needs the card to DO that no knob covers";',
'  nt.dataset.field = "note";',
'  nt.addEventListener("input", () => { if (nt.value.trim()) edits.notes[c.name] = nt.value; else delete edits.notes[c.name]; save(); root.className = "card" + (dirty(c) ? " dirty" : ""); });',
'  nrow.appendChild(nt); nrow.lastChild.style.flex = "1 1 100%";',
'  mid.appendChild(nrow);',
'  root.appendChild(mid);',
'  const costs = el("div", "costs");',
'  for (const [f, label, hint] of COSTS) {',
'    const box = el("div", "cost");',
'    const lab = el("span"); lab.innerHTML = "<b>" + label + "</b><br>" + hint;',
'    box.appendChild(lab);',
'    box.appendChild(numInput(() => val(c, f), (v) => setField(c, f, Math.max(0, Math.round(v))), val(c, f) !== c[f] ? "moved" : ""));',
'    costs.appendChild(box);',
'  }',
'  const sc = el("div", "cost");',
'  const scl = el("span"); scl.innerHTML = "<b>Opening copies</b><br>in the starting deck";',
'  sc.appendChild(scl);',
'  sc.appendChild(numInput(() => val(c, "startCopies"), (v) => setField(c, "startCopies", Math.max(0, Math.round(v))), val(c, "startCopies") !== c.startCopies ? "moved" : ""));',
'  sc.style.gridColumn = "1 / -1";',
'  costs.appendChild(sc);',
'  root.appendChild(costs);',
'  if (c.knobs.length) {',
'    const kb = el("div", "knobs");',
'    kb.appendChild(el("h4", "", "This effect reads"));',
'    for (const k of c.knobs) {',
'      const users = DATA.cards.filter((o) => o.knobs.indexOf(k) >= 0).length;',
'      const w = el("span", "k");',
'      w.appendChild(el("code", "", "cards." + k));',
'      w.appendChild(numInput(() => cfgVal(k), (v) => { if (v === DATA.config[k]) delete edits.config[k]; else edits.config[k] = v; save(); }, cfgVal(k) !== DATA.config[k] ? "moved" : ""));',
'      if (users > 1) w.appendChild(el("span", "shared", "shared with " + (users - 1) + " other"));',
'      kb.appendChild(w);',
'    }',
'    root.appendChild(kb);',
'  }',
'  return root;',
'}',
'function exportObj() {',
'  const out = { format: "mycelium-cards", cards: {}, config: {}, notes: {} };',
'  for (const n of Object.keys(edits.cards)) out.cards[n] = Object.assign({}, edits.cards[n]);',
'  for (const k of Object.keys(edits.config)) out.config[k] = edits.config[k];',
'  for (const n of Object.keys(edits.notes)) if ((edits.notes[n] || "").trim()) out.notes[n] = edits.notes[n];',
'  return out;',
'}',
'// The pool summary. Every number is derived from the CURRENT values (edits included), so the',
'// strip answers "what did that cost change do to the pool?" while the change is being made.',
'const MEDIAN = (a) => { if (!a.length) return 0; const s = a.slice().sort((x, y) => x - y); const m = s.length >> 1;',
'  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };',
'function buildSummary() {',
'  const host = document.getElementById("sum");',
'  host.innerHTML = "";',
'  const pools = Array.from(new Set(DATA.cards.map((c) => c.pool)));',
'  for (const p of pools) {',
'    const cs = DATA.cards.filter((c) => c.pool === p);',
'    const box = el("div", "sump");',
'    box.dataset.pool = p;',
'    box.appendChild(el("h3", "", POOL_LABEL[p] || p));',
'    const edited = cs.filter(dirty).length;',
'    box.appendChild(el("div", "n", cs.length + " cards" + (edited ? " \u00b7 " + edited + " edited" : "")));',
'    const dl = el("dl");',
'    for (const [f, label] of [["buyCostEnergy", "\u26a1 Energy"], ["costW", "\u25c6 Water"], ["costP", "\u2726 Phos"]]) {',
'      const vs = cs.map((c) => +val(c, f) || 0);',
'      const hi = Math.max(1, ...vs);',
'      dl.appendChild(el("dt", "", label));',
'      // One bar per card, sorted, so the shape reads as a curve: how many are free, where it',
'      // climbs, and whether one card sits far out on its own.',
'      const sp = el("div", "spark");',
'      const sorted = vs.slice().sort((a, b) => a - b);',
'      for (const v of sorted) { const i = el("i"); i.style.height = Math.round(2 + (v / hi) * 7) + "px"; if (v === hi && hi > 0) i.className = "hot"; sp.appendChild(i); }',
'      dl.appendChild(sp);',
'      const nz = vs.filter((v) => v > 0);',
'      dl.appendChild(el("dd", "", nz.length ? "med " + MEDIAN(nz) + " \u00b7 max " + hi : "all free"));',
'    }',
'    box.appendChild(dl);',
'    host.appendChild(box);',
'  }',
'}',
'function render() {',
'  buildBar();',
'  buildSummary();',
'  const list = document.getElementById("list");',
'  list.innerHTML = "";',
'  const shown = DATA.cards.filter(matches);',
'  for (const c of shown) list.appendChild(cardRow(c));',
'  const nEdit = Object.keys(edits.cards).length;',
'  const nCfg = Object.keys(edits.config).length;',
'  const nNote = Object.keys(edits.notes).length;',
'  document.getElementById("count").textContent = shown.length + " of " + DATA.cards.length + " cards";',
'  document.getElementById("nfoot").textContent = nEdit + " card(s) edited \\u00b7 " + nCfg + " knob(s) moved \\u00b7 " + nNote + " note(s)";',
'  const o = document.getElementById("out");',
'  if (!o.hidden) o.value = JSON.stringify(exportObj(), null, 2);',
'}',
'document.getElementById("archsum").textContent = "Archived cards (" + DATA.archived.length + ") \\u2014 not in the game, not editable here";',
'document.getElementById("archlist").textContent = DATA.archived.join(" \\u00b7 ");',
'document.getElementById("show").addEventListener("click", () => {',
'  const o = document.getElementById("out");',
'  o.hidden = !o.hidden;',
'  document.getElementById("show").textContent = o.hidden ? "Show JSON" : "Hide JSON";',
'  render();',
'});',
'document.getElementById("copy").addEventListener("click", async () => {',
'  const txt = JSON.stringify(exportObj(), null, 2);',
'  window.__cardExport = txt;   // ALWAYS, not only on failure: headless clipboard writes SUCCEED,',
'  try { await navigator.clipboard.writeText(txt); }   // so a check reading the clipboard proves nothing',
'  catch (e) { const o = document.getElementById("out"); o.hidden = false; o.value = txt; o.select(); }',
'  const b = document.getElementById("copy");',
'  b.textContent = "Copied"; setTimeout(() => { b.textContent = "Copy export"; }, 1200);',
'});',
'document.getElementById("reset").addEventListener("click", () => {',
'  if (!confirm("Throw away every edit on this page?")) return;',
'  edits = { cards: {}, config: {}, notes: {} }; save(); render();',
'});',
'// The hook a check drives the page through. Top-level `const` in a classic script lands in the',
'// global LEXICAL environment, not on `window` — so `window.DATA` is undefined while a bare `DATA`',
'// resolves, which is exactly the kind of difference a test discovers the slow way. Named instead.',
'window.__cardTool = { data: DATA, timeify: timeify, exportObj: exportObj, edits: function () { return edits; } };',
'render();',
'</script>',
].join('\n');

writeFileSync(OUT, page);
const kb = (page.length / 1024).toFixed(0);
console.log(`gen-card-tool: wrote docs/card-tool.html — ${ACTIVE.length} active cards (${CARDS.length - ACTIVE.length} archived), ${kb} KB`);
const withKnobs = ACTIVE.filter((c) => (knobsFor[c.name] || []).some((k) => k in CFG)).length;
console.log(`  ${withKnobs} of them read a CONFIG.cards knob; ${Object.keys(CFG).length} knobs in range.`);
