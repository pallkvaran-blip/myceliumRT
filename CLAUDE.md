# Working notes for Claude

Mycelium: a 2D roguelike engine-builder about growing a fungal colony to the surface. This
repo ships **two games in one build** — the original turn-based game and a real-time variant.
See README.md for the player/config-facing description; this file is the stuff that bites.

## Shape of the codebase

- **Everything is `index.html`** (~20k lines, 37 modules): one inline `<script>` holding the game
  as a chain of IIFE modules, `const __m_<name> = (function () { … })()`. No build step, no
  bundler — you edit the single file and reload. `assets/` holds runtime art/audio.
- Modules read each other by destructuring at the top (`const { CONFIG } = __m_config;`), so
  **declaration order is dependency order**. `__m_config` is first; `__m_main` is last.
- Comments carry the *why*, densely, and often record what was tried and failed. Match that —
  a bare restatement of the code is worse than nothing here.
- `docs/card-review.html` is GENERATED: `node scripts/gen-card-review.mjs`. Don't hand-edit it.
- Card data (`CARD_DATA`) is embedded **JSON**, not JS literals — grep for `"effect":`, not
  `effect:`. It's generated from docs/cards.json upstream, so card text is fixed at DISPLAY
  time (`timeify`) rather than edited in place.

## The two modes

`CONFIG.mode` is `'turn' | 'realtime'`, applied by `setMode()`. **`realtime.enabled` is the one
flag every mode-dependent rule reads** — engine code sees it as `state.config.realtime.enabled`,
via `isRealtime(cfg)`. `state.config` is a deep clone taken at run start, so `setMode()` must be
called *before* the run begins (the title screen does).

`MODE_TUNING` holds each mode's balance numbers because **real-time rates are per 500 ms tick
and turn-based rates are per player action**. Never "fix" one mode's speed without checking the
other — a worm creeping 0.375 cells/tick would barely move if it only stepped on a card play.

Mode-gated behaviour, roughly in order of subtlety:

- `performAction` / `resolveCardOp` tick the world in turn mode; the wall clock does in RT.
- `Network.grownIn()` (the `_liveAt` reveal gate) returns `true` outside RT — nothing happens
  between actions in turn-based, so gating a grow's effects on its animation would just stall
  them. That one gate un-gates threat senses, pile claims and the win check together.
- Colonisation: settled per grow in turn-based; in RT re-decided each tick **only while a grow
  is in flight** (`net._colonizePending`, until `net._arriveUntil`). It must NOT run freely —
  doing so had the colony reach out and take piles the player never grew toward, most visibly
  the instant the tutorial ended.
- `roundTicks` = 1 in turn-based, `roundSeconds*1000/stepMs` in RT. Cadence meters draw **dots**
  in turn-based (progress lives in the markup — fine, the HUD only refreshes when you act) and a
  **time bar** in RT (progress must stay OUT of the markup; see churn below).
- `_worldTime` must keep advancing in turn-based, or `simPaused()` freezes the ant march forever.

## Testing

Playwright harnesses, run headless against a tiny static server rooted at the repo. Playwright
is installed globally: **`NODE_PATH=/opt/node22/lib/node_modules node <test>.cjs`**.

Boot hashes are a comma-separated list — first token is the destination, rest are flags:
`#dev` (skip the picker), `#dev,turn` (same, turn-based), `#puzzle`, `#notrich`, `#tutorial`.

Debug hooks (invisible, no UI): `window.__game` — `state`, `performAction`, `tickWorld`, `play`,
`draw`, `chooseCard`, `armAim`, `aimState`, `botToGoal`, `modeInfo`, `config`, `scores`,
`scoresUi`, `showHighScores`, `startTutorial`, `traceAnts`/`antMarks`, `paceInfo`. Plus
`window.__cfg` (live CONFIG, available before a run starts) and `window.__tsLure` (title screen).

**Disable the score backend in any test that could write:**
`page.addInitScript(() => { window.MYCELIUM_SUPABASE = { url: '', anonKey: '' }; })`. An
explicitly-empty key genuinely disables it; a missing key falls back to the live project.

Harness traps that have cost real time:
- `resolveCardOp` and `__game.play()` **return nothing** — assert on state (`state.turn`,
  node counts), not a result object.
- Pending offers carry **`choices`** (an array of card names), not `cards`.
- A probe that plays real cards can **end the run**; the species picker/level intro that
  follows covers the canvas and silently swallows every later click. If a repeated-input test
  starts failing from some iteration onward, check for an overlay before suspecting the code.
- Piles adjacent to already-grown tissue are claimed at *play* time, so "did the arrival window
  do it?" needs a pile beyond sensing range or a strand with a future `_liveAt`.
- The species table has **12** entries — `psilocybe` sits past where a quick scan stops.

## Things that break if you forget them

- **HUD churn.** The RT HUD refreshes every world tick. Any markup that encodes per-tick
  progress gets rebuilt at 2 Hz, which destroys the element under the cursor (flicker, swallowed
  clicks). Hence the `_handSig` / `_filterSig` / `_ledgerHTML` / `_actMenuHTML` guards and the
  cadence bar writing its fill via `syncCadenceBars` instead of the markup.
- **Rock has two masks.** `cell.rock` is coarse; `substrate.solidAtWorld(x,y)` matches the drawn
  sprite, which overhangs its cells. Anything that must look right against the art (growth, ant
  trails) tests `solidAtWorld` — destination *and* midpoint.
- **Title screen `g.minY`** is the consume animation's "the strand reached the letter" test. Any
  growth that isn't the consume strand must pass `track: false` to `addNode`, or pressing
  New/Old fires its bloom instantly.
- **Title `.ts-btn` font-size must stay above ~26px.** The consume animation's step is scaled off
  the font size and stalls below that (its first attractor lands inside the kill radius).
- Both modes share one **species/spores wallet**, but each keeps its **own resume slot** and its
  **own high-score ladder**.

## Conventions here

- Develop, commit and push on the branch named in the task. **Never open a PR unless asked.**
- Push with `git push -u origin <branch>`, retrying with backoff on network failure.
- Verify by running the harnesses and report the actual numbers. Screenshot anything visual —
  several bugs in this project were only visible in a rendered frame.

## Loose ends

- `CONFIG.dev.enabled` is `true` (dev buttons on screen). Flip it off for a public cut.
- The global leaderboard needs one migration to split by mode (SQL in README.md and inline at
  `getBoard`). Until then the client falls back to a combined board and says so.
- The card-timing review decisions in `docs/card-review.html` are still awaiting the user's
  picks; nothing has been converted to N×-per-level yet.
- The Playwright harnesses live in the session scratchpad, not the repo, so they do **not**
  survive the container. Worth offering to commit them.
