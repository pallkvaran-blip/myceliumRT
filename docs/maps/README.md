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

`maze-1@4x.png` is `maze-1.png` through Real-ESRGAN ×4 (`scripts/upscale-map.mjs`), and
**it, not the original, is what was traced.** A 1440px-wide generation stretched over a
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

The size to ask for is **1440×608**: the world's underground box is 2600 × (1500−380) = 2600×1120
≈ 2.32:1, FLUX's `aspect_ratio` enum stops at 16:9, and custom sides must be multiples of 32 and
≤1440. 1440×608 is 2.37:1 — 2% off, absorbed when scaling to fit.
