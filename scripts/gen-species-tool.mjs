#!/usr/bin/env node
// Generate docs/species-tool.html — the roster tool: every colony, its starting hand, its spore
// price, and which three open the campaign.
//
//   node scripts/gen-species-tool.mjs            # write the page
//   node scripts/gen-species-tool.mjs --no-art   # skip the thumbnails (much smaller file)
//
// WHY A GENERATED PAGE AND NOT A HAND-WRITTEN ONE. `index.html` is the single source of truth for
// all of this — SPECIES, CARD_DATA, STARTER_SPECIES_IDS, STORE_SPECIES_IDS, STORE_SPECIES_COST — and
// a tool that restates any of it goes stale silently. This reads them out of the game and bakes the
// current values in, so re-running it is how the tool gets up to date. Same shape as
// scripts/gen-card-review.mjs.
//
// THE LOOP IS TWO SCRIPTS. This one reads the game and writes the tool; `scripts/apply-species.mjs`
// takes the tool's exported JSON and writes it BACK into index.html. Export-and-hand-edit was the
// alternative and it is how the card-review decisions ended up still unapplied months later.
//
// The page is self-contained (inline CSS/JS, art as data URIs) because it is published as an
// Artifact, and Artifacts are served under a CSP that blocks every external request.
//
// SPECIES IS A JS LITERAL, NOT JSON — unquoted keys, single quotes, comments, HTML inside the
// blurbs — so it is evaluated rather than parsed. That is safe here precisely because it IS a pure
// literal: verified by the fact that this eval works at all (a reference to any game identifier
// would throw immediately, which is the check).

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'docs', 'species-tool.html');
const NO_ART = process.argv.includes('--no-art');
const html = readFileSync(join(ROOT, 'index.html'), 'utf8');

// --- pull the roster out of the game ----------------------------------------
const grab = (re, what) => {
  const m = html.match(re);
  if (!m) throw new Error(`${what} not found in index.html — has it been renamed?`);
  return m[1];
};
const SPECIES = new Function('return ' + grab(/\nconst SPECIES = (\[[\s\S]*?\n\]);\n/, 'SPECIES'))();
const CARDS = JSON.parse(grab(/const CARD_DATA = (\[[\s\S]*?\n\]);/, 'CARD_DATA'));
const STARTERS = new Function('return ' + grab(/const STARTER_SPECIES_IDS = (\[[^\]]*\]);/, 'STARTER_SPECIES_IDS'))();
const STORE_IDS = new Function('return ' + grab(/const STORE_SPECIES_IDS = (\[[^\]]*\]);/, 'STORE_SPECIES_IDS'))();
const STORE_COST = new Function('return ' + grab(/const STORE_SPECIES_COST = (\{[^}]*\});/, 'STORE_SPECIES_COST'))();
const TIER_COST = new Function('return ' + grab(/const TIER_COST = (\{[^}]*\});/, 'TIER_COST'))();
const CAMPAIGN_LEVELS = Number(grab(/const CAMPAIGN_LEVELS = (\d+);/, 'CAMPAIGN_LEVELS'));

// What a full campaign clear pays, so a price can be judged against the money that exists rather
// than against a feeling. Mirrors sporesForLevel/campaignPayout.
const spf = grab(/function sporesForLevel\(([\s\S]*?)\n\}/, 'sporesForLevel');
let payout = null;
try {
  const fn = new Function('level', spf.slice(spf.indexOf('\n')));
  let t = 0; for (let l = 1; l <= CAMPAIGN_LEVELS; l++) t += Number(fn(l)) || 0;
  payout = t;
} catch (_) { /* the shape moved; the page just won't quote the payout */ }

// --- thumbnails, downscaled and inlined -------------------------------------
// Full art is 85-126 KB each and 12 of those is ~1.6 MB of base64 for a page whose subject is
// numbers. 128px wide WebP is ~2-4 KB and is all a row needs.
function thumbs() {
  if (NO_ART) return {};
  const ids = SPECIES.map((s) => s.img);
  const py = `
import base64, io, json, sys
from PIL import Image
out = {}
for name in json.loads(sys.argv[1]):
    p = 'assets/species/%s.jpg' % name
    try:
        im = Image.open(p).convert('RGB')
    except Exception:
        continue
    w, h = im.size
    side = min(w, h)
    im = im.crop(((w - side) // 2, (h - side) // 2, (w + side) // 2, (h + side) // 2))
    im = im.resize((128, 128), Image.LANCZOS)
    buf = io.BytesIO(); im.save(buf, 'WEBP', quality=82)
    out[name] = 'data:image/webp;base64,' + base64.b64encode(buf.getvalue()).decode()
print(json.dumps(out))
`;
  const r = spawnSync('python3', ['-c', py, JSON.stringify(ids)], { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (r.status !== 0) { console.warn('  (no thumbnails: ' + String(r.stderr || '').trim().split('\n').pop() + ')'); return {}; }
  try { return JSON.parse(r.stdout); } catch (_) { return {}; }
}
const ART = thumbs();

// --- the model the page edits ------------------------------------------------
// One flat record per species. `role` is what the owner actually decides:
//   starter — one of the three that open the campaign, with a 1-based slot
//   store   — for sale, at `cost` Spores
//   locked  — in the roster but unobtainable (today's psilocybe + the tier species)
const model = SPECIES.map((s) => {
  const slot = STARTERS.indexOf(s.id);
  const inStore = STORE_IDS.indexOf(s.id) >= 0;
  // The price the game would charge today, whichever path it comes down.
  const tierLvl = (() => { const m = /(\d+)/.exec(String(s.unlock || '')); return m ? Number(m[1]) : null; })();
  const tierPrice = s.cost != null ? s.cost : (tierLvl != null ? (TIER_COST[tierLvl] != null ? TIER_COST[tierLvl] : 0) : 0);
  return {
    id: s.id, name: s.name, latin: s.latin, img: s.img,
    role: slot >= 0 ? 'starter' : (inStore ? 'store' : 'locked'),
    slot: slot >= 0 ? slot + 1 : null,
    cost: inStore ? (STORE_COST[s.id] != null ? STORE_COST[s.id] : tierPrice) : tierPrice,
    memory: !!s.memory, special: s.special || null, unlock: s.unlock || null,
    blurb: String(s.blurb || '').replace(/<[^>]+>/g, ''),
    hand: (s.hand || []).map((h) => ({ name: h.name, count: h.count })),
  };
});

const cardInfo = CARDS.map((c) => ({
  name: c.name, type: c.type, cat: c.category || '', dcat: c.displayCategory || c.type,
  w: c.costW || 0, p: c.costP || 0, e: c.buyCostEnergy || 0, effect: c.effect || '',
})).sort((a, b) => a.name.localeCompare(b.name));

const esc = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// ============================================================================
// A CHARSET DECLARATION, even though the Artifact wrapper supplies the <head>. The card text carries
// the game's own energy glyph, so the page cannot be ASCII-only, and a plain static server that sends
// `text/html` with no charset had the middots and em-dashes come out as "Â·" and "â€"". The HTML
// encoding sniffer scans the first 1024 bytes wherever the tag sits, so this works wrapped or bare,
// and is inert when the wrapper has already said utf-8.
const page = `<meta charset="utf-8">
<title>Mycelium &#8212; colonies &amp; starting hands</title>
<style>
  :root {
    --bg:#0b1310; --panel:#111d18; --panel2:#0d1712; --line:rgba(126,240,192,0.16);
    --ink:#eaf4ee; --dim:#8fb3a4; --mint:#7ef0c0; --gold:#ffd479; --red:#e2766c; --violet:#c9a6ff;
  }
  @media (prefers-color-scheme: light) {
    :root { --bg:#f4f7f5; --panel:#fff; --panel2:#f0f4f1; --line:rgba(20,70,50,0.16);
            --ink:#12211b; --dim:#5d7a6c; --mint:#0f9b6c; --gold:#a97b12; --red:#b1483d; --violet:#6b46b8; }
  }
  :root[data-theme="dark"] {
    --bg:#0b1310; --panel:#111d18; --panel2:#0d1712; --line:rgba(126,240,192,0.16);
    --ink:#eaf4ee; --dim:#8fb3a4; --mint:#7ef0c0; --gold:#ffd479; --red:#e2766c; --violet:#c9a6ff;
  }
  :root[data-theme="light"] {
    --bg:#f4f7f5; --panel:#fff; --panel2:#f0f4f1; --line:rgba(20,70,50,0.16);
    --ink:#12211b; --dim:#5d7a6c; --mint:#0f9b6c; --gold:#a97b12; --red:#b1483d; --violet:#6b46b8;
  }
  * { box-sizing:border-box; }
  body { margin:0; padding:18px 16px 60px; background:var(--bg); color:var(--ink);
         font:14px/1.5 ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif; }
  h1 { font-size:22px; margin:0 0 4px; font-weight:800; letter-spacing:.01em; }
  .sub { color:var(--dim); margin:0 0 16px; max-width:70ch; }
  .wrap { max-width:1180px; margin:0 auto; }

  /* ---- sticky status bar: the three rules that can be broken ---- */
  .bar { position:sticky; top:0; z-index:9; background:var(--bg); border-bottom:1px solid var(--line);
         padding:9px 0 10px; margin-bottom:14px; display:flex; gap:9px; flex-wrap:wrap; align-items:center; }
  .chip { border:1px solid var(--line); border-radius:999px; padding:4px 11px; font-size:12px; font-weight:700;
          background:var(--panel); white-space:nowrap; }
  .chip.ok { color:var(--mint); border-color:color-mix(in srgb, var(--mint) 45%, transparent); }
  .chip.bad { color:var(--red); border-color:color-mix(in srgb, var(--red) 55%, transparent); }
  .btn { font:inherit; font-size:13px; font-weight:700; cursor:pointer; border-radius:9px;
         padding:7px 14px; border:1px solid var(--line); background:var(--panel); color:var(--ink); }
  .btn:hover { border-color:var(--mint); }
  .btn.pri { background:var(--mint); color:#06231a; border-color:var(--mint); }
  .spacer { flex:1 1 auto; }

  /* ---- one species ---- */
  .sp { background:var(--panel); border:1px solid var(--line); border-radius:14px; margin:0 0 14px;
        overflow:hidden; }
  .sp.starter { border-color:color-mix(in srgb, var(--mint) 42%, transparent); }
  .sp.store   { border-color:color-mix(in srgb, var(--gold) 38%, transparent); }
  .sp.locked  { opacity:.72; }
  .sph { display:flex; gap:13px; align-items:flex-start; padding:12px 14px; }
  .sph img { width:62px; height:62px; border-radius:11px; object-fit:cover; flex:0 0 auto;
             border:1px solid var(--line); }
  .noart { width:62px; height:62px; border-radius:11px; flex:0 0 auto; border:1px solid var(--line);
           display:grid; place-items:center; color:var(--dim); font-size:20px; background:var(--panel2); }
  .nm { font-size:16px; font-weight:800; }
  .lt { color:var(--dim); font-style:italic; font-size:12.5px; }
  .idtag { font-family:ui-monospace,SFMono-Regular,Menlo,monospace; font-size:11px; color:var(--dim); }
  .tags { display:flex; gap:6px; flex-wrap:wrap; margin-top:5px; }
  .tag { font-size:10.5px; font-weight:700; letter-spacing:.07em; text-transform:uppercase;
         border:1px solid var(--line); border-radius:999px; padding:2px 8px; color:var(--dim); }
  /* NOT .tag.sp -- .sp is the species PANEL, and a two-class tag would have picked up its panel
     background, border and 14px margin. Third silent class collision in this project (.ss-hint and
     .li-count were the others); grep the name before adding a rule. And no backticks in here: this
     whole page is one JS template literal, so one would end the string. */
  .tag.mem { color:var(--violet); border-color:color-mix(in srgb, var(--violet) 45%, transparent); }
  .tag.spec { color:var(--gold);   border-color:color-mix(in srgb, var(--gold) 45%, transparent); }

  /* ---- role + price ---- */
  .roles { display:flex; gap:6px; flex-wrap:wrap; align-items:center; }
  .rb { font:inherit; font-size:12px; font-weight:700; cursor:pointer; border-radius:8px; padding:5px 10px;
        border:1px solid var(--line); background:var(--panel2); color:var(--dim); }
  .rb:hover { color:var(--ink); }
  .rb[aria-pressed="true"] { background:var(--mint); color:#06231a; border-color:var(--mint); }
  .rb.store[aria-pressed="true"] { background:var(--gold); color:#2b1c00; border-color:var(--gold); }
  .rb.lock[aria-pressed="true"] { background:var(--panel); color:var(--ink); border-color:var(--ink); }
  .price { display:flex; align-items:center; gap:6px; font-size:12.5px; color:var(--dim); }
  .price input { width:88px; font:inherit; padding:5px 8px; border-radius:8px; text-align:right;
                 border:1px solid var(--line); background:var(--panel2); color:var(--ink); }
  .price input:disabled { opacity:.4; }

  /* ---- the hand ---- */
  .hand { border-top:1px solid var(--line); background:var(--panel2); padding:11px 14px 13px; }
  .hlab { font-size:10.5px; letter-spacing:.15em; text-transform:uppercase; color:var(--mint);
          font-weight:700; margin:0 0 8px; display:flex; gap:10px; align-items:baseline; flex-wrap:wrap; }
  .hlab .tot { color:var(--dim); letter-spacing:.04em; text-transform:none; font-size:12px; font-weight:600; }
  .rows { display:flex; flex-direction:column; gap:6px; }
  .row { display:flex; gap:8px; align-items:center; }
  .row select { flex:1 1 240px; min-width:0; font:inherit; font-size:13px; padding:6px 8px; border-radius:8px;
                border:1px solid var(--line); background:var(--panel); color:var(--ink); }
  .row input { width:72px; font:inherit; padding:6px 8px; border-radius:8px; text-align:right;
               border:1px solid var(--line); background:var(--panel); color:var(--ink); }
  .row .eff { flex:2 1 320px; min-width:0; color:var(--dim); font-size:12px;
              overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  .row .x { border:none; background:none; color:var(--dim); cursor:pointer; font-size:17px; line-height:1;
            padding:2px 6px; border-radius:7px; }
  .row .x:hover { color:var(--red); background:var(--panel2); }
  .badtype { color:var(--red); font-weight:700; }
  .mix { display:flex; gap:7px; flex-wrap:wrap; margin-top:9px; }
  .mx { font-size:11px; font-weight:700; border:1px solid var(--line); border-radius:999px; padding:2px 9px; color:var(--dim); }

  /* ---- export ---- */
  #out { width:100%; min-height:200px; font:12px/1.5 ui-monospace,SFMono-Regular,Menlo,monospace;
         padding:11px; border-radius:11px; border:1px solid var(--line); background:var(--panel2); color:var(--ink);
         white-space:pre; overflow:auto; }
  details { margin-top:22px; border:1px solid var(--line); border-radius:12px; background:var(--panel); padding:12px 14px; }
  summary { cursor:pointer; font-weight:800; }
  code { font-family:ui-monospace,SFMono-Regular,Menlo,monospace; background:var(--panel2);
         border:1px solid var(--line); border-radius:6px; padding:1px 6px; font-size:12.5px; }
  .note { color:var(--dim); font-size:12.5px; }
  table.cheat { border-collapse:collapse; width:100%; margin-top:8px; font-size:12.5px; }
  table.cheat th, table.cheat td { text-align:left; padding:4px 8px; border-bottom:1px solid var(--line); }
  table.cheat th { color:var(--dim); font-weight:700; }
  .scrollx { overflow-x:auto; }
  @media (max-width:720px) {
    .row { flex-wrap:wrap; }
    .row .eff { display:none; }
  }
</style>

<div class="wrap">
  <h1>Colonies &amp; starting hands</h1>
  <p class="sub">Every colony in the roster, its opening hand, its Spore price, and which three open
  the campaign. Edits are kept in this browser as you make them — press <b>Export</b> when you are
  done and apply the JSON with the one command at the foot of the page.</p>

  <div class="bar">
    <span class="chip" id="cStart">starters</span>
    <span class="chip" id="cStore">store</span>
    <span class="chip" id="cPay">payout</span>
    <span class="spacer"></span>
    <button class="btn" id="bReset" type="button">Revert to the game's values</button>
    <button class="btn pri" id="bExport" type="button">Export</button>
  </div>

  <div id="list"></div>

  <details id="exportBox">
    <summary>Export &amp; apply</summary>
    <p class="note">Copy this and run, from the repo root:</p>
    <p><code>pbpaste &gt; /tmp/species.json &amp;&amp; node scripts/apply-species.mjs /tmp/species.json</code></p>
    <p class="note">(or save the JSON anywhere and pass that path). The script rewrites
    <code>index.html</code>'s <code>SPECIES</code> hands, <code>STARTER_SPECIES_IDS</code>,
    <code>STORE_SPECIES_IDS</code> and <code>STORE_SPECIES_COST</code>, and prints what it changed. It
    refuses rather than writing a half-applied file if anything does not line up.</p>
    <button class="btn" id="bCopy" type="button">Copy JSON</button>
    <textarea id="out" readonly></textarea>
  </details>

  <details>
    <summary>The cards, for reference</summary>
    <div class="scrollx">
      <table class="cheat" id="cheat"><thead><tr>
        <th>card</th><th>type</th><th>W</th><th>P</th><th>what it does</th>
      </tr></thead><tbody></tbody></table>
    </div>
  </details>

  <details>
    <summary>What each field does in the game</summary>
    <table class="cheat"><tbody>
      <tr><td><b>Starter 1&nbsp;/&nbsp;2&nbsp;/&nbsp;3</b></td><td><code>STARTER_SPECIES_IDS</code>, in that order — the
        opening roster, free and playable from a fresh save. Exactly three; picking a slot another
        colony holds swaps the two.</td></tr>
      <tr><td><b>Store</b></td><td><code>STORE_SPECIES_IDS</code> plus its price in
        <code>STORE_SPECIES_COST</code>. Visible from the start, bought with Spores; paying is the
        whole requirement — no level clear is involved.</td></tr>
      <tr><td><b>Locked</b></td><td>In the roster but unobtainable: not a starter and not for sale. The
        tier machinery still exists, so a level clear still <i>reveals</i> one, but nothing on the
        selection screen can offer it.</td></tr>
      <tr><td><b>Starting hand</b></td><td>Each colony's <code>hand</code> — the deck the run opens with,
        by card and number of copies. A name that is not a real card is flagged in red; the game would
        silently drop it.</td></tr>
      <tr><td><b>Memory</b></td><td><code>memory: true</code> — this colony hand-picks cards from the last
        run. Set in <code>index.html</code>, not here.</td></tr>
    </tbody></table>
  </details>
</div>

<script>
const CARDS = ${JSON.stringify(cardInfo)};
const BASE  = ${JSON.stringify(model)};
const ART   = ${JSON.stringify(ART)};
const PAYOUT = ${payout == null ? 'null' : payout};
const LEVELS = ${CAMPAIGN_LEVELS};
const KEY = 'mycelium.speciesTool.v1';
const byName = new Map(CARDS.map((c) => [c.name, c]));

// The edit buffer. Kept as a whole-model clone so "revert" is one line and the export is the model
// rather than a diff — a diff would have to be reconciled against a game that may have moved.
let M = load();
function load() {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) || 'null');
    if (raw && Array.isArray(raw.species)) {
      // Merge by id, so a species ADDED to the game since the last edit still appears, and one
      // removed from it disappears rather than lingering in a saved blob.
      return BASE.map((b) => {
        const was = raw.species.find((s) => s.id === b.id);
        return was ? Object.assign({}, b, { role: was.role, slot: was.slot, cost: was.cost, hand: was.hand.map((h) => ({ name: h.name, count: h.count })) }) : clone(b);
      });
    }
  } catch (_) {}
  return BASE.map(clone);
}
function clone(s) { return JSON.parse(JSON.stringify(s)); }
function save() { try { localStorage.setItem(KEY, JSON.stringify({ species: M })); } catch (_) {} }

const el = (t, c, txt) => { const n = document.createElement(t); if (c) n.className = c; if (txt != null) n.textContent = txt; return n; };
const num = (v) => Number(v || 0).toLocaleString('en-US');

function cardSelect(value) {
  const s = el('select');
  const groups = {};
  for (const c of CARDS) (groups[c.dcat] = groups[c.dcat] || []).push(c);
  if (value && !byName.has(value)) {
    const og = el('optgroup'); og.label = 'NOT A CARD IN THE GAME';
    const o = el('option', null, value + '  ← unknown'); o.value = value; o.selected = true;
    og.appendChild(o); s.appendChild(og);
  }
  for (const g of Object.keys(groups).sort()) {
    const og = el('optgroup'); og.label = g;
    for (const c of groups[g]) {
      const bits = [];
      if (c.w) bits.push(c.w + 'W');
      if (c.p) bits.push(c.p + 'P');
      const o = el('option', null, c.name + (bits.length ? '  (' + bits.join(' ') + ')' : ''));
      o.value = c.name;
      if (c.name === value) o.selected = true;
      og.appendChild(o);
    }
    s.appendChild(og);
  }
  return s;
}

function render() {
  const list = document.getElementById('list');
  list.textContent = '';
  for (const sp of M) {
    const card = el('div', 'sp ' + sp.role);

    // ---- header: art, name, role, price ----
    const h = el('div', 'sph');
    if (ART[sp.img]) { const im = el('img'); im.src = ART[sp.img]; im.alt = ''; h.appendChild(im); }
    else h.appendChild(el('div', 'noart', '\\u25CF'));

    const mid = el('div'); mid.style.flex = '1 1 auto'; mid.style.minWidth = '0';
    mid.appendChild(el('div', 'nm', sp.name));
    const l = el('div', 'lt', sp.latin + ' '); const idt = el('span', 'idtag', '· ' + sp.id); l.appendChild(idt);
    mid.appendChild(l);
    const tags = el('div', 'tags');
    if (sp.memory) tags.appendChild(el('span', 'tag mem', 'memory'));
    if (sp.special) tags.appendChild(el('span', 'tag spec', sp.special));
    if (sp.unlock) tags.appendChild(el('span', 'tag', 'was: ' + sp.unlock));
    if (tags.children.length) mid.appendChild(tags);
    h.appendChild(mid);

    const right = el('div'); right.style.flex = '0 0 auto';
    const roles = el('div', 'roles');
    for (const n of [1, 2, 3]) {
      const b = el('button', 'rb', 'Starter ' + n); b.type = 'button';
      b.setAttribute('aria-pressed', sp.role === 'starter' && sp.slot === n ? 'true' : 'false');
      b.onclick = () => setStarter(sp, n);
      roles.appendChild(b);
    }
    const bs = el('button', 'rb store', 'Store'); bs.type = 'button';
    bs.setAttribute('aria-pressed', sp.role === 'store' ? 'true' : 'false');
    bs.onclick = () => { sp.role = 'store'; sp.slot = null; if (!sp.cost) sp.cost = 3000; commit(); };
    roles.appendChild(bs);
    const bl = el('button', 'rb lock', 'Locked'); bl.type = 'button';
    bl.setAttribute('aria-pressed', sp.role === 'locked' ? 'true' : 'false');
    bl.onclick = () => { sp.role = 'locked'; sp.slot = null; commit(); };
    roles.appendChild(bl);
    right.appendChild(roles);

    const pr = el('div', 'price'); pr.style.marginTop = '7px'; pr.style.justifyContent = 'flex-end';
    pr.appendChild(el('span', null, 'Spore cost'));
    const pi = el('input'); pi.type = 'number'; pi.min = '0'; pi.step = '100';
    pi.value = sp.cost == null ? '' : sp.cost;
    pi.disabled = sp.role !== 'store';
    pi.oninput = () => { sp.cost = Math.max(0, Math.round(Number(pi.value) || 0)); save(); status(); };
    pr.appendChild(pi);
    right.appendChild(pr);
    h.appendChild(right);
    card.appendChild(h);

    // ---- the hand ----
    const hand = el('div', 'hand');
    const kinds = sp.hand.length;
    const copies = sp.hand.reduce((a, x) => a + (Number(x.count) || 0), 0);
    const lab = el('div', 'hlab', 'Starting hand');
    lab.appendChild(el('span', 'tot', kinds + (kinds === 1 ? ' card' : ' cards') + ', ' + copies + ' copies'));
    hand.appendChild(lab);

    const rows = el('div', 'rows');
    sp.hand.forEach((h2, i) => {
      const r = el('div', 'row');
      const sel = cardSelect(h2.name);
      sel.onchange = () => { h2.name = sel.value; commit(); };
      r.appendChild(sel);
      const q = el('input'); q.type = 'number'; q.min = '1'; q.step = '1'; q.value = h2.count;
      q.oninput = () => { h2.count = Math.max(0, Math.round(Number(q.value) || 0)); save(); refreshTotals(); };
      r.appendChild(q);
      const info = byName.get(h2.name);
      r.appendChild(el('div', 'eff' + (info ? '' : ' badtype'), info ? info.effect : 'not a card in the game'));
      const x = el('button', 'x', '\\u00D7'); x.type = 'button'; x.title = 'remove';
      x.onclick = () => { sp.hand.splice(i, 1); commit(); };
      r.appendChild(x);
      rows.appendChild(r);
    });
    hand.appendChild(rows);

    const add = el('button', 'btn', '+ add a card'); add.type = 'button';
    add.style.marginTop = '9px'; add.style.fontSize = '12px';
    add.onclick = () => {
      const have = new Set(sp.hand.map((x) => x.name));
      const pick = (CARDS.find((c) => !have.has(c.name)) || CARDS[0]);
      sp.hand.push({ name: pick.name, count: 1 }); commit();
    };
    hand.appendChild(add);

    // The MIX is what a hand is actually judged on — the pool each card drafts from.
    const mix = el('div', 'mix');
    const tally = {};
    for (const h2 of sp.hand) {
      const info = byName.get(h2.name);
      const k = info ? info.dcat : 'unknown';
      tally[k] = (tally[k] || 0) + (Number(h2.count) || 0);
    }
    for (const k of Object.keys(tally).sort()) mix.appendChild(el('span', 'mx', k + ' ' + tally[k]));
    hand.appendChild(mix);
    card.appendChild(hand);

    list.appendChild(card);
  }
  status();
}

// ONLY ONE COLONY PER STARTER SLOT, and taking an occupied one SWAPS rather than silently
// producing two. Three slots means three ids in the exported list, and a duplicate would make
// starterSpecies() return the same colony twice.
function setStarter(sp, n) {
  const held = M.find((o) => o !== sp && o.role === 'starter' && o.slot === n);
  const wasRole = sp.role, wasSlot = sp.slot;
  if (held) {
    if (wasRole === 'starter') { held.slot = wasSlot; }
    else { held.role = 'locked'; held.slot = null; }
  }
  sp.role = 'starter'; sp.slot = n;
  commit();
}
function commit() { save(); render(); }

function refreshTotals() { save(); status(); }

function status() {
  const starters = M.filter((s) => s.role === 'starter').sort((a, b) => a.slot - b.slot);
  const store = M.filter((s) => s.role === 'store');
  const slots = starters.map((s) => s.slot);
  // ANY NUMBER OF STARTERS, 1 to 3 — the rule is that the slots run 1..N with no gaps and no
  // duplicates, not that there are three of them. "Exactly 3" was the shipped number when this was
  // written, and the owner's first real edit was to cut it to one; a tool that paints the intended
  // roster red is a tool arguing with its user.
  const okStart = starters.length >= 1 && new Set(slots).size === starters.length
    && slots.slice().sort().join(',') === starters.map((_, i) => i + 1).join(',');
  const c1 = document.getElementById('cStart');
  c1.className = 'chip ' + (okStart ? 'ok' : 'bad');
  c1.textContent = okStart
    ? 'starters: ' + starters.map((s) => s.slot + '. ' + s.name).join('  \u00B7  ')
    : (starters.length
        ? 'starters: slots must run 1..' + starters.length + ' with no gaps (got ' + slots.join(',') + ')'
        : 'starters: none — a fresh save would have nothing to play');

  const bad = M.some((s) => s.hand.some((h) => !byName.has(h.name) || !(h.count > 0)));
  const c2 = document.getElementById('cStore');
  const cheapest = store.length ? Math.min.apply(null, store.map((s) => s.cost || 0)) : 0;
  const dearest = store.length ? Math.max.apply(null, store.map((s) => s.cost || 0)) : 0;
  c2.className = 'chip ' + (store.length ? 'ok' : 'bad');
  c2.textContent = 'store: ' + store.length + (store.length ? ' for sale, ' + num(cheapest) + '\\u2013' + num(dearest) + ' Spores' : ' \\u2014 nothing for sale');

  const c3 = document.getElementById('cPay');
  c3.className = 'chip' + (bad ? ' bad' : '');
  c3.textContent = bad ? 'a hand has an unknown card or a zero count'
    : (PAYOUT != null ? 'a full ' + LEVELS + '-level clear pays ' + num(PAYOUT) + ' Spores' : 'roster: ' + M.length + ' colonies');

  document.getElementById('out').value = JSON.stringify(exportModel(), null, 2);
}

// The export is deliberately the SHAPE THE GAME USES, not the tool's own model: three constants
// plus one hand per species. apply-species.mjs then has nothing to interpret.
function exportModel() {
  const starters = M.filter((s) => s.role === 'starter').sort((a, b) => a.slot - b.slot);
  const store = M.filter((s) => s.role === 'store');
  const cost = {};
  for (const s of store) cost[s.id] = s.cost || 0;
  const hands = {};
  for (const s of M) hands[s.id] = s.hand.filter((h) => h.name).map((h) => ({ name: h.name, count: Number(h.count) || 0 }));
  return {
    format: 'mycelium-species',
    version: 1,
    STARTER_SPECIES_IDS: starters.map((s) => s.id),
    STORE_SPECIES_IDS: store.map((s) => s.id),
    STORE_SPECIES_COST: cost,
    hands,
  };
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
  if (!confirm("Throw away every edit and go back to the values in index.html?")) return;
  localStorage.removeItem(KEY); M = BASE.map(clone); render();
};

// the card reference table
{
  const tb = document.querySelector('#cheat tbody');
  for (const c of CARDS) {
    const tr = el('tr');
    tr.appendChild(el('td', null, c.name));
    tr.appendChild(el('td', null, c.dcat + (c.type !== c.dcat ? ' (badge: ' + c.type + ')' : '')));
    tr.appendChild(el('td', null, c.w || ''));
    tr.appendChild(el('td', null, c.p || ''));
    tr.appendChild(el('td', null, c.effect));
    tb.appendChild(tr);
  }
}
render();
</script>
`;

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, page);
const kb = (page.length / 1024).toFixed(0);
console.log(`wrote docs/species-tool.html — ${SPECIES.length} colonies, ${CARDS.length} cards, ${kb} KB`);
console.log(`  starters: ${STARTERS.join(', ')}`);
console.log(`  store:    ${STORE_IDS.map((id) => id + ' @ ' + (STORE_COST[id] != null ? STORE_COST[id] : '?')).join(', ')}`);
if (payout != null) console.log(`  a full ${CAMPAIGN_LEVELS}-level clear pays ${payout} Spores`);
if (!Object.keys(ART).length && !NO_ART) console.log('  (no thumbnails were embedded)');
