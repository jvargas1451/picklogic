-- Migration: award save_ticket points on ticket insert
-- Phase: Gamification (task 4)
-- Every ticket insert (quick-pick OR manual) awards save_ticket points.
-- Idempotent via award_points dedup (user_id, 'save_ticket', ticket id).
-- Apply via Supabase dashboard SQL Editor.

create or replace function public.award_save_ticket()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.award_points(new.user_id, 'save_ticket', new.id::text);
  return new;
end;
$$;

create trigger award_save_ticket
  after insert on public.tickets
  for each row
  execute function public.award_save_ticket();
