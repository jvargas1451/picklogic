-- Migration: point_events ledger + leaderboard view
-- Phase: Gamification
-- Apply via Supabase dashboard SQL Editor.

-- 1. point_events — append-only ledger. One row per point award.
create table if not exists public.point_events (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  event_type  text not null check (event_type in
                 ('save_ticket','checkin','match_any','match_3plus','jackpot')),
  points      integer not null check (points >= 0),  -- snapshot of value at award time
  ref_id      text not null,                          -- ticket id, or draw_date for checkin
  created_at  timestamptz not null default now()
);

-- Idempotency: one row per (user, event_type, ref).
-- Re-run settlement or double-tap check-in → no double award.
-- Non-stacking is enforced in settlement LOGIC, not here (this is pure dedup).
create unique index if not exists point_events_dedup
  on public.point_events (user_id, event_type, ref_id);

create index if not exists point_events_user_idx
  on public.point_events (user_id, created_at desc);

-- RLS: owner reads own ledger; nobody writes (service_role bypasses RLS).
alter table public.point_events enable row level security;

create policy "own point_events readable"
  on public.point_events for select
  using (auth.uid() = user_id);

grant select on public.point_events to authenticated;

-- 2. Leaderboard view — username + points, ranked, usernames only.
create or replace view public.leaderboard
  with (security_invoker = true) as
  select
    username,
    points,
    rank() over (order by points desc) as rank
  from public.profiles
  where username is not null
  order by points desc;

grant select on public.leaderboard to anon, authenticated;