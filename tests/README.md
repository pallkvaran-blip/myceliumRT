# Checks

Playwright scripts that drive the real game in a headless browser: load `index.html`, set up a
situation through the invisible `window.__game` hooks, and assert what the game did. Each prints
`PASS`/`FAIL` per assertion and a `==== N passed, M failed ====` line, and exits non-zero on any
failure. There's no test framework — they're plain Node scripts.

## Running them

```bash
node tests/run.mjs              # everything (~12 min)
node tests/run.mjs --fast       # skip rt/tut/lure (~6 min)
node tests/run.mjs hs lure      # just the ones whose name matches
node tests/hs-check.cjs         # one directly
```

Playwright must be importable. The runner defaults `NODE_PATH=/opt/node22/lib/node_modules`,
which is where it lives in the dev container; elsewhere set `NODE_PATH` yourself or
`npm i -D playwright`.

Screenshots land in `tests/.artifacts/` (gitignored). Several checks take one whether they pass
or not — for anything visual, look at the picture before trusting the assertions.

## What each one covers

| check | asserts |
|---|---|
| `species-check.mjs` | Every starter's opening hand + starting Water (static — no browser) |
| `pill-check.cjs` | Card-review tool: severity pills/stripes match the summary counts |
| `review-check.cjs` | Card-review tool: renders, decisions persist, filters and export work |
| `ingame-text.cjs` | Card text reads in seconds in real time |
| `hover-check.cjs` | Hovering a card isn't destroyed by the 2 Hz HUD refresh |
| `boot-check.cjs` | Every boot hash comes up clean, in the right mode |
| `hs-check.cjs` | High scores: a ladder per mode, one table, tabs, turn-based default |
| `level-check.cjs` | The authored map "Three Ways Up": three lanes sealed + traversable, threats per lane |
| `turn-play.cjs` | 120 turn-based actions: each advances the world exactly one step |
| `aim-check.cjs` | The forgiving grow-aim radius, pressed repeatedly |
| `fixes-check.cjs` | Surface-only win, no unprompted pile claims, SURVIVAL placement, dots vs bars |
| `mode-check.cjs` | Both games in one build: title buttons, per-mode tuning, clock behaviour |
| `lure-check.cjs` | Title screen: strands creep to the cursor, branch, trail off, stop on leave |
| `traced-check.cjs` | The traced map "Maze One": 68 sprites decode, open space runs colony→goal on the real mask, no food sealed off, nothing drawn over a pathClear channel |
| `edit-check.cjs` | The dev rock editor: select/transform/delete, the look filter, placement, the above-ground clip, export, and Save as… |
| `core-check.cjs` | The molten core: the growth floor IS the drawn line, rocks clip at it, the earth turns red, and procedural maps have none |
| `tut-check.cjs` | Tutorial: orange pile → draft → "time stops" wording → red-only prompt |
| `rt-test.cjs` | The real-time core: clock, drafts pausing, arrival gating, cadence bars, aim |

**HUD-survival assertions live only in `hover-check`** — that a hovered card and a cadence bar
survive refreshes, that the bar's fill climbs, that it glides on a CSS transition. `rt-test`
used to carry copies, but on its long-running page a draft or an affordability change mid-probe
re-renders the row for legitimate reasons, and the copies reported failures they couldn't
justify. `rt-test` keeps only the structural claims (the old dots are gone, a bar is drawn).
If you add a churn assertion, give it a fresh page and pin resources.

`shot.cjs`, `hs-shot.cjs`, `lure-shot.cjs` aren't checks — they just capture screenshots of the
title screen, the leaderboard and the pointer lure for eyeballing.

## Writing another one

Copy the top of any existing check: a `http.createServer` rooted at the repo, `chromium.launch`,
click past `#loadscreen`, wait for `window.__game`, dismiss `#levelIntro`. Then:

- Boot hashes are comma-separated — `#dev` skips the picker, `#dev,turn` does the same in
  turn-based mode. `#puzzle`, `#notrich`, `#tutorial` also work, and `#level,<id>` boots a
  hand-authored map from `docs/levels/` (`#level,three-ways`).
- **The level intro appears a beat AFTER `__game.state` does.** Clicking once and then testing
  for `#levelIntro` exits the loop before it exists, and every later click is swallowed by the
  overlay — wait for the selector first. It also holds the real-time clock, which is useful:
  read a fresh map's threat positions before dismissing it and nothing has moved yet
  (`level-check` does exactly this).
- **Disable the score backend if the test could write one:**
  `page.addInitScript(() => { window.MYCELIUM_SUPABASE = { url: '', anonKey: '' }; })`.
- `__game.play()` and `resolveCardOp` return nothing — assert on state, not a return value.
- A probe that plays real cards can end the run; whatever screen follows (picker, "species
  unlocked", level intro) then covers the canvas and eats every later click. Check for an
  overlay before believing a late-onset failure — `aim-check` does this before every press.
- **Waiting does nothing in turn-based.** A real-time check can `sleep` for the world to move;
  a turn-based one has to keep acting, or call `__game.tickWorld(state)`. `tut-check` branches
  on `state.config.realtime.enabled` for exactly this.

See the repo's CLAUDE.md for the rest of the traps.

### `edit` — the dev rock editor (`tests/edit-check.cjs`)

Drives the in-game rock editor on a traced map: opens the panel, selects every rock,
scales, rotates, adjusts the look filter, deletes, exports, and saves. Asserts on state
(`substrate.levelSprites`), never on the panel's own labels — the editor mutates the same
list the engine draws and collides from, so the sprites are the truth.

Watch the export assertion in particular. The first version parked the JSON on
`window.__levelJSON` only in the clipboard's failure path, and headless Chromium's clipboard
write SUCCEEDS — so the by-hand check passed and the test read `null`. It now always parks
it, and copies as well.

The **Save as…** block runs on a second, FRESH page load, and that is not tidiness: the steps
before it delete every rock, and the one thing about saving that can silently go wrong is the
sprite lookup (a saved map has a new id and no `assets/<id>/` folder — it resolves through
`assetsFrom`). A saved copy of an empty map cannot tell you whether that worked. It answers the
`window.prompt` through Playwright's dialog handler rather than calling the exposed helper,
because the prompt is precisely where the button path and a scripted save could differ.

### `core` — the molten core (`tests/core-check.cjs`)

The core is drawn by `SubstrateRenderer._bakeEarth` and enforced by `Network._placeOk`, two
places that share only a number. The assertion that matters is that the line the player SEES
and the line the engine STOPS them at are the same y — a growth floor a hundred units off the
visible seam reads as the game refusing a legal move, and nothing but a test keeps them
together. It scans ACROSS the map at each depth rather than probing one x, because a single
column lands inside a rock and reports "blocked" for the wrong reason.

Its rock-clip assertion has a **verified negative control**: with the clip removed the rock
centre reads 84 against bare core 242 (gap 158, tolerance 30); with it, 176 against 184. Run
that control before trusting it or anything like it — see below for why.

The clip assertion is worth reading before trusting a similar one. Three versions of it
passed with the feature REMOVED: a grep for a source comment; a mean over a 100px band above
the soil line (rocks are dark, the night sky is dark, the mean barely moved); and a symmetric
"did the pixel change by 25" (without the clip the rock is still drawn up there, and the
sample moved the wrong way, 184 -> 210). It now samples the rock's own centre and compares it
to a patch of BARE SKY in the same frame — 73 against 74 with the clip, 210 against 147
without. Always run a negative control on a pixel assertion.

### `fringe-score.py` is not a check, but read it like one

`python3 scripts/fringe-score.py` measures the pale ring on every traced level's sprites,
theme-relative (each sprite against itself, so pale `glacier` is not judged against near-black
`obsidian`). It is the number behind "the rocks have a halo", which was reported by eye twice
before anything measured it. Median across the 58 levels is -0.1 with 47 under +10; if a
re-trace pushes that above +10, `--trim` is the first thing to look at.
