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
  (4242 909 11 5 31337 2024 7 99) with lib.cjs's `naiveStep`: dig from the deepest clean tip toward
  the most open of 7 downward rays, and dig from a glowing tip while the dead-end nudge has tips lit.
  FAILS (prints `====`) unless the median is >= 40 m and every stalled run was nudged. `--baseline`
  ignores the glow and only prints. Not in `run.mjs` (~5 min; the baseline can take ~15).
- **lib.cjs read reservoir `cx`/`cy`/`rad` as world units until M4 — they are CELLS** — so the
  route bot never actually steered for water. Fixed in M4; sweep/career numbers before it were
  measured with a bot that found pockets only by accident.
- `navdive.cjs`: a path-following dive that reaches the floor from states where a deepest-tip-only
  probe stalls. It is the reason the "colony boxes itself in" conclusion was wrong: those four
  mine-check failures were a probe digging only from the deepest tip, not a sealed pocket.

Run with `NODE_PATH=/opt/node22/lib/node_modules node tests/bots/<script>.cjs`. Screenshots and
traces go to `$BOT_OUT` (default: the OS temp dir, under `mine-bots/`).

They were written by the Phase 1 playtest agents on `claude/deep-mine-finish`; their full reports
are in `docs/finish/phase1-findings.json`.
