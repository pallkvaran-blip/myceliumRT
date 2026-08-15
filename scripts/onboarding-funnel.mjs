/* Where new players stop — the tutorial step by step, and what actually ends a level-1 run.
 *
 *   node scripts/onboarding-funnel.mjs                # last 8 days, crazygames
 *   node scripts/onboarding-funnel.mjs --days 30 --source itch
 *
 * A TOOL, not a check: it prints and never fails.
 *
 * WHY IT EXISTS. The release comparison answers "did this build move the numbers"; it cannot
 * answer "why is the number that low in the first place". Measured over 8 days: of 1,290 sessions
 * that START a level, 47 clear one. The whole game is being judged on a step almost nobody gets
 * past, and the depth work lands above it.
 *
 * WHAT IT CAN AND CANNOT SEE, because the first instinct is to distrust it and the second is to
 * trust it too far:
 *   - VISIT LENGTH IS SOUND. `session_end` is sent from `pagehide` AND `visibilitychange`, and it
 *     lands for ~92% of sessions. A closed tab is recorded.
 *   - THE STATE AT THE CLOSE IS NOT. Only about a third of level-starting sessions ever produce a
 *     `run_end`, so for most of them we do not know whether they were one turn from dying or
 *     perfectly fine and bored. Any claim of the form "they quit because X" needs a `run_end`
 *     behind it — which is why the causes below are reported only over the runs that have one, and
 *     never as a share of everybody.
 *   - THE TUTORIAL IS THE EXCEPTION, and that is what makes this worth running: it emits a row per
 *     STEP, plus 'done' and 'skip'. So the one part of the funnel where we can see exactly where a
 *     person stopped is the part new players are lost in.
 *
 * THE FINDING, first run (8 days, 2,052 CrazyGames sessions, 1,809 players):
 *   - finished the tutorial -> 52% went on to clear a level. Skipped or walked away -> 4%.
 *   - 116 of the 145 skips are pressed at ONE step: the drag-to-grow step, the first time the
 *     player has to perform the game's core gesture themselves rather than press Next.
 *   - The End button is on every step but one, so that concentration is not the button appearing.
 *   - Infection is not what ends a level-1 run. Worms are (45), then energy (39).
 * Selection is the honest caveat on the first line — people who finish a tutorial are people
 * already willing to. The concentration at a single gesture step is the part that is hard to
 * explain that way.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const argOf = (k, d) => { const i = args.indexOf('--' + k); return i >= 0 ? args[i + 1] : d; };
const DAYS = +argOf('days', 8);
const SOURCE = argOf('source', 'crazygames');

const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const SUPABASE_URL = /const SUPABASE_URL = '([^']+)'/.exec(html)[1];
const KEY = /'(eyJ[A-Za-z0-9._-]{40,})'/.exec(html)[1];

const url = SUPABASE_URL.replace(/\/+$/, '') + '/rest/v1/events?select=*&created_at=gte.'
  + new Date(Date.now() - DAYS * 86400000).toISOString() + '&order=created_at.desc';
const rows = [];
for (let from = 0; from < 300000; from += 1000) {
  const r = await fetch(url, { headers: { apikey: KEY, Authorization: 'Bearer ' + KEY,
    Range: from + '-' + (from + 999), 'Range-Unit': 'items' } });
  if (!r.ok) throw new Error('supabase ' + r.status);
  const b = await r.json(); rows.push(...b);
  if (b.length < 1000) break;
}

const ms = (r) => new Date(r.created_at).getTime();
const bySess = new Map();
for (const r of rows) { if (!bySess.has(r.session_id)) bySess.set(r.session_id, []); bySess.get(r.session_id).push(r); }
for (const [, v] of bySess) v.sort((a, b) => ms(a) - ms(b));
const S = [...bySess].filter(([, v]) => v.some((e) => e.source === SOURCE));
const players = new Set(rows.filter((r) => r.source === SOURCE).map((r) => r.client_id));
const pc = (a, b) => b ? `${Math.round(100 * a / b)}%` : '–';

console.log(`\n${S.length} ${SOURCE} sessions from ${players.size} players, last ${DAYS} days`);
const withEnd = S.filter(([, v]) => v.some((e) => e.kind === 'session_end')).length;
console.log(`  session_end lands for ${withEnd} of them (${pc(withEnd, S.length)}) — visit LENGTH is trustworthy`);

// ---- the coarse funnel --------------------------------------------------------------------
const started = S.filter(([, v]) => v.some((e) => e.kind === 'level_start'));
const cleared = S.filter(([, v]) => v.some((e) => e.kind === 'level_clear'));
const ended = started.filter(([, v]) => v.some((e) => e.kind === 'run_end'));
console.log(`\n  ${String(S.length).padStart(5)}  sessions`);
console.log(`  ${String(started.length).padStart(5)}  started a level        ${pc(started.length, S.length)}`);
console.log(`  ${String(cleared.length).padStart(5)}  cleared one            ${pc(cleared.length, started.length)} of those who started`);
console.log(`  ${String(ended.length).padStart(5)}  recorded a run_end      ${pc(ended.length, started.length)} — the rest just stop, and their STATE is unknown`);

// ---- the tutorial, step by step -------------------------------------------------------------
const tut = S.filter(([, v]) => v.some((e) => e.kind === 'tutorial'));
const reached = {}, walked = {}, skipAt = {};
let done = 0, skipped = 0;
for (const [, v] of tut) {
  const t = v.filter((e) => e.kind === 'tutorial');
  const top = Math.max(-1, ...t.filter((e) => e.n != null).map((e) => e.n));
  for (let i = 0; i <= top; i++) reached[i] = (reached[i] || 0) + 1;
  const sk = t.find((e) => e.detail === 'skip');
  if (t.some((e) => e.detail === 'done')) done++;
  else if (sk) skipped++;
  else walked[top] = (walked[top] || 0) + 1;
  // EVERY SKIP PRESS, COUNTED AT THE STEP IT WAS PRESSED AT — not at the highest step the session
  // reached, and not only for sessions that never finished anything. Both narrowings move the
  // answer: keying on the session's top step scatters it, and dropping sessions that later record
  // a 'done' (the optional creature tips run as their own short walkthrough) loses a third of the
  // presses. 116 of 145 land on one step; either narrowing turns that finding into a shrug.
  if (sk) {
    const at = Math.max(-1, ...t.filter((x) => ms(x) <= ms(sk) && x.n != null).map((x) => x.n));
    skipAt[at] = (skipAt[at] || 0) + 1;
  }
}
console.log(`\n  the tutorial — ${tut.length} sessions saw it`);
console.log(`    finished ${done} (${pc(done, tut.length)}) · skipped ${skipped} (${pc(skipped, tut.length)})`
  + ` · walked away part-way ${tut.length - done - skipped} (${pc(tut.length - done - skipped, tut.length)})`);
const skipTotal = Object.values(skipAt).reduce((a, b) => a + b, 0);
console.log(`\n    step   still here          skipped here   left here    (${skipTotal} skip presses in all)`);
for (const k of Object.keys(reached).map(Number).sort((a, b) => a - b)) {
  const bar = '#'.repeat(Math.round(28 * reached[k] / tut.length));
  console.log(`    ${String(k).padStart(4)}   ${String(reached[k]).padStart(4)} ${pc(reached[k], tut.length).padStart(4)} ${bar.padEnd(29)}`
    + `${String(skipAt[k] || 0).padStart(5)}   ${String(walked[k] || 0).padStart(5)}`);
}

// ---- does it matter? -------------------------------------------------------------------------
// SELECTION IS THE CAVEAT AND IT CANNOT BE REMOVED FROM THIS TABLE — somebody who sits through a
// walkthrough is somebody who meant to play. Reported anyway, because a 13x gap is not a
// difference in willingness of a size any A/B would need to argue about.
const bucket = { done: [0, 0], left: [0, 0], never: [0, 0] };
for (const [, v] of S) {
  if (!v.some((e) => e.kind === 'level_start')) continue;
  const t = v.filter((e) => e.kind === 'tutorial');
  const k = !t.length ? 'never' : (t.some((e) => e.detail === 'done') ? 'done' : 'left');
  bucket[k][1]++;
  if (v.some((e) => e.kind === 'level_clear')) bucket[k][0]++;
}
console.log('\n  of the sessions that started a level, how many cleared one:');
for (const [k, [c, n]] of Object.entries(bucket))
  console.log(`    ${({ done: 'finished the tutorial', left: 'skipped it or walked away', never: 'never saw it' })[k].padEnd(26)} ${String(c).padStart(4)} / ${String(n).padStart(4)}  = ${pc(c, n)}`);

// ---- what ends a level-1 run, among the runs that recorded an ending -------------------------
const l1 = rows.filter((r) => r.kind === 'run_end' && r.level === 1 && r.source === SOURCE);
const byCause = {};
for (const r of l1) (byCause[r.cause || '?'] = byCause[r.cause || '?'] || []).push(r.turns);
console.log(`\n  level-1 endings, over the ${l1.length} runs that recorded one (NOT over everybody):`);
for (const [c, t] of Object.entries(byCause).sort((a, b) => b[1].length - a[1].length)) {
  const s = t.filter((x) => x != null).sort((a, b) => a - b);
  console.log(`    ${c.padEnd(9)} ${String(t.length).padStart(4)}   median ${s.length ? s[s.length >> 1] : '–'} turns`);
}
console.log('\n  `abandon` is the settings menu\'s "End run & keep cards" — a deliberate stop, not a death.');
