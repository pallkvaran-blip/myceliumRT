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
- `journey.cjs` (M8 acceptance 3; `node tests/run.mjs journeybot` runs the default save): a fresh save on
  the plain URL (the first visit goes straight into Leg 1), then descent after descent through the REAL end
  screen -> Store -> cheapest buys -> Descend. The SENSIBLE player knows the leg (a leg is one fixed world):
  each run it takes legprobe's cheapest-water growth-lattice route to the taproot and digs along it with the
  real tank, flask/enzyme as career.cjs; after 25 stalled steps it falls back to `Q.step({goal: 'island'})`
  (lib.cjs's flood bot with the taproot as goal). `--naive`: the naive JOURNEY player — `--lean east` (the
  default since M8 verify 2) takes the east chevron ("Island N is east"; the banner said "the island lies east" until M8 verify 3, "dig down, then east" since): the clean tip farthest east,
  along the most open of 7 rays about due east; `--lean downeast` is the first version (farthest down +
  east, rays about the diagonal); `--compass` aims along the true bearing to the knot. Each run's line
  carries a kit tally (flasks, cuts and their messages, the most rot seen). FAILS (`====`) unless
  landfall 1 comes by run 5 (naive: 8) and legs 2 / 3 within 7 runs each.
- `legnaive.cjs`: the naive journey player SCREENED fast on a leg-1 seed (one run, tank topped up and
  counted, grow 3), alone or over legprobe's candidate sequence with PASS + WPASS — what showed that no
  re-pick in k 36-155 is landed by either naive policy (header).
  - **The flood bot alone could not do it** (first try: 43-93 m east in 4 runs, then stuck at 4 m east with
    the whole leg known): the clearance flood plans through gaps growth will not follow, and each dig added
    1-2 filaments. The lattice route is growth's own rule.
- `navdive.cjs`: a path-following dive that reaches the floor from states where a deepest-tip-only
  probe stalls. It is the reason the "colony boxes itself in" conclusion was wrong: those four
  mine-check failures were a probe digging only from the deepest tip, not a sealed pocket.
- **M14 (the tuning pass).** `journey.cjs` defaults to the plan's HUMAN OVERHEAD (`--oh plan`: 2.0 on a
  leg's first attempt, -0.15 an attempt, floor 1.4, -0.08 per island-compass rung, floor 1.3), emulated by
  charging each accepted dig (oh - 1) x its price extra in whole water and counting (oh - 1) wasted digs of
  human time; `--oh 1` is the pure bot. `--policy nav` (default) re-plans with legprobe's `navigate` every
  run (`realTank`, threats kept, pace 900); `--policy route` is the M8 fixed-route follower (it stalled at
  ~80% of leg 7). `--strat cheapest|power|knowledge`, `--no-buy-all` (skip compasses and the vial),
  `--from log.json:run` resumes a save, and a DIVE (free-layout descent on the save, capped one band under
  the material) runs after two failed attempts on a leg when a power rung waits on a material the last run
  did not pay. Every run line carries mats, drain, store levels, oh and wasted digs.
- `gates.cjs`: reads career logs and prints the numbers-model gates (G1-G7, G9, G11) with PASS/FAIL.
- `m14.cjs`: the M14 acceptance runner — `naive` (5 fresh saves x both leans, leg 1 within 5 runs on >= 3),
  `careers [labels]` (a label's prefix picks the buyer: p power, k knowledge, else cheapest), `gates <logs>`.
  In `run.mjs` as 'm14naive' and 'm14careers' (hours; not in --mine).
- `leg1pick.cjs`: screens leg-1 candidates with row overrides and a relaxed ratio, plus the naive screen.
- `storesim.cjs`: replays a career's measured income against a price table (fast what-if on the shelf).
- `econ-model.py`: the plan's career model with replaceable inputs (`--inputs econ-model-m14.json`,
  `--sweep`, `--compare <career logs>`).
- legprobe `navigate` holds a flask for TWO attached worms or one drinking 6 s (`o.flaskAtFirst` = the M9
  policy); leg-7 drain with the arrival kit 46.5 -> 23.3 water a run.

Run with `NODE_PATH=/opt/node22/lib/node_modules node tests/bots/<script>.cjs`. Screenshots and
traces go to `$BOT_OUT` (default: the OS temp dir, under `mine-bots/`).

They were written by the Phase 1 playtest agents on `claude/deep-mine-finish`; their full reports
are in `docs/finish/phase1-findings.json`.
