# Mycelium — turn-based *and* real-time

[Mycelium](https://pallkvaran-blip.github.io/mycelium2d/) is a 2D roguelike engine-builder
about growing a fungal colony to the surface. This build ships **both games in one**: the
original **turn-based** Mycelium, and a **real-time** variant where the clock never waits
for you. Same world, art, cards and threats — you pick which game you're playing from the
title screen (New/Old for each, side by side).

The whole game is a single self-contained `index.html` (open it locally or serve the
folder) plus the runtime art/audio under `assets/`. It renders on a `<canvas>` with a DOM
HUD; the world falls back to a procedural look for any missing asset.

## The two modes

`CONFIG.mode` is `'turn'` or `'realtime'`; `setMode()` applies it, and `realtime.enabled` is
the single flag every mode-dependent rule reads (engine code sees it as
`state.config.realtime.enabled`). The title screen calls `setMode()` before the run starts.

**Turn-based** advances the entire world exactly **one step per player action**.

**Real-time** advances the world on a **wall clock** instead — you act against a world that
keeps moving on its own:

- **Real-time world clock.** `tickWorld()` runs once every `CONFIG.realtime.stepMs`
  (500 ms → 2 ticks/sec) of *unpaused* time, driven from the render loop (`advanceSim`).
  Player actions (playing a card, using an ability, a basic action) apply their effect
  **instantly** and no longer tick the world — the clock does. The **Skip a round** control
  is hidden (there are no turns to pass).

- **A round is 10 seconds** (`cards.roundSeconds`). Every card cadence is authored in rounds
  — engine income and `every N`, dig cadences, ability cooldowns, per-round use caps, the
  Magic Mushroom conjure clock — so they all follow that one number, and card text is
  rewritten from rounds to seconds at display time (`timeify`). Turn-based leaves the text
  in rounds, where one action is one round. The corner pills show that charge as a **time
  bar** that fills gradually in real time, and as **one dot per round** in turn-based, where
  the meter genuinely steps a whole notch per action (`cadenceLightsHTML`).

- **Enemies eat a substrate pile in ~10 seconds.** Consumption rates are tuned against the
  500 ms step: Trichoderma clears `leavesPerRound` food cells per tick, ants harvest
  `harvestRate` nutrient per tick.

- **The colony consumes a food pile the instant it finishes growing into it.** When growth
  fully claims a pile (every cell colonised), its whole Energy value is banked immediately
  and the pile is emptied — instead of trickling in via passive income over several turns,
  which is how turn-based plays. Finishing a pile still floats its `+N⚡` and offers its
  card draft.

- **Growth lands as it arrives.** A grow commits its whole path at once and the renderer
  animates it in over ~1–3 s, so each strand records when it finishes appearing
  (`node._liveAt`, via `Network.grownIn`). Until then the world can't act on it: threats
  can't sense or eat it, it can't claim a pile, and it can't win at the goal. Turn-based
  needs none of this (nothing happens between actions), so the gate is off there.
  Colonisation is therefore re-decided each tick *while a grow is still travelling*
  (`net._arriveUntil`) — and only then, so the colony never reaches out and takes a pile the
  player didn't grow toward.

- **Time pauses only while you're choosing a card from a draft** (and while the game isn't
  really being played — the run is over, a win is resolving, or a level intro / tutorial /
  full-screen menu is up). Everything freezes together, including the marching ants.

Each mode keeps its **own continue slot**, so starting a real-time run never clobbers the
turn-based game you were halfway through. Unlock progress (species, spores) is shared.

## Tuning

Every gameplay number lives in the `CONFIG` object near the top of the inline script. Rates
that mean different things per mode — threat speeds, eating rates, rot spread, the ant line's
build speed — live in `MODE_TUNING`, which `setMode()` writes into `CONFIG`: real-time values
are *per 500 ms tick*, turn-based values are *per player action*.

```js
realtime: {
  enabled: true,        // false = turn-based (the world ticks from performAction)
  stepMs: 500,          // wall-clock ms per world tick
  maxCatchUpTicks: 3,   // cap ticks processed in one frame after a stall/tab-away
},
```

If you change `realtime.stepMs`, rescale `trichoderma.leavesPerRound` and `ants.harvestRate`
to keep the ~10 s pile pace.

## Boot shortcuts (for testing)

The hash is a comma-separated list: the first token is the destination, the rest are flags.
`#dev` starts a run immediately (skips the picker), `#puzzle` boots the fixed puzzle map,
`#notrich` / `#ants` a mould-free sandbox. These skip the title screen, so they never choose
a mode — they run real-time unless you add the `turn` flag (`#dev,turn`).

## Card timing review tool

`docs/card-review.html` lists every timed card with its real-time cadence in seconds and how
often it fires per two minutes, with buttons to mark which overpowered ones should become
"N× per level" instead. Regenerate it from the game's own card data with
`node scripts/gen-card-review.mjs`.

Adapted from the author's own [mycelium2d](https://github.com/pallkvaran-blip/mycelium2d).
