-- Migration: award_points choke-point + point_values lookup + lock-trigger tweak
-- Phase: Gamification (task 3)
-- Apply via Supabase dashboard SQL Editor.

-- 1. point_values — server-side source of truth for award amounts.
--    Client never sends a point value; award_points reads it from here.
create table if not exists public.point_values (
  event_type text primary key,
  points     integer not null check (points >= 0)
);

insert into public.point_values (event_type, points) values
  ('save_ticket',  5),
  ('checkin',     10),
  ('match_any',   20),
  ('match_3plus', 50),
  ('jackpot',   1000)
on conflict (event_type) do update set points = excluded.points;

-- Lock it: RLS on, no policies → anon/authenticated get nothing.
-- award_points reads it as postgres (definer owner), which bypasses RLS.
alter table public.point_values enable row level security;
revoke all on public.point_values from anon, authenticated;

-- 2. award_points — the single choke-point. Looks value up server-side,
--    idempotent-inserts the ledger row, increments points ONLY if a new
--    row was actually created (so re-runs / double-taps can't double-award).
create or replace function public.award_points(
  p_user_id    uuid,
  p_event_type text,
  p_ref_id     text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_points   integer;
  v_inserted integer;
begin
  select points into v_points
    from public.point_values
    where event_type = p_event_type;

  if v_points is null then
    raise exception 'award_points: unknown event_type %', p_event_type;
  end if;

  insert into public.point_events (user_id, event_type, points, ref_id)
  values (p_user_id, p_event_type, v_points, p_ref_id)
  on conflict (user_id, event_type, ref_id) do nothing;

  get diagnostics v_inserted = row_count;

  if v_inserted = 1 then
    update public.profiles
      set points = points + v_points
      where id = p_user_id;
  end if;
end;
$$;

-- Clients cannot call this directly (no forging jackpot). service_role can,
-- for settlement. Internal definer callers (checkin RPC, save-ticket trigger)
-- run as postgres and can call it regardless of grants.
revoke all on function public.award_points(uuid, text, text)
  from public, anon, authenticated;
grant execute on function public.award_points(uuid, text, text)
  to service_role;

-- 3. Teach the points lock to permit the definer path, without loosening
--    anything else. current_user = 'postgres' only happens inside a
--    definer function owned by postgres, or a postgres/SQL-editor session —
--    all trusted. A client (authenticated/anon) can never reach this.
create or replace function public.protect_profile_points()
returns trigger
language plpgsql
as $$
begin
  if new.points is distinct from old.points
     and auth.role() <> 'service_role'
     and current_user <> 'postgres' then
    new.points := old.points;
  end if;
  return new;
end;
$$;