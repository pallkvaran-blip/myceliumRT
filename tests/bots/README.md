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
- `navdive.cjs`: a path-following dive that reaches the floor from states where a deepest-tip-only
  probe stalls. It is the reason the "colony boxes itself in" conclusion was wrong: those four
  mine-check failures were a probe digging only from the deepest tip, not a sealed pocket.

Run with `NODE_PATH=/opt/node22/lib/node_modules node tests/bots/<script>.cjs`. Screenshots and
traces go to `$BOT_OUT` (default: the OS temp dir, under `mine-bots/`).

They were written by the Phase 1 playtest agents on `claude/deep-mine-finish`; their full reports
are in `docs/finish/phase1-findings.json`.
