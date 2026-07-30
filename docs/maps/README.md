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

The size to ask for is **1440×608**: the world's underground box is 2600 × (1500−380) = 2600×1120
≈ 2.32:1, FLUX's `aspect_ratio` enum stops at 16:9, and custom sides must be multiples of 32 and
≤1440. 1440×608 is 2.37:1 — 2% off, absorbed when scaling to fit.
