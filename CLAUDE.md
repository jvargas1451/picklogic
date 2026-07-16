# CLAUDE.md — PickLogic

Context file for Claude Code and Claude.ai. This is the CURRENT STATE of the project.
The Technical Master Plan and Orientation Reference (docx) hold strategy and rationale;
this file holds facts. When they conflict, this file wins. Update this file at the end
of any session that changes architecture, schema, secrets, or workflows.

Last updated: 2026-07-15 (cron auth fix confirmed + verified; gamification tasks 2–5 complete)

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
- **Deploy (edge functions):** SEPARATE from git chain. `npx supabase functions deploy bright-api`.
  CLI is a dev dependency (`npx supabase ...`), linked to the project. Docker warnings on deploy are harmless.
- **Email:** Resend account exists; domain verification NOT done. No email features built.
- **Planned:** Stripe (later phase).

## Database schema (public)

- **tickets** — id, user_id (FK auth.users), game ("pb"/"mm"), numbers int[], special int,
  pick_mode, draw_date, stake, payout, status ("open"/"won"/"lost"), notes, created_at.
  RLS: single ALL policy, `auth.uid() = user_id` on both USING and WITH CHECK. Verified correct — do not modify.
- **draws** — id, game, draw_date, numbers, special, jackpot, created_at.
  Unique on (game, draw_date). RLS: public SELECT only. Written only by the edge function (service role).
  NOTE: numbers may be stored as strings — settlement code normalizes to int before comparing.
- **profiles** — id (PK, FK auth.users, cascade), username (text, unique, nullable), points (int, default 0), created_at.
  Created by trigger on auth.users insert; existing users backfilled.
  RLS: public SELECT (leaderboard requirement); INSERT/UPDATE owner-only.
  `points` is server-authoritative: the `protect_profile_points` BEFORE UPDATE trigger reverts
  points changes unless the caller is service_role OR `current_user = 'postgres'` (the
  SECURITY DEFINER path used by `award_points`). Clients can set username; client forgery of
  points is still blocked either way.
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

Separately, an AFTER INSERT trigger on `tickets` awards the `save_ticket` event (5 pts) on every
ticket insert, including manual entry — not just app-flow saves.

SYNC NOTE: THREE places interpret match results and must move together if prize tiers change:
`checkResult()` in App.js (display badge), the win rule in bright-api (won/lost status), and the
tier ladder in bright-api (points). `match_any` intentionally overlaps with losing tickets.

Gamification tasks 2–5 (schema, award_points choke-point, save_ticket trigger, settlement-tier
awarding) are COMPLETE and verified in production as of 2026-07-15.

Auth: `x-cron-secret` (matching secret `CRON_SECRET`) is the SOLE auth layer for bright-api;
401 otherwise (fails closed if secret unset). Dashboard test panel requires adding that header
manually — the value lives in the cron.job command (`cron.job` table, not a secret you can view
via the dashboard's Secrets page).

Cron: 4am UTC after draw nights, via pg_net `net.http_post`. Draw days: Powerball Mon/Wed/Sat,
Mega Millions Tue/Fri. Job: jobid 1, name "fetch-draw-results", schedule `0 4 * * 1,2,3,4,6`.
Confirmed firing on schedule (pg_net working) as of 2026-07-15.

Cron 401 root cause (found 2026-07-13/15): the historical 401s were the platform's JWT
verification gate rejecting a stray `Authorization` header the cron SQL was also sending — that
header carried the lottery API token, not a Supabase JWT, so the gate failed it before the
request ever reached function code. Fixed by (1) disabling `verify_jwt` for bright-api, both the
dashboard toggle and a pin in `supabase/config.toml`, and (2) removing the Authorization header
from the cron job via `cron.alter_job`.

## Secrets (Supabase → Edge Functions → Secrets)

- `PICKLOGIC_SERVICE_KEY` — service role key, used by edge function
- `LOTTERY_API_TOKEN` — lotteryresultsfeed.com (rotated 2026-07-06 after a leak; old token revoked)
- `CRON_SECRET` — invocation auth; same value lives in the cron job's x-cron-secret header

Rules: never hardcode secrets in source; never print secret values in sessions; anon key is fine in frontend.

## Operational notes

- Testing gamification/settlement flows pollutes J's own points. Standard post-test cleanup:
  zero `profiles.points` for J's account + delete `point_events` rows by J's email.
- Missed cron nights create permanent draw gaps — the function only fetches the latest draw per
  game, it doesn't backfill. Open tickets behind a gap never settle on their own (see backlog:
  "backfill missing draws" capability). June-era relic tickets caught by an old gap were deleted.

## Frontend logic worth knowing (src/App.js)

- `checkResult(ticket, draws)` — display-only prize badge; settlement is the DB truth
- `getDrawReminders()` — in-app banners; uses LOCAL dates throughout (UTC mixing bug fixed — don't reintroduce toISOString here)
- `saveTicketEdit` — explicit-0 stakes/payouts are valid (parseOrKeep helper; don't regress to `||` fallbacks)
- `pickUnique` weighted branch — guarantees exactly `count` picks (floating-point fallback in place)
- Stats: wins = status==='won' (now real, since settlement); net = all payouts − all stakes
- Manual ticket entry doubles as the settlement testing tool
- Game constants: pb main 1–69 special 1–26; mm main 1–70 special 1–25

## Conventions & working agreements

- Step-by-step with confirmation checkpoints; one commit per task; stop and flag ambiguity rather than improvise
- Verify against actual code, not spec — two spec claims have already turned out wrong on inspection
- New feature phases start in a fresh Claude.ai chat
- Supabase dashboard steps (secrets, cron, SQL editor) are done by J, not Claude Code — hand them over explicitly
- Migrations: write to `supabase/migrations/`, but apply via dashboard SQL Editor
  (`supabase db push` fails with a role-provisioning permission error on this project)
- Update this file + commit at the end of any session that changes ground truth; J re-uploads it to the Claude.ai project

## Current status & next up

Done: auth, tickets CRUD + RLS, manual entry, auto result fetching + server-side settlement,
in-app draw reminders, secured edge function, profiles/username groundwork, cron auth fixed and
confirmed firing, gamification tasks 2–5 (ledger/schema, award_points choke-point, save_ticket
trigger, settlement-tier point awarding) complete and verified in production.

Next up: task 6 (explicit check-in button), task 6.5 (per-ticket points display on ticket cards —
added to the gamification plan), task 7 (leaderboard UI), then username-setting UI if not already
covered.

Backlog (do not build now):
- `draws.draw_date` is TEXT; migrate to a real `date` type (joins currently need casts)
- Manual entry accepts invalid dates (year 0001 got through — the HTML date input's `min` doesn't
  block typed input); add validation in `saveManualTicket`
- Warn on tickets saved for non-draw-days
- "Backfill missing draws" capability, for recovering from cron/outage gaps (see Operational notes)

Later backlog: multi-ticket quick pick, spending tracker, syndicate tracking, Stripe paywall.
Email reminders (Resend) deliberately deferred — resume before Stripe phase.
