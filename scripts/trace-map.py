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

2. FIT BETWEEN THE CHANNELS. `buildLevel` digs an entry channel (cols 0..startCols) and a
   goal channel (the last goalCols+1) and flags them pathClear, which beats rock outright
   — a sprite drawn over one renders as rock the player walks straight through. Rather
   than clip the image there (which cut the sides off the edge rocks), the WORLD is sized
   so the image lands exactly between the two channels: pick the width in whole cells that
   makes the gap match the image's aspect, then derive the height from it. The map reaches
   its full width, nothing is cut, and no sprite can reach a channel because the image
   simply doesn't extend that far.

3. LABEL + DROP THE GRAVEL. Every 8-connected blob becomes one sprite. Blobs under
   --min-area are dropped: the models scatter 2-6px specks everywhere, and each one would
   become a pinprick of collision the player can see no reason for.

4. CUT SPRITES. Each blob is cropped from the ORIGINAL image with alpha set from its own
   mask, so what collides is exactly the shape that was drawn. Two things happen at the
   edge, and the second one is not optional:

   • FEATHER: alpha ramps from opaque to nothing over --feather px on a smoothstep, by
     distance from the blob. Not by luminance — the brightness just outside a rock is the
     model's rim highlight and drop shadow, which is a different amount of light under
     every rock and made the fade uneven.
   • ALPHA BLEED: every non-opaque pixel takes the COLOUR of the nearest opaque one. The
     source background is near-white, and a cut-out that leaves it there paints a pale
     halo round every rock the moment the sprite is filtered — worst along the bottoms,
     where the model draws a bright rim above its drop shadow. Alpha alone doesn't hide
     it: the sprite is drawn smaller than its pixel size, and downscaling blends the
     colour of pixels you can't see into the ones you can.

   The feather does not widen collision. solidifyRock tests alpha>=128 on a mask that is
   at most 160px on its long side, where a 12px feather on a 5760px-wide source is a
   fraction of one sample.

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
ap.add_argument('--under-height', type=float, default=1096,
                help='target underground height; the world WIDTH is derived from it and the '
                     'image aspect so the map fits exactly between the two channels')
ap.add_argument('--surface-y', type=int, default=380)
ap.add_argument('--cell', type=int, default=36)
ap.add_argument('--start-cols', type=int, default=2)
ap.add_argument('--goal-cols', type=int, default=6)
ap.add_argument('--food', type=int, default=12)
ap.add_argument('--feather', type=int, default=12, help='edge fade, in source px')
ap.add_argument('--format', choices=('webp', 'png'), default='webp')
ap.add_argument('--quality', type=int, default=90, help='webp quality; ALPHA stays lossless')
ap.add_argument('--campaign-level', type=int, default=None)
a = ap.parse_args()

# --- load + threshold --------------------------------------------------------
img = Image.open(os.path.join(ROOT, a.image)).convert('RGB')
W, H = img.size
lum = np.asarray(img.convert('L')).astype(np.int16)
rock = lum < a.threshold

# World box. The channels `buildLevel` digs are cols [0, startCols+1) on the left and the
# last goalCols+1 on the right — that is what the image must NOT overlap. So reserve them,
# size the remaining gap to the image's aspect, and put the image in it at 1:1 on both
# axes (nothing stretched, nothing cut). Width lands on a whole number of cells; the height
# is then derived from the width so the aspect stays exact.
chan_w = (a.start_cols + 1 + a.goal_cols + 1) * a.cell
world_w = round((a.under_height * W / H + chan_w) / a.cell) * a.cell
span = world_w - chan_w
sx = sy = span / W
under_h = H * sy
world_h = a.surface_y + under_h
x0 = (a.start_cols + 1) * a.cell        # left edge of the image, in world units
y0 = a.surface_y

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
    if f.endswith(('.png', '.webp')):
        os.remove(os.path.join(adir, f))

# WebP by default. Traced from a 4x upscale these are big — 77 sprites came to 12.5 MB as
# PNG, against a ~25 MB budget for the whole itch zip. WebP at q90 gives back nearly all of
# that on flat-shaded art, and Pillow keeps the ALPHA lossless regardless of `quality`,
# which is the channel that matters: it's what solidifyRock samples for collision.
def save(im, path):
    if a.format == 'webp':
        im.save(path, 'WEBP', quality=a.quality, method=6, alpha_quality=100)
    else:
        im.save(path, optimize=True)

rgb = np.asarray(img)
FEATHER = max(1, a.feather)
MARGIN = FEATHER + 3        # room in the crop for the whole fade

objects, manifest = [], []
for rank, i in enumerate(sorted(keep, key=lambda i: -areas[i]), start=1):
    sl = boxes[i]
    r0 = max(0, sl[0].start - MARGIN); r1 = min(H, sl[0].stop + MARGIN)
    c0 = max(0, sl[1].start - MARGIN); c1 = min(W, sl[1].stop + MARGIN)
    m = (lab[r0:r1, c0:c1] == i + 1)
    crop = rgb[r0:r1, c0:c1]

    # Distance to the blob, and the blob pixel that distance points at — one pass gives
    # both the feather ramp and the colour to bleed outward.
    dist, (iy, ix) = ndimage.distance_transform_edt(~m, return_indices=True)
    t = np.clip(dist / FEATHER, 0, 1)
    fade = 1 - (t * t * (3 - 2 * t))                     # smoothstep: flat at both ends
    alpha = np.where(m, 255.0, 255.0 * fade).astype(np.uint8)

    # Bleed, then BLUR the bleed. Nearest-opaque alone is a Voronoi diagram of the rock's
    # edge pixels, and where that edge alternates light facet / dark crack it fans out into
    # visible spokes — a hairy outline instead of a white one. Blurring the bled copy
    # (which is defined everywhere, unlike a masked average) smooths the fan out. The rock
    # itself is never touched; this only fills what alpha is fading away.
    base = np.where(m[..., None], crop, crop[iy, ix]).astype(np.float32)
    smooth = ndimage.gaussian_filter(base, sigma=(FEATHER / 2, FEATHER / 2, 0))
    colour = np.where(m[..., None], crop, smooth).astype(np.uint8)
    out = np.dstack([colour, alpha])
    key = f'{a.id}R{rank:03d}'
    fname = f'r{rank:03d}.{a.format}'
    save(Image.fromarray(out, 'RGBA'), os.path.join(adir, fname))
    manifest.append({'key': key, 'file': f'{a.id}/{fname}', 'kind': 'sprite'})
    objects.append({
        't': 'boulder', 'key': key,
        'x': round(x0 + (c0 + c1) / 2 * sx, 1),
        'y': round(y0 + (r0 + r1) / 2 * sy, 1),
        'w': round((c1 - c0) * sx, 1),
        'h': round((r1 - r0) * sy, 1),
        'rot': 0,
    })

# --- is it traversable? ------------------------------------------------------
# Proxy for the real thing: flood the open pixels from the entry band and see whether the
# fill reaches the goal band. The game's answer comes from its own 9px mask.
open_px = ~kept_mask
fill, _ = ndimage.label(open_px, structure=np.array([[0, 1, 0], [1, 1, 1], [0, 1, 0]]))
entry_labels = set(fill[:, :3].ravel()) - {0}      # the image's own edges now ABUT the channels
goal_labels = set(fill[:, -3:].ravel()) - {0}
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
for k in range(a.food):
    s0 = int(W * k / a.food)
    s1 = int(W * (k + 1) / a.food)
    band = dist[:, s0:s1]
    if band.size == 0 or band.max() < need:
        continue
    r, c = np.unravel_index(band.argmax(), band.shape)
    kind = KINDS[k % len(KINDS)]
    objects.append({
        't': 'food', 'kind': kind,
        'x': round(x0 + (s0 + c) * sx, 1), 'y': round(y0 + r * sy, 1),
        'r': 1, 'energy': ENERGY[kind],
    })
    placed += 1
print(f'food: {placed}/{a.food} piles placed (clearance >= 2.2 cells)')

# --- write the level ---------------------------------------------------------
level = {
    'format': 'mycelium-level', 'version': 1, 'id': a.id, 'name': a.name,
    'campaignLevel': a.campaign_level,
    'world': {'width': world_w, 'height': round(world_h, 1), 'surfaceY': a.surface_y, 'cellSize': a.cell},
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
