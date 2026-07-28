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
| `turn-play.cjs` | 120 turn-based actions: each advances the world exactly one step |
| `aim-check.cjs` | The forgiving grow-aim radius, pressed repeatedly |
| `fixes-check.cjs` | Surface-only win, no unprompted pile claims, SURVIVAL placement, dots vs bars |
| `mode-check.cjs` | Both games in one build: title buttons, per-mode tuning, clock behaviour |
| `lure-check.cjs` | Title screen: strands creep to the cursor, branch, trail off, stop on leave |
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
  turn-based mode. `#puzzle`, `#notrich`, `#tutorial` also work.
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
