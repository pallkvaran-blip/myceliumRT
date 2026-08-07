#!/usr/bin/env python3
"""Re-encode a STAGED asset tree in place, for the CrazyGames cut.

Called by scripts/make-crazygames-zip.mjs. Never run against `assets/` itself — every
path here is destructive and the repo's originals are the masters.

THE ONE RULE THAT SHAPES ALL OF THIS: NOTHING IS RENAMED. A converted extension would
have to be chased through assets/manifest.json AND the handful of paths hard-coded in
index.html (spore-print.png, the four music tracks) AND anything built from a level's
`assetsFrom`, and a missed one is a 404 that stops the preload dead — which CLAUDE.md
records as "EVERY map hangs on a black screen, a symptom that looks nothing like its
cause". So each file is re-encoded into its OWN format:

  *.webp  (map sprites)  -> webp at `--rock` quality
  *.jpg   (cards, art)   -> jpg  at `--card` / `--species` quality
  *.png   (loose art)    -> png, colour-QUANTISED rather than converted

Quantising rather than converting cost almost nothing and was measured, not assumed:
png -> webp q82 is 29% of the original and quantise-to-256 is 31%. Two points of size
is not worth a rename that can 404 the boot.

ALPHA SURVIVES ALL OF IT, which is the property that matters most here: collision is
sampled from each sprite's alpha (`solidifyRock`, `_alphaMask`), so a quality knob that
touched it would silently change which walls are solid. Measured on three of the largest
garnet-c40 sprites at q85/q80/q75: max alpha delta 0 at every one. PNG quantising uses
FASTOCTREE, the only Pillow quantiser that keeps an alpha channel.
"""
import argparse
import io
import os
import sys

try:
    from PIL import Image
except ImportError:
    sys.exit("cg-encode: Pillow is required (pip install Pillow)")

Image.MAX_IMAGE_PIXELS = None


def enc_webp(path, q):
    im = Image.open(path)
    im.load()
    buf = io.BytesIO()
    # method=6 is the slow/small end of libwebp's speed-vs-size dial. This runs once per
    # build over ~700 sprites, so the minutes are worth the megabytes.
    im.save(buf, "WEBP", quality=q, method=6)
    return buf.getvalue()


def enc_jpeg(path, q):
    im = Image.open(path)
    im.load()
    if im.mode not in ("RGB", "L"):
        im = im.convert("RGB")
    buf = io.BytesIO()
    im.save(buf, "JPEG", quality=q, optimize=True, progressive=True)
    return buf.getvalue()


def enc_png(path, colors):
    im = Image.open(path)
    im.load()
    if im.mode != "RGBA":
        im = im.convert("RGBA")
    buf = io.BytesIO()
    im.quantize(colors=colors, method=Image.FASTOCTREE).save(buf, "PNG", optimize=True)
    return buf.getvalue()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("stage", help="staged assets/ directory, edited IN PLACE")
    ap.add_argument("--rock", type=int, default=75, help="webp quality for map sprites")
    ap.add_argument("--card", type=int, default=60, help="jpeg quality for card art")
    ap.add_argument("--species", type=int, default=70, help="jpeg quality for species art")
    ap.add_argument("--png", type=int, default=256, help="palette size for loose png art")
    args = ap.parse_args()

    root = os.path.abspath(args.stage)
    if os.path.basename(root) != "assets" or "/dist/" not in root.replace(os.sep, "/"):
        sys.exit(f"cg-encode: refusing to touch {root} — this only runs on a staged dist/ copy")

    before = after = 0
    counts = {}
    for dirpath, _dirs, files in os.walk(root):
        for name in sorted(files):
            path = os.path.join(dirpath, name)
            ext = name.rsplit(".", 1)[-1].lower()
            rel = os.path.relpath(path, root)
            size = os.path.getsize(path)
            try:
                if ext == "webp":
                    out, kind = enc_webp(path, args.rock), "webp"
                elif ext in ("jpg", "jpeg"):
                    q = args.species if rel.startswith("species" + os.sep) else args.card
                    out, kind = enc_jpeg(path, q), "jpg"
                elif ext == "png":
                    out, kind = enc_png(path, args.png), "png"
                else:
                    continue
            except Exception as e:                       # a sprite we cannot read is left alone
                print(f"  ! {rel}: {e} — left as-is", file=sys.stderr)
                continue
            before += size
            # NEVER LET A RE-ENCODE MAKE A FILE BIGGER. Small sprites and flat art are
            # routinely already at their floor, and a "smaller build" that grew would be
            # found by nobody.
            if len(out) < size:
                with open(path, "wb") as fh:
                    fh.write(out)
                after += len(out)
            else:
                after += size
            c = counts.setdefault(kind, [0, 0, 0])
            c[0] += 1
            c[1] += size
            c[2] += min(len(out), size)

    mb = lambda n: n / 1048576
    for kind, (n, o, a) in sorted(counts.items()):
        print(f"  {kind:5} {n:4} files  {mb(o):6.2f} -> {mb(a):6.2f} MB  ({100 * a / max(1, o):3.0f}%)")
    print(f"  {'TOTAL':5} {sum(c[0] for c in counts.values()):4} files  "
          f"{mb(before):6.2f} -> {mb(after):6.2f} MB  ({100 * after / max(1, before):3.0f}%)")


if __name__ == "__main__":
    main()
