# CLAUDE.md — PickLogic

Context file for Claude Cowork and Claude.ai. This is the CURRENT STATE of the project.
The Technical Master Plan and Orientation Reference (docx) hold strategy and rationale;
this file holds facts. When they conflict, this file wins. Update this file at the end
of any session that changes architecture, schema, secrets, or workflows.

Last updated: 2026-10-19 (launch-prep Day 1: readability + signup path shipped)

## What this is

Powerball / Mega Millions companion web app. Users generate picks, save tickets,
get results checked automatically. Entertainment tool — never claim improved odds
(App Store / legal requirement; disclaimer must stay in UI).

## Stack & deploy chains

- **Frontend:** React (CRA), single-file architecture — almost all logic in `src/App.js`.
  Inline styles via the `S` object. Jackpot display values in `src/config.js` (manual for now).
- **Deploy (frontend):** push to `main` → GitHub (jvargas1451/picklogic) → Vercel auto-deploys
  picklogic.vercel.app. Preview URLs are frozen snapshots — never use them to verify updates.
- **Backend:** Supabase project "PickLogic" (`jehqbmchbveyiqdvdyua.supabase.co`).
  Auth (email/password only), Postgres, edge functions, cron.
- **Auth:** email/password. Email confirmation TURNED OFF 2026-10-19 — email is still
  REQUIRED at signup, just not verified. Reason: Supabase built-in SMTP is 2/hour
  and testing-only, so confirmation emails would silently fail to reach strangers.
  Confirmation returns alongside email reminders, once domain + Resend are live.
  Observed once (test account, since deleted) that email_confirmed_at IS populated
  at signup with confirmation off, which would make re-enabling safe for accounts
  created in the meantime. Single observation, not proven — re-verify on the first
  real stranger signup before flipping it back on.
  RE-ENABLING CHECKLIST: restoring confirmation also requires restoring signup
  feedback copy. With confirmation ON, signUp returns no error and no session, and
  the current AuthScreen shows the user nothing at all. The `success` state and
  `authSuccess` banner were deliberately left in place for this.
- **Deploy (edge functions):** SEPARATE from git chain. `npx supabase functions deploy bright-api`.
  CLI is a dev dependency (`npx supabase ...`), linked to the project. Docker warnings on deploy are harmless.
- **Email:** Resend account exists; domain verification NOT done. No email features built.
- **Planned:** Stripe (later phase).

## Database schema (public)

- **tickets** — id, user_id (FK auth.users), game ("pb"/"mm"), numbers int[], special int,
  pick_mode, draw_date (**`date`**, nullable), stake, payout, status ("open"/"won"/"lost"), notes, created_at.
  RLS: single ALL policy, `auth.uid() = user_id` on both USING and WITH CHECK. Verified correct — do not modify.
  `draw_date` was migrated TEXT → `date` on 2026-08-07 (migration
  `20260807093000_tickets_draw_date_to_date.sql`). Postgres now rejects malformed dates at
  insert time. No index on draw_date; no view or constraint depends on it.
- **draws** — id, game, draw_date (**`date`**), numbers, special, jackpot, created_at.
  Unique on (game, draw_date), constraint `draws_game_draw_date_unique`. RLS: public SELECT only.
  Written only by the edge function (service role).
  NOTE: numbers may be stored as strings — settlement code normalizes to int before comparing.
  `draw_date` here was ALREADY `date` before the 2026-08-07 phase — it was never TEXT, despite
  what an earlier version of this file claimed. Verified against information_schema. The upsert
  passes the lottery API's date string straight in and Postgres coerces it.
- **profiles** — id (PK, FK auth.users, cascade), username (text, unique, nullable), points (int, default 0), created_at.
  Created by trigger on auth.users insert; existing users backfilled.
  RLS: public SELECT (leaderboard requirement); INSERT/UPDATE owner-only. Because SELECT is
  public (not owner-scoped), App.js reads/writes its own profile with an explicit
  `.eq('id', user.id)` filter — REQUIRED, not optional, unlike tickets/point_events where RLS
  does the scoping for you.
  `points` is server-authoritative: the `protect_profile_points` BEFORE UPDATE trigger reverts
  points changes unless the caller is service_role OR `current_user = 'postgres'` (the
  SECURITY DEFINER path used by `award_points`). Clients can set username; client forgery of
  points is still blocked either way.
  `username` format: `check` constraint `username_format` requires `^[A-Za-z0-9_]{3,20}$` (null
  allowed); case-insensitive uniqueness via unique index `profiles_username_lower_unique` on
  `lower(username)` (blocks "Winner" vs "winner"). App.js mirrors the same regex client-side
  before saving. Usernames are changeable — locked product decision, not a placeholder gap.
- **point_events** — ledger of awarded points: user_id, event_type, ref_id, points, created_at.
  Dedup unique index on (user_id, event_type, ref_id) — makes awarding idempotent.
- **point_values** — lookup table, event_type → points: save_ticket 5, checkin 10, match_any 20,
  match_3plus 50, jackpot 1000. Looked up server-side inside `award_points`, not hardcoded per caller.
- **leaderboard** view — `security_invoker`, built on profiles for public display.

## Edge function: bright-api (display name "fetch-draw-results")

Source IS in the repo: `supabase/functions/bright-api/index.ts` (version-controlled since 2026-07-06).
Edit in repo → deploy via CLI. Do not edit in the dashboard editor anymore.

What it does per invocation:
1. Fetches latest draw per game from lotteryresultsfeed.com (pb id=1, mm id=10), upserts into `draws`.
2. Settlement sweep: ALL tickets with status='open' that have a matching draws row (game + draw_date)
   are settled won/lost. Win rule: matchedSpecial OR matchedMain >= 3 (mirrors `checkResult()` in App.js —
   keep these two in sync if prize tiers ever change).
3. Same sweep also awards match-tier gamification points via the `award_points(user_id, event_type,
   ref_id)` RPC — a SECURITY DEFINER choke-point that looks up the point value server-side
   (from `point_values`) and is idempotent via the point_events dedup index; it is the ONLY path
   allowed to move points. Non-stacking ladder, one tier per ticket, first match wins: `jackpot`
   (5 main + special) > `match_3plus` (3-4 main) > `match_any` (any match at all, main or special —
   this deliberately includes losing near-miss tickets, a product decision). A per-ticket award
   failure is logged and does not abort the sweep or the ticket's won/lost settlement.
4. Returns honest body: `{ ok, saved: [...], settled: <count>, awarded: <count> }`.
    NOTE: `saved` lists what the upsert touched, including rows that already
    existed. The 2026-09-19 run reported saving pb 2026-09-16, which had been
    there since 09-17. `saved` is not a count of new rows.

Separately, an AFTER INSERT trigger on `tickets` awards the `save_ticket` event (5 pts) on every
ticket insert, including manual entry — not just app-flow saves.

SYNC NOTE: THREE places interpret match results and must move together if prize tiers change:
`checkResult()` in App.js (display badge), the win rule in bright-api (won/lost status), and the
tier ladder in bright-api (points). `match_any` intentionally overlaps with losing tickets.

DATE PLUMBING NOTE: the settlement sweep does NOT join in SQL and contains NO `::date` casts.
It pulls both tables through supabase-js and joins in JavaScript on a string map key —
`` `${d.game}_${d.draw_date}` ``. This works because PostgREST serialises a `date` column as a
plain `YYYY-MM-DD` string. Confirmed in production 2026-08-07. An earlier version of this file
claimed "joins currently need casts" — that was never true.

Gamification tasks 2–5 (schema, award_points choke-point, save_ticket trigger, settlement-tier
awarding) are COMPLETE and verified in production as of 2026-07-15.

Auth: `x-cron-secret` (matching secret `CRON_SECRET`) is the SOLE auth layer for bright-api;
401 otherwise (fails closed if secret unset). Dashboard test panel requires adding that header
manually — the value lives in the cron.job command (`cron.job` table, not a secret you can view
via the dashboard's Secrets page).

Cron: 06:00 UTC daily, via pg_net `net.http_post`. Job: jobid 1, name
"fetch-draw-results", schedule `0 6 * * *`. Changed 2026-09-20 from
`0 4 * * 1,2,3,4,6`. Two reasons: 3 hours of publish-lag margin instead of 1,
and a daily run gives every draw at least two capture attempts. Under the old
schedule Saturday Powerball had exactly ONE attempt (Monday 04:00), which is
how pb 2026-09-12 was lost permanently. Zero new gaps in the 30 days since
the change. Verified via cron.job 2026-10-19.

Cron 401 root cause (found 2026-07-13/15): the historical 401s were the platform's JWT
verification gate rejecting a stray `Authorization` header the cron SQL was also sending — that
header carried the lottery API token, not a Supabase JWT, so the gate failed it before the
request ever reached function code. Fixed by (1) disabling `verify_jwt` for bright-api, both the
dashboard toggle and a pin in `supabase/config.toml`, and (2) removing the Authorization header
from the cron job via `cron.alter_job`.

## RPC: daily_checkin (task 6)

`public.daily_checkin()` — SECURITY DEFINER Postgres function, callable via `supabase.rpc('daily_checkin')`.
Any day earns checkin points (10 pts), once per LA-time day — `America/Los_Angeles` is the
rollover anchor (not UTC, not the user's local device timezone), so the "day" boundary is
consistent across users regardless of where they physically are. Client sends no arguments;
the function derives both the user (`auth.uid()`) and the date server-side. Idempotency comes
from the same `point_events` dedup index used everywhere else (user_id, event_type='checkin',
ref_id=that LA date string) — a double-tap or retried call just returns `{ awarded: false }`.
Triggered from the check-in button in App.js.

## Secrets (Supabase → Edge Functions → Secrets)

- `PICKLOGIC_SERVICE_KEY` — service role key, used by edge function
- `LOTTERY_API_TOKEN` — lotteryresultsfeed.com (rotated 2026-07-06 after a leak; old token revoked)
- `CRON_SECRET` — invocation auth; same value lives in the cron job's x-cron-secret header

Rules: never hardcode secrets in source; never print secret values in sessions; anon key is fine in frontend.

## Operational notes

- Testing gamification/settlement flows pollutes J's own points. Standard post-test cleanup:
  zero `profiles.points` for J's account + delete `point_events` rows by J's email.
- Ticket statuses have been hand-edited in the SQL Editor during settlement testing (June 2026) —
  ticket id 2 is `lost` with no matching draws row, which the sweep cannot produce. That is the
  explanation, not a bug. In production nothing writes `status` outside the bright-api sweep.
- "Success. No rows returned" is the SQL Editor's normal output for DML — a DELETE that removed
  0 rows and one that removed 2 look identical. Always verify with a follow-up count.
- Draw fetching is intentionally user-independent: cron collects each game's latest draw on
  schedule into `draws`, and every user's ticket check reads from that stored table — checking
  a ticket NEVER calls the lottery API directly. Don't design future features assuming a
  per-user or on-demand fetch path exists; it doesn't.
- Missed cron nights create permanent draw gaps — the function only fetches the latest draw per
  game, it doesn't backfill. Open tickets behind a gap never settle on their own. Draw history
  starts 2026-06-03 (two June rows: pb 06-03, mm 06-05), then a gap until mm 2026-07-03, then
  continuous. Planned fix (seed + self-heal) is in the "Deprioritized" note under
  "Current status & next up". June-era relic tickets caught by an old gap
  were deleted. Update: 78 rows as of 2026-10-19. Gaps are the June block (06-06 through 07-01, 19 draws)
  and pb 2026-09-12. The 09-12 loss traces to a run on 09-14 that saved nothing for either game;
  the next run found pb latest = 09-14 and skipped it.
- GAPS ARE NOT ALWAYS CRON FAILURES. Diagnosed 2026-08-07 on a missing pb 2026-08-05: cron fired
  on schedule and the function returned HTTP 200 with
  `{"ok":true,"saved":["pb 2026-08-03","mm 2026-08-04"],...}` — it ran fine, but the feed had not
  yet published Wednesday's draw. Powerball draws 02:59 UTC; cron ran at 04:00 UTC at the time, ~1 hour later,
  which sat right on the edge of the feed's publish window. Most weeks it won, some weeks it
  didn't. Update 2026-10-19 pb 2026-08-05 is no longer missing. It landed 2026-08-08 at 04:00, three days late.
  cron was moved  to `0 6` UTC on 2026-09-20.
  SELF-HEAL RULE: a late-publishing draw recovers on its own ONLY if a later run
  fires before that game's next draw publishes. Otherwise the gap is permanent.
  This is why daily cron matters more than the hour it runs at.
- DIAGNOSING CRON: `cron.job_run_details` only proves the SQL ran. pg_net is async, so
  "succeeded / 1 row" just means the request was queued. The actual HTTP status and response body
  are in `net._http_response` — but that table prunes aggressively (it held exactly one row when
  checked). Look there FIRST and look FAST.
- A pasted migration reporting "Success. No rows returned" in the SQL Editor does NOT prove it
  fully applied — the username constraint migration silently half-applied once. Standard
  practice now: after applying any migration, run a verification query confirming the actual
  constraint/index/function exists (e.g. query `information_schema` or `pg_constraint`), don't
  trust the success message alone.
- CRA + Vercel: `CI=true` makes ESLint warnings fatal at build time. Any new load function
  referenced inside a session-gated `useEffect` in App.js must be wrapped in `useCallback` with
  correct deps and included in that effect's dependency array (the pattern established fixing
  `loadCheckinStatus`), or the Vercel build fails on `react-hooks/exhaustive-deps`. Always run
  `CI=true npm run build` locally before pushing App.js changes.

## Frontend logic worth knowing (src/App.js)

- `checkResult(ticket, draws)` — display-only prize badge; settlement is the DB truth
- `getDrawReminders()` — in-app banners; uses LOCAL dates throughout (UTC mixing bug fixed — don't reintroduce toISOString here)
- **Date helpers are module-scope and are the single source of truth. Do not re-declare inline.**
  - `toLocalDateString(d)` — Date → `YYYY-MM-DD` from LOCAL components. NEVER use
    `toISOString()` for this. It converts to UTC first, so in any negative-offset timezone an
    evening date rolls forward a day. This bug was fixed twice: once in `getDrawReminders`, and
    again on 2026-08-07 in the quick-pick default draw date, which had silently kept it.
  - `parseLocalDate(str)` — `YYYY-MM-DD` → local Date, or null. Component parse, never
    `new Date("2026-08-08")` (that parses as UTC midnight and shifts the weekday). Also rejects
    rollovers like `2026-02-31`.
  - `DRAW_DAYS = { pb: [1,3,6], mm: [2,5] }` — 0=Sun. Used by validation, the non-draw-day
    warning, AND `getDrawReminders`. Previously duplicated inline as `pbDays`/`mmDays`.
  - `MIN_DRAW_DATE = "2024-01-01"`, `MAX_DRAW_DATE_DAYS_AHEAD = 35`, `maxDrawDate()`
  - `validateDrawDate(str)` — returns an error string or null. HARD reject: empty, unparseable,
    before MIN, more than 35 days out.
  - `nonDrawDayWarning(game, str)` — returns warning copy or null. SOFT: warns, never blocks.
- Date validation runs in BOTH save paths (`saveTicket` and `saveManualTicket`), using the
  existing `showToast(...) + return` guard style. Both date inputs carry
  `min={MIN_DRAW_DATE} max={maxDrawDate()}`. Note quick-pick save now REQUIRES a date; it
  previously accepted empty and wrote null.
- Non-draw-day warning is a two-step in-modal button: first Save click arms it (amber banner +
  button reads "Save anyway"), second click saves. Deliberately not `window.confirm`. The armed
  token is keyed on game AND date (`warnKey`), so changing either re-arms rather than leaving it
  armed for a combination the user was never shown. Locked UX decision.
- `saveTicketEdit` — explicit-0 stakes/payouts are valid (parseOrKeep helper; don't regress to `||` fallbacks)
- `pickUnique` weighted branch — guarantees exactly `count` picks (floating-point fallback in place)
- Stats: wins = status==='won' (now real, since settlement); net = all payouts − all stakes
- Manual ticket entry doubles as the settlement testing tool
- Game constants: pb main 1–69 special 1–26; mm main 1–70 special 1–25
- Check-in button (task 6): calls `daily_checkin` RPC; claimed/claimable state read from
  `point_events` on load, not stored client-side.
- Ticket cards (task 6.5): show a "+N pts" badge next to the match badge ONLY for match-tier
  awards (`match_any`/`match_3plus`/`jackpot`) — save_ticket and checkin points are deliberately
  NOT shown per-card. Locked display decision, not an oversight.
- Username UI (task 7): set/edit inline on the main screen; client regex mirrors the DB check
  constraint. Usernames are changeable at any time.
- Leaderboard UI (task 7): new nav tab, top 25 from the `leaderboard` view, current user's row
  highlighted if present, own rank fetched and pinned separately if outside the top 25. Ranking
  is lifetime points — v1, locked decision (no seasons/resets yet).
- **Type scale is module-scope and is the single source of truth (added 2026-10-19).** Declared
  above `S`: `T = { micro: 11, small: 13, body: 15, strong: 17, title: 22, display: 30 }`.
  Every text `fontSize` in `S` and in inline `style={{...}}` references a token — zero
  untokenized `fontSize` as of the 2026-10-19 commits. Rule going forward: no bare pixel font sizes.
  - `INPUT_FONT_MIN = 16`, applied as `Math.max(token, INPUT_FONT_MIN)` on every interactive
    input (`S.formInput`, `S.usernameInput`, `S.ticketEditInput`, the inline manual-entry
    number circles). Reason: iOS Safari auto-zooms the page when a focused input is under 16px.
    It is a floor, not a scale token.
  - `FORM_HINT_GAP = 6` — gap between an input and the helper line under it (`S.formHint`);
    the hint then carries `S.formInput.marginBottom`. No negative margins.
  - `ICON_SIZE = { banner: 16, empty: 32, emptyHero: 40 }` — decorative emoji/glyphs, kept
    deliberately out of `T` because they are not text.
- **Inline styles cannot carry media queries.** Viewport response uses `clamp()` inside the
  style value, built from tokens (e.g. `` `clamp(${T.small}px, 3.6vw, ${T.body}px)` ``). There is
  no CSS file; adding one is a separate decision.
- Layout width: `S.app.maxWidth` is 600 (was 480). `authBox` deliberately left at `maxWidth: 400`.
  A true desktop layout would be a redesign, not a tweak.
- Layout fixes 2026-10-19 (from the readability checkpoint): nav tab label renamed
  "Leaderboard" → "Leaders" (view key `"leaderboard"` and the page heading unchanged) so four
  tabs fit on a 375px phone; `navBtn` (`padding: "10px 4px"`) and `statValue` use `clamp()`;
  `statCard` has `minWidth: 0`; the ticket edit button stack uses `alignSelf: "flex-end"`
  instead of a hardcoded `paddingTop`.
- `EMAIL_DOMAIN_TYPOS` + `emailTypoWarning(email)` — module-scope typo guard for common mail
  domain misspellings, returns `Did you mean <local>@<fix>?` or null. SIGNUP ONLY (a login typo
  already fails with Supabase's invalid-credentials error; the harm is only at signup, where a
  bad address permanently breaks password recovery now that confirmation is off). Follows the
  `nonDrawDayWarning` pattern: SOFT, first submit arms the banner (`S.drawDayWarning`, button
  reads "Create account anyway"), second submit proceeds. Armed token is the exact email
  string, so editing re-arms. Never blocks.

## Conventions & working agreements

- **Executor is Claude Cowork** (replaced Claude Code as of 2026-08-07).
- **Division of labor: Cowork authors files, J runs ALL git commands.** Cowork's sandbox mounts
  the repo with create/write/rename permitted but **unlink blocked**. Git needs unlink for its
  rollback paths, so a failed git command strands a `.git/index.lock` (or
  `.git/objects/maintenance.lock`) that Cowork cannot remove, and every later `git add`/`commit`
  fails with "Unable to create index.lock: File exists". J deletes stranded locks from Command
  Prompt. Cowork does not run git commands that write.
- **Use scoped `git add <path>`, not `git add -A`**, when committing one task at a time — Cowork
  may already have edited other files for the next task.
- Line endings: `.gitattributes` (`* text=auto`) added 2026-08-07. Root cause of the earlier
  phantom 151-line diffs was Windows-side re-saves rewriting LF→CRLF with no content change.
  Git now stores LF and checks out CRLF on Windows; `LF will be replaced by CRLF` on `git add`
  is CORRECT behavior, not a relapse.
- Step-by-step with confirmation checkpoints; one commit per task; stop and flag ambiguity rather than improvise
- **Verify against actual code and against the live catalogs, not spec or this file.** Four claims
  have now turned out wrong on inspection — including two IN THIS FILE (`draws.draw_date` is
  TEXT; "joins currently need casts"). Treat this file as high-quality but fallible.
- New feature phases start in a fresh Claude.ai chat
- Supabase dashboard steps (secrets, cron, SQL editor) are done by J — hand them over explicitly
- Cowork has a read-only, project-scoped Supabase MCP connector for recon and verification:
  `https://mcp.supabase.com/mcp?project_ref=jehqbmchbveyiqdvdyua&read_only=true&features=database,docs`
  Runs as `supabase_read_only_user`. It CANNOT apply migrations — by design.
- Migrations: write to `supabase/migrations/`, but apply via dashboard SQL Editor
  (`supabase db push` fails with a role-provisioning permission error on this project)
- Build gate `CI=true npm run build` is run by J. Cowork's shell caps at 45s and CRA needs longer
  over the mount; Cowork can only static-check (parse + symbol/brace audit).
- **Splitting mixed changes into separate commits:** when a second task lands in the same file
  before the first is committed, Cowork writes the second task's changes as a patch file
  (verified with `git apply --check -R`). J runs `git apply -R <patch>` → gate → commit task 1,
  then `git apply <patch>` → gate → commit task 2, then deletes the untracked patch. Worked
  cleanly 2026-10-19.
- Update this file + commit at the end of any session that changes ground truth; J re-uploads it to the Claude.ai project

## Current status & next up

Done: auth, tickets CRUD + RLS, manual entry, auto result fetching + server-side settlement,
in-app draw reminders, secured edge function, cron auth fixed and confirmed firing.

**Gamification phase COMPLETE** (tasks 2–7, all verified in production): point_events ledger +
point_values + leaderboard view, award_points choke-point, save_ticket insert trigger,
settlement-tier point awarding, daily_checkin RPC + check-in button, per-ticket match-points
display, username set/edit UI with format + case-insensitive uniqueness enforcement, leaderboard
UI. New feature phases start in a fresh Claude.ai chat — this phase is closed.

**Date integrity phase COMPLETE 2026-08-07** (verified in production): `tickets.draw_date`
migrated TEXT → `date`; hard validation in both save paths (empty / unparseable / before
2024-01-01 / more than 35 days out); soft non-draw-day warning with two-step confirm; `min`/`max`
on both date inputs; quick-pick default date UTC-shift bug fixed; `DRAW_DAYS` consolidated to one
declaration. Two permanently-unsettleable tickets (pb on a Tue, mm on a Wed) deleted; their
save_ticket points deliberately kept. Recon found the data already clean — 0 NULL, 0 malformed,
0 pre-2024. Schema now rejects bad dates; UI rejects them before the database sees them. This
phase is closed.

Next up: LAUNCH PREP. Goal changed 2026-10-19: launch = a public website
strangers can sign up for and use. App Store is an explicitly later phase.

Blocking launch:
1. Readability — DONE 2026-10-19 (type scale, 16px inputs, maxWidth 600, clamp()
   on nav and stats). See "Frontend logic worth knowing".
2. Auth email — Supabase built-in SMTP is 2 emails/hour and testing-only.
   Decision 2026-10-19: ship with email confirmation OFF; email still required
   at signup. Confirmation returns alongside email reminders, once the domain
   and Resend are live. DONE 2026-10-19: confirmation off, confirmation copy
   removed, signup email typo guard added. See "Auth" under Stack & deploy chains.
3. Privacy policy + ToS before sharing the link widely

Deprioritized: draw history seed + self-heal. Still worth doing (pb 2026-09-12
and the June block stay permanent holes), but it protects history that no
current user has tickets behind. Cron is stable; new gaps are not accumulating.
Open question still unanswered: does lotteryresultsfeed.com support
fetch-by-date? Nothing recorded either way. When it happens, the seed lands into
a clean schema: both `draw_date` columns are real `date` types.

Deferred (post-launch): ticket scanner (wanted), multi-ticket quick pick,
spending tracker, syndicate tracking, Stripe paywall.

Backlog (do not build now):
- Memoize session-gated loads (`loadTickets`, `loadCheckinStatus`, `loadProfile`) against
  `onAuthStateChange` token-refresh re-fires — they currently re-run on every refresh, not just
  login/logout. Inherited inefficiency, harmless at current scale, not urgent.
- Settle-on-demand after manual ticket save (invoke the idempotent settlement sweep right after
  a manual entry, for instant feedback) — optional UX polish only; do NOT use this as a reason to
  add a second place that interprets match results, the three-way sync note still applies.
- Manual-entry number inputs accept any length (e.g. 8867). Save-time validation rejects
  out-of-range values, so data is safe, but `onChange` should cap input at 2 digits. Note
  `min`/`max` on `type="number"` do not restrict typing. (Phone review 2026-10-19.)
- Manual-entry circles render slightly oval on iOS. Likely default input appearance/padding
  against the fixed 48px size. Same code block as the item above; fix together.
- Ticket edit row: Notes-on-own-line change deferred. Needs a markup reorder (Notes precedes
  the button stack), not a style tweak.
- Total Spent of $1,000+ may sit at the stat card edge on a 375px phone even with the clamp.
  Unverified.

Email reminders (Resend domain verification still pending) deliberately deferred — resume before
Stripe phase.
