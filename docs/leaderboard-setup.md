# Global leaderboard — Supabase setup

_Carried over from `mycelium2d` and updated for this repo: the credentials live in `index.html`
(no `src/`, no rebuild), and the board is now **one ladder per mode**, which needs the migration
in §2b. The live project is shared with the original game._

The game's global high-score board talks **directly to Supabase's REST API** from the
browser. There is **no server code to run** — you create a table + two row-level-security
(RLS) policies, then paste your project URL + public anon key into the game.

Time: ~10 minutes. Cost: Supabase's free tier is plenty for this.

---

## 1. Create a project
1. Sign up at <https://supabase.com> and create a new project (pick any region near your players).
2. Wait for it to finish provisioning.

## 2. Create the table + policies
Open **SQL Editor** → **New query**, paste this, and run it:

```sql
-- One row per submitted score.
create table public.scores (
  id           bigint generated always as identity primary key,
  name         text not null,
  level        int  not null,
  species      text,
  species_name text,
  mode         text not null default 'turn',   -- 'turn' | 'realtime' (one ladder each)
  created_at   timestamptz not null default now()
);

alter table public.scores enable row level security;

-- Anyone may READ the board.
create policy "public read" on public.scores
  for select to anon
  using (true);

-- Anyone may INSERT a score, with sanity caps so nobody posts level 999 or a giant name.
-- (level is capped at 100 = the game's MAX_LEVEL.)
create policy "public insert" on public.scores
  for insert to anon
  with check (
    level >= 0 and level <= 100
    and char_length(name) between 1 and 14
    and char_length(coalesce(species_name, '')) <= 40
  );

-- Fast board queries (highest level first, earliest run wins ties).
create index scores_board_idx on public.scores (level desc, created_at asc);
create index scores_mode_level_idx on public.scores (mode, level desc, created_at);
```

No `update`/`delete` policies are created, so anonymous visitors can read and add scores
but can never edit or delete them.

## 2b. Migration for the two-mode board (existing projects)

This build ships **two games** — turn-based and real-time — and each keeps its own ladder, so
every row needs a `mode`. Run this once against a table created before the split; existing rows
are all turn-based, which is what the default backfills:

```sql
alter table public.scores add column if not exists mode text not null default 'turn';
create index if not exists scores_mode_level_idx on public.scores (mode, level desc, created_at);
```

**Until it's run the game still works.** `fetchGlobalBoards` asks for `mode`, gets an error back,
retries without it, and returns a combined board with a `byMode: false` flag; the high-score
screen then shows both modes together and says "Both modes combined" instead of pretending the
ladders are separate. `submitGlobalScore` does the same — one POST with `mode`, and on failure a
second without it, so no score is lost while the column is missing.

## 3. Get your credentials
In the dashboard: **Project Settings → API**. Copy:
- **Project URL** — e.g. `https://abcdefgh.supabase.co`
- **anon public** key — the long JWT under "Project API keys".

> ⚠️ Use the **anon (public)** key only. It's designed to be embedded in client code and
> is safe to commit — access is gated by the RLS policies above. **Never** paste the
> **service_role** key anywhere in the game; that one is a real secret.

## 4. Wire it into the game
The credentials are two constants at the top of the `__m_net_scores` module in `index.html`
(grep for `SUPABASE_URL`):

```js
const SUPABASE_URL = 'https://abcdefgh.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOi...your-anon-key...';
```

There's no build step — save and reload. A page can also override them at runtime with
`window.MYCELIUM_SUPABASE = { url, anonKey }`, which is how tests keep off the live project:
**an explicitly empty `url`/`anonKey` genuinely disables the backend**, while omitting the field
falls back to the constants above.

That's it. With the fields filled in, the game shows the **Global** board and submits
qualifying runs to it; leave them empty and it silently uses the **local** per-device
board instead. If the backend is ever unreachable, the game falls back to local so it
never breaks.

---

## Notes & limits
- **Scores are client-submitted, so they're spoofable.** The RLS caps stop absurd values
  (level > 100, over-long names), but a determined player could still POST a legit-looking
  score via devtools. That's inherent to any backend-less browser game; fine for a fun board.
- **Monthly** = a rolling last-30-days window (derived at query time). **All-Time** = every row.
- Want to reset or moderate? Delete rows in the Supabase **Table Editor** (or run
  `delete from public.scores where ...` in the SQL editor).
- Optional hardening later: a Supabase **Edge Function** could add per-IP rate limiting or a
  shared submit secret. Not required to launch.

---

## Run telemetry (the `events` table) — optional but recommended

The leaderboard only records top-10 *deaths* with a name, so it can't tell you how far most
people get, whether they come back, or whether anyone buys a species. The game also emits
**anonymous run telemetry** (`src/net_scores.js` `logEvent`) into a separate `events` table:
`run_start` · `level_clear` · `run_end` (cause `won`/`died`) · `purchase`. No names — just an
anonymous per-device id (`mycelium.clientid.v1`) and a per-load session id. Until this table
exists the POSTs 404 harmlessly (the game is unaffected).

Create it once in the Supabase **SQL editor**:

```sql
create table if not exists public.events (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  client_id text, session_id text,
  kind text not null,
  species text, level int, cause text, turns int
);
alter table public.events enable row level security;
create policy events_insert on public.events for insert to anon with check (
  char_length(kind) <= 24 and coalesce(char_length(species),0) <= 32
  and coalesce(level,0) between 0 and 1000 );
create policy events_read on public.events for select to anon using (true);
```

### The v2 columns — RUN THIS BEFORE THE BUILD GOES UP

Six columns the current build writes. They are **additive and idempotent**, so it is safe to run
on a table that already has data and safe to run twice.

```sql
alter table public.events add column if not exists source text;   -- itch | pages | dev | web:<host>
alter table public.events add column if not exists game   text;   -- campaign | survival
alter table public.events add column if not exists mode   text;   -- turn | realtime
alter table public.events add column if not exists device text;   -- phone | tablet | desktop
alter table public.events add column if not exists n      int;    -- a count (spores, steps, cards…)
alter table public.events add column if not exists ms     int;    -- a duration
alter table public.events add column if not exists detail text;   -- names the thing (track, card, step)

-- The dashboard's three hot paths: "what happened lately", "this device's history"
-- (retention), and "this session's story".
create index if not exists events_created_idx on public.events (created_at desc);
create index if not exists events_client_idx  on public.events (client_id, created_at);
create index if not exists events_kind_idx    on public.events (kind, created_at desc);
```

**The build does not depend on you running it first.** PostgREST rejects the WHOLE row on one
unknown column (PGRST204), so a build that shipped ahead of its migration would go completely
dark rather than degrade. `logEvent` latches on the first 400 and posts the original seven-column
shape for the rest of the session — one wasted request, then business as usual. Run the SQL and
the next session is full-fidelity. **Deploy order does not matter; only the delay does.**

Three columns are deliberately absent, and each was considered:

- **No IP, no user-agent, no screen fingerprint.** `device` is bucketed from the VIEWPORT
  (phone / tablet / desktop) rather than sniffed from the UA — a UA string lies, needs endless
  maintenance, and is the part of a fingerprint worth not collecting.
- **No name and no free text from the player.** The only player-authored string in the game is
  the high-score name, and that stays on the `scores` table where it always was.
- **No `first_seen` column.** Retention is derived — `min(created_at) per client_id` — so a
  device's cohort is a query, not a stored fact about a person.

Then view the funnel at **`<site>/analytics.html`**: players, sessions, run-length distribution,
win/death split, species picked, purchases, and simple retention. Reads are public (anon key),
same as the board.

Two things to know about the telemetry as it stands here:

- **`analytics.html` lives in the `mycelium2d` repo** (`docs/analytics.html`, published by its
  `build.mjs`, never in the itch zip). It isn't in this repo — re-attach the old one to use it.
- **`analytics.html` IS IN THIS REPO NOW** (`docs/analytics.html`, generated by
  `node scripts/gen-analytics.mjs`), so the note above about re-attaching the old repo is stale
  for everything but history. It never goes in the itch zip.
- **`logEvent` records the mode now**, and the game, and the device class — on every event. That
  was the open gap here; it is closed.

Reading the tables directly: **PostgREST caps a GET at 1000 rows**, so paginate with
`Range`/`offset` or you'll silently analyse only the first thousand. Playwright can't reach
Supabase from the sandbox — use `curl --cacert /root/.ccr/ca-bundle.crt` for real queries.
