# The CrazyGames cut

A second public build, alongside the itch one. It exists on the **`claude/crazygames-cy7nf3`**
branch and nowhere else.

```bash
node scripts/make-crazygames-zip.mjs     # -> dist/mycelium-crazygames.zip
node tests/crazygames-check.cjs          # 34 assertions, against the ARTEFACT
```

The build takes about twelve minutes, almost all of it re-encoding ~600 images at libwebp
`method=6`. `--fast` skips the re-encode (useful when iterating on the level prune or the SDK
adapter; the zip it produces is ~41 MB and will fail the size gate, which is fine).

## THE POINT OF THE BRANCH: `index.html` DOES NOT CHANGE

Not "changes little" — **byte-identical to the itch build**. Every CrazyGames-specific thing is
injected into the staged copy at build time:

| what | where it lives |
|---|---|
| the SDK adapter (saving + muting) | `scripts/cg-sdk-shim.js`, injected as its own `<script>` |
| deferring the game until the SDK is up | a re-tag of the one `<script>` in the staged HTML |
| the two audio handles the shim needs | one appended line, inside the game script's own scope |
| dropping levels, dropping a track | edits to the staged HTML |

So keeping up with itch is `git merge` of a branch that cannot conflict in the game file, and
**every check in `tests/run.mjs` still describes this branch correctly** — they run against the
working tree, which is the itch game. That is the whole reason it was built this way rather than
by editing the modules; the alternative was 23 storage call sites patched by regex at build time,
where a missed one is a save that silently stops syncing.

## What it drops, and why

CrazyGames prefer games under **50 MB**, and under **20 MB** a game is also listed in their
mobile store. The build **fails above 20 MB** rather than letting the submission discover it.

| | itch | CrazyGames |
|---|---|---|
| size | 53.5 MB | **18.8 MB** |
| files | 995 | 629 |
| campaign | 9 levels | 9 levels — untouched |
| survival bag | 17 maps | **8 maps** |
| map sprites | as traced | webp q75 |
| card / species art | as drawn | jpeg q60 / q70 |
| loose png art | as drawn | palette-quantised to 256 |
| music | 4 tracks, 168–190 kb/s | **3 tracks, 80 kb/s** |

Measured, per group, on the real assets: jpg 52% · png 31% · webp 50% · mp3 42%.

### The eight survival maps are chosen for THEME, not for size

Five of them (**anthracite · garnet · obsidian · rust · veined**) reuse a campaign map's
`assetsFrom` folder, so they are already staged and cost **nothing at all**. The other three
(**glass · crystal · biolum**) are bought outright because otherwise those themes would be
missing from survival entirely. Editing `SURVIVAL_KEEP` is the first lever if the target moves;
the rotation needs no code change, because `survivalMaps()` reads whatever carries
`survival: true` in `LEVELS` and the dropped maps leave `LEVELS` too.

**That last part is not optional.** A survival map left in `LEVELS` with no assets folder joins
the rotation bag and then 404s its sprites — and a preload that never completes hangs *every*
map on a black screen, which is the failure mode CLAUDE.md already records as looking nothing
like its cause.

### Things measured and rejected

- **Downscaling the sprites.** The obvious win, and wrong here: they run about **2.0 source
  pixels per world unit** against roughly **2.7 demanded at maximum zoom**, so they are already
  slightly soft when zoomed in and shrinking them is visible. Quality reduction is the cheaper
  axis.
- **png → webp.** 29% of the original against 31% for palette-quantising — two points, in
  exchange for a rename that has to be chased through `manifest.json`, the paths hard-coded in
  `index.html` and anything derived from `assetsFrom`. Not worth a 404.
- **A music bitrate between 64 and 80.** MP3 has a fixed bitrate ladder and libmp3lame rounds
  down silently: `-b:a 72k` produced a byte-identical file to 64k. Dropping a track is the
  better lever anyway — three tracks at 80 kb/s weigh less than four at 64 and sound better.

**Alpha is bit-identical at every quality setting** (measured, max delta 0), and alpha is what
`solidifyRock` and `_alphaMask` sample — so none of this can move a wall. Only the picture
changes.

## The SDK integration

Two requirements, both implemented in `scripts/cg-sdk-shim.js`:

**1. Saving** — [docs](https://docs.crazygames.com/sdk/data/). Their data module mirrors the
`localStorage` interface exactly and synchronously, which is what makes this a drop-in: the shim
replaces `window.localStorage` itself, so all 23 of the game's storage calls — eleven
`mycelium.*` keys plus the two mute flags — are untouched and start syncing across a signed-in
player's devices.

**2. Muting** — [docs](https://docs.crazygames.com/sdk/game/#game-settings). `settings.muteAudio`
takes priority over the game's own audio settings, applied on boot and again through
`addSettingsChangeListener`. The game exposes only *toggles*, so the shim toggles when the state
differs — **and puts the persisted value back afterwards**, which is the subtlety: without that,
honouring a CrazyGames mute would overwrite the player's own saved preference, in a save that now
follows them to every device.

Both degrade safely. If the SDK is missing, blocked, or slow (there is an 8-second bail), the
game runs on ordinary `localStorage` — a page that never boots is a far worse failure than one
that does not sync.

### The bug this shape caused, recorded so it is not reintroduced

The shim is a `<script>` in `<head>` and the deferred game tag is the *next element*, so when a
resolved promise calls back, `getElementById('cgGame')` is **still null** — the parser has not
reached it. The first version latched its "already started" flag before looking and permanently
disabled the game: a page that loaded to nothing, on a build where every other assertion passed.
It waits for `DOMContentLoaded` when the tag is not there yet. Only a check against the built zip
could have found this.

## Before submitting

- [ ] `node scripts/make-crazygames-zip.mjs && node tests/crazygames-check.cjs` — 34/34.
- [ ] In the submission form, set progress-saving to **"Yes, using the Data Module from the
      CrazyGames SDK"**. The data module is *disabled* otherwise and every save silently falls
      back to local-only.
- [ ] Upload `dist/mycelium-crazygames.zip`.

**Not implemented, and worth knowing before they ask.** `gameplayStart()` / `gameplayStop()` and
`loadingStart()` / `loadingStop()` are part of the same game module and CrazyGames use them for
ad timing; they were out of scope here because they need real hooks into run start/end and the
loading screen rather than a wrapper. Neither is required for the two stipulations above, but a
reviewer may ask for `gameplayStart`/`gameplayStop`.
