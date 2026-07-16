-- Migration: username format + case-insensitive uniqueness
-- Phase: Gamification (task 7)
-- Client validation mirrors this; DB is the enforcement layer.
-- Apply via Supabase dashboard SQL Editor.

alter table public.profiles
  drop constraint if exists username_format;

alter table public.profiles
  add constraint username_format
  check (username is null or username ~ '^[A-Za-z0-9_]{3,20}$');

-- Case-insensitive uniqueness (blocks "Winner" vs "winner").
-- Replaces reliance on the existing case-sensitive unique constraint.
create unique index if not exists profiles_username_lower_unique
  on public.profiles (lower(username));
