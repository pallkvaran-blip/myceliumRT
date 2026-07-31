#!/usr/bin/env python3
"""Drive the whole generated-map pipeline over the shortlist, in one go.

    REPLICATE_API_TOKEN=… python3 scripts/implement-maps.py            # everything outstanding
    REPLICATE_API_TOKEN=… python3 scripts/implement-maps.py --dry-run  # just say what it would do
    REPLICATE_API_TOKEN=… python3 scripts/implement-maps.py --only obsidian,rust

Up to now each map was taken through by hand: upscale, trace, gen-levels, eyeball. That was
fine for five. The owner's shortlist is 59, and at that size the by-hand route is both slow
and unrepeatable — this script exists so a re-run reproduces the same set of levels from the
same set of source images.

Per map:
  1. `scripts/upscale-map.mjs` -> docs/maps/<stem>@4x.webp   (skipped if it already exists;
     Real-ESRGAN costs money and the upscale is committed precisely so it is paid for once)
  2. `scripts/trace-map.py`    -> docs/levels/<id>.json + assets/<id>/*.webp
  3. once, at the end: `scripts/gen-levels.mjs` splices the LEVELS array into index.html

THE SHORTLIST IS NOT DEFINED HERE. It is `SELECTIONS` in scripts/gen-map-review.py, which is
what the owner actually reviews — keeping a second copy would guarantee the two drift apart.
This reads that list and intersects it with what is on disk.

Naming. The id is what `#level,<id>` boots and what assets/<id>/ is called, so it has to be
stable and collision-free across 59 maps generated under four different prompt versions:

    top-obsidian-scatter-c55-1  ->  obsidian-c55        "Obsidian 55"
    top-crystal-scatter-c40-2   ->  crystal-c40-2       "Crystal 40 (2)"
    top-scatter-c24-1           ->  slate-c24           "Slate 24"
    crystal-scatter-c36-1       ->  side-crystal-c36    "Crystal 36 (side)"

The `side-` prefix matters: the overhead and side-on rolls of the same theme and count are
different maps and would otherwise land on the same id and overwrite each other's sprites.
"""

import argparse, os, re, subprocess, sys, json

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MAPS = os.path.join(ROOT, 'docs', 'maps')
LEVELS = os.path.join(ROOT, 'docs', 'levels')

ap = argparse.ArgumentParser()
ap.add_argument('--dry-run', action='store_true')
ap.add_argument('--only', default='', help='comma-separated substrings; only matching stems run')
ap.add_argument('--min-area', type=int, default=9600,
                help='gravel cut in image px^2. 9600 is 600 at 1x scaled by the square of the '
                     '4x upscale — see docs/maps/README.md')
ap.add_argument('--retrace', action='store_true',
                help='re-trace maps that already have a level JSON (default skips them)')
ARGS = ap.parse_args()


def shortlist():
    """The stems in gen-map-review.py's SELECTIONS that still have a source image."""
    src = open(os.path.join(ROOT, 'scripts', 'gen-map-review.py')).read()
    block = src.split('SELECTIONS = [')[1].split('\n]')[0]
    stems = re.findall(r"\(\s*'([^']+)'", block)
    return [s for s in stems if os.path.exists(os.path.join(MAPS, f'{s}.webp'))]


# Themes whose ground is BLACK. The tracer detects polarity from flatness and refuses to guess
# when the two candidates are within 1.6x, which is the right default but is a hard failure in
# a batch — so the batch tells it, rather than finding out 40 maps later that one bailed.
DARK_GROUND = ('glacier', 'bones', 'skeletons')

PRETTY = {'biolum': 'Bioluminescent', 'slate': 'Slate'}

# Stems whose id predates the scheme. `silhouette-2` shipped as `scatter-two` and is already
# playable; deriving an id for it would re-trace the same image under a second name.
ALIASES = {'silhouette-2': ('scatter-two', 'Scatter Two')}


def ident(stem):
    """(id, display name) for a source stem. See the module docstring for the scheme."""
    if stem in ALIASES:
        return ALIASES[stem]
    side = not stem.startswith('top-')
    body = stem[4:] if not side else stem
    bits = body.split('-')
    # `scatter` with no theme in front of it is the default theme, slate.
    theme = bits[0] if bits[0] != 'scatter' else 'slate'
    if theme == 'bioluminescent':
        theme = 'biolum'
    m = re.search(r'-c(\d+)-(\d+)$', body)
    if not m:                                     # e.g. `silhouette-2`, `maze-1`
        return (f'{"side-" if side else ""}{body}', body.replace('-', ' ').title())
    count, roll = int(m.group(1)), int(m.group(2))
    ident_ = f'{theme}-c{count}' + (f'-{roll}' if roll > 1 else '')
    if side:
        ident_ = 'side-' + ident_
    name = f'{PRETTY.get(theme, theme.title())} {count}'
    if roll > 1:
        name += f' ({roll})'
    if side:
        name += ' (side)'
    return ident_, name


def run(cmd, **kw):
    print('   $', ' '.join(cmd[:3]), '…', flush=True)
    return subprocess.run(cmd, cwd=ROOT, check=True, **kw)


def main():
    stems = shortlist()
    if ARGS.only:
        want = [t.strip() for t in ARGS.only.split(',') if t.strip()]
        stems = [s for s in stems if any(w in s for w in want)]

    seen = {}
    plan = []
    for stem in stems:
        i, name = ident(stem)
        if i in seen:
            print(f'!! id collision: {stem} and {seen[i]} both -> {i}', file=sys.stderr)
            return 2
        seen[i] = stem
        up = os.path.join(MAPS, f'{stem}@4x.webp')
        lvl = os.path.join(LEVELS, f'{i}.json')
        plan.append(dict(stem=stem, id=i, name=name, up=up, lvl=lvl,
                         has_up=os.path.exists(up), has_lvl=os.path.exists(lvl),
                         dark=any(d in stem for d in DARK_GROUND)))

    todo = [p for p in plan if ARGS.retrace or not p['has_lvl']]
    need_up = [p for p in todo if not p['has_up']]
    print(f'{len(plan)} in the shortlist · {len(todo)} to trace · {len(need_up)} to upscale\n')
    if ARGS.dry_run:
        for p in plan:
            mark = 'done ' if p['has_lvl'] and not ARGS.retrace else ('trace' if p['has_up'] else 'FULL ')
            print(f'  {mark} {p["stem"]:38s} -> {p["id"]:22s} "{p["name"]}"'
                  + ('  [dark ground]' if p['dark'] else ''))
        return 0

    ok, failed = [], []
    for n, p in enumerate(todo, 1):
        print(f'[{n}/{len(todo)}] {p["stem"]} -> {p["id"]}', flush=True)
        try:
            if not p['has_up']:
                run(['node', 'scripts/upscale-map.mjs', f'docs/maps/{p["stem"]}.webp'],
                    stdout=subprocess.DEVNULL)
            cmd = ['python3', 'scripts/trace-map.py', p['up'],
                   '--id', p['id'], '--name', p['name'], '--min-area', str(ARGS.min_area)]
            if p['dark']:
                cmd += ['--invert', 'yes']
            run(cmd, stdout=subprocess.DEVNULL)
            ok.append(p)
        except subprocess.CalledProcessError as e:
            print(f'   FAILED ({e.returncode})', flush=True)
            failed.append(p)

    if ok:
        run(['node', 'scripts/gen-levels.mjs'])
    print(f'\ntraced {len(ok)}, failed {len(failed)}')
    for p in failed:
        print(f'  FAILED {p["stem"]}')
    # A map that fails to trace leaves no JSON, so a re-run picks it up again — the script is
    # resumable by construction rather than by bookkeeping.
    return 1 if failed else 0


if __name__ == '__main__':
    sys.exit(main())
