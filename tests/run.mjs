/* Run the checks and print one summary.
 *
 *   node tests/run.mjs              every check
 *   node tests/run.mjs hs lure      only those whose name contains "hs" or "lure"
 *   node tests/run.mjs --mine       THE ONE TO USE: the mine and the engine it runs
 *   node tests/run.mjs --fast       skip the slow ones (rt-test, tut-check, lure-check)
 *
 * Playwright is expected on NODE_PATH; see tests/README.md.
 */
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));

// name, file, rough seconds, slow? — ordered cheapest-first so a break shows up early.
//
// A CHECK NOT IN THIS TABLE NEVER RUNS. Six had accumulated outside it — written with the work
// that motivated them, committed, and then only ever run by hand once. They are in now.
const CHECKS = [
  ['species',   'species-check.mjs', 1,   false],
  ['pill',      'pill-check.cjs',    10,  false],
  ['review',    'review-check.cjs',  15,  false],
  ['quotes',    'quote-review-check.cjs', 15, false],
  ['sptool',    'species-tool-check.cjs', 25, false],
  ['titlecard', 'title-card-check.cjs', 110, false],
  ['mapmenu',   'mapmenu-check.cjs', 40, false],
  ['special',   'special-check.cjs', 60, false],
  ['ingame',    'ingame-text.cjs',   25,  false],
  ['tutscript', 'tutorial-script-check.cjs', 45, false],
  ['card',      'card-deselect-check.cjs', 20, false],
  ['feel',      'feel-check.cjs',    70,  false],
  ['hover',     'hover-check.cjs',   30,  false],
  ['reveal',    'reveal-check.cjs',  45,  false],
  ['hudtop',    'hudtop-check.cjs',  70,  false],
  ['camstart',  'camstart-check.cjs', 45, false],
  ['assets',    'asset-retry-check.cjs', 60, false],
  ['boot',      'boot-check.cjs',    60,  false],
  ['hs',        'hs-check.cjs',      35,  false],
  ['store',     'store-check.cjs',   35,  false],
  ['mine',      'mine-check.cjs',   240,  false],
  ['ending',    'ending-check.cjs', 110,  false],
  // M2: the dev gate, no level card, the collision gate, the heat bypass, the aim price, playSeed, the retag.
  ['ship',      'ship-check.cjs',   200,  false],
  // M3: the phone — the two-row HUD fits with everything up, taps dig / cut, #minehint, the loader.
  ['phone',     'phone-check.cjs',  120,  false],
  // M4: the first minute — first visit skips the title, ghost finger, one-shot tips, the price-line
  // beat, collection feedback, spent pockets, the dead-end nudge, 'Your first descent'.
  ['onboard',   'onboard-check.cjs', 150, false],
  // M5: the economy — reach payout, the progressive store, heat at full tolerance, the v1 refund,
  // rich seams (and the chunk records' determinism), the end screen's rows / next goal / Descend.
  ['econ',      'econ-check.cjs',   200,  false],
  // M6: threats you can read and answer — the flask kills, breeding stops at 6 attached, the cloud's
  // creep, one dose cuts one patch, the 30 s first clock, chevrons + the worm chip, the copy.
  ['counter',   'counter-check.cjs', 330, false],
  // M7: journey leg worlds — the west hill / east island / taproot layout, determinism, the free
  // layout's pinned records, and legs 1-3 through tests/bots/legprobe.cjs's measure.
  ['journey',   'journey-check.cjs', 40,  false],
  // M8: landfall on the taproot (ROOTED, the island bonus, the next leg), the title's Continue and the
  // journey strip, per-leg record lines and their NEW FARTHEST beat, the leg banner, telemetry.
  ['landfall',  'landfall-check.cjs', 150, false],
  // M9: legs 4-8's rules on the config clone, legs 1-8 reachable with the taproot in place and the path
  // ratio in band, the Promised Land's finale end to end, and a leg-8 frame at 4,000 strands.
  ['legs',      'legs-check.cjs',     600, false],
  // M10: the compasses — tracks and reveal, nothing-bought draws nothing, bearings/distances through rock,
  // rung 3's richest seam, chunk order-independence with the idle look-ahead, no long task from it, and
  // no needle on a HUD rect at 390 px.
  ['compass',   'compass-check.cjs',  300, false],
  // M11: the oxalic vial — a 2.5-cell wall dug through to a claimed seam with the mask untouched, a
  // 6-cell wall refused, the tile hidden before leg 3, strands inside rock tolerated, the real UI path.
  ['vial',      'vial-check.cjs',     300, false],
  // M12: the juice — every cue counted on one scripted descent (and nothing created muted), vibration
  // on a seam and a pocket only when on, no shake under Reduced motion, the low-water chip / price
  // pulse / kit pulses, and the frame p95 cost of all of it at 16 worms (<= 1.0 ms).
  ['juice',     'juice-check.cjs',    420, false],
  // M13: come back tomorrow — the fossil, the Daily Dig (seed, kit, payout, streak, board, Copy result),
  // New Journey's rules and seed table, strains, and the returning title.
  ['return',    'return-check.cjs',   480, false],
  // M2: THE RELEASE GATE, on a throwaway --no-shrink zip of the working tree (dev flag patched off):
  // the prune keeps the mine's bands, and title -> descent -> end -> store -> Descend plays clean.
  ['zip',       'itchzip-check.cjs --fresh', 60, false],
  ['rate',      'rate-check.cjs',    40,  false],
  ['cele',      'cele-check.cjs',    35,  false],
  ['handoff',   'handoff-check.cjs', 60,  false],
  ['survival',  'survival-check.cjs', 75, false],
  ['cardtool',  'card-tool-check.cjs', 45, false],
  ['cardrules', 'card-rules-check.cjs', 40, false],
  ['telem',     'telemetry-check.cjs', 60, false],
  ['analytics', 'analytics-check.cjs', 30, false],
  ['crazy',     'crazygames-check.cjs', 90, false],
  ['mobile',    'mobile-check.cjs',  150, false],
  ['victory',   'victory-check.cjs',  60, false],
  ['campaign',  'campaign-check.cjs', 110, false],
  ['water',     'water-check.cjs',   30,  false],
  ['surface',   'surface-edit-check.cjs', 30, false],
  ['level',     'level-check.cjs',   50,  false],
  ['traced',    'traced-check.cjs',  60,  false],
  ['ctreats',   'campaign-threats-check.cjs', 60, false],
  ['ants',      'ant-rock-check.cjs', 60, false],
  ['challenge', 'challenge-check.cjs', 90, false],
  ['sky',       'surface-rock-check.cjs', 120, false],
  ['turn-play', 'turn-play.cjs',     40,  false],
  ['enemy',     'enemy-turn-check.cjs', 60, false],
  ['aim',       'aim-check.cjs',     45,  false],
  ['fixes',     'fixes-check.cjs',   90,  false],
  ['edit',      'edit-check.cjs',    40,  false],
  ['scale',     'scale-check.cjs',   85,  false],
  ['threat',    'threat-check.cjs',  90,  false],
  ['harvest',   'harvest-check.cjs', 40,  false],
  ['cascade',   'cascade-check.cjs', 120, false],
  ['mould',     'mould-check.cjs',   40,  false],
  ['core',      'core-check.cjs',    75,  false],
  ['mode',      'mode-check.cjs',    100, false],
  ['lure',      'lure-check.cjs',    70,  true],
  ['tut',       'tut-check.cjs',     120, true],
  ['rt',        'rt-test.cjs',       180, true],
  // The M1 bot sweep: one descent per seed on 12 seeds, ~1 min each. Not in --mine.
  ['sweep',     'bots/sweep.cjs',    720, true],
  // M4 acceptance 7: the naive new player (deepest tip, follows the drawn glow) on 8 seeds, ~6 min.
  // Not in --mine (a bot, and long); run by name: `node tests/run.mjs naive`.
  ['naive',     'bots/naive.cjs',    600, true],
  // M8 acceptance 3: the journey bot (tests/bots/journey.cjs) on fresh saves — landfall 1 by run 5, then
  // legs 2 and 3 within 7 runs each. ~1 h a save; run by name, not in --mine.
  ['journeybot', 'bots/journey.cjs', 3600, true],
  // M9 acceptance 2: legprobe's kit gates on every leg — the navigator's water to the taproot with the
  // table's arrival kit (<= 70% of supply) and bare (> 100%, legs 3-8), legs 7-8 >= 40% of east below
  // 84 m. ~25 min; run by name, not in --mine.
  ['legkit',    'bots/legprobe.cjs --legs 1,2,3,4,5,6,7,8 --kit --check', 2400, true],
  // M10 acceptance 6b: the garnet compass (rung 2) against a blind hunter, first garnet seam in digs, on
  // five free-layout seeds. ~10 min; run by name, not in --mine.
  ['seamhunt',  'bots/seamhunt.cjs', 1200, true],
];

// THE MINE SUBSET. Owner, 20 Aug: "stop checking survival mode and campaign — those are not a part
// of the game anymore and they won't be in the future. If we want to bring them back later, that
// will be fully separate work."
//
// So this is not "the fast ones", it is **everything the mine actually runs**: its own check, plus
// the ENGINE checks whose code a mine run executes. That distinction is the whole list — several of
// these boot a campaign map, and they are here because the machinery under it is the machinery the
// mine uses, not out of loyalty to the card game:
//
//   threat, mould  the trichoderma spread and the worm movement. The mine's own infection design
//                  reuses the gradual spread wholesale, so this is a dependency, not legacy.
//   harvest        `colonizeReachablePiles` / `cleanCover` — how an ore seam is claimed and paid.
//   scale          `CONFIG.growth.scale` and the wall-hop rule that every dig goes through.
//   core           the molten floor, which the mine sets `coreDepthFrac` against.
//   level          `buildLevel` / `createLevelState`, the path every generated mine map goes down.
//   aim            the drag-aim gesture, which IS the mine's entire action layer.
//   store          the shelf, wallets and upgrade tracks, including the mine's own four.
//   boot           the game still starts.
//   ending         every way a descent ends, and that every exit banks (finishing plan M1).
//   ship           a build that can ship: dev buttons, level card, collision + heat gates (M2).
//   zip            the release zip itself plays the mine, dev flag off, no 404s (M2).
//   phone          a 360-390 px phone sees and can use every control (M3).
//   onboard        the first minute teaches itself (M4); the naive bot is tests/bots/naive.cjs.
//   econ           every run pays, every store visit buys (M5); the bot acceptance is tests/bots/econ.cjs.
//   counter        threats you can read and answer (M6); the career acceptance is tests/bots/career.cjs.
//   journey        fixed leg worlds with a taproot in the east (M7); seeds are picked by tests/bots/legprobe.cjs.
//   landfall       landfall, the next leg, visible progress (M8); the bot acceptance is tests/bots/journey.cjs.
//   legs           legs 4-8, their rules, the Promised Land, long-run performance (M9); the kit gates are `legkit`.
//   compass        the compasses (M10); the bot acceptance is `seamhunt` and `journeybot --island-compass`.
//   return         the fossil, the Daily Dig, New Journey, strains, the returning title (M13); the seed
//                  tables are picked by tests/bots/journeyseeds.cjs.
//
// Everything else in CHECKS is the card game and is no longer run. Nothing has been DELETED — the
// code is untouched and the checks still work if `node tests/run.mjs campaign` is ever wanted.
const MINE_SET = ['mine', 'ending', 'ship', 'zip', 'phone', 'onboard', 'econ', 'counter', 'journey', 'landfall', 'legs', 'compass', 'vial', 'juice', 'return', 'threat', 'mould', 'harvest', 'scale', 'core', 'level', 'aim', 'store', 'boot'];

const args = process.argv.slice(2);
const fast = args.includes('--fast');
const mineOnly = args.includes('--mine');
const pats = args.filter((a) => !a.startsWith('--'));
// A PATTERN THAT IS A CHECK'S EXACT NAME PICKS THAT CHECK ONLY (M8 verify): as a bare substring,
// `run.mjs journey` also started `journeybot`, an hour of bot play. Anything else still matches by
// substring (`run.mjs tuts` picks `tutscript`).
const matches = (p, name) => CHECKS.some(([n]) => n === p) ? name === p : name.includes(p);
const picked = CHECKS.filter(([name, , , slow]) =>
  (!fast || !slow)
  && (!mineOnly || MINE_SET.includes(name))
  && (!pats.length || pats.some((p) => matches(p, name))));

if (!picked.length) {
  console.error('No checks matched. Names: ' + CHECKS.map((c) => c[0]).join(', '));
  process.exit(2);
}

const env = { ...process.env };
if (!env.NODE_PATH) env.NODE_PATH = '/opt/node22/lib/node_modules';   // where Playwright lives here

// A `file` may carry arguments after a space ('itchzip-check.cjs --fresh').
const run = (file) => new Promise((res) => {
  const [f, ...args] = file.split(' ');
  const p = spawn(process.execPath, [path.join(HERE, f), ...args], { env, cwd: HERE });
  let out = '';
  p.stdout.on('data', (d) => { out += d; });
  p.stderr.on('data', (d) => { out += d; });
  p.on('close', (code) => res({ code, out }));
});

const results = [];
for (const [name, file, secs] of picked) {
  process.stdout.write(`▸ ${name.padEnd(10)} (~${secs}s) `);
  const t0 = Date.now();
  const { code, out } = await run(file);
  const m = /==== (\d+) passed, (\d+) failed ====/.exec(out);
  const took = ((Date.now() - t0) / 1000).toFixed(0);
  // "0 passed, 0 failed" IS NOT GREEN. A check that asserted nothing — a probe that bailed, a block
  // that skipped — used to sum into the total as a clean pass. It is counted as not reporting.
  const empty = !!m && +m[1] === 0 && +m[2] === 0;
  const r = { name, code, took, passed: m ? +m[1] : 0, failed: m ? +m[2] : 0, out, parsed: !!m && !empty };
  results.push(r);
  console.log(empty ? `0/0 in ${took}s  ← BROKEN (asserted nothing)`
              : m ? `${r.passed}/${r.passed + r.failed} in ${took}s${r.failed ? '  ← FAILURES' : ''}`
                  : `did not report (exit ${code}) in ${took}s  ← BROKEN`);
  // Only the failing lines — the whole log would bury the summary.
  if (r.failed || !r.parsed) {
    for (const line of out.split('\n')) if (/FAIL|HARNESS ERROR|Error/.test(line)) console.log('    ' + line.trim());
  }
}

const passed = results.reduce((a, r) => a + r.passed, 0);
const failed = results.reduce((a, r) => a + r.failed, 0);
const broken = results.filter((r) => !r.parsed);
console.log(`\n════ ${passed} passed, ${failed} failed` +
  (broken.length ? `, ${broken.length} check(s) did not report: ${broken.map((b) => b.name).join(', ')}` : '') +
  ` — across ${results.length} check(s) ════`);
process.exit(failed || broken.length ? 1 : 0);
