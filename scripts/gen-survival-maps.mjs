#!/usr/bin/env node
// Turn the owner's survival map exports into docs/levels/ entries.
//
// WHAT THE OWNER SUPPLIED and what this adds are deliberately separate, because re-running this
// must never touch their work: they placed the ROCK, the water (lakes + reservoirs) and the RED
// leaf piles by hand, and every one of those objects is copied through untouched. This script
// adds only the three bookkeeping fields a survival map needs (`survival`, `assetsFrom`,
// `campaignLevel: null`); the sky and the orange/yellow piles are two other scripts, for reasons
// recorded below.
//
// The ORANGE and YELLOW piles are NOT placed here. They have to miss the rock, and on a traced
// map the rock is a set of irregular sprite silhouettes whose collision the game derives from
// each sprite's own alpha at RENDER time (solidifyRock). Reproducing that offline would be a
// second implementation of the thing being placed against, so `scripts/place-survival-food.mjs`
// runs afterwards and picks the spots inside the running game, off the real mask.
//
//   node scripts/gen-survival-maps.mjs <dir-of-owner-exports>   # writes docs/levels/*.json
//   node scripts/gen-survival-maps.mjs <dir> --dry              # prints, writes nothing
//
// THE FULL PIPELINE, in order — each step needs the one before it committed to index.html:
//   node scripts/gen-survival-maps.mjs <dir>
//   node scripts/gen-levels.mjs
//   node scripts/author-campaign-surface.mjs 0-survival     # the sky (see below)
//   node scripts/place-survival-food.mjs                    # the orange/yellow piles
//   node scripts/gen-levels.mjs
//
// THE SURFACE BACKDROP IS NOT WRITTEN HERE. `scripts/author-campaign-surface.mjs` already owns
// it, transcribes survival's own generateSubstrate/cityRuns rules, and — the part that is easy to
// miss and impossible to get right from the JSON — enforces NO BUILDING OVER ROCK THE SOIL LINE
// CUTS. An authored map's rock is a sprite clipped at surfaceY, so a boulder placed high ends in
// a flat cut along the horizon and a skyline on it reads as a building balanced on a sawn-off
// rock; a mountain reads as the rock carrying on upward. The cut is a property of the sprite's
// ALPHA, so it can only be measured in the running game, which is why that script needs a
// browser and why a hand-rolled tiler here cannot be right: the first version of this script laid
// mountains and cities edge to edge across [216, 2484] and put a city over cut rock on 13 of the
// 17 maps (`sky` caught it, 83/109).
//
// So run it afterwards:  node scripts/author-campaign-surface.mjs 0-survival
// It replaces any surface objects already on the map, so re-running either script is safe.
// Which assets/<folder>/ holds a map's rock sprites. A survival map has its own id and no folder
// of its own; the sprites are still the source traced map's, and the boulder KEYS name it
// (`anthracite-c24R017` → `anthracite-c24`). Read from the objects rather than parsed out of the
// id, because the ids are the owner's and do not all follow one pattern.
function assetsFromOf(def) {
  const pref = new Set();
  for (const o of def.objects || []) {
    if (!o.key) continue;
    const m = /^(.*?)R\d+$/.exec(o.key);
    if (m) pref.add(m[1]);
  }
  if (pref.size !== 1) return null;
  return [...pref][0];
}

const args = process.argv.slice(2);
const dry = args.includes('--dry');
const srcDir = args.find((a) => !a.startsWith('--'));
if (!srcDir) { console.error('usage: gen-survival-maps.mjs <dir-of-owner-exports> [--dry]'); process.exit(1); }

let n = 0;
for (const f of fs.readdirSync(srcDir).filter((f) => f.endsWith('.json')).sort()) {
  const def = JSON.parse(fs.readFileSync(path.join(srcDir, f), 'utf8'));
  if (def.format !== 'mycelium-level') continue;
  const af = assetsFromOf(def);
  if (!af) { console.error(`  SKIP ${def.id}: could not resolve one asset folder from its rock keys`); continue; }
  if (!fs.existsSync(path.join(ROOT, 'assets', af))) { console.error(`  SKIP ${def.id}: assets/${af} does not exist`); continue; }

  const dst = path.join(OUT, def.id + '.json');
  // Keep any orange/yellow piles a previous run of place-survival-food already wrote, so the
  // scripts can be re-run in any order without one undoing another.
  let keptFood = [];
  if (fs.existsSync(dst)) {
    const prev = JSON.parse(fs.readFileSync(dst, 'utf8'));
    keptFood = (prev.objects || []).filter((o) => o.t === 'food' && o.kind !== 'cache-engine');
  }

  // Keep any surface objects author-campaign-surface already wrote, for the same reason as the
  // food: the two later scripts must be re-runnable in any order without this one undoing them.
  const keptSky = fs.existsSync(dst)
    ? (JSON.parse(fs.readFileSync(dst, 'utf8')).objects || []).filter((o) => ['mountain', 'city', 'prop'].includes(o.t))
    : [];
  const owner = (def.objects || []).filter((o) => !['mountain', 'city', 'prop'].includes(o.t)
                                                && !(o.t === 'food' && o.kind !== 'cache-engine'));
  const out = {
    format: 'mycelium-level',
    version: 1,
    id: def.id,
    name: def.name,
    campaignLevel: null,
    // THE SURVIVAL POOL, and the one flag that puts a map in it. It also means the map's threats
    // are seeded from the LEVEL rather than authored: survival plays these in a random order, so
    // the same map is level 2 in one run and level 40 in the next and a fixed spawn list could
    // only be right for one of them. See createLevelState.
    survival: true,
    assetsFrom: af,
    world: def.world,
    layout: def.layout,
    ...(def.traced ? { traced: def.traced } : {}),
    ...(def.render ? { render: def.render } : {}),
    objects: [...owner, ...keptFood, ...keptSky],
  };
  console.log(`  ${def.id.padEnd(34)} assets=${af.padEnd(16)} rock=${owner.filter((o) => o.t === 'boulder' || o.t === 'formation').length}` +
    ` water=${owner.filter((o) => o.t === 'lake' || o.t === 'reservoir').length} red=${owner.filter((o) => o.kind === 'cache-engine').length}` +
    `  kept: sky=${keptSky.length} food=${keptFood.length}`);
  if (!dry) fs.writeFileSync(dst, JSON.stringify(out, null, 1) + '\n');
  n++;
}
console.log(`${dry ? 'would write' : 'wrote'} ${n} survival level(s) to docs/levels/`);
