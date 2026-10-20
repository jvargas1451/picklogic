-- Migration: add missing foreign key tickets.user_id -> auth.users(id)
-- Phase: Launch prep (Day 2, Task 2)
-- Apply via Supabase dashboard SQL Editor. Do NOT use `supabase db push`
-- (role-provisioning permission error on this project).
--
-- FINDING (verified 2026-10-19 via pg_constraint) ----------------------------
-- CLAUDE.md claimed tickets.user_id was "FK auth.users". It was not. tickets had
-- NO foreign keys. Only profiles.id and point_events.user_id referenced
-- auth.users. Deleting a user therefore left their tickets orphaned.
-- The privacy policy promises account deletion on request, so this must exist
-- before that page ships.
--
-- PRE-CHECK (read-only connector, 2026-10-19): 0 orphan rows out of 11 tickets,
-- 0 existing FKs on public.tickets, constraint name unused. The ALTER applies
-- cleanly. It is atomic: if an orphan appeared, it would fail and change nothing.
-- ============================================================================

alter table public.tickets
  add constraint tickets_user_id_fkey
  foreign key (user_id) references auth.users(id) on delete cascade;

-- VERIFY AFTER APPLYING (do not trust "Success. No rows returned"):
-- select conname, confrelid::regclass as refs,
--   case confdeltype when 'c' then 'CASCADE' else confdeltype::text end as on_delete
-- from pg_constraint
-- where contype = 'f' and conrelid = 'public.tickets'::regclass;
-- Expected: one row: tickets_user_id_fkey | auth.users | CASCADE
