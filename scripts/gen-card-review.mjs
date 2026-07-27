#!/usr/bin/env node
// Generate docs/card-review.html — a balance-review tool for the real-time card timings.
//
// Reads the generated CARD_DATA straight out of index.html (the single source of truth), works
// out each card's cadence, converts it from ROUNDS into the seconds the game now actually uses
// (cards.roundSeconds), and writes a self-contained page. The page lets the owner mark each
// card as "keep the timer" or "N× per level" and export those decisions as JSON.
//
//   node scripts/gen-card-review.mjs
//
// Re-run it whenever the card data or roundSeconds changes.

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const html = readFileSync(join(ROOT, 'index.html'), 'utf8');

// --- pull the data + the round length out of the game ------------------------
const cardsMatch = html.match(/const CARD_DATA = (\[[\s\S]*?\n\]);/);
if (!cardsMatch) throw new Error('CARD_DATA not found in index.html');
const CARDS = JSON.parse(cardsMatch[1]);

const rsMatch = html.match(/roundSeconds:\s*(\d+(?:\.\d+)?)/);
const ROUND_SECONDS = rsMatch ? Number(rsMatch[1]) : 10;

const stepMatch = html.match(/stepMs:\s*(\d+)/);
const STEP_MS = stepMatch ? Number(stepMatch[1]) : 500;

// --- rounds → seconds, mirroring the in-game rewriter -----------------------
const secs = (rounds) => Math.round(Number(rounds || 0) * ROUND_SECONDS);
const timeStr = (rounds) => {
  const s = secs(rounds);
  return s >= 120 && s % 60 === 0 ? `${s / 60} min` : `${s}s`;
};
const timeify = (text) => String(text || '')
  .replace(/(\d+(?:\.\d+)?)\s*\b(rounds?|turns?)\b/gi, (_m, n) => timeStr(n))
  .replace(/\/\s*\b(round|turn)\b/gi, `/${ROUND_SECONDS}s`)
  .replace(/\b(every|per|each|a)\s+\b(round|turn)\b/gi, (_m, w) => `${w} ${ROUND_SECONDS}s`);

// --- classify each card's timing ---------------------------------------------
// cooldown  — "Once per N rounds" : a use-ability's wait. The prime candidate for N×/level.
// income    — "every N rounds"    : a producer's payout interval.
// duration  — "for N rounds"      : how long an effect lasts (NOT a uses-per-level thing).
// modifier  — "N rounds faster"   : shortens ANOTHER card's wait, so it has no cadence of its
//                                   own — but it stops meaning anything for a card moved onto
//                                   uses-per-level, which is worth seeing while deciding.
function timing(card) {
  const t = `${card.effect || ''} ${card.produces || ''}`;
  const num = (re) => { const m = t.match(re); return m ? Number(m[1]) : null; };
  const cooldown = num(/once per\s+(\d+)\s*rounds?/i) ?? (/once per round/i.test(t) ? 1 : null);
  const income = num(/every\s+(\d+)\s*(?:rounds?|turns?)/i) ?? (/every\s+(?:round|turn)\b/i.test(t) ? 1 : null);
  const duration = num(/for\s+(\d+)\s*rounds?/i);
  const modifier = num(/(\d+)\s*rounds?\s+faster/i);
  const kind = cooldown != null ? 'cooldown' : income != null ? 'income'
    : duration != null ? 'duration' : modifier != null ? 'modifier' : 'none';
  const rounds = cooldown ?? income ?? duration ?? modifier ?? null;
  return { kind, rounds, cooldown, income, duration, modifier };
}

const rows = CARDS.map((c) => {
  const tm = timing(c);
  return {
    name: c.name,
    type: c.type,
    cat: c.displayCategory || c.type,
    family: c.family || '',
    threat: c.threat || 'none',
    energy: c.buyCostEnergy || 0,
    buyP: c.buyP || 0,
    w: c.costW || 0,
    p: c.costP || 0,
    effect: timeify(c.effect),
    raw: c.effect || '',
    produces: timeify(c.produces),
    kind: tm.kind,
    rounds: tm.rounds,
    seconds: tm.rounds != null ? secs(tm.rounds) : null,
    label: tm.rounds != null ? timeStr(tm.rounds) : '',
    // A rough "how often could this fire in a 2-minute level" cue for the reviewer.
    per2min: tm.rounds != null && tm.rounds > 0 ? +(120 / secs(tm.rounds)).toFixed(1) : null,
  };
}).sort((a, b) => {
  // Most-fireable first: the whole point of the review is to find what's overpowered on a
  // clock, so the shortest cadences lead, cooldowns before income, untimed cards last.
  const order = { cooldown: 0, income: 1, duration: 2, modifier: 3, none: 4 };
  if (order[a.kind] !== order[b.kind]) return order[a.kind] - order[b.kind];
  return (a.seconds ?? 1e9) - (b.seconds ?? 1e9) || a.name.localeCompare(b.name);
});

// Severity: how many times it can fire in a 2-minute level. 4+ is the "look at this" band.
const sev = (r) => (r.per2min == null || r.kind === 'duration' || r.kind === 'modifier') ? null
  : r.per2min >= 6 ? 'high' : r.per2min >= 3 ? 'mid' : 'low';
for (const r of rows) r.sev = sev(r);
const hotCount = rows.filter((r) => r.sev === 'high').length;
const midCount = rows.filter((r) => r.sev === 'mid').length;

const timedCount = rows.filter((r) => r.kind !== 'none').length;

// --- the page ----------------------------------------------------------------
const page = `<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Mycelium RT — card timing review</title>
<style>
  :root {
    --bg: #0a0e14; --panel: #131a24; --panel-2: #0f151d; --line: #243040;
    --ink: #dce7df; --dim: #8fa398; --accent: #7fe6a3; --warn: #e0a85a;
    --water: #7fd0e0; --phos: #c79be6; --energy: #7fe6a3; --danger: #e06a6a;
  }
  * { box-sizing: border-box; }
  /* The game's own display serif, so the tool reads as part of it; system faces only, since
     the artifact CSP blocks font CDNs and a silent fallback would undo the pairing. */
  :root { --serif: "Iowan Old Style", "Palatino Linotype", Palatino, "Book Antiqua", Georgia, serif;
          --mono: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; }
  body { margin: 0; background: var(--bg); color: var(--ink);
    font: 14px/1.55 ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif; }
  h1, .sum-n { font-family: var(--serif); font-weight: 600; }
  a { color: var(--accent); }
  .wrap { max-width: 1180px; margin: 0 auto; padding: 22px 18px 120px; }
  h1 { font-size: 25px; margin: 0 0 5px; letter-spacing: .005em; text-wrap: balance; }

  /* Summary before detail: what needs attention, in form as well as number. */
  .sum { display: flex; gap: 10px; flex-wrap: wrap; margin: 0 0 16px; }
  .sum > div { background: var(--panel); border: 1px solid var(--line); border-radius: 10px;
    padding: 10px 14px; min-width: 116px; }
  .sum-n { font-size: 23px; line-height: 1.1; font-variant-numeric: tabular-nums; }
  .sum-l { font-size: 11.5px; letter-spacing: .07em; text-transform: uppercase; color: var(--dim); margin-top: 3px; }
  .sum .hi .sum-n { color: var(--danger); }
  .sum .md .sum-n { color: var(--warn); }
  .sum .dn .sum-n { color: var(--accent); }

  .sevpill { font-family: var(--mono); font-size: 10.5px; letter-spacing: .04em; border-radius: 5px;
    padding: 1px 6px; border: 1px solid var(--line); color: var(--dim); }
  .sevpill.high { color: var(--danger); border-color: rgba(224,106,106,.45); background: rgba(224,106,106,.10); }
  .sevpill.mid { color: var(--warn); border-color: rgba(224,168,90,.42); background: rgba(224,168,90,.08); }
  .card.sev-high { border-left: 3px solid rgba(224,106,106,.65); }
  .card.sev-mid { border-left: 3px solid rgba(224,168,90,.55); }
  .sub { color: var(--dim); font-size: 13px; margin: 0 0 18px; }
  .sub b { color: var(--ink); font-weight: 600; }

  .bar { position: sticky; top: 0; z-index: 5; background: rgba(10,14,20,.94);
    backdrop-filter: blur(6px); border-bottom: 1px solid var(--line);
    margin: 0 -18px 18px; padding: 12px 18px; display: flex; flex-wrap: wrap; gap: 10px; align-items: center; }
  .bar input[type=search] { flex: 1 1 200px; min-width: 160px; background: var(--panel-2);
    border: 1px solid var(--line); color: var(--ink); border-radius: 7px; padding: 7px 10px; font: inherit; }
  .chip { background: var(--panel-2); border: 1px solid var(--line); color: var(--dim);
    border-radius: 999px; padding: 6px 12px; font-size: 12.5px; cursor: pointer; }
  .chip.on { border-color: var(--accent); color: var(--accent); background: rgba(127,230,163,.08); }
  .count { color: var(--dim); font-size: 12.5px; font-variant-numeric: tabular-nums; }
  .count b { color: var(--accent); }
  .btn { background: var(--panel); border: 1px solid var(--line); color: var(--ink);
    border-radius: 7px; padding: 7px 12px; font: inherit; font-size: 12.5px; cursor: pointer; }
  .btn:hover { border-color: var(--accent); }
  .btn.ghost { color: var(--dim); }

  .grid { display: grid; gap: 12px; grid-template-columns: repeat(auto-fill, minmax(330px, 1fr)); }
  .card { background: var(--panel); border: 1px solid var(--line); border-radius: 11px; padding: 13px 14px; }
  .card.decided { border-color: rgba(127,230,163,.42); box-shadow: 0 0 0 1px rgba(127,230,163,.10) inset; }
  .card.hidden { display: none; }
  .hd { display: flex; align-items: baseline; gap: 8px; flex-wrap: wrap; margin-bottom: 6px; }
  .nm { font-weight: 650; font-size: 14.5px; }
  .tag { font-size: 10.5px; letter-spacing: .06em; text-transform: uppercase; color: var(--dim);
    border: 1px solid var(--line); border-radius: 5px; padding: 1px 6px; }
  .tag.cooldown { color: var(--warn); border-color: rgba(224,168,90,.4); }
  .tag.income { color: var(--accent); border-color: rgba(127,230,163,.4); }
  .tag.duration { color: var(--water); border-color: rgba(127,208,224,.4); }
  .tag.modifier { color: var(--phos); border-color: rgba(199,155,230,.4); }
  .eff { color: var(--ink); font-size: 13px; margin: 4px 0 8px; }
  .meta { display: flex; gap: 12px; flex-wrap: wrap; color: var(--dim); font-size: 12px; margin-bottom: 9px;
    font-variant-numeric: tabular-nums; }
  .meta .e { color: var(--energy); } .meta .w { color: var(--water); } .meta .p { color: var(--phos); }
  .time { font-family: var(--mono); font-variant-numeric: tabular-nums; font-size: 11.5px; }
  .time b { color: var(--warn); font-weight: 650; }
  .hot { color: var(--danger); }

  /* One row of five, always — a wrapped fifth button reads as a different control. */
  .choices { display: grid; grid-template-columns: repeat(5, 1fr); gap: 5px;
    border-top: 1px solid var(--line); padding-top: 10px; }
  .choices button { background: var(--panel-2); border: 1px solid var(--line); white-space: nowrap;
    color: var(--dim); border-radius: 7px; padding: 7px 2px; font: inherit; font-size: 11.5px; cursor: pointer; }
  .choices button:hover { color: var(--ink); border-color: #35455a; }
  .choices button.sel { background: rgba(127,230,163,.14); border-color: var(--accent); color: var(--accent); font-weight: 650; }
  .choices button.sel.keep { background: rgba(224,168,90,.14); border-color: var(--warn); color: var(--warn); }

  .out { margin-top: 22px; }
  textarea { width: 100%; min-height: 190px; background: var(--panel-2); color: var(--ink);
    border: 1px solid var(--line); border-radius: 9px; padding: 11px; font: 12.5px/1.5 ui-monospace, monospace; }
  .foot { color: var(--dim); font-size: 12px; margin-top: 8px; }
  @media (max-width: 560px) { .grid { grid-template-columns: 1fr; } }
</style>

<div class="wrap">
  <h1>Card timing review</h1>
  <p class="sub">Every cadence below is the <b>real time</b> the card now takes: one “round” is
    <b>${ROUND_SECONDS}s</b> (${Math.round(ROUND_SECONDS * 1000 / STEP_MS)} world ticks at ${STEP_MS}ms).
    <b>${timedCount}</b> of ${rows.length} cards have a timing. Mark the overpowered ones as
    <b>N× per level</b> instead of a timer — or leave them on the clock.
    <br><span style="opacity:.8">Buttons: <b>Timer</b> keeps the clock; <b>1×–4×</b> means that many
    uses per level, no cooldown. Click a chosen button again to clear it.</span></p>

  <div class="sum">
    <div><div class="sum-n">${timedCount}</div><div class="sum-l">on a clock</div></div>
    <div class="hi"><div class="sum-n">${hotCount}</div><div class="sum-l">6×+ per level</div></div>
    <div class="md"><div class="sum-n">${midCount}</div><div class="sum-l">3–5× per level</div></div>
    <div class="dn"><div class="sum-n" id="sumDone">0</div><div class="sum-l">decided</div></div>
  </div>

  <div class="bar">
    <input type="search" id="q" placeholder="Search name or effect…">
    <button class="chip on" data-f="all">All</button>
    <button class="chip" data-f="cooldown">Cooldowns</button>
    <button class="chip" data-f="income">Income</button>
    <button class="chip" data-f="duration">Durations</button>
    <button class="chip" data-f="modifier">Speed-ups</button>
    <button class="chip" data-f="hot">Fires 6×+</button>
    <button class="chip" data-f="todo">Undecided</button>
    <button class="chip" data-f="done">Decided</button>
    <span class="count" id="count"></span>
    <button class="btn" id="copy">Copy decisions</button>
    <button class="btn ghost" id="reset">Reset</button>
  </div>

  <div class="grid" id="grid"></div>

  <div class="out">
    <h1 style="font-size:15px">Decisions</h1>
    <p class="sub">Paste this back to me and I'll implement it.</p>
    <textarea id="json" readonly></textarea>
    <p class="foot">Saved in this browser as you click, so you can close the page and come back.</p>
  </div>
</div>

<script>
const ROUND_SECONDS = ${ROUND_SECONDS};
const ROWS = ${JSON.stringify(rows)};
const KEY = 'myceliumRT.cardReview.v1';
const CHOICES = [
  { id: 'keep', label: 'Timer' },
  { id: '1x', label: '1×' },
  { id: '2x', label: '2×' },
  { id: '3x', label: '3×' },
  { id: '4x', label: '4×' },
];
let picks = {};
try { picks = JSON.parse(localStorage.getItem(KEY) || '{}'); } catch (_) { picks = {}; }

let filter = 'all', query = '';
const grid = document.getElementById('grid');

// A cue for "how strong is this on the clock": how many times it could fire in a 2-minute level.
grid.innerHTML = ROWS.map((r, i) => {
  const cost = [
    r.energy ? '<span class="e">' + r.energy + '⚡ buy</span>' : '',
    r.buyP ? '<span class="p">' + r.buyP + '✦ buy</span>' : '',
    r.w ? '<span class="w">' + r.w + '💧 use</span>' : '',
    r.p ? '<span class="p">' + r.p + '✦ use</span>' : '',
  ].filter(Boolean).join('');
  const timing = r.kind === 'none' ? '<span style="color:var(--dim)">no timer</span>'
    : '<span class="time">' + (r.kind === 'duration' ? 'lasts ' : r.kind === 'cooldown' ? 'usable every ' : r.kind === 'modifier' ? 'shortens a wait by ' : 'pays every ')
      + '<b>' + r.label + '</b>'

      + '</span>';
  return '<div class="card' + (r.sev ? ' sev-' + r.sev : '') + '" data-i="' + i + '">'
    + '<div class="hd"><span class="nm">' + esc(r.name) + '</span>'
    + '<span class="tag">' + esc(r.cat) + '</span>'
    + (r.kind !== 'none' ? '<span class="tag ' + r.kind + '">' + r.kind + '</span>' : '')
        + (r.sev === 'high' || r.sev === 'mid' ? '<span class="sevpill ' + r.sev + '">' + r.per2min + '×/level</span>' : '')
    + '</div>'
    + '<div class="eff">' + esc(r.effect) + '</div>'
    + '<div class="meta">' + timing + (cost ? '<span>' + cost + '</span>' : '') + '</div>'
    + '<div class="choices">' + CHOICES.map((c) =>
        '<button data-c="' + c.id + '"' + (c.id === 'keep' ? ' class="keep"' : '') + '>' + c.label + '</button>').join('')
    + '</div></div>';
}).join('');

function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[m])); }

function save() { try { localStorage.setItem(KEY, JSON.stringify(picks)); } catch (_) {} }

function refresh() {
  let shown = 0;
  grid.querySelectorAll('.card').forEach((el) => {
    const r = ROWS[+el.dataset.i];
    const pick = picks[r.name];
    el.classList.toggle('decided', !!pick);
    el.querySelectorAll('.choices button').forEach((b) => {
      const on = b.dataset.c === pick;
      b.classList.toggle('sel', on);
      b.classList.toggle('keep', b.dataset.c === 'keep');
    });
    const hay = (r.name + ' ' + r.effect + ' ' + r.cat).toLowerCase();
    const okQ = !query || hay.includes(query);
    const okF = filter === 'all' ? true
      : filter === 'todo' ? (r.kind !== 'none' && !pick)
      : filter === 'done' ? !!pick
      : filter === 'hot' ? r.sev === 'high'
      : r.kind === filter;
    const show = okQ && okF;
    el.classList.toggle('hidden', !show);
    if (show) shown++;
  });
  const decided = Object.keys(picks).length;
  const tally = {};
  for (const v of Object.values(picks)) tally[v] = (tally[v] || 0) + 1;
  const parts = CHOICES.filter((c) => tally[c.id]).map((c) => tally[c.id] + '× ' + c.label);
  document.getElementById('sumDone').textContent = decided;
  document.getElementById('count').innerHTML = shown + ' shown'
    + (parts.length ? ' · ' + esc(parts.join(', ')) : '');
  document.getElementById('json').value = JSON.stringify({
    roundSeconds: ROUND_SECONDS,
    decided,
    cards: ROWS.filter((r) => picks[r.name]).map((r) => ({
      name: r.name, kind: r.kind, currentSeconds: r.seconds, decision: picks[r.name],
    })),
  }, null, 2);
}

grid.addEventListener('click', (e) => {
  const b = e.target.closest('.choices button'); if (!b) return;
  const card = b.closest('.card'), r = ROWS[+card.dataset.i];
  picks[r.name] = picks[r.name] === b.dataset.c ? undefined : b.dataset.c;   // click again to clear
  if (!picks[r.name]) delete picks[r.name];
  save(); refresh();
});
document.querySelectorAll('.chip').forEach((c) => c.addEventListener('click', () => {
  document.querySelectorAll('.chip').forEach((o) => o.classList.toggle('on', o === c));
  filter = c.dataset.f; refresh();
}));
document.getElementById('q').addEventListener('input', (e) => { query = e.target.value.trim().toLowerCase(); refresh(); });
document.getElementById('copy').addEventListener('click', async () => {
  const ta = document.getElementById('json');
  try { await navigator.clipboard.writeText(ta.value); } catch (_) { ta.select(); document.execCommand('copy'); }
  const b = document.getElementById('copy'); const t = b.textContent;
  b.textContent = 'Copied ✓'; setTimeout(() => { b.textContent = t; }, 1200);
});
document.getElementById('reset').addEventListener('click', () => {
  if (!confirm('Clear every decision?')) return;
  picks = {}; save(); refresh();
});
refresh();
</script>
`;

mkdirSync(join(ROOT, 'docs'), { recursive: true });
writeFileSync(join(ROOT, 'docs', 'card-review.html'), page);
console.log(`docs/card-review.html written — ${rows.length} cards, ${timedCount} with a timing, round = ${ROUND_SECONDS}s`);
console.log('kinds:', ['cooldown', 'income', 'duration', 'modifier', 'none'].map((k) => `${k}=${rows.filter((r) => r.kind === k).length}`).join('  '));
