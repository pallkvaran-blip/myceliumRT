# The Deep Mine: the finishing plan

Synthesized on `claude/deep-mine-finish` from three independent designs (retention, craft, economy) scored by two judges (player-experience and tech lead). The raw proposals and scores are in `phase2-design.json`; the playtest and code-map evidence is in `phase1-findings.json`.


## Pitch

THE DEEP MINE. You grow a glowing fungal colony through a rock maze on one tank of water, and every dig costs more the deeper it starts: 2 water, then 4 / 8 / 16 past 42 / 84 / 126 m. Somewhere to the east and below lies the root of a green island. Reach it and the colony takes root there and the next, harder world begins; there are eight islands between you and the Promised Land. When the tank runs dry the colony spores and pays for every metre it reached and every seam it dug. You buy one thing that makes the next run visibly better: a bigger tank, a longer dig, a tool that ends a threat outright, or a compass that points through rock.

LOOP IN ONE LINE: dig down and east until dry -> the colony spores and pays for every metre -> buy one thing -> descend again and get farther.


## Core loop

FIVE SYSTEMS, EACH DEEP, AND NOTHING ELSE
1. The dig and its water price (the heat staircase).
2. The maze, with every reward off the route.
3. Two threats, each with one bought counter that fully answers it.
4. The journey: eight fixed legs, each ending at an island's root.
5. The store: power, kit and knowledge (compasses).
Every wrapper (reach payout, records, fossil, Daily Dig, New Journey) reuses these five and adds no rule of its own. There are no cards, no drafting and no per-run picks.

A DIG (1.5-2 s at a human pace)
- Press any living strand and drag. The arrow shows the reach (153 world units at grow 2, 459 at grow 6) and, at its head, the price where you pressed (2/4/8/16).
- Release: the strands reveal over about a second with the grow sound, and the tank drops by that price.
- A tap on a strand digs straight down from it.
- Every seam or pocket the new tissue claims pays on the spot, with a floater and a sound at the site. Every 5 m of new depth pops '+1 P' at the tip.
- Each dig is a routing decision: which strand, which corridor, and whether a seam (+3 P, or +2/+6 of a deep material) or a pocket (+10 water, once) is worth the detour. You also route to stay out of the green sensing washes.

A RUN
Length: run 1 is 30-35 digs (45-65 s); legs 3-5 are 60-80 digs (1.5-2.5 min); legs 6-8 are 80-110 digs (2.5-4 min).
- It opens with the leg banner ('LEG 3 · DRY GROUND · no water pockets above 42 m'). On a leg's first run a 5 s chevron at the east edge reads 'Island 3 is east'.
- You dig down from the west hill. On leg 1 the shallow galleries carry you east.
- From leg 2 the shallow road breaks: most of its gallery seams are sealed. The cheap way east runs through 42-84 m (84-126 m from leg 7), where the worms, mould, heat and deep materials are.
- The goal is the island's TAPROOT: a glowing knot in a chamber beneath the green island hill. It is deeper on every leg: 24 m on leg 1, 140 m on leg 8.
- On the way you detour for seams and pockets, flask the worms that latch on, cut out the rot before its clock ends, and spend a vial on the one wall worth eating.
- The run ends when you reach the taproot (ROOTED: a bonus and the next leg), or when:
  - the tank cannot pay where you are working (FRUIT NOW, automatic after 6 s),
  - the rot clock runs out,
  - the node cap is reached, or
  - you end it from the menu.
- Every ending pays in full.

BETWEEN RUNS (1-2 taps)
The end screen counts the payout up by source, names one next goal with an inline Buy, and offers [Descend] as the primary button. The full store is one tap away.

A SESSION (5-15 min, 3-8 runs)
- In runs 1-10 almost every store visit buys something.
- Every session holds a 'first': a new band, a new threat and its tile, a new store tile, a leg's rule, an island in sight, or a landfall.
- It ends on a named near goal ('Island 4: your farthest is 26 m short', 'Grow strength IV: 24 Garnet, you have 9, found at 84-126 m').

THE JOURNEY (Journey I: 8 legs, 35-50 runs, 70-110 min)
- Each leg is one fixed world, so a retry is mastery.
- Your best depth and farthest east are dashed lines in the world, and your last attempt's colony shows as a dim fossil.
- The first island falls on run 3-5.
- The Promised Land ends Journey I with a finale and credits.

THE LONG TAIL
- The Daily Dig: a shared seed, a fixed kit, one paid run a day, deepest wins.
- New Journeys II-VIII: new seeds, one stacking rule each, and the store is kept.
- Strains (strand colours) as the P sink after the ending.
- Per-leg records.


## The journey

STRUCTURE
- A journey is 8 legs. A leg is one 504 x 168 world of 21 chunks, each 24 columns (unchanged).
- The hill is at chunk 1 (root column 36, the WEST). The island is at chunk 1+E (the EAST): 12 columns of green surface drawn with the existing goalhill/goalbush/tree art. drawMineHill/mineHillSpan (40096-40113) take a list of hills.
- On leg 2+ the west hill is the previous island (same art).
- Beneath the island hangs its TAPROOT:
  - a canvas-drawn, pulsing mint knot in a carved chamber of radius 2.5 cells, at (hill + east metres, depth metres);
  - a few short filaments hang from the island hill and fade out within about 6 m, so the island reads as rooted without giving away the depth.
- LANDFALL: any clean strand within 1.5 cells (54 units) of the knot's centre.
  - The run ends that frame with cause 'island'.
  - The filaments light up from the taproot to the island hill, which fruits (startCelebration 33442 with an 'island' side, via hillRiseAtX 33429).
  - The colony resurfaces and spores on the island in the celebration, never by a priced climb.
  - The next Descend starts leg N+1 from that island.
- Failing leaves you on the same leg, with the same world.

SEEDS
- Journey I uses 8 curated seeds (CONFIG.mine.journey.legs[n].seed, i.e. seeded by journey and leg index).
- tests/bots/legprobe.cjs picks each one offline from 50 candidates. The seed must pass all three tests:
  - the fine-mask flood from the home head reaches the taproot;
  - the shortest path is 1.3-2.0x the straight line;
  - the cheapest-water route meets the leg's depth share.
- Journeys II-IV get their own curated tables; V+ cycle them. A seed is identical for every player and every retry.

TWO LAYOUTS
- 'journey' is the legs (#leg,<j>,<l> for tools).
- 'free' is today's centre-hill descent, byte-identical. It serves #mine,<seed>, the Daily Dig and the 190 existing mine-check pins.

GOING RIGHT MEANS GOING DOWN (journey layout only)
Measured: rock sprites are refused above surfaceY + 0.5 cell (22219, 22260). The top of row 0 is therefore 5-7% solid, and a colony crawls 168 m east for 82 water at 0-5 m. With that crust open, a surface goal would never require going down. Three changes fix it:
(a) THE CRUST CLOSES. In journey worlds a sprite may reach the surface (the clamp becomes surfaceY + 0.05 cell; drawLevelRocks already clips at the surface).
(b) THE SHALLOW ROAD BREAKS. The existing gallery seal draw (21703, rng() < sealCh, drawn unconditionally) compares against a per-band chance from the leg row (sealByBand) instead of the single 0.12.
  - A sealed seam is the rock the maze already uses. No row is reserved, forced open or painted.
  - Where a shallow crossing survives, it is a shortcut a returning player learns.
(c) ONLY THE ISLAND CHUNK gets new carving:
  - the taproot chamber;
  - the flood-and-repair generalized from 21995-22064: flood from the chamber, and if no gallery cell on either seam is reached, open the shortest radius-1.7 connectors;
  - all on its own hash rng, mineChunkRng(seed ^ 0x7A9, ci), after every existing draw.
All three are journey-only, and the free layout's chunk stats are asserted byte-identical.

LEG TABLE (CONFIG.mine.journey.legs; M14 calibrates E and the depths)
Columns: leg | name | E (chunks) / taproot east | taproot depth | crossing band (sealByBand for 0-42 / 42-84 / 84-126 m) | the leg's one rule | island bonus | expected kit on arrival | target runs
| 1 | First Light | 4 / 96 m | 24 m | 0-42 m (0.12 / 0.12 / 0.12) | none: threat-free | 20 | Water 1-2, Grow 1-2 | 2-4 |
| 2 | The Coal Road | 6 / 144 m | 58 m | 42-84 m (0.55 / 0.12 / 0.12) | worms from 42 m, as standard | 30 | Water 3, Grow 2, Heat 1, Flask 1 | 3-6 |
| 3 | Dry Ground | 8 / 192 m | 72 m | 42-84 m (0.70 / 0.12 / 0.12) | no water pockets above 42 m | 40 | Water 4, Grow 3, Heat 2 | 3-6 |
| 4 | Mould Country | 9 / 216 m | 92 m | 42-84 m (0.70 / 0.12 / 0.12) | mould also at 42-84 m (1 cloud per chunk) | 50 | Water 5, Grow 3, Heat 3, Enzyme 1 | 3-6 |
| 5 | Rich Veins | 11 / 264 m | 104 m | 42-84 m (0.75 / 0.20 / 0.12) | 1 deep seam in 2 is rich | 60 | Water 6, Grow 4, Heat 4 | 3-6 |
| 6 | Hot Rock | 10 / 240 m | 112 m | 42-84 m (0.75 / 0.20 / 0.12) | price lines 6 m shallower (safeDepth 36) | 70 | Water 6, Grow 4, Heat 4, Enzyme 2 | 3-6 |
| 7 | The Swarm | 13 / 312 m | 126 m | 84-126 m (0.75 / 0.60 / 0.12) | worms x2 below 42 m | 85 | Water 7, Flask 2-3, Enzyme 2 | 4-7 |
| 8 | The Promised Land | 15 / 360 m (island chunk 16) | 140 m | 84-126 m (0.75 / 0.65 / 0.12) | +1 worm and +1 cloud per chunk below 84 m; a double-width island | 150 | the full kit | 4-7 |

ESCALATION RULES
- Band 0 (0-42 m) is threat-free on every leg, and nothing respawns.
- Rules are overrides on the cfg clone in configForLevel (32461-32493) and use existing knobs only: threatBands, reservoirsPerBand (made per band), richChance, heat.safeDepth and gallerySealChance (made per band).
- mineBeat, mineZoom and mineClampZoom read state.config (37244-37251, 37143, 37161).

CALIBRATION RULE
- With the expected arrival kit, the navigator must reach the taproot on at most 70% of supply (start water + half the route's pockets).
- With the bare kit it must need more than 100% (legs 3-8).
- A leg that takes more than 7 runs at the median gets its island pulled in one chunk. A leg under 3 runs gets it pushed out one chunk.

RECORDS PER LEG
- Best depth is a dashed horizontal line and farthest east a dashed vertical line, each labelled at the screen edge. Crossing either fires a one-shot NEW DEEPEST / NEW FARTHEST beat.
- The last failed attempt's colony shows as a dim fossil (M13).
- The title and end screen name the gap ('Island 4: your farthest is 26 m short').

THE ENDING
Landing on leg 8 plays, in order:
1. ROOTED.
2. The camera pulls back over the double-width island.
3. A canvas journey strip, on which all 8 islands burst spores 300 ms apart over a rising chord.
4. 'The Promised Land. Your colony spans the world.'
5. Credits (showCredits).
The title then gets a 'Journey I' badge, the Gold strain unlocks, and 'Begin Journey II' appears. Everything is banked before anything animates.

AFTER
New Journey J keeps the store and adds one stacking rule:
- II Hotter: price lines 10 m shallower.
- III Thirsty: start water -12.
- IV Hungry: worms x2, 0.3 water/s each.
- V Rotten: mould from 42 m, rot clock 15 s.
- VI Stingy: pockets +7.
- VII Far: every island +2 chunks, capped at chunk 19.
- VIII+: all of them.
Each completion unlocks a strain and records 'fewest runs to the Promised Land'. The Daily Dig runs alongside from the first landfall.


## Economy

CURRENCIES
- Phosphorus (P, p.minerals) is the general currency. Anthracite (42-84 m), Garnet (84-126 m) and Hematite (126-168 m) are held in p.mats. Whole numbers everywhere.
- The rule of the shelf: the first rungs of every track cost P. A power rung past its first two costs the material from the depth it opens, and its tile says where that material is found.

SOURCES (all banked by mineBank in presentMineEnd 33215, on every ending)
1. REACH (new, CONFIG.mine.reach):
   - 1 P per 5 m of the run's deepest clean depth, plus 1 P per 10 m of its farthest east of the hill (journey legs only). Never less than 5 P.
   - Both are running maxima kept in mineFrame, so rot never erases progress.
   - Depth: 42 m = 8, 84 m = 16, 126 m = 25, 168 m = 33. East: 96 m = 9, 192 m = 19, 360 m = 36.
   - It shows live in the HUD P count, with a '+1 P' pop at the tip.
   - Depth pays double per metre because depth is where the heat, the threats and the materials are.
2. PHOSPHORUS SEAMS: 3 P each, 0-42 m only, 2 per chunk (unchanged).
3. DEEP SEAMS: 2 of their band's material and no P (the recorded rule). 1 in 4 is RICH, pays 6 and is drawn 1.3x larger. Richness is a hash of seed, chunk and spot index, outside the chunk rng. Leg 5 makes it 1 in 2.
4. ISLAND BONUS, on the first landfall of each leg: 20 / 30 / 40 / 50 / 60 / 70 / 85 / 150.
5. DAILY DIG: its one paid run a day pays seams + half the reach, so it is never the best farm.
WATER is fuel, not money: start 60 (+12 a rung); pockets give +10 once each, 1 per band per chunk.

THE SHELF
36 rungs, one currency per rung, so costParts (14313) and buyUpgrade (14323) are unchanged. When each track is revealed is in brackets.
- WATER TANK, +12 start water (60 -> 156): 5 P, 12 P, 25 P, 45 P, 80 P, 30 Anthracite, 24 Garnet, 16 Hematite. [visit 1]
- GROW STRENGTH, +1 step (2 -> 6; reach 153 -> 459 units): 12 P, 35 P, 20 Anthracite, 24 Garnet. [visit 1]
- HEAT TOLERANCE, first price line 14 m deeper a rung (42 -> 98 m; the lines end at 98 / 140, so x4 and x8 always exist): 15 P, 14 Anthracite, 24 Anthracite, 20 Garnet. [first strand past 42 m]
- MUCUS FLASKS, carry 1 / 2 / 3: 10 P, 40 P, 14 Anthracite. [first worm attach, or leg 2]
- CUTTING ENZYME, carry 1 / 2 / 3: 15 P, 50 P, 14 Garnet. [first cloud on screen, or leg 4]
- OXALIC VIAL, carry 1 / 2 / 3: 50 P, 12 Garnet, 12 Hematite. [leg 3]
- ISLAND COMPASS: bearing 12 P; + distance 40 P. [visit 2 on a journey save]
- ANTHRACITE COMPASS: bearing 20 P; + distance 60 P; richest within 90 m 12 Anthracite. [first anthracite seam]
- GARNET COMPASS: 40 P; 100 P; 12 Garnet. [first garnet seam]
- HEMATITE COMPASS: 60 P; 140 P; 12 Hematite. [first hematite seam]
- STRAINS (cosmetic strand tints), only after the Promised Land: Amber 150, Violet 250, Ghost 400, Coal 600 P, plus one unique strain per completed journey.
TOTALS: 866 P + 114 Anthracite + 106 Garnet + 40 Hematite. The old shelf was 3,237 P + 18 / 31 / 13.

WHERE EACH MATERIAL GOES
- Anthracite (legs 2-6 cross its band): Water VI, Grow III, Heat II-III, Flask III, the Anthracite compass III.
- Garnet (legs 7-8 cross its band, the leg 4-6 taproots sit in it, and dives reach it): Water VII, Grow IV, Heat IV, Enzyme III, Vial II, the Garnet compass III.
- Hematite (taproot dives on legs 7-8, and deliberate dives): Water VIII, Vial III, the Hematite compass III. These are the last rungs of the journey.

CUT, WITH AN EXACT REFUND
- Ore yield (the dominant buy, and it silently multiplied deep materials by 4) and Water pockets (the weakest value on the shelf) are cut.
- migrateProgress (13719), flag migratedMineShelfV2:
  - refund every mine rung ever bought, at its OLD price, into p.minerals and p.mats;
  - clear p.mineUpgrades, in the same save;
  - toast 'The store was restocked — your Phosphorus is back'.
- Heat tolerance's 25 m step becomes 14 m, over 4 rungs. The old 6 x 25 m deleted heat from the shaft.

PAYOUT PER RUN (model median, excluding island bonuses)
| stage | P per run | materials per run |
|---|---|---|
| Run 1 | 12-13 | - |
| Leg 1 | 17 | - |
| Leg 2 | 18 | +4 A |
| Leg 3 | 30 | +12 A |
| Leg 4 | 34 | +15 A |
| Leg 5 | 40 | +22 A |
| Leg 6 | 43 | +24 A |
| Leg 7 | 45 | +15 G |
| Leg 8 | 53 | +19 G |
Dives, about a quarter of runs on legs 3-7, pay 25-40 P plus 12-18 of the target material.

PACE
- Run 1 always buys Water I: the minimum payout is 5, and so is its price.
- Runs 1-10: 1.3-1.5 purchases a visit, with at most 1 visit that buys nothing.
- Legs 3-4: 1.5-1.8 purchases a visit.
- Legs 5-7: 0.2-1.0 a visit (material rungs, dives).
- Leg 8: the last 1-3 rungs; the final runs are pure journey.

WHEN THE STORE RUNS OUT
- P rungs are exhausted by legs 5-6. Material rungs last through leg 8.
- The model has 97% of rungs bought at the final landfall, with the last Hematite rungs 1-3 runs before it.
- Surplus P (about 600 in the model) and New Journey income fund the strains. After that, P is a lifetime stat by design.


## How a run ends

HOW EVERY RUN ENDS
Every ending goes mineEndRun(state, cause) (22714) -> presentRunOver -> presentMineEnd (33215) -> mineBank(r), which is idempotent. All endings are died:false and all pay IN FULL: reach + seams + materials + any island bonus. The depth paid and recorded is state.mineMaxDepth, the running maximum of clean depth kept in mineFrame. An infected ending no longer shows 99 m after reaching 107.

THE CAUSES
1. 'dry', with two triggers.
   (a) As today: water below the cheapest dig anywhere (mineCheapestCost 22686) for OUT_OF_FUEL_GRACE_MS (1.6 s). A pocket the last dig is about to reach still pays first.
   (b) THE SOFT-LOCK FIX (mineStuckCheck, beside mineFuelCheck 22703): water is below costHere, the price at the focus strand (mineDigCost 22678 at state._mineFocus, else the deepest clean tip). That is the number the chip shows.
   - A 6 s countdown (CONFIG.mine.stuckFruitMs) runs only while no menu is open and no pointer is held. A reveal in flight holds it for at most CONFIG.mine.stuckRevealHoldMs (800 ms) per stuck spell, so dead time is bounded at 6.8 s from the tank change (amended in the M1 verifier round; the uncapped hold measured 8.6-9.8 s).
   - Any successful dig, and any water gained, resets it.
   - At zero the run ends.
   Copy: 'Out of water at 92 m. The colony fruits and spores.'
2. 'fruit'. Whenever water < costHere, the price chip hides and the FRUIT NOW pill shows ('FRUIT NOW · +23 P', the bankable total, with the countdown as a conic ring) in its own fixed slot, bottom centre and 44 px tall. In the resource row it overflowed 390 px as soon as a worm chip showed. One tap ends the run.
   Copy: 'You called it at 92 m. Every spore is yours.'
   A refused dig toasts 'Not enough water — a dig here costs 8. Fruit now to bank +23 P.'
3. 'infected'. The rot clock (20 s; 30 s on a save's first infection) reaches zero. The whole colony turns green, fruits and pays.
   Copy: 'The rot took the colony at 92 m. What it spored is yours.'
4. 'abandon'. Settings > 'End descent (banks everything)' replaces 'End run', and forceFruitAbandon (33063) is routed through mineEndRun in the mine.
   Copy: 'You ended the descent at 92 m. Everything dug is banked.'
5. 'quit'. Settings > 'Exit to title (banks everything)' replaces 'Save & exit', which deleted the haul (onSaveExit 35976). It banks through mineBank and shows the title with the toast '+23 P banked'. 'Replay tutorial' is hidden in the mine, because it restarted the run.
6. 'island'. Landfall on the taproot. The wordmark is ROOTED and the island bonus is added.
   Copy: 'Your colony took root on Island 2. Leg 3, Dry Ground, starts there.'
7. 'promised'. Landfall on leg 8: the finale.
8. 'full'. The node cap is reached (mine maxNodes 9000 in configForLevel, instead of the shared 6000 at 2718). The run ends instead of refusing every dig as 'Solid rock'.
   Copy: 'The colony fills every passage it can reach, and fruits.'

CLOSING THE TAB NEVER LOSES A HAUL
On visibilitychange -> hidden and on pagehide, the would-be payout is written to p.minePending. Coming back to the tab clears it. The next boot banks a leftover once, and the title says 'Your last descent spored +23 P'.

WHY THIS SOFT-LOCK RULE
- mineFuelCheck asks whether the SHALLOWEST strand is affordable (always 2), while the working front costs 4-16.
- That left 14 of 39 bot runs and 5 of 12 playtest runs live and idle for 30-60 s.
- The fix keeps the recovery play the old rule was written for: a cheap dig resets the countdown and moves the focus.
- It bounds dead time at 6 s, and the pill makes the ending one obvious tap that says what it banks.

INFECTION
- One clock per colony, derived from 'is anything infected' (mineInfectionCheck 22582). It stops only when every infected strand is gone.
- Infected strands cannot be grown from.
- A top banner reads 'ROT 14 s — tap the enzyme, then the rot', or 'ROT 14 s — the colony will fruit' with an empty bag.
- Full payout: this is the interlock with the bought enzyme.


## Threats and counters

WORMS (42 m and below)
Placement: per chunk from threatBands, 1 per chunk at 42-84 and 84-126 m and 2 at 126-168 m, times the leg rule. Nothing respawns. Sight is 300 units.
- An attached worm drains 0.2 water/s (1 every 5 s, through mineDrainDebt, so the tank stays whole).
- It breeds at 5%/s while feeding, but only while fewer than 6 worms are attached. This lives in the stepNematodes mine branch (17598-17760). The world cap of 16, which silently stopped breeding once 4 chunks existed, is raised to a safety bound of 64.
- Unanswered, it costs about 3 worms and about 20 water by 40 s, and at the cap 6 worms drain 1.2 water/s. That is a real but recoverable pressure.
- READABLE:
  - Attached worms are drawn at 2.5x with a 1 Hz pulsing ring on the host strand (drawNematodes 40150).
  - An off-screen attached worm gets a worm-coloured chevron at the screen edge.
  - The HUD chip reads '3 · -0.6/s', and tapping it pans to the nearest attached worm.
  - The first attach shows a one-time tip.
  - The green flat sensing wash is unchanged. The attach ring is a separate mark.

MUCUS FLASK (bought, carry 1-3, restocked every descent)
- One tap kills every worm attached to, or within 160 units of, any clean strand. Mine-only overrides on the cfg clone: nematodes.killHits 3 -> 1, actions.excrete.range 80 -> 160.
- The drain reads 0/s on the next tick.
- A burst with no worm in range costs nothing.
- Copy: 'Mucus burst — 3 worms killed.'
- DECISIVE: the threat is a visible rate, one tap sets it to zero, and nothing respawns. The decision is timing: throw now and kill one, or later and kill the brood.

MOULD (84 m and below; also 42-84 m on Mould Country)
One cloud per chunk. The flat green wash is unchanged.
- Mine-only overrides sit beside the campaign machinery (CONFIG.mine.trych onto cfg.trichoderma, 32476-32478):
  - moveSpeed 2.5 -> 0.5 cells a tick. A cloud that senses you at the edge of its ring needs at least 6 s to arrive; today it lunges in 1.6 s.
  - firstTouchRings 12 -> 6, so a breach is about 10-25 strands, not 41-55.
- Clouds still eat the seams they see, so a race for a garnet seam stays in the game.
- Contact starts ONE colony clock: 20 s, or 30 s on a save's first infection. Two breaches need two cures.
- Rot creep is left as tuned.

CUTTING ENZYME (bought, carry 1-3)
- Arm it, then TAP (or drag) near the rot.
- In the mine, mineUseAmputate (22563) removes:
  - the whole connected infected component nearest the tap, within 300 units, found by walking parent/child links between infected nodes;
  - plus the clean nodes within one segment of it.
  It works through net._removeNodes (16943) and clears the cloud cells there.
- Orphaned clean tissue keeps living.
- With no rot within 300 units it refuses and the dose is kept.
- One dose cures one breach, however far it has spread. Today one dose left 12 of 55 strands rotten, and three doses cost 32% of the colony.
- Copy: 'Cut out 14 rotten strands — the colony is clean.'
- DECISIVE: the clock is on screen and one aimed tap stops it.

OXALIC VIAL (the owner-sanctioned rock-through consumable; bought, carry 1-3, from leg 3)
- Tap the vial: the aim arrow turns acid-yellow and outlines the rock it would cross.
- The next dig may pass through up to 108 units (3 cells) of rock and must come out in open ground. growDirected gets a rockBudget option, honoured only when sub.mine is set and a vial is armed.
- It is pre-checked by sampling solidAtWorld along the aim before anything is charged. If the rock is too thick, the toast reads 'Too thick for the acid' and the vial and water are kept.
- The collision mask is NOT edited. The tunnel strands are flagged n.acid and drawn amber over the rock with an etched halo. Rock stays a wall for everything else.
- Uses:
  - the walled-in seams and pockets the generator already leaves as bait (2 of 24 seams and 1 of 12 pockets are stranded);
  - one wall on the way east.

HEAT (passive; priced, never enforced)
- 2 / 4 / 8 / 16 water past 42 / 84 / 126 m, priced at the pressed strand.
- The 8x bypass is closed: a dig can only fall through to a tip within 90 units on the same price step.
- Tolerance is 4 x 14 m, so the lines sit at 98 / 140 m at most, and 4 and 8 always exist below them.
- The chip always quotes the price, the aim arrow repeats it at its head, and the band beat says 'Digs now cost 4'.


## Onboarding

PRINCIPLE
Teach by doing, in the world, once. There are no modals, because the owner's data showed campaign onboarding polish did nothing. Every tip is one non-blocking line in #minehint or on the map, fires once per save (p.mineTips), and is logged as a 'tutorial' telemetry event with its id and time, so the funnel is measured rather than assumed.

THE FIRST 5 MINUTES

0:00 — The load gate reads 'Tap to dig' on a coarse pointer, 'Click to dig' otherwise (showLoading 31873). The tap starts audio.
- A FIRST VISIT (no p.mineBest, no runs) SKIPS THE TITLE: the tap goes straight into Leg 1, run 1 (enterGame 40423 -> beginMineRun), with no DIG word animation.
- The curtain lifts within 600 ms and input goes live on the reveal. Target: 2.5 s or less from the tap to the first accepted dig (6.9 s today).

0:01 — The root pulses under the hill.
- A canvas GHOST FINGER (a 14 px mint dot with a trailing arrow) slides 110 px down the most open ray from the root, every 1.6 s.
- #minehint, the mine's own element (the .hint rules at CSS 693/1011/1059 cannot hide it), sits top centre under the HUD: 'Drag down from the colony to dig'.
- A tap on the colony also digs straight down.
- Nothing else is on screen: no kit, and no second HUD row.

0:03 — Dig 1: the grow sound, and water 60 -> 58 with a '-2' tick.
- The hint becomes 'Every dig costs water — the deeper, the more' for 3 s.
- The ghost leaves. On runs 1-2 it comes back after 6 s without a dig.

0:05-0:15 — '+1 P' pops at the tip every 5 m of depth, with a soft tick, and the HUD P count rises. Depth pays.

0:10-0:25 — The first Phosphorus seam on screen gets a soft pulsing ring and 'Phosphorus — grow into it'. When it pays: a '+3 P' floater at the seam and a ping.

0:20-0:35 — The first pocket on screen gets 'Water pocket — touch it for +10'. When tapped: '+10 water', a glug, and the pocket art drains, so a spent pocket reads as spent.

About 0:35 — 6 m above the line, a label sits on it: 'Past 42 m every dig costs 4'.
- On crossing, the beat reads '42 m · ANTHRACITE' with the second line 'Digs now cost 4'.
- The soil turns black and the price chip pulses.

DEAD-END NUDGE (runs 1-5) — Two digs in a row that each add fewer than 2 new cells make the two tips with the most open ground ahead glow for 4 s, and the hint reads 'Dead end — dig from a glowing tip'. This is what fixes the naive always-dig-from-the-bottom player (median 28 m today).

0:45-1:00 — At 3 digs left or fewer the water chip turns amber and reads '3 left'. When the price here beats the tank, the chip becomes 'FRUIT NOW · +11 P' with its 6 s ring. The run ends on SPORED.

About 1:00 — The end screen:
- 'Your first descent';
- rows counting up: 'Depth 52 m +10', 'Phosphorus seams x2 +6';
- the next-goal card 'Water tank: start with 12 more water · 5 P [Buy]';
- [Descend].
Buying is one tap, and so is descending.

Run 2 (about 1:10) — The leg banner 'LEG 1 · FIRST LIGHT' and a 5 s east-edge chevron: 'Island 1 is east — its root lies under the green hill'. The first sight of the island hill brings 'Reach the island's root to move on'.

Runs 2-4 — Grow strength I (12 P).
- Landfall on island 1 comes on run 3 at the model median, about 4-5 minutes in.
- It brings the ROOTED celebration, +20 P, and 'Leg 2: The Coal Road' lighting up on the journey strip.
- The store gains a NEW tile, the Island compass.

Leg 2 — The first worm to attach brings 'A worm is drinking your water. Mucus flasks kill worms — in the store.', and the flask tile shows NEW.

Leg 4, or a deep dive — The first cloud on screen brings 'Mould: one touch starts a 30 s rot clock'. The first infection gets the 30 s clock and 'Rot! Arm the enzyme and tap the rot.' The enzyme tile shows NEW.

PROGRESSIVE STORE REVEAL
upgradeInGame (14249) reads p.mineSeen, and the shelf and the buy path share that one predicate.
- Visit 1: exactly two tiles, Water tank (5 P, highlighted) and Grow strength (12 P).
- + Heat tolerance: a strand first passes 42 m.
- + Mucus flasks: the first worm attaches, or leg 2 begins.
- + Island compass: store visit 2 on a journey save.
- + Cutting enzyme: the first cloud comes on screen, or leg 4 begins.
- + Each material compass: that material's first seam.
- + Oxalic vial: leg 3 begins.
- + Strains: only after the Promised Land.
A newly revealed tile carries a NEW badge for one visit and is the next-goal card's first pick. At most 5 tiles show before run 5.
- AS BUILT (M5 verifier fix): "visit 1" is the store after run 1 (a fresh save cannot reach one earlier), and run 1 crosses 42 m on nearly every seed, so the event-gated tracks wait for the second descent banked (p.mineRuns >= 2). What run 1 met appears NEW after run 2. An unbought Water tank is the card's pick until Water I is bought, ahead of any new tile.

NEXT-GOAL PRIORITY (the end-screen card)
new tile > grow > water > heat (if the leg's route runs past the line) > flask (if worms were met) > enzyme (if rot was met) > island compass > the compass for a material the next power rung needs > vial.
- If nothing is affordable, the card shows the nearest rung: '6 P short', or 'Grow strength IV: 24 Garnet, you have 9 (found at 84-126 m)'.
- If the store is done, it shows the leg gap: 'Island 5: your farthest is 26 m short'.


## Feedback and juice

FLOATERS (M4)
mineOreRewards (22376) and mineWaterPickups (22418) return per-pile lists [{x, y, mat, n}]. addEnergyFloater and drawFloaters (38540/38612) take an icon, a colour and a size.
- '+1 P': 12 px lilac, at the deepest tip, per reach tick.
- '+3 P': 18 px lilac (#c9a2e8), at the seam.
- '+2 Anthracite' (#d8b36a), '+2 Hematite' (#d98a5a), and '+6 Garnet!' (#d8566a) for a rich seam.
- '+10 water': blue, at the pocket.
- '-3 worms': at a flask burst.
- 'Cut 14': at an enzyme cut.
They rise 40 px over 900 ms with an outline, at most 12 live at once.

STATE LEGIBILITY
- Tapped pockets are drawn at 35% alpha with a dry crack.
- Seams are tinted by material and scaled by richness (the same leaf-litter art).
- The water chip turns amber with 'N left' at 3 digs or fewer.
- The price chip pulses when the price changes, and becomes the FRUIT NOW pill.
- The rot banner, and the rings on attached worms.
- Kit buttons pulse while their threat is present.

SOUNDS
All synthesized with Web Audio in __m_render_sfx (24820), following the click() pattern:
- behind isSfxMuted;
- counted in window.__sfx.counts;
- at most 6 voices, peaking at -12 dBFS;
- the AudioContext resumes on the gate tap.
The seam ping and pocket glug land in M4; the rest in M12.
| event | sound |
|---|---|
| dig | the existing playGrowBurst |
| reach tick | a sine blip at 880 Hz, rising toward 1320 Hz with the band |
| seam | two sines: P 660+990 Hz, Anthracite 440, Garnet 587, Hematite 740; +1 semitone per consecutive seam in a run, capped at +12 |
| pocket | a glug: noise through a lowpass sweeping 800 -> 200 Hz, 250 ms |
| price line | a 3 kHz highpassed hiss, 400 ms |
| band beat | a gong, 110+220 Hz, 1.2 s decay |
| refused dig | a 90 Hz thud, 60 ms |
| worm attach | two 1.2 kHz clicks of 25 ms |
| flask | a noise splat |
| enzyme | a double 3 kHz snip |
| vial | a band-passed fizz |
| rot | a sting at contact; a 60 Hz heartbeat under 10 s (1 Hz, rising to 2 Hz under 5 s); a relief chime on the cure |
| new record | a rising 3-note arpeggio on NEW DEEPEST / NEW FARTHEST |
| island in sight | a sparkle |
| landfall | C-E-G-C', then the chord |
| other endings | a soft suspended 3-note chord |
| end screen | a tick per count-up row and a ding on the total |
| buy | a rising two-note chime |

HAPTICS
navigator.vibrate, feature-detected, behind a Settings 'Vibration' toggle (default on for touch) persisted in mycelium.settings.v1 via saveSettings (32206-32209).
| event | pattern |
|---|---|
| seam | 12 ms |
| pocket | 20 ms |
| price line | 30 ms |
| worm attach | [30, 40, 30] |
| infection | 80 ms |
| landfall | [60, 40, 120] |

CAMERA
A 3 px, 150 ms micro-shake in mineFollowCamera (37198) on a price line, a flask burst and 'island in sight'. It is off under Settings 'Reduced motion', which also skips the count-up animation.

RECORDS IN THE WORLD (M8)
- Dashed best-depth and farthest-east lines per leg at alpha 0.35, labelled at the edge ('deepest 97 m', 'farthest 142 m'). Crossing one fires its beat once.
- The fossil of the last attempt at 20% alpha, desaturated (M13).

BEATS (showMineBeat 37258, one at a time)
- '42 m · ANTHRACITE' with the second line 'Digs now cost 4'. The line is taken from mineGrowCost, so with tolerance it reads 'Digs still cost 2', and a price line that tolerance has moved gets a small beat of its own.
- The leg banner at every run start.
- 'ISLAND 3 IN SIGHT'.
- 'NEW DEEPEST' / 'NEW FARTHEST'.
- 'LANDFALL'.

END SCREEN (showMineEnd 29281)
1. The grown word (SPORED, or ROOTED on landfall), scaled to the viewport width minus 32 px.
2. '92 m down · 140 m east' and one cause line.
3. Rows counting up over 1.2 s, with ticks: 'Depth 92 m +18', 'East 140 m +14', 'Phosphorus seams x2 +6', 'Island bonus +40'. Materials appear by full name, then the total and the new balance. The P icon is 0.95em (.ss-win-earned .ss-ri, CSS 1760-1767).
4. A records line.
5. ONE next-goal card with an inline Buy.
6. [Descend] as the primary button, [Store] as secondary.
7. The journey strip (M8).
The red all-caps call to action is removed.


## Retention

WHAT BRINGS A PLAYER BACK TOMORROW
1. THE UNFINISHED JOURNEY, WITH A NAMED NEAR GOAL. The title and every end screen say exactly what is next: 'Island 4: your farthest is 26 m short', 'Grow strength IV: 24 Garnet, you have 9'. Closing the tab feels like pausing, not finishing. (Downwell, Hill Climb Racing.)
2. THE LEG YOU FAILED IS THE SAME WORLD TODAY. It has your farthest and deepest lines drawn in it and, from M13, the fossil of your last colony. Failure reads as map knowledge, and a retry is visible mastery. (Trials ghosts, Souls bloodstains, Slay the Spire acts.)
3. THE DAILY DIG (M13, unlocked at the first landfall).
   - One shared seed per UTC day on the free centre-hill descent, the original 'go deeper' game reused.
   - A fixed kit (water 108, grow 4, tolerance 2, 1 flask, 1 dose), so the score (deepest clean depth) is comparable.
   - One paid run a day (seams + half the reach); later runs are 'practice'.
   - The streak is shown but pays nothing, so missing a day costs nothing.
   - 'Copy result' puts 'Deep Mine daily 25 Sep: 118 m · streak 3' on the clipboard.
   - Local-first. The global board appears only if the owner runs the Supabase migration and a probe request succeeds; otherwise it silently reads 'local'. (Spelunky daily, Wordle.)

WEEK ONE
- Journey I is 35-50 runs (70-110 min), so 3-6 sessions, each with a 'first': a band, a threat and its tile, a leg rule, a store tile, an island.
- The first island lands at minutes 4-8, and legs 2-3 fall in the first session for a committed player.
- The Promised Land is a real ending: the finale, credits, a badge and the Gold strain.
- Then New Journeys II-VIII: one stacking rule each on fresh seeds, keeping the store. This is the Slay the Spire Ascension / Balatro stakes shape, and it reuses all content.
- Each journey gives a strain and a 'fewest runs' record, and the strains shelf absorbs surplus P.
- A completionist has 4-7 hours of reasons.

WHY THESE
Each one reuses the loop instead of adding a system (the owner's 'too complex' rule):
- legs reuse the generator;
- records and fossils are canvas polylines over it;
- New Journey is one knob per journey on the same table;
- the daily reuses the free layout;
- strains are one colour parameter on the network renderer (25529).

TARGETS, READ FROM TELEMETRY AFTER RELEASE
- 90% or more of gate taps dig within 30 s.
- 85% or more finish run 1.
- 70% or more of run-1 finishers start run 2 (80% of campaign players never cleared level 1).
- 40% or more of those who start run 2 make landfall 1.
- Median played visit 6 min or more (CrazyGames wants a 10+ min average).
- D1 12% or more, D7 4% or more.

DELIBERATELY LEFT OUT
- Missions, achievements and a journal: a second goal system on top of the journey. They are deferred until telemetry shows mid-journey churn.
- Login calendars, paid streaks, energy or lives timers, and offline 'island fruiting' income: they reward or punish absence, against the owner's 'lost too much'.
- Pick-before-descent modifiers: drafting in disguise.
- Mid-run resume: a descent is one sitting, and exits and a closed tab bank instead.
- Prestige resets: they take the store away.
- Push notifications, and anything that needs the network to play.
- Rewarded ads: a platform decision for the owner. The natural slot is doubling an island bonus.


## Numbers model

THE DEEP MINE — NUMBERS MODEL. The tuning milestone (M14) measures against this.
The model source is in this session's scratchpad: final/model.py and sweep.py. M14 commits it as tests/bots/econ-model.py, with the measured inputs replaced by bot numbers.

A. FORMULAS (whole numbers everywhere)

DIG PRICE, at the pressed strand's depth d in metres
- The first line F = safeDepth + 14 x heat tolerance level (0-4). safeDepth is 42; on leg 6 it is 36; on Journey II and later, 10 m less.
- price = 2 if d <= F, else 2 x 2^min(3, ceil((d - F) / 42)).
- Bare, the price is 2 / 4 / 8 / 16 past 42 / 84 / 126 m.
- At maximum tolerance it is 2 / 4 / 8 past 98 / 140 m; the x16 line falls below the 168 m floor.
- Standing exactly on a line is the cheap side of it.

REACH PER DIG
- Nominal reach = 3 x grow x 25.5 units: grow 2 = 153 u (4.25 m), 3 = 230, 4 = 306, 5 = 383, 6 = 459 u (12.75 m).
- Route digs scale as (2/grow)^0.8: grow 3 = x0.72, 4 = x0.57, 5 = x0.48, 6 = x0.41.

WATER
- Start water = 60 + 12 x Water level, so 60 ... 156.
- A pocket gives +10, once.
- Each attached worm drains 0.2/s through mineDrainDebt. Breeding is 5%/s while feeding, and stops at 6 attached worms.

PAYOUT, AT EVERY ENDING
- Payout = max(5, floor(maxCleanDepth / 5) + floor(maxEast / 10)) + 3 x (P seams) + island bonus (first landfall on a leg only).
- maxEast is 0 in the free layout.
- Deep seams pay 2 of their material. A rich seam pays 6: 1 in 4 of them, or 1 in 2 on leg 5.
- Depth part: 20 m = 4, 42 m = 8, 84 m = 16, 126 m = 25, 168 m = 33 P.
- East part: 96 m = 9, 144 m = 14, 192 m = 19, 264 m = 26, 360 m = 36 P.
- Island bonus by leg: 20 / 30 / 40 / 50 / 60 / 70 / 85 / 150.
- Daily Dig: the first run of the day pays seams + floor(reach / 2); later runs pay 0.

RUN 1 ARITHMETIC
- 60 water is 30 digs at 2, plus about one pocket (+10 for about 2 detour digs), so 32-34 digs: 55-60 s at 1.7 s a dig.
- It reaches 42-60 m (the heat tease), or 20-40 m and 30-45 m east on leg 1.
- It pays 10-18 P and always buys Water I (5 P).
- AS BUILT (M5 verifier fix): the 5 P floor is paid only for a descent with at least one dig that ended by itself (dry, FRUIT NOW, infected, devoured, full). End descent, Exit to title and a hidden tab bank the raw reach + seams, so the floor cannot be farmed.
- The model has run 1 at about 62 s, paying 12-13 P.

B. MEASURED INPUTS (phase 1; the navigator through the fine mask at grow 2). M14 re-measures them with legprobe.cjs and journey.cjs.
- Descent digs per 42 m band: 13 / 11 / 10 / 8. At bare prices that is 26 / 70 / 150 / 278 water to reach 42 / 84 / 126 / 160 m.
- Lateral digs per 24 m chunk: 7.5 in band-0 galleries with the crust closed (6 on today's open crust), and about 9 at depth (range 6-11).
- Human overhead on navigator digs (an assumption until telemetry): 2.0 on a leg's first attempt, falling 0.15 per attempt to a floor of 1.4; each island-compass rung takes off 0.08. The pace is 1.7 s a dig, plus 15 s between runs.
- Seams collected per chunk crossed in their band: 0.45, plus 0.15 per material-compass rung. Pockets: 0.5 per chunk crossed, with a detour of 2.5 digs.
- Worm drain per chunk crossed in worm bands: 5 water with no flask, 1.5 with one, 0.8 with two or more. Mould breaches: 0.18 x the leg's mould multiplier per chunk crossed in mould bands.

C. THE STORE (36 rungs, one currency each; A = Anthracite, G = Garnet, H = Hematite)
| track | effect | rung prices |
| Water tank | +12 start water (60 -> 156) | 5, 12, 25, 45, 80 P, 30 A, 24 G, 16 H |
| Grow strength | +1 step (2 -> 6) | 12, 35 P, 20 A, 24 G |
| Heat tolerance | first line +14 m (42 -> 98) | 15 P, 14 A, 24 A, 20 G |
| Mucus flasks | carry 1 / 2 / 3 | 10, 40 P, 14 A |
| Cutting enzyme | carry 1 / 2 / 3 | 15, 50 P, 14 G |
| Oxalic vial | carry 1 / 2 / 3 | 50 P, 12 G, 12 H |
| Island compass | bearing; + distance | 12, 40 P |
| Anthracite compass | bearing; distance; richest within 90 m | 20, 60 P, 12 A |
| Garnet compass | same | 40, 100 P, 12 G |
| Hematite compass | same | 60, 140 P, 12 H |
Totals: 866 P, 114 A, 106 G, 40 H.
After the ending, strains cost 150 / 250 / 400 / 600 P.
Migration refund test: water 4 + oreYield 3 + pocketWater 2 + heatTolerance 2 + excreteCharges 1, at the old prices, is exactly 345 P.

D. LEG TABLE (E = chunks east of the hill chunk; the island is at chunk 1+E)
| leg | name | E | taproot east | taproot depth | model crossing depth | seal chance by band (0-42 / 42-84 / 84-126 / 126-168) | rule | bonus |
| 1 | First Light | 4 | 96 m | 24 m | 21 m | .12 / .12 / .12 / .12 | threat-free | 20 |
| 2 | The Coal Road | 6 | 144 m | 58 m | 57 m | .55 / .12 / .12 / .12 | worms from 42 m | 30 |
| 3 | Dry Ground | 8 | 192 m | 72 m | 66 m | .70 / .12 / .12 / .12 | no pockets above 42 m | 40 |
| 4 | Mould Country | 9 | 216 m | 92 m | 66 m | .70 / .12 / .12 / .12 | mould at 42-84 m too | 50 |
| 5 | Rich Veins | 11 | 264 m | 104 m | 75 m | .75 / .20 / .12 / .12 | 1 in 2 deep seams rich | 60 |
| 6 | Hot Rock | 10 | 240 m | 112 m | 78 m | .75 / .20 / .12 / .12 | safeDepth 36 | 70 |
| 7 | The Swarm | 13 | 312 m | 126 m | 93 m | .75 / .60 / .12 / .12 | worms x2 below 42 m | 85 |
| 8 | The Promised Land | 15 | 360 m | 140 m | 96 m | .75 / .65 / .12 / .12 | +1 worm, +1 cloud per chunk below 84 m | 150 |

E. MODEL PROJECTION (median of 40 careers; a greedy buyer by priority; a dive whenever the next power rung needs a material this leg's route does not pay)
| leg | landfall on run | minute | run length | P per run excl. bonus | materials per run | buys per visit | dive share | start water / grow / heat on arrival |
| 1 | 3 | 4.4 | 74 s | 17 | - | 1.43 | 4% | 72 / 2 / 0 |
| 2 | 8 | 11 | 57 s | 18 | 4 A | 1.27 | 4% | 96 / 4 / 1 |
| 3 | 13 | 20 | 105 s | 30 | 12 A | 1.49 | 26% | 108 / 5 / 2 |
| 4 | 17 | 28 | 117 s | 34 | 15 A, 2 G | 1.78 | 26% | 120 / 5 / 3 |
| 5 | 21 | 37 | 140 s | 40 | 22 A, 2 G | 0.70 | 26% | 132 / 6 / 4 |
| 6 | 24-25 | 44 | 139 s | 43 | 24 A, 2 G | 0.23 | 22% | 132 / 6 / 4 |
| 7 | 30 | 56 | 140 s | 45 | 15 G | 1.00 | 24% | 144 / 6 / 4 |
| 8 | 35 | 70 | 161 s | 53 | 19 G | 0.18 | 13% | 156 / 6 / 4 |
Journey I takes 35 runs (range 32-37) and about 70 minutes.
- Dead store visits (nothing bought): at most 1 in runs 1-10, but 34% overall.
- 97% of rungs are bought at the final landfall.
- End wallet: about 600 P, about 150 A, about 120 G and about 5 H.

F. GATES M14 MUST HIT
Bots: journey.cjs with the sensible and naive policies, and the cheapest, power-first and knowledge-first buyers, on 5 fresh saves; paceMs 1700 for durations; legprobe.cjs for route water.
- G1. Run 1: median 45-65 s over 8 seeds. It banks at least 5 P and buys Water I on 100% of fresh saves, for both the sensible and the naive bot.
- G2. Dead visits: 0 in runs 1-5, at most 1 in runs 1-10 per save, at most 25% over the journey, and never 3 in a row before leg 8.
- G3. Landfall 1 at a median of run 3-5. Each leg at a median of 3-7 runs, and no leg above 10.
- G4. The Promised Land in 35-50 runs, 70-110 min at the human pace.
- G5. At least 85% of rungs bought at the final landfall, and 100% not before leg 8 starts.
- G6. While any rung is priced in a material, its balance stays within 3x the remaining demand for it; once its last rung is bought, the balance stays at 60 or less.
- G7. Leg 7-8 runs: a median of 150-240 s.
- G8. Every leg: navigator water to the taproot with the arrival kit at most 70% of (start water + half the route's pockets); with the bare kit, over 100% (legs 3-8).
- G9. Dives are 15-35% of runs on legs 3-7, so the 'go down to afford going right' loop exists.
- G10. Free layout with no upgrades: the diver's P is at least 1.2x the shallow farmer's.
- G11. With counters bought, infected endings are 20% or fewer of runs on legs 4-8, and median worm drain is 3 water or less per run.
- G12. econ-model.py, re-run with the measured inputs, reproduces the bot runs-per-leg within ±25%.

G. KNOBS (symptom -> which number moves)
- Run 1 too long or too short: startWater ±6.
- Landfall 1 late: leg 1 E 4 -> 3, or taproot 24 -> 20 m.
- A leg over 7 runs: E -1. A leg under 3 runs: E +1.
- A leg over the 70% rule: E -1 first, then its crossing seal values.
- Dead visits in runs 1-10: the cheapest unowned P rung -20%.
- Dead visits on legs 5-8: move a P rung onto a late material, or add +10-20% to late P prices.
- Anthracite or Garnet surplus: pilesPerBand for that band on the legs that cross it (2 -> 1.5), or +20% on its rungs.
- P surplus at the ending over 1.5x the strains shelf: east rate 10 -> 12 m per P.
- Dives under 15%: material prices on power rungs +20%. Dives over 35%: -20%.
- Infected endings over 20%: cloud moveSpeed 0.5 -> 0.4.
- A leg's route share below 42 m under 50%: raise its band-0 seal chance by 0.05.

H. KNOWN GAPS THE BOTS MUST SETTLE
1. The model's dead visits are 34%. They are concentrated in legs 5-6 and 8, where P rungs are gone and material rungs wait on dives.
2. The anthracite surplus after leg 5 is about 60-100 A, because legs 5-6 cross band 1 with its rungs done.
3. About 600 P is left at the ending. That is intended for strains, but check it against G6's spirit.
4. The human overhead is assumed. If telemetry shows it above 2.6x on a first attempt, shorten legs 7-8 rather than cheapen rungs.
5. The model treats a leg's route as one crossing depth, whereas real routes weave between bands, which legprobe measures.


## Fixes required

- Dry-for-deep soft lock (36% of runs): a FRUIT NOW pill whenever water < costHere, and an automatic fruiting after 6 s with no dig and no water gained (mineStuckCheck beside mineFuelCheck 22703; HUD 26341-26427, 27170-27250).
- Node-cap soft lock at the shared 6000 (2718): the mine gets maxNodes 9000 in configForLevel and a 'full' ending.
- The only instruction is invisible on phones (.hint display:none, CSS 693/1011/1059): the mine gets its own #minehint element and a canvas ghost finger.
- Taps do nothing in the mine (endPointer 36675-36700): a tap on a strand digs down, and an armed enzyme or vial commits on a tap (mineArmedTap 36460 runs before the early return).
- Dev buttons are live on the plain URL (CONFIG.dev.enabled ~3597, inGameButtons 3613). 'Dev: maps' destroyed a run and '+10,000 spores' credits the wallet: show them only with #dev, ?dev=1 or MYCELIUM_DEV_BUTTONS, and leave the hooks untouched.
- The HUD overflows 390 px and pushes the gear off screen: two rows under 430 px, #gearbtn position:fixed, and an assertion that every HUD rect is inside the viewport.
- 'Save & exit' deletes the run and its haul (onSaveExit 35976): replace it with 'Exit to title (banks everything)' through mineEndRun('quit').
- 'End run' says 'The colony was eaten' (forceFruitAbandon 33063 sets died:true): replace it with 'End descent' through mineEndRun('abandon'), with its own copy.
- 'Replay tutorial' silently restarts the run (35971): hide it in the mine.
- Infected endings under-report depth (107 m shown as 99; mineDepthReached 21527 skips rot): pay and record the running maximum clean depth.
- Heat bypass: a walled shallow strand grew at 137-142 m for 2 water (growDirected fall-through ~16290). Fall through only to tips within 90 units on the same price step, and show the price on the aim arrow.
- A dig can land 100+ m from the pressed strand and the camera jumps there: fixed by the same fall-through limit.
- Run 1 cannot buy anything on 4 of 5 fresh saves (9 P against a 10 P minimum): a minimum payout of 5 P, with Water I priced at 5 P.
- Only 0-42 m pays spendable money, and a shallow farmer out-earns a diver 2x: a reach payout of 1 P per 5 m of depth and 1 P per 10 m east.
- Deep materials pile up with no sink (160 Anthracite banked against a demand of 18): 114 Anthracite, 106 Garnet and 40 Hematite of demand across power, kit and compass rungs, each opened within 2-4 runs of first finding it.
- Materials show as unlabelled dots on the HUD, end screen and store header: full names on the end screen and store, and tinted 3-letter tags on the HUD.
- Seams look identical in every band: tint the leaf-litter art by material and scale it by richness.
- Ore yield silently multiplies deep materials and dominates the shelf: cut the track and refund it.
- The Water pockets track is the weakest value on the shelf: cut it and refund it.
- The Water track is 57% of the shelf at +5 a rung: 8 rungs of +12 on a 60 base, priced 5 P up to 16 Hematite.
- Upgrades are too small to feel (Water +5 is 6% of the tank): +12 on 60 (20%), with Grow strength as the headline buy.
- Heat tolerance +150 m deletes heat from the shaft: 4 rungs of +14 m, so the first line sits at 98 m at most.
- The Mucus flask is a 0.5 s stun that needs 3 hits (measured saving 0.1 water): one flask kills every worm on or within 160 units of the colony.
- Worms attach from off screen and are 10-16 px squiggles: draw attached worms at 2.5x with a pulsing ring, add edge chevrons, and make the HUD chip pan to them.
- Breeding switches off once 4 chunks exist (a world cap of 16 against 4 worms seeded per chunk): breed only while fewer than 6 are attached.
- Clouds lunge at 2.5 cells a tick, so avoiding them fails (players who routed around them were still infected in 5 of 7 runs): a mine moveSpeed of 0.5, so contact takes at least 6 s from first sight.
- One enzyme dose cannot cure a real breach (a 220-unit disc left 12 of 55 strands rotten; one cut took 118 strands to catch 6): one dose cuts the whole connected rotten component, rot only plus a one-segment margin, and a miss keeps the dose.
- Mine breaches are too big (41-55 strands): firstTouchRings 6 in the mine.
- The first infection leaves no time to learn: 30 s on a save's first infection, 20 s after.
- No collection feedback on the map, and tapped pockets look untapped: floaters at the site, synthesized cues, haptics, and drained pocket art.
- Nothing happens at the 168 m floor and there is no goal once the depth record stalls: the journey east, with eight legs and the Promised Land.
- The store exhausts in 56-89 runs, leaving 6,772 P unspendable: a 36-rung shelf sized to about 90-97% bought at the Promised Land, and strains after it.
- The surface crust is a highway (row 0 is 5-7% solid; 82 water crawls 168 m east): in journey worlds the crust closes and the shallow road breaks through a per-band gallery seal chance.
- The end-screen P icon renders 55-170 px (.ss-win-earned has no .ss-ri rule, CSS 1760-1767): size it at 0.95em and lay the earnings out as labelled rows.
- The SPORED wordmark clips both edges at 390 px: scale it to the viewport width minus 32 px.
- The red all-caps call to action on the end screen reads like an error: replace it with the next-goal card.
- The load gate says 'CLICK' on phones: 'Tap to dig' on coarse pointers.
- DIG takes about 6.9 s to become playable, and the title says 'start a new descent' when nothing resumes: a first visit skips the title (2.5 s or less to the first dig), and the returning title says 'Continue · Leg N'.
- The 42 m band beat does not say that digs now cost 4 (showMineBeat 37258): add a price line to every heat beat.
- The store note always says '2 water a dig' (ssMineNote): quote the whole ladder and the current tolerance.
- Tile copy is wrong: the enzyme promises 'a small radius', the flask hides its 3 hits, and Ore yield hides its effect on materials. Rewrite every tile for the new mechanics.
- The title's Upgrades button appears only when P > 0 (29889-29899): show it when any wallet is above 0 or any rung has been bought.
- The HUD cost chip reads a debug hook (window.__game.mine.costHere, 27194): call mineDigCost directly.
- mineBeat, mineZoom and mineClampZoom read CONFIG instead of state.config (37244-37251, 37143, 37161): read state.config so leg rules show.
- stampFood can return without pushing a pile, and the caller then retags the previous pile (22123): compare the foodPiles length before tagging.
- __game.mine.playSeed builds the world twice (35515): start it once.
- The release zip drops magnetite-c24 and garnet-c24, so bands 0 and 2 would ship with no rock and no collision (make-web-zip 163-242): keep every CONFIG.mine.bands[].assetsFrom folder.
- itchzip-check clicks #tsNewCamp/#tsNew, which the mine title never renders (202): drive #tsNewMine through a descent, the end screen, the store and Descend with dev off.
- A dev-off build shows the campaign 'Level' card before every descent (pendingLevelIntro 35869-35904): never arm it on a mine map.
- On a slow link the map is diggable about 35 s before collision exists, and 11 of 50 strands ended up inside rock: mineGrow refuses without charging until sub._rockSolidified, and revealMap (32266) holds the curtain up to 15 s for it.
- Boot preloads about 5 MB of card faces and portraits the mine never shows (_bootImgs 40486, 159 requests): skip them when only the mine is offered, and preload the band folders instead.
- About 7 O(nodes) passes run every frame, plus waterSourcesNear at O(25 x nodes), so long runs scale badly (render 9 -> 24 ms at 5000 nodes): cache the colony extents and tips in mineGrow, and test pockets only near new growth.
- Closing the tab mid-run loses the haul: write the pending payout when the tab is hidden, and bank it on the next boot.
- run_end telemetry carries no duration, leg or cause detail: add ms and detail 'L<leg>:<cause>:e<east>', add tutorial, island and daily events, and add a mine column to docs/analytics.html.
- A new player's natural gesture burns the tank sideways for 0 m (naive median 28 m): tap-to-dig-down, the ghost finger, and the dead-end nudge (on runs 1-5, two digs with fewer than 2 new cells each make the two most open tips glow).
- The bots aim 130 units ahead whatever the grow reach, which undercounts Grow strength (lib.cjs digAlong): aim a full reach, and have career.cjs read the store ids from the page.
- CLAUDE.md's 'a colony can box itself in' was wrong; the four mine-check failures came from a probe that only digs from the deepest tip. ALREADY FIXED in ce89c7c and e6cf455 (navigator in mine-check, boot stub, 0/0 counted as BROKEN; mine 190/190, boot 20/20). Keep the record corrected and design nothing around box-in.


## Cut or deferred

- CUT economy's rock walls from the surface to a trunk row at every seam, with a forced-open trunk row. It is a reserved corridor in all but name, draws a slab every 24 columns, and collapses the maze into one highway. It is replaced by closing the crust, a per-band seal chance and curated seeds.
- CUT retention's surface island as the leg goal. With the crust open, a surface target needs no depth; with the crust closed, reaching it means a priced climb. The taproot replaces it.
- CUT any climb back up to the island's surface. A dig is priced where it starts, so the climb taxes exactly the depth the later legs ask for, which makes it a return trip.
- CUT economy's Heat VI (the first line at 168 m) and any tolerance above +56 m. Either deletes heat from the shaft.
- CUT a hard 'unreachable without its key rung' leg gate. Economy's own first model stranded careers for 380 dead runs. The calibration rule only requires that the bare kit needs more than 100% of supply.
- REJECTED band-scaled pockets (10/15/20/25). It changes an owner number on the strength of a model. Keep +10, and revisit only if bots show pockets ignored below 84 m.
- CUT multi-part P+material prices. Single-currency rungs do the same job with costParts unchanged, and read better on a phone tile.
- CUT an acid that edits the mask (dissolving _fineSolid and _coarseCover, then re-applying holes after every restamp). It fights the append-only stamp path. The pass-through vial gives the same play.
- CUT eager generation of the whole leg at Descend (about 14 chunks and a 600 ms long task). The island target comes from the leg definition; material compasses use generated chunks plus one idle look-ahead chunk at a time.
- CUT a 10-leg Journey I of 70-90 runs: too long for portal players. It is 8 legs and 35-50 runs.
- CUT offline 'island colonies fruit while you are away' income. It rewards absence, holds no decision and floods P.
- CUT a daily streak that pays P, and a daily played on the player's own loadout. The first is a login reward in disguise and the second makes scores incomparable. The daily uses a fixed kit, pays one run a day, and shows the streak without paying for it.
- CUT the first-descent floor, the core bonus and other small P sources. One guarantee is enough: the minimum payout of 5 P equals the price of Water I.
- DEFERRED cosmetics before the ending. Strains appear only after the Promised Land, so they never compete with power rungs.
- REJECTED the dead-dig water refund. It misses the measured failure, which is sideways digs that do take new cells; the glowing-tip nudge teaches instead.
- DROPPED double-tap to reframe, because a tap is now a dig. The follow camera, F and pinch remain.
- REJECTED 'verify and fix rot creep'. Once one dose cuts a whole component, creep decides nothing, and infectNetwork's tuning is shared.
- REJECTED any teeth on the infection: forfeiting part of the haul, freezing digs, or a per-dig cooldown. They break the full-payout premise and the real-time feel.
- DEFERRED missions, achievements, a field journal and secrets in dead ends. They add a second goal system, against 'too complex', and the owner said secrets come later. Revisit if telemetry shows mid-journey churn.
- CUT pick-before-descent modifiers and anything drafted ('too much card drafting'). Variety comes from the fixed leg rules.
- CUT mid-run resume. A descent is one sitting; the exits and a closed tab bank the run instead.
- CUT energy and lives timers, login calendars, push notifications and prestige resets.
- DEFERRED rewarded ads and a portal SDK integration. That is a platform decision for the owner; the natural slot is doubling an island bonus.
- DEFERRED a required online leaderboard. It needs the owner's Supabase SQL migration, so the game is local-first and falls back silently.
- DEFERRED the water dowser compass. Pockets are the fuel clock; add a dowser only if bots show pocket-hunting dominating dead time.
- DEFERRED new art and a mine music track. Every new visual is canvas-drawn or reuses existing art, and every cue is synthesized.
- DEFERRED a per-band ambient drone. It is cheap in Web Audio but risks fatigue; try it after M12.
- DEFERRED moving the mine to its own save key and deleting the card-layer residue. Neither has player value, and both carry migration and declaration-order risk.
- DEFERRED a plan/stamp split of chunk generation, or a Worker. Either would move every pinned seed.
- DEFERRED legs beyond 8 in Journey I. The New Journey rules are the long tail.


## Premise changes

- AFFORDABILITY (the settled heat premise: 'affordability asks the cheapest ground', mineCheapestCost 22686). The run still ends when the cheapest ground anywhere is unaffordable. It now ALSO ends 6 s after the tank cannot pay the price at the strand the player is working (the focus strand, the number the chip already shows), with no successful dig and no water gained in between. A FRUIT NOW pill shows the countdown and what will bank; any cheaper dig or any water resets it. EVIDENCE: 14 of 39 route-bot runs and 5 of 12 playtest runs (36% of runs, including 3 of 8 first runs) sat live at 2-7 water against 4-16 a dig for 30-60 s, with 0 affordable strands on screen. The 'crawl sideways up top' recovery the rule was written for never happened in 51 runs; the only exits were a worm, the rot, or a gear menu the HUD had pushed off screen. Heat stays priced and never enforced, every dig the game allows still succeeds, and all that is removed is dead time.
- INTERPRETATION OF PLAN ITEM 07 ('reach one, resurface and spore'). A leg is won by reaching the island's TAPROOT, a canvas-drawn root knot in a chamber under the east island at the leg's depth (24 m on leg 1, 140 m on leg 8). The colony resurfaces and spores on the island in the celebration, where its filaments light up to the island hill, which fruits; it does not dig back up to it. EVIDENCE: (1) a dig is priced where it starts, so climbing 90 m to a surface target costs about 76 water at base heat and taxes exactly the depth the later legs ask for, which is a return trip in all but name; (2) measured, the top of row 0 is only 5-7% solid (rock sprites are clamped below surfaceY + 0.5 cell), so a surface target on an open crust is an 82-water crawl that never needs depth; (3) a point target is exactly what the island compass can name through rock. The hill stays west, the island east, the world fixed per (journey, leg) and fresh per leg, as the premise says.
- WORM CAP MEANING (the plan's 'population cap 16'). The breeding cap counts ATTACHED worms (6), not the world population. The owner's rates are unchanged: 0.2 water/s per worm and 5%/s breeding while feeding. EVIDENCE: 4 worms are seeded per chunk (1+1+2), so the world count passes 16 once 4 chunks exist, and breeding silently switches off on almost every run that travels sideways. The journey travels 4-15 chunks, so under the old cap the owner's breeding rule would never run. Capping attached worms bounds the drain at 1.2 water/s, which is what the cap was for.


## Milestones


### M1 — Every run ends, and no exit loses a haul

**Goal.** No run can hang, no menu item throws away what was dug, and every ending says honestly why it ended, so every later milestone is measured on runs that finish.

**Changes.** 1. RUNNING MAXIMUM. mineFrame (37281) keeps state.mineMaxDepth = max(itself, mineDepthReached 21527). mineEndRun (22714), presentMineEnd (33215) and mineRecordDepth (33251) use it.
2. STUCK RULE. A new mineStuckCheck(state, now) sits in __m_engine_mine next to mineFuelCheck (22703).
   - Stuck means net.water < mineDigCost(state, focusY) (22678). The focus is the state._mineFocus node, else the deepest clean tip.
   - The timer accumulates only while nothing is revealing, !simPaused (36981), and no pointer is down.
   - It resets on a successful mineGrow (22456) and whenever net.water rises.
   - At CONFIG.mine.stuckFruitMs (6000) it calls mineEndRun(state,'dry').
   - Hook: __game.mine.stuck() returns {on, leftMs}.
3. #fruitnow PILL. It is built in the HUD (26341-26427) and shown while water < costHere, with the price chip hidden. (Verifier round: it moved from the price chip's slot to its own position:fixed slot, bottom centre, because the row overflowed at 390 px.)
   - Label: 'FRUIT NOW · +N P', where N is the run's ore until M5 and mineBankable after it.
   - A conic ring driven by stuck().leftMs, updated in the ui.update mine branch (27170-27250).
   - A tap calls mineEndRun(state,'fruit').
4. CAUSES. mineEndRun keeps cause 'dry' | 'fruit' | 'infected' | 'abandon' | 'quit' | 'full', always with died:false, and writes a log line per cause.
5. BANKING AND END SCREEN. presentMineEnd moves its banking into an idempotent mineBank(r) (guarded by _minePaid). showMineEnd (29281) gets:
   - one copy line per cause, from the runEnding table, with the 'eaten' branch removed for the mine;
   - the wordmark fitted to the viewport width minus 32 px;
   - a CSS rule .ss-win-earned .ss-ri {width:.95em;height:.95em} (1760-1767);
   - materials named in full (matName).
6. SETTINGS (markup 26396-26406, handlers 35971-35976), when mineOn:
   - #set-tutorial is hidden;
   - #set-forcefruit reads 'End descent (banks everything)' and calls mineEndRun('abandon');
   - #set-saveexit reads 'Exit to title (banks everything)' and calls mineEndRun('quit'), then mineBank, then showMainMenu, with the toast '+N P banked';
   - forceFruitAbandon (33063) routes through mineEndRun in the mine.
7. NODE CAP. The configForLevel mine block (32461-32493) sets cfg.growth.maxNodes = CONFIG.mine.maxNodes (9000). mineGrow ends the run with 'full' when nodes >= maxNodes - 30.
8. HIDDEN TAB. On visibilitychange -> hidden and on pagehide, write p.minePending {P, mats, depth} with saveProgress. Becoming visible clears it. At boot (loadProgress 13685, then the title), a leftover is banked once and the title says 'Your last descent spored +N P'.
9. TELEMETRY. run_end (33238) gets ms (the run's duration) and detail = the cause.
10. CLAUDE.md records every changed assertion, with its before and after numbers.

**Acceptance.** New tests/mine-check.cjs blocks unless noted.
1. Stuck probe. Seeds 5 and 2024, worms emptied, the navigator digs to 67 m or deeper, then net.water = costHere - 1 and no input.
   - #fruitnow is visible within 500 ms.
   - state.runOver is true within 7.0 s.
   - The cause is 'dry', and p.minerals rises by exactly the run's ore.
2. Same stuck state, with one affordable dig from a shallower strand at 3 s: stuck().leftMs returns to 6000 ±100.
3. Clicking #fruitnow: the cause is 'fruit', and #ssMineEnd contains 'You called it'.
4. Bot sweep. tests/bots/botrun.cjs on seeds 4242 909 11 1234 777 31337 5 2024 7 99 123 2026, paceMs 900, bot {useItems:true}, sitMs 8000.
   - Every run reaches runOver by itself; no forced End run.
   - 100% of stalls end while sitting.
5. Exits.
   - End descent at 45 m holding 9 P: #ssMineEnd contains no 'eaten', and minerals rise by 9.
   - Exit to title at 45 m holding 9 P: the title is visible, minerals rise by 9, and p.mineBest >= 45.
   - #set-tutorial is not visible in the mine.
6. Infected depth. After the navigator reaches 107 m and a cloud is spawned at the deepest tip, the end screen depth and p.mineBest both read 107.
7. Node cap. With maxNodes forced to nodes + 10, the cause is 'full' within 2 s of reaching the cap.
8. Hidden tab. Stub visibilityState to 'hidden', dispatch visibilitychange, then reload: minerals rise by the pending payout exactly once, and a second reload adds nothing.
9. End screen at 390x844.
   - The P icon height is at most 1.3x its line height.
   - The wordmark rect lies within x 16-374.
   - 'Anthracite' appears when any was dug.
10. An intercepted run_end body has ms > 0 and a detail equal to the cause.
11. NODE_PATH=/opt/node22/lib/node_modules node tests/run.mjs --mine reports 0 failed (baseline: mine 190/190, boot 20/20, store 124/124).

**Risk.** - The stuck timer must never steal a pocket the last dig is about to reach. That is why it starts after the reveal and resets on any water gain.
- Existing run-dry probes will end sooner. Update any that assert run length, and record the before and after numbers; never widen a tolerance.
- Container rollbacks: commit and push each item as it lands.


### M2 — A build that can ship, and digs that land where you pressed

**Goal.** The public zip plays the mine with rock and collision, dev tools are invisible to players, no strand can grow inside rock, and heat cannot be bypassed.

**Changes.** 1. DEV GATE. devUI() = CONFIG.dev.enabled && (a 'dev' token in location.hash || ?dev=1 || window.MYCELIUM_DEV_BUTTONS === true). It gates the in-game Dev buttons (inGameButtons 3613) and the store's Dev quick-start, Dev: unlock all and Dev: +10,000. window.__game hooks, #dev boots and keyboard shortcuts are unchanged.
2. LEVEL CARD. begin (35869-35904) never arms pendingLevelIntro on a mine map.
3. RELEASE ZIP. scripts/make-web-zip.mjs (163-242) parses CONFIG.mine.bands[].assetsFrom out of index.html and adds those folders to `reachable`. It fails fast if none parse.
4. ZIP CHECK. tests/itchzip-check.cjs (202) drives #tsNewMine -> a navigator descent -> the end screen -> the store -> Descend, with dev.enabled false. It joins run.mjs as 'zip'.
5. COLLISION GATE. mineGrow (22456) refuses with 'The ground is settling…' and charges nothing until sub._rockSolidified. revealMap (32266) holds the curtain until then, or 15 s at most.
6. HEAT BYPASS. growDirected (16249) gets an optional opts.maxFallDist (default Infinity, so the campaign is unchanged).
   - It limits the fall-through (the prefer list at ~16290) to tips within that distance of startTip.
   - mineGrow passes 90 units, and refuses ('Solid rock that way') when the fall-back parent is on a different price step.
7. AIM PRICE. drawAimLine (40341) draws the price at the pressed strand at the arrow head, in the mine only.
8. SMALL FIXES. playSeed (35515) starts once. The stampFood retag (22123) compares the foodPiles length before tagging.

**Acceptance.** 1. Dev gate. On '/' and '#mine,4242' no visible element's text starts with 'Dev'; on '#dev' at least one does. window.__game.mine exists in all three.
2. `node scripts/make-web-zip.mjs --dry-run` lists magnetite-c24, anthracite-c24, garnet-c24 and hematite-c24.
3. itchzip-check with dev off:
   - 0 failed requests;
   - _fineSolid is set;
   - #levelIntro is never visible;
   - the store opens, and Descend starts run 2.
4. Collision gate. With a 3 s route delay on every band image:
   - digs before _rockSolidified are refused and water is unchanged;
   - afterwards, 0 living nodes lie inside _fineSolid, sampled at node centres.
5. Heat bypass. heatx probe on 3 seeds (30 presses of walled strands at 36 m or shallower, aimed down):
   - every dig's origin tip is within 90 units of the pressed strand;
   - the charge equals mineGrowCost at the pressed strand;
   - 0 new nodes lie farther than 90 units plus one reach from it.
6. playSeed logs exactly one run_start.
7. Retag. On 3 seeds x 5 chunks, every pile.mineMat equals the material of the band containing its centroid.
8. --mine reports 0 failed, including threat 116/116, mould 20/20, harvest 28/28 and aim 9/9 (growDirected is shared).

**Risk.** - growDirected is shared with the campaign, so the new option must default to today's behaviour.
- Checks that click dev buttons opt in with MYCELIUM_DEV_BUTTONS (edit, mapmenu, surface and traced already do).
- The owner uses the dev buttons on the Pages build; tell them to add #dev to the URL.

**Amendments (after the M2 verifiers).**
- Acceptance 5c is KEPT AS WRITTEN, and the code changed to meet it: `mineGrow` passes growDirected a `within` circle of fallDist + one reach (243 u) round the pressed strand. Side twigs and water-seek runners stop at it; every other caller omits it. The first build had instead given twigs an extra ~102 u in ship-check, which was a widened bound. One exclusion, by design: pile-claim mat nodes (`.colon`). A claim runs from a strand that has already grown in, so tying it to this press would only hold back ore the colony already touches. In the mine, claims run on the world tick, so 0 of them were counted inside a dig.
- Changes 1: the `[` / `]` map stepper is also gated on devUI(). It threw a live descent away without banking it. The other keys are unchanged.
- Acceptance 6: old playSeed logged ONE run_start and built the world twice, so the run_start count does not tell the builds apart. The assertion that does is the world-build count (one '[mycelium] ... map:' line). The '#mine,<n>' boot had the same double build and is fixed the same way.
- Acceptance 7: a forced-refusal case (every seam of a chunk refused, sentinel on the previous pile). The natural seeds refuse 0 seams, so on its own acceptance 7 cannot fail on the bug.
- (second verifier pass) A missing band sprite: the first mask boxes only art whose load has FAILED (`assetFailed`), after `solidForceMs`; art in flight is waited for (a hung request is boxed after `solidForceStallMs`, 60 s). Mid-run a missing sprite is boxed at once. Every box is swapped for the silhouette when its art lands (frees cells only). Slow art therefore never turns into invisible walls, and a streamed chunk is never left uncollided.
- (second verifier pass) OWNER TO CONFIRM: the `.colon` exclusion above and `within`'s effect on water-seek (bot runner nodes 76 -> 44, sweep mean depth 84.6 -> 82.6 m) were written here by the implementer. They are design decisions, not measurements.


### M3 — A phone player can see and use every control

**Goal.** On a 360-390 px phone every control is on screen, the instruction is visible, and a tap does what a new player expects.

**Changes.** 1. HUD (26341-26427; update 27170-27250). Below 430 px it becomes two rows:
   - row 1: water, the price chip, depth (and east from M8). FRUIT NOW keeps its own fixed bottom-centre slot from M1; do not move it back into the row;
   - row 2, only when it has content: P, tinted 3-letter material tags ('ANT 6'), the worm chip.
   The rot countdown becomes a top-centre banner. #gearbtn is position:fixed, outside the pill's flow. The chip calls mineDigCost directly (27194).
2. TAPS (endPointer 36675-36700). When the press snapped to a strand (an aim exists) and moved less than 12 px with one pointer:
   - an armed item -> mineArmedTap (36460);
   - otherwise mineGrow(state, {srcX, srcY, x: srcX, y: srcY}), and no direction means down.
   A press away from the colony stays a pan. There is no double-tap.
3. #minehint. A mine-only element outside the .hint rules (CSS 693/1011/1059), top centre under the HUD.
   - It is fed by a one-line tip queue in mineFrame, which replaces the hint block at 37287-37298.
   - First line: 'Drag down from the colony to dig'.
   - The rule that nothing on screen quotes 'water a dig' stays.
4. LOADER. showLoading (31873) says 'Tap to dig' under (pointer: coarse), 'Click to dig' otherwise.

**Acceptance.** 1. HUD fit. At 390x844 and 360x640, with 3 worms attached, the rot banner up and 3 materials held:
   - every HUD descendant rect lies inside the viewport, #fruitnow included (with the colony stuck);
   - elementFromPoint at the gear's centre returns #gearbtn.
2. Taps, in a touch context (hasTouch, isMobile, 390x844).
   - touchscreen.tap on the root's screen point: the node count rises, water drops by exactly 2, and depth is 1 m or more.
   - A tap 300 px from every strand leaves nodes unchanged and shows no toast.
3. Enzyme armed, then a touch tap on a rotten strand: mineItems.amputate drops by 1.
4. Hint, on a fresh save:
   - #minehint's computed display is not 'none', and its rect is non-zero;
   - it reads 'Drag down from the colony to dig' within 1 s of the reveal, and still at 1.5 s and 4 s.
5. Loader text: 'Tap to dig' in the touch context, 'Click to dig' on desktop.
6. hudtop-check and pill-check are updated deliberately, with before and after in the commit, and --mine is green.

**Risk.** - A tap-dig must not steal pans or pinches. It fires only for a single-pointer press that snapped to a strand and moved less than 12 px.
- The HUD restructure touches two existing checks.


### M4 — The first minute teaches itself

**Goal.** A brand-new player digs within 2.5 s of one tap, understands the gesture and the cost without reading a modal, and feels a reward at the site within 10-20 s.

**Changes.** 1. FIRST VISIT. With no p.mineBest and runsDone 0, the gate tap calls beginMineRun from enterGame (40423), skipping showMainMenu and the DIG word animation.
   - The curtain lifts within 600 ms and input goes live on the reveal.
   - Returning players get the title.
2. GHOST FINGER. drawMineGhost() is drawn after the colony pass in renderFrame (~37720).
   - A 14 px mint dot with a trailing arrow slides 110 screen px along the most open of 7 downward rays from the root (scored with solidAtWorld samples), on a 1.6 s loop.
   - It shows until the first successful dig, and again after 6 s idle on runs 1-2.
   - Hook: __game.mine.ghost().
3. ONE-SHOT TIPS in p.mineTips (default {} in loadProgress 13685). Each one is logged as logEvent('tutorial', {detail: id, ms}).
   - first dig: 'Every dig costs water — the deeper, the more';
   - first P seam on screen: a pulse ring and 'Phosphorus — grow into it';
   - first pocket on screen: 'Water pocket — touch it for +10';
   - 6 m above the first price line: a label on the line, 'Past 42 m every dig costs 4'.
4. DEAD-END NUDGE (runs 1-5). Two consecutive successful digs that each occupy fewer than 2 new substrate cells:
   - the two clean tips with the most open ground ahead (8 solidAtWorld rays) glow for 4 s;
   - the hint reads 'Dead end — dig from a glowing tip'.
   - Hook: __game.mine.glow().
5. BEAT. showMineBeat (37258) adds a second line, 'Digs now cost N', from mineGrowCost at every price line. A price line that tolerance has moved gets a small beat of its own.
6. COLLECTION FEEDBACK.
   - mineOreRewards (22376) and mineWaterPickups (22418) return per-pile lists.
   - addEnergyFloater and drawFloaters (38540/38612) take an icon, a colour and a size.
   - '+3 P', '+2 Anthracite' and '+10 water' floaters appear at the site.
   - Tapped pockets are drawn at 35% alpha (read from _tappedWater), and seam art is tinted by pile.mineMat.
   - A synthesized seam ping and pocket glug go in __m_render_sfx (24820), counted in window.__sfx.counts.
7. Run 1's end screen says 'Your first descent'.

**Acceptance.** 1. Touch context, fresh save:
   - no title screen;
   - 2.5 s or less from the gate tap to the first accepted drag dig (the drag starts 200 ms after #minehint is visible);
   - a second boot shows the title.
2. ghost().frames rises before the first dig and stops rising after it.
3. Tips.
   - Each tip fires exactly once per save, including across a reload.
   - A stubbed telemetry route receives 'tutorial' events for dig, first_ore, first_pocket and first_line in a scripted run.
4. The 42 m beat text contains 'Digs now cost 4' when no tolerance is bought.
5. Feedback.
   - A claimed seam spawns a floater within 60 world units of the pile centroid within 200 ms, and __sfx.counts.ore rises by 1.
   - With sound muted, the counts do not change.
6. A tapped pocket's disc has a mean luminance of at most 0.7x its untapped value at the same zoom.
7. Naive bot. The lib.cjs 'naive' policy (always dig from the deepest tip) on seeds 4242 909 11 5 31337 2024 7 99:
   - median depth 40 m or more (today 28);
   - the nudge fires in every run that stalls.
   - AS MEASURED (implementer note, M4 verifier round 2): `Q.naiveStep` digs from the deepest clean tip
     toward the most open of 7 downward rays scored on `solidAtWorld` (`__game.mine.bestDownRay`, the
     ghost finger's own choice, which is drawn on screen), and while the nudge glows it digs once from
     each glowing tip along the drawn slide. So the number is a player who reads the ghost and the glow.
     The literal "straight down from the deepest tip, never look" player reads median ~15 m on 3 seeds
     and is NOT nudged out of a wall by anything but the glow (see CLAUDE.md M4, walled runs).
     `--baseline` (glow ignored) is printed beside it.
8. --mine is green.

**Risk.** - Skipping the title must still unlock audio on the gate tap; iOS resumes the AudioContext on the first touch.
- Ghost ray scoring must stay a handful of rays, never a BFS.


### M5 — Every run pays, every store visit buys

**Goal.** Depth earns the currency, run 1 always buys an upgrade, the early store visits almost always buy something, deep materials have a use within a few runs of being found, and the end screen goes straight to the next run.

**Changes.** 1. REACH PAYOUT. CONFIG.mine.reach {mPerP: 5, eastMPerP: 10, minPay: 5}.
   - mineReachPay(state) and mineBankable(state) live in __m_engine_mine and read mineMaxDepth (and mineMaxEast, which stays 0 until M8).
   - The HUD P shows seams + reach live, with a '+1 P' floater at the deepest tip per tick.
   - FRUIT NOW shows mineBankable.
2. BANKING. mineBank banks reach + seams, at least 5 P. runResult carries reach and seams.
3. WATER. startWater 84 -> 60 (CONFIG 3303). The mine's water step becomes +12 through MINE_STEPS {water: 12}, folded where upgradeValue and storeBonuses (14410) read the step; the campaign keeps +5.
4. THE SHELF in STORE_UPGRADES (14186-14234), MINE_UPGRADE_IDS (14242) and MINE_COSTS (14246), with the prices in the economy section:
   - water: 8 rungs; growSteps: 4; heatTolerance: step 14, 4 rungs; excreteCharges: 3; amputateCharges: 3;
   - oreYield and pocketWater leave the allow-list, and storeBonuses and configForLevel (32485-32487) stop reading them.
5. MIGRATION. Flag migratedMineShelfV2 in migrateProgress (13719): refund at the OLD prices, clear the ledger in the same save, and show the toast.
6. PROGRESSIVE REVEAL. p.mineSeen {line42, worm, cloud, mat_<id>, leg}, set in mineFrame, stepNematodes (17760) and mineInfectionCheck (22582).
   - upgradeInGame (14249) consults it in the mine, and the shelf and the buy path share it.
   - A NEW badge shows for one visit.
7. RICH SEAMS. pile.rich comes from a hash of (seed, ci, spot index), outside mineChunkRng. 1 in 4 deep seams pays 6 instead of 2 (mineOreRewards 22399-22404) and is drawn 1.3x.
8. END SCREEN (showMineEnd 29281):
   - count-up rows by source;
   - a records line ('New deepest: 92 m', or 'Deepest 112 m — 20 m to go');
   - the NEXT-GOAL card, prioritized as in onboarding, with an inline Buy (buyUpgrade 14323);
   - [Descend] as primary, on the #ssDescend path (29220), and [Store] as secondary.
9. STORE NOTE (ssMineNote): '60 water · grow 2 · digs cost 2, then 4 / 8 / 16 past 42 / 84 / 126 m', shifted by the current tolerance. All tile copy is rewritten.
10. TITLE. The Upgrades button (29889-29899) shows when any wallet is above 0 or any rung has been bought.
11. BOTS.
   - career.cjs reads the track ids from the page (a __game.store.ids() hook) and adds 'power' and 'knowledge' buy orders.
   - lib.cjs digAlong aims a full mineGrowReach ahead.
   - lib.cjs gains a 'naive' policy.

**Acceptance.** 1. botrun, 12 seeds, fresh saves: run 1 banks 5 P or more and buys Water I on 12/12. The naive policy does the same on 8/8 seeds.
2. career.cjs 'cheapest', seeds 4242/909/11 x 12 runs:
   - 0 visits that buy nothing in runs 1-5, and at most 1 in runs 1-10 per save (today 29%);
   - mean P of runs 10-12 is at least 1.4x the mean of runs 1-3.
3. No upgrades, seeds 909/4242/11: the diver banks at least 1.2x the P of the farmer (bot {maxDepthM:40, lateral:true}); today it is about 0.5x.
4. Run 1 at paceMs 1700 over 8 seeds: median 45-65 s.
5. Reveal. The first store on a fresh save shows exactly Water tank and Grow strength. After a scripted 45 m dive, Heat tolerance appears with NEW; after a worm attach, Mucus flasks appear.
6. Tolerance maxed: mineHeatLines returns [98, 140]; mineGrowCost is 8 at 150 m, 4 at 120 m and 2 at 90 m.
7. Migration. A save with water 4, oreYield 3, pocketWater 2, heatTolerance 2 and excreteCharges 1 loads with p.mineUpgrades {} and minerals raised by exactly 345. A reload adds nothing.
8. Rich seams. On 3 seeds x 6 chunks, 20-30% of deep seams are rich and each pays 6. The '#mine,4242' state.mineChunks records for chunks 8-12 are identical to a snapshot taken before the change.
9. End screen. It shows 'Depth' and 'Phosphorus seams' rows and materials by name. Buy then Descend reaches a live run in 2 clicks.
10. store-check and the mine-check economy, store and fuel-curve pins are updated deliberately, with every old and new number recorded in CLAUDE.md. --mine is green.

**Risk.** - Every probe that walks nextCost will read new numbers.
- The refund must use the OLD ladders and be flagged and written in the same save.
- startWater moves every fuel-curve assertion: re-measure, never widen a tolerance.
- Keep single-currency rungs, which is what costParts supports today.


### M6 — Threats you can read and answer

**Goal.** Worms and mould stop ending runs arbitrarily: each can be seen coming, avoided with skill, and answered decisively by one bought item.

**Changes.** All changes are mine-only overrides on the cfg clone in configForLevel (32461-32493), next to the existing trych overrides.
1. FLASK. mineUseExcrete (22549) mine branch: nematodes.killHits 1 and actions.excrete.range 160, so one use kills every worm attached to, or within 160 units of, a clean strand.
   - Toast: 'Mucus burst — N worms killed'.
   - A burst with nothing in range costs nothing.
2. BREEDING. The stepNematodes mine branch (17598-17760) breeds only while mineAttached < CONFIG.mine.worms.maxAttached (6). cfg.nematodes.maxPopulation is raised to 64 as a safety bound.
3. WORM VISIBILITY.
   - drawNematodes (40150) draws attached worms at 2.5x with a 1 Hz pulsing ring.
   - Off-screen attached worms get edge chevrons (hook __game.mine.chevrons()).
   - A tap on #hud-worms pans to the nearest attached worm.
4. MOULD. CONFIG.mine.trych gains moveSpeed 0.5 and firstTouchRings 6, applied at 32476-32478.
5. ENZYME. mineUseAmputate (22563) mine branch:
   - flood the connected infected component nearest the tap (within 300 units) over parent/child links;
   - add the clean nodes within one segment (25.5 units) of it;
   - remove them through net._removeNodes (16943) and clear cell.trich there;
   - with no rot in range, refuse and keep the dose.
6. CLOCK. A save's first infection gets 30 s (p.mineSeen.rot); later ones get 20 s.
7. COPY. The rot banner copy; one-shot tips on the first worm attach and the first rot. Tile copy:
   - Flask: 'Kills every worm on or near the colony.'
   - Enzyme: 'Tap the rot: one dose cuts out one whole patch of rot, and only the rot.'

**Acceptance.** 1. Flask probe (3 worms parked attached, as in probe_counter):
   - the drain over the 10 s after one flask is 0 (today 1.9);
   - mineAttached reads 0 within 1 tick;
   - the toast contains 'killed'.
2. Breeding soak (1 attached worm, 6 chunks generated, 60 s with no flask): attached worms reach 2 or more in at least 4 of 5 trials and never exceed 6.
3. Cloud probe on 5 seeds: from the tick a cloud first senses a strand 280-300 units away, contact takes 6 s or more.
4. Breach probe on a 150-strand colony, 5/5 seeds (breach-probe pattern):
   - first contact infects 25 strands or fewer;
   - one dose at the breach centroid leaves 0 infected, state.mineInfect null within 1 tick, and at most 15 clean strands removed.
   - With two separate contacts, one dose leaves the clock running and two doses clear it.
5. The first infection clock on a fresh save reads 30 s; the next one reads 20 s.
6. An off-screen attached worm gives chevrons().length 1, and tapping #hud-worms moves the camera to within 100 units of it.
7. Career (useItems; buys the flask and enzyme when offered), 3 seeds x 12 runs:
   - infected endings in runs 4-12 are 20% or fewer (the playtest saw about half);
   - the median worm drain per run is 3 water or less.
8. threat 116/116 and mould 20/20 are unchanged.

**Risk.** - killHits, excrete range and moveSpeed are shared config keys. Only the mine's clone may change them, or the campaign's tuned mould breaks.
- Removing only the rot orphans clean children. By design they keep living, since _removeNodes never cascades; assert that the colony stays one live network.


### M7 — Journey I, part 1: fixed leg worlds with a taproot in the east (generator)

**Goal.** The generator can build any leg: hill west, a taproot chamber under an east island, a closed crust and a broken shallow road, all deterministic, reachable, corridor-free, and without moving a single free-layout seed. Players are unaffected: DIG still starts the free descent.

**Changes.** 1. CONFIG. CONFIG.mine.journey {homeChunk: 1, islandCols: 12, taprootR: 2.5, landfallCells: 1.5, legs: rows 1-3 of the leg table}. Each row carries its seed, E, taproot depth, sealByBand and rule.
2. LAYOUTS. mineLevelDef(config, seed, {layout, journey, leg}) (21545).
   - 'free' is today's layout.
   - 'journey' sets layout.homeCol in chunk 1 (column 36), plus layout.islandC0/C1 and layout.taproot {col, row}.
   - mineHomeChunk (21576) and buildLevel (19412, hill soil 19440-19444) read layout.homeCol instead of cols>>1, and the island's surface columns are soil.
3. GENERATOR. In mineGenerateChunk (21610), journey layout only:
   (a) The crust clamp at 22219 and 22260 becomes surfaceY + 0.05 cs.
   (b) The seal draw at 21703 compares against leg.sealByBand[bandOfRow(gr)]. The draw itself is unchanged.
   (c) The island chunk carves the taproot chamber and runs the flood-and-repair generalized from 21995-22064, from the chamber to the nearest gallery cell on either seam.
       - It uses mineChunkRng(seed ^ 0x7A9, ci), after every existing draw.
       - noPlug covers the chamber and its connector.
4. SAVE AND ROUTES. beginMineRun (32747) reads p.mineJourney {journey: 1, leg: 1, legs: {}} (defaulted in loadProgress 13685; absent means leg 1) and uses the curated seed. enterGame (40446) accepts '#leg,<j>,<l>'. The plain DIG still starts the free layout until M8.
5. DRAWING.
   - drawMineHill/mineHillSpan (40096-40113) take a list of hills; the island uses the goalhill/goalbush art.
   - drawMineTaproot() draws a pulsing mint knot (radius about 40 units) and short filaments that fade within about 6 m.
6. LEGPROBE. tests/bots/legprobe.cjs boots '#leg,<j>,<l>' (or a candidate seed), generates the chunks from home to island, floods the fine mask from the home head, and reports:
   - reachable, and the path ratio;
   - the cheapest-water route (Dijkstra over fine cells, bare price by depth, grow 2), with its water and its share of east metres below 42 m and below 84 m;
   - the longest straight lateral channel at least 3 cells tall.
   It picks each leg's seed from 50 candidates.
7. tests/journey-check.cjs joins run.mjs --mine.

**Acceptance.** 1. '#leg,1,1': the home column is 36 (chunk 1), the island span is in chunk 5, and the taproot is within 1 cell of 96 m east / 24 m deep.
2. Two boots of '#leg,1,2' give identical state.mineChunks records for chunks 0-8, and the same taproot.
3. The '#mine,4242' chunk records for chunks 8-12 are byte-identical to the pre-M7 snapshot. mine-check's 190 free-layout pins are unchanged and green.
4. Legs 1-3: the fine-mask flood from the home head reaches the taproot chamber on 3/3, and the shortest path is 1.3-2.0x the straight line.
5. Crust. On legs 1-3, a flood restricted to rows 0-2 from the home head never passes column 66 (home + 30).
6. Legs 2-3: the cheapest-water route spends at least 50% of its east metres below 42 m.
7. No corridor. No lateral channel at least 3 cells tall runs straight for more than 36 cells on legs 1-3.
8. No creature is placed above row 42 on any leg.
9. One resting-zoom screenshot per leg, around a sealed seam, is attached to the milestone report, showing that the seams read as ordinary rock.

**Risk.** - This is the largest generator change. Rng call order is load-bearing: every new pass is journey-only, and either appended or on its own hash rng.
- The owner has rejected a visible reserved route twice. Measure with the channel probe and screenshots before calling it done.
- Curated seeds must be re-picked whenever the carve changes.


### M8 — Journey I, part 2: landfall, the next leg, visible progress

**Goal.** The game gets a destination: DIG starts Leg 1, reaching the taproot roots the colony on the island and opens the next fixed world, and every attempt leaves visible progress.

**Changes.** 1. LANDFALL. mineIslandReached(state) in __m_engine_mine checks for any clean node within 54 units of layout.taproot. mineFrame calls it after mineDepthReached (~37307), then mineEndRun(state,'island').
2. PAYOUT AND CELEBRATION. presentMineEnd:
   - adds the island bonus (20 / 30 / 40 ...) on the first landfall;
   - increments p.mineJourney.leg and records legs[L] {runs, bestDepth, bestEast};
   - showMineEnd shows ROOTED and the landfall copy;
   - startCelebration (33442) plays with an 'island' side via hillRiseAtX (33429), the filaments lighting from the knot to the hill.
3. EAST PAYS. The east term of the reach payout turns on: mineMaxEast = max over clean nodes of (x - homeX)/cs metres. The HUD shows '-> 64 m' on legs.
4. ENTRY. The plain DIG, and the title's 'Continue · Leg N of 8 · <name>', start the journey. The free layout remains for #mine and, from M13, the Daily Dig.
5. JOURNEY STRIP. 8 dots, the current one lit, on the title (mineMenu 29737), the end screen and the store header.
6. LEG BANNER AND HINTS.
   - At every run start, a leg banner (showMineBeat style, 2.2 s) with the rule line.
   - On a leg's first run, a 5 s east-edge chevron: 'Island N is east'.
   - An 'ISLAND N IN SIGHT' beat when the hill or the knot enters the view.
   - At first sight, the tip 'Reach the island's root to move on'.
7. RECORDS IN THE WORLD. Per-leg dashed lines for best depth and farthest east, each with a one-shot NEW DEEPEST / NEW FARTHEST beat. Hook: __game.mine.records().
8. TELEMETRY. run_end detail becomes 'L<leg>:<cause>:e<east>'. A new logEvent('island', {n: runs on the leg}).
9. JOURNEY BOT. tests/bots/journey.cjs is career.cjs with the taproot as the BFS goal (Q.step {goal:'island'}), following legs through the real end screen and store.

**Acceptance.** 1. Landfall. A growFrom that lands a clean node within 54 units of the taproot:
   - runOver within 1 frame, with cause 'island';
   - #ssMineEnd shows ROOTED;
   - p.mineJourney.leg goes 1 -> 2;
   - the next Descend boots leg 2's seed with the home column at 36.
2. The wallet delta on landfall equals max(5, floor(depth/5) + floor(east/10)) + seam P + 20.
3. journey.cjs (sensible bot, cheapest buyer, paceMs 900), fresh saves 4242/909/11:
   - landfall 1 by run 5 or earlier;
   - landfall 2 within 7 more runs, and landfall 3 within 7 more after that.
   - The naive policy makes landfall 1 by run 8 or earlier.
4. Records. After a run that reached E m east:
   - records().farthest equals E ±1;
   - the line draws (a pixel diff of on against off of 20 px or more);
   - crossing it on the next run fires exactly one NEW FARTHEST beat.
5. Telemetry. An intercepted run_end has ms > 0 and a detail matching /^L\d+:\w+:e\d+$/, and there is exactly one 'island' event per landfall.
6. After landfall 1 the title reads 'Continue · Leg 2 of 8', and the strip shows 1 island lit.
7. --mine is green, with the free-layout pins untouched.

**Risk.** - 'Full payout either way' must hold for every cause.
- A worm or rot death that builds its own runResult must still carry the leg and the depth, via presentMineEnd's fallback that reads state.


### M9 — Journey I, part 3: legs 4-8, escalation, the Promised Land, long-run performance

**Goal.** The journey is whole and finishable, each leg teaches one rule, the ending is real, and 3-4 minute late runs stay smooth.

**Changes.** 1. LEGS 4-8. Rows 4-8 of CONFIG.mine.journey.legs, with curated seeds from legprobe. Their rules are applied in configForLevel (32461-32493): threatBands per leg, reservoirsPerBand made per band, richChance, heat.safeDepth and sealByBand.
2. CONFIG READS. mineBeat (37244-37251), mineZoom (37143) and mineClampZoom (37161) read state.config.
3. THE PROMISED LAND.
   - A double-width island hill with trees (existing art) and the cause 'promised'.
   - The finale: ROOTED -> the camera pulls back -> the canvas journey strip fruits island by island, 300 ms apart, over a rising chord -> 'The Promised Land. Your colony spans the world.' -> showCredits.
   - The run is banked before any of it animates.
   - p.mineJourney becomes {journey: 2, leg: 1, done: [1]}; the title gets the 'Journey I' badge and 'Begin Journey II'. Its rules land in M13; until then Journey II replays Journey I's seeds.
4. PERFORMANCE.
   - Cache the colony x extent and the shallowest and deepest clean tips incrementally in mineGrow, invalidated by _removeNodes, rot and worm removal.
   - mineCheapestCost, mineDepthReached, mineFollowCamera and mineEnsureChunks read the cache.
   - waterSourcesNear tests only the nodes grown since the last check.

**Acceptance.** 1. Legs 1-8 are flood-reachable (8/8), with taproots within 1 cell of the table and a path ratio of 1.3-2.0.
2. legprobe, per leg:
   - with the table's arrival kit, navigator water to the taproot is at most 70% of (start water + half the route's pockets);
   - with the bare kit it is over 100% on legs 3-8;
   - on legs 7-8, at least 40% of east metres are below 84 m.
3. Rules.
   - On leg 7, state.config.mine.threatBands equals the table row.
   - On leg 6, mineHeatLines returns [36, 78, 120], shifted by tolerance, and the beat names the right band.
4. Scripted leg-8 landfall:
   - the wallet rises before the finale animates;
   - the credits are reachable;
   - p.mineJourney.journey is 2;
   - the title shows the badge and 'Begin Journey II'.
5. Performance, on a leg-8 state at 4,000 nodes, 390x844, headless:
   - renderFrame median 20 ms or less, p95 33 ms or less;
   - mineFrame 2 ms or less;
   - at most 2 full O(nodes) passes per frame (counter hook).
6. --mine is green.

**Risk.** - Late legs push node counts to 3,000-4,000, and island chunk 16 needs streaming ahead of the colony (mineEnsureChunks preloadCols).
- The caches must be invalidated on every removal path.
- If the bots show human overhead above 2.6x, shorten legs 7-8 rather than cheapen the rungs.


### M10 — Compasses: sell precision, through rock

**Goal.** Complete plan item 08. Bought needles point through rock (a bearing, never a route) to the island's root and to each material, so 'find garnet' stops being a random walk and the island's distance becomes a near goal.

**Changes.** 1. TRACKS. compassIsland [12, 40 P]; compass_anthracite [20, 60 P, 12 A]; compass_garnet [40, 100 P, 12 G]; compass_hematite [60, 140 P, 12 H].
   - The material tracks are generated from CONFIG.mine.materials in STORE_UPGRADES.
   - Each is gated by p.mineSeen: the island compass at visit 2 on a journey save, a material compass at the first seam of that material.
   - configForLevel folds them into cfg.mine.compass.
2. TARGETS.
   - The island needle points at the taproot from the leg def, which is always known.
   - Material needles use seams in generated chunks only.
   - mineEnsureChunks (22325) gains a look-ahead: within 2 chunks of the colony's extent, it generates at most one chunk per requestIdleCallback slot (falling back to setTimeout 300 ms).
3. DRAWING. drawMineCompass() is drawn after drawNematodes (~37720).
   - Edge-of-screen needles on the straight bearing from the focus strand's screen point, through rock.
   - Rung 2 prints metres. Rung 3 targets the richest unclaimed seam within 90 m.
   - A needle fades when its target is on screen. At most 4 needles, never inside a HUD rect.
   - The worm chevrons reuse this renderer.
4. HOOK. __game.mine.compass() exposes the model values.

**Acceptance.** 1. With nothing bought, compass() returns [] and the pixel diff at the screen edges is 0.
2. Bearings and distances.
   - The bearing is within 2 degrees of atan2(target - focus), and the distance within 1 m.
   - Stamping a rock sprite between the focus and the target leaves the bearing unchanged.
3. The rung-3 target is the unclaimed seam of that material with the highest rich value within 90 m, among generated chunks.
4. Free-layout chunk stats are identical with the look-ahead on and off, i.e. whatever order chunks are generated in.
5. Idle generation produces no long task over 50 ms (PerformanceObserver 'longtask').
6. Bots.
   - journey.cjs with both island-compass rungs completes leg 3 in no more runs than the no-compass bot (median over 3 seeds).
   - A seam-hunter with the garnet compass at rung 2 reaches its first garnet seam in 0.6x the digs or fewer.
7. At 390 px, no needle rect intersects a HUD rect.

**Risk.** - The look-ahead changes when chunks generate, not what they contain. That rests on the order-independence invariant, so assert it.
- HUD real estate: needles live at the screen edges only.


### M11 — The oxalic vial: the bought way through rock

**Goal.** The owner-sanctioned rock-through consumable turns stranded seams and one stubborn wall into decisions, and rock stays a wall for everyone who has not bought one.

**Changes.** 1. TRACK AND KIT. The track oxalicVial [50 P, 12 G, 12 H], revealed at the start of leg 3.
   - A third kit button (hud markup 26412-26418).
   - onMineItem (35957) arms state._mineArmed = 'vial'.
   - The aim arrow turns acid-yellow and outlines the rock it would cross.
2. THE DIG. growDirected gets a rockBudget option (world units allowed inside rock, default 0), honoured only when sub.mine is set and the vial is armed.
   - The first 108 units (3 cells) or less of the dig may pass through rock, and the path must reach open ground.
   - Before anything is charged, it is pre-checked by sampling solidAtWorld along the aim.
3. OUTCOMES. A refusal ('Too thick for the acid') keeps the vial and the water. On success the vial count drops by 1, and the tunnel nodes are flagged n.acid and drawn amber over the rock with an etched halo. The mask is untouched.
4. TOLERANCE ELSEWHERE. Worm line of sight, cloud contact, harvest claims and the 'no living nodes inside _fineSolid' check all tolerate n.acid nodes.

**Acceptance.** 1. A 2-3 cell wall between a strand and a stamped seam:
   - the armed dig creates nodes beyond the wall and claims the seam;
   - the vial count drops by 1;
   - _fineSolid is byte-identical before and after.
2. A 6-cell wall: refused, with the vial and water unchanged.
3. With no vial: 'Solid rock that way'.
4. An ordinary dig from the tunnel's far end succeeds.
5. The tile is hidden before leg 3.
6. threat, mould and harvest stay green.

**Risk.** - The shared collision path must be gated strictly on sub.mine && armed.
- Keep the budget small, or the vial becomes the general rock-eater the premise forbids.


### M12 — Juice: every payout and threshold is felt

**Goal.** Every payout, threshold, threat and record is heard and felt as well as counted, on a phone, without fatigue or frame cost.

**Changes.** 1. SOUNDS. The remaining synthesized cues go in __m_render_sfx (24820), per the feedbackAndJuice table, wired at their hook sites:
   - the band gong and price hiss (mineBeat 37244);
   - the refusal thud (mineGrow);
   - the worm click (the mineAttached delta at stepNematodes 17760);
   - the flask splat, enzyme snip and acid fizz (onMineItem 35957);
   - the rot sting, the heartbeat under 10 s and the relief chime (mineInfectionCheck 22582, the HUD .urgent state 27215);
   - the record arpeggio, the island sparkle and the end chords (mineEndRun 22714);
   - the count-up ticks and the buy chime (renderUpgrades 29204).
   The seam ping rises a semitone per consecutive seam (capped at +12). A 6-voice cap, and window.__sfx.counts throughout.
2. SETTINGS. 'Vibration' (navigator.vibrate patterns) and 'Reduced motion' (no shake, no count-up animation), persisted by extending saveSettings (32206-32209).
3. CAMERA. A 3 px, 150 ms micro-shake in mineFollowCamera (37198) on a price line, a flask burst and 'island in sight'.
4. LEGIBILITY. The water chip gets .low with 'N left' at 3 digs or fewer; the price chip pulses when the price changes; kit buttons pulse while their threat is present.

**Acceptance.** 1. A scripted run on #mine,4242 (a seam and a pocket stamped at the colony, a worm spawned, a cloud touched, a line crossed, a record beaten, a buy): __sfx.counts ore, pocket, line, beat, worm, rot, flask, enzyme, runEnd and buy are each 1 or more. With sound off, no oscillator is created.
2. With Vibration on, the navigator.vibrate stub is called on a seam and on a pocket; with it off, it is never called.
3. With Reduced motion on, the camera offset stays 0 through a line crossing.
4. The water chip has .low and 'N left' exactly when water < 4 x costHere.
5. A sight-perf-style A/B at 16 worms: frame p95 regresses by 1.0 ms or less.

**Risk.** - Voice stacking and loudness on phones: cap the voices and keep the master gain low.
- The attach rings and record lines are separate marks. Do not add a fifth sensing-ring treatment.


### M13 — Come back tomorrow: fossil, Daily Dig, New Journey, strains

**Goal.** Give a reason to return on day 1 and through week one, and a long tail after the Promised Land, all local-first and all reusing existing systems.

**Changes.** 1. FOSSIL. At the end of a run on a leg (not a landfall), up to 300 quantised points (cell x/y plus parent delta) are saved in p.mineJourney.legs[L].fossil, 3 KB or less. They are drawn at 20% alpha, desaturated, under the colony, and cleared at landfall. Hook: __game.mine.fossil().
2. DAILY DIG. A title button, 'Daily dig · 25 Sep', appears after landfall 1.
   - It plays the free layout with seed = hash(UTC yyyymmdd).
   - A fixed kit through configForLevel, ignoring store levels: water 108, grow 4, tolerance 2, 1 flask, 1 dose.
   - The score is the deepest clean depth.
   - The first run of the UTC day pays seams + half the reach; later runs are 'practice', scored but unpaid.
   - p.mineDaily {date, best, streak, lastDate}. The streak is shown and pays nothing.
   - 'Copy result' (navigator.clipboard).
3. OPTIONAL GLOBAL BOARD. submitGlobalScore (14732) and fetchGlobalBoards (14716) use mode 'mine-daily', only after a probe request succeeds, and normMode (14594) accepts it. The SQL for the owner goes into docs/leaderboard-setup.md.
4. NEW JOURNEY. The rules are folded into configForLevel from p.mineJourney.journey:
   - J2 Hotter: safeDepth -10.
   - J3 Thirsty: start water -12.
   - J4 Hungry: worms x2, 0.3/s.
   - J5 Rotten: mould from 42 m, clock 15 s.
   - J6 Stingy: pockets +7.
   - J7 Far: islands +2 chunks, at most chunk 19.
   - J8+: all of them.
   Curated seed tables for J2-J4 come from legprobe, including the E+2 variants; J5+ cycle them.
5. STRAINS. The shelf is revealed only after the Promised Land: Amber 150, Violet 250, Ghost 400, Coal 600 P, plus a unique strain per completed journey (Gold for J1). cfg.mine.tint is read by the network renderer (25529).
6. RETURNING TITLE. 'Continue · Leg N', 'Daily dig', 'Store', a records line, and the near-goal line.
7. TELEMETRY. A 'daily' event.

**Acceptance.** 1. Fossil. After a failed attempt, the next run on that leg has fossil() at 20-300 points; the save grows by 3 KB or less per leg; the pixel diff of on against off is above the threshold; it is cleared after landfall.
2. Daily seed. Two contexts with the same mocked UTC date get the same seed and chunk stats; the next date differs. The kit is identical whatever the store levels.
3. Daily payout. The first run pays seams + floor(reach/2); the second shows 'practice' and banks 0. The best updates only on a better depth. Across mocked days, the streak goes 1, 2, 3, and a gap resets it to 1.
4. Board. With MYCELIUM_SUPABASE blank: 0 requests to the host, 0 console errors, and the board labelled 'local'. With a stub that accepts POSTs: exactly 1 submission per paid daily run.
5. New Journey. 'Begin Journey II' gives a leg-1 seed different from Journey I's, and the heat first line = 32 + tolerance.
6. Strains. The shelf is absent before the Promised Land and present after it. Buying a strain shifts a sampled strand pixel's hue by 30 degrees or more and debits the wallet.
7. Copy result writes 'Deep Mine daily <date>: <depth> m · streak <n>' (clipboard permission granted).

**Risk.** - Use UTC everywhere.
- The clipboard needs a user gesture.
- The global board has no anti-cheat (the anon key and hooks are public), so label it casual.
- New Journey rules must bite a full kit: run legprobe margins on J2.


### M14 — Tune the numbers against the journey

**Goal.** Phase 4, measured rather than felt: one numbers-only pass that brings the bot-measured journey onto the numbers model's gates, with every table recorded.

**Changes.** 1. NUMBERS ONLY, in CONFIG.mine (startWater, reach rates, pilesPerBand per band, richChance, cloud moveSpeed), STORE_UPGRADES and CONFIG.mine.journey.legs (E, taproot depth, sealByBand). No new mechanics.
2. THE MODEL. Commit the career model from this design as tests/bots/econ-model.py, with the measured inputs replaced by legprobe/journey.cjs numbers:
   - descent digs per band;
   - lateral digs per chunk by band;
   - human overhead from the pace runs.
3. BOT VARIANTS. journey.cjs gets the cheapest, power-first and knowledge-first buyers, at paceMs 900 (routing) and 1700 (durations).
4. REFUNDS. Any shortened ladder gets its own refund flag in migrateProgress.
5. CLAUDE.md gets every measured table and the PROGRESS line.

**Acceptance.** Every gate in the numbers model, section F, passes on 5 fresh saves x 3 buyer variants:
- run 1: 45-65 s, and a Water I buy on 100% of saves;
- visits that buy nothing: 0 in runs 1-5, at most 1 in runs 1-10, and 25% or less overall;
- landfall 1 at a median of run 3-5;
- no leg median above 7 runs, and no leg above 10;
- the Promised Land in 35-50 runs, or 70-110 min at the pace multiplier;
- store 85% or more bought at the final landfall, and 100% not before leg 8;
- material balances within 3x their remaining demand while demand remains, and 60 or less after;
- leg 7-8 runs at a median of 150-240 s;
- per-leg route water within the calibration rule;
- dives 15-35% of runs on legs 3-7;
- diver at least 1.2x the farmer.
In addition, econ-model.py re-run with the measured inputs reproduces the bot runs-per-leg within ±25%.

**Risk.** - Bots route better than humans. Keep the pace multiplier and the 70%-of-supply margin, and re-check run 1 by hand.
- This pass comes after all generator work, because every density change has moved startWater before (20 -> 30 -> 44 -> 84).


### M15 — Release hygiene: boot, desktop, perf gate, analytics, docs, final cut

**Goal.** The build boots fast, looks finished on desktop portals (81% of itch traffic), has a performance gate, reports what the owner needs to know, and ships as a verified zip.

**Changes.** 1. BOOT DIET. _bootImgs (40486) skips card faces and portraits when only the mine is offered (gated on the OFFER flags), and the four band folders preload during the loader.
2. DESKTOP GUTTERS. When the viewport aspect is above 0.75: the journey strip and records on the left; the next goal and today's daily on the right. Nothing may overlap playSurfaceRect (36893) or take pointer events from the canvas.
3. PERF GATE. A mine perf check in run.mjs: renderFrame p95 at 3000 strands and 16 worms, at 390x844.
4. ANALYTICS. docs/analytics.html gets a mine column, depth and leg histograms, a D1/D7 cohort table and a first-session funnel (tutorial ids), through scripts/gen-analytics.mjs.
5. DOCS. CLAUDE.md (the PROGRESS line, the corrected box-in record) and docs/mine-plan.html are updated.
6. THE FINAL CUT: make-web-zip, then itchzip-check on the built zip.

**Acceptance.** 1. Boot: 60 or fewer requests before #loadscreen.ld-ready (159 today), and boot-to-ready of 1.0 s or less locally.
2. At 1280x720 the gutter panels are visible, and their rects do not intersect playSurfaceRect.
3. Perf: renderFrame p95 of 25 ms or less at 3000 strands with 16 worms (software raster).
4. analytics-check passes with a mine fixture.
5. Full `node tests/run.mjs --mine` is green, including the zip and perf checks.
6. itchzip-check on the built zip is green.

**Risk.** - The boot diet must not break the hidden campaign's boot: gate it on the OFFER flags.
- The zip entry cap once the campaign folders are pruned.


## Rationale

WHAT I BUILT ON
The spine is retention's proposal: its player-facing spec, its first-minute design and its fine milestone granularity. Both judges ranked it the safest to build one verified step at a time, and its acceptance tests were the most concrete. Its M1-M5 (every run ends, a phone player can play, the first minute teaches itself, every run pays, the threats have answers) give the most player value per unit of risk. That is why they come first and ship even if the journey slips.

I changed retention's journey. It put the goal on the surface, and economy measured that the top of row 0 is 5-7% solid: a surface island is a threat-free crawl that never needs depth. The journey is now a fusion of the other two proposals:
- From craft: the TAPROOT as the leg goal, a knot under the island at a depth that grows each leg; curated Journey-I seeds chosen by a legprobe; new carving only in the island chunk, on its own hash rng; the five-system budget; one named rule per leg.
- From economy: the finding that going right must mean going down.

The judges disagreed on economy's structural answer. Judge 2 wanted its walls and trunk row as the spine. Judge 1 rejected them as a reserved corridor in all but name. I took a third route that satisfies both:
- Close the crust in journey worlds only: rock may reach the surface, where today it is clamped below surfaceY + 0.5 cell.
- Raise the existing gallery seal chance in the bands above each leg's crossing band. It is drawn per band, and the draw itself is unchanged.
No row is reserved or forced open, and no wall is painted. Reachability comes from curated seeds plus the island-chunk repair. The acceptance measures both halves: on legs 2-3 the cheapest route spends 50% or more of its east metres below 42 m, and no straight lateral channel is longer than 36 cells.

WHAT ELSE I GRAFTED
- From economy:
  - the reach payout, with its running maxima and minimum of 5;
  - Water I priced at exactly that 5 P minimum, so run 1 buys by construction;
  - single-currency rungs keyed to the band material, each tile saying where the material is found;
  - rich seams (1 in 4, pays 6), hash-derived outside the rng;
  - banking on a hidden tab;
  - a FRUIT NOW pill that shows what it will bank;
  - a committed career model and its tuning rule (70% of supply with the expected kit).
- From craft:
  - heat tolerance as 4 rungs of +14 m, so the first line reaches 98 m at most and 4 and 8 always exist;
  - the enzyme cutting the whole connected rot component;
  - the fall-through limit that closes the heat bypass.
- From retention:
  - the first visit skips the title;
  - the ghost finger, #minehint, tap-to-dig and the dead-end nudge;
  - the next-goal card with an inline Buy, and Descend as the primary button;
  - the juice list with its countable __sfx hooks;
  - per-leg best lines and the fossil;
  - the milestone order and its risk notes.

CONFLICTS I DECIDED
- SOFT-LOCK RULE. The countdown triggers on water < costHere, the number the chip already shows. I did not use economy's working-front radius. That radius hides a stuck player behind an affordable strand they may not see. Mine is one readable number, any successful dig resets it, and FRUIT NOW is always visible. Dead time is capped at 6 s.
- REACH RATE. Depth pays 1 P per 5 m, but east pays 1 P per 10 m, not 1 per 5 m. My model showed east at 1 per 5 m flooding about 1,200 surplus P over the store. Paying depth double also nudges players down, which is the premise.
- JOURNEY LENGTH. 8 legs, not 10, and 35-50 runs, not 70-90. Craft's length is grind for portal players; economy's 26-40 is short for 'max time'.
- POCKETS stay a flat +10 (the owner's number); band scaling is rejected. Tolerance cannot make a pocket a net loss at the crossing depth, because the leg rows keep the crossings at 2-4 a dig with the arrival kit.
- DAILY DIG. Fixed kit and one paid run a day; the streak is shown but pays nothing.
- COSMETICS only after the ending.
- COMPASS TARGETS. Lazy idle look-ahead rather than eager generation of the whole leg; the island target comes from the leg definition.
- THE VIAL is a pass-through; the collision mask is never edited.
- TAPS. A tap digs; double-tap is dropped.
- DEAD-DIG REFUND rejected: it misses the measured failure, sideways digs that do take new cells. The glowing-tip nudge teaches instead.
- ROT CREEP is not touched: infectNetwork's tuning is shared, and a whole-component cut makes creep irrelevant.
- NUMBERS. startWater 60, so run 1 is about 30 digs, 45-65 s, and banks one upgrade. Flask range 160. Breeding capped at 6 attached. Mould moveSpeed 0.5, tuned against a measured 6-second-or-more contact.

WHAT I REJECTED OUTRIGHT
Economy's walls, forced trunk, climb back up and Heat VI; economy's band-scaled pockets and eager generation; craft's multi-part prices, mask-editing acid, 10 legs and single 'To the store' button; retention's surface island, offline income, paid streak, mid-journey colour shelf and stack of small P sources; and any teeth on the infection. The full list is in cutOrDeferred.

THE RECORD, AND THE STARTING POINT
I have not designed around 'box-in'. It does not exist (0 of 39 route-planning runs), and the record is already corrected in ce89c7c. The test prerequisites (the navigator in mine-check, the boot stub, 0/0 counted as BROKEN) also landed, in e6cf455 and ce89c7c. So M1 starts from a green, trustworthy suite (mine 190/190, boot 20/20, store 124/124), and index.html is unchanged since the architect's line map, so every cited line number holds.

HOW THE NUMBERS WERE CHECKED
I built a career model (scratchpad final/model.py and sweep.py, 40 seeds) on the measured route costs. It projects:
- Journey I in 35 runs (32-37) and about 70 minutes at 1.7 s a dig;
- first landfall on run 3;
- a store 97% bought at the ending;
- run 1 at about 62 s, banking 12-13 P and buying Water I.
It also exposed three gaps that M14 must close with named knobs:
- visits that buy nothing are 34% overall, concentrated in legs 5-6 and 8;
- anthracite runs into surplus after leg 5;
- about 600 P is left at the ending, which is intended for strains but should be checked.
The numbers model states all of this.


## Questions for the owner

- Optional, and only you can do it: do you want a global Daily Dig board? It needs the SQL migration that M13 writes into docs/leaderboard-setup.md, which accepts mode 'mine-daily' and a level above 100, run in your Supabase project. Without it the daily stays local-only and shows no errors. Nothing else in this plan waits on you.
