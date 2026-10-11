# itch.io store description

The text to paste into the itch project page. Kept here so the next revision starts from what is
actually up rather than from memory.

**Every number in it is checked against the build** — see the table at the foot, which names the
constant in `index.html` each one comes from. Earlier versions went wrong as the game changed
("procedurally generated levels", "12 playable species", a Survival mode withdrawn from the build and
left advertised), which is the reason this file exists. **The shipped game is now THE DEEP MINE
alone** (`OFFER_CAMPAIGN` and `OFFER_SURVIVAL` both false; the title offers one door), so the card
game's copy that used to live here is gone — it describes nothing a player can reach.

---

Like Mycelium? Please [rate it](https://pallkvaran.itch.io/myceliumc1/rate?source=game) on itch!

**Mycelium: The Deep Mine** is a real-time maze-runner about a fungal colony digging its way east
through the dark. Drag from your mycelium to grow; every dig costs water, and when the water runs out
the colony fruits, spores, and banks what it found.

Rock is a wall, not a material — mycelium does not eat stone. The ground is a maze of corridors and
slabs, and the only way across it is the way you find.

**The journey**

* Eight legs, one island each, from First Light to the Promised Land. Reach the island's taproot and
  your colony takes root there; the next descent starts from it.
* Going east means going down. From the second leg on, the shallow galleries are walled off at more and
  more of their crossings, and the islands' roots run deeper — 18 m under the first island, 128 m under
  the last.
* Four bands of rock on the way down — magnetite, anthracite, garnet, hematite — each with its own
  colour of soil and its own seam to find: Phosphorus, Anthracite, Garnet and Hematite.
* Your last failed attempt stays on the map as a faint fossil, so a dead end is something you know.

**The clock is water**

* You start with 60 water and every dig costs 2 — until the price lines. Past 42 m a dig costs 4,
  past 84 m it costs 8, and so on, doubling at each line.
* Water pockets give +10, once each. Seams pay the material of their band.
* When no dig you can afford is left, the colony fruits after six seconds — or press Fruit now and
  bank it immediately. Closing the tab banks it too.

**What lives down there**

* Nematodes latch on and drink your water. A Mucus flask kills every worm on or near the colony.
* Trichoderma: one touch of the mould and a rot clock starts — 30 seconds the first time you meet it,
  20 after. Cut the rot out with the Cutting enzyme before it runs out, or the colony fruits where it
  stands.

**Between descents**

* A store with ten tracks: a bigger water tank, a longer dig, heat tolerance that pushes the price
  lines deeper, flasks, enzyme, the oxalic vial that eats through up to three cells of rock, and
  compasses that point through the rock at the island and at the nearest seam of each material.
* A descent that runs its course pays at least 5 Phosphorus; every descent pays 1 for every 5 m of
  depth and every 10 m east, plus the seams, plus a bonus the first time you root each island.

**Come back tomorrow**

* The Daily Dig: the same shaft for everyone that day, with a fixed kit — 108 water, grow 4, two
  rungs of heat tolerance, one flask, one dose. One paid run a day, practice after; a streak.
* Finish the journey and Journey II begins, with a new rule stacked on every later one: Hotter,
  Thirsty, Hungry, Rotten, Stingy, Far.
* Finish your first journey and colony strains open: four for sale, and one more for each journey you
  finish.

Plays in portrait on a phone and in a phone-shaped column on a desktop, with your journey and your
next goal beside it.

Music credits: [Sascha Ende](https://ende.app/en)

---

## Where each number comes from

Every figure above, and the constant in `index.html` that sets it. Re-read these before an upload.

| claim | source in `index.html` | value |
|---|---|---|
| the Deep Mine is the only game offered | `OFFER_MINE` / `OFFER_CAMPAIGN` / `OFFER_SURVIVAL` | true / false / false |
| real time | `setGame('mine')` calls `setMode('realtime')` | always |
| eight legs | `MINE_JOURNEY_LEGS`; `CONFIG.mine.journey.legs` | 8 rows, leg 1 'First Light' … leg 8 'The Promised Land' |
| 18 m under the first island, 128 m under the last | `journey.legs[0].depthM`, `journey.legs[7].depthM` | 18, 128 |
| four bands, their names | `CONFIG.mine.bands[].name` | Magnetite, Anthracite, Garnet, Hematite |
| one material per band | `CONFIG.mine.materials` | Phosphorus (band 0), Anthracite, Garnet, Hematite |
| start with 60 water | `CONFIG.mine.startWater` | 60 |
| a dig costs 2 | `CONFIG.mine.growWaterCost` | 2 |
| lines at 42 m, then every 42 m, doubling | `CONFIG.mine.heat.safeDepth` / `lineEvery` / `maxMult` | 42 / 42 / 8 (so 2 · 4 · 8 · 16) |
| pockets +10, once each | `CONFIG.mine.reservoirWater` | 10 |
| fruits after six seconds when stuck | `CONFIG.mine.stuckFruitMs` | 6000 |
| rot clock 30 s first, 20 s after | `CONFIG.mine.firstInfectionMs` / `infectionMs` | 30000 / 20000 |
| the vial: up to three cells of rock | `CONFIG.mine.vialRockBudget` (108 units, 36 a cell) | 108 |
| ten store tracks | `MINE_UPGRADE_IDS` | water, growSteps, heatTolerance, excreteCharges, amputateCharges, compassIsland, compass_anthracite, compass_garnet, compass_hematite, oxalicVial |
| pay: min 5, 1 per 5 m deep, 1 per 10 m east | `CONFIG.mine.reach` | `minPay` 5, `mPerP` 5, `eastMPerP` 10 |
| ...the 5 only for a descent that "runs its course" | `mineFloorEarned`, `MINE_FLOORLESS_CAUSES` | needs a dig, and not `abandon` (End descent) / `quit` (Exit to title) / `pending` (a closed tab); a Daily Dig has no floor (half the reach on the paid run, 0 on practice) |
| shallow galleries walled "from the second leg on" | `CONFIG.mine.journey.legs[].sealByBand[0]` | leg 1 0.12 (the free carve's own rate — M8 re-picked it for a shallow road), legs 2-8 0.55 → 0.75 |
| the Daily Dig's kit | `CONFIG.mine.dailyKit` | water 108, grow 4, tolerance 2, flask 1, dose 1 |
| the journey rules | `MINE_JOURNEY_RULES` | II Hotter, III Thirsty, IV Hungry, V Rotten, VI Stingy, VII Far |
| strains: four for sale, one per journey | `CONFIG.mine.strains` | amber, violet, ghost, coal (cost); gold … prism (journey 1-8) |
| ...open only after a finished journey | `mineStrainsOpen` | `p.mineJourney.done` non-empty — the shelf is not in the store before the Promised Land |
| the fossil | `mineFossilEncode` / `mineLegApply` | the last failed attempt on a leg, cleared by its landfall |
| phone-shaped column on desktop, panels beside it | `playSurfaceRect` (`frameAspect` 390/844), `mineGutterTick` | aspect > 0.75 and a band >= 200 px |

**What is NOT claimed, on purpose:** a number of rungs per track (they are tuned, and change), any
run length (an output of the tuning), and the eight colonies and 71 cards of the card game (still in
the file, unreachable from the title).

---

## Store tags

Kept here for the same reason as the copy above: so the next store starts from what went up rather
than from memory. The game is on itch, CrazyGames and Newgrounds now, and each asks for tags in its
own vocabulary.

**In priority order — take as many as the field allows:**

```
roguelite, mining, maze, casual, mushroom,
underground, upgrades, singleplayer, nature, real-time
```

- The first five are the DISCOVERY terms for the game that ships now — a real-time descent with an
  upgrade loop between runs (`roguelite`, not `roguelike`: progress carries over). `mushroom` is the
  word a player remembers it by.
- **`deckbuilder`, `cards`, `turn-based`, `strategy` and `survival` are OUT** (M15): they described the
  card game, which is no longer reachable from the title. A tag a player cannot find in the build is
  the same defect this file exists to prevent.
- **`real-time` is IN** for the same reason it was out before: `setGame('mine')` forces real time.
- **A store's own autocomplete beats this list** — a tag nobody else uses is a tag nobody browses.

Spares, for a store with a larger cap: `atmospheric`, `exploration`, `idle-friendly`, `biology`,
`fungus`, `procedural`.

---

## Devlogs

Kept for the same reason as the copy and the tags: so the next one starts from what went up. Newest
first.

### Easier, and much better on a phone  (2026-08-19)

Shipped from `9150414`..`db7e4cf` — nine days and 69 commits, the first upload since 10 August.

**It is easier now**

- **Rot burns out.** A Trichoderma infection spreads for two turns and then stops. What it already
  claimed still dies off, but the rest of the colony is safe from that breach — it used to spread
  until you amputated ahead of it.
- **Every run starts with a free retry**, and the retry button now says where to buy more.
- **Every campaign level got an easier pass**: fewer threats, more food. Level 6 went from nine
  mould clouds to two, level 7 from eleven to three.
- **Water on levels 5, 6 and 7** — six new reservoirs.
- **You start with 10 phosphorus.**

**The store**

- **A new upgrade: Starting level.** Begin a run further in, up to the highest level you have
  cleared. Eight steps, priced like Phosphorus, from 25 Spores.
- **…and you can sell it back**, at exactly what you paid, if you would rather start earlier.
- **Split Gill is 500 Spores**, down from 1000.

**Phones**

- **Growth animates when you are zoomed out.** A phone is always on the low-detail draw path, so a
  grow used to appear whole in a single frame with no filaments extending at all.
- **A map opens fully zoomed out** rather than on your colony. A phone has a third of the pixels,
  so the old opening was a keyhole — you started inside your own colony with no idea where the
  food, the rock or the goal were.
- **The top bar stops overlapping itself** when you have both an income engine and an ability
  installed.
- **The card tray lost a row**: no more filter chips, and ▾ / » Skip sit at the ends of the card
  row instead of owning a line of their own.
- **The molten band at the bottom is a third deeper**, so the core line clears the cards.

**The tutorial**

- **It cannot be quit by accident.** One Next button; the End beside it is gone.
- **The camera stops shoving you around.** Every step frames its subject wider, and finishing hands
  the map back as a full survey view instead of leaving you wherever the last step was looking.
- **Orange piles get a step of their own**, standing on an actual orange pile, rather than being a
  second lesson squeezed onto the step that teaches the drag.
- **The grow step gets the screen to itself** — the tray collapses, and there is a beat to watch
  what you grew.
- **A strategy tip for the mould** on level 3.
- **Desktop players get a line about fullscreen**, with an arrow pointing at the corner the button
  lives in.

**Fixes**

- **A dropped image is retried.** One failed request meant that art — the goal hill, the cities —
  was silently missing for the whole session, and only a reload brought it back. Reported as
  "there was simply no end goal there".
- **The title screen is rearranged**: Campaign on top, Survival below it, Old on the left of each
  and New on the right.

Deliberately NOT in it, recorded so they are not "restored" later:

- **Survival's withdrawal and return is not a bullet, because no player saw either.** It was taken
  off the title screen on 11 Aug and put back on 19 Aug, both between uploads, so the live build
  and this one both have it. Naming it would announce a change nobody can see — and worse, imply
  it had been missing. **The high-score board is the same story** and is left out for the same
  reason: it goes with survival, so it left and came back inside the same window.
- **Nor is real time.** It has been off the title screen since before the last upload and still is.
- **The free-retry bullet rests on `7bccac5` having shipped on 10 Aug** (it set `lives.base` to 0
  that day, and `a6e7493` put it back to 1 on the 11th). The telemetry argument that settled it —
  a new player dying on level 3 with no retry and no Spores — is about real players, so it did.
  If the 10 Aug upload predates that commit, strike this bullet: the live build already had the
  free retry and nothing changed.

### Sharper controls, clearer cards  (2026-08-09)

Shipped from `32183b8` (phone autofocus), `002b34e` (the feel pass) and `192fc37` (the aim fix).

- **Phones: the zoom bug is fixed.** Entering your name no longer makes the browser zoom in — and
  stay there for the rest of the run.
- **Aiming is more forgiving.** Short flicks now register a direction, and the "drag back to where
  you started to cancel" area is 25% larger.
- **Enemy turns are twice as fast.** Same moves, half the waiting.
- **You can tell which card is selected.** The armed card is ringed and lit; the rest of the hand
  steps back.
- **Resources react.** The pill in the top corner pulses when you gain or spend.
- **Hold the right mouse button to drag the map** — including while a card is armed, where dragging
  used to aim instead of pan.
- **Quiet clicks** when you pick a card up and put it down.
- **Skip Round greys out while the enemies are moving**, instead of silently refusing the click.
- The tutorial now covers zoom and drag.

Two things deliberately NOT in it, recorded so they are not "restored" later:

- **The removed "Aiming ⟨card⟩" chip is not listed.** It is a subtraction that the louder card
  highlight replaces; naming it reads as a loss rather than a tidy-up.
- **The aim bullet is phrased against the LIVE build, not against the branch.** Drags between about
  12 and 26px did nothing in the shipped version too (the dead band predates the retune), so "short
  flicks now register" is true for a player. Describing it as a fix to the 32.5px change would be
  describing a regression that never reached anyone.
