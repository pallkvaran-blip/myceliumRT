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
| `enemy-turn-check.cjs` | The phased, animated enemy turn (turn-based): `tickWorld`'s move/attack split is real in both directions (a worm crawls in one phase and bites in the other, a cloud creeps then devours, the rot only races on the attack), nothing moves while the player's growth is still revealing, the ~2s slide and its tween, and one world step per action even when the player outruns the animation. Plus the negative: real time never grows an `enemyTurn` |
| `aim-check.cjs` | The forgiving grow-aim radius, pressed repeatedly |
| `fixes-check.cjs` | Surface-only win, no unprompted pile claims, SURVIVAL placement, dots vs bars |
| `mode-check.cjs` | Both games in one build: title buttons, per-mode tuning, clock behaviour |
| `lure-check.cjs` | Title screen: strands creep to the cursor, branch, trail off, stop on leave |
| `traced-check.cjs` | Every traced map (pass ids to narrow it): sprites decode, open space runs colony→goal on the real mask, no food sealed off, nothing drawn over a pathClear channel |
| `edit-check.cjs` | The dev rock editor: select/transform/delete, the look filter, placement, the above-ground clip, export, and Save as… |
| `core-check.cjs` | The molten core: the growth floor IS the drawn line, rocks clip at it, the earth turns red, assets stamp into the deepest row, and procedural maps have none |
| `scale-check.cjs` | The organism scale: every growth LENGTH is base × `growth.scale`, the ratios between them survive it, the step measures what the config says, the drawn thread scales with it, and the longer step doesn't hop a wall |
| `threat-check.cjs` | Threat rates and rules, measured through the sim in BOTH modes: worm crawl, bite size, reach, move-AND-eat on one step, a worm out of sight still closing in, cloud creep, the rot lifespan (darkens, then falls away, and healing resets the deadline), infected tissue not harvesting while the pile keeps its food, first-touch rot vs the established race (separate, non-stacking), the "no clean mycelium off rot" invariant, `infectionSpreadChance` being 1, and the render creep keeping pace. Does NOT assert `wanderSpeed` — it's a dead knob |
| `harvest-check.cjs` | Infected mycelium neither harvests nor drafts, asked at every reader of `cell.colonized`: passive income, the pile draft (including an already-empty pile), and both Digest paths. Covers the two cases a claim outlives its tissue — the mat drifting a cell over, and rot ageing out and being removed — plus the release: the pile keeps its food and clean regrowth can win it back. Controls throughout (clean tissue on the identical pile must still eat, digest and draft), and `MYC_ROOT` points it at a pre-fix build for the negative control |
| `mould-check.cjs` | The mould's three owner-requested rules: contact is a DISC (`firstTouchRadius`, floored at the cloud's own reach) so no clean strand is left inside the green, with the old nearest-strand breach reproduced by hand as the control and every seed marked so the creep starts along the whole contact face; a rotten strand survives exactly `rotLifeTurns` (2) steps and leaves a fading ghost the renderer drains; a spent cloud goes on the SAME turn, on the wall clock, with no further world step, taking its trich field with it. `tests/mould-shot.cjs` is the visual companion (a tool — it slows both fades to 4 s so a screenshot can catch them) |
| `tut-check.cjs` | Tutorial: orange pile → draft → "time stops" wording → red-only prompt |
| `rt-test.cjs` | The real-time core: clock, drafts pausing, arrival gating, cadence bars, aim |

**HUD-survival assertions live only in `hover-check`** — that a hovered card and a cadence bar
survive refreshes, that the bar's fill climbs, that it glides on a CSS transition. `rt-test`
used to carry copies, but on its long-running page a draft or an affordability change mid-probe
re-renders the row for legitimate reasons, and the copies reported failures they couldn't
justify. `rt-test` keeps only the structural claims (the old dots are gone, a bar is drawn).
If you add a churn assertion, give it a fresh page and pin resources.

`spread-probe.cjs`, `worm-probe.cjs` and `hop-probe.cjs` aren't checks either — they print
MEASUREMENTS, not PASS/FAIL, and aren't in the runner. Each exists because a number somewhere
was not what the config claimed: what the rot really advances per step (the
`infectionSpreadChance` cap), what share of worms can actually move and why the stuck ones are
stuck, and how often a growth step clears the endpoint test while crossing rock. Re-run the
relevant one after any change to those systems, and read `worm-probe`'s header before trusting
it — its first version reused one colony across every sample and the worms ate it, which
produced a clean-looking table supporting the wrong conclusion.

`shot.cjs`, `hs-shot.cjs`, `lure-shot.cjs`, `core-shot.cjs`, `mould-shot.cjs` and
`level-shots.cjs` aren't checks — they capture frames for eyeballing: the title screen, the
leaderboard, the pointer lure, the whole-world core view, the mould/rot fades, and every authored
map. Every depth and colour decision in the core was
made by looking at `core-shot`'s frame, not by reading a number.

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

### `traced` — pass ids to narrow it

`node tests/traced-check.cjs obsidian slate` runs only the matching maps: ~20 seconds against
~15 minutes for all 59. The runner still sweeps everything, but while iterating on a change
that affects every map equally — world depth, the density metric, a render change — one map
answers the same question and the sweep is pure cost.

Its density assertion measures over the **declared** box (`state.levelDef.world.height`), not
the played one. An authored map's box is sized by the core constants, not by its JSON, so
dividing by the played box put the same rock over a different denominator every time the world
was resized and dropped three maps under the 15% floor for no reason of their own.

### `scale` — the organism scale (`tests/scale-check.cjs`)

`CONFIG.growth.scale` multiplies every world-unit length in `growth` once at module load, and
`NetworkRenderer` scales its drawn thread and fuzz off the same number. Every way of getting
that wrong is a PARTIAL application, and each is quiet: a longer step with the old
`killDistance` overshoots its attractors and orbits a pile; a longer step with the old drawn
width reads as a sparser colony, not a bigger one; a `minTipSpacing` scaled past
`segmentLength` makes the colony reject its own new tips and growth just stops. So the check
asserts the RATIOS (which must hold at any scale value) as well as base × scale, and reads
both ends of the pipe — the engine's measured step and the renderer's stroke width.

Writing it found a real bug. `_growStep` — the basic undirected Grow — tested only its
ENDPOINT with `_placeOk`, never the segment, so any wall thinner than one step could be
hopped. Swept over slate-c40 / obsidian-c55 / side-veined-c28 (every open point on a 9-unit
grid, 16 headings), of the steps the endpoint test accepted **0.17-0.25% crossed rock at the
old 17-unit step and 0.42-0.58% at 25.5** — lengthening the step widened a hole that was
already open. It now goes through `_segmentClear` like every card grow primitive; that samples
by DISTANCE, so a longer step just gets proportionally more samples.

**Verified negative control**: with that one line put back to `_placeOk`, the probe reports 3
wall-crossing strands of 865; with `_segmentClear`, 0 of ~840. The check also counts, on the
map it uses, how many endpoint-legal steps would cross rock (~730) — if that were zero the
map would have no thin walls and the two assertions after it would prove nothing.

One harness note worth keeping: the food is a sparse lattice **re-seeded before every grow**,
not one big pile. A pile the colony reaches is claimed and matted whole, and those mat hyphae
(`colon`) land wherever the pile's cells are — with food everywhere, 6000 nodes came back and
only ~20 of them were space-colonisation steps, so the probe was measuring the wrong rule.

### `threat` — how fast a threat takes you apart (`tests/threat-check.cjs`)

Four rates, each set in TWO places (the CONFIG literal and `MODE_TUNING`'s per-mode table),
read through a deep clone, and — for the worm's bite — consumed by code that had the count
hard-coded. So each is driven through the real sim and measured, not read back out of the
table it was written to. **Both modes, always**: RT rates are per 500 ms tick and turn-based
rates are per player action, so a change applied to one table only doesn't make the creature
faster, it makes one of the two games harder, and that is invisible from inside either mode.

Placing a creature to measure its step has three traps, all of which report a SHORT step
rather than failing, and all of which cost a debug cycle here:

- `moveWorm`/`moveCloud` bound themselves at `surfaceY + one cell`, and the colony's ROOT node
  sits at `surfaceY + 6`. A creature level with the root has every step rejected as
  out-of-bounds and never moves — a measured speed of exactly zero.
- Both movers CLAMP the step to the remaining distance, so a creature nearer than one step
  measures the gap instead of the speed.
- When the straight step is blocked, both SLIDE along one axis instead — a shorter move that
  still returns true (this read 3.7 cells against a 6-cell step).

`window.__stepSpot(step)` in the check searches for a spot that is in bounds, beyond one step,
with clear line of sight to its nearest strand (or the creature never targets it) and with the
whole first step provably clear against the same coarse `cell.rock` mask the movers use.

The bite has the mirror-image trap: `nematodes.reach` is 0.7 cells (25 units) against a
25.5-unit growth segment, so a worm dropped on a random strand often has only a neighbour or
two that close — and the probe would then measure REACH and pass at whatever the local density
happened to be, quietly, and more wrongly the bigger the bite gets. So it sits the worm on the
densest node on the map and asserts the density (`strands in reach > bite`) separately.

**`nematodes.wanderSpeed` is deliberately not asserted.** It is set in three places and read
by no code — asserting a value would imply it does something. See CLAUDE.md.

**The two rot rates are measured on a LINEAR 160-strand chain, not the branching colony.** A
"ring" is one step along the filaments *in every direction at once*, so on a branching network
N rings claims far more than N strands (measured: 40 rings → 611 strands) and a count says
nothing about the rate. On a single chain rings and strands are 1:1, so `firstTouchRings` and
`spreadDepthPerTurn` can actually be compared — and the assertion that matters is the
ISOLATION: a breach costs 20 + the strand it touched (21), and the step *after* costs exactly
40. Additive, which is what the old `contactChunk` did, would read ~61 on the breach step.

**`infectionSpreadChance` is kept as a live negative control**, not a comment. Any value below 1
caps the advance at a geometric ~1/(1−p) rings *regardless of the depth*, because a failed roll
drops that node from the frontier and kills the branch for the rest of the call. The check
measures both: at 1 the advance is exactly the configured rate every time; at 0.85 it collapses
to min 0 / median ~4 / max 16. That single number is why the rate was raised 6 → 18 → 40 across
two sessions with almost no effect, so it is worth failing over.

**Threats that actually work break probe isolation.** Once worms could reach the colony (see
CLAUDE.md on `wanderSpeed`), the shared page's colony was being EATEN by leftover worms from
earlier probes — the branching-colony rot probe came back with 95 strands instead of ~600 and
its rate could not be measured. It runs on a fresh page now. The chain-based probes build their
own network and are immune; anything that grows a real colony is not.

**Every tick-driven probe must clear `state.runOver`.** Now that rot EXPIRES, a probe can rot a
colony to nothing, which ends the run — and `tickWorld` early-returns on `runOver`, so every
later probe silently measures ZERO. Four assertions failed this way at once ("0 rotten after the
breach, wanted 21"), and one of them had a partner that passed VACUOUSLY on the same data.

**Clearing `infected` means clearing `rotAge` too**, the same rule `cureRadius` follows in the
game. An earlier probe's cloud leaves survivors part-way through their deadline, and a strand
re-seeded on top of `rotAge` 2 expires on its very first tick — which read as "1 → 0 infected,
rate 16.5 rings".

**Two probes seed the rot at a TIP, never the root**, and this matters now that everything
downstream of an infected strand is claimed at once. A root seed claims the entire colony
through the invariant and measures nothing about the rate — the first version of these
assertions reported "min 0, median 0, max 399" for exactly that reason, made worse because a
trial that rots the whole chain leaves `net.alive` false and `infectNetwork` skips a dead
network, so every trial after the first silently measured zero. The chain builder revives the
colony between trials.

Same shape of trap in the worm's move-AND-eat probe: "out of reach" has to mean out of reach of
the NEAREST STRAND, not of the target node. A spot two cells from the densest node still has
some other strand inside the 0.7-cell reach in a 400-strand colony, and the worm then feeds
without moving — which passed the eat assertion while proving nothing about the move.

The last assertion is a pacing one rather than a rate: `render.infectCreepMs` is the
renderer's ms-per-ring, and if the sim outruns it the green falls behind until
`infectMaxLagMs` clamps it and then jumps a chunk — the exact popping the creep exists to
remove. Each rise in the spread has meant retuning the creep (300 → 100 → 50 ms), and this
assertion is what keeps the two tied together instead of drifting apart silently.

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

### The perf tools are not checks either — they print, they never fail

Three of them, and they answer different questions. All three PIN THE MAP SEED (freezing
`Date.now` over the boot), because `startRun()` seeds the world from the clock and an unpinned
run compares maps rather than builds — the frame median swung 91 to 999 ms on identical code
before that was noticed.

- **`node tests/perf-probe.cjs [strands] [w] [h]`** — a STILL camera. Times `renderFrame` and
  `tickWorld` separately, censuses one frame's `drawImage` calls by call site, and aggregates a
  CDP profile by SELF time. `PERF_WORMS=60` adds a late-game threat load, which is the only way
  to see the enemy-step hitch.
- **`node tests/perf-scenes.cjs [w] [h] [dpr]`** — a MOVING camera: still / pan / zoom-tween /
  grow-revealing at both zoom extremes, plus the card carousel, and it counts **canvases
  minted**, which is how you tell a cache from an allocator. `PERF_CENSUS=1` adds the by-call-
  site pixel breakdown for one PANNING frame — that is what found `drawMountains` asking for
  33.3 of a frame's 53.9 Mpx of destination. It patches the context PROTOTYPE, so it sees
  draws into offscreen buffers too, which is where that worst call turned out to be.
- **`node tests/perf-shot.cjs out.png`** — one deterministic frame, captured with the canvas's
  own `toDataURL` rather than `page.screenshot`, which waits for animations to settle and
  against a live rAF loop at ~520 ms a frame never returns.

Two things to know before believing a number from any of them. **Run it three times** — a
single run reported a 4% improvement that three runs showed was noise in both directions. And
**headless is a SOFTWARE rasteriser**: fill-rate work shows up as pixels, not milliseconds.
Halving a frame's destination pixels changed the wall clock by nothing here, on a change whose
whole point is the resource a phone is short of. Quote the pixel counts, which are
hardware-independent, and say which of the rest is software raster.

### `fringe-score.py` is not a check, but read it like one

`python3 scripts/fringe-score.py` measures the pale ring on every traced level's sprites,
theme-relative (each sprite against itself, so pale `glacier` is not judged against near-black
`obsidian`). It is the number behind "the rocks have a halo", which was reported by eye twice
before anything measured it. Median across the 58 levels is -0.1 with 47 under +10; if a
re-trace pushes that above +10, `--trim` is the first thing to look at.
