#!/usr/bin/env node
// =============================================================================
// telemetry-probe.mjs — ASK THE LIVE `events` TABLE THE QUESTIONS THAT FOUND THINGS.
//
//   node tests/telemetry-probe.mjs                      # crazygames (the default source)
//   node tests/telemetry-probe.mjs --source itch        # ...or any source, or `all`
//   node tests/telemetry-probe.mjs --cache rows.json    # fetch once, then re-read that file
//
// A TOOL, NOT A CHECK: it prints numbers, asserts nothing and is not in the runner. It is the
// companion to `docs/analytics.html` — the dashboard is what the owner reads, this is what you
// reach for when a question needs a cut the dashboard's chips cannot make (device × store, dwell
// time among the players who failed a specific level, mean vs median on one 24-hour window).
//
// WHY IT IS COMMITTED. Every cut in here was written in a scratchpad first, and the scratchpad was
// wiped twice in one session — so it was written a third time from memory. Anything worth running
// twice belongs in `tests/`.
//
// It reads the Supabase URL and the PUBLIC anon key out of index.html, exactly as gen-analytics
// does, so there is one place they live. Read-only; it cannot write to the table.
//
// ---------------------------------------------------------------------------
// TRAPS THIS TOOL EXISTS BECAUSE OF — every one of them produced a wrong answer first:
//
//  · POSTGREST CAPS A GET AT 1000 ROWS AND SAYS NOTHING. Paged with Range headers. Without it
//    every number below silently describes the most recent thousand events.
//  · A SOURCE HAS TWO SPELLINGS. CrazyGames arrives as `crazygames` AND as the truncated
//    `web:mycelium.game-files.` (the column is 24 chars). Merge them or you lose a third of it.
//  · A SESSION'S GAME IS ITS FIRST `run_start`, NOT ITS ROWS' `game` COLUMN. `boot` fires before
//    the player has chosen and CONFIG.game defaults to survival, so a row-level filter sweeps
//    every bounce into survival and makes survival sessions look far shorter than campaign ones.
//  · MEAN AND MEDIAN ANSWER DIFFERENT QUESTIONS AND DIFFER BY 4x HERE. A store publishes the MEAN
//    of GAMEPLAY time (its clock starts at gameplayStart, so it never sees a visitor who looked and
//    left); this table's median over ALL visits is a quarter of that. Both are printed. The tail is
//    the reason: the longest 10% of visits held 48% of all time played in the first 24h, and one
//    tab left open overnight (19.6 HOURS) moves the all-time mean by minutes.
//  · A PLAYER IS A BROWSER. On CrazyGames and Newgrounds the game runs in an iframe on THEIR
//    domain, where third-party storage is evicted hard — 3 of 296 players returning is a storage
//    policy, not a retention rate. Every number here is a floor.
// =============================================================================
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const arg = (name, dflt) => { const i = argv.indexOf('--' + name); return i >= 0 ? argv[i + 1] : dflt; };
const SOURCE = (arg('source', 'crazygames') || '').toLowerCase();
const CACHE = arg('cache', null);

// ---- the rows --------------------------------------------------------------
async function fetchAll() {
  const html = readFileSync(join(ROOT, 'index.html'), 'utf8');
  const url = /const SUPABASE_URL = '([^']+)'/.exec(html)[1].replace(/\/+$/, '');
  const key = /const SUPABASE_ANON_KEY = '([^']+)'/.exec(html)[1];
  const out = [];
  for (let off = 0; off < 500000; off += 1000) {
    const r = await fetch(url + '/rest/v1/events?select=*&order=created_at.desc', {
      headers: { apikey: key, Authorization: 'Bearer ' + key,
                 Range: `${off}-${off + 999}`, 'Range-Unit': 'items' },
    });
    if (!r.ok) throw new Error('HTTP ' + r.status + ' — ' + (await r.text()).slice(0, 200));
    const page = await r.json();
    out.push(...page);
    if (page.length < 1000) break;
  }
  return out;
}

// ---- helpers ---------------------------------------------------------------
const uniq = (a) => new Set(a.filter((v) => v != null)).size;
const med = (a) => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null);
const clock = (ms) => (ms == null ? '–' : Math.floor(ms / 60000) + ':' + String(Math.round(ms / 1000) % 60).padStart(2, '0'));
const pct = (a, b) => (b ? (100 * a / b).toFixed(1) + '%' : '–');
const pad = (v, n) => String(v).padStart(n);
// The two spellings of every store, merged. `source` is 24 chars in the table, so a long
// referrer host arrives truncated — `web:mycelium.game-files.` is CrazyGames' asset domain.
const normSource = (s) =>
  (s === 'crazygames' || String(s || '').includes('game-files')) ? 'crazygames'
  : (s === 'newgrounds' || String(s || '').includes('ungrounded')) ? 'newgrounds'
  : (s || 'untagged');

const rule = (t) => console.log('\n' + '─'.repeat(78) + '\n' + t + '\n');

// ---- go --------------------------------------------------------------------
let ROWS;
if (CACHE && existsSync(CACHE)) { ROWS = JSON.parse(readFileSync(CACHE, 'utf8')); console.log(`(cache) ${ROWS.length} rows from ${CACHE}`); }
else {
  ROWS = await fetchAll();
  console.log(`fetched ${ROWS.length} rows`);
  if (CACHE) { writeFileSync(CACHE, JSON.stringify(ROWS)); console.log(`cached to ${CACHE}`); }
}
ROWS.forEach((r) => { r._src = normSource(r.source); });
const SET = SOURCE === 'all' ? ROWS : ROWS.filter((r) => r._src === SOURCE);
if (!SET.length) { console.error(`no rows for source "${SOURCE}" — try: ` + [...new Set(ROWS.map((r) => r._src))].join(', ')); process.exit(1); }

// A SESSION belongs to the game it STARTED, and every row of it goes along. See the trap above.
const asc = [...SET].sort((a, b) => (a.created_at < b.created_at ? -1 : 1));
const S = {};
asc.forEach((r) => {
  const s = (S[r.session_id] ||= { kinds: {}, dev: null, end: null, load: null, cid: r.client_id,
                                   game: null, build: null, l1: false, l1clear: false, clears: 0, turns1: null });
  s.kinds[r.kind] = (s.kinds[r.kind] || 0) + 1;
  if (r.device) s.dev = r.device;
  if (r.kind === 'session_end') s.end = r.ms;
  if (r.kind === 'boot') { if (r.ms != null) s.load = r.ms; if (r.detail) s.build = r.detail; }
  if (r.kind === 'run_start' && r.game && !s.game) s.game = r.game;
  if (r.kind === 'level_start' && r.level === 1) s.l1 = true;
  if (r.kind === 'level_clear') { s.clears++; if (r.level === 1) s.l1clear = true; }
  if (r.kind === 'run_end' && r.level === 1 && r.turns != null) s.turns1 = r.turns;
});
const ids = Object.keys(S);
const days = [...new Set(SET.map((r) => r.created_at.slice(0, 10)))].sort();
console.log(`source "${SOURCE}" · ${SET.length} events · ${ids.length} sessions · ${uniq(SET.map((r) => r.client_id))} players · ${days[0]} → ${days[days.length - 1]}`);

rule('HOW LONG PEOPLE PLAY — mean and median, and why they disagree');
{
  const ends = ids.map((i) => S[i].end).filter((v) => v != null);
  const played = ids.filter((i) => S[i].kinds.level_start).map((i) => S[i].end).filter((v) => v != null);
  console.log(`  reported an end        ${pad(ends.length, 5)} of ${ids.length} sessions (${pct(ends.length, ids.length)})`);
  console.log(`  ALL visits             median ${pad(clock(med(ends)), 7)}   mean ${pad(clock(mean(ends)), 7)}   n=${ends.length}`);
  console.log(`  visits that PLAYED     median ${pad(clock(med(played)), 7)}   mean ${pad(clock(mean(played)), 7)}   n=${played.length}   <- a store reports this mean`);
  const s = [...ends].sort((a, b) => a - b), q = (p) => clock(s[Math.floor(s.length * p)]);
  console.log(`  percentiles            p50 ${q(0.5)}  p75 ${q(0.75)}  p90 ${q(0.9)}  p95 ${q(0.95)}  p99 ${q(0.99)}  max ${clock(s[s.length - 1])}`);
  const total = s.reduce((a, b) => a + b, 0);
  const top10 = s.slice(Math.floor(s.length * 0.9)).reduce((a, b) => a + b, 0);
  console.log(`  the longest 10% of visits hold ${pct(top10, total)} of all the time played — which is why everything else is a median`);
}

rule('WHERE THEY GO — the whole population, once');
{
  const noRun = ids.filter((i) => !S[i].kinds.run_start).length;
  const started = ids.filter((i) => S[i].l1);
  const cleared = started.filter((i) => S[i].l1clear);
  console.log(`  arrived                      ${pad(ids.length, 5)}`);
  console.log(`  never started a run          ${pad(noRun, 5)}  ${pct(noRun, ids.length)}   <- portal bounce; nothing to fix`);
  console.log(`  started level 1              ${pad(started.length, 5)}  ${pct(started.length, ids.length)}`);
  console.log(`  ...cleared it                ${pad(cleared.length, 5)}  ${pct(cleared.length, started.length)} of those who started`);
  // THE DISTINCTION THAT MATTERS: the level-1 failures are NOT the bouncers, and the dwell time
  // is what proves it. Half of them give the game over two minutes.
  const failEnds = started.filter((i) => !S[i].l1clear).map((i) => S[i].end).filter((v) => v != null).sort((a, b) => a - b);
  if (failEnds.length) {
    console.log(`\n  of the ${failEnds.length} who started level 1 and did not clear it:`);
    console.log(`    under 30s ${pct(failEnds.filter((v) => v < 30000).length, failEnds.length)}` +
                `   under 1m ${pct(failEnds.filter((v) => v < 60000).length, failEnds.length)}` +
                `   median ${clock(med(failEnds))}` +
                `   over 2m ${pct(failEnds.filter((v) => v >= 120000).length, failEnds.length)}` +
                `   over 5m ${pct(failEnds.filter((v) => v >= 300000).length, failEnds.length)}`);
    const t = started.map((i) => S[i].turns1).filter((v) => v != null);
    if (t.length) console.log(`    turns played before the run ended: median ${med(t)} (n=${t.length})`);
  }
}

rule('LEVEL FUNNEL — campaign, distinct players');
{
  const camp = SET.filter((r) => S[r.session_id] && S[r.session_id].game === 'campaign');
  for (let L = 1; L <= 10; L++) {
    const st = uniq(camp.filter((r) => r.kind === 'level_start' && r.level === L).map((r) => r.client_id));
    if (!st) continue;
    const cl = uniq(camp.filter((r) => r.kind === 'level_clear' && r.level === L).map((r) => r.client_id));
    const rt = camp.filter((r) => r.kind === 'retry' && r.level === L).length;
    console.log(`  L${L}  started by ${pad(st, 4)}  ·  cleared by ${pad(cl, 4)} (${pad(pct(cl, st), 6)})  ·  retries ${rt}`);
  }
}

rule('WHAT ENDS A RUN — `abandon` is the settings menu\'s "End run", a deliberate act');
{
  const e = SET.filter((r) => r.kind === 'run_end');
  const c = {};
  e.forEach((r) => { c[r.cause || '?'] = (c[r.cause || '?'] || 0) + 1; });
  Object.entries(c).sort((a, b) => b[1] - a[1]).forEach(([k, v]) =>
    console.log(`  ${k.padEnd(10)} ${pad(v, 4)}  ${pct(v, e.length)}`));
  const ab = e.filter((r) => r.cause === 'abandon' && r.turns != null).map((r) => r.turns);
  const di = e.filter((r) => !['abandon', 'won'].includes(r.cause) && r.turns != null).map((r) => r.turns);
  if (ab.length && di.length)
    console.log(`\n  median turns before ending it: quit ${med(ab)} (n=${ab.length})  ·  died ${med(di)} (n=${di.length})`);
}

rule('BY DEVICE — the phone gap, which is the biggest single split in this table');
{
  console.log('  device    sessions   started a run     cleared L1      median visit');
  for (const d of ['desktop', 'phone', 'tablet']) {
    const ss = ids.filter((i) => S[i].dev === d);
    if (!ss.length) continue;
    const ran = ss.filter((i) => S[i].kinds.run_start).length;
    const st = ss.filter((i) => S[i].l1), cl = st.filter((i) => S[i].l1clear).length;
    const ends = ss.map((i) => S[i].end).filter((v) => v != null);
    console.log(`  ${d.padEnd(9)} ${pad(ss.length, 7)}  ${pad(ran + ' (' + pct(ran, ss.length) + ')', 15)}` +
                `  ${pad(cl + ' (' + pct(cl, st.length) + ')', 13)}  ${pad(clock(med(ends)), 12)}`);
  }

  // ...AND THE PLAY-TIME SPLIT, THE WAY A STORE WOULD COMPUTE IT: a MEAN over visits that
  // actually played. ONE SESSION DECIDES THE RAW DESKTOP MEAN — a tab left open for 19.6 HOURS
  // took it to 14:24, where dropping the top 1% gives 5:05. That is not a rounding difference,
  // it is the difference between "desktop players stay three times as long as phone players" and
  // "desktop players stay a quarter longer", so the untrimmed mean is printed beside the trimmed
  // one rather than quietly replaced by it.
  console.log('\n  visits that PLAYED — a store\'s clock starts at gameplay, so this is the like-for-like');
  console.log('  device        n   median   mean(raw)   mean(-top 1%)   mean(under 30m)');
  const trim = (a, frac) => { const q = [...a].sort((x, y) => x - y); return q.slice(0, Math.max(1, Math.ceil(q.length * (1 - frac)))); };
  for (const d of ['desktop', 'phone', 'tablet', null]) {
    const v = ids.filter((i) => (d === null || S[i].dev === d) && S[i].kinds.level_start && S[i].end != null)
                 .map((i) => S[i].end);
    if (!v.length) continue;
    console.log(`  ${(d || 'ALL').padEnd(9)} ${pad(v.length, 4)}  ${pad(clock(med(v)), 7)}  ${pad(clock(mean(v)), 10)}` +
                `  ${pad(clock(mean(trim(v, 0.01))), 14)}  ${pad(clock(mean(v.filter((x) => x <= 30 * 60000))), 16)}`);
  }
}

rule('BY DAY — players, spenders, and what they spent');
{
  const byDay = {};
  SET.forEach((r) => { (byDay[r.created_at.slice(0, 10)] ||= []).push(r); });
  console.log('  day           players  spenders   rate   upgrades  colonies  spores');
  Object.keys(byDay).sort().slice(-10).forEach((d) => {
    const rs = byDay[d];
    const players = uniq(rs.map((r) => r.client_id));
    const spend = {};
    rs.forEach((r) => { if (r.kind === 'upgrade' || r.kind === 'purchase') spend[r.client_id] = (spend[r.client_id] || 0) + (r.n || 0); });
    const sp = Object.keys(spend).length;
    console.log(`  ${d}  ${pad(players, 7)}  ${pad(sp, 8)}  ${pad(pct(sp, players), 6)}` +
                `  ${pad(rs.filter((r) => r.kind === 'upgrade').length, 8)}  ${pad(rs.filter((r) => r.kind === 'purchase').length, 8)}` +
                `  ${pad(Object.values(spend).reduce((a, b) => a + b, 0), 6)}`);
  });
}

rule('ENGINES — taken vs built. The GAP is the finding, not either column');
{
  // `type` from CARD_DATA, not `displayCategory`: the latter is the draft POOL a card is offered
  // from and the two disagree per card (Cord Capillary is an engine offered from the event pool).
  const html = readFileSync(join(ROOT, 'index.html'), 'utf8');
  const block = html.match(/const CARD_DATA = (\[[\s\S]*?\n\]);/);
  const types = {};
  if (block) for (const c of JSON.parse(block[1])) if (c && c.name && c.type) types[c.name] = c.type;
  const took = {}, built = {};
  SET.forEach((r) => {
    if (!r.detail || types[r.detail] !== 'engine') return;
    if (r.kind === 'draft') took[r.detail] = (took[r.detail] || 0) + 1;
    if (r.kind === 'install') built[r.detail] = (built[r.detail] || 0) + 1;
  });
  const names = [...new Set([...Object.keys(took), ...Object.keys(built)])].sort((a, b) => (took[b] || 0) - (took[a] || 0));
  if (!names.length) console.log('  no engine drafts in this window.');
  else {
    if (!Object.keys(built).length) console.log('  (no `install` events yet — that event ships with a build; TAKEN is live)\n');
    names.forEach((n) => console.log(`  ${n.padEnd(24)} taken ${pad(took[n] || 0, 4)}   built ${pad(built[n] || 0, 4)}   ${pct(built[n] || 0, took[n] || 0)}`));
  }
}

rule('SOURCES SIDE BY SIDE — do not average these');
{
  console.log('  source        players  sessions  reached a run  cleared L1  median PLAYED  spend rate');
  for (const src of [...new Set(ROWS.map((r) => r._src))].sort()) {
    const rs = ROWS.filter((r) => r._src === src);
    const sids = [...new Set(rs.map((r) => r.session_id))];
    const T = {};
    rs.forEach((r) => { const t = (T[r.session_id] ||= { k: {}, end: null }); t.k[r.kind] = 1; if (r.kind === 'session_end') t.end = r.ms; });
    const players = uniq(rs.map((r) => r.client_id));
    const ran = sids.filter((i) => T[i].k.run_start).length;
    const cl = uniq(rs.filter((r) => r.kind === 'level_clear' && r.level === 1).map((r) => r.client_id));
    const pv = med(sids.filter((i) => T[i].k.level_start).map((i) => T[i].end).filter((v) => v != null));
    const spd = uniq(rs.filter((r) => r.kind === 'upgrade' || r.kind === 'purchase').map((r) => r.client_id));
    console.log(`  ${src.padEnd(12)} ${pad(players, 7)}  ${pad(sids.length, 8)}  ${pad(pct(ran, sids.length), 13)}` +
                `  ${pad(pct(cl, players), 10)}  ${pad(clock(pv), 13)}  ${pad(pct(spd, players), 10)}`);
  }
}

console.log('\n' + '─'.repeat(78));
console.log('Every number here is a FLOOR on player counts: a player is a browser localStorage id,');
console.log('and in an iframe on a store\'s own domain that storage is evicted hard.\n');
