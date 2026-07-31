#!/usr/bin/env python3
"""Score a candidate rock matte against the source image. One number set, every method.

    python3 scripts/matte-score.py SOURCE MASK [MASK...]

SOURCE is the generated map image. Each MASK is a greyscale or RGBA image the same size
whose alpha (or luminance, if it has no alpha) says which pixels a method calls rock.

The problem this exists to referee: on an overhead roll the DROP SHADOW under a mass and the
LIT FACE of that mass occupy the same luminance band, so no threshold separates them —
push the cut down and the rock's lit flank speckles away, push it up and every mass gets a
solid skirt of shadow it cannot be seen to have. Every fix therefore trades one against the
other, and arguing about which looks better by eye has already burned several rounds. These
two numbers make the trade explicit:

  shadow%   of the pixels the mask calls rock, how many are almost certainly shadow —
            low-chroma, mid-luminance, and lying OUTSIDE the mass's own dark core. Lower is
            better. This is the invisible-wall number.
  loss%     of the pixels that are unambiguously rock (very dark, and not isolated), how
            many the mask left out. Lower is better. This is the eaten-flank number.

A perfect matte scores 0 / 0. The thresholded pipeline scores badly on one or the other by
construction, which is the point — a method that beats it has to beat BOTH.

`core%` and `solid%` are context, not targets: solid% must stay inside the playable 15-60%
band whatever else a method achieves, or the level is unplayable regardless of how clean its
edges are.
"""

import sys, os
import numpy as np
from PIL import Image
from scipy import ndimage


def load_mask(path, shape):
    im = Image.open(path)
    a = np.asarray(im)
    if a.ndim == 3 and a.shape[2] == 4:
        m = a[..., 3]
    elif a.ndim == 3:
        m = a[..., :3].mean(axis=2)
    else:
        m = a
    if m.shape != shape:
        m = np.asarray(Image.fromarray(m.astype(np.uint8)).resize(
            (shape[1], shape[0]), Image.NEAREST))
    return m >= 128


def score(src_path, mask_paths):
    a = np.asarray(Image.open(src_path).convert('RGB')).astype(int)
    lum = a.mean(axis=2)
    chroma = a.max(axis=2) - a.min(axis=2)
    H, W = lum.shape

    # CORE: unambiguously rock. Very dark, and eroded so a stray dark speck in the shadow
    # cannot vote. Everything here must survive in any honest matte.
    core = lum < 70
    core = ndimage.binary_erosion(core, np.ones((3, 3)), iterations=2)

    # SHADOW ZONE: low-chroma mid-tones near the core that are also SMOOTH.
    #
    # v1 of this left the texture test out and was wrong in a way that mattered: a lit rock
    # face is mid-toned, low-chroma and outside the eroded core too, so it scored as shadow.
    # That made the metric punish exactly the behaviour we want. Measured on obsidian-c55,
    # splitting the v1 zone by what the Bria and Recraft mattes keep versus reject:
    #
    #     kept      local std 30.7   luminance 129   <- lit rock, correctly kept
    #     rejected  local std 19.0   luminance 174   <- shadow, correctly rejected
    #
    # so the two are cleanly separable on texture and the models were already doing it. For
    # reference the flat obsidian interior sits at 7.6 and clean background at 3.4 — the
    # zone's numbers are high on both sides because it straddles edges, so what matters is
    # the RATIO, not the absolute.
    #
    # A drop shadow is the flat ground attenuated, so it inherits the ground's smoothness. A
    # rock face carries grain and cracks however brightly it is lit. Hence: smooth AND
    # mid-bright AND neutral AND near a mass.
    mean = ndimage.uniform_filter(lum, 5)
    sd = np.sqrt(np.maximum(0, ndimage.uniform_filter(lum * lum, 5) - mean * mean))
    near = ndimage.binary_dilation(core, np.ones((3, 3)), iterations=max(4, W // 90))
    shadowish = (~core) & near & (chroma < 40) & (lum > 140) & (lum < 232) & (sd < 12)

    print(f'{os.path.basename(src_path)}  {W}x{H}   '
          f'core {100*core.mean():.1f}%   shadow zone {100*shadowish.mean():.1f}%\n')
    print(f'{"mask":38s}{"solid%":>8}{"shadow%":>9}{"loss%":>8}{"verdict":>10}')
    rows = []
    for p in mask_paths:
        try:
            m = load_mask(p, lum.shape)
        except Exception as e:
            print(f'{os.path.basename(p):38s}  FAILED to load: {e}')
            continue
        solid = 100 * m.mean()
        shadow = 100 * (m & shadowish).sum() / max(1, m.sum())
        loss = 100 * (core & ~m).sum() / max(1, core.sum())
        band = 15 <= solid <= 60
        verdict = 'ok' if (shadow < 4 and loss < 2 and band) else ''
        rows.append((os.path.basename(p), solid, shadow, loss, verdict))
        print(f'{os.path.basename(p):38s}{solid:7.1f}%{shadow:8.2f}%{loss:7.2f}%{verdict:>10}'
              + ('' if band else '   <-- OUT OF BAND'))
    return rows


if __name__ == '__main__':
    if len(sys.argv) < 3:
        print(__doc__)
        sys.exit(2)
    score(sys.argv[1], sys.argv[2:])
