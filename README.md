# Mycelium RT — a real-time variant

A **real-time strategy** re-imagining of the turn-based [Mycelium](https://pallkvaran-blip.github.io/mycelium2d/)
2D roguelike engine-builder. Same world, art, cards, and threats — but the clock never
waits for you.

The whole game is a single self-contained `index.html` (open it locally or serve the
folder) plus the runtime art/audio under `assets/`. It renders on a `<canvas>` with a DOM
HUD; the world falls back to a procedural look for any missing asset.

## What changed from the turn-based original

The original advances the entire world exactly **one step per player action**. This
variant advances the world on a **wall clock** instead — you act against a world that keeps
moving on its own.

- **Real-time world clock.** `tickWorld()` runs once every `CONFIG.realtime.stepMs`
  (500 ms → 2 ticks/sec) of *unpaused* time, driven from the render loop (`advanceSim`).
  Player actions (playing a card, using an ability, a basic action) apply their effect
  **instantly** and no longer tick the world — the clock does. The old **Skip a round**
  control is gone (there are no turns to pass).

- **Enemies eat a substrate pile in ~10 seconds.** Consumption rates are tuned against the
  500 ms step so a typical pile is stripped in roughly ten seconds:
  - Trichoderma (mould) clears `leavesPerRound` = 0.25 food cells/tick → a ~5-cell pile in
    ~20 ticks ≈ 10 s.
  - Ants harvest `harvestRate` = 13 nutrient/tick → a ~250-nutrient pile in ~9.6 s.

- **The colony consumes a food pile the instant it finishes growing into it.** When growth
  fully claims a pile (every cell colonised), its whole Energy value is banked immediately
  and the pile is emptied — instead of trickling in via passive income over several ticks.
  Finishing a pile still floats its `+N⚡` and offers its card draft.

- **Time pauses only while you're choosing a card from a draft** (and while the game isn't
  really being played — the run is over, a win is resolving, or a level intro / tutorial /
  full-screen menu is up). Otherwise it just keeps moving.

## Tuning

Every gameplay number still lives in the `CONFIG` object near the top of the inline script,
including the new `realtime` block:

```js
realtime: {
  enabled: true,        // set false to fall back to action-driven ticking
  stepMs: 500,          // wall-clock ms per world tick
  maxCatchUpTicks: 3,   // cap ticks processed in one frame after a stall/tab-away
},
```

The 10-second pile-consumption pace is set by `trichoderma.leavesPerRound` and
`ants.harvestRate`; if you change `realtime.stepMs`, rescale those to keep ~10 s.

## Boot shortcuts (for testing)

`#dev` starts a run immediately (skips the picker), `#puzzle` boots the fixed puzzle map,
`#notrich` / `#ants` a mould-free sandbox.

Adapted from the author's own [mycelium2d](https://github.com/pallkvaran-blip/mycelium2d).
