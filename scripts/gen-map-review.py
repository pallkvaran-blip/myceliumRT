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

import base64, json, os
from PIL import Image
import numpy as np
from scipy import ndimage

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


cards = []
for stem, theme, count, level, note in SELECTIONS:
    path = os.path.join(MAPS, f'{stem}.webp')
    m = measure(path)
    m.update(stem=stem, theme=theme, count=count, level=level, note=note,
             kb=round(os.path.getsize(path) / 1024))
    cards.append(m)
    print(f'{stem:32s} solid {m["solid"]:5.1f}%  masses {m["masses"]:3d}  fill {m["fill"]:.2f}'
          f'{"  (dark ground)" if m["dark_bg"] else ""}'
          f'{"  [POLARITY AMBIGUOUS — needs --invert]" if m["ambiguous"] else ""}')

themes = []
for c in cards:
    if c['theme'] not in themes:
        themes.append(c['theme'])
playable = sum(1 for c in cards if c['level'])

HTML = """<!doctype html>
<meta charset="utf-8">
<title>Mycelium — generated map shortlist</title>
<style>
  :root {
    --bg:#0b0e12; --panel:#141a20; --line:#26313b; --ink:#dfe8ee; --dim:#8ea0ad;
    --mint:#5fe0c0; --warn:#e0a24a; --cut:#c8566a;
  }
  * { box-sizing:border-box; }
  body { margin:0; background:var(--bg); color:var(--ink); font:14px/1.55 ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif; }
  header { padding:26px clamp(16px,4vw,48px) 14px; border-bottom:1px solid var(--line); position:sticky; top:0; background:rgba(11,14,18,.94); backdrop-filter:blur(8px); z-index:5; }
  h1 { margin:0 0 4px; font-size:19px; letter-spacing:.02em; font-weight:650; }
  .sub { color:var(--dim); font-size:13px; max-width:78ch; }
  .sub b { color:var(--ink); font-weight:600; }
  .bar { display:flex; gap:8px; flex-wrap:wrap; align-items:center; margin-top:14px; }
  button { font:inherit; color:var(--ink); background:var(--panel); border:1px solid var(--line); border-radius:999px; padding:5px 13px; cursor:pointer; }
  button:hover { border-color:var(--mint); color:var(--mint); }
  button[aria-pressed="true"] { background:var(--mint); color:#06120e; border-color:var(--mint); font-weight:600; }
  .spacer { flex:1; }
  .tally { color:var(--dim); font-size:12.5px; }
  main { padding:22px clamp(16px,4vw,48px) 80px; }
  .grid { display:grid; gap:20px; grid-template-columns:repeat(auto-fill,minmax(430px,1fr)); }
  figure { margin:0; background:var(--panel); border:1px solid var(--line); border-radius:12px; overflow:hidden; display:flex; flex-direction:column; }
  figure.cut { opacity:.4; }
  figure.cut img { filter:grayscale(1); }
  .shot { display:block; width:100%; height:auto; background:#000; cursor:zoom-in; }
  figcaption { padding:11px 14px 13px; display:flex; flex-direction:column; gap:8px; }
  .row { display:flex; align-items:baseline; gap:8px; flex-wrap:wrap; }
  .name { font-weight:600; letter-spacing:.01em; }
  .tag { font-size:11px; text-transform:uppercase; letter-spacing:.07em; color:var(--dim); border:1px solid var(--line); border-radius:999px; padding:1px 8px; }
  .tag.live { color:#06120e; background:var(--mint); border-color:var(--mint); font-weight:700; }
  .tag.dark { color:var(--warn); border-color:#4a3a22; }
  .note { color:var(--dim); font-size:13px; }
  .stats { display:flex; gap:16px; flex-wrap:wrap; font-variant-numeric:tabular-nums; font-size:12.5px; }
  .stats span { color:var(--dim); }
  .stats b { color:var(--ink); font-weight:600; }
  .stats .hot { color:var(--warn); }
  .acts { display:flex; gap:8px; margin-top:2px; }
  .acts button { flex:1; padding:6px 0; }
  .acts .no[aria-pressed="true"] { background:var(--cut); border-color:var(--cut); color:#150609; }
  dialog { border:none; background:#000; padding:0; max-width:96vw; max-height:96vh; }
  dialog img { display:block; max-width:96vw; max-height:96vh; }
  dialog::backdrop { background:rgba(0,0,0,.86); }
  footer { color:var(--dim); font-size:12.5px; padding:0 clamp(16px,4vw,48px) 60px; max-width:88ch; }
  code { color:var(--mint); }
</style>

<header>
  <h1>Generated map shortlist</h1>
  <div class="sub">__COUNT__ approved images across __THEMES__ themes; __PLAYABLE__ are already
    playable in game. Numbers are measured with <b>the tracer's own rules</b>, so they show what
    a trace would see rather than what the picture looks like. <b>solid</b> = share of the frame
    that traces as rock (maze-one plays at 48%; the checks enforce 15–60%). <b>masses</b> =
    blobs surviving the gravel cut, roughly the sprite count. <b>fill</b> = a mass's area over
    its bounding box, i.e. how solid the shapes are — stone runs 0.63–0.67, skeletons
    0.39–0.45.</div>
  <div class="bar" id="filters"></div>
  <div class="bar"><span class="tally" id="tally"></span><span class="spacer"></span>
    <button id="reset">Reset</button><button id="export">Copy decisions as JSON</button></div>
</header>

<main><div class="grid" id="grid"></div></main>

<footer>
  Generated by <code>python3 scripts/gen-map-review.py</code> — edit the script, not this
  file. Keep/cut choices are stored in this browser only (<code>localStorage</code>); use
  <b>Copy decisions as JSON</b> to hand them back. The rejected images and the reasoning behind
  every sweep are in <code>docs/maps/README.md</code>.
</footer>

<dialog id="zoom"><img alt=""></dialog>

<script>
const CARDS = __DATA__;
const KEY = 'mycelium.mapreview.v1';
const state = JSON.parse(localStorage.getItem(KEY) || '{}');
let filter = 'all';

const grid = document.getElementById('grid');
const zoom = document.getElementById('zoom');

function save() { localStorage.setItem(KEY, JSON.stringify(state)); tally(); }

function tally() {
  const kept = CARDS.filter((c) => state[c.stem] !== 'cut').length;
  document.getElementById('tally').textContent =
    kept + ' of ' + CARDS.length + ' kept · ' + (CARDS.length - kept) + ' cut';
}

function render() {
  grid.innerHTML = '';
  for (const c of CARDS) {
    if (filter !== 'all' && c.theme !== filter) continue;
    const cut = state[c.stem] === 'cut';
    const fig = document.createElement('figure');
    if (cut) fig.className = 'cut';
    // fill below 0.5 means the shapes are mostly holes; flag it rather than bury it
    const thin = c.fill < 0.5;
    const dense = c.solid > 60;
    fig.innerHTML =
      '<img class="shot" loading="lazy" src="maps/' + c.stem + '.webp" alt="' + c.stem + '">' +
      '<figcaption>' +
        '<div class="row"><span class="name">' + c.theme + ' · ~' + c.count + ' masses</span>' +
          (c.level ? '<span class="tag live">playable — #level,' + c.level + '</span>' : '') +
          (c.dark_bg ? '<span class="tag dark">dark ground</span>' : '') +
          (c.ambiguous ? '<span class="tag dark">needs --invert</span>' : '') +
          '<span class="tag">' + c.stem + '</span></div>' +
        '<div class="note">' + c.note + '</div>' +
        '<div class="stats">' +
          '<span>solid <b class="' + (dense ? 'hot' : '') + '">' + c.solid + '%</b></span>' +
          '<span>masses <b>' + c.masses + '</b></span>' +
          '<span>fill <b class="' + (thin ? 'hot' : '') + '">' + c.fill.toFixed(2) + '</b></span>' +
        '</div>' +
        '<div class="acts">' +
          '<button class="yes" aria-pressed="' + (!cut) + '">Keep</button>' +
          '<button class="no" aria-pressed="' + cut + '">Cut</button>' +
        '</div>' +
      '</figcaption>';
    fig.querySelector('.shot').onclick = () => {
      zoom.querySelector('img').src = 'maps/' + c.stem + '.webp';
      zoom.showModal();
    };
    fig.querySelector('.yes').onclick = () => { delete state[c.stem]; save(); render(); };
    fig.querySelector('.no').onclick = () => { state[c.stem] = 'cut'; save(); render(); };
    grid.appendChild(fig);
  }
}

const themes = ['all'].concat(__THEMELIST__);
document.getElementById('filters').innerHTML = themes
  .map((t) => '<button data-t="' + t + '" aria-pressed="' + (t === 'all') + '">' + t + '</button>')
  .join('');
document.getElementById('filters').onclick = (e) => {
  const b = e.target.closest('button'); if (!b) return;
  filter = b.dataset.t;
  [...e.currentTarget.children].forEach((x) => x.setAttribute('aria-pressed', x === b));
  render();
};

document.getElementById('reset').onclick = () => {
  for (const k of Object.keys(state)) delete state[k];
  save(); render();
};
document.getElementById('export').onclick = async (e) => {
  const out = { kept: [], cut: [] };
  for (const c of CARDS) (state[c.stem] === 'cut' ? out.cut : out.kept).push(c.stem);
  await navigator.clipboard.writeText(JSON.stringify(out, null, 2)).catch(() => {});
  e.target.textContent = 'Copied';
  setTimeout(() => { e.target.textContent = 'Copy decisions as JSON'; }, 1400);
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
        .replace('__PLAYABLE__', str(playable)))

out = os.path.join(ROOT, 'docs', 'map-review.html')
with open(out, 'w') as f:
    f.write(html)
print(f'\nwrote {out} — {len(cards)} images, {len(themes)} themes, {playable} already playable')
