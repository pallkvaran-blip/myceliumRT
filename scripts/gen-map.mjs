#!/usr/bin/env node
// Generate a whole-level UNDERGROUND map image via Replicate (FLUX), for tracing into
// rock/passable terrain on our side.
//
//   REPLICATE_API_TOKEN=… node scripts/gen-map.mjs <style> [--out name] [--model m] [--aspect a]
//
//   style      silhouette | art   (see PROMPTS below — silhouette traces cleanly, art looks
//                                  like the game; generate both and compare)
//   --out      base filename, default <style>-<n>; written to docs/maps/<out>.png
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

const PROMPTS = {
  // Traceable. Flat, lit-from-nowhere, two values only — this is a MASK that happens to be
  // rendered as a picture, not concept art.
  //
  // v1 said "cross-section map of an underground cave system" and got an enclosed CAVERN:
  // a continuous rock border sealing all four edges, white only in the pocket inside it,
  // and mid-grey outside — i.e. a level with no way in or out, and three tones to threshold
  // instead of two. It also drifted isometric. Hence the current wording: never the word
  // cave, "scattered boulders in soil", an explicit ban on a border/ceiling/floor, edge
  // clearance stated as a rule, and "flat orthographic elevation" to kill the 3/4 view. The
  // pebble ban matters too — v1's confetti of 2-4px specks would trace into mask noise.
  silhouette:
    'A flat two-tone diagram: solid black rock shapes scattered on a pure white background. ' +
    'Wide horizontal composition, flat orthographic side elevation, straight-on, no ' +
    'perspective and no isometric tilt. Fifteen to twenty SEPARATE irregular boulders and ' +
    'slabs — angular cracked slate, a mix of large jagged masses, long horizontal ledges and ' +
    'smaller lumps — spread evenly across the whole frame at different heights, each one ' +
    'clearly detached from the others, with wide white gaps and winding white channels ' +
    'running between them from the left side to the right side. The background is pure flat ' +
    'white everywhere, edge to edge, including all four edges and every corner. Do NOT draw ' +
    'a cave, a cavern, an enclosing wall, a rock border around the frame, a ceiling, a ' +
    'floor, or a horizon. Nothing touches the left edge or the right edge. No texture, no ' +
    'shading, no gradients, no lighting, no highlights, no outlines, no drop shadows, no ' +
    'grey — pure flat black on pure flat white, two tones only. No small pebbles, no gravel, ' +
    'no dust, no speckles, no debris. No text, no labels, no grid, no border, no sky, no ' +
    'plants, no creatures.',

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

// --- args --------------------------------------------------------------------
const argv = process.argv.slice(2);
const style = argv.find((a) => !a.startsWith('--')) || 'silhouette';
const flag = (name, dflt) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : dflt;
};
if (!PROMPTS[style]) {
  console.error(`unknown style "${style}" — one of: ${Object.keys(PROMPTS).join(', ')}`);
  process.exit(1);
}
const MODEL = flag('model', 'black-forest-labs/flux-1.1-pro');
const ASPECT = flag('aspect', 'custom');
const WIDTH = Number(flag('width', 1440));
const HEIGHT = Number(flag('height', 608));

let out = flag('out', null);
if (!out) {
  let n = 1;
  while (existsSync(join(OUTDIR, `${style}-${n}.png`))) n++;
  out = `${style}-${n}`;
}

// --- call Replicate ----------------------------------------------------------
// Via curl, not fetch: outbound HTTPS goes through the agent proxy and curl already honours
// it (undici would need a ProxyAgent). `Prefer: wait` makes the POST block on the result, so
// there's no polling loop. 429 self-paces on the retry_after the API hands back.

const input = { prompt: PROMPTS[style], aspect_ratio: ASPECT, output_format: 'png', safety_tolerance: 5 };
if (ASPECT === 'custom') { input.width = WIDTH; input.height = HEIGHT; }
const body = JSON.stringify({ input });

const curl = (args) => execFileSync('curl', ['-sS', ...args], { maxBuffer: 64 * 1024 * 1024 });

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

mkdirSync(OUTDIR, { recursive: true });
const png = curl(['-L', url]);
const path = join(OUTDIR, `${out}.png`);
writeFileSync(path, png);
console.log(`wrote ${path} (${(png.length / 1024).toFixed(0)} KB) — ${MODEL}, ${ASPECT === "custom" ? WIDTH + "x" + HEIGHT : ASPECT}`);
