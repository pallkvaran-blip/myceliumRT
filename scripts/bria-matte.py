#!/usr/bin/env python3
"""Fetch a Bria remove-background matte for a map image, and cache it.

    REPLICATE_API_TOKEN=… python3 scripts/bria-matte.py docs/maps/<stem>.webp
    -> docs/maps/<stem>.matte.png            (greyscale, the model's alpha)

Why a learned matte at all. On an overhead roll the soft DROP SHADOW under a mass and the
LIT FACE of that mass occupy the same luminance band, so no threshold separates them — the
owner confirmed by hand what the measurements say. What distinguishes them is not a level
but a semantic judgement: one is an object, the other is that object's shadow. Bria's
background remover makes exactly that judgement, and on obsidian-c55 it makes it perfectly:
it drops ZERO percent of unambiguous rock, where the threshold pipeline drops 1.65%.

Why the matte is a GUIDE and not the answer. Bria hard-caps its output at 1024x432 whatever
resolution it is fed — verified by sending it the 5760px upscale and getting 1024 back — so
its edge is 5.6x coarser than the image the sprites are cut from. Used directly the rocks
come out faintly rounded, with the fine silhouette lost. So trace-map.py uses it to decide
WHICH regions are rock and the source pixels to decide exactly where each edge falls. See
--guide there.

Cached and committed, for the same reason as the @4x upscale: it is a paid API call whose
answer never changes, and a re-trace should reproduce what shipped without paying again.

Also tried and rejected, so nobody spends the round again:
  recraft-ai/recraft-remove-background   scores identically on paper (0.00% rock lost) but
                                         leaves a soft halo of retained shadow around every
                                         mass, plainly visible as a glow over the soil.
  BiRefNet                               drops 2.46% of unambiguous rock — worse than the
                                         threshold pipeline it was meant to replace.
  SAM 2, local texture, gradient/edge,
  physical shadow model                  see docs/maps/README.md.
"""

import argparse, base64, json, os, subprocess, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
VERSION = '5ecc270b34e9d8e1f007d9dbd3c724f0badf638f05ffaa0c5e0634ed64d3d378'

ap = argparse.ArgumentParser()
ap.add_argument('image', help='the 1x source image (NOT the @4x — Bria caps at 1024 anyway, '
                              'so the big one only costs upload time)')
ap.add_argument('--out', default=None)
ap.add_argument('--force', action='store_true', help='refetch even if a matte is cached')
a = ap.parse_args()

TOKEN = os.environ.get('REPLICATE_API_TOKEN')
src = a.image if os.path.isabs(a.image) else os.path.join(ROOT, a.image)
stem = os.path.splitext(src)[0]
out = a.out or (stem + '.matte.png')

if os.path.exists(out) and not a.force:
    print(f'cached: {os.path.relpath(out, ROOT)}')
    sys.exit(0)
if not TOKEN:
    print('set REPLICATE_API_TOKEN (environment only — never commit it)', file=sys.stderr)
    sys.exit(1)

ext = os.path.splitext(src)[1].lstrip('.') or 'png'
with open(src, 'rb') as f:
    b64 = base64.b64encode(f.read()).decode()

# Via curl and a temp file, not fetch and not argv: outbound HTTPS goes through the agent
# proxy which curl already honours, and a base64 image inline in argv blows E2BIG.
body = os.path.join(os.path.dirname(out), '.bria-body.json')
with open(body, 'w') as f:
    json.dump({'version': VERSION,
               'input': {'image': f'data:image/{ext};base64,{b64}',
                         # Partial alpha ON. Bria's soft edge is a genuine anti-aliased
                         # boundary and the guided refinement only reads it at >=0.5, so the
                         # softness costs nothing and a hard alpha would just quantise it.
                         'preserve_partial_alpha': True}}, f)
try:
    raw = subprocess.run(
        ['curl', '-sS', '-X', 'POST', 'https://api.replicate.com/v1/predictions',
         '-H', f'Authorization: Bearer {TOKEN}', '-H', 'Content-Type: application/json',
         '-H', 'Prefer: wait', '-d', '@' + body],
        capture_output=True, check=True).stdout.decode()
finally:
    if os.path.exists(body):
        os.remove(body)

try:
    j = json.loads(raw)
except json.JSONDecodeError:
    print(raw[:600], file=sys.stderr)
    sys.exit(1)
url = j.get('output')
if not url:
    print(f'no output: {j.get("error") or j.get("status") or raw[:400]}', file=sys.stderr)
    sys.exit(1)

png = subprocess.run(['curl', '-sS', url], capture_output=True, check=True).stdout
tmp = out + '.tmp'
with open(tmp, 'wb') as f:
    f.write(png)

# Store only the ALPHA, as greyscale. The RGB Bria returns is just the source with the
# background knocked out, which we already have at four times the resolution.
from PIL import Image
im = Image.open(tmp)
alpha = im.getchannel('A') if im.mode == 'RGBA' else im.convert('L')
alpha.save(out, 'PNG', optimize=True)
os.remove(tmp)
print(f'wrote {os.path.relpath(out, ROOT)} — {alpha.size[0]}x{alpha.size[1]} '
      f'({os.path.getsize(out)//1024} KB)')
