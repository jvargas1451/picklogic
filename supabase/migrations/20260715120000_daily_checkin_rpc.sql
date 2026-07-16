-- Migration: daily_checkin RPC
-- Phase: Gamification (task 6)
-- Any day earns checkin points, once per LA-time day. Client sends nothing;
-- server derives user + date. Apply via Supabase dashboard SQL Editor.

create or replace function public.daily_checkin()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid   uuid;
  v_today text;
begin
  v_uid := auth.uid();
  if v_uid is null then
    raise exception 'daily_checkin: not authenticated';
  end if;

  v_today := ((now() at time zone 'America/Los_Angeles')::date)::text;

  perform public.award_points(v_uid, 'checkin', v_today);

  if exists (
    select 1 from public.point_events
    where user_id = v_uid and event_type = 'checkin' and ref_id = v_today
      and created_at > now() - interval '5 seconds'
  ) then
    return jsonb_build_object('awarded', true, 'points', 10);
  else
    return jsonb_build_object('awarded', false, 'reason', 'already');
  end if;
end;
$$;

revoke all on function public.daily_checkin() from public, anon;
grant execute on function public.daily_checkin() to authenticated;
