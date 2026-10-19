-- Sprint 1: account foundation — profiles, consents, audit events.
-- Every table has RLS enabled and is deny-by-default; privileged writes go
-- through SECURITY DEFINER functions with a pinned, empty search_path.

-- ---------------------------------------------------------------------------
-- Shared helpers
-- ---------------------------------------------------------------------------

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- profiles: one row per auth user, created by trigger on sign-up
-- ---------------------------------------------------------------------------

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text check (char_length(display_name) between 1 and 80),
  avatar_url text check (char_length(avatar_url) <= 2048),
  onboarded_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger profiles_set_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();

alter table public.profiles enable row level security;

create policy "Users can view their own profile"
  on public.profiles for select
  to authenticated
  using ((select auth.uid()) = id);

create policy "Users can update their own profile"
  on public.profiles for update
  to authenticated
  using ((select auth.uid()) = id)
  with check ((select auth.uid()) = id);

-- Users may only edit presentational columns; onboarded_at is set by
-- complete_onboarding() so consent is always recorded alongside it.
revoke all on public.profiles from anon, authenticated;
grant select on public.profiles to authenticated;
grant update (display_name, avatar_url) on public.profiles to authenticated;

-- ---------------------------------------------------------------------------
-- consents: versioned, timestamped acceptance records
-- ---------------------------------------------------------------------------

create table public.consents (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  consent_type text not null check (consent_type in ('age_confirmation', 'terms', 'privacy')),
  policy_version text not null check (char_length(policy_version) between 1 and 32),
  accepted_at timestamptz not null default now(),
  revoked_at timestamptz
);

create index consents_user_id_idx on public.consents (user_id);

alter table public.consents enable row level security;

create policy "Users can view their own consents"
  on public.consents for select
  to authenticated
  using ((select auth.uid()) = user_id);

revoke all on public.consents from anon, authenticated;
grant select on public.consents to authenticated;

-- ---------------------------------------------------------------------------
-- audit_events: append-only log of sensitive actions; no client access
-- ---------------------------------------------------------------------------

create table public.audit_events (
  id bigint generated always as identity primary key,
  actor_user_id uuid references auth.users (id) on delete set null,
  event_type text not null,
  resource_type text,
  resource_id text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index audit_events_actor_user_id_idx on public.audit_events (actor_user_id);

alter table public.audit_events enable row level security;
-- Intentionally no policies: only SECURITY DEFINER functions and the
-- service role write or read audit events.
revoke all on public.audit_events from anon, authenticated;

-- ---------------------------------------------------------------------------
-- Sign-up hook: create the profile and log the event
-- ---------------------------------------------------------------------------

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, display_name)
  values (
    new.id,
    nullif(left(trim(coalesce(
      new.raw_user_meta_data ->> 'display_name',
      new.raw_user_meta_data ->> 'full_name',
      new.raw_user_meta_data ->> 'name'
    )), 80), '')
  );

  insert into public.audit_events (actor_user_id, event_type, resource_type, resource_id)
  values (new.id, 'account.created', 'user', new.id::text);

  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------------
-- Onboarding: record required consents and mark the profile onboarded
-- ---------------------------------------------------------------------------

create or replace function public.complete_onboarding(p_policy_version text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
begin
  if v_user_id is null then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;

  if p_policy_version is null or char_length(p_policy_version) not between 1 and 32 then
    raise exception 'Invalid policy version' using errcode = '22023';
  end if;

  -- Idempotent: a second call is a no-op.
  if exists (
    select 1 from public.profiles
    where id = v_user_id and onboarded_at is not null
  ) then
    return;
  end if;

  insert into public.consents (user_id, consent_type, policy_version)
  select v_user_id, t.consent_type, p_policy_version
  from unnest(array['age_confirmation', 'terms', 'privacy']) as t (consent_type);

  update public.profiles
  set onboarded_at = now()
  where id = v_user_id;

  insert into public.audit_events (actor_user_id, event_type, resource_type, resource_id, metadata)
  values (
    v_user_id, 'onboarding.completed', 'user', v_user_id::text,
    jsonb_build_object('policy_version', p_policy_version)
  );
end;
$$;

revoke all on function public.complete_onboarding(text) from public, anon;
grant execute on function public.complete_onboarding(text) to authenticated;

revoke all on function public.handle_new_user() from public, anon, authenticated;
