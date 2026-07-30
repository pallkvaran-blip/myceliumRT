# Generated map experiments

Trials of "generate the whole underground as one image, trace rock-vs-passable on our side".
`node scripts/gen-map.mjs <style>` makes these; the prompts and what each attempt got wrong
live in that script's comments.

Nothing here is wired into the game yet — these are for looking at.

| file | prompt | verdict |
| --- | --- | --- |
| `silhouette-1.png` | v1 "cross-section map of an underground cave system" | **No.** Read "cave" as an enclosed cavern: a rock border sealing all four edges, white only inside the pocket, mid-grey outside. Three tones to threshold, and a level with no entry or exit. |
| `art-1.png` | in-game art direction | **No.** Drew a starry night sky and a surface line despite being told not to, put the boulders *on* the ground rather than in it, and rendered the underground as featureless strata veined in orange — no rock/soil separation to trace, and it steals the amber that means *ants*. |
| `silhouette-2.png` | v2 — never says "cave", bans the border/ceiling/floor, demands white to all four edges, flat orthographic | **Usable.** Separate masses, white edge to edge, real channels between them. Two things left: it still puts a soft grey drop-shadow under each rock (thresholds away, but it's why a naive alpha matte would fatten every wall) and it composes like an asset sheet — evenly spread decorative boulders, not a route with chokepoints. |

## Composition pass

v2's wording, with only the "what are they arranged like" clause swapped (`FORMS` in the
generator). Same head and tail every time — those clauses are what keep it traceable.

| file | verdict |
| --- | --- |
| `ledges-1.png` | **Best of the set.** Long slabs staggered in height, wide white gaps, real vertical layering — it reads as a level with shelves rather than a pile of props. Two slabs run into the left edge, which would seal the entry at those heights; the entry/goal channels beat rock anyway (`pathClear`), so that's a trace-side fix, not a prompt one. |
| `chokes-1.png` | **Strong shape, one flaw.** Six big piers with squeeze-gaps between them, exactly the ask. But every pier is rooted on a common baseline and stops well short of the top, so the whole level is bypassable by going over. Needs some masses hanging from above — carefully, see `pillars`. |
| `pillars-1.png` | **No** — and instructive. "Some hanging down from the top of the frame" brought the enclosed cavern straight back: a solid rock band across the entire top plus both side walls, floored with rubble. The ceiling/wall ban in the tail can't survive an explicit instruction to hang things from the ceiling. If we want overhangs, ask for masses whose tops are *cut off by* the frame, never for anything attached to it. |
| `maze-1.png` | **No.** Ignored "narrow winding corridors" and produced a dense even scatter with heavy gravel — the exact speckle the tail bans, and the worst case for mask noise. Also the most isometric of the set. |
| `scatter-1.png` | **Usable**, a second roll of `silhouette-2`'s prompt. Slightly better mass variety, but it draws a faint ground plane with path squiggles on it and lets rocks touch both side edges. |

**Owner's verdict: `maze` and `scatter` are the keepers; `ledges`, `chokes` and `pillars`
are out.** `maze-1.png` is traced and playable — `#level,maze-one`, see
`docs/levels/maze-one.json` and `scripts/trace-map.py`.

All three approved images are now playable: `maze-1` → `#level,maze-one`, `scatter-1` →
`#level,scatter-one`, `silhouette-2` → `#level,scatter-two`.

The `@4x.webp` files are the originals through Real-ESRGAN ×4 (`scripts/upscale-map.mjs`), and
**they, not the originals, are what get traced.** A 1440px-wide generation stretched over a
2952-unit world is about 2 world units per pixel — acceptable zoomed out, mush at the zoom
the game is played at, which is where it was caught. Trace the upscale for anything that
ships; the raw generation is for judging composition.

Across all of them, three things the prompt has not been able to kill:

1. **Drop shadows.** Banned explicitly, drawn every time. Light grey, so a threshold removes
   them — but a naive alpha matte would fatten every wall by the shadow's width, and a wall
   wider than it looks is the hardest kind of bug to see.
2. **Gravity.** Everything sits on an implied floor with its heavy mass at the bottom. Real
   underground rock should be as happy embedded high in the frame as low.
3. **Edge contact.** Rocks reach the left and right edges, which is where the player enters and
   where the goal is. Cheap to fix at trace time; not worth more prompt tokens.

## The `ledges` count sweep

`node scripts/gen-map.mjs ledges --counts 5,9,14,20,28` — five images, one per rock count,
named `ledges-c<count>-<roll>`. Run twice, because the first round found a prompt bug.

**Round 1 (`-1`) is the bug.** At every count from 5 to 28 the model piled the slabs into a
heap resting on the floor with empty white above — a level with a free highway across the
top. The count only changed how big the heap was. Cause: v1 of the prompt asked for "a
staircase of open channels", and it drew a staircase. Kept as `ledges-c*-1.webp` because the
failure is the useful part.

**Round 2 (`-2`)** bans heap/pile/pyramid/staircase/wall and demands white space above *and*
below every slab. Better, but the form is still unreliable — it wants to be a landscape:

| image | verdict |
| --- | --- |
| `ledges-c5-2` | **No.** The cavern is back: big masses walling the left and right, void between. Five slabs is too few to read as anything but scenery. |
| `ledges-c9-2` | **Best of the ten.** Separate flat slabs spread over the frame with generous lanes between them. Slight 3/4 tilt, which the tracer doesn't care about. |
| `ledges-c14-2` | **No.** Drifted into a landscape with a horizon and receding perspective, despite the tail banning both. |
| `ledges-c20-2` | **Usable.** Well-separated slabs, wide gaps; a large empty patch right of centre. |
| `ledges-c28-2` | **No.** Dense, but in perspective — the top third is a distant band that would trace as one solid wall. |

So `ledges` converts at about 2/5 against `scatter`'s 3/3. It is not a reliable form yet, and
the failures are not random: too few slabs → scenery, too many → landscape. **Nine to twenty
is the window.**

## The `veined` count sweep

`node scripts/gen-map.mjs scatter --theme veined --counts 9,14,20,28,36`. Generated only —
none of these is traced.

| image | verdict |
| --- | --- |
| `veined-scatter-c9-1` | **Best.** Separate masses over the full frame, generous channels, reaches all four edges. Mild isometric tilt, which the tracer doesn't care about. Vein weight closest to the game's own `rockVeined`. |
| `veined-scatter-c20-1` | **Usable, different character.** Big angular masses, wide channels — but it reads as cracked ground seen from above rather than a side elevation. |
| `veined-scatter-c28-1` | **Usable, dense.** Tiled slabs with narrow channels, full frame coverage; would trace into something maze-like. Same top-down read, and heavy drop shadows. |
| `veined-scatter-c14-1` | **No.** A ridge on the floor with empty white above — the pile failure. |
| `veined-scatter-c36-1` | **No.** Perspective ground plane receding to a horizon, with a glowing river through it. |

Two findings. The tail clause added for these — *reach the left and right edges, spread over
the full height* — **works**: c20 and c28 fill the frame edge to edge, which no earlier veined
roll did. But it trades against the viewpoint, because at higher counts the model resolves
"fill the frame with rock" as a top-down tiling rather than a side elevation. For `veined`,
**9 is the reliable count**; 20–28 is a different look rather than simply a denser one.

Second: at 14, 20 and 36 the veins come out as thick glowing bolts with visible bloom, far
brighter than `rockVeined`'s thin mineral cracks. The tracer copes (the bloom is excluded
from the colour source), but they read as neon in game. c9's vein weight is the closest match.

## The `crystal` sweep — two rounds, neither right yet

`node scripts/gen-map.mjs scatter --theme crystal --counts 9,14,20,28`. Generated only.
The theme mirrors `rockform3/7/14`, which the manifest tags `theme:'crystal'`: dark blue-black
rock broken open to a geode of violet and cyan shards.

**Round 1 (`-1`): the theme, no composition.** Asking every mass to be "broken open to show a
geode cavity packed with crystal" made the geode the SUBJECT — two or three enormous hero
rocks filling the frame, no separation, no channels, at every count from 9 to 28. A geode
needs area, so demanding one per rock forces the rocks huge. It also ignored the bloom ban
outright and rimmed every rock in glowing white, which is the worst thing to hand a threshold.

**Round 2 (`-2`): the composition, no theme.** Demoting the crystal to "three or four rocks,
a small pocket, less than a quarter of that rock" restored proper scatters of separated
masses — and shrank the crystal to a few tiny gems lying on the ground, reading as dropped
loot rather than mineral in rock. c20 and c28 have real channels and full-frame coverage;
c9 leaves the top half empty; c14 is the landscape failure again.

The two rounds bracket the answer. Round 3 wants crystal pockets on about HALF the rocks, at
roughly a third of each rock's face, explicitly set INTO the rock face rather than lying on
the ground — the size of round 1's detail with the count and separation of round 2.

**Round 3 (`-3`)** acted on: too many small rocks (c20), too little spacing (c28), and
"zoom out, fill the whole map". Two of the three fixes landed; the third backfired.

- *Small rocks* — the `scatter` form itself was asking for them. It read "a mix of large
  jagged masses, long horizontal ledges **and smaller lumps**", one clause before the tail
  bans gravel. Removed, and every mass is now "large and roughly comparable in size".
- *Spacing* — "wide white gaps" became a rule: an open gap around every mass at least half
  as wide as the mass itself. That works.
- *Zoom out* — **backfired.** "The scene is seen from far enough back that the whole field
  fits, and the rocks fill the frame" is read as *make the rocks bigger*, not *show more of
  them*: c28-3 and c36-1 are more zoomed IN than round 2, with a few huge masses and thin
  channels. Filling the frame and zooming out are the same instruction to a person and
  opposite ones to this model. The lever that should work is a **cap on rock size** — no
  mass wider than about a tenth of the frame — together with a much higher count.

Loose crystal chips on the background also survive "no crystal ever lies loose on the
background". They would trace as gravel, so they need the same treatment.

**Round 4 (`c40/c55/c70`) — the size cap works.** Replacing "seen from far enough back" with
a hard limit — *no single mass wider than about a tenth of the frame or taller than a third
of its height; many modest masses, never a few huge ones* — plus counts of 40-70, produces
what "zoom out" was asking for: a field of comparable masses covering the whole frame with
channels running through it.

| image | verdict |
| --- | --- |
| `crystal-scatter-c70-1` | **Best coverage.** Dense field of modest masses, fills the frame edge to edge, channels throughout. |
| `crystal-scatter-c40-1` | **Good.** Same shape, looser — wider channels, more open. |
| `crystal-scatter-c55-1` | Well separated but sparse, and the rocks sit on an implied ground plane with strong drop shadows. |

Still not fixed: **loose gems on the background**, which have now survived three increasingly
explicit bans. Most are small enough that `--min-area` drops them at trace time, but c55 and
c70 each put a large loose cluster in the open, and that is big enough to trace as a rock
sitting in a channel. Ban #4 is not the answer; deleting them at trace time (drop chromatic
components with no dark rock in them — the machinery the veined theme already uses) is.

## The `ice` sweep

`node scripts/gen-map.mjs scatter --theme ice --counts 20,40,70`. Generated only.

**Ice is the first theme whose COLOUR fights the tracer rather than its composition.** The
background is pure white and the rock test is "dark, or strongly chromatic and not
near-white", so pale glacier ice reads as background and traces to nothing at all. The theme
therefore asks for *deep saturated blue-teal, mid-to-dark*, with white banned inside a mass
and along its edges. Measured on the results, that works: Otsu lands at 164–178 and **96–98%
of the blue pixels are detected as rock** in all three.

| image | verdict |
| --- | --- |
| `ice-scatter-c40-1` | **Best of any theme so far.** A cracked ice sheet: dense masses with white channels running through them, edge to edge, 78% solid. The channels read as the route without anyone designing them. |
| `ice-scatter-c20-1` | **Good.** Separated masses, generous gaps, 47% solid — the open counterpart to c40. |
| `ice-scatter-c70-1` | **No.** A glacier field receding to a horizon with an empty top — the landscape failure, which high counts keep inviting. |

## `glacier` — the same idea on a black ground

Pale white ice on a white background is not a hard threshold, it is *no* threshold. So the
`glacier` theme sets `bg: 'black'` and the tracer works out the polarity for itself. Both
rolls came out as the postcard glacier look, and the tracer reads 100% of the visible ice.

| image | verdict |
| --- | --- |
| `glacier-scatter-c20-1` | Large pale floes with black channels between them; a couple of thin blue melt-lines. |
| `glacier-scatter-c40-1` | Smaller floes, more of them, wider channels — the open counterpart. |

Both leave an empty black band top and bottom, which the tracer's content crop removes.

**Detecting the polarity is the interesting part, and my first attempt was wrong.** Sampling
the image BORDER is the obvious approach and it fails on exactly the maps we now ask for:
the prompts demand the rocks reach all four edges, so a dense map's border is mostly rock.
`ice-scatter-c40` has a border median of 96, read as a dark background, and classified 100%
of the frame as rock. The background is always a flat *extreme*, so compare the histogram
ends instead — near-white pixels against near-black — and take the larger. That gets all
seven maps right, from 0.0% near-black on the ice sheet to 58% on the glacier.

The same trick gives bone, salt or chalk whenever they're wanted.

The size to ask for is **1440×608**: the world's underground box is 2600 × (1500−380) = 2600×1120
≈ 2.32:1, FLUX's `aspect_ratio` enum stops at 16:9, and custom sides must be multiples of 32 and
≤1440. 1440×608 is 2.37:1 — 2% off, absorbed when scaling to fit.
