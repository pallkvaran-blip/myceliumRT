# itch.io store description

The text to paste into the itch project page. Kept here so the next revision starts from what is
actually up rather than from memory.

**Every number in it is checked against the build** — see the notes at the foot. Three claims in
earlier versions had gone wrong as the game changed, which is the reason this file exists:
"procedurally generated levels" (the maps are hand-drawn now), "12 playable species" (the table
has 14, but only **6** can be reached on a fresh save), and **Survival**, which was withdrawn
from the build and left advertised on the store page for a release.

---

Like Mycelium? Please [rate it](https://pallkvaran.itch.io/myceliumc1/rate?source=game) on itch!

Mycelium is a side-on roguelike engine-builder where you get to experience what life is like as
mycelium. You are a living, pulsating, semi-autonomous mycelial network. Your job is to shape your
growth: laying down bait to the network, cutting off strands that wander into danger, walling
yourself off against invaders or fighting them directly. Your goal is to reach the green fields to
the east so you can fruit and throw spores.

Inspired by the interlocking-engine feel of games like Terraforming Mars and the run-to-run pull of
modern deckbuilders, but built around the tension between growing fast now and building something
that survives the onslaught of ever increasing natural threats.

**Chapter One**

Nine hand-built levels with a beginning and an end. The world got warm and the ground went dry, and
there is nothing left where you are. To the east, the rain still comes and the land is green. Nine
geologies stand between.

Turn-based: nothing moves until you do, and the enemies take their turn after yours — you watch
them come.

**Life**

* Grow toward nature. Drive runners and fans through soil and around rock, aiming your growth
  toward the east — and away from what's hunting you.
* Build an engine, drafting cards from the food you digest — passive producers, on-demand actions,
  one-shot events. Get your Energy, Water, and Phosphorus compounding before it's too late.
* Hold the line. Wall off the colony, snare predators, and amputate infected strands before rot
  spreads through your whole body.
* Fruit and spore. Break through to the woodlands, spore, and carry your deck into the next level.

**Threats**

* Trichoderma — green mould that creeps toward you and infects on contact, spreading fast.
* Nematodes — predatory worms that hunt through the soil and multiply.
* Ant colonies — rivals that race you for every scrap.

**Between runs**

* Keep what you played. Every run ends on a screen where you choose which cards to carry into the
  next one — anything you drafted, anything you started with, anything you brought in.
* Spend Spores on new colonies, on deeper starting reserves, on a bigger deck, and on retries that
  put you back at the start of the level you died on.
* Six colonies, each a real fungus with accurate biology and its own economy and opening deck: the
  Oyster Mushroom you start with, the near-indestructible Split Gill, the weeping Bleeding Tooth,
  the Fly Agaric, the Blue Bonnet, and the Magic Mushroom.

**Current build**

* Nine hand-drawn underground maps, one per level, the same nine every run.
* 71 unique cards across basics, events, passive engines, and installed actions.
* Three currencies to juggle — Energy for cards and actions, Water for growth, Phosphorus for
  digestion and defense.

Music credits: [Sascha Ende](https://ende.app/en)

---

## Where each number comes from

| claim | source | checked |
|---|---|---|
| Campaign is 9 levels | `CAMPAIGN_LEVELS` | 9 |
| ...on hand-built maps | `campaignLevel` in `docs/levels/*.json` | slots 1–9, all named for their rock |
| turn-based only | `OFFER_REALTIME` | false — no real-time door on the title |
| Survival is offered | `OFFER_SURVIVAL` | **true again** — its own New/Old row under the wordmark |
| 71 cards | `CARD_DATA` | 71 (20 basic, 17 event, 9 engine, 21 action, 4 extender) |
| **6** colonies | `STARTER_SPECIES_IDS` + `STORE_SPECIES_IDS` | pleurotus + schizophyllum, hydnellum, amanita, pruinomycena, psilocybe |
| three currencies | `startingResources` | energy / water / phosphorus |

**The species number is the one to watch.** `SPECIES` has **14** entries, but `isObtainable` only
admits a starter, a store entry, or something already owned — so on a fresh save the other eight
(the Fairy Ring Champignon, the Honey Fungus, the Artist's Conk, Slippery Jack, Wine Cap, Violet
Webcap, Dry Rot, Earthball) **cannot be reached at all**. The previous description name-dropped four
of them. If they are meant to be playable, adding them to `STORE_SPECIES_IDS` is a one-line change
and this copy should go back up to match.

---

## Store tags

Kept here for the same reason as the copy above: so the next store starts from what went up rather
than from memory. The game is on itch, CrazyGames and Newgrounds now, and each asks for tags in its
own vocabulary.

**In priority order — take as many as the field allows:**

```
roguelike, deckbuilder, strategy, survival, cards, mushroom,
nature, underground, turn-based, engine-builder
```

- The first five are the DISCOVERY terms — how someone who wants this game searches, and all
  established tags with real traffic on every store.
- The next four are what make it findable by the RIGHT people. Nothing else on any of these stores
  is a mycelium sim, and "mushroom" is the word a player remembers it by.
- `engine-builder` is last because it is the most accurate description of the actual play and the
  least likely to exist in a store's vocabulary already. **A store's own autocomplete beats this
  list** — a tag nobody else uses is a tag nobody browses.

Two judgement calls, recorded so they are not re-litigated blind:

- **`deckbuilder` is a slight stretch and is kept anyway.** Cards are DRAFTED from digested food and
  a deck carries between runs, but there is no shuffle-and-cycle. It is the single best discovery
  term the game has; `cards` alongside it covers the expectation gap.
- **`real-time` is OUT; `survival` IS A MODE NAME AGAIN.** `OFFER_REALTIME` is still false, so
  `real-time` would be a false claim however live the variant is underneath. `OFFER_SURVIVAL` is
  true again (owner: *"let's add survival back"*), so `survival` has stopped being the genre
  stretch it was reduced to — the tag reads as the name of a mode once more, which is the stronger
  claim and the true one. **The body text above still describes the campaign alone**: it was
  rewritten while survival was withheld, and a mode with a door on the title screen and no mention
  on the store page is the same defect that put this file here in the first place, in the other
  direction. Worth a paragraph before the next upload.

Spares, for a store with a larger cap: `management`, `atmospheric`, `singleplayer`, `upgrades`,
`biology`, `fungus`.

---

## Devlogs

Kept for the same reason as the copy and the tags: so the next one starts from what went up. Newest
first.

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
