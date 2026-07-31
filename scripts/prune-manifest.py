#!/usr/bin/env python3
"""Drop assets/manifest.json entries whose file is gone, and report what went.

    python3 scripts/prune-manifest.py [--dry-run]

Deleting a traced level is three deletions — docs/levels/<id>.json, assets/<id>/, and the
level's entries in the manifest — and only the first two are obvious. The manifest is the
one that bites, because the game PRELOADS every entry in it and blocks the boot until each
one resolves. A stale entry is therefore not a cosmetic leftover: the missing sprites 404,
the preload never completes, `window.__game` is never assigned, and every level in the
build hangs on a black screen — not just the one that was deleted.

That is exactly what cutting maze-one, scatter-one, ledges-one and veined-one did. It cost
a debugging round, because the symptom (nothing boots at all) looks nothing like the cause
(four folders were removed cleanly and on purpose).

trace-map.py only ever ADDS to the manifest, which is right — it has no way of knowing
whether a key it doesn't recognise belongs to a level, to the card art, or to the species
portraits. Pruning is a separate, explicit step, and this is it.
"""

import argparse, json, os, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MANIFEST = os.path.join(ROOT, 'assets', 'manifest.json')

ap = argparse.ArgumentParser()
ap.add_argument('--dry-run', action='store_true')
ARGS = ap.parse_args()

man = json.load(open(MANIFEST))
kept, dropped = [], []
for a in man['assets']:
    if os.path.exists(os.path.join(ROOT, 'assets', a['file'])):
        kept.append(a)
    else:
        dropped.append(a)

# Retag while we're here. Anything living under an authored level's folder is kind 'level',
# which is what tells the boot preloader to skip it — see the note in trace-map.py. Maps
# traced before that tag existed still say 'sprite', and a single mistagged map is enough to
# pull its whole folder back into the boot.
LEVELDIR = os.path.join(ROOT, 'docs', 'levels')
ids = {f[:-5] for f in os.listdir(LEVELDIR) if f.endswith('.json')}
retagged = 0
for a in kept:
    if a['file'].split('/')[0] in ids and a.get('kind') != 'level':
        a['kind'] = 'level'
        retagged += 1

if not dropped and not retagged:
    print(f'manifest is clean — all {len(kept)} entries resolve, tags correct')
    sys.exit(0)
if retagged:
    print(f'  retagged {retagged} entries as kind "level" (deferred past boot)')

# Group the report by folder; "78 sprites under maze-one/" is the useful line, not 78 lines.
bydir = {}
for a in dropped:
    bydir.setdefault(os.path.dirname(a['file']) or '.', []).append(a['key'])
for d, keys in sorted(bydir.items()):
    print(f'  {len(keys):4d} missing under {d}/' if d != '.' else f'  {len(keys):4d} missing at the top level')
    if len(keys) <= 4:
        for k in keys:
            print(f'         {k}')

if ARGS.dry_run:
    print(f'\nwould drop {len(dropped)}, keep {len(kept)} (--dry-run)')
    sys.exit(0)

man['assets'] = kept
with open(MANIFEST, 'w') as f:
    json.dump(man, f, indent=2)
    f.write('\n')
print(f'\ndropped {len(dropped)}, kept {len(kept)} — assets/manifest.json rewritten')
