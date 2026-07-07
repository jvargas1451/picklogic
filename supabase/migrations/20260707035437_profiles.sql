-- 1. profiles table
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  username text unique,
  points integer not null default 0,
  created_at timestamptz not null default now()
);

-- 2. auto-create a profile row for every new auth user
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, username, points)
  values (new.id, null, 0)
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- 3. backfill profiles for existing users
insert into public.profiles (id, username, points)
select u.id, null, 0
from auth.users u
left join public.profiles p on p.id = u.id
where p.id is null;

-- 4. RLS: public read, owner-only write
alter table public.profiles enable row level security;

create policy "Profiles are publicly readable"
  on public.profiles for select
  using (true);

create policy "Users can insert their own profile"
  on public.profiles for insert
  with check (auth.uid() = id);

create policy "Users can update their own profile"
  on public.profiles for update
  using (auth.uid() = id)
  with check (auth.uid() = id);

-- 4b. points are server-authoritative: RLS can't restrict by column, so a
-- trigger silently reverts any client-side change to points. Only the
-- service_role connection (edge functions) can move points.
create or replace function public.protect_profile_points()
returns trigger
language plpgsql
as $$
begin
  if new.points is distinct from old.points and auth.role() <> 'service_role' then
    new.points := old.points;
  end if;
  return new;
end;
$$;

create trigger protect_profile_points
  before update on public.profiles
  for each row execute function public.protect_profile_points();
