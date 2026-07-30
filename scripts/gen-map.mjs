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
//   --theme    rock material: slate (default) | veined — the game's own boulder themes
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

const SIL_HEAD = (theme) =>
  `A flat diagram: ${THEMES[theme].rock} on a pure white background. Wide ` +
  'horizontal composition, flat orthographic side elevation, straight-on, no perspective ' +
  'and no isometric tilt. ';

const SIL_TAIL = (theme) =>
  ' The background is pure flat white everywhere, edge to edge, including all four edges and ' +
  'every corner. Do NOT draw a cave, a cavern, an enclosing wall, a rock border around the ' +
  'frame, a ceiling, a floor, or a horizon. Nothing touches the left edge or the right edge. ' +
  THEMES[theme].palette +
  ' No small pebbles, no gravel, no dust, no speckles, no debris. No text, no labels, no ' +
  'grid, no border, no sky, no plants, no creatures.';

// The compositions. `scatter` is what produced silhouette-2 — usable, but it lays the rocks
// out evenly and decoratively, which is terrain rather than level design. The rest push at
// that: shapes that imply a ROUTE (where the gaps are, how wide, and how much they commit
// you). All of them still have to leave a continuous left→right channel or the level is
// unplayable — see tests/level-check.cjs, which flood-fills the real mask to prove it.
const FORMS = {
  scatter:
    'About {N} SEPARATE irregular boulders and slabs — angular cracked slate, a mix ' +
    'of large jagged masses, long horizontal ledges and smaller lumps — spread evenly across ' +
    'the whole frame at different heights, each one clearly detached from the others, with ' +
    'wide white gaps and winding white channels running between them from the left side to ' +
    'the right side.',

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
    'right so the white gaps between them form winding open lanes running from the left ' +
    'side to the right side. Do NOT stack them into a heap, a pile, a pyramid, a staircase ' +
    'or a wall. They are embedded at different depths, not resting on the ground, and none ' +
    'of them touch.',

  chokes:
    'About {N} VERY LARGE angular rock masses, each one tall enough to fill most of the ' +
    'frame height, standing well apart from one another like the piers of a bridge, separated ' +
    'by NARROW white gaps just wide enough to squeeze through, and two or three smaller ' +
    'angular lumps sitting in those gaps and partly blocking them.',

  pillars:
    'About {N} TALL VERTICAL rock pillars of varying heights and thicknesses, some ' +
    'hanging down from the top of the frame and some rising from the bottom, alternating so ' +
    'the white space between them zigzags across the frame, with a few short angular lumps ' +
    'scattered between the pillars.',

  maze:
    'About {N} interlocking angular rock masses of mixed sizes packed close together across the ' +
    'entire frame, leaving only NARROW winding white corridors between them — a dense ' +
    'labyrinth of black shapes and thin white passages, the corridors joining up so there is ' +
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
  SIL_HEAD(theme) + FORMS[form].replace('{N}', String(n != null ? n : COUNTS[form])) + SIL_TAIL(theme);

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
