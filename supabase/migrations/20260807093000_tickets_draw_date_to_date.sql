-- Migration: tickets.draw_date TEXT -> date
-- Phase: Date Integrity (Task 1)
-- Apply via Supabase dashboard SQL Editor. Do NOT use `supabase db push`
-- (role-provisioning permission error on this project).
--
-- SCOPE NOTE -----------------------------------------------------------------
-- draws.draw_date was verified to ALREADY be type `date` on 2026-08-07 via
-- information_schema.columns. This migration converts tickets ONLY.
-- No ALTER is issued against draws: a no-op ALTER TYPE can still force a full
-- table rewrite, so touching it would be cost without benefit.
--
-- CONTEXT --------------------------------------------------------------------
-- Recon on 2026-08-07 found the data already clean. Two tickets (id 14, 15)
-- were deleted immediately before this migration: both were saved for
-- non-draw-days (pb on a Tue, mm on a Wed), so no draw row could ever exist
-- and neither could ever settle. Their save_ticket point_events rows were
-- deliberately kept. Ticket count at time of migration: 11 (was 13).
--
-- Counts across the remaining 11 rows:
--   NULL draw_date .......... 0
--   empty-string draw_date .. 0
--   format violations ....... 0
--   pre-2024 dates .......... 0
-- Dependency scan on public.tickets found NO views, NO indexes, and NO
-- constraints referencing draw_date. The RLS policy ("Users can manage their
-- own tickets", qual: auth.uid() = user_id) and the award_save_ticket AFTER
-- INSERT trigger do not reference draw_date and are unaffected by a type
-- change. Nothing blocks the ALTER.
-- ============================================================================


-- ────────────────────────────────────────────────────────────────────────────
-- PRE-FLIGHT — run this block FIRST, on its own.
-- Every count below MUST be 0. If any is non-zero, STOP and resolve the rows
-- before running the ALTER; do not "fix it in the USING clause".
-- ────────────────────────────────────────────────────────────────────────────
SELECT
  count(*) FILTER (WHERE draw_date IS NULL)                  AS null_dates,
  count(*) FILTER (WHERE draw_date = '')                     AS empty_string_dates,
  count(*) FILTER (WHERE draw_date !~ '^\d{4}-\d{2}-\d{2}$') AS bad_format,
  count(*) FILTER (WHERE draw_date ~ '^\d{4}-\d{2}-\d{2}$'
                     AND draw_date < '2024-01-01')           AS pre_2024
FROM public.tickets;
-- Note: NULL rows are invisible to the regex check (NULL !~ '...' yields NULL,
-- not true), which is why they are counted separately above. NULLs do not
-- block the ALTER — a nullable date column accepts them — but a ticket with a
-- NULL draw_date can never settle, so it is worth knowing they exist.


-- ────────────────────────────────────────────────────────────────────────────
-- MIGRATION
-- Takes ACCESS EXCLUSIVE and rewrites the table. At 13 rows this is instant.
-- ────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.tickets
  ALTER COLUMN draw_date TYPE date USING draw_date::date;


-- ────────────────────────────────────────────────────────────────────────────
-- VERIFICATION — mandatory. Run AFTER the ALTER.
--
-- The SQL Editor's "Success. No rows returned." banner does NOT prove a
-- migration applied (the username constraint migration silently half-applied
-- once). Confirm against the catalogs, then paste results back.
-- ────────────────────────────────────────────────────────────────────────────

-- 1. Type actually changed.
--    EXPECT: draws = date (unchanged), tickets = date (converted).
SELECT table_name, data_type
FROM information_schema.columns
WHERE table_schema = 'public' AND column_name = 'draw_date'
ORDER BY table_name;

-- 2. RLS policy survived untouched.
--    EXPECT: one row — "Users can manage their own tickets", qual and
--    with_check both (auth.uid() = user_id). This migration must not alter it.
SELECT polname,
       pg_get_expr(polqual,      polrelid) AS using_expr,
       pg_get_expr(polwithcheck, polrelid) AS with_check_expr
FROM pg_policy
WHERE polrelid = 'public.tickets'::regclass;

-- 3. Points trigger survived.
--    EXPECT: one row — award_save_ticket, AFTER INSERT.
SELECT tgname, pg_get_triggerdef(oid) AS def
FROM pg_trigger
WHERE tgrelid = 'public.tickets'::regclass AND NOT tgisinternal;

-- 4. Primary key intact.
--    EXPECT: tickets_pkey, PRIMARY KEY (id).
SELECT conname, pg_get_constraintdef(oid) AS def
FROM pg_constraint
WHERE conrelid = 'public.tickets'::regclass AND contype = 'p';

-- 5. Row count unchanged.
--    EXPECT: the same count you had before the ALTER.
SELECT count(*) AS total_tickets FROM public.tickets;

-- 6. STEP-PROOF: this INSERT must FAIL with
--    'invalid input syntax for type date: "not-a-date"'.
--    Wrapped in a transaction so that if it somehow SUCCEEDS, the junk row is
--    discarded rather than left in the table. If you see no error, the
--    migration did not apply — do not proceed.
BEGIN;
INSERT INTO public.tickets (user_id, game, draw_date, numbers, special, status)
VALUES ('00000000-0000-0000-0000-000000000000',
        'pb', 'not-a-date', '{1,2,3,4,5}', 1, 'open');
ROLLBACK;
