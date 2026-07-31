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
    ('ember-scatter-c20-4',       'ember',           20, None,           'Cleanest of the second ember round — even mass size, real separation.'),
    ('ember-scatter-c24-3',        'ember',          24, None,           'In band, good spread, fissures dim and contained.'),
    ('ember-scatter-c30-5',        'ember',          30, None,           'Chunkier masses, strong fissures.'),
    ('skeletons-scatter-c12-1',   'skeletons',       12, None,           'All fossil. Fill ratio says it traces to fragments, not terrain.'),
    ('rich-crystal-scatter-c70-1', 'crystal',        70, None,           'The one keep of the --rich round, and provisional — 20% of the frame is shadow the tracer would bake into collision.'),
    # The first --view top round. All five kept; the camera change is what made them work.
    ('top-veined-scatter-c9-1',    'veined',           9, None,           'Top-down. Large masses, wide channels, almost no gravel.'),
    ('top-veined-scatter-c28-1',   'veined',          28, None,           'Top-down. Best of the first overhead round — even masses, real channels, 0.70 fill.'),
    ('top-crystal-scatter-c36-1',  'crystal',         36, None,           'Top-down. Lighting too bright — the roll that prompted DARK_TONE.'),
    ('top-crystal-scatter-c70-1',  'crystal',         70, None,           'Top-down. Same lighting problem, good mass spread.'),
    ('top-bioluminescent-scatter-c20-1', 'bioluminescent', 20, None,      'Top-down. Fixed the polarity the side-on version was ambiguous on: 0.68 fill against 0.38.'),
    # The all-theme sweep, overhead and dark. The owner cut bones/skeletons, the two
    # bioluminescent rolls, crystal c24-2 and ember c24; these are what survived.
    ('top-scatter-c24-1',          'slate',           24, None,           'Overhead + dark. The cleanest image the project has produced: 0.71 fill and 9 gravel specks in the whole frame.'),
    ('top-scatter-c40-1',          'slate',           40, None,           'Overhead + dark, denser.'),
    ('top-veined-scatter-c24-1',   'veined',          24, None,           'Overhead + dark. Dense at 66% — would need the count raised.'),
    ('top-veined-scatter-c40-1',   'veined',          40, None,           'Overhead + dark. One vein escapes onto the background; the rest is strong.'),
    ('top-crystal-scatter-c24-1',  'crystal',         24, None,           'Overhead, before DARK_TONE landed — lighter stone.'),
    ('top-crystal-scatter-c40-1',  'crystal',         40, None,           'Overhead, before DARK_TONE — dense at 67%.'),
    ('top-crystal-scatter-c40-2',  'crystal',         40, None,           'Overhead + dark v2. Rock luminance 59 against 90 for c40-1, and the gems are back inside the rock.'),
    ('top-ice-scatter-c24-1',      'ice',             24, None,           'Overhead + dark.'),
    ('top-ice-scatter-c40-1',      'ice',             40, None,           'Overhead + dark. Dense at 64%.'),
    ('top-ember-scatter-c40-1',    'ember',           40, None,           'Overhead + dark. The c24 of this pair was cut as too evenly arranged.'),
    ('top-glacier-scatter-c24-1',  'glacier',         24, None,           'Overhead. Black ground, so exempt from DARK_TONE.'),
    ('top-glacier-scatter-c40-1',  'glacier',         40, None,           'Overhead. Black ground, denser.'),
    # First round of new themes. obsidian and strata kept; rust kept at the two counts that
    # landed. roots and ruins were cut — see docs/maps/README.md for why they failed together.
    ('top-obsidian-scatter-c24-1', 'obsidian',        24, None,           'Volcanic glass. 43 masses at 42.9%; glass has no grain to render texture into, which is why it comes out this clean.'),
    ('top-obsidian-scatter-c40-1', 'obsidian',        40, None,           'Denser obsidian, just over the band at 61.8%.'),
    ('top-strata-scatter-c40-1',   'strata',          40, None,           'Layered sedimentary banding — the only theme whose feature is a direction. Kept, but the theme is closed: too close to the plain rock maps.'),
    ('top-rust-scatter-c40-1',     'rust',            40, None,           'Banded ironstone. Dense at 76%, but the material reads.'),
    ('top-rust-scatter-c90-1',     'rust',            90, None,           'Rust at the count where it separates: 33 masses, 58.1%, largest blob 23%.'),
    # Round two. Everything kept except the three basalt v2 rolls and anthracite c40.
    ('top-obsidian-scatter-c15-1', 'obsidian',        15, None,           'Obsidian at a low count — 41 masses at 52.6%. Count moves mass size here, not mass number.'),
    ('top-obsidian-scatter-c32-1', 'obsidian',        32, None,           'The most open obsidian: 40.8%, 0.68 fill.'),
    ('top-obsidian-scatter-c55-1', 'obsidian',        55, None,           'Best obsidian in the set: 45 masses, 44.8%, 0.71 fill, largest blob 10%.'),
    ('top-obsidian-scatter-c70-1', 'obsidian',        70, None,           'Very open at 38.7%, but the rock stops short of the bottom edge.'),
    ('top-rust-scatter-c30-1',     'rust',            30, None,           'Dense at 69.4%.'),
    ('top-rust-scatter-c75-1',     'rust',            75, None,           'Dense at 84.2%.'),
    ('top-rust-scatter-c85-1',     'rust',            85, None,           'The other count where rust separates: 59.6%, 27 masses.'),
    ('top-rust-scatter-c100-1',    'rust',           100, None,           'Out of band at 72.2%.'),
    ('top-rust-scatter-c110-1',    'rust',           110, None,           'Densest rust at 79.7%, but the masses stay distinct.'),
    ('top-basalt-scatter-c24-1',   'basalt',          24, None,           'The basalt theme drew no hexagons at all — kept as plain dark rock, which is what it is.'),
    ('top-glass-scatter-c24-1',    'glass',           24, None,           'Shattered plate glass: flat spiky shards with radiating cracks. 43 masses at 40.7%.'),
    ('top-glass-scatter-c40-1',    'glass',           40, None,           'Denser glass, just over the band at 63.9%.'),
    ('top-anthracite-scatter-c24-1', 'anthracite',    24, None,           'The darkest image the project has produced — rock luminance 52.7.'),
    ('top-magnetite-scatter-c24-1', 'magnetite',      24, None,           'Octahedral habit: masses that read as built rather than weathered.'),
    ('top-magnetite-scatter-c40-1', 'magnetite',      40, None,           'Best magnetite: 46 masses, 52.8%, largest blob 10%.'),
    # Round three: the first coloured themes — the mass carries the colour, not a feature
    # inside it. All four kept. These run on DEEP_TONE rather than DARK_TONE.
    ('top-amethyst-scatter-c24-1', 'amethyst',        24, None,           'Violet quartz, faceted. The palest theme in the set — Otsu had to climb to 175 to hold it.'),
    ('top-amethyst-scatter-c40-1', 'amethyst',        40, None,           'Safer value than c24 at luminance 85, 42 masses.'),
    ('top-malachite-scatter-c24-1', 'malachite',      24, None,           'Concentric banding — the only closed-curve feature in the set. Covers 69% of frame rows.'),
    ('top-malachite-scatter-c40-1', 'malachite',      40, None,           'Best malachite: 53.8%, full frame, 7 gravel specks.'),
    ('top-hematite-scatter-c24-1', 'hematite',        24, None,           'Kidney ore — the only ROUND masses in the set. 50 masses, largest blob 7%.'),
    ('top-hematite-scatter-c40-1', 'hematite',        40, None,           'Fewer, bigger lobes; the most saturated image the project has (chroma 83).'),
    ('top-azurite-scatter-c24-1',  'azurite',         24, None,           'Radiating crystal sprays, 51 masses at 42.4%. Indigo keeps it clear of ice.'),
    ('top-azurite-scatter-c40-1',  'azurite',         40, None,           'Strongest sprays, dense at 62.4%.'),
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


# A pending card is the owner's call, but a read on it saves them opening five images to work
# out which two are worth looking at. Anything not listed here just says "awaiting a decision".
PENDING_NOTES = {
    'top-obsidian-scatter-c24-1':
        'Works. 43 masses at 42.9% solid, evenly dark, and the fracture lines read as surface '
        'detail rather than as cracks through the mask.',
    'top-obsidian-scatter-c40-1':
        'Works, denser — 61.8%, just over the band.',
    'top-strata-scatter-c24-1':
        'The museum shelf again, in spite of the new irregular-spacing wording: four tidy rows '
        'of specimens.',
    'top-strata-scatter-c40-1':
        'Works. 45 masses, 0.70 fill, and the level banding gives the field a shared grain.',
    'top-roots-scatter-c24-1':
        'Fails on both of the things you cut last round: photographic, and the roots came out '
        'bleached pale — which is also the one value the tracer reads as background.',
    'top-roots-scatter-c40-1':
        'Same failure, worse: 17 masses in a horizontal band with 828 gravel specks.',
    'top-rust-scatter-c24-1':
        'Material is right, composition is not — 78% solid.',
    'top-rust-scatter-c40-1':
        'Still 76% solid; the masses merge instead of separating.',
    'top-rust-scatter-c60-1':
        'Worst of them: one blob is 97% of all the rock in the frame.',
    'top-rust-scatter-c90-1':
        'Works, and only at this count. 33 masses, 58.1%, largest blob down to 23%.',
    'top-ruins-scatter-c24-1':
        'Concrete came out pale in spite of being specified soot-black, and the layout is a '
        'grid. No reinforcing bar anywhere.',
    'top-ruins-scatter-c40-1':
        'Pale again, and the rubble forms a border around an empty middle — the cavern shape '
        'the tail bans by name. 4753 gravel specks.',
    # Round two: more obsidian and rust at the owner's request, plus basalt, glass,
    # anthracite and magnetite.
    'top-obsidian-scatter-c15-1':
        'Obsidian holds at a low count: 41 masses, 52.6%. The count controls mass SIZE more '
        'than mass number here.',
    'top-obsidian-scatter-c32-1': 'The most open obsidian in the set — 40.8%, 0.68 fill.',
    'top-obsidian-scatter-c55-1':
        'Best of the new obsidian: 45 masses, 44.8%, 0.71 fill, largest blob only 10%.',
    'top-obsidian-scatter-c70-1':
        '38.7% and very open, but the rock stops short of the bottom edge (81% row coverage).',
    'top-rust-scatter-c30-1':  'Dense at 69.4%.',
    'top-rust-scatter-c75-1':  'Dense at 84.2%.',
    'top-rust-scatter-c85-1':
        'In band at 59.6% — joins c90 as a count where rust separates instead of merging.',
    'top-rust-scatter-c100-1': 'Back out of band at 72.2%.',
    'top-rust-scatter-c110-1': 'Densest of the set at 79.7%, but the masses stay distinct.',
    'top-basalt-scatter-c24-1':
        'v1 of the theme: not one hexagon in the frame. "Columnar basalt" is a landscape word '
        'and every picture behind it is a cliff shot from the side.',
    'top-basalt-scatter-c40-1': 'v1 again — plain rock, and the masses merged.',
    'top-basalt-scatter-c30-1':
        'v2 got the honeycomb and lost the composition: the whole frame is ONE tiled slab.',
    'top-basalt-scatter-c45-1':
        'v2, closest to working — real hexagons, and a few separate masses around the fringe, '
        'but 97% of the rock is still one blob.',
    'top-glass-scatter-c24-1':
        'Works. Flat shard plates with radiating cracks — a genuinely different silhouette '
        'from obsidian, long straight edges and sharp points. 43 masses at 40.7%.',
    'top-glass-scatter-c40-1': 'Denser glass at 63.9%, just over the band.',
    'top-anthracite-scatter-c24-1':
        'Works, and it is the darkest image the project has produced (luminance 52.7). Watch '
        'the pyrite: STYLE_GUIDE reserves warm amber for ant tunnels and a few seams here are '
        'brighter gold than the clause asked for.',
    'top-anthracite-scatter-c40-1':
        'Same material, but the masses merged — 86% of the rock is one blob.',
    'top-magnetite-scatter-c24-1':
        'Works. Crystal facets rather than weathered lumps, 43.6%.',
    'top-magnetite-scatter-c40-1':
        'Best magnetite: 46 masses, 52.8%, largest blob 10%.',
    # Round three: the coloured themes. The MASS carries the colour here rather than a feature
    # inside it, so these are the first themes to run on DEEP_TONE instead of DARK_TONE.
    'top-amethyst-scatter-c24-1':
        'Violet quartz, faceted. In band at 33.6% over 38 masses — but the palest theme yet at '
        'luminance 110, and the Otsu cut had to climb to 175 to hold it. Watch the lilac faces.',
    'top-amethyst-scatter-c40-1':
        'Better value than c24 (luminance 85) and 42 masses at 46.3%. A few faces still come '
        'back near-white where the geode centres are.',
    'top-malachite-scatter-c24-1':
        'The concentric banding works, but the masses only cover 69% of the frame rows — a '
        'band across the middle with empty top and bottom.',
    'top-malachite-scatter-c40-1':
        'Best malachite: 53.8%, full-frame, and only 7 gravel specks. The nested rings are a '
        'closed-curve feature nothing else in the set has.',
    'top-hematite-scatter-c24-1':
        'Kidney ore. 50 masses at 52.6%, largest blob 7% — the best separation of the round. '
        'The bulbous lobes read as rounded against everything else being angular.',
    'top-hematite-scatter-c40-1':
        'Fewer, bigger lobes at 42.3%; the most saturated image in the project (mean chroma 83).',
    'top-azurite-scatter-c24-1':
        'Radiating crystal sprays, 51 masses at 42.4%. Distinct from ice: indigo rather than '
        'blue-teal, and much darker.',
    'top-azurite-scatter-c40-1':
        'Strongest sprays of the four, but dense at 62.4%.',
    # Round four: more counts for the four coloured themes, plus four more.
    'top-amethyst-scatter-c16-1': 'In band at 44.1%, but 567 gravel specks — the worst of the round.',
    'top-amethyst-scatter-c32-1': '45 masses, 59.9% — right at the top of the band.',
    'top-amethyst-scatter-c60-1': 'Fails: 65.7% and 81% of the rock is one merged blob.',
    'top-malachite-scatter-c16-1': 'Fails: 81.2% over only 10 masses.',
    'top-malachite-scatter-c32-1': 'Just over band at 61.0%, but 24 clean masses and 29 gravel.',
    'top-malachite-scatter-c60-1': 'Dense at 71.3%.',
    'top-hematite-scatter-c16-1':
        '36 masses at 49.8% with NINE gravel specks — the cleanest coloured image yet.',
    'top-hematite-scatter-c32-1': '41 masses at 42.9%, 0.72 fill.',
    'top-hematite-scatter-c60-1':
        '62 masses at 51.1% — the highest mass count of any image in the project.',
    'top-azurite-scatter-c16-1': 'Dense at 70.5%.',
    'top-azurite-scatter-c32-1':
        'Best azurite: 48 masses at 53.3%, largest blob 10%, and the most saturated image in '
        'the project at mean chroma 95.',
    'top-azurite-scatter-c60-1': 'Dense at 60.9%, and 331 gravel specks.',
    'top-fluorite-scatter-c24-1':
        'Cubes did not appear, the bands did. Dense at 63.4%, and the green drifted TEAL — '
        'which is the player\'s mint-cyan, the one hue STYLE_GUIDE says a map may not take.',
    'top-fluorite-scatter-c40-1':
        'Same drift, 58 masses at 64.9%. Pale rims along the band edges too.',
    'top-rhodonite-scatter-c24-1':
        'Works. 50 masses at 51.1%, and the branching dendrites are a feature shape nothing '
        'else in the set has. The red came back cherry rather than the deep raspberry asked for.',
    'top-rhodonite-scatter-c40-1':
        '62 masses, largest blob 7% — excellent separation, but dense at 62.8%.',
    'top-labradorite-scatter-c24-1':
        'Fails: 4 masses, 86.8% solid, one blob holding 88% of the rock.',
    'top-labradorite-scatter-c40-1':
        'Fails the same way — 4 masses, ONE blob holding 100% — and the panels glow in spite of '
        'the clause forbidding it. The theme is a reject.',
    'top-garnet-scatter-c24-1':
        'Works. Embedded whole crystals rather than a pocket, 39.4% over 32 masses. Loose gems '
        'on the background though, which its own clause bans, and the top and bottom edges are '
        'empty (74% row coverage).',
    'top-garnet-scatter-c40-1': 'Dense at 64.7%, but full-frame and better spread than c24.',
}


def pending_row(stem):
    # theme-count-roll, e.g. ember-scatter-c24-2
    bits = stem.split('-')
    theme = bits[0]
    count = next((int(b[1:]) for b in bits if b.startswith('c') and b[1:].isdigit()), 0)
    return (stem, theme, count, None, PENDING_NOTES.get(stem, 'Awaiting a decision.'))


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
