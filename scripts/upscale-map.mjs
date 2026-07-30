#!/usr/bin/env node
// Upscale a generated map image 4x via Replicate (Real-ESRGAN), for tracing at a
// resolution that survives zooming in.
//
//   REPLICATE_API_TOKEN=… node scripts/upscale-map.mjs docs/maps/maze-1.png [--scale 4]
//   -> docs/maps/maze-1@4x.webp
//
// Stored as WebP q92, not PNG: the 5760x2432 result is 11 MB as PNG, 6.9 MB losslessly,
// and 0.8 MB at q92 — where the trace threshold (luminance < 128) disagrees with the
// lossless version on 0.0135% of pixels, all of them edge dither, on an image whose
// collision is sampled at 160px anyway. The upscale is committed so a re-trace reproduces
// what shipped without paying for the model again.
//
// Why this instead of generating bigger: FLUX's `custom` dimensions cap at 1440 per side,
// which over a 2952-unit world is ~2 world units per source pixel — fine zoomed out, mush
// at the zoom the game is actually played at. Regenerating on a model that can go wider
// would give a DIFFERENT map; upscaling keeps the composition that was chosen and just
// adds pixels. The art is flat-shaded with hard edges, which is the case ESRGAN handles
// best (and the case a plain Lanczos resize handles worst — it just blurs the edges).
//
// Collision is unaffected either way: solidifyRock samples every sprite down to 160px on
// its long side, so resolution here is purely what the player sees.

import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, basename, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const TOKEN = process.env.REPLICATE_API_TOKEN;
if (!TOKEN) { console.error('set REPLICATE_API_TOKEN (environment only — never commit it)'); process.exit(1); }

const argv = process.argv.slice(2);
const src = argv.find((x) => !x.startsWith('--'));
if (!src) { console.error('usage: upscale-map.mjs <image> [--scale 4] [--model m]'); process.exit(1); }
const flag = (n, d) => { const i = argv.indexOf(`--${n}`); return i >= 0 && argv[i + 1] ? argv[i + 1] : d; };
const SCALE = Number(flag('scale', 4));
const MODEL = flag('model', 'nightmareai/real-esrgan');

const srcPath = join(ROOT, src);
const b64 = readFileSync(srcPath).toString('base64');
const mime = extname(src).toLowerCase() === '.webp' ? 'image/webp' : 'image/png';
// The image goes up as a data URI, which for a 1.2 MB PNG is ~1.6 MB of base64 — well past
// the argv limit, so the body goes through a temp file (`curl -d @file`) rather than an
// argument. Passing it inline fails with E2BIG, which reads like a curl bug and isn't one.
const bodyFile = join(tmpdir(), `upscale-${process.pid}.json`);
writeFileSync(bodyFile, JSON.stringify({
  input: { image: `data:${mime};base64,${b64}`, scale: SCALE, face_enhance: false },
}));

const curl = (args) => execFileSync('curl', ['-sS', ...args], { maxBuffer: 512 * 1024 * 1024 });

// `Prefer: wait` blocks for up to 60s; an upscale of a 1440px image can take longer, so
// fall back to polling the prediction instead of giving up on it.
let res = JSON.parse(curl([
  '-X', 'POST', `https://api.replicate.com/v1/models/${MODEL}/predictions`,
  '-H', `Authorization: Bearer ${TOKEN}`, '-H', 'Content-Type: application/json',
  '-H', 'Prefer: wait', '-d', `@${bodyFile}`,
]).toString());
rmSync(bodyFile, { force: true });

for (let i = 0; i < 60 && (res.status === 'starting' || res.status === 'processing'); i++) {
  execFileSync('sleep', ['5']);
  res = JSON.parse(curl(['-H', `Authorization: Bearer ${TOKEN}`, res.urls.get]).toString());
}

const url = Array.isArray(res?.output) ? res.output[0] : res?.output;
if (!url) { console.error(`no image (status=${res?.status}): ${JSON.stringify(res).slice(0, 600)}`); process.exit(1); }

const raw = join(tmpdir(), `upscale-${process.pid}.png`);
writeFileSync(raw, curl(['-L', url]));
const out = join(dirname(srcPath), `${basename(src, extname(src))}@${SCALE}x.webp`);
execFileSync('python3', ['-c',
  'import sys;from PIL import Image;Image.open(sys.argv[1]).save(sys.argv[2],"WEBP",quality=92,method=6)',
  raw, out]);
rmSync(raw, { force: true });
const mb = (readFileSync(out).length / 1024 / 1024).toFixed(2);
console.log(`wrote ${out} (${mb} MB) — ${MODEL} ×${SCALE}`);
