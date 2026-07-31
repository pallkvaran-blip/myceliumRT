#!/usr/bin/env python3
"""Generate docs/map-review.html — the owner's shortlist of generated maps, measured.

    python3 scripts/gen-map-review.py
    python3 -m http.server 8000   # then open /docs/map-review.html

Same idea as docs/card-review.html: a self-contained page for making a decision, with a
keep/cut toggle per item that persists in localStorage and exports as JSON. It is GENERATED —
edit this script, not the HTML.

SELECTIONS below is the list of images the owner has approved as the sweeps went by, in the
order they were approved. Anything not in that list stayed in docs/maps as a reject; the
verdicts for those live in docs/maps/README.md.

The numbers under each image are measured here, with the same rules trace-map.py uses, so the
page shows what the tracer would actually see rather than what the picture looks like:

  solid   how much of the frame traces as rock. maze-one plays at 48%; past ~60% the channels
          get tight, and tests/traced-check.cjs enforces a 15-60% band.
  masses  connected blobs left after the gravel cut — roughly how many sprites a trace yields.
  fill    a kept mass's area over its bounding box: how SOLID the shapes are. Stone themes run
          0.63-0.67. Skeletons run 0.39-0.45, because a ribcage is mostly holes, and thin
          shapes are what the despeckle opening and --min-area exist to delete.
"""

import argparse, base64, io, json, os
from PIL import Image
import numpy as np
from scipy import ndimage

ap = argparse.ArgumentParser()
ap.add_argument('--inline', metavar='PATH',
                help='embed the images as data URIs and write here instead — for publishing, '
                     'where relative paths cannot resolve')
ap.add_argument('--pending', default='',
                help='comma-separated stems awaiting a decision — shown first, flagged, and '
                     'filterable on their own. The tool is where options get judged now, so '
                     'a new round lands here rather than only in chat.')
ap.add_argument('--inline-width', type=int, default=760,
                help='downscale embedded images to this width (1440 source is 4x more than a '
                     'gallery card needs, and the page has to carry all 24 at once)')
ARGS = ap.parse_args()

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MAPS = os.path.join(ROOT, 'docs', 'maps')

# file, theme, rocks asked for, level id if it is already playable, note
SELECTIONS = [
    ('maze-1',                    'maze',            20, 'maze-one',    'Dense, tight channels. The first map through the pipeline.'),
    ('scatter-1',                 'scatter',         17, 'scatter-one',  'Open, big separated masses.'),
    ('silhouette-2',              'scatter',         17, 'scatter-two',  'The scatter prompt under its old name.'),
    ('ledges-c9-2',               'ledges',           9, 'ledges-one',   'The one image of ten the ledges sweep produced that works.'),
    ('veined-scatter-1',          'veined',          17, 'veined-one',   'First of the veined theme; mint-cyan mineral veins.'),
    ('veined-scatter-c9-1',       'veined',           9, None,           'Vein weight closest to the game’s own rockVeined.'),
    ('veined-scatter-c28-1',      'veined',          28, None,           'Dense; would trace into something maze-like.'),
    ('crystal-scatter-c20-3',     'crystal',         20, None,           'Round 3 — spacing rule working, crystal restored.'),
    ('crystal-scatter-c28-3',     'crystal',         28, None,           'Round 3, denser.'),
    ('crystal-scatter-c36-1',     'crystal',         36, None,           'Round 3, densest — large masses.'),
    ('crystal-scatter-c40-1',     'crystal',         40, None,           'Round 4, size cap in force — looser field.'),
    ('crystal-scatter-c55-1',     'crystal',         55, None,           'Round 4 — sparse, sits on a ground plane.'),
    ('crystal-scatter-c70-1',     'crystal',         70, None,           'Round 4 — best coverage of the crystal set.'),
    ('ice-scatter-c20-1',         'ice',             20, None,           'Open counterpart to c40.'),
    ('ice-scatter-c40-1',         'ice',             40, None,           'A cracked ice sheet; its channels read as the route.'),
    ('glacier-scatter-c20-1',     'glacier',         20, None,           'Pale ice on black — large floes.'),
    ('glacier-scatter-c40-1',     'glacier',         40, None,           'Pale ice on black — smaller floes, wider channels.'),
    ('bioluminescent-scatter-c20-1', 'bioluminescent', 20, None,         'Round 1 — best channels; fungus mostly amber.'),
    ('bioluminescent-scatter-c40-1', 'bioluminescent', 40, None,         'Round 1 — good spread, no teal.'),
    ('bioluminescent-scatter-c20-2', 'bioluminescent', 20, None,         'Round 2 — the most side-on image of any theme.'),
    ('bioluminescent-scatter-c40-2', 'bioluminescent', 40, None,         'Round 2 — kept, but the least side-on.'),
    ('ember-scatter-c20-3',       'ember',           20, None,           'Cooled fissures; most side-on of the ember set.'),
    ('ember-scatter-c30-3',       'ember',           30, None,           'Best ember density; reads more top-down.'),
    ('skeletons-scatter-c12-1',   'skeletons',       12, None,           'All fossil. Fill ratio says it traces to fragments, not terrain.'),
]


def data_uri(path, width):
    im = Image.open(path).convert('RGB')
    if im.width > width:
        im = im.resize((width, round(im.height * width / im.width)), Image.LANCZOS)
    buf = io.BytesIO()
    im.save(buf, 'WEBP', quality=80, method=6)
    return 'data:image/webp;base64,' + base64.b64encode(buf.getvalue()).decode()


def otsu(v):
    h = np.bincount(v.ravel().astype(np.uint8), minlength=256).astype(float)
    w = np.cumsum(h); mu = np.cumsum(h * np.arange(256))
    tot, mu_t = w[-1], mu[-1]
    wb = w[:-1]; wf = tot - wb
    ok = (wb > 0) & (wf > 0)
    between = np.zeros(255)
    between[ok] = ((mu_t * wb[ok] / tot - mu[:-1][ok]) ** 2) / (wb[ok] * wf[ok])
    return int(np.argmax(between))


def measure(path):
    """Exactly the rules trace-map.py applies, so the numbers are what the tracer sees."""
    a = np.asarray(Image.open(path).convert('RGB')).astype(int)
    lum = a.mean(axis=2)
    # Same flatness test the tracer uses — a background is a flat fill, rock is textured.
    # `None` when the two are within 1.6x, which is the tracer's refuse-to-guess case.
    l32 = lum.astype(np.float32)
    mm = ndimage.uniform_filter(l32, 9)
    sd = np.sqrt(np.maximum(0, ndimage.uniform_filter(l32 * l32, 9) - mm * mm))
    flat = sd < 2.0
    fl, fd = float((flat & (lum >= 235)).mean()), float((flat & (lum <= 20)).mean())
    hi, lo = max(fl, fd), min(fl, fd)
    ambiguous = hi < 1e-6 or hi / max(lo, 1e-6) < 1.6
    invert = (fd > fl)
    det_rgb = (255 - a) if invert else a
    det_lum = (255 - lum) if invert else lum
    thr = min(210, max(120, otsu(det_lum.astype(np.uint8))))
    rock = (det_lum < thr) | (((det_rgb.max(axis=2) - det_rgb.min(axis=2)) > 40)
                              & (det_rgb.min(axis=2) < 200))
    lab, n = ndimage.label(rock, structure=np.ones((3, 3)))
    areas = ndimage.sum(rock, lab, range(1, n + 1))
    boxes = ndimage.find_objects(lab)
    keep = [i for i in range(n) if areas[i] >= 600]          # the gravel cut, at 1440 wide
    fills = [areas[i] / max(1, (boxes[i][0].stop - boxes[i][0].start)
                            * (boxes[i][1].stop - boxes[i][1].start)) for i in keep]
    return {
        'solid': round(100 * float(rock.mean()), 1),
        'masses': len(keep),
        'fill': round(float(np.mean(fills)), 2) if fills else 0.0,
        'dark_bg': bool(invert) and not ambiguous,
        'ambiguous': bool(ambiguous),
    }


PENDING = [t.strip() for t in ARGS.pending.split(',') if t.strip()]


def pending_row(stem):
    # theme-count-roll, e.g. ember-scatter-c24-2
    bits = stem.split('-')
    theme = bits[0]
    count = next((int(b[1:]) for b in bits if b.startswith('c') and b[1:].isdigit()), 0)
    return (stem, theme, count, None, 'Awaiting a decision.')


cards = []
for stem, theme, count, level, note in [pending_row(t) for t in PENDING] + SELECTIONS:
    path = os.path.join(MAPS, f'{stem}.webp')
    m = measure(path)
    m.update(stem=stem, theme=theme, count=count, level=level, note=note,
             pending=stem in PENDING,
             src=data_uri(path, ARGS.inline_width) if ARGS.inline else f'maps/{stem}.webp')
    cards.append(m)
    print(f'{stem:32s} solid {m["solid"]:5.1f}%  masses {m["masses"]:3d}  fill {m["fill"]:.2f}'
          f'{"  (dark ground)" if m["dark_bg"] else ""}'
          f'{"  [POLARITY AMBIGUOUS — needs --invert]" if m["ambiguous"] else ""}')

themes = []
for c in cards:
    if c['theme'] not in themes:
        themes.append(c['theme'])
playable = sum(1 for c in cards if c['level'])
inband = sum(1 for c in cards if 15 <= c['solid'] <= 60)

HTML = """<!doctype html>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Mycelium — generated map shortlist</title>
<style>
  /* Palette is the game\'s own, from docs/STYLE_GUIDE.md: near-black cool soil, the
     mycelium\'s mint as the one accent, and the ants\' amber — "the one warm light
     underground" — reserved for values outside their band. Tokens only; components never
     reference a colour directly, so both themes come from one set of overrides. */
  :root {
    --ground:#eef1f0; --panel:#fff; --sunk:#e4eae8; --line:#d3dedb;
    --ink:#111a1e; --dim:#5b6a72; --mint:#0d7f68; --amber:#96600d; --band:#cfe6df;
    --shadow:0 1px 2px rgba(16,26,30,.08), 0 8px 24px -12px rgba(16,26,30,.18);
  }
  @media (prefers-color-scheme: dark) {
    :root {
      --ground:#0b0e12; --panel:#12181e; --sunk:#0d1216; --line:#232f39;
      --ink:#dfe8ee; --dim:#8798a5; --mint:#5fe0c0; --amber:#e0a24a; --band:#1b3b36;
      --shadow:0 1px 0 rgba(255,255,255,.03), 0 12px 32px -18px #000;
    }
  }
  :root[data-theme="light"] {
    --ground:#eef1f0; --panel:#fff; --sunk:#e4eae8; --line:#d3dedb;
    --ink:#111a1e; --dim:#5b6a72; --mint:#0d7f68; --amber:#96600d; --band:#cfe6df;
    --shadow:0 1px 2px rgba(16,26,30,.08), 0 8px 24px -12px rgba(16,26,30,.18);
  }
  :root[data-theme="dark"] {
    --ground:#0b0e12; --panel:#12181e; --sunk:#0d1216; --line:#232f39;
    --ink:#dfe8ee; --dim:#8798a5; --mint:#5fe0c0; --amber:#e0a24a; --band:#1b3b36;
    --shadow:0 1px 0 rgba(255,255,255,.03), 0 12px 32px -18px #000;
  }

  * { box-sizing:border-box; }
  html { -webkit-text-size-adjust:100%; }
  body {
    margin:0; background:var(--ground); color:var(--ink);
    font:15px/1.55 ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;
  }
  .mono { font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace; font-variant-numeric:tabular-nums; }

  header { border-bottom:1px solid var(--line); background:var(--panel); }
  .wrap { max-width:1500px; margin:0 auto; padding:0 clamp(16px,3.5vw,40px); }
  .masthead { padding:26px 0 18px; display:flex; flex-wrap:wrap; gap:26px 40px; align-items:flex-end; }
  h1 { margin:0 0 6px; font-size:clamp(20px,2.4vw,25px); font-weight:640; letter-spacing:-.015em; text-wrap:balance; }
  .lede { margin:0; color:var(--dim); font-size:14px; max-width:62ch; }
  .lede b { color:var(--ink); font-weight:600; }

  .metrics { display:flex; gap:28px; margin-left:auto; }
  .metric { display:flex; flex-direction:column; gap:2px; }
  .metric .n { font-size:26px; font-weight:640; line-height:1; letter-spacing:-.02em; }
  .metric .n.accent { color:var(--mint); }
  .metric .k { font-size:10.5px; text-transform:uppercase; letter-spacing:.1em; color:var(--dim); }

  .controls { display:flex; flex-wrap:wrap; gap:8px; align-items:center; padding:0 0 18px; }
  button {
    font:inherit; font-size:13px; color:var(--ink); background:transparent;
    border:1px solid var(--line); border-radius:7px; padding:5px 12px; cursor:pointer;
    transition:border-color .12s, color .12s, background .12s;
  }
  button:hover { border-color:var(--mint); color:var(--mint); }
  button:focus-visible { outline:2px solid var(--mint); outline-offset:2px; }
  button[aria-pressed="true"] { background:var(--mint); border-color:var(--mint); color:var(--panel); font-weight:600; }
  .grow { flex:1 1 auto; }
  .count { color:var(--dim); font-size:13px; }

  main { padding:26px 0 90px; }
  .grid { display:grid; gap:22px; grid-template-columns:repeat(auto-fill,minmax(420px,1fr)); }
  @media (max-width:520px) { .grid { grid-template-columns:1fr; } }

  figure {
    margin:0; background:var(--panel); border:1px solid var(--line); border-radius:12px;
    overflow:hidden; display:flex; flex-direction:column; box-shadow:var(--shadow);
  }
  figure.cut { opacity:.42; }
  figure.cut .shot { filter:grayscale(1); }
  .shot { display:block; width:100%; height:auto; background:var(--sunk); cursor:zoom-in; }
  figcaption { padding:13px 15px 15px; display:flex; flex-direction:column; gap:10px; }

  .ident { display:flex; align-items:center; gap:8px; flex-wrap:wrap; }
  .theme { font-weight:640; letter-spacing:-.01em; }
  .masses { color:var(--dim); font-size:13.5px; }
  .id { margin-left:auto; font-size:11px; color:var(--dim); }

  .chip { font-size:10.5px; text-transform:uppercase; letter-spacing:.08em; font-weight:700;
          border-radius:5px; padding:2px 7px; border:1px solid; }
  .chip.live { color:var(--panel); background:var(--mint); border-color:var(--mint); }
  .chip.flag { color:var(--amber); border-color:var(--amber); background:transparent; }

  .note { color:var(--dim); font-size:13.5px; margin:0; }

  /* The band is the point: 15-60% is what tests/traced-check.cjs accepts, so show where a
     map sits in it rather than making the reader compare a number to a remembered rule. */
  .band { display:flex; flex-direction:column; gap:5px; }
  .track { position:relative; height:6px; border-radius:3px; background:var(--sunk); overflow:hidden; }
  .ok { position:absolute; inset:0 auto 0 15%; width:45%; background:var(--band); }
  .pin { position:absolute; top:-3px; width:2px; height:12px; border-radius:1px; background:var(--ink); }
  .pin.out { background:var(--amber); }
  .scale { display:flex; justify-content:space-between; font-size:10.5px; color:var(--dim); }

  .stats { display:flex; gap:18px; flex-wrap:wrap; font-size:13px; }
  .stats span { color:var(--dim); }
  .stats b { color:var(--ink); font-weight:640; }
  .stats b.warn { color:var(--amber); }

  .acts { display:flex; gap:8px; }
  .acts button { flex:1; padding:7px 0; }
  .acts .no[aria-pressed="true"] { background:var(--amber); border-color:var(--amber); color:var(--panel); }

  dialog { border:none; padding:0; background:transparent; max-width:96vw; max-height:96vh; }
  dialog img { display:block; max-width:96vw; max-height:96vh; border-radius:6px; }
  dialog::backdrop { background:rgba(4,7,9,.9); }

  footer { color:var(--dim); font-size:13px; padding:0 0 70px; max-width:78ch; }
  footer code { font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace; font-size:12.5px; color:var(--mint); }
  @media (prefers-reduced-motion: reduce) { * { transition:none !important; } }
</style>

<header>
  <div class="wrap">
    <div class="masthead">
      <div>
        <h1>Generated map shortlist</h1>
        <p class="lede">Every image approved so far, measured with <b>the tracer\'s own rules</b> —
          so these are the numbers a trace would produce, not an impression of the picture.</p>
      </div>
      <div class="metrics">
        <div class="metric"><span class="n mono">__COUNT__</span><span class="k">approved</span></div>
        <div class="metric"><span class="n mono">__THEMES__</span><span class="k">themes</span></div>
        <div class="metric"><span class="n mono accent">__PLAYABLE__</span><span class="k">playable now</span></div>
        <div class="metric"><span class="n mono">__INBAND__</span><span class="k">in density band</span></div>
      </div>
    </div>
    <div class="controls" id="filters"></div>
    <div class="controls">
      <span class="count" id="tally"></span><span class="grow"></span>
      <button id="reset">Reset</button>
      <button id="export">Copy decisions as JSON</button>
    </div>
  </div>
</header>

<main class="wrap"><div class="grid" id="grid"></div></main>

<footer class="wrap">
  <p><b>solid</b> is the share of the frame that traces as rock — the bar shows it against the
  15–60% band <code>tests/traced-check.cjs</code> enforces; <code>maze-one</code> plays at 48%.
  <b>masses</b> is how many blobs survive the gravel cut, roughly the sprite count a trace
  yields. <b>fill</b> is a mass\'s area over its bounding box — how solid the shapes are.
  Stone runs 0.63–0.71; anything near 0.40 is mostly holes, and thin shapes are what the
  despeckle opening exists to delete.</p>
  <p>Keep/cut lives in this browser only. <b>Copy decisions as JSON</b> hands the shortlist
  back. Generated by <code>python3 scripts/gen-map-review.py</code> — edit the script, not the
  page. Rejected images and the reasoning behind every sweep are in
  <code>docs/maps/README.md</code>.</p>
</footer>

<dialog id="zoom"><img alt="Enlarged map"></dialog>

<script>
const CARDS = __DATA__;
const KEY = "mycelium.mapreview.v1";
const state = JSON.parse(localStorage.getItem(KEY) || "{}");
let filter = "all";
const grid = document.getElementById("grid");
const zoom = document.getElementById("zoom");
const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ "&":"&amp;","<":"&lt;",">":"&gt;",\'"\':"&quot;" }[c]));

function save() { localStorage.setItem(KEY, JSON.stringify(state)); tally(); }
function tally() {
  const kept = CARDS.filter((c) => state[c.stem] !== "cut").length;
  document.getElementById("tally").textContent =
    kept + " kept · " + (CARDS.length - kept) + " cut";
}

function card(c) {
  const cut = state[c.stem] === "cut";
  const dense = c.solid > 60, sparse = c.solid < 15, thin = c.fill < 0.5;
  const fig = document.createElement("figure");
  fig.className = cut ? "cut" : "";
  fig.innerHTML =
    \'<img class="shot" loading="lazy" alt="\' + esc(c.theme) + \' map, about \' + c.count +
      \' masses" src="\' + c.src + \'">\' +
    \'<figcaption>\' +
      \'<div class="ident"><span class="theme">\' + esc(c.theme) + \'</span>\' +
        \'<span class="masses">~\' + c.count + \' masses</span>\' +
        (c.level ? \'<span class="chip live">playable</span>\' : "") +
        (c.dark_bg ? \'<span class="chip flag">dark ground</span>\' : "") +
        (c.ambiguous ? \'<span class="chip flag">needs --invert</span>\' : "") +
        (c.pending ? \'<span class="chip flag">new — undecided</span>\' : "") +
        \'<span class="id mono">\' + esc(c.level ? "#level," + c.level : c.stem) + \'</span></div>\' +
      \'<p class="note">\' + esc(c.note) + \'</p>\' +
      \'<div class="band"><div class="track"><div class="ok"></div>\' +
        \'<div class="pin\' + (dense || sparse ? " out" : "") + \'" style="left:calc(\' +
          Math.min(100, c.solid) + \'% - 1px)"></div></div>\' +
        \'<div class="scale"><span>0%</span><span>playable 15–60%</span><span>100%</span></div></div>\' +
      \'<div class="stats">\' +
        \'<span>solid <b class="mono \' + (dense || sparse ? "warn" : "") + \'">\' + c.solid + \'%</b></span>\' +
        \'<span>masses <b class="mono">\' + c.masses + \'</b></span>\' +
        \'<span>fill <b class="mono \' + (thin ? "warn" : "") + \'">\' + c.fill.toFixed(2) + \'</b></span>\' +
      \'</div>\' +
      \'<div class="acts">\' +
        \'<button class="yes" aria-pressed="\' + (!cut) + \'">Keep</button>\' +
        \'<button class="no" aria-pressed="\' + cut + \'">Cut</button></div>\' +
    \'</figcaption>\';
  fig.querySelector(".shot").onclick = () => {
    zoom.querySelector("img").src = c.src; zoom.showModal();
  };
  fig.querySelector(".yes").onclick = () => { delete state[c.stem]; save(); render(); };
  fig.querySelector(".no").onclick = () => { state[c.stem] = "cut"; save(); render(); };
  return fig;
}

function render() {
  grid.innerHTML = "";
  for (const c of CARDS) {
    if (filter === "all" || (filter === "new" ? c.pending : c.theme === filter)) grid.appendChild(card(c));
  }
}

const nPending = CARDS.filter((c) => c.pending).length;
const themes = (nPending ? ["all", "new"] : ["all"]).concat(__THEMELIST__);
document.getElementById("filters").innerHTML = themes
  .map((t) => \'<button data-t="\' + t + \'" aria-pressed="\' + (t === "all") + \'">\' + t + "</button>")
  .join("");
document.getElementById("filters").onclick = (e) => {
  const b = e.target.closest("button"); if (!b) return;
  filter = b.dataset.t;
  [...e.currentTarget.children].forEach((x) => x.setAttribute("aria-pressed", x === b));
  render();
};
document.getElementById("reset").onclick = () => {
  for (const k of Object.keys(state)) delete state[k]; save(); render();
};
document.getElementById("export").onclick = async (e) => {
  const out = { kept: [], cut: [] };
  for (const c of CARDS) (state[c.stem] === "cut" ? out.cut : out.kept).push(c.stem);
  try { await navigator.clipboard.writeText(JSON.stringify(out, null, 2)); e.target.textContent = "Copied"; }
  catch (_) { e.target.textContent = "Copy failed"; }
  setTimeout(() => { e.target.textContent = "Copy decisions as JSON"; }, 1500);
};
zoom.onclick = () => zoom.close();

tally(); render();
</script>
"""

html = (HTML
        .replace('__DATA__', json.dumps(cards))
        .replace('__THEMELIST__', json.dumps(themes))
        .replace('__COUNT__', str(len(cards)))
        .replace('__THEMES__', str(len(themes)))
        .replace('__PLAYABLE__', str(playable))
        .replace('__INBAND__', str(inband)))

out = ARGS.inline if ARGS.inline else os.path.join(ROOT, 'docs', 'map-review.html')
with open(out, 'w') as f:
    f.write(html)
print(f'\nwrote {out} — {len(cards)} images, {len(themes)} themes, {playable} already playable')
