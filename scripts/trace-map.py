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

   • COLOUR BLEED, wide (--bleed): every non-opaque pixel takes the colour of the nearest
     opaque one, smoothed. The source background is near-white, and a cut-out that leaves
     it there paints a pale halo round every rock the moment the sprite is filtered —
     worst along the bottoms, where the model draws a bright rim above its drop shadow.
     Alpha alone doesn't hide it: the sprite is drawn smaller than its pixel size, and
     downscaling blends the colour of pixels you can't see into the ones you can. The
     smoothing matters as much as the bleed: nearest-opaque on its own is a Voronoi
     diagram of the edge, which fans into spokes wherever the edge alternates light facet
     and dark crack. None of this is visible on its own — it only has to reach further
     than a filter kernel can sample.
   • ALPHA FEATHER, narrow (--feather): a smoothstep ramp by DISTANCE from the blob — not
     by luminance, which was measuring that same rim and shadow and so faded by a
     different amount under every rock. Keep it to a pixel or two. Every pixel of the ramp
     is rock-grey over brown soil, so a wide one is a grey halo: at 10px it looked worse
     than the white line it replaced. Wide bleed, narrow feather; they are not one knob.

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


def say(*args):
    """print() that cannot kill the run.

    Piping this script through `head` closes stdout early; the next print raises
    BrokenPipeError and the script dies AFTER writing the level JSON and BEFORE writing the
    asset manifest, leaving the two disagreeing. The only symptom is a 404 per sprite at
    boot and a collision mask that never solidifies. It has cost two debugging rounds.
    """
    try:
        print(*args, flush=True)
    except Exception:
        pass

ap = argparse.ArgumentParser()
ap.add_argument('image')
ap.add_argument('--id', required=True, help='level id — boots as #level,<id>')
ap.add_argument('--name', required=True)
ap.add_argument('--threshold', type=int, default=None,
                help='rock/background luminance cut; default is chosen per image (Otsu)')
ap.add_argument('--invert', choices=('auto', 'yes', 'no'), default='auto',
                help='is the background DARK and the rock light? auto reads the image border')
ap.add_argument('--despeckle', type=int, default=None,
                help='opening radius in source px; default scales with the image (W/1200)')
ap.add_argument('--min-area', type=int, default=600, help='image px^2; below this is gravel')
ap.add_argument('--width', type=float, default=2952,
                help='target world width; the underground HEIGHT is derived from it and the '
                     'image aspect so the map fits exactly between the two channels')
ap.add_argument('--surface-y', type=int, default=380)
ap.add_argument('--cell', type=int, default=36)
ap.add_argument('--start-cols', type=int, default=2)
ap.add_argument('--goal-cols', type=int, default=6)
ap.add_argument('--food', type=int, default=12)
ap.add_argument('--trim', type=int, default=2,
                help='pixels eroded off each blob before cutting, to drop the anti-aliased ring')
ap.add_argument('--feather', type=float, default=2, help='ALPHA ramp width, in source px')
ap.add_argument('--bleed', type=int, default=16, help='how far the COLOUR is carried out')
ap.add_argument('--format', choices=('webp', 'png'), default='webp')
ap.add_argument('--quality', type=int, default=90, help='webp quality; ALPHA stays lossless')
ap.add_argument('--campaign-level', type=int, default=None)
a = ap.parse_args()

# --- load + threshold --------------------------------------------------------
img = Image.open(os.path.join(ROOT, a.image)).convert('RGB')
W, H = img.size
rgb_all = np.asarray(img).astype(np.int16)
lum = np.asarray(img.convert('L')).astype(np.int16)

# WHICH END IS BACKGROUND. Everything below assumes background is the BRIGHT end and rock the
# dark one — the Otsu cut, the anti-aliased ring the trim removes, the "not pale" test on the
# colour source. That holds for every theme drawn on white, and inverts wholesale for a theme
# drawn on BLACK, which is the only way to get a pale subject: white ice on white background
# is not a thresholding problem, it is an absence of one.
#
# So detect the polarity from the image border (after the content crop the border is
# background by construction) and, if it is dark, invert the DETECTION channels only. Colour
# still comes from the untouched image. Inverting the RGB leaves chroma unchanged — max-min
# is invariant — so the "chromatic and not near-white" rescue becomes "chromatic and not
# near-black" for free, which is exactly what it should mean on a dark ground.
# Detected by FLATNESS, and it refuses to guess when the answer is close.
#
# Two earlier attempts were wrong in instructive ways. Sampling the image BORDER fails because
# the prompts demand the rocks reach all four edges, so a dense map's border is mostly rock —
# ice-scatter-c40 read as a dark background and classified 100% of the frame as rock. Counting
# near-white against near-black pixels fails on a map whose rock is near-black and covers most
# of the frame: bioluminescent-c20-2 is dark rock on white at 81% solid, and the rock wins the
# count.
#
# What actually separates them is that a background is a FLAT FILL and rock is textured. So
# measure, at each extreme, the share of pixels that are both extreme AND locally flat. That
# is right on 15 of the 16 maps generated so far — and on the 16th the two scores are within
# 1.3x, which is exactly the case where a wrong guess would silently trace the background as
# rock. So when the margin is thin, stop and ask, rather than produce a plausible ruin.
_l = lum.astype(np.float32)
_m = ndimage.uniform_filter(_l, 9)
_sd = np.sqrt(np.maximum(0, ndimage.uniform_filter(_l * _l, 9) - _m * _m))
_flat = _sd < 2.0
_flat_light = float((_flat & (lum >= 235)).mean())
_flat_dark = float((_flat & (lum <= 20)).mean())
if a.invert == 'auto':
    _hi, _lo = max(_flat_light, _flat_dark), min(_flat_light, _flat_dark)
    if _hi < 1e-6 or _hi / max(_lo, 1e-6) < 1.6:
        say(f'CANNOT TELL which end is background: flat-and-light {100 * _flat_light:.2f}% vs '
            f'flat-and-dark {100 * _flat_dark:.2f}% — too close to call.')
        say('Re-run with --invert yes (dark background) or --invert no (light background).')
        sys.exit(2)
    INVERT = _flat_dark > _flat_light
else:
    INVERT = a.invert == 'yes'
say(f'background: {"dark (inverting detection)" if INVERT else "light"} — '
    f'flat-and-light {100 * _flat_light:.1f}%, flat-and-dark {100 * _flat_dark:.1f}%')
rgb_det = (255 - rgb_all) if INVERT else rgb_all
lum = (255 - lum) if INVERT else lum

# Rock is anything dark — PLUS anything strongly coloured that isn't near-white. The second
# clause is for the `veined` theme, whose mint-cyan mineral veins sit at luminance ~173: a
# plain luminance cut slices every vein out of its rock, and the mask comes back as boulders
# with cracks sawn through them (measured: 55% of on-rock vein pixels fall the wrong side of
# 128, whichever channel you threshold). On a grey map the clause selects nothing, so it
# costs the slate maps only what the two steps below do.
# THE CUT. It cannot be a constant. A fixed 128 was right for the first slate maps, whose
# rock is 30-110 throughout, and it quietly destroyed the two themes whose rocks have LIT
# TOP FACES: ledges puts 7.9% of its pixels at luminance 150-159 and veined runs to ~170, so
# 128 threw the top off every slab and left the survivors as pale lobes floating over soil.
# Otsu finds the valley between the rock mode and the background mode per image — around
# 170-200 for everything so far — which is above the lit faces and below the drop-shadow
# band (200-249) that must stay out, or every wall is fattened by its own shadow.
def _otsu(v):
    hist = np.bincount(v.ravel().astype(np.uint8), minlength=256).astype(np.float64)
    w = np.cumsum(hist); mu = np.cumsum(hist * np.arange(256))
    tot, mu_t = w[-1], mu[-1]
    wb = w[:-1]; wf = tot - wb
    ok = (wb > 0) & (wf > 0)
    between = np.zeros(255)
    between[ok] = ((mu_t * wb[ok] / tot - mu[:-1][ok]) ** 2) / (wb[ok] * wf[ok])
    return int(np.argmax(between))

# THRESHOLD: Otsu, but never above 128.
#
# docs/maps/README.md has carried the same warning since the first map — "threshold at 128,
# not higher... threshold high and every wall is fattened by its shadow, an invisible wall,
# the worst bug here". Otsu replaced the fixed 128 later and for a good reason: a fixed cut
# sawed the LIT TOP FACES off the side-on `ledges` rolls, where 7.9% of the image sat at
# 150-159 and belonged to the rock.
#
# It then drifted back over 128 across most of the set without anyone noticing, because a
# near-black mass on a white ground pulls Otsu UP (147 on obsidian-c55) — and the soft
# contact shadow under an overhead mass measures about 131. So the cut ate the shadows and
# every mass shipped wearing a pale skirt: solid to the player, near-invisible on screen.
#
# The first version of this fix capped only when the rock body's median said "near-black",
# to leave `ledges` its lit faces. Measured across five maps chosen to span the parameter
# space — near-black overhead, the palest coloured theme, a saturated-feature theme, an
# INVERTED dark-ground theme, and an old side-on roll — all five capped. The condition never
# distinguished anything, and `ledges-one` (the only map the exception existed for) has since
# been cut. So it is a plain cap, which is both simpler and honest about what it does.
#
# Otsu still wins when it lands BELOW 128 — that is a genuinely darker image and there is no
# reason to overrule it. If a future map really does have rock above 128 (a lit-top-face
# `ledges` revival), pass --threshold explicitly; do not raise this ceiling for everyone.
if a.threshold is not None:
    THRESH = a.threshold
else:
    _o = min(210, max(120, _otsu(lum)))
    THRESH = min(_o, 128)
    say(f'threshold: {THRESH}' + (f' (Otsu said {_o}, capped at 128)' if _o > 128 else ' (Otsu)'))

chroma = rgb_det.max(axis=2) - rgb_det.min(axis=2)
rock_src = (lum < THRESH) | ((chroma > 40) & (rgb_det.min(axis=2) < 200))
rock = rock_src.copy()

# Then open, drop the vein-only components, and fill.
#
# The OPENING severs thin filaments — the veins the model draws out across the white
# background however firmly you ban them. It has to be SMALL. Sized at W/240 (24px on a
# 5760px source) it deleted the veins and also ate the rocks: tops broken into rounded
# lobes, thin necks severed, every silhouette smoothed into a blob. That was the "parts of
# the rocks are missing" defect. W/1200 severs filaments and leaves rock alone.
#
# What actually kills the strays is the COMPONENT FILTER: a stray vein is its own connected
# component with no genuinely dark pixel in it, while a vein inside a rock belongs to the
# rock's component. Dropping components that contain no dark rock is exact, and destroys
# nothing — which is what the opening was being over-sized to achieve.
#
# A DISK, not scipy's square default: a square structuring element regrows the eroded shape
# with square corners and studs the silhouette with visible rectangular bumps.
_r = a.despeckle if a.despeckle is not None else max(2, round(W / 1200))
_y, _x = np.ogrid[-_r:_r + 1, -_r:_r + 1]
rock = ndimage.binary_opening(rock, structure=(_x * _x + _y * _y <= _r * _r))
_lab, _n = ndimage.label(rock, structure=np.ones((3, 3)))
_dark = lum < THRESH
_has_dark = np.zeros(_n + 1, bool)
_has_dark[np.unique(_lab[_dark])] = True
_has_dark[0] = False
_dropped = _n - int(_has_dark.sum())
if _dropped:
    say(f'dropped {_dropped} component(s) with no dark rock in them (stray veins)')
rock = _has_dark[_lab]

# CLOSE before filling, and this is the other half of the threshold cap above.
#
# Capping the cut at 128 removes the drop shadow, and it also bites into the rock's LIT
# faces — on an overhead roll the lit flank of a mass and the shadow beside it occupy the
# same luminance band, so no threshold separates them and the cut has to be set for the
# shadow. What that leaves is not a missing flank but a RAGGED one: the lit face speckles
# into hundreds of little holes and notches along the rim, which is worse to look at than
# either extreme and is the "removing some of the insides of rocks" defect.
#
# A closing repairs exactly that and nothing else. It is a dilation followed by an erosion,
# so it fills notches narrower than its disk and returns the silhouette to where it was —
# the rim comes back solid while the outline stays put. It cannot pull the shadow in: the
# shadow is a broad smooth region well wider than the disk, on the far side of the rock's
# hard edge.
#
# Sized larger than the opening above (which severs filaments at W/1200) because the notches
# it is repairing are wider than a vein. At W/400 — 14px on a 5760px source, under a world
# unit — it healed the flank without visibly rounding a corner.
_c = max(2, round(W / 400))
_y, _x = np.ogrid[-_c:_c + 1, -_c:_c + 1]
rock = ndimage.binary_closing(rock, structure=(_x * _x + _y * _y <= _c * _c))

rock = ndimage.binary_fill_holes(rock)
# `rock` and `rock_src` now differ: opening regrows into the background at concave corners
# and fill closes pockets the rocks enclose between them. Those added pixels are rock as far
# as the SILHOUETTE is concerned, but the source has background there — so they must take
# their colour from the bleed, never from the image. Painting them with the image is what put
# pale grey blobs over the soil where rock should be. `rock` drives alpha; `rock_src` drives
# colour. See the sprite loop.

# --- crop to the content ------------------------------------------------------
# The image is mapped into the gap between the entry and goal channels, so any blank margin
# it carries becomes blank soil at the edge of the level — the map stops short of where the
# player enters and where the goal is. Crop to the rock's own bounding box and the world is
# derived from THAT, so the rock always spans the level whatever the model framed.
_cols, _rows = rock.any(axis=0), rock.any(axis=1)
if _cols.any():
    _c0, _c1 = int(np.argmax(_cols)), len(_cols) - int(np.argmax(_cols[::-1]))
    _r0, _r1 = int(np.argmax(_rows)), len(_rows) - int(np.argmax(_rows[::-1]))
    if (_c1 - _c0, _r1 - _r0) != (W, H):
        say(f'cropped to content: {W}x{H} -> {_c1 - _c0}x{_r1 - _r0} '
              f'(trimmed {100 * (1 - (_c1 - _c0) / W):.1f}% of the width, '
              f'{100 * (1 - (_r1 - _r0) / H):.1f}% of the height)')
    rock = rock[_r0:_r1, _c0:_c1]
    rock_src = rock_src[_r0:_r1, _c0:_c1]
    rgb_all = rgb_all[_r0:_r1, _c0:_c1]
    rgb_det = rgb_det[_r0:_r1, _c0:_c1]
    lum = lum[_r0:_r1, _c0:_c1]
    H, W = rock.shape

# World box. The channels `buildLevel` digs are cols [0, startCols+1) on the left and the
# last goalCols+1 on the right — that is what the image must NOT overlap. So reserve them,
# fit the image into the remaining gap, and derive the underground HEIGHT from that gap and
# the image's aspect: 1:1 on both axes, nothing stretched, nothing cut.
#
# Driving from WIDTH, not height: cropping to content changes the aspect, and if the height
# were fixed the width would absorb all of it — a map that lost 30% of its blank height came
# out a third longer than its neighbours. Fixing the width instead keeps every traced level
# the same length to cross and lets its DEPTH vary with what the image actually contains.
chan_w = (a.start_cols + 1 + a.goal_cols + 1) * a.cell
world_w = round(a.width / a.cell) * a.cell
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
say(f'{n} blobs, keeping {len(keep)} at >={a.min_area}px^2 '
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

rgb = rgb_all.astype(np.uint8)      # cropped to content above, so it lines up with `lab`

# Which pixels may act as a COLOUR source. `rock_src` is too generous for this: its chroma
# clause is what rescues the cyan veins, and it also matches the pale bloom the model paints
# AROUND them — luminance 210+, chromatic, and sitting on the white background. Painting a
# sprite from those put soft pale lobes over the soil, the same defect as the fill regions
# but arriving by a different route. Anything this pale is background as far as colour goes;
# the vein cores themselves sit at ~173 and are kept.
PAINT_MAX = 190
paint_src = rock_src & (lum < PAINT_MAX)
# Bleed WIDE, feather NARROW — they are not the same knob, and tying them together is how
# a white outline becomes a grey one. The bleed only has to reach far enough that no filter
# sampling near the edge can find background; nothing of it is visible on its own. The alpha
# ramp IS visible: every pixel of it is rock-grey laid over brown soil, so at 10px it read
# as a haze round every rock — worse than the white line it replaced.
FEATHER = max(0.5, a.feather)
BLEED = max(4, a.bleed)
MARGIN = BLEED + 3

objects, manifest = [], []
for rank, i in enumerate(sorted(keep, key=lambda i: -areas[i]), start=1):
    sl = boxes[i]
    r0 = max(0, sl[0].start - MARGIN); r1 = min(H, sl[0].stop + MARGIN)
    c0 = max(0, sl[1].start - MARGIN); c1 = min(W, sl[1].stop + MARGIN)
    # Erode before cutting. The source steps from rock (~43) to background (~222) through
    # one or two ANTI-ALIASED pixels — 70, 83, 114 — and a threshold of 128 keeps them, so
    # every silhouette carries a ring 30-70 luminance brighter than the rock it edges. On
    # screen that measured lum 90 against 45 above and 50 below: a beaded light line, worst
    # along the bottoms where the background behind it is brightest. Eroding moves that ring
    # out of the opaque region, so it takes the blurred bleed colour instead of its own.
    # Costs ~1.5% of each blob's area — under a world unit, and collision is sampled at
    # 160px, so nothing measurable.
    m_src = (lab[r0:r1, c0:c1] == i + 1)
    m = ndimage.binary_erosion(m_src, iterations=a.trim) if a.trim else m_src
    if not m.any():
        m = m_src                               # too thin to erode; keep it rather than lose it
    crop = rgb[r0:r1, c0:c1]

    # ALPHA comes from the blob; COLOUR comes from where the source actually had rock.
    # They are not the same set: opening regrows into the background and fill closes pockets
    # between rocks, and the image holds pale background at both. Sampling the image there
    # painted big soft grey blobs over the soil — rock-shaped holes in the map, in the two
    # themes whose rocks are far from white. So the distance transform runs on `paint`, the
    # DETECTED rock, and every pixel outside it (including pixels inside the silhouette)
    # takes a bled colour.
    paint = m & paint_src[r0:r1, c0:c1]
    if not paint.any():
        paint = m                                # all-synthetic blob; nothing better to use
    dist, (iy, ix) = ndimage.distance_transform_edt(~paint, return_indices=True)
    edge = ndimage.distance_transform_edt(~m)    # the feather is still measured from the blob
    t = np.clip(edge / FEATHER, 0, 1)
    fade = 1 - (t * t * (3 - 2 * t))                     # smoothstep: flat at both ends
    alpha = np.where(m, 255.0, 255.0 * fade).astype(np.uint8)

    # Bleed, then BLUR the bleed. Nearest-opaque alone is a Voronoi diagram of the rock's
    # edge pixels, and where that edge alternates light facet / dark crack it fans out into
    # visible spokes — a hairy outline instead of a white one. Blurring the bled copy
    # (which is defined everywhere, unlike a masked average) smooths the fan out. The rock
    # itself is never touched; this only fills what alpha is fading away.
    base = np.where(paint[..., None], crop, crop[iy, ix]).astype(np.float32)
    smooth = ndimage.gaussian_filter(base, sigma=(BLEED / 3, BLEED / 3, 0))
    colour = np.where(paint[..., None], crop, smooth).astype(np.uint8)
    out = np.dstack([colour, alpha])
    key = f'{a.id}R{rank:03d}'
    fname = f'r{rank:03d}.{a.format}'
    save(Image.fromarray(out, 'RGBA'), os.path.join(adir, fname))
    # kind 'level', NOT 'sprite'. The boot preloader in index.html waits for every manifest
    # entry to settle before the game starts, so a traced map's sprites were being decoded on
    # every boot whether or not that map was played. Fine at five maps; at 59 it is ~98 MB and
    # ~2250 images loaded to play one of them, and the boot never finished. `level` is the tag
    # the loader uses to defer them until the level that needs them actually starts.
    manifest.append({'key': key, 'file': f'{a.id}/{fname}', 'kind': 'level'})
    # Round the EDGES, then derive centre and size from them. Rounding x and w separately
    # lets x - w/2 land a fraction of a unit off the edge it was cut at, which is enough to
    # read as a sprite overhanging a pathClear channel when it is exactly flush with one.
    left = round(x0 + c0 * sx, 1); right = round(x0 + c1 * sx, 1)
    top = round(y0 + r0 * sy, 1); bot = round(y0 + r1 * sy, 1)
    left = max(left, x0); right = min(right, x0 + span)      # never past a channel
    objects.append({
        't': 'boulder', 'key': key,
        'x': (left + right) / 2, 'y': (top + bot) / 2,
        'w': round(right - left, 1), 'h': round(bot - top, 1),
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
say(f'traversable: {"YES" if shared else "NO"} '
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
say(f'food: {placed}/{a.food} piles placed (clearance >= 2.2 cells)')

# --- write the level ---------------------------------------------------------
level = {
    'format': 'mycelium-level', 'version': 1, 'id': a.id, 'name': a.name,
    'campaignLevel': a.campaign_level,
    'world': {'width': world_w, 'height': round(world_h, 1), 'surfaceY': a.surface_y, 'cellSize': a.cell},
    'layout': {'startCols': a.start_cols, 'goalCols': a.goal_cols, 'summerCols': 7, 'clearChannels': True},
    'traced': {'image': a.image, 'threshold': THRESH, 'minArea': a.min_area},
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
say(f'wrote {lp} ({len(objects)} objects), {len(manifest)} sprites in assets/{a.id}/ ({kb:.0f} KB)')
say('next: node scripts/gen-levels.mjs')
