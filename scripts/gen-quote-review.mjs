#!/usr/bin/env node
// Generate docs/quote-review.html — yes / no / maybe / comment over every candidate quote.
//
//   node scripts/gen-quote-review.mjs
//
// Reads docs/quotes.json, which is the source of truth for the candidates. Same shape as the other
// two generated tools here (gen-card-review.mjs, gen-species-tool.mjs): the page is baked from the
// data, so re-running it is how the tool stops being stale, and it is self-contained because it is
// published as an Artifact under a CSP that blocks every external request.
//
// The page's job is to be FAST to weed with — 96 items is enough that a slow interaction is the
// difference between the owner doing it and not. Hence: keyboard (y / n / m, then any key to move
// on), a running tally, and filters that let a whole class be dismissed at once ("show me only the
// ones that need clearing").
//
// The export is `{ id: { verdict, comment } }` plus the accepted list ready to paste back.

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'docs', 'quote-review.html');
const data = JSON.parse(readFileSync(join(ROOT, 'docs', 'quotes.json'), 'utf8'));
const QUOTES = data.quotes || [];

const THEMES = {
  death: 'death, decay, renewal', climb: 'the climb out', journey: 'journeys',
  growth: 'growth', ground: 'the ground, and what is under it', mycology: 'mushrooms',
  dark: 'dark, patient, underground', endurance: 'endurance',
};
const ROUNDS = {
  1: ['Round 1', 'the first pass, written to stay clear of copyright'],
  2: ['Round 2', 'the unfiltered pass — numbering continues, so these are all new'],
  3: ['Round 3', 'written to your yeses: longer lines, addressed to you, deep cuts rather than the famous one, and the ground rather than the fungus'],
  4: ['Round 4', 'written to the STRUCTURE rather than the theme — every line has a turn in it (antithesis, chiasmus, a reversal, a qualification), which is what ten of your eighteen share. No orders, no place-writing, nothing under 50 characters bar one deliberate control'],
};

// The second round continued the numbering rather than starting over, so a few lines were offered
// twice. Flagging them here means the owner sees "same as #50" on the card instead of finding out
// after they have said yes to both.
const seen = new Map();
const norm = (s) => s.toLowerCase().replace(/[^a-z ]+/g, '').replace(/\s+/g, ' ').trim();
for (const q of QUOTES) {
  const k = norm(q.text);
  if (seen.has(k)) q.dupeOf = seen.get(k);
  else seen.set(k, q.id);
}

// Round first, then theme within it, then the order they were written in. Grouping by theme alone
// repeated every heading, because round 2 walks the same themes again.
const ORDER = Object.keys(THEMES);
QUOTES.sort((a, b) => (a.round - b.round)
  || (ORDER.indexOf(a.theme) - ORDER.indexOf(b.theme))
  || (a.id - b.id));
// `rights` is a note to the owner, not a gate — they have said they will clear what they keep.
const RIGHTS = {
  pd: ['free', 'public domain, or old enough to be'],
  c: ['clear it', 'still in copyright — needs permission'],
  check: ['check', 'attribution or wording I could not verify'],
  mine: ['not a quote', 'I wrote this — it has no source'],
};

const page = `<meta charset="utf-8">
<title>Mycelium &#8212; quotes for the level cards</title>
<style>
  :root {
    --bg:#0b1310; --panel:#111d18; --panel2:#0d1712; --line:rgba(126,240,192,0.16);
    --ink:#eaf4ee; --dim:#8fb3a4; --mint:#7ef0c0; --gold:#ffd479; --red:#e2766c; --violet:#c9a6ff;
  }
  @media (prefers-color-scheme: light) {
    :root { --bg:#f4f7f5; --panel:#fff; --panel2:#f0f4f1; --line:rgba(20,70,50,0.16);
            --ink:#12211b; --dim:#5d7a6c; --mint:#0f9b6c; --gold:#a97b12; --red:#b1483d; --violet:#6b46b8; }
  }
  :root[data-theme="dark"] { --bg:#0b1310; --panel:#111d18; --panel2:#0d1712; --line:rgba(126,240,192,0.16);
    --ink:#eaf4ee; --dim:#8fb3a4; --mint:#7ef0c0; --gold:#ffd479; --red:#e2766c; --violet:#c9a6ff; }
  :root[data-theme="light"] { --bg:#f4f7f5; --panel:#fff; --panel2:#f0f4f1; --line:rgba(20,70,50,0.16);
    --ink:#12211b; --dim:#5d7a6c; --mint:#0f9b6c; --gold:#a97b12; --red:#b1483d; --violet:#6b46b8; }
  * { box-sizing:border-box; }
  body { margin:0; padding:16px 14px 70px; background:var(--bg); color:var(--ink);
         font:14px/1.5 ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif; }
  .wrap { max-width:1000px; margin:0 auto; }
  h1 { font-size:21px; margin:0 0 4px; font-weight:800; }
  .sub { color:var(--dim); margin:0 0 14px; max-width:72ch; }
  kbd { font:inherit; font-size:11.5px; font-weight:700; border:1px solid var(--line); border-radius:5px;
        padding:1px 6px; background:var(--panel2); }

  .bar { position:sticky; top:0; z-index:9; background:var(--bg); border-bottom:1px solid var(--line);
         padding:8px 0 9px; margin-bottom:12px; display:flex; gap:8px; flex-wrap:wrap; align-items:center; }
  .chip { border:1px solid var(--line); border-radius:999px; padding:4px 10px; font-size:12px;
          font-weight:700; background:var(--panel); white-space:nowrap; }
  .chip.y { color:var(--mint); } .chip.m { color:var(--gold); } .chip.n { color:var(--dim); }
  .btn { font:inherit; font-size:12.5px; font-weight:700; cursor:pointer; border-radius:8px;
         padding:6px 12px; border:1px solid var(--line); background:var(--panel); color:var(--ink); }
  .btn:hover { border-color:var(--mint); }
  .btn.pri { background:var(--mint); color:#06231a; border-color:var(--mint); }
  .btn[aria-pressed="true"] { background:var(--panel2); border-color:var(--mint); color:var(--mint); }
  .spacer { flex:1 1 auto; }

  .q { background:var(--panel); border:1px solid var(--line); border-left-width:4px;
       border-left-color:var(--line); border-radius:11px; padding:11px 13px; margin:0 0 9px; }
  .q.v-yes   { border-left-color:var(--mint); }
  .q.v-maybe { border-left-color:var(--gold); }
  .q.v-no    { opacity:.5; border-left-color:var(--dim); }
  .q.cur { outline:2px solid var(--mint); outline-offset:2px; }
  .qtop { display:flex; gap:10px; align-items:flex-start; }
  .qn { font-family:ui-monospace,SFMono-Regular,Menlo,monospace; font-size:11.5px; color:var(--dim);
        flex:0 0 auto; padding-top:4px; min-width:2.2em; text-align:right; }
  .qtext { flex:1 1 auto; font-family:Georgia,"Times New Roman",serif; font-size:16.5px; line-height:1.5; }
  .qmeta { color:var(--dim); font-size:12.5px; margin-top:4px; }
  .qmeta b { color:var(--ink); font-weight:600; }
  .tag { font-size:10px; font-weight:700; letter-spacing:.06em; text-transform:uppercase;
         border:1px solid var(--line); border-radius:999px; padding:1px 7px; margin-left:6px; }
  .tag.r-c { color:var(--gold); border-color:color-mix(in srgb, var(--gold) 45%, transparent); }
  .tag.r-check { color:var(--violet); border-color:color-mix(in srgb, var(--violet) 45%, transparent); }
  .tag.r-mine { color:var(--red); border-color:color-mix(in srgb, var(--red) 45%, transparent); }
  .qnote { color:var(--dim); font-size:12px; font-style:italic; margin-top:3px; }
  .qacts { display:flex; gap:6px; align-items:center; margin-top:9px; flex-wrap:wrap; }
  .vb { font:inherit; font-size:12.5px; font-weight:700; cursor:pointer; border-radius:8px;
        padding:5px 13px; border:1px solid var(--line); background:var(--panel2); color:var(--dim); }
  .vb:hover { color:var(--ink); }
  .vb.yes[aria-pressed="true"]   { background:var(--mint); color:#06231a; border-color:var(--mint); }
  .vb.maybe[aria-pressed="true"] { background:var(--gold); color:#2b1c00; border-color:var(--gold); }
  .vb.no[aria-pressed="true"]    { background:var(--panel); color:var(--ink); border-color:var(--ink); }
  .qc { flex:1 1 240px; min-width:0; font:inherit; font-size:13px; padding:6px 9px; border-radius:8px;
        border:1px solid var(--line); background:var(--panel2); color:var(--ink); }
  .qc::placeholder { color:var(--dim); }

  .grp { font-size:11px; letter-spacing:.15em; text-transform:uppercase; color:var(--mint);
         font-weight:700; margin:20px 0 8px; display:flex; align-items:center; gap:9px; }
  .grp .rule { flex:1 1 auto; height:1px; background:var(--line); }
  .rnd { margin:30px 0 4px; padding-top:14px; border-top:2px solid var(--line); }
  .rnd:first-child { margin-top:6px; border-top:0; padding-top:0; }
  .rnd h2 { font-size:17px; font-weight:800; margin:0; }
  .rnd p { color:var(--dim); font-size:12.5px; margin:2px 0 0; }
  .dupe { color:var(--red); font-size:12px; font-weight:700; margin-top:3px; }
  details { margin-top:20px; border:1px solid var(--line); border-radius:11px; background:var(--panel); padding:11px 13px; }
  summary { cursor:pointer; font-weight:800; }
  #out { width:100%; min-height:220px; font:12px/1.5 ui-monospace,SFMono-Regular,Menlo,monospace;
         padding:10px; border-radius:10px; border:1px solid var(--line); background:var(--panel2);
         color:var(--ink); white-space:pre; overflow:auto; margin-top:8px; }
  .note { color:var(--dim); font-size:12.5px; }
  @media (max-width:640px) { .qn { display:none; } .qtext { font-size:15px; } }
</style>

<div class="wrap">
  <h1>Quotes for the level cards</h1>
  <p class="sub">${new Set(QUOTES.map((q) => q.round)).size} rounds, ${QUOTES.length} in all. Yes, no, maybe, or a comment on each. Click a card
  to select it, then <kbd>Y</kbd> <kbd>N</kbd> <kbd>M</kbd> to judge and move to the next — or just use
  the buttons. Everything is kept in this browser as you go; press <b>Export</b> when you are done.
  The rights tags are a note about what would need clearing, not a filter.${
  QUOTES.some((q) => q.verdict) ? ' Your last pass is already loaded — <b>Maybes</b> is the natural second cut.' : ''}</p>

  <div class="bar">
    <span class="chip y" id="cY">yes 0</span>
    <span class="chip m" id="cM">maybe 0</span>
    <span class="chip n" id="cN">no 0</span>
    <span class="chip" id="cLeft">unjudged ${QUOTES.length}</span>
    <span class="spacer"></span>
    <button class="btn" id="fAll" type="button" aria-pressed="true">All</button>
    <button class="btn" id="fR1" type="button" aria-pressed="false">Round 1</button>
    <button class="btn" id="fR2" type="button" aria-pressed="false">Round 2</button>
    <button class="btn" id="fR3" type="button" aria-pressed="false">Round 3</button>
    <button class="btn" id="fR4" type="button" aria-pressed="false">Round 4</button>
    <button class="btn" id="fMaybe" type="button" aria-pressed="false">Maybes</button>
    <button class="btn" id="fLeft" type="button" aria-pressed="false">Unjudged</button>
    <button class="btn" id="bReset" type="button">Clear all</button>
    <button class="btn pri" id="bExport" type="button">Export</button>
  </div>

  <div id="list"></div>

  <details id="exportBox">
    <summary>Export</summary>
    <p class="note">Copy this back to me, or save it and I will apply it. It carries every verdict and
    comment, plus the accepted quotes in the order they appear.</p>
    <button class="btn" id="bCopy" type="button">Copy JSON</button>
    <textarea id="out" readonly></textarea>
  </details>
</div>

<script>
const QUOTES = ${JSON.stringify(QUOTES)};
const THEMES = ${JSON.stringify(THEMES)};
const ROUNDS = ${JSON.stringify(ROUNDS)};
const RIGHTS = ${JSON.stringify(RIGHTS)};
const KEY = 'mycelium.quoteReview.v1';

let V = load();                 // { id: { verdict, comment } }
let filter = 'all';
let cur = null;                 // id of the selected card, for the keyboard

// A verdict already recorded in docs/quotes.json seeds the page, so a second pass opens where the
// last one finished instead of blank. The stored copy WINS when there is one — this browser is
// mid-pass. Clear all writes an empty object rather than removing the key, or a wipe would seed
// itself straight back from the data on the next reload.
function load() {
  try { const raw = JSON.parse(localStorage.getItem(KEY) || 'null'); if (raw && typeof raw === 'object') return raw; } catch (_) {}
  const seed = {};
  for (const q of QUOTES) if (q.verdict) seed[q.id] = { verdict: q.verdict };
  return seed;
}
function save() { try { localStorage.setItem(KEY, JSON.stringify(V)); } catch (_) {} }
const el = (t, c, txt) => { const n = document.createElement(t); if (c) n.className = c; if (txt != null) n.textContent = txt; return n; };
const verdictOf = (id) => (V[id] && V[id].verdict) || null;

function setVerdict(id, v, advance) {
  const was = verdictOf(id);
  // The list is read BEFORE the verdict lands: under the Unjudged filter, judging a card removes it
  // from visible(), so asking afterwards where it was returns -1 and "the next one" is the top of
  // the page. This is the whole reason the keyboard pass is usable at all.
  // (No backticks in here — the whole page is one template literal in the generator.)
  const shown = visible();
  V[id] = V[id] || {};
  V[id].verdict = (was === v) ? null : v;   // clicking the same verdict again clears it
  save();
  if (advance && V[id].verdict) {
    const i = shown.findIndex((q) => q.id === id);
    const next = shown[i + 1];
    cur = next ? next.id : null;
  }
  render();
  if (cur != null) {
    const node = document.querySelector('.q.cur');
    if (node) node.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }
}
function visible() {
  return QUOTES.filter((q) => {
    if (filter === 'left') return !verdictOf(q.id);
    if (filter === 'r1') return q.round === 1;
    if (filter === 'r2') return q.round === 2;
    if (filter === 'r3') return q.round === 3;
    if (filter === 'r4') return q.round === 4;
    if (filter === 'maybe') return verdictOf(q.id) === 'maybe';
    return true;
  });
}

function render() {
  const list = document.getElementById('list');
  list.textContent = '';
  let lastTheme = null, lastRound = null;
  for (const q of visible()) {
    if (q.round !== lastRound) {
      lastRound = q.round; lastTheme = null;
      const r = ROUNDS[q.round] || ['Round ' + q.round, ''];
      const box = el('div', 'rnd');
      box.appendChild(el('h2', null, r[0]));
      if (r[1]) box.appendChild(el('p', null, r[1]));
      list.appendChild(box);
    }
    if (q.theme !== lastTheme) {
      lastTheme = q.theme;
      const h = el('div', 'grp');
      h.appendChild(el('span', null, THEMES[q.theme] || q.theme));
      h.appendChild(el('span', 'rule'));
      list.appendChild(h);
    }
    const v = verdictOf(q.id);
    const card = el('div', 'q' + (v ? ' v-' + v : '') + (cur === q.id ? ' cur' : ''));
    card.onclick = (e) => { if (e.target.tagName === 'INPUT' || e.target.tagName === 'BUTTON') return; cur = q.id; render(); };

    const top = el('div', 'qtop');
    top.appendChild(el('div', 'qn', String(q.id)));
    const mid = el('div');
    mid.appendChild(el('div', 'qtext', '\\u201C' + q.text + '\\u201D'));
    const meta = el('div', 'qmeta');
    const who = el('b', null, q.author || 'unknown');
    meta.appendChild(who);
    const bits = [q.work, q.year ? (q.year < 0 ? Math.abs(q.year) + ' BC' : String(q.year)) : ''].filter(Boolean);
    if (bits.length) meta.appendChild(el('span', null, ' \\u00B7 ' + bits.join(', ')));
    const r = RIGHTS[q.rights] || ['', ''];
    if (q.rights !== 'pd') {
      const tag = el('span', 'tag r-' + q.rights, r[0]);
      tag.title = r[1];
      meta.appendChild(tag);
    }
    mid.appendChild(meta);
    if (q.dupeOf) mid.appendChild(el('div', 'dupe', 'Same line as #' + q.dupeOf + ' above.'));
    if (q.note) mid.appendChild(el('div', 'qnote', q.note));
    top.appendChild(mid);
    card.appendChild(top);

    const acts = el('div', 'qacts');
    for (const [name, label] of [['yes', 'Yes'], ['maybe', 'Maybe'], ['no', 'No']]) {
      const b = el('button', 'vb ' + name, label);
      b.type = 'button';
      b.setAttribute('aria-pressed', v === name ? 'true' : 'false');
      b.onclick = () => { cur = q.id; setVerdict(q.id, name, true); };
      acts.appendChild(b);
    }
    const c = el('input', 'qc');
    c.type = 'text'; c.placeholder = 'comment\\u2026';
    c.value = (V[q.id] && V[q.id].comment) || '';
    c.oninput = () => { V[q.id] = V[q.id] || {}; V[q.id].comment = c.value; save(); status(); };
    c.onfocus = () => { cur = q.id; };
    acts.appendChild(c);
    card.appendChild(acts);
    list.appendChild(card);
  }
  status();
}

function status() {
  const n = (v) => QUOTES.filter((q) => verdictOf(q.id) === v).length;
  document.getElementById('cY').textContent = 'yes ' + n('yes');
  document.getElementById('cM').textContent = 'maybe ' + n('maybe');
  document.getElementById('cN').textContent = 'no ' + n('no');
  document.getElementById('cLeft').textContent = 'unjudged ' + QUOTES.filter((q) => !verdictOf(q.id)).length;
  document.getElementById('out').value = JSON.stringify(exportModel(), null, 2);
}

// The export carries the WHOLE judgement, not only the winners: a "no" with a comment is the most
// useful thing in a weeding pass, and a maybe-pile is what the next round works from.
function exportModel() {
  const verdicts = {};
  for (const q of QUOTES) {
    const e = V[q.id];
    if (!e || (!e.verdict && !e.comment)) continue;
    verdicts[q.id] = {};
    if (e.verdict) verdicts[q.id].verdict = e.verdict;
    if (e.comment) verdicts[q.id].comment = e.comment;
  }
  const pick = (v) => QUOTES.filter((q) => verdictOf(q.id) === v)
    .map((q) => ({ id: q.id, round: q.round, text: q.text, author: q.author,
                   work: q.work || undefined, year: q.year || undefined, rights: q.rights }));
  return { format: 'mycelium-quote-review', version: 1, verdicts, accepted: pick('yes'), maybe: pick('maybe') };
}

document.getElementById('bExport').onclick = () => {
  document.getElementById('exportBox').open = true;
  status();
  document.getElementById('exportBox').scrollIntoView({ behavior: 'smooth', block: 'start' });
};
document.getElementById('bCopy').onclick = async () => {
  const t = document.getElementById('out');
  t.select();
  try { await navigator.clipboard.writeText(t.value); } catch (_) { document.execCommand('copy'); }
  const b = document.getElementById('bCopy'); const was = b.textContent;
  b.textContent = 'Copied'; setTimeout(() => { b.textContent = was; }, 1200);
};
document.getElementById('bReset').onclick = () => {
  if (!confirm('Throw away every verdict and comment, including the ones already recorded?')) return;
  V = {}; save(); cur = null; render();
};
const FILTERS = [['fAll', 'all'], ['fR1', 'r1'], ['fR2', 'r2'], ['fR3', 'r3'], ['fR4', 'r4'], ['fMaybe', 'maybe'], ['fLeft', 'left']];
for (const [id, f] of FILTERS) {
  document.getElementById(id).onclick = () => {
    filter = f;
    cur = null;
    for (const [i2] of FILTERS) document.getElementById(i2).setAttribute('aria-pressed', i2 === id ? 'true' : 'false');
    render();
  };
}
// Y / N / M judge the selected card and step to the next. Ignored while typing a comment, or the
// first letter of every comment would be a verdict.
document.addEventListener('keydown', (e) => {
  if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA')) return;
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  const shown = visible();
  if (!shown.length) return;
  if (cur == null) cur = shown[0].id;
  const k = e.key.toLowerCase();
  if (k === 'y' || k === 'n' || k === 'm') {
    e.preventDefault();
    setVerdict(cur, k === 'y' ? 'yes' : k === 'n' ? 'no' : 'maybe', true);
  } else if (k === 'arrowdown' || k === 'j') {
    e.preventDefault();
    const i = shown.findIndex((q) => q.id === cur);
    cur = (shown[i + 1] || shown[shown.length - 1]).id; render();
    const node = document.querySelector('.q.cur'); if (node) node.scrollIntoView({ block: 'center' });
  } else if (k === 'arrowup' || k === 'k') {
    e.preventDefault();
    const i = shown.findIndex((q) => q.id === cur);
    cur = (shown[Math.max(0, i - 1)] || shown[0]).id; render();
    const node = document.querySelector('.q.cur'); if (node) node.scrollIntoView({ block: 'center' });
  }
});
render();
</script>
`;

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, page);
const by = (k) => QUOTES.reduce((a, q) => (a[q[k]] = (a[q[k]] || 0) + 1, a), {});
console.log(`wrote docs/quote-review.html — ${QUOTES.length} quotes, ${(page.length / 1024).toFixed(0)} KB`);
console.log('  rounds:', JSON.stringify(by('round')));
if (QUOTES.some((q) => q.verdict)) {
  const v = by('verdict');
  if (v.undefined != null) { v.unjudged = v.undefined; delete v.undefined; }   // a new round has none yet
  console.log('  verdicts:', JSON.stringify(v));
}
console.log('  rights:', JSON.stringify(by('rights')));
console.log('  themes:', JSON.stringify(by('theme')));
const dupes = QUOTES.filter((q) => q.dupeOf);
if (dupes.length) console.log('  duplicates flagged:', dupes.map((q) => `#${q.id}=#${q.dupeOf}`).join(', '));
