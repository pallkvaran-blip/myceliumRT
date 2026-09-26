# Mine bots: the measuring instruments for the economy

These play The Deep Mine the way a player does, so balance changes can be judged by numbers
rather than by feel. They are not checks and are not in `tests/run.mjs`; they print and write
traces, and never fail.

- `lib.cjs`: static server, mine boot, and the in-page bot (`injectBot`). The bot plans a route
  through the FINE MASK (a BFS over `_fineSolid`), detours to ore and water it can see, and digs
  with `growFrom`, the same engine call a drag makes.
- `botrun.cjs`: one descent with that bot, logged per dig.
- `career.cjs`: many descents on ONE save through the real end screen -> store -> Descend flow,
  buying the cheapest affordable rung each visit. This is how "a store visit that buys nothing"
  and "P per run over a career" were measured.
- `sweep.cjs`: the finishing plan's M1 acceptance 4. One `playDescent` per seed (12 seeds, fresh
  save each, paceMs 900, sitMs 8000), asserting every run reaches `runOver` by itself (no recovery
  digs, no forced End run) and every stall ends while the bot sits. It is the one bot script that
  FAILS (prints a `====` line), and it is in `run.mjs` as the slow 'sweep' check.
- `naive.cjs`: the finishing plan's M4 acceptance 7. One fresh-save first descent per seed
  (4242 909 11 5 31337 2024 7 99) with lib.cjs's `naiveStep`: ALWAYS dig from the deepest clean tip
  (refused or not) toward the most open of 7 downward rays, and dig from a glowing tip along the
  direction the glow DRAWS while the dead-end nudge has tips lit. (An earlier version tried a strand
  higher up after refusals — help a naive player does not have; removed once the nudge learned to
  fire on 3 'Solid rock' refusals.) FAILS (prints `====`) unless the median is >= 40 m and every
  stalled run was nudged. `--baseline` ignores the glow and only prints. In `run.mjs` as the slow
  'naive' check (~6 min), not in `--mine`.
- **lib.cjs read reservoir `cx`/`cy`/`rad` as world units until M4 — they are CELLS** — so the
  route bot never actually steered for water. Fixed in M4; sweep/career numbers before it were
  measured with a bot that found pockets only by accident.
- `econ.cjs`: the finishing plan's M5 acceptance 1-4 (`run1 [--naive] [--pace N]`, `career
  [--strat cheapest|power|knowledge]`, `diver`). run1 plays one fresh-save descent per seed, then the
  REAL end screen -> Store -> the Water tank tile's Buy. career shells out to `career.cjs` per seed and
  counts dead store visits and P growth. FAILS (prints `====`) on any miss.
- `career.cjs` reads the track ids from the page (`__game.store.ids('mine')`) since M5, skips tracks
  the progressive reveal still hides, and takes the buy orders `cheapest`, `power`, `knowledge`.
- `lib.cjs`'s `digAlong` aims a full `mineGrowReach` ahead since M5 (it aimed a fixed 120-130 units,
  which wasted most of a bought Grow strength), and `step({policy: 'naive'})` delegates to `naiveStep`.
- `navdive.cjs`: a path-following dive that reaches the floor from states where a deepest-tip-only
  probe stalls. It is the reason the "colony boxes itself in" conclusion was wrong: those four
  mine-check failures were a probe digging only from the deepest tip, not a sealed pocket.

Run with `NODE_PATH=/opt/node22/lib/node_modules node tests/bots/<script>.cjs`. Screenshots and
traces go to `$BOT_OUT` (default: the OS temp dir, under `mine-bots/`).

They were written by the Phase 1 playtest agents on `claude/deep-mine-finish`; their full reports
are in `docs/finish/phase1-findings.json`.
