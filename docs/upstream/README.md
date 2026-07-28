# Upstream snapshot — `pallkvaran-blip/mycelium2d`

This game started as the turn-based `mycelium2d` repo. These files are a **frozen copy** of that
repo's memory/design docs, taken from commit `a9f806a` (docs last updated 2026-07-24), kept here
because work now happens in this repo and the old one's container isn't around to grep.

**Read them as history and as design intent, not as instructions.** They describe a layout this
repo does not have:

| the docs say | here |
| --- | --- |
| source is `src/*.js`, bundled by `node build.mjs` into `dist/index.html` | there is no `src/`; **`index.html` IS the build artifact** and is edited directly |
| `src/cards-data.js` is generated from `docs/cards.json` by `scripts/gen-carddata.mjs` | `CARD_DATA` is embedded JSON inside `index.html`; that embedded copy is the source of truth |
| `src/levels-data.js` from `docs/levels/*.json` by `scripts/gen-levels.mjs` | `LEVELS_DATA` is embedded the same way |
| `node --test test/*.js` (6 node test files over `src/`) | those tests import `src/` and cannot run here; `tests/` holds Playwright checks instead |
| "rebuild and commit `dist/`" | nothing to rebuild |

To go back to the original for anything not captured here, re-attach it —
`add_repo pallkvaran-blip/mycelium2d`, then clone. It still holds the asset-generation scripts,
the editor/tool pages (level, species, card, rock-tuner, analytics) and the node test suite.

## What's in here

| file | what it's good for |
| --- | --- |
| `CHECKPOINT.md` | The old living doc. §1–§8 (what it is, architecture, card layer, food types, UI model, conventions, testing) still describe this game accurately at the design level. §9 is a ~3000-line work log — the *why* behind most decisions, worth grepping before you re-litigate one. §10 caveats, §11 backlog. |
| `cards-design.md` | **Authoritative card-system design**: the vision, §2 locked decisions, the balance framework, versioned rulings (current v11 — two-resource W/P plus the `buyCostPhosphorus` install gate, §23). Card behaviour and economy questions get answered here. |
| `cards-review.md` | Per-card playtest verdicts (👍/👎) and the cross-cutting rulings R1–R12 they produced. |
| `cards.json` | The upstream card **data** source. A snapshot for reference — **editing it changes nothing**; the live data is `CARD_DATA` in `index.html`. |

Art direction and the leaderboard setup were the two upstream docs still live enough to belong
outside this folder: see `docs/STYLE_GUIDE.md` and `docs/leaderboard-setup.md`.
