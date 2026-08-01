#!/usr/bin/env python3
"""Measure the pale fringe on traced sprites, per level.

    python3 scripts/fringe-score.py                 # every level in assets/
    python3 scripts/fringe-score.py obsidian-c55 amethyst-c40

The defect this exists for: a traced rock can ship with a ring of retained drop shadow or
anti-aliasing around it, which reads as a pale halo over the brown soil. It is a few pixels
wide, so it is invisible in an overview and obvious at play zoom, and it is the thing the
owner reported twice by eye before there was any number for it.

  edge       mean luminance of the opaque ring just inside each sprite's alpha boundary
  interior   mean luminance of the same sprite further in
  delta      edge minus interior. POSITIVE means the rim is brighter than the rock it edges,
             which is the fringe. NEGATIVE is fine — it means the edge is darker, which is
             what a clean cut of a lit mass looks like.

Deliberately THEME-RELATIVE: each sprite is compared against itself, so `glacier` (pale ice
on black) is judged on its own terms rather than against near-black `obsidian`. An absolute
brightness threshold would call every glacier sprite a fringe and every obsidian one clean.

What the numbers meant when this was written (58 levels, Bria-guided trace, trim W/480):
median -0.1, 47 of 58 under +10, only 3 over +20. The extremes are the hard cases — the
palest theme and the darkest both have the widest anti-aliased ramp against the ground:

    cleanest   glacier-c40 -19.5 · side-glacier-c40 -15.9 · glacier-c24 -14.8
    worst      amethyst-c16 +24.7 · side-veined-c28 +22.4 · glass-c40 +21.1

Before the trim fix the same measure read obsidian +37.2 and slate +18.9, so if a re-trace
ever pushes the median back above +10, --trim is the first thing to look at.
"""

import glob, os, sys
import numpy as np
from PIL import Image
from scipy import ndimage

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
only = sys.argv[1:]

# 16 sprites per level is enough to be stable and keeps a 58-level sweep under a minute; the
# spread within one map is far smaller than the spread between themes.
PER_LEVEL = 16


def fringe(level_dir):
    ed, ins, pale, tot = [], [], 0, 0
    for f in sorted(glob.glob(os.path.join(level_dir, '*.webp')))[:PER_LEVEL]:
        a = np.asarray(Image.open(f).convert('RGBA')).astype(float)
        alpha, lum = a[..., 3], a[..., :3].mean(axis=2)
        op = alpha >= 250
        if op.sum() < 400:
            continue
        # 4 iterations ~ the width of the ramp the trim leaves behind. Narrower and the ring
        # is mostly anti-aliasing; wider and it starts averaging in the rock's own face.
        inner = ndimage.binary_erosion(op, np.ones((3, 3)), iterations=4)
        ring = op & ~inner
        if ring.sum() < 50 or inner.sum() < 50:
            continue
        ed.append(lum[ring].mean())
        ins.append(lum[inner].mean())
        pale += int((lum[ring] > lum[inner].mean() + 45).sum())
        tot += int(ring.sum())
    if len(ed) < 3:
        return None
    return float(np.mean(ed)), float(np.mean(ins)), 100.0 * pale / max(1, tot)


rows = []
for d in sorted(glob.glob(os.path.join(ROOT, 'assets', '*'))):
    if not os.path.isdir(d):
        continue
    lid = os.path.basename(d)
    if only and lid not in only:
        continue
    # Only traced levels have a JSON beside them; assets/cards, assets/species and the rest
    # are not maps and their "sprites" are not rocks.
    if not os.path.exists(os.path.join(ROOT, 'docs', 'levels', f'{lid}.json')):
        continue
    r = fringe(d)
    if r:
        rows.append((lid, *r))

if not rows:
    print('no traced levels matched', file=sys.stderr)
    sys.exit(1)

rows.sort(key=lambda r: r[1] - r[2])
print(f'{"level":24s}{"edge":>8}{"interior":>10}{"delta":>8}{"pale ring":>11}')
for lid, e, i, p in rows:
    print(f'{lid:24s}{e:8.1f}{i:10.1f}{e - i:+8.1f}{p:10.1f}%')

d = [e - i for _, e, i, _ in rows]
print(f'\n{len(rows)} levels · median {np.median(d):+.1f} · '
      f'under +10: {sum(1 for x in d if x < 10)}/{len(d)} · '
      f'over +20: {sum(1 for x in d if x > 20)}/{len(d)}')
