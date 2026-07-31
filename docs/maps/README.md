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

## `ember` — the theme that fights the MAP, not the tracer

`node scripts/gen-map.mjs scatter --theme ember --counts 20,40,70`. Generated only.
Mirrors `rockform2/6/9/12` (`theme:'ember'`): scorched red-brown rock, molten orange fissures.

| image | verdict |
| --- | --- |
| `ember-scatter-c20-1` | Weakest lava spill, so the most salvageable — but small rocks, heavy debris, empty top half, and orange puddles pooling onto the background under several masses. |
| `ember-scatter-c40-1` | Striking, and wrong: the lava runs **between** the rocks as rivers across the open background. |
| `ember-scatter-c70-1` | **No.** Full-bleed lava-cracked texture, no background at all — 100% rock, zero channels. A lovely texture and not a map. |

**The structural problem is worth naming.** Every other theme's feature lives *inside* a rock
— veins, geodes, crack lines — so "keep it inside the mass" is a constraint the model can
satisfy. Lava's natural home is the gap *between* rocks, which is exactly the negative space
that has to stay empty for the level to be traversable. The prompt bans lava pools, lava
rivers and "molten anything lying on the background between the rocks", and all three images
ignored it, because the ban fights what the subject is.

**Round 2 (`-2`, plus `c30-1`) cools the fissures** — dull dark ember-red, dim and almost
burnt out, "the last heat left in the stone", with the background's emptiness stated as its
own requirement rather than implied by a ban. **That fixes the flow.** Measured as "hot and
bright" pixels (strongly red *and* light, i.e. lava lying on open ground): 1.7% in round 1's
c40, **0.1%** in c30 and c20-2. The fissures stay in the rock.

What it did not fix is density. The same wording that keeps lava off the background also
packs the masses together:

| image | rock | verdict |
| --- | --- | --- |
| `ember-scatter-c30-1` | **84%** | Best-looking of the eight — charred masses edge to edge, dim fissures inside them, almost no spill. But 84% solid is far past the 15–60% band `traced-check` enforces, and past `maze-one` (48%), the densest map that plays. |
| `ember-scatter-c40-2` | 88% | Same, more so. |
| `ember-scatter-c20-2` | 43% | The only one in a playable band — but it hugs the bottom edge with an empty white top half. |

So the theme now works and the *count* is wrong: it wants c20-2's density with c30's framing.
Somewhere near 20–24 with the fill-the-frame clause doing its job is the next thing to try.

**Round 3** re-rolls ember under the rules added since — mass size bounded at both ends, and
the bare-background rule. Judged on the owner's criterion, side-on-ness:

| image | rock | blobs | verdict |
| --- | --- | --- | --- |
| `ember-scatter-c20-3` | 61% | 47 | **Best.** Large masses filling the frame, seen close to straight on, fissures inside them, and only 47 blobs — a quarter of what c30/c40 produce. Slightly over the playable band. |
| `ember-scatter-c30-3` | 51% | 193 | Best density, worst viewpoint: every rock shows its top and sits on a plane, and the small debris came back. |
| `ember-scatter-c40-3` | 60% | 227 | Most top-down of the three, densest debris. |

That is the density/viewpoint tension again, and ember shows it cleanly: **c30-3 has the
playable density and c20-3 has the viewpoint, and they are not the same image.** Lava on the
open background stays solved throughout — 0.08–0.21% hot-and-bright, against 1.7% before the
fissures were cooled.

The other route, still untried: **let the tracer take it** — lava on the background is
chromatic and forms components with no dark rock in them, which the veined theme's component
filter already deletes.

Also worth deciding before this becomes a level: `docs/STYLE_GUIDE.md` reserves warm amber
for ant tunnels, "the one warm light underground". A molten map spends that signal everywhere.

## "Draw it as a cross-section" — tried, reverted

The persistent complaint across every theme is that the rocks read top-down or three-quarter
rather than side-on. The obvious fix is to say so directly: *this is a cross-section, the
scene has been sliced clean through with a blade, every mass shows only its flat cut face, no
thickness, no depth, never a view from above.* The game IS a vertical slice, so it should be
true of the subject.

**It made every theme worse, and the reason is worth keeping.** A real cross-section is a cut
through CONTINUOUS material, so the model drew continuous material:

| image | with the clause |
| --- | --- |
| `ember-scatter-c30-2` | A jagged mountain ridge under an empty white sky. |
| `ember-scatter-c24-1` | Full-bleed cracked rock with a lava seam — no background, no channels. |
| `ember-scatter-c36-1` | A rubble bank on a floor, empty top. |
| `ice-scatter-c40-2` | The control. `ice-c40-1` was the best image any theme had produced — a cracked ice sheet with channels through it. With the clause it comes back as a landscape under a sky. |

A map of ours is a **diagram** convention, not a physical section: discrete masses floating in
empty space, which nothing is ever cut through. Asking for the section asks for exactly the
continuity the map must not have. "Flat orthographic side elevation, straight-on, no
perspective, no isometric tilt" is as close as wording gets, and the residual top-down read on
some rolls is the price of keeping the masses separate.

Worth testing a shared-prompt change on a known-good image before keeping it — that control
roll is the only reason this was caught rather than quietly degrading every future theme.

## `bioluminescent`

`node scripts/gen-map.mjs scatter --theme bioluminescent --counts 20,30,40`. Generated only.
Mirrors `rockform4/8/11` (`theme:'fungal'`): near-black rock with clusters of glowing teal and
amber mushrooms and patches of luminous moss.

Built on the two lessons already paid for — keep the feature a MINORITY (crystal), and say the
glow stays ON the rock (veined). Both held: no glow spilled into the channels on any roll.

| image | rock | verdict |
| --- | --- | --- |
| `bioluminescent-scatter-c30-1` | 51% | **Best.** The only one with the teal reading properly (2.3% of pixels against 0.27% and 0.00%), and the only one in a comfortable density band. Composition is the weak part: a diorama cluster with an empty top third. |
| `bioluminescent-scatter-c20-1` | 69% | Best coverage and channels, edge to edge — but the fungus came out almost entirely amber lichen, so it barely reads as bioluminescent, and 69% is past the playable band. |
| `bioluminescent-scatter-c40-1` | 59% | Good spread, **zero** teal — all amber. Heavy tuft debris on the background. |

### "…but no small rocks"

Round 2 (`-2`) bounds mass size at BOTH ends — nothing wider than a tenth of the frame,
nothing *smaller than a twentieth* — and replaces the qualitative debris ban with a bare-
background rule naming scree, rubble, chips and tufts. The size cap had worked as a quantity,
so the floor was written the same way.

| image | rock | blobs | of them tiny | teal |
| --- | --- | --- | --- | --- |
| `c20-1` → `c20-2` | 69% → **81%** | 89 → 635 | 60% → 97% | 0.27% → 0.36% |
| `c30-1` → `c30-2` | 51% → **52%** | 326 → 243 | 94% → 79% | 2.30% → 0.02% |
| `c40-1` → `c40-2` | 59% → **68%** | 445 → 118 | 91% → 73% | 0.00% → 1.11% |

**It helps at 30 and 40 and backfires at 20.** And the metric needs a caveat: "tiny" counts
connected components under the tracer's own gravel cut, and at this theme most of those are
lichen and moss specks rather than small *rocks* — so the visible improvement in rock size is
real while the blob count is measuring something else. Those specks are deleted at trace time
by `--min-area` regardless, which is why they never reached a level.

The teal swing (2.30% → 0.02% at c30, 0.00% → 1.11% at c40) is roll-to-roll noise, not a
trend. **Owner's picks: `c20-2` and `c40-2`, and the reason is the viewpoint** — c20-2 reads most
side-on, c40-2 least. That is the criterion to select on, and it runs the OPPOSITE way to
density comfort: the dense rolls read side-on because the masses fill the frame and you see
their faces, while sparse ones leave room to show each rock's TOP, which is what makes a map
look top-down. So "81% solid" and "most side-on" are the same image, and the playable-density
band and the viewpoint pull against each other. Worth knowing before optimising either alone.

Two things to fix if it's worth another round. The **teal loses to amber** unless the count is
low: 2.3% teal at 30, 0.27% at 20, none at 40. And small lichen tufts keep landing on the
background — the same failure as crystal's loose gems, and the same answer: delete them at
trace time rather than ban them a fourth time.

Design note for whoever makes this a level: `STYLE_GUIDE.md` gives mint-cyan to the PLAYER —
"the mycelium is the hero, the brightest element on screen". A map lit in the same colour
competes with the thing the player must read first. The game's own `rockform8` does it
sparingly; a whole map of it is a louder decision than it looks.

## `bones` — fossil and stone, on black

`node scripts/gen-map.mjs scatter --theme bones --counts 20,30,40`. Generated only.
Black ground for the same reason as `glacier`: bone is pale, and pale on white is no
threshold at all. The polarity detector picks it up on its own (`invert=True` on all three).

Two traps specific to this theme, both guarded in the prompt. On a dark ground **the rock**
is the problem — every other theme's rock is near-black, which on black IS the background, so
the stone has to be a clear mid-grey. And a skeleton is a far stronger subject than a geode,
so "no complete skeleton, no articulated dinosaur, no dig site" does the same work as
crystal's "no big hero rock". Both held.

| image | rock | blobs ≥ gravel cut | verdict |
| --- | --- | --- | --- |
| `bones-scatter-c30-1` | 45% | 61 | **Best.** Dense pale masses with black channels edge to edge, in a playable density band, and it reads side-on. |
| `bones-scatter-c20-1` | 56% | 78 | Good, looser, similar read. |
| `bones-scatter-c40-1` | 65% | 76 | Masses pushed to the edges around a big central field of loose bone — as a level that is an open middle with a rock border. |

**The theme's own tension: the bones lie in the CHANNELS, not in the rock.** The prompt asks
for them half-buried in the stone; the model scatters them across the background instead,
because that is where loose bones go. That is the ember problem again — a subject whose
natural home is the negative space — and here it bites harder, because the bones *are* the
theme, so deleting them at trace time deletes the point. Most are small enough for
`--min-area` to drop; the big femurs and ribs would survive as thin slivers standing in a
channel.

Rock also came out bone-beige rather than mid-grey, so stone and fossil sit at nearly the
same tone. That helps the trace (both bright against black) and costs the visual distinction.

## `skeletons` — all fossil, no stone

`node scripts/gen-map.mjs scatter --theme skeletons --counts 12,20,30`. Black ground, named
species (Tyrannosaurus, Triceratops, Stegosaurus, Ankylosaurus, Diplodocus, Pteranodon), each
asked to be curled or coiled into a rounded mass rather than stretched out — a Diplodocus
drawn straight is half the frame on its own.

This needed the form's noun to stop being hard-coded as "rock masses", which had been quietly
fighting `ice`, `glacier` and `bones` as well. `{MASS}` and `{MASSADJ}` are theme-supplied now.

**Beautiful, and the wrong geometry for a map.** They come out as specimen sheets: individual
articulated skeletons laid out with black between them. The problem is measurable — a skeleton
is mostly negative space, so what it leaves as collision is thin bone with big gaps:

| image | solid | masses kept | fill ratio |
| --- | --- | --- | --- |
| `skeletons-c12-1` | 30% | 25 | **0.42** |
| `skeletons-c20-1` | 28% | 62 | **0.39** |
| `skeletons-c30-1` | 39% | 77 | **0.45** |
| `bones-c30-1` (stone) | 45% | 61 | 0.63 |
| `ice-c40-1` | 78% | 37 | 0.67 |

*Fill ratio* is a kept mass's area over its bounding box — how solid the thing actually is.
The stone themes sit at 0.63–0.67; the skeletons at 0.39–0.45, i.e. **a skeleton's bounding
box is less than half bone.** Traced, ribs and spines and tails become thin filaments, and the
despeckle opening and `--min-area` exist precisely to delete filaments. What survives is a
field of small disconnected fragments rather than terrain.

`c12` is the closest to usable, because at twelve the skeletons are big enough that a ribcage
is a mass rather than a comb. Past that the count only makes the specimen sheet denser: `c30`
is dozens of tiny skeletons, nearly all below the gravel cut.

If the look is worth having, the route is to stop asking for skeletons and start asking for
**stone with fossils in it** — a mass whose silhouette is solid and whose bone is surface
detail, which is what `bones` was reaching for.

## What the best maps actually have in common

Owner's five best, on "the rocks look great and they are most side-on":
`veined-c28-1`, `veined-c9-1`, `crystal-c36-1`, `crystal-c70-1`, `bioluminescent-c20-2`.

**It is not the prompt.** Every image was committed alongside the exact `gen-map.mjs` that
produced it, so each prompt can be reconstructed from git. Doing that across all 27 shortlisted
images: the five span FOUR different prompt versions, and every clause they contain — reach the
edges, spread over the frame, the size cap, the gap rule, the bare-background rule — appears in
a majority of the images that were *not* picked. No clause is present in all five and rare
elsewhere. Neither does density separate them: they run 25–84% solid, the same spread as
everything else.

**It is the theme.** All five come from `veined`, `crystal` or `bioluminescent` — the three
themes where the rock carries a feature embedded in its face. That is 5 of 5 from a pool of 13,
and **0 of 5** from the 14 images whose rock is plain (slate, ice, glacier, ember, skeletons).

**And they are the least flat images we have, not the most.** Measuring cast-shadow load — the
share of non-rock area that is mid-tone rather than clean background, i.e. the soft shadow a
three-dimensional render drops under an object:

| | shadow load | picks |
| --- | --- | --- |
| the five | **36.3%** | — |
| featured themes (veined/crystal/biolum) | 29.2% | 5/13 |
| plain themes (slate/ice/glacier/ember/skeletons) | 11.3% | 0/14 |
| `glacier` | 2.4% | 0/2 |

So "the rocks look great" is tracking **surface detail and three-dimensionality**, and the
prompt has spent the whole project pushing the opposite way — "flat and unlit, no shading, no
gradients, no drop shadows" is in every theme's palette clause. Those clauses were written to
make thresholding easy, and the tracer has since outgrown them: Otsu picks the cut per image,
the chroma rescue keeps coloured features, and polarity is detected from flatness. **The
flatness instructions are now costing looks they no longer buy anything for.**

Two things follow. To get more maps like these, roll more `veined`/`crystal`/`bioluminescent`
rather than tuning composition clauses. And it is worth trying a theme with the "flat and
unlit / no shading / no drop shadows" clauses *removed* — the thing the evidence says the
picks have and the prompt forbids.

Caveat: n=5, and `bioluminescent-c20-2` is the image whose polarity the tracer refuses to call,
so its density number in particular is not trustworthy.

## The `--rich` round: what happens when the flatness clauses come out

Testing the paragraph above. `gen-map.mjs --rich` swaps the flatness clauses for their
opposites — real shading across every face, a cast shadow under each mass, rim light on the
edges — and leaves everything else identical. Three rolls, at exactly the theme/count of three
of the owner's picks so the comparison is like-for-like:

| | thr | solid | masses | grey band | grey **inside** the mask |
| --- | --- | --- | --- | --- | --- |
| `veined-c9-1` | 154 | 56.9% | 20 | 1.3% | 2.8% |
| `rich-veined-c9-1` | 157 | 40.6% | 9 | 6.4% | 5.7% |
| `veined-c28-1` | 144 | 77.4% | 22 | 9.9% | 9.4% |
| `rich-veined-c28-1` | 144 | 78.2% | 31 | 9.0% | 4.1% |
| `crystal-c70-1` | 156 | 69.5% | 36 | 8.0% | 5.1% |
| `rich-crystal-c70-1` | 154 | 76.8% | 21 | 12.1% | **20.3%** |

*Grey inside the mask* is the share of frame that is mid-tone (within 40 luminance of the cut)
and still lands on the rock side of it — shadow the tracer would bake into collision. It is the
number the flatness clauses were bought with.

**The trace survives on veined and fails on crystal.** Otsu moves by ≤3 across every pair, so
the cut itself is robust; what changes is how much soft grey sits under it. Veined is fine —
`c28` actually *improves*, 9.4% → 4.1%, because the render puts its shadows tight under each
mass instead of spreading them. `rich-crystal-c70` quadruples to 20.3%: a fifth of the frame
would trace as rock that the player cannot see. Not because of the shading — because of what
the shading brought with it.

**And that is the real cost: the view drifts.** `rich-crystal-c70-1` is a three-quarter
perspective sitting on a receding floor plane, with a single geode as a focal subject —
a product render, not a map. `rich-veined-c28-1` is denser and better lit than its flat
original, veins properly contained inside the rock, but every mass now shows a *top face*: it
reads isometric, not side-on. "Most side-on" has been the owner's own first criterion in every
round, and `rich-veined-c9-1` reproduced the standing veined failure on top of that — a bright
cyan vein drawn across the white background between masses.

So the hypothesis is half right and the fix is narrower than "remove the clauses". Three-
dimensionality is what makes the rock look good; **orthographic projection is a separate
instruction from flat shading, and the old prompt was buying both with one clause.** The next
thing to try is keeping "flat orthographic side elevation, no perspective, no top faces,
no ground plane" while dropping only "no shading / no gradients / no drop shadows".

## `--view top`: stop naming the camera by what it must not do

The owner's read on the rich round was that the whole camera wording was the problem, not the
shading — everything was coming back "viewed from an angle" — and that the fix was to ask for a
**top-down** view rather than to keep negating the tilt. That is right, and it is the largest
single improvement any prompt change has made.

The old clause is *"flat orthographic side elevation, straight-on, no perspective and no
isometric tilt"*: one weak positive and two negations. A diffusion model has to represent the
tilt in order to refuse it, and on a good fraction of rolls it simply draws it. "Viewed from
directly overhead, camera pointing straight down, every mass shows only its top surface" is a
positive instruction with its own convention (tile sheets, top-down asset packs), and it kills
the artifacts at the source: from overhead nothing is standing *on* anything, so there is no
floor to recede and nothing to cast a shadow across it.

Five rolls, at the exact theme and count of the owner's five favourites:

| | thr | solid | masses | gravel | fill | grey in mask |
| --- | --- | --- | --- | --- | --- | --- |
| `veined-c9-1` | 154 | 56.9% | 20 | 36 | 0.68 | 2.8% |
| `top-veined-c9-1` | 149 | **50.0%** | 13 | 2 | 0.68 | 2.7% |
| `veined-c28-1` | 144 | 77.4% | 22 | 124 | 0.64 | 9.4% |
| `top-veined-c28-1` | 150 | **56.2%** | 38 | 31 | 0.70 | 7.3% |
| `crystal-c36-1` | 135 | 83.9% | 31 | 50 | 0.70 | 18.2% |
| `top-crystal-c36-1` | 156 | **56.9%** | 43 | 342 | 0.68 | 12.4% |
| `crystal-c70-1` | 156 | 69.5% | 36 | 32 | 0.66 | 5.1% |
| `top-crystal-c70-1` | 157 | **51.4%** | 37 | 295 | 0.67 | 10.7% |
| `biolum-c20-2` | 142 | 25.1% | 11 | 4506 | 0.38 | 8.4% *(polarity ambiguous)* |
| `top-biolum-c20-1` | 147 | **60.1%** | 35 | 202 | 0.68 | 5.9% |

**All five land inside the 15–60% playable band.** Their side-view originals mostly did not —
three of them sat at 69–84%, dense enough that the channels close up. This is not a coincidence
of the roll: a 3/4 view shows each mass's top face *and* its front face, so the same rock eats
more frame. Overhead, a mass is only its footprint, and the gaps between footprints are the
channels. The camera was costing us density control the whole time.

Fill ratio also converges on 0.67–0.70 across every theme, the tightest the numbers have ever
been, and `top-biolum-c20-1` is no longer polarity-ambiguous — the one image the tracer refused
to call now reads cleanly, at 0.68 fill against the old 0.38.

**The one regression is gravel.** The crystal rolls come back with 295–342 sub-threshold specks
against 32–50 for their side-view originals, as loose chips and stray gems on the background.
The tail bans exactly this and the top view brings it back — plausibly because "scattered rocks
seen from above" is a strong enough visual cliché to override the ban. `--min-area` deletes them
at trace time so it costs nothing in the mask, but it is visible in the reference image and it
is the next thing to push on.

`--view` and `--rich` are independent flags. Everything above is `--view top` with the flatness
clauses left **in**.

### DARK_TONE, and the word you must not say

All five overhead rolls were kept, and the owner's one note was that `top-crystal-c36` and
`top-crystal-c70` had "too much lighting and shading — we need a darker style because the game
happens underground". Correct, and it is a thing the camera change *exposed* rather than caused:
every theme's palette had been saying "flat and unlit" all along while the model lit the rock
anyway, because "unlit" describes a rendering mode and the model was answering a different
question — where is this, and how is it lit? Overhead with no floor to hide it, the answer it
had been giving became obvious: a studio product shot.

So `DARK_TONE` answers that question instead of re-issuing the ban. One clause, appended to
every theme whose ground is white. The black-ground themes (`glacier`, `bones`, `skeletons`) are
exempt — their whole premise is a pale mass reading bright against black, and telling them to go
dark leaves the tracer nothing to threshold.

**v1 of the clause did nothing, and the reason is the lesson from `--view top` again.** It said
"never mid-grey and never light grey", which puts the word GREY into the prompt while banning
it, and `crystal`'s own material clause already said "near-black blue-**grey**". Crystal came
back at rock luminance **81.6** against **80.8** for the roll before the clause existed — no
effect whatsoever. Rewritten positively, with the word deleted from both places:

> This is DEEP UNDERGROUND, in the dark, far below any daylight. Every mass is matte and ALMOST
> BLACK — as dark as its own colour allows, closer to a silhouette than to a lit object […] The
> only bright thing in the picture is the flat white background itself.

| crystal roll | rock luminance |
| --- | --- |
| `top-c24-1`, `top-c40-1` (clause v1, "never grey") | 81.6, 89.6 |
| `top-c24-2`, `top-c40-2` (clause v2, positive) | **62.0, 59.2** |

A 25–35% drop, and it fixed a second thing at the same time: v1's crystal came back as loose
gems strewn on the background — which its own clause bans explicitly — and v2 has them back
inside pockets in the rock where they belong.

**Two negations, two identical failures.** "No perspective, no isometric tilt" got a 3/4 view;
"never mid-grey" got mid-grey. Write what the picture IS. If a clause has to name the thing it
forbids in order to forbid it, expect to get that thing.

### What the all-theme sweep says

Nine themes × two counts, overhead and dark. `top-scatter-c24` (plain `slate`) is the standout —
52.4% solid, 47 masses, 0.71 fill, and **9** gravel specks in the entire frame. `top-ember-c24`
is the best fill ratio any image has produced at 0.72.

Out of the 15–60% band and so not directly usable: `top-veined-c24` (66.1%), `top-ice-c40`
(63.9%), `top-crystal-c40-1` (67.3%) and `top-crystal-c40-2` (69.5%) are all too dense;
`top-bones-c40` is 77.6% across only 9 masses, i.e. the rocks merged. `top-biolum-c24` is the
one outright failure — the masses grew until the background was a minority, and the polarity
detector called the rock the background as a result.

**Gravel is the outstanding defect and it is worse than side-on across the board.** The tail
bans pebbles, gravel, scree, chips, fragments and speckles by name, and the overhead rolls
produce 87–488 sub-threshold specks where side-on produced 32–50 (`top-biolum-c24`: 5563).
`--min-area` deletes every one of them at trace time so the collision mask is unaffected — this
is a cosmetic problem in the reference image, not a gameplay one — but it is the next thing to
push on. Given the two results above, the fix is probably not another ban: it is to say
positively what lies between the masses (bare, swept, empty ground) rather than to list eight
kinds of debris that must not be there.

## Five new themes, and two more clauses that were asking for the failure

The owner cut `bones` and `skeletons` outright ("won't be doing more of that"), plus both
bioluminescent rolls, `crystal-c24-2` and `ember-c24`. Two of those cuts named a defect that
was not theme-specific at all, and both traced back to wording that had been in the prompt from
the first roll:

- **"almost real life quality — does not match the game theme"** (`top-biolum-c24`, photographic
  mushrooms with real depth of field). Nothing in the prompt had ever said what *medium* this
  is, so FLUX fell back on its strongest prior, which is photography. `STYLE_GUIDE.md` owns the
  answer — the game is flat-shaded and hand-drawn — and the tail now says so once for every
  theme: *"It is DRAWN, not photographed: a hand-drawn game asset in flat, simplified shapes…"*
- **"too organized, it's like a rock collection in a museum"** (`top-ember-c24`). The `scatter`
  form said *"spread **evenly** across the whole frame"* and had since the first roll. Even
  spacing plus "roughly comparable in size" is a specimen shelf — the words were asking for the
  thing. They were load-bearing, though (they are what stops an empty half), so the fix is to
  say what the spacing should be instead: *"scattered at IRREGULAR intervals… the way rock
  actually lies: a few loose clusters, some masses standing alone, gaps of visibly different
  widths"*, with full-frame coverage kept as its own clause.

The five new themes are all built to the pattern the shortlist established — a near-black mass
with something legible **inside** its silhouette, never a mass that is interesting only in
outline. The tracer constrains the palettes more than taste does: its rock test is "dark, OR
strongly chromatic and not near-white", so a feature is safe when it is either dark or
saturated and unsafe exactly when it is pale and desaturated.

| theme | verdict |
| --- | --- |
| **`obsidian`** | **Works.** Black volcanic glass, conchoidal fracture, cold-blue stress lines. c24 is 42.9% over 43 masses at luminance 64 — the material has no grain for the model to render texture into, which is why it comes out this clean. |
| **`strata`** | **Works at c40** — 45 masses, 0.70 fill, and level banding gives the whole field a shared grain, the only theme whose feature is a *direction*. c24 is the museum shelf again, four tidy rows, in spite of the new wording. |
| **`rust`** | **Works at c90 only.** Banded ironstone. At c24/c40 it is 76–78% solid, and c60 is one blob holding **97%** of all the rock in the frame — the material has a strong hero-rock prior. At c90: 33 masses, 58.1%, largest blob 23%. |
| **`roots`** | **Fails.** Petrified roots through dark earth — the most on-theme idea of the five, since the player is a fungus in soil. Came back photographic, with the roots *bleached pale* despite the clause specifying ochre precisely because pale-and-desaturated is the one value that traces as background. c40 is 17 masses in a horizontal band with 828 gravel specks. |
| **`ruins`** | **Fails.** Buried concrete and rebar. The concrete came out pale (luminance 99–103) in spite of being specified soot-black and DARK_TONE being appended; c40 arranged its rubble into a border around an empty middle — the cavern shape the tail bans by name — and c24 is another grid, with no reinforcing bar anywhere in either. |

Three for five, and the two failures share a cause worth noting: both are themes whose material
is *canonically pale* (bleached timber, concrete). Every theme that works is one whose material
is canonically dark. Specifying a dark version of a pale material loses to the prior — the same
way `glacier` had to move to a black ground rather than argue white ice onto white.

## Round two: obsidian and rust deepened, four more themes

`obsidian`, `strata` (c40 only, and the theme is closed — the owner's note was that it reads too
close to the plain rock maps) and `rust` at c40/c90 are in the shortlist.

**`obsidian` is the most robust theme in the set.** Six counts from 15 to 70 all land in or near
the band, 38.7–52.6% solid at 35–48 masses, largest blob never above 25%. Worth knowing why:
the count controls mass *size* far more than mass *number* here — c15 yields 41 masses and c70
yields 48 — because obsidian has no grain for the model to render texture into, so it never
falls back on drawing one hero specimen. `c55` is the best of the new ones: 45 masses, 44.8%,
0.71 fill, largest blob 10%.

**`rust` is the opposite: the most count-sensitive theme there is.** Eight counts tried, and only
`c85` (59.6%) and `c90` (58.1%) land in band. c30 is 69%, c40 76%, c75 84%, c100 72%, c110 80% —
and **c55 collapsed into a single blob holding 100% of the frame's rock.** The material has a
strong hero-specimen prior and only a very high count breaks it up.

| new theme | verdict |
| --- | --- |
| **`glass`** | **Works.** The owner's suggestion, and it earns its place next to obsidian by being a different *shape* language rather than a different surface: obsidian breaks into rounded blocks with curved scoops, shattered plate glass breaks into flat spiky shards with radiating crack networks — long straight edges and sharp points, which nothing else in the set has. c24 is 43 masses at 40.7%. Specified as thick opaque *smoked* glass and dead matte, because transparency traces as background and gloss is a white highlight in the middle of a mass. |
| **`anthracite`** | **Works, and it is the darkest image the project has produced** — rock luminance 52.7, against 63 for the plain slate that held the record. 46 masses at 55.9%, 0.70 fill. Its c40 merged (86% of the rock in one blob). One caution: `STYLE_GUIDE.md` reserves warm amber for ant tunnels, and a few pyrite seams came back brighter gold than the clause asked for. |
| **`magnetite`** | **Works.** Octahedral crystal habit, so the masses read as *built* — flat triangular faces and straight edges rather than weathered lumps. c40 is the pick: 46 masses, 52.8%, largest blob 10%. |
| **`basalt`** | **Does not work yet**, in two different ways, and it is the most interesting failure here. |

### Why `basalt` is worth another go

It has the best *reason* to exist of any theme: columnar jointing is a feature you can only see
from directly overhead. Every other theme's detail is something the plan view permits; this one
is something it unlocks.

**v1 produced not one hexagon in two rolls** — plain rock, indistinguishable from slate. The
cause is the same one that has bitten twice already, wearing a third disguise: *"columnar
basalt"* is a **landscape** word. The Giant's Causeway, Devils Tower, Fingal's Cave — every
picture behind that phrase is a cliff photographed from the SIDE. Naming the material summons
the side view, the overhead camera cancels it, and what is left is a lump. Naming a thing you
want can be as wrong as naming a thing you don't, if the name carries a camera with it.

**v2 stopped naming the geology** and described the pattern in terms the model has for it — a
honeycomb of hexagonal tiles packed edge to edge — and got the hexagons immediately. It also
lost the composition completely: `c30` is ONE tiled slab spanning the frame, `c45` is 97% one
blob with a few loose hexagons round the fringe. "Packed edge to edge" was meant to describe the
cells *within* a mass and the model applied it to the masses. Same shape of error as crystal's
hero geode: the feature ate the composition.

The fix to try is to make the boundary explicit — the honeycomb belongs inside one mass, and
between masses there is only background — rather than to weaken the hexagon wording, which took
two rounds to get working.

The size to ask for is **1440×608**: the world's underground box is 2600 × (1500−380) = 2600×1120
≈ 2.32:1, FLUX's `aspect_ratio` enum stops at 16:9, and custom sides must be multiples of 32 and
≤1440. 1440×608 is 2.37:1 — 2% off, absorbed when scaling to fit.
