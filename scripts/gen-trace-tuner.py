#!/usr/bin/env python3
"""Generate docs/trace-tuner.html — tune a map's trace parameters by hand, live.

    python3 scripts/gen-trace-tuner.py obsidian-c55 amethyst-c40 …
    python3 scripts/gen-trace-tuner.py --all
    python3 scripts/gen-trace-tuner.py --inline /tmp/tuner.html obsidian-c55

Why the pipeline is reimplemented in JavaScript instead of this driving trace-map.py: the
repo runs in a container the owner cannot reach, so a localhost server is no use to them.
A self-contained page with the source image embedded runs anywhere, including a published
artifact, and a slider that costs a round trip to a Python process is not a slider anyone
will actually drag.

The JS mirrors trace-map.py stage for stage — threshold, chroma rescue, opening, drop
components with no dark rock, closing, fill holes, gravel cut, trim, feather, bleed — and
composites the result over the game's own soil colour, with the renderer's ambient multiply
applied so what you see is what the level looks like in play rather than what the sprite
looks like in a viewer.

Two things it is NOT:
  • not exact. It works on the 1x source (1440px) where the real trace works on the 4x
    upscale, so radii are quartered and a 1px difference here is 4px there. It is for
    finding the right NUMBERS, after which trace-map.py produces the real sprites.
  • not a writer. It exports JSON; scripts/implement-maps.py reads it and passes the values
    through. Nothing here touches the repo.
"""

import argparse, base64, io, json, os, sys
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MAPS = os.path.join(ROOT, 'docs', 'maps')
LEVELS = os.path.join(ROOT, 'docs', 'levels')

ap = argparse.ArgumentParser()
ap.add_argument('ids', nargs='*', help='level ids to include')
ap.add_argument('--all', action='store_true', help='every traced level (a big page)')
ap.add_argument('--inline', metavar='PATH', help='write here instead of docs/trace-tuner.html')
ap.add_argument('--width', type=int, default=1000,
                help='embed the source at this width. The tuner works on the 1x image; 1000 '
                     'is enough to judge an edge and keeps the page loadable.')
ARGS = ap.parse_args()


def src_for(lid):
    p = os.path.join(LEVELS, f'{lid}.json')
    if not os.path.exists(p):
        return None, None
    lvl = json.load(open(p))
    t = (lvl.get('traced') or {}).get('image')
    if not t:
        return None, None
    full = os.path.join(ROOT, t.replace('@4x', ''))
    return (full if os.path.exists(full) else None), lvl


def data_uri(path, width):
    im = Image.open(path).convert('RGB')
    if im.width > width:
        im = im.resize((width, round(im.height * width / im.width)), Image.LANCZOS)
    buf = io.BytesIO()
    im.save(buf, 'WEBP', quality=88, method=4)
    return 'data:image/webp;base64,' + base64.b64encode(buf.getvalue()).decode()


ids = ARGS.ids
if ARGS.all:
    ids = sorted(f[:-5] for f in os.listdir(LEVELS) if f.endswith('.json'))
if not ids:
    print('name at least one level id, or pass --all', file=sys.stderr)
    sys.exit(2)

maps = []
for lid in ids:
    path, lvl = src_for(lid)
    if not path:
        print(f'  skipping {lid} — no source image recorded in its traced block', file=sys.stderr)
        continue
    tr = lvl.get('traced') or {}
    maps.append(dict(id=lid, name=lvl.get('name') or lid, src=data_uri(path, ARGS.width),
                     shipped=dict(threshold=tr.get('threshold'), minArea=tr.get('minArea'))))

if not maps:
    print('nothing to tune', file=sys.stderr)
    sys.exit(1)

MAPS_JSON = json.dumps(maps)

# No <!doctype>/<meta>: published as an Artifact the host supplies its own document
# skeleton, and a second doctype ahead of it makes the page 404 rather than render badly.
HTML = """<title>Mycelium — trace tuner</title>
<style>
  :root {
    --ground:#eef1f0; --panel:#fff; --sunk:#e6ebe9; --line:#d4dedb;
    --ink:#101a1e; --dim:#5a6970; --mint:#0c7c66; --amber:#8f5c0c;
    --shadow:0 1px 2px rgba(16,26,30,.07), 0 10px 30px -16px rgba(16,26,30,.25);
  }
  @media (prefers-color-scheme: dark) { :root {
    --ground:#0b100f; --panel:#141b19; --sunk:#0e1413; --line:#22302c;
    --ink:#e8f0ed; --dim:#8ba099; --mint:#57d6ab; --amber:#e0a54a;
    --shadow:0 1px 2px rgba(0,0,0,.5), 0 12px 34px -18px rgba(0,0,0,.8); } }
  :root[data-theme="dark"] {
    --ground:#0b100f; --panel:#141b19; --sunk:#0e1413; --line:#22302c;
    --ink:#e8f0ed; --dim:#8ba099; --mint:#57d6ab; --amber:#e0a54a;
    --shadow:0 1px 2px rgba(0,0,0,.5), 0 12px 34px -18px rgba(0,0,0,.8); }
  :root[data-theme="light"] {
    --ground:#eef1f0; --panel:#fff; --sunk:#e6ebe9; --line:#d4dedb;
    --ink:#101a1e; --dim:#5a6970; --mint:#0c7c66; --amber:#8f5c0c;
    --shadow:0 1px 2px rgba(16,26,30,.07), 0 10px 30px -16px rgba(16,26,30,.25); }
  * { box-sizing:border-box; }
  body { margin:0; background:var(--ground); color:var(--ink);
    font:15px/1.5 ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; }
  .wrap { max-width:1280px; margin:0 auto; padding:28px 18px 96px; }
  h1 { font-size:24px; margin:0 0 6px; letter-spacing:-.015em; }
  header p { color:var(--dim); margin:0 0 18px; max-width:64ch; }
  .pick { display:flex; gap:7px; flex-wrap:wrap; margin-bottom:16px; }
  .chip { font:600 12px/1 ui-sans-serif, system-ui; padding:7px 12px; border:1px solid var(--line);
    border-radius:999px; background:var(--panel); color:var(--dim); cursor:pointer; }
  .chip[aria-pressed="true"] { color:var(--mint); border-color:var(--mint); }
  .stage { display:grid; grid-template-columns:1fr 300px; gap:16px; align-items:start; }
  @media (max-width:960px) { .stage { grid-template-columns:1fr; } }
  .views { display:grid; gap:10px; }
  figure { margin:0; background:var(--panel); border:1px solid var(--line); border-radius:12px;
    padding:10px; box-shadow:var(--shadow); }
  canvas, figure img { width:100%; height:auto; display:block; border-radius:7px;
    image-rendering:auto; background:#2a1d12; }
  figcaption { font:600 10.5px/1.4 ui-sans-serif, system-ui; letter-spacing:.1em;
    text-transform:uppercase; color:var(--dim); padding-top:7px; }
  .panel { background:var(--panel); border:1px solid var(--line); border-radius:12px;
    padding:14px; box-shadow:var(--shadow); position:sticky; top:14px; }
  .grp { font:700 10px/1 ui-sans-serif, system-ui; letter-spacing:.13em; text-transform:uppercase;
    color:var(--mint); margin:14px 0 8px; }
  .grp:first-child { margin-top:0; }
  label { display:block; font-size:12.5px; color:var(--dim); margin-bottom:11px; }
  label b { color:var(--ink); font-variant-numeric:tabular-nums; float:right; font-weight:600; }
  input[type=range] { width:100%; accent-color:var(--mint); margin-top:5px; }
  .hint { font-size:11.5px; color:var(--dim); line-height:1.45; margin:-6px 0 11px; }
  .stats { font:12px/1.6 ui-monospace, SFMono-Regular, Menlo, monospace; color:var(--dim);
    border-top:1px solid var(--line); margin-top:12px; padding-top:10px; }
  .stats b { color:var(--ink); }
  .out { color:var(--amber); }
  .foot { position:fixed; left:0; right:0; bottom:0; background:var(--panel);
    border-top:1px solid var(--line); padding:10px 18px; display:flex; gap:9px;
    justify-content:center; align-items:center; z-index:9; }
  .btn { font:700 12.5px/1 ui-sans-serif, system-ui; padding:10px 15px; border-radius:9px;
    border:1px solid var(--mint); background:var(--mint); color:var(--ground); cursor:pointer; }
  .btn.ghost { background:transparent; color:var(--mint); }
  button:focus-visible, input:focus-visible, .chip:focus-visible { outline:2px solid var(--mint); outline-offset:2px; }
</style>

<div class="wrap">
  <header>
    <h1>Trace tuner</h1>
    <p>Every stage of <code>scripts/trace-map.py</code>, live on the 1&times; source. The
      preview composites the cut-out over the game's soil, which since
      <code>render.lighting</code> was turned off is exactly what the player sees. Radii are
      in 1&times; pixels &mdash; the real trace runs on the 4&times; upscale and multiplies
      them by four. Find the numbers here; <em>Export</em> hands them back.</p>
  </header>

  <div class="pick" id="pick"></div>

  <div class="stage">
    <div class="views">
      <figure><canvas id="cv"></canvas><figcaption id="cap">result — over the game's soil</figcaption></figure>
      <figure><img id="srcimg" alt="source"><figcaption>source image</figcaption></figure>
    </div>

    <div class="panel">
      <div class="grp">Mask</div>
      <label>Threshold <b id="v_th"></b><input type="range" id="th" min="60" max="210" step="1"></label>
      <p class="hint">Rock is anything darker than this. Above ~128 the drop shadows come in as
        solid rock &mdash; a wall you cannot see.</p>
      <label>Chroma rescue <b id="v_ch"></b><input type="range" id="ch" min="0" max="120" step="2"></label>
      <p class="hint">Keeps a saturated feature (a cyan vein, a violet band) that is too bright
        for the threshold. 0 turns it off.</p>

      <div class="grp">Shape</div>
      <label>Despeckle / open <b id="v_op"></b><input type="range" id="op" min="0" max="8" step="1"></label>
      <p class="hint">Severs thin filaments &mdash; veins drawn out across the background. Too
        big and it eats the rock.</p>
      <label>Close <b id="v_cl"></b><input type="range" id="cl" min="0" max="12" step="1"></label>
      <p class="hint">Repairs the ragged rim a low threshold leaves where a lit face meets the
        dark core. Fills notches narrower than itself; puts the outline back.</p>
      <label>Gravel cut <b id="v_ga"></b><input type="range" id="ga" min="0" max="1200" step="20"></label>
      <p class="hint">Drop blobs smaller than this (1&times; px&sup2;). Each one would be a
        pinprick of collision with no visible cause.</p>

      <div class="grp">Edge</div>
      <label>Trim <b id="v_tr"></b><input type="range" id="tr" min="0" max="4" step="1"></label>
      <p class="hint">Erode before cutting, to drop the anti-aliased ring &mdash; the bright
        1&ndash;2px band between rock and background.</p>
      <label>Feather <b id="v_fe"></b><input type="range" id="fe" min="0" max="6" step="1"></label>
      <p class="hint">Width of the alpha ramp. Every pixel of it is rock-grey over brown soil,
        so wide reads as a halo. Narrow.</p>
      <label>Bleed <b id="v_bl"></b><input type="range" id="bl" min="0" max="12" step="1"></label>
      <p class="hint">How far the colour is carried outward under the transparent pixels. Never
        visible; it only has to out-reach the filter kernel. Wide is free.</p>

      <div class="stats" id="stats"></div>
    </div>
  </div>
</div>

<div class="foot">
  <button class="btn" id="export">Export JSON</button>
  <button class="btn ghost" id="copy">Copy</button>
  <button class="btn ghost" id="reset">Reset this map</button>
</div>

<script>
const MAPS = __MAPS__;
const KEY = 'mycelium.tracetuner.v1';
const store = JSON.parse(localStorage.getItem(KEY) || '{}');
const DEF = { th:128, ch:40, op:1, cl:4, ga:150, tr:1, fe:1, bl:4 };
const IDS = ['th','ch','op','cl','ga','tr','fe','bl'];
let cur = 0, img = null, srcData = null;

const $ = (id) => document.getElementById(id);
const cv = $('cv'), cx = cv.getContext('2d', { willReadFrequently:true });

function params() { return Object.assign({}, DEF, store[MAPS[cur].id] || {}); }

function setUI(p) {
  for (const k of IDS) {
    $(k).value = p[k];
    $('v_' + k).textContent = p[k];
  }
}

// ---- the pipeline, mirroring trace-map.py stage for stage -------------------
// Binary morphology by a chamfer distance transform rather than N dilations: a radius-8
// closing as iterated 3x3 passes is 16 passes over a million pixels on every slider move,
// which is not interactive. Two distance passes are.
function distTransform(mask, W, H) {
  const D = new Float32Array(W * H);
  const BIG = 1e9;
  for (let i = 0; i < D.length; i++) D[i] = mask[i] ? 0 : BIG;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = y * W + x; let d = D[i];
    if (y > 0)            d = Math.min(d, D[i - W] + 1);
    if (x > 0)            d = Math.min(d, D[i - 1] + 1);
    if (y > 0 && x > 0)   d = Math.min(d, D[i - W - 1] + 1.414);
    if (y > 0 && x < W-1) d = Math.min(d, D[i - W + 1] + 1.414);
    D[i] = d;
  }
  for (let y = H - 1; y >= 0; y--) for (let x = W - 1; x >= 0; x--) {
    const i = y * W + x; let d = D[i];
    if (y < H-1)            d = Math.min(d, D[i + W] + 1);
    if (x < W-1)            d = Math.min(d, D[i + 1] + 1);
    if (y < H-1 && x < W-1) d = Math.min(d, D[i + W + 1] + 1.414);
    if (y < H-1 && x > 0)   d = Math.min(d, D[i + W - 1] + 1.414);
    D[i] = d;
  }
  return D;
}
const dilate = (m, W, H, r) => { if (r <= 0) return m; const D = distTransform(m, W, H);
  const o = new Uint8Array(m.length); for (let i = 0; i < o.length; i++) o[i] = D[i] <= r ? 1 : 0; return o; };
const erode = (m, W, H, r) => { if (r <= 0) return m; const inv = new Uint8Array(m.length);
  for (let i = 0; i < m.length; i++) inv[i] = m[i] ? 0 : 1;
  const D = distTransform(inv, W, H); const o = new Uint8Array(m.length);
  for (let i = 0; i < o.length; i++) o[i] = D[i] > r ? 1 : 0; return o; };

function labelKeep(mask, W, H, minArea, dark) {
  // One pass of flood fill: drop components below the gravel cut, and drop any component
  // with no genuinely dark pixel in it (a stray vein is its own component; a vein inside a
  // rock belongs to the rock's).
  const seen = new Uint8Array(mask.length), out = new Uint8Array(mask.length);
  const stack = new Int32Array(mask.length); let kept = 0, dropped = 0;
  for (let s = 0; s < mask.length; s++) {
    if (!mask[s] || seen[s]) continue;
    let n = 0, top = 0, hasDark = false; stack[top++] = s; seen[s] = 1;
    const cells = [];
    while (top) {
      const i = stack[--top]; cells.push(i); n++;
      if (dark[i]) hasDark = true;
      const x = i % W, y = (i / W) | 0;
      if (x > 0     && mask[i-1] && !seen[i-1]) { seen[i-1]=1; stack[top++]=i-1; }
      if (x < W-1   && mask[i+1] && !seen[i+1]) { seen[i+1]=1; stack[top++]=i+1; }
      if (y > 0     && mask[i-W] && !seen[i-W]) { seen[i-W]=1; stack[top++]=i-W; }
      if (y < H-1   && mask[i+W] && !seen[i+W]) { seen[i+W]=1; stack[top++]=i+W; }
    }
    if (n >= minArea && hasDark) { kept++; for (const i of cells) out[i] = 1; }
    else dropped++;
  }
  return { out, kept, dropped };
}

function fillHoles(mask, W, H) {
  // Flood the background in from the border; anything unreached is an enclosed hole.
  const bg = new Uint8Array(mask.length), stack = [];
  const push = (i) => { if (!mask[i] && !bg[i]) { bg[i] = 1; stack.push(i); } };
  for (let x = 0; x < W; x++) { push(x); push((H-1)*W + x); }
  for (let y = 0; y < H; y++) { push(y*W); push(y*W + W-1); }
  while (stack.length) {
    const i = stack.pop(), x = i % W, y = (i / W) | 0;
    if (x > 0)   push(i-1);
    if (x < W-1) push(i+1);
    if (y > 0)   push(i-W);
    if (y < H-1) push(i+W);
  }
  const o = new Uint8Array(mask.length);
  for (let i = 0; i < o.length; i++) o[i] = (mask[i] || !bg[i]) ? 1 : 0;
  return o;
}

function run() {
  if (!srcData) return;
  const p = params(), W = srcData.width, H = srcData.height, d = srcData.data;
  const N = W * H;
  const lum = new Float32Array(N), maxc = new Uint8Array(N), minc = new Uint8Array(N);
  for (let i = 0, j = 0; i < N; i++, j += 4) {
    const r = d[j], g = d[j+1], b = d[j+2];
    lum[i] = (r + g + b) / 3;
    maxc[i] = Math.max(r, g, b); minc[i] = Math.min(r, g, b);
  }
  const dark = new Uint8Array(N);
  let mask = new Uint8Array(N);
  for (let i = 0; i < N; i++) {
    dark[i] = lum[i] < p.th ? 1 : 0;
    const chromatic = p.ch > 0 && (maxc[i] - minc[i]) > p.ch && minc[i] < 200;
    mask[i] = (dark[i] || chromatic) ? 1 : 0;
  }
  const srcMask = mask;                       // colour comes from here, alpha from `mask`
  if (p.op > 0) mask = dilate(erode(mask, W, H, p.op), W, H, p.op);
  const L = labelKeep(mask, W, H, p.ga, dark);
  mask = L.out;
  if (p.cl > 0) mask = erode(dilate(mask, W, H, p.cl), W, H, p.cl);
  mask = fillHoles(mask, W, H);
  if (p.tr > 0) mask = erode(mask, W, H, p.tr);

  // Alpha ramp by DISTANCE, never by luminance: the brightness outside a rock is its rim and
  // its shadow, which differ under every rock, so a luminance ramp fades each one differently.
  const inv = new Uint8Array(N);
  for (let i = 0; i < N; i++) inv[i] = mask[i] ? 0 : 1;
  const dOut = distTransform(inv, W, H);      // 0 inside the mask, grows outward
  const alpha = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    alpha[i] = mask[i] ? 1 : (p.fe > 0 ? Math.max(0, 1 - dOut[i] / (p.fe + 1)) : 0);
  }

  // Bleed: a transparent pixel takes the colour of the nearest pixel that is real rock in the
  // SOURCE mask. Without it the near-white background sits in the transparent pixels and
  // downscaling blends it back in as a pale halo.
  //
  // Grown outward one ring at a time, each new pixel averaging the neighbours that already
  // have colour. The first version searched along 8 rays at increasing radius and produced
  // visible SPOKES around every rock — which is the same failure CLAUDE.md already records
  // for the real tracer ("nearest-opaque alone is a Voronoi diagram of the edge, which fans
  // into visible spokes"), arrived at independently. Averaging is what blurs it away.
  const bR = new Float32Array(N), bG = new Float32Array(N), bB = new Float32Array(N);
  const has = new Uint8Array(N);
  for (let i = 0, j = 0; i < N; i++, j += 4) {
    if (srcMask[i]) { bR[i] = d[j]; bG[i] = d[j+1]; bB[i] = d[j+2]; has[i] = 1; }
  }
  for (let pass = 0; pass < Math.max(1, p.bl); pass++) {
    const add = [];
    for (let i = 0; i < N; i++) {
      if (has[i]) continue;
      const x = i % W, y = (i / W) | 0;
      let r = 0, g = 0, b = 0, n = 0;
      if (x > 0   && has[i-1]) { r += bR[i-1]; g += bG[i-1]; b += bB[i-1]; n++; }
      if (x < W-1 && has[i+1]) { r += bR[i+1]; g += bG[i+1]; b += bB[i+1]; n++; }
      if (y > 0   && has[i-W]) { r += bR[i-W]; g += bG[i-W]; b += bB[i-W]; n++; }
      if (y < H-1 && has[i+W]) { r += bR[i+W]; g += bG[i+W]; b += bB[i+W]; n++; }
      if (n) add.push(i, r / n, g / n, b / n);
    }
    for (let k = 0; k < add.length; k += 4) {
      const i = add[k]; bR[i] = add[k+1]; bG[i] = add[k+2]; bB[i] = add[k+3]; has[i] = 1;
    }
  }
  const out = cx.createImageData(W, H);
  const o = out.data;
  const soil = [42, 29, 18];
  for (let i = 0, j = 0; i < N; i++, j += 4) {
    let r, g, b;
    if (srcMask[i] && mask[i]) { r = d[j]; g = d[j+1]; b = d[j+2]; }
    else if (has[i]) { r = bR[i]; g = bG[i]; b = bB[i]; }
    else { r = soil[0]; g = soil[1]; b = soil[2]; }
    const a = alpha[i];
    // Straight composite over the game's soil. render.lighting is off, so this IS the
    // frame the player sees — there is no ambient multiply left to reproduce.
    o[j]   = (r * a + soil[0] * (1 - a)) | 0;
    o[j+1] = (g * a + soil[1] * (1 - a)) | 0;
    o[j+2] = (b * a + soil[2] * (1 - a)) | 0;
    o[j+3] = 255;
  }
  cx.putImageData(out, 0, 0);

  let solid = 0; for (let i = 0; i < N; i++) if (mask[i]) solid++;
  const pct = 100 * solid / N;
  $('stats').innerHTML =
    `solid <b class="${pct < 15 || pct > 60 ? 'out' : ''}">${pct.toFixed(1)}%</b> ` +
    `<span style="opacity:.6">(band 15–60)</span><br>` +
    `masses <b>${L.kept}</b> · dropped <b>${L.dropped}</b><br>` +
    `at 4×: open ${p.op*4} · close ${p.cl*4} · trim ${p.tr*4} · feather ${p.fe*4} · ` +
    `bleed ${p.bl*4} · min-area ${p.ga*16}`;
}

function load(i) {
  cur = i;
  document.querySelectorAll('#pick .chip').forEach((c, k) => c.setAttribute('aria-pressed', String(k === i)));
  const m = MAPS[i];
  $('srcimg').src = m.src;
  const im = new Image();
  im.onload = () => {
    cv.width = im.naturalWidth; cv.height = im.naturalHeight;
    cx.drawImage(im, 0, 0);
    srcData = cx.getImageData(0, 0, cv.width, cv.height);
    $('cap').textContent = m.name + ' — over the soil';
    setUI(params()); run();
  };
  im.src = m.src;
}

const pick = $('pick');
MAPS.forEach((m, i) => {
  const b = document.createElement('button');
  b.className = 'chip'; b.type = 'button'; b.textContent = m.name;
  b.onclick = () => load(i);
  pick.append(b);
});
for (const k of IDS) {
  $(k).addEventListener('input', () => {
    const p = params(); p[k] = Number($(k).value);
    store[MAPS[cur].id] = p; localStorage.setItem(KEY, JSON.stringify(store));
    $('v_' + k).textContent = p[k];
    run();
  });
}
function payload() {
  const out = {};
  for (const m of MAPS) if (store[m.id]) {
    const p = Object.assign({}, DEF, store[m.id]);
    out[m.id] = {  // in 4x units, which is what trace-map.py takes
      threshold: p.th, chroma: p.ch, despeckle: p.op * 4, close: p.cl * 4,
      minArea: p.ga * 16, trim: p.tr * 4, feather: p.fe * 4, bleed: p.bl * 4,
    };
  }
  return out;
}
$('export').onclick = () => {
  const blob = new Blob([JSON.stringify(payload(), null, 2)], { type:'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = 'trace-params.json'; a.click();
};
$('copy').onclick = async () => {
  await navigator.clipboard.writeText(JSON.stringify(payload(), null, 2));
  const b = $('copy'), t = b.textContent; b.textContent = 'Copied';
  setTimeout(() => (b.textContent = t), 1200);
};
$('reset').onclick = () => { delete store[MAPS[cur].id]; localStorage.setItem(KEY, JSON.stringify(store)); setUI(DEF); run(); };
load(0);
</script>
"""

out = ARGS.inline or os.path.join(ROOT, 'docs', 'trace-tuner.html')
open(out, 'w').write(HTML.replace('__MAPS__', MAPS_JSON))
print(f'wrote {out} — {len(maps)} map(s): {", ".join(m["id"] for m in maps)}')
