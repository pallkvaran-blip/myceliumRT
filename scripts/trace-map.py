#!/usr/bin/env python3
"""Trace a generated map image (docs/maps/*.png) into a playable authored level.

    pip install pillow numpy scipy          # not in the container by default
    python3 scripts/trace-map.py docs/maps/maze-1.png --id maze-one --name "Maze One"
    node scripts/gen-levels.mjs             # splice the JSON into index.html

What it does, and why each step is the way it is:

1. THRESHOLD. The silhouette prompts produce a near-bimodal image — rock at luminance
   30..110, background at 240..255 — with a thin tail between them that is anti-aliasing
   plus the soft drop-shadow the model insists on drawing under every rock. A cut at 128
   takes the rock and leaves the shadow behind. Thresholding higher eats the shadow as
   rock and fattens every wall by its width, which is the worst kind of bug in this game:
   an invisible wall (see CLAUDE.md, "Rock has two masks").

2. CLEAR THE CHANNELS. `buildLevel` digs the entry (cols 0..startCols) and goal (last
   goalCols+1) channels and flags them pathClear, which beats rock outright. A sprite
   drawn over them would render as rock the player walks straight through. So the mask is
   zeroed over those bands BEFORE labelling — rocks near the edges get cut off flush,
   which reads as the rock continuing into the wall.

3. LABEL + DROP THE GRAVEL. Every 8-connected blob becomes one sprite. Blobs under
   --min-area are dropped: the models scatter 2-6px specks everywhere, and each one would
   become a pinprick of collision the player can see no reason for.

4. CUT SPRITES. Each blob is cropped from the ORIGINAL image with alpha set from its own
   mask, so what collides is exactly the shape that was drawn. Pixels just outside the
   blob get partial alpha for a soft edge, capped at 120 — under solidifyRock's alpha>=128
   test, so the soft edge never collides.

   Sprites, not one big image: `_alphaMask` samples every sprite down to 160px on its long
   side. One whole-map sprite would be sampled at ~16 world units per alpha pixel, coarser
   than the 9px collision mask it feeds. Per-blob sprites each get their own 160px budget.

5. PLACE FOOD. In open pockets, by distance transform, spread across the width. A map with
   no food is unplayable — you need Energy to grow. Threats are left to the designer.

6. FLOOD-FILL CHECK. Reports whether the open region actually connects the entry channel to
   the goal channel. It is only a proxy — the real answer comes from the running game's
   mask (tests/level-check.cjs) — but it catches a sealed map before the browser does.
"""

import argparse, json, os, sys
from PIL import Image
import numpy as np
from scipy import ndimage

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

ap = argparse.ArgumentParser()
ap.add_argument('image')
ap.add_argument('--id', required=True, help='level id — boots as #level,<id>')
ap.add_argument('--name', required=True)
ap.add_argument('--threshold', type=int, default=128)
ap.add_argument('--min-area', type=int, default=600, help='image px^2; below this is gravel')
ap.add_argument('--width', type=int, default=2592, help='world width (72 cells of 36)')
ap.add_argument('--surface-y', type=int, default=380)
ap.add_argument('--cell', type=int, default=36)
ap.add_argument('--start-cols', type=int, default=2)
ap.add_argument('--goal-cols', type=int, default=6)
ap.add_argument('--food', type=int, default=12)
ap.add_argument('--campaign-level', type=int, default=None)
a = ap.parse_args()

# --- load + threshold --------------------------------------------------------
img = Image.open(os.path.join(ROOT, a.image)).convert('RGB')
W, H = img.size
lum = np.asarray(img.convert('L')).astype(np.int16)
rock = lum < a.threshold

# World box: keep the image's aspect exactly, so nothing is stretched. The map fills the
# whole underground; the surface strip above surfaceY is the engine's, not ours.
sx = a.width / W
under_h = a.width * H / W
world_h = a.surface_y + under_h
sy = under_h / H

# --- clear the entry + goal channels ----------------------------------------
entry_w = a.start_cols * a.cell
goal_x = a.width - (a.goal_cols + 1) * a.cell
cx0 = int(round(entry_w / sx))
cx1 = int(round(goal_x / sx))
rock[:, :cx0] = False
rock[:, cx1:] = False

# --- label, drop the gravel --------------------------------------------------
lab, n = ndimage.label(rock, structure=np.ones((3, 3)))
areas = ndimage.sum(rock, lab, range(1, n + 1))
keep = [i for i in range(n) if areas[i] >= a.min_area]
boxes = ndimage.find_objects(lab)
print(f'{n} blobs, keeping {len(keep)} at >={a.min_area}px^2 '
      f'({100 * areas[keep].sum() / rock.sum():.1f}% of the rock), '
      f'rock covers {100 * rock.mean():.1f}% of the frame')

# The mask the game will actually see: only the blobs we kept.
kept_mask = np.isin(lab, [i + 1 for i in keep])

# --- cut one sprite per blob -------------------------------------------------
adir = os.path.join(ROOT, 'assets', a.id)
os.makedirs(adir, exist_ok=True)
for f in os.listdir(adir):
    if f.endswith('.png'):
        os.remove(os.path.join(adir, f))

rgb = np.asarray(img)
# Soft edge: how opaque a pixel just outside the blob should be. Capped below the
# alpha>=128 test in markCoverGrid so it softens the art without widening the wall.
soft = np.clip((235 - lum) / (235 - a.threshold), 0, 1) * 120

objects, manifest = [], []
for rank, i in enumerate(sorted(keep, key=lambda i: -areas[i]), start=1):
    sl = boxes[i]
    # A 2px margin so the soft edge isn't clipped by the crop — but never past the
    # channel cuts. The margin is only ~4 world units, and the alpha out there is the
    # soft edge, so it can't collide; it would still DRAW rock over a channel the
    # player walks through, and "rock you can see and walk through" is the exact
    # failure the channels are prone to.
    r0 = max(0, sl[0].start - 2); r1 = min(H, sl[0].stop + 2)
    c0 = max(cx0, sl[1].start - 2); c1 = min(cx1, sl[1].stop + 2)
    m = (lab[r0:r1, c0:c1] == i + 1)
    near = ndimage.binary_dilation(m, iterations=2)
    alpha = np.where(m, 255, np.where(near, soft[r0:r1, c0:c1], 0)).astype(np.uint8)
    out = np.dstack([rgb[r0:r1, c0:c1], alpha])
    key = f'{a.id}R{rank:03d}'
    Image.fromarray(out, 'RGBA').save(os.path.join(adir, f'r{rank:03d}.png'), optimize=True)
    manifest.append({'key': key, 'file': f'{a.id}/r{rank:03d}.png', 'kind': 'sprite'})
    objects.append({
        't': 'boulder', 'key': key,
        'x': round((c0 + c1) / 2 * sx, 1),
        'y': round(a.surface_y + (r0 + r1) / 2 * sy, 1),
        'w': round((c1 - c0) * sx, 1),
        'h': round((r1 - r0) * sy, 1),
        'rot': 0,
    })

# --- is it traversable? ------------------------------------------------------
# Proxy for the real thing: flood the open pixels from the entry band and see whether the
# fill reaches the goal band. The game's answer comes from its own 9px mask.
open_px = ~kept_mask
fill, _ = ndimage.label(open_px, structure=np.array([[0, 1, 0], [1, 1, 1], [0, 1, 0]]))
entry_labels = set(fill[:, cx0:cx0 + 3].ravel()) - {0}
goal_labels = set(fill[:, cx1 - 3:cx1].ravel()) - {0}
shared = entry_labels & goal_labels
print(f'traversable: {"YES" if shared else "NO"} '
      f'({len(entry_labels)} open region(s) at the entry, {len(goal_labels)} at the goal, '
      f'{len(shared)} shared)')

# --- food in the open pockets ------------------------------------------------
# Distance transform of the open region, then take the roomiest spot in each of `food`
# vertical slices — spreads the piles across the route instead of clustering them where
# the map happens to be emptiest. foodRockBuffer is 2.2 cells, so require that much.
dist = ndimage.distance_transform_edt(open_px)
if shared:
    dist[fill != list(shared)[0]] = 0        # only pockets actually reachable
need = 2.2 * a.cell / sx
KINDS = ['duff', 'cache', 'duff', 'cache', 'duff', 'cache',
         'duff', 'cache', 'duff', 'cache', 'duff', 'cache-engine']
ENERGY = {'duff': 2, 'cache': 3, 'cache-engine': 4}
placed = 0
lo, hi = cx0 + 20, cx1 - 20
for k in range(a.food):
    s0 = int(lo + (hi - lo) * k / a.food)
    s1 = int(lo + (hi - lo) * (k + 1) / a.food)
    band = dist[:, s0:s1]
    if band.size == 0 or band.max() < need:
        continue
    r, c = np.unravel_index(band.argmax(), band.shape)
    kind = KINDS[k % len(KINDS)]
    objects.append({
        't': 'food', 'kind': kind,
        'x': round((s0 + c) * sx, 1), 'y': round(a.surface_y + r * sy, 1),
        'r': 1, 'energy': ENERGY[kind],
    })
    placed += 1
print(f'food: {placed}/{a.food} piles placed (clearance >= 2.2 cells)')

# --- write the level ---------------------------------------------------------
level = {
    'format': 'mycelium-level', 'version': 1, 'id': a.id, 'name': a.name,
    'campaignLevel': a.campaign_level,
    'world': {'width': a.width, 'height': round(world_h), 'surfaceY': a.surface_y, 'cellSize': a.cell},
    'layout': {'startCols': a.start_cols, 'goalCols': a.goal_cols, 'summerCols': 7, 'clearChannels': True},
    'traced': {'image': a.image, 'threshold': a.threshold, 'minArea': a.min_area},
    'objects': objects,
}
lp = os.path.join(ROOT, 'docs', 'levels', f'{a.id}.json')
with open(lp, 'w') as f:
    json.dump(level, f, indent=1)
    f.write('\n')

# --- manifest ----------------------------------------------------------------
mp = os.path.join(ROOT, 'assets', 'manifest.json')
man = json.load(open(mp))
man['assets'] = [e for e in man['assets'] if not e['key'].startswith(f'{a.id}R')] + manifest
with open(mp, 'w') as f:
    json.dump(man, f, indent=1)
    f.write('\n')

kb = sum(os.path.getsize(os.path.join(adir, f)) for f in os.listdir(adir)) / 1024
print(f'wrote {lp} ({len(objects)} objects), {len(manifest)} sprites in assets/{a.id}/ ({kb:.0f} KB)')
print('next: node scripts/gen-levels.mjs')
