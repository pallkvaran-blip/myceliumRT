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

The size to ask for is **1440×608**: the world's underground box is 2600 × (1500−380) = 2600×1120
≈ 2.32:1, FLUX's `aspect_ratio` enum stops at 16:9, and custom sides must be multiples of 32 and
≤1440. 1440×608 is 2.37:1 — 2% off, absorbed when scaling to fit.
