/* "How does the new build look against the same hours yesterday?" — live, from the events table.
 *
 *   node scripts/release-window.mjs            # newest build stamp -> now, vs the same clock window yesterday
 *   node scripts/release-window.mjs --days 2   # ...vs the same window N days back
 *   node scripts/release-window.mjs --source itch
 *
 * A TOOL, not a check: it prints and never fails. It exists because the question gets asked within
 * hours of every upload, and the dashboard cannot answer it — `docs/analytics.html` compares a
 * release against EVERYTHING before it, which after one morning is a build with 150 sessions
 * against a baseline with thousands. This is the like-for-like version: the same hours of the same
 * kind of day, which is the only way a five-hour sample says anything at all.
 *
 * Four things it does that a naive query would get wrong, each of which has cost a wrong answer
 * somewhere in this project already:
 *
 *   THE WINDOW STARTS AT THE BUILD, NOT AT MIDNIGHT. A store serves whatever zip was last uploaded
 *   and the owner uploads by hand, so the moment a release went live is a fact about the DATA —
 *   the first session carrying the newest stamp — and nothing else knows it.
 *
 *   IT PRINTS THE BUILD MIX ON BOTH SIDES rather than assuming the window is the build. Browsers
 *   cache, so a window always holds a few stragglers; if the split is not lopsided the comparison
 *   is not a comparison and you need to see that before reading a single number.
 *
 *   A SESSION BELONGS TO THE GAME IT STARTED, not to `r.game` row by row. `boot` fires before the
 *   player has chosen anything and CONFIG.game defaults to survival, so filtering per row files
 *   every bounce under survival and drops the campaign sessions' own boot rows.
 *
 *   BOUNCERS OUT OF THE TIME FIGURES, OUTLIERS OUT OF THE MEAN ONLY. About a third of visits never
 *   start a level and sit at the bottom of both sides pulling the two together; one tab left open
 *   overnight decides a mean on a sample this small. Both the trimmed and raw means are printed —
 *   a trimmed mean shown alone reads as fact.
 *
 * And the finding it is usually reporting: read the QUANTILES, not the mean. The first time this
 * was run (the 2026-08-14 build, 5.8 h in) the mean was up 69% and the median was DOWN 8 seconds —
 * p25 and p50 flat, p75 +31%, p90 +205%. Nothing had happened to the typical visit; the people who
 * engaged were getting further. A mean alone would have been read as "everyone stayed longer".
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const argOf = (k, d) => { const i = args.indexOf('--' + k); return i >= 0 ? args[i + 1] : d; };
const BACK = +argOf('days', 1);
const SOURCE = argOf('source', 'crazygames');
const GAME = argOf('game', 'campaign');

// THE ANON KEY COMES OUT OF index.html, never a second copy. It is public by design and committed;
// the service_role key is a real secret and must never be near this file.
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const URL_M = /const SUPABASE_URL = '([^']+)'/.exec(html);
const KEY_M = /'(eyJ[A-Za-z0-9._-]{40,})'/.exec(html);
if (!URL_M || !KEY_M) { console.error('could not read the Supabase url/key out of index.html'); process.exit(2); }
const [, SUPABASE_URL] = URL_M, [, KEY] = KEY_M;

// PostgREST caps a GET at 1000 rows and says nothing about it — page until a short one comes back.
async function fetchSince(iso) {
  const url = SUPABASE_URL.replace(/\/+$/, '') + '/rest/v1/events?select=*&created_at=gte.' + iso
    + '&order=created_at.desc';
  const out = []; const PAGE = 1000;
  for (let from = 0; from < 200000; from += PAGE) {
    const r = await fetch(url, { headers: { apikey: KEY, Authorization: 'Bearer ' + KEY,
      Range: from + '-' + (from + PAGE - 1), 'Range-Unit': 'items' } });
    if (!r.ok) throw new Error('supabase ' + r.status);
    const b = await r.json();
    out.push(...b);
    if (b.length < PAGE) break;
  }
  return out;
}

const ms = (r) => new Date(r.created_at).getTime();
const fmt = (v) => v == null ? '–' : `${Math.floor(v / 60000)}m ${Math.round((v % 60000) / 1000)}s`;
const median = (a) => a.length ? (a.length % 2 ? a[a.length >> 1] : (a[(a.length >> 1) - 1] + a[a.length >> 1]) / 2) : null;
const mean = (a) => a.length ? a.reduce((x, y) => x + y, 0) / a.length : null;

const BYHOUR = args.includes('--by-hour');
const DEVICE = argOf('device', '');
const SPAN = +argOf('span', BYHOUR ? 21 : BACK + 2);

const since = new Date(Date.now() - SPAN * 86400000).toISOString();
const rows = await fetchSince(since);

// One stamp per session, off the boot row; one game per session, off the FIRST run_start.
const build = new Map(), game = new Map();
for (const r of rows) if (r.kind === 'boot' && r.detail && r.session_id) build.set(r.session_id, r.detail);
for (const r of rows.slice().sort((a, b) => ms(a) - ms(b)))
  if (r.kind === 'run_start' && r.game && r.session_id && !game.has(r.session_id)) game.set(r.session_id, r.game);

// ---- --by-hour: "do sessions get longer later in the day?" ------------------------------------
//
// THE ANSWER SO FAR IS NO, AND THE REASON THE QUESTION CANNOT REALLY BE ANSWERED HERE IS WORTH
// KNOWING BEFORE YOU READ THE TABLE. `created_at` is UTC and the telemetry records nothing about
// where the player is — no timezone, no locale, no user-agent — so 18:00 UTC is a European
// evening, a New York midday and a Sydney dawn in one bucket. A real evening effect would be
// smeared flat by that mixing and this table could not tell you. The fix is one field on `boot`
// (`new Date().getTimezoneOffset()`), which reveals nothing identifying, and then the question
// becomes answerable in a few weeks.
//
// EVERY BUCKET GETS A BOOTSTRAP CI, because a median over 40 visits and a median over 300 print
// identically and mean very different things — measured on 21 days of campaign visits, the blocks
// ranged over 36 seconds while a single block's own interval was wider than that, i.e. nothing.
// It also correlates each hour's VOLUME against its median, since "quiet hours are different
// hours" is the obvious confound and is worth ruling out rather than assuming (r = -0.12).
if (BYHOUR) {
  const bySess = new Map();
  for (const r of rows) { if (!bySess.has(r.session_id)) bySess.set(r.session_id, []); bySess.get(r.session_id).push(r); }
  const V = [];
  for (const [sid, evs] of bySess) {
    if (!evs.some((e) => e.source === SOURCE)) continue;
    const end = evs.find((e) => e.kind === 'session_end' && e.ms != null);
    if (!end || !evs.some((e) => e.kind === 'level_start')) continue;
    if (GAME && game.get(sid) !== GAME) continue;
    const dev = (evs.find((e) => e.device) || {}).device || '?';
    if (DEVICE && dev !== DEVICE) continue;
    // THE HOUR A VISIT STARTED, not the hour its rows happen to fall in: a 70-minute session
    // spans three of them, and filing its duration under the last is how a long visit makes the
    // hour it ENDED in look like the hour people play longest.
    V.push({ h: new Date(Math.min(...evs.map(ms))).getUTCHours(), ms: end.ms, dev });
  }
  const q = (a, p) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.min(s.length - 1, Math.floor(s.length * p))] : null; };
  const sortNum = (a) => [...a].sort((x, y) => x - y);
  const boot = (a, n = 3000) => {
    const o = [];
    for (let i = 0; i < n; i++) { const s = []; for (let j = 0; j < a.length; j++) s.push(a[(Math.random() * a.length) | 0]); o.push(median(sortNum(s))); }
    o.sort((x, y) => x - y);
    return [o[(n * 0.025) | 0], o[(n * 0.975) | 0]];
  };
  const mix = {}; for (const v of V) mix[v.dev] = (mix[v.dev] || 0) + 1;
  console.log(`\n${V.length} played visits over ${SPAN} days — source=${SOURCE} game=${GAME || 'all'}`
    + (DEVICE ? ` device=${DEVICE}` : '') + `\ndevice mix: ${JSON.stringify(mix)}`);
  const all = sortNum(V.map((v) => v.ms));
  console.log(`overall: median ${fmt(median(all))}  p75 ${fmt(q(all, 0.75))}  p90 ${fmt(q(all, 0.9))}  mean ${fmt(mean(all))}\n`);
  console.log('  UTC block   visits     median   95% CI of the median          mean');
  for (const [a, b, l] of [[0, 4, '00-04'], [4, 8, '04-08'], [8, 12, '08-12'], [12, 16, '12-16'], [16, 20, '16-20'], [20, 24, '20-24']]) {
    const d = sortNum(V.filter((v) => v.h >= a && v.h < b).map((v) => v.ms));
    if (d.length < 10) { console.log(`  ${l}      ${String(d.length).padStart(5)}   (too few to read)`); continue; }
    const [lo, hi] = boot(d);
    console.log(`  ${l}      ${String(d.length).padStart(5)}   ${fmt(median(d)).padStart(8)}   ${fmt(lo)} .. ${fmt(hi)}`.padEnd(64) + fmt(mean(d)));
  }
  const pts = [...Array(24).keys()].map((h) => sortNum(V.filter((v) => v.h === h).map((v) => v.ms)))
    .filter((d) => d.length >= 5).map((d) => ({ n: d.length, m: median(d) }));
  if (pts.length >= 6) {
    const xs = pts.map((p) => p.n), ys = pts.map((p) => p.m), n = xs.length;
    const mx = mean(xs), my = mean(ys);
    const r = xs.map((x, i) => (x - mx) * (ys[i] - my)).reduce((a, b) => a + b)
      / Math.sqrt(xs.map((x) => (x - mx) ** 2).reduce((a, b) => a + b) * ys.map((y) => (y - my) ** 2).reduce((a, b) => a + b));
    console.log(`\n  an hour's VOLUME against its median visit: r = ${r.toFixed(2)} over ${n} hours with 5+ visits`);
  }
  console.log('\n  UTC mixes every timezone into one bucket, so a real local-evening effect would be'
    + '\n  invisible here. See the header: it needs one field on `boot`.');
  process.exit(0);
}

const STAMP = /^\d{4}-\d{2}-\d{2}-/;
const stamps = [...new Set([...build.values()].filter((b) => STAMP.test(b)))].sort();
const NEW = stamps[stamps.length - 1];
if (!NEW) { console.log('no stamped sessions in the window'); process.exit(0); }
const live = rows.filter((r) => build.get(r.session_id) === NEW).map(ms);
const T0 = Math.min(...live), NOW = Math.max(...rows.map(ms));

function slice(a, b) {
  const rs = rows.filter((r) => ms(r) >= a && ms(r) < b && r.source === SOURCE);
  const bySess = new Map();
  for (const r of rs) { if (!bySess.has(r.session_id)) bySess.set(r.session_id, []); bySess.get(r.session_id).push(r); }
  const played = new Set([...bySess].filter(([, v]) => v.some((x) => x.kind === 'level_start')).map(([k]) => k));
  const keep = [...bySess.keys()].filter((s) => played.has(s) && (!GAME || game.get(s) === GAME));
  const evs = keep.flatMap((s) => bySess.get(s));
  const durs = evs.filter((x) => x.kind === 'session_end' && x.ms != null).map((x) => x.ms).sort((x, y) => x - y);
  // Trim the longest 1%, and only when there are ten or more: 1% of six is a 17% trim, i.e. on a
  // sample that small the outlier and the signal are the same size.
  const kept = durs.length >= 10 ? durs.slice(0, durs.length - Math.max(1, Math.round(durs.length * 0.01))) : durs;
  const q = (p) => durs.length ? durs[Math.min(durs.length - 1, Math.floor(durs.length * p))] : null;
  const people = new Set(evs.map((x) => x.client_id));
  const uniq = (k, f) => new Set(evs.filter(f).map((x) => x[k])).size;
  const lv = {};
  for (const x of evs) if ((x.kind === 'level_start' || x.kind === 'level_clear') && x.level) {
    (lv[x.level] || (lv[x.level] = { s: new Set(), c: new Set() }))[x.kind === 'level_start' ? 's' : 'c'].add(x.client_id);
  }
  const mix = {};
  for (const s of bySess.keys()) { const b2 = build.get(s) || '(no stamp)'; mix[b2] = (mix[b2] || 0) + 1; }
  const top = durs.slice(-Math.max(1, Math.floor(durs.length / 10)));
  return { mix, sessions: bySess.size, bounced: bySess.size - played.size, players: people.size,
    visits: durs.length, p25: q(0.25), med: median(kept), p75: q(0.75), p90: q(0.9), max: durs[durs.length - 1],
    avg: mean(kept), raw: mean(durs), tail: durs.length ? Math.round(100 * top.reduce((a, b2) => a + b2, 0) / durs.reduce((a, b2) => a + b2, 0)) : 0,
    clears: evs.filter((x) => x.kind === 'level_clear').length,
    cleared: uniq('client_id', (x) => x.kind === 'level_clear'),
    spent: uniq('client_id', (x) => x.kind === 'upgrade' || x.kind === 'purchase'),
    upgrades: evs.filter((x) => x.kind === 'upgrade').length,
    retries: evs.filter((x) => x.kind === 'retry').length, lv };
}

// TWO WINDOWS THAT DO NOT OVERLAP, and past 24 h the default pair DOES. "The same clock window a
// day back" is the right frame while a release is hours old — it cancels the daily traffic cycle,
// which swings ~4x — but the moment the release is more than a day old, [T0, now] and its shifted
// copy [T0-24h, now-24h] intersect, and the baseline starts containing the build it is meant to be
// judging. Measured at 25.2 h: 25 sessions on the NEW build had leaked into the "yesterday" side.
//
// `--hours N` is the clean version for that case: the release's first N hours against the N hours
// IMMEDIATELY BEFORE it. At N = 24 the daily cycle cancels on its own — both windows are a whole
// day — so nothing is given up by dropping the clock alignment.
const HOURS = +argOf('hours', 0);
const A = HOURS ? slice(T0, T0 + HOURS * 3600000) : slice(T0, NOW + 1);
const B = HOURS ? slice(T0 - HOURS * 3600000, T0)
                : slice(T0 - BACK * 86400000, NOW + 1 - BACK * 86400000);
const iso = (t) => new Date(t).toISOString().replace('T', ' ').slice(0, 16);

if (HOURS && NOW - T0 < HOURS * 3600000)
  console.log(`\n  NOTE: only ${((NOW - T0) / 3600000).toFixed(1)} h of the ${HOURS} h window has happened yet.`);
console.log(`\n${NEW} first played ${iso(T0)} UTC, newest event ${iso(NOW)} UTC`
  + `  —  ${((NOW - T0) / 3600000).toFixed(1)} h`);
console.log(HOURS
  ? `source=${SOURCE} game=${GAME || 'all'}, its first ${HOURS} h against the ${HOURS} h before it`
    + `\n  after  ${iso(T0)} -> ${iso(T0 + HOURS * 3600000)}`
    + `\n  before ${iso(T0 - HOURS * 3600000)} -> ${iso(T0)}\n`
  : `source=${SOURCE} game=${GAME || 'all'}, against the same clock window ${BACK} day(s) back\n`);
const mixOf = (x) => Object.entries(x.mix).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([k, v]) => `${k} ${v}`).join(', ');
console.log(`  after   ${mixOf(A)}`);
console.log(`  before  ${mixOf(B)}\n`);

const R = [['sessions', (x) => x.sessions], ['of which bounced', (x) => `${x.bounced} (${Math.round(100 * x.bounced / (x.sessions || 1))}%)`],
  ['players who played', (x) => x.players], ['played visits', (x) => x.visits],
  ['p25 visit', (x) => fmt(x.p25)], ['median visit', (x) => fmt(x.med)], ['p75 visit', (x) => fmt(x.p75)],
  ['p90 visit', (x) => fmt(x.p90)], ['longest visit', (x) => fmt(x.max)],
  ['avg (1% trimmed)', (x) => fmt(x.avg)], ['  untrimmed', (x) => fmt(x.raw)],
  ['longest tenth holds', (x) => x.tail + '% of time'],
  ['levels cleared / player', (x) => (x.clears / (x.players || 1)).toFixed(2)],
  ['  total clears', (x) => x.clears], ['players who cleared >=1', (x) => x.cleared],
  ['players who spent', (x) => x.spent], ['upgrades bought', (x) => x.upgrades], ['retries used', (x) => x.retries]];
const w = Math.max(...R.map(([l]) => l.length));
console.log(`${''.padEnd(w)}   ${(HOURS ? 'after (' + HOURS + 'h)' : 'since the update').padStart(18)} ${(HOURS ? 'before (' + HOURS + 'h)' : 'same window -' + BACK + 'd').padStart(18)}`);
for (const [l, f] of R) console.log(`${l.padEnd(w)}   ${String(f(A)).padStart(18)} ${String(f(B)).padStart(18)}`);

console.log(`\n${'level'.padStart(6)}   ${'started'.padStart(8)} ${'cleared'.padStart(8)}   ${'started'.padStart(8)} ${'cleared'.padStart(8)}   ${HOURS ? '(after | before)' : '(today | -' + BACK + 'd)'}`);
const levels = [...new Set([...Object.keys(A.lv), ...Object.keys(B.lv)])].map(Number).sort((a, b) => a - b);
for (const L of levels) {
  const a = A.lv[L] || { s: new Set(), c: new Set() }, b = B.lv[L] || { s: new Set(), c: new Set() };
  console.log(`${String(L).padStart(6)}   ${String(a.s.size).padStart(8)} ${String(a.c.size).padStart(8)}   ${String(b.s.size).padStart(8)} ${String(b.c.size).padStart(8)}`);
}
console.log(`\nRead the QUANTILES, not the mean — on a window this short the mean is one long visit.`);
