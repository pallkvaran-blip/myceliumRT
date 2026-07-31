#!/usr/bin/env node
// Generate a whole-level UNDERGROUND map image via Replicate (FLUX), for tracing into
// rock/passable terrain on our side.
//
//   REPLICATE_API_TOKEN=… node scripts/gen-map.mjs <style> [--n k] [--seed s] [--out name]
//                                                  [--model m] [--aspect a]
//
//   style      scatter | ledges | chokes | pillars | maze  — the traceable two-tone mask, one
//              composition each (see FORMS); or `art`, the same map in the game's palette,
//              which is pretty and completely untraceable. `silhouette` aliases `scatter`.
//   --theme    material: slate (default) | crystal | veined | ice. The first three mirror the
//              game's own boulder art; `ice` is new — see the note on THEMES.ice, it is the
//              one theme whose colour fights the tracer rather than the composition.
//   --count    how many rock masses to ask for (default per form, see COUNTS)
//   --counts   sweep it: `--counts 5,9,14,20,28` makes one image per value, named for it
//   --n        how many to generate per count (default 1); each gets the next free filename
//   --seed     fixed seed — same seed + same prompt returns the same image. With --n, seeds
//              run s, s+1, s+2… Omit for a fresh roll every time.
//   --out      base filename, default <style>-c<count>-<n>; written to docs/maps/<out>.webp
//             (WebP, not PNG: a 5-image sweep is 7 MB of PNG and 0.9 MB of WebP, and these
//              are reference images for judging composition — only the @4x upscale is traced)
//   --model    default black-forest-labs/flux-1.1-pro (use flux-schnell for cheap drafts)
//   --aspect   default "custom" + --width/--height. The world's UNDERGROUND box is
//              2600 × (1500-380) = 2600×1120, i.e. 2.32:1 — FLUX's aspect_ratio enum has
//              nothing wider than 16:9, so we ask for custom dimensions instead. Custom
//              sides must be MULTIPLES OF 32 and ≤1440, which puts 1440×608 (2.37:1) as the
//              widest near-match; 2% off the world box, absorbed when we scale to fit.
//
// Why two styles: the engine already has a tracing path we can reuse. Rock collision is NOT
// stored in cells — `solidifyRock` bakes it out of each level sprite's ALPHA into a 9px mask
// (see CLAUDE.md, "Rock has two masks"). So the ideal generated map is one whose rock can be
// matted to opaque-vs-transparent without judgement calls, which is what `silhouette` asks
// for. `art` is the same map in the game's own art direction — prettier, but every threshold
// on it is a guess, and a guess in the mask is a wall the player can't see.
//
// Token comes from the environment ONLY. Never commit it.

import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUTDIR = join(ROOT, 'docs', 'maps');

const TOKEN = process.env.REPLICATE_API_TOKEN;
if (!TOKEN) {
  console.error('set REPLICATE_API_TOKEN (environment only — never commit it)');
  process.exit(1);
}

// --- the prompts -------------------------------------------------------------
//
// Shared constraints, in both: SIDE-ON cross-section (this game is a vertical slice, not a
// top-down dungeon), no sky/surface (the engine draws its own surface above y=380), rock in
// discrete separated masses with open soil BETWEEN them — a solid crust with holes in it
// traces into a level nobody can cross. Left-to-right playability is the whole point: the
// player enters at the far left and has to reach the goal at the far right.

const STYLE_PREFIX =
  'Bioluminescent deep-earth: a cross-section of the deep earth at night. Painterly but ' +
  'clean, semi-realistic, no hard cartoon outlines, subtle organic grain. ';

// The traceable wording, minus the bit that says what the rocks are ARRANGED like. Flat,
// lit-from-nowhere, two values only — this is a MASK that happens to be rendered as a picture.
//
// v1 said "cross-section map of an underground cave system" and got an enclosed CAVERN: a
// continuous rock border sealing all four edges, white only in the pocket inside it, and
// mid-grey outside — i.e. a level with no way in or out, and three tones to threshold instead
// of two. It also drifted isometric. Hence: never the word cave, an explicit ban on a
// border/ceiling/floor, edge clearance stated as a rule, and "flat orthographic elevation" to
// kill the 3/4 view. The pebble ban matters too — v1's confetti of 2-4px specks would trace
// into mask noise. Every clause below is load-bearing; drop one and it comes back.
// The MATERIAL, separate from the composition. These name the game's own boulder themes
// (`ALL_ROCKS` in index.html: rockSlate / rockBasalt / rockRiver / rockVeined / rockMossy),
// so a traced map can match the art the procedural maps already use.
//
// The palette clause is per-theme because it is what the tracer keys off. `slate` can insist
// on two tones; anything with a coloured feature has to allow that colour AND say it never
// reaches the background — a vein that runs out to the white would cut a notch in the
// silhouette, and one that is pale rather than saturated would trace as a hole through the
// rock (see trace-map.py: the rock test is the MINIMUM channel, not luminance, exactly so a
// bright cyan vein still reads as rock).
const THEMES = {
  slate: {
    rock: 'solid black rock shapes',
    palette:
      'No texture, no shading, no gradients, no lighting, no highlights, no outlines, no ' +
      'drop shadows, no grey — pure flat black on pure flat white, two tones only.',
  },
  // rockform3 / 7 / 14 — the manifest tags them theme:'crystal'. Dark blue-black rock
  // broken open to a geode of violet and cyan shards. The cavity is the hazard here: asked
  // for carelessly the model opens it onto the background, and a cavity that reaches the
  // white traces as a bite taken out of the rock. Hence "enclosed by rock on all sides".
  // v1 said every mass was "broken open to show a geode cavity packed with crystal" and got
  // hero illustrations: two or three enormous rocks filling the frame, the geode as the
  // subject, no separation and no channels at any count from 9 to 28. A geode needs area, so
  // demanding one per rock forces the rocks huge. The crystal has to be a MINORITY feature —
  // most masses plain, a few carrying a small pocket — or the composition is gone. v1 also
  // ignored the bloom ban outright and rimmed every rock in glowing white, which is the
  // worst thing to hand a threshold, so the ban is now explicit about the rim.
  crystal: {
    rock:
      'solid near-black blue-grey rock masses. ABOUT HALF of them are plain cracked rock; ' +
      'the other half each carry a pocket of violet and cyan crystal shards set INTO the ' +
      "rock's face, covering roughly a third of that rock and surrounded by rock on every " +
      'side. There are NO loose crystals anywhere: no gems, chips, shards or fragments ' +
      'lying on the white background or scattered between the rocks — if it is crystal, it ' +
      'is inside a pocket in a rock',
    palette:
      'Flat and unlit apart from the crystals: no shading, no gradients, no drop shadows, no ' +
      'outlines. NOTHING glows: no bloom, no halo, no light spilling from a crystal, and no ' +
      'white or pale rim anywhere along a rock edge. Four tones only — near-black blue rock, ' +
      'a dark pocket behind the crystals, saturated violet and cyan crystal, and the pure ' +
      'white background. Every pocket is enclosed by rock on ALL sides and never opens onto ' +
      'the background. Do not make a crystal cave, a cave mouth, or one big hero rock.',
  },
  // NOT one of the game's boulder themes — ice is new, and it is the first theme that
  // fights the tracer rather than the composition. The background is pure white and the rock
  // test is "dark, OR strongly chromatic and not near-white", so pale glacier ice reads as
  // background and traces to nothing at all. Hence: DEEP saturated blue-teal, mid-to-dark,
  // with white banned inside a mass and banned on its edges. If a genuinely pale/white ice
  // is wanted, the answer is not a prompt — it is a black background plus an --invert in
  // trace-map.py, which would also open up bone, salt and chalk.
  ice: {
    rock:
      'solid masses of deep glacial ice — saturated blue and teal, mid-to-dark in tone, ' +
      'angular and fractured, with darker blue crack lines running through them',
    palette:
      'Flat and unlit: no shading, no gradients, no drop shadows, no outlines, no glow, no ' +
      'bloom, no sparkle, no glint. Three tones only — deep saturated blue-teal ice, darker ' +
      'blue fracture lines inside it, and the pure white background. The ice must read ' +
      'clearly DARK against the white: nothing pale, nothing white and nothing near-white ' +
      'anywhere inside a mass, and no white highlight, sheen or rim along any edge. No snow, ' +
      'no frost, no mist, no icicles, no water.',
  },
  // rockform2 / 6 / 9 / 12 — the manifest tags them theme:'ember'.
  //
  // v1 asked for "bright molten orange fissures" and the lava went where lava goes: into the
  // gaps BETWEEN the masses, which is the one place a map needs empty. Unlike every other
  // theme, whose feature lives inside a rock, this one's subject wants the negative space, so
  // banning pools and rivers fights the thing itself — all three counts ignored it and c70
  // covered the frame completely, no background and no channels at all.
  //
  // v2 takes the heat out instead of arguing: COOLING fissures, dull dark red, dim and almost
  // burnt out. Nothing molten has anywhere to flow to. The background being empty is now
  // stated as its own requirement rather than implied by a ban.
  //
  // NOTE for whoever makes this a level: STYLE_GUIDE.md reserves warm amber for ant tunnels —
  // "the one warm light underground" — and even a dim ember map spends some of that signal.
  ember: {
    rock:
      'solid masses of scorched volcanic rock — near-black and charred, angular and heavily ' +
      'cracked, with COOLING fissures inside each mass: dull dark ember-red, dim and almost ' +
      'burnt out, the last heat left in the stone',
    palette:
      'Flat and unlit: no shading, no gradients, no drop shadows, no outlines, no glow, no ' +
      'bloom, no light, no haze, no smoke, no sparks. Three tones only — near-black charred ' +
      'rock, DULL DARK RED inside its cracks, and the pure {BG} background. The fissures are ' +
      'dim and dark, barely brighter than the rock: never bright, never orange, never ' +
      'yellow, never white, never glowing. There is NO molten lava and nothing is flowing ' +
      'anywhere. Every fissure stays entirely INSIDE its rock and never touches or reaches ' +
      'the background. The background is completely EMPTY between the masses: nothing molten, ' +
      'nothing red and nothing glowing lies on it, and it is clearly visible all around every ' +
      'mass.',
  },
  // rockform4 / 8 / 11 — the manifest tags them theme:'fungal'. Near-black rock with clusters
  // of glowing teal and amber mushrooms on it and patches of luminous moss.
  //
  // Built with the two lessons already paid for. From crystal: keep the feature a MINORITY,
  // or the model makes it the subject and the composition goes. From veined: say the glow
  // stays ON the rock, because anything luminous wants to spill into the negative space, and
  // the negative space is the level.
  //
  // NOTE for whoever makes this a level: STYLE_GUIDE.md gives mint-cyan to the PLAYER —
  // "the mycelium is the hero, the brightest element on screen" — so a map lit in the same
  // colour competes with the thing the player is meant to read first. The game's own
  // rockform8 does it sparingly; a whole map of it is a louder decision than it looks.
  bioluminescent: {
    rock:
      'solid near-black rock masses, angular and cracked. MOST of the rock is bare; here and ' +
      'there a small cluster of glowing teal and amber mushrooms grows on a face, with a few ' +
      'patches of luminous moss — a minor detail on a mass, never more than a quarter of it',
    palette:
      'Flat and unlit apart from the fungus: no shading, no gradients, no drop shadows, no ' +
      'outlines, no bloom, no halo, no light spilling from anything, no glowing spores in ' +
      'the air. Four tones only — near-black rock, luminous teal, warm amber, and the pure ' +
      '{BG} background. Every mushroom and every patch of moss grows ON a rock face and sits ' +
      'entirely inside its outline: nothing luminous touches or reaches the background, and ' +
      'nothing grows in the gaps between the masses. The background is completely empty.',
  },
  // Bone and stone tangled together, on a BLACK ground for the same reason as `glacier`:
  // bone is pale, and pale on white is not a threshold at all.
  //
  // The trap specific to a dark ground is the ROCK. Every other theme's rock is near-black,
  // which on black background IS the background — so here the stone has to be a clear
  // mid-grey and the palette says so twice. The other trap is the crystal one: a skeleton is
  // a far stronger subject than a geode, so "no complete skeleton, no articulated dinosaur,
  // no dig site" is doing the same work as crystal's "no big hero rock".
  bones: {
    bg: 'black',
    rock:
      'solid masses of pale weathered stone with huge fossilised dinosaur bones tangled ' +
      'through them — bone-white ribs, vertebrae, long limb bones and the occasional skull, ' +
      'half-buried in the stone and jutting out of it. The bones are broken and jumbled, ' +
      'scattered through every mass; there is NO complete skeleton, no articulated dinosaur ' +
      'and no excavation or dig site',
    palette:
      'Flat and unlit: no shading, no gradients, no drop shadows, no outlines, no glow, no ' +
      'bloom. Three tones only — mid-grey stone, bone-white fossil, and the pure black ' +
      'background. BOTH the stone and the bone read clearly BRIGHT against the black: the ' +
      'stone is a clear mid-grey, never black, never near-black and never dark, and there is ' +
      'no dark rim, outline or shading along any edge. No dirt, no sand, no dust, no ' +
      'cobwebs, and no loose bone chips lying on the background.',
  },
  // The pale counterpart to `ice`, and the reason trace-map.py learned to detect background
  // polarity: white ice on a white ground is not a hard threshold, it is no threshold. On
  // black it is trivial. Same idea would give bone, salt or chalk.
  glacier: {
    bg: 'black',
    rock:
      'solid masses of pale glacier ice — near-white, faintly blue-white, bright and clean, ' +
      'angular and fractured, with thin pale-blue crack lines running through them',
    palette:
      'Flat and unlit: no shading, no gradients, no drop shadows, no outlines, no glow, no ' +
      'bloom, no sparkle, no glint. Three tones only — near-white blue-white ice, faint ' +
      'pale-blue cracks inside it, and the pure black background. The ice must read clearly ' +
      'BRIGHT against the black: nothing dark, nothing grey and nothing near-black anywhere ' +
      'inside a mass, and no dark rim, outline or shading along any edge. No snow drifts, no ' +
      'frost, no mist, no icicles, no water, no stars.',
  },
  veined: {
    rock:
      'solid near-black basalt masses, each one shot through with a few narrow bright ' +
      'mint-cyan mineral veins running along its cracks',
    palette:
      'Flat and unlit apart from the veins: no shading, no gradients, no drop shadows, no ' +
      'outlines, no glow or bloom around anything. THREE tones only — near-black rock, ' +
      'saturated mint-cyan veins, pure white background. Every vein stays entirely INSIDE ' +
      'its rock: no vein touches, crosses or reaches the white background, and no vein is ' +
      'white, pale or grey. The veins are thin, a few per rock, not a network.',
  },
};

// TRIED AND REVERTED: "This is a CROSS-SECTION: the whole scene has been sliced clean
// through with a blade… every mass shows ONLY its flat cut face… no thickness, no depth, no
// volume, never a view from above." It reads as the right instruction — the game IS a
// vertical slice — and it made things worse on every theme it touched. A real cross-section
// is a cut through CONTINUOUS material, so the model drew continuous material: ember came
// back as ridges and full-bleed rock walls with no background at all, and ice c40 — the best
// image any theme had produced — came back as a landscape under an empty sky.
//
// The map is a DIAGRAM convention, not a physical section: discrete masses floating in empty
// space, which nothing is ever cut through. "Flat orthographic side elevation, straight-on,
// no perspective, no isometric tilt" is as close as the wording can get, and the residual
// top-down read on some rolls is the price. See docs/maps/README.md.
const SIL_HEAD = (theme) =>
  `A flat diagram: ${THEMES[theme].rock} on a pure {BG} background. Wide ` +
  'horizontal composition, flat orthographic side elevation, straight-on, no perspective ' +
  'and no isometric tilt. ';

const SIL_TAIL = (theme) =>
  ' The background is pure flat {BG} everywhere, edge to edge, including all four edges and ' +
  'every corner. Do NOT draw a cave, a cavern, an enclosing wall, a rock border around the ' +
  'frame, a ceiling, a floor, or a horizon. The rocks are spread over the ENTIRE frame: ' +
  'they reach the left and right edges, they reach the top and bottom edges, and there is ' +
  'no empty band along any edge and no empty half. ' +
  THEMES[theme].palette +
  ' The background is completely BARE: no pebbles, no gravel, no scree, no rubble, no chips, ' +
  'no fragments, no dust, no speckles, no tufts and no loose bits of any size lying between ' +
  'the masses — if it is not one of the masses, it is not there at all. No text, no labels, ' +
  'no grid, no border, no sky, no plants, no creatures.';

// The compositions. `scatter` is what produced silhouette-2 — usable, but it lays the rocks
// out evenly and decoratively, which is terrain rather than level design. The rest push at
// that: shapes that imply a ROUTE (where the gaps are, how wide, and how much they commit
// you). All of them still have to leave a continuous left→right channel or the level is
// unplayable — see tests/level-check.cjs, which flood-fills the real mask to prove it.
const FORMS = {
  // "…and smaller lumps" used to be in here, and it is where the confetti of little rocks
  // came from — the tail bans gravel and speckles, but this clause was asking for exactly
  // the thing one clause later. Every mass is now LARGE and comparable in size, and the gap
  // around each one is stated as a rule rather than left to "wide {BG} gaps".
  scatter:
    'About {N} SEPARATE irregular rock masses — angular and cracked, a mix of big jagged ' +
    'blocks and long horizontal slabs, ALL of them large and roughly comparable in size, ' +
    'with no small rocks, lumps, chips or fragments anywhere among them — spread evenly ' +
    'across the whole frame at different heights, each one clearly detached from every ' +
    'other, with an open {BG} gap around every mass at least half as wide as the mass ' +
    'itself, and winding {BG} channels running between them from the left side to the ' +
    'right side. Size is bounded at BOTH ends: no single mass is wider than about a tenth ' +
    'of the frame width or taller than a third of its height, and NONE is smaller than a ' +
    'twentieth of the frame width. This is MANY MODEST masses covering the whole frame — ' +
    'never a few huge ones, and never any small ones.',

  // v1 said "stacked at different heights like shelves ... a staircase of open channels"
  // and the model took the staircase literally: at every count from 5 to 28 it piled the
  // slabs into a heap resting on the floor with empty sky above — which as a level is a
  // free highway across the top. Sweeping the count only changed how big the heap was. So
  // the wording now attacks the pile directly: full height, space above AND below each
  // slab, and an explicit ban on heap/pile/pyramid/staircase/wall. "Staircase" was doing
  // real damage; don't put it back.
  ledges:
    'About {N} LONG HORIZONTAL SLABS of rock, each one wide and flat and completely ' +
    'separate from every other, scattered across the FULL height and width of the frame — ' +
    'some near the top, some through the middle, some near the bottom — with open white ' +
    'space on ALL sides of each slab, above it as well as below it, and offset left and ' +
    'right so the {BG} gaps between them form winding open lanes running from the left ' +
    'side to the right side. Do NOT stack them into a heap, a pile, a pyramid, a staircase ' +
    'or a wall. They are embedded at different depths, not resting on the ground, and none ' +
    'of them touch.',

  chokes:
    'About {N} VERY LARGE angular rock masses, each one tall enough to fill most of the ' +
    'frame height, standing well apart from one another like the piers of a bridge, separated ' +
    'by NARROW {BG} gaps just wide enough to squeeze through, and two or three smaller ' +
    'angular lumps sitting in those gaps and partly blocking them.',

  pillars:
    'About {N} TALL VERTICAL rock pillars of varying heights and thicknesses, some ' +
    'hanging down from the top of the frame and some rising from the bottom, alternating so ' +
    'the {BG} space between them zigzags across the frame, with a few short angular lumps ' +
    'scattered between the pillars.',

  maze:
    'About {N} interlocking angular rock masses of mixed sizes packed close together across the ' +
    'entire frame, leaving only NARROW winding {BG} corridors between them — a dense ' +
    'labyrinth of black shapes and thin {BG} passages, the corridors joining up so there is ' +
    'always a continuous way through from the left side to the right side.',
};

const PROMPTS = {
  // The same map in the game's palette — what the player would actually see.
  art:
    STYLE_PREFIX +
    'A side-on cross-section of underground earth, wide horizontal composition. Warm ' +
    'near-black brown soil, and embedded in it a dozen or more separate masses of cold ' +
    'dark slate rock — charcoal blue-grey, faceted and cracked, with faint cool blue ' +
    'rim-light along their facet edges. The rocks are discrete formations with wide open ' +
    'soil between them and winding soil channels connecting left edge to right edge. Light ' +
    'comes from within the earth, not from above: deep blacks, small glowing accents, soft ' +
    'bloom, a few faint mint-cyan bioluminescent specks in the soil. No sky, no surface ' +
    'line, no plants, no roots, no mushrooms, no creatures, no text, no border.',
};
// How many rock masses each form asks for by default — what the images already in
// docs/maps were generated with. `--count` overrides it; sweeping the count is how you
// find a form's playable density, since it maps almost directly onto how open the traced
// level is (maze-1's ~20 gave 44.5% solid, scatter-1's ~17 gave 38.8%).
const COUNTS = { scatter: 17, ledges: 10, chokes: 6, pillars: 12, maze: 30 };

const withCount = (form, n, theme) =>
  (SIL_HEAD(theme) + FORMS[form].replace('{N}', String(n != null ? n : COUNTS[form])) + SIL_TAIL(theme))
    .replace(/\{BG\}/g, THEMES[theme].bg || 'white');

// --- args --------------------------------------------------------------------
const argv = process.argv.slice(2);
const style = argv.find((a) => !a.startsWith('--')) || 'scatter';
const flag = (name, dflt) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : dflt;
};
const isForm = Object.prototype.hasOwnProperty.call(FORMS, style) || style === 'silhouette';
if (!isForm && style !== 'art') {
  console.error(`unknown style "${style}" — one of: ${Object.keys(FORMS).join(', ')}, art`);
  process.exit(1);
}
// `--counts 5,9,14` sweeps the rock count, one image each — the fastest way to see how
// open or closed a form gets. `--count N` is the single-value form. Either overrides the
// per-form default in COUNTS.
const SWEEP = flag('counts', null);
const COUNTS_LIST = SWEEP ? SWEEP.split(',').map((s) => Number(s.trim())).filter(Boolean)
  : [flag('count', null) != null ? Number(flag('count')) : null];
const THEME = flag('theme', 'slate');
if (!THEMES[THEME]) {
  console.error(`unknown theme "${THEME}" — one of: ${Object.keys(THEMES).join(', ')}`);
  process.exit(1);
}
const promptFor = (n) => (style === 'art' ? PROMPTS.art
  : withCount(style === 'silhouette' ? 'scatter' : style, n, THEME));
const MODEL = flag('model', 'black-forest-labs/flux-1.1-pro');
const ASPECT = flag('aspect', 'custom');
const WIDTH = Number(flag('width', 1440));
const HEIGHT = Number(flag('height', 608));

const OUTNAME = flag('out', null);
const COUNT = Math.max(1, Number(flag('n', 1)));
const SEED = flag('seed', null);   // same seed + same prompt = the same image back

// --- call Replicate ----------------------------------------------------------
// Via curl, not fetch: outbound HTTPS goes through the agent proxy and curl already honours
// it (undici would need a ProxyAgent). `Prefer: wait` makes the POST block on the result, so
// there's no polling loop. 429 self-paces on the retry_after the API hands back.

const curl = (args) => execFileSync('curl', ['-sS', ...args], { maxBuffer: 64 * 1024 * 1024 });

function generate(seed, prompt) {
  const input = { prompt, aspect_ratio: ASPECT, output_format: 'webp', safety_tolerance: 5 };
  if (ASPECT === 'custom') { input.width = WIDTH; input.height = HEIGHT; }
  if (seed != null) input.seed = Number(seed);
  const body = JSON.stringify({ input });

  let res = null;
  for (let attempt = 1; attempt <= 8; attempt++) {
    const raw = curl([
      '-X', 'POST', `https://api.replicate.com/v1/models/${MODEL}/predictions`,
      '-H', `Authorization: Bearer ${TOKEN}`,
      '-H', 'Content-Type: application/json',
      '-H', 'Prefer: wait',
      '-d', body,
    ]).toString();
    let j;
    try { j = JSON.parse(raw); } catch { console.error(raw.slice(0, 800)); process.exit(1); }
    if (j.status === 429 || j.title === 'Too Many Requests') {
      const wait = (Number(j.retry_after) || 10) + 2;
      console.log(`throttled, waiting ${wait}s…`);
      execFileSync('sleep', [String(wait)]);
      continue;
    }
    res = j;
    break;
  }

  const url = Array.isArray(res?.output) ? res.output[0] : res?.output;
  if (!url) {
    console.error(`no image (status=${res?.status}): ${JSON.stringify(res).slice(0, 800)}`);
    process.exit(1);
  }
  return curl(['-L', url]);
}

mkdirSync(OUTDIR, { recursive: true });
const size = ASPECT === 'custom' ? `${WIDTH}x${HEIGHT}` : ASPECT;

// One image per (rock count × --n). Files are named for the count when sweeping, so the
// filename says what it asked for — `ledges-c14-1.png` rather than a bare index nobody can
// map back to a prompt afterwards.
let made = 0;
for (const rocks of COUNTS_LIST) {
  for (let i = 0; i < COUNT; i++) {
    const themeTag = THEME === 'slate' ? '' : `${THEME}-`;
    const tag = rocks != null ? `${themeTag}${style}-c${rocks}` : `${themeTag}${style}`;
    let out = OUTNAME ? (COUNT === 1 && COUNTS_LIST.length === 1 ? OUTNAME : `${OUTNAME}-${made + 1}`) : null;
    if (!out) {
      let n = 1;
      while (existsSync(join(OUTDIR, `${tag}-${n}.webp`))) n++;
      out = `${tag}-${n}`;
    }
    const png = generate(SEED == null ? null : Number(SEED) + made, promptFor(rocks));
    const path = join(OUTDIR, `${out}.webp`);
    writeFileSync(path, png);
    made++;
    console.log(`wrote ${path} (${(png.length / 1024).toFixed(0)} KB) — ${MODEL}, ${size}`
      + (rocks != null ? `, ~${rocks} rocks` : ''));
  }
}
