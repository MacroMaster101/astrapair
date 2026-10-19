-- Sprint 2: birth profiles and natal charts.
-- Deny-by-default RLS; owners manage their own profile and its charts.
-- Audit triggers record ids only, never birth data.

create table public.birth_profiles (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null unique references auth.users (id) on delete cascade,
  display_name text check (char_length(display_name) between 1 and 80),
  birth_date date not null check (birth_date >= '1900-01-01'),
  birth_time time,
  birth_time_accuracy text not null
    check (birth_time_accuracy in ('exact', 'approximate', 'unknown')),
  birth_place_label text not null check (char_length(birth_place_label) between 1 and 200),
  latitude double precision not null check (latitude between -90 and 90),
  longitude double precision not null check (longitude between -180 and 180),
  timezone_id text not null check (char_length(timezone_id) between 1 and 64),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((birth_time is null) = (birth_time_accuracy = 'unknown'))
);

create trigger birth_profiles_set_updated_at
  before update on public.birth_profiles
  for each row execute function public.set_updated_at();

alter table public.birth_profiles enable row level security;

create policy "Owners can view their birth profile"
  on public.birth_profiles for select to authenticated
  using ((select auth.uid()) = owner_user_id);

create policy "Owners can create their birth profile"
  on public.birth_profiles for insert to authenticated
  with check ((select auth.uid()) = owner_user_id);

create policy "Owners can update their birth profile"
  on public.birth_profiles for update to authenticated
  using ((select auth.uid()) = owner_user_id)
  with check ((select auth.uid()) = owner_user_id);

create policy "Owners can delete their birth profile"
  on public.birth_profiles for delete to authenticated
  using ((select auth.uid()) = owner_user_id);

revoke all on public.birth_profiles from anon, authenticated;
grant select, insert, delete on public.birth_profiles to authenticated;
-- Column-level update: exactly the columns the app's upsert sets (id and
-- created_at stay immutable; updated_at is maintained by a trigger).
grant update (
  owner_user_id,
  display_name,
  birth_date,
  birth_time,
  birth_time_accuracy,
  birth_place_label,
  latitude,
  longitude,
  timezone_id
) on public.birth_profiles to authenticated;

create table public.charts (
  id uuid primary key default gen_random_uuid(),
  birth_profile_id uuid not null references public.birth_profiles (id) on delete cascade,
  zodiac_system text not null default 'tropical' check (zodiac_system = 'tropical'),
  house_system text check (house_system in ('placidus', 'porphyry')),
  calculation_provider text not null,
  calculation_version text not null,
  input_hash text not null check (char_length(input_hash) = 64),
  chart_json jsonb not null,
  created_at timestamptz not null default now(),
  unique (birth_profile_id, input_hash)
);

alter table public.charts enable row level security;

create policy "Owners can view their charts"
  on public.charts for select to authenticated
  using (exists (
    select 1 from public.birth_profiles bp
    where bp.id = charts.birth_profile_id and bp.owner_user_id = (select auth.uid())
  ));

create policy "Owners can create their charts"
  on public.charts for insert to authenticated
  with check (exists (
    select 1 from public.birth_profiles bp
    where bp.id = charts.birth_profile_id and bp.owner_user_id = (select auth.uid())
  ));

create policy "Owners can delete their charts"
  on public.charts for delete to authenticated
  using (exists (
    select 1 from public.birth_profiles bp
    where bp.id = charts.birth_profile_id and bp.owner_user_id = (select auth.uid())
  ));

-- Charts are immutable: no update policy or grant.
revoke all on public.charts from anon, authenticated;
grant select, insert, delete on public.charts to authenticated;

create or replace function public.audit_birth_profile_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.audit_events (actor_user_id, event_type, resource_type, resource_id)
  values (
    new.owner_user_id,
    case when tg_op = 'INSERT' then 'birth_profile.created' else 'birth_profile.updated' end,
    'birth_profile',
    new.id::text
  );
  return new;
end;
$$;

revoke all on function public.audit_birth_profile_change() from public, anon, authenticated;

create trigger birth_profiles_audit
  after insert or update on public.birth_profiles
  for each row execute function public.audit_birth_profile_change();
