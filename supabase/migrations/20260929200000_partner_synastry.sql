-- Sprint 3: partner invitations, relationships, synastry.
-- Reads are member-only via RLS; every state change is an atomic SECURITY
-- DEFINER function; derived data (charts, synastry) is written only by the
-- server with the secret-key client.

-- ---------------------------------------------------------------------------
-- Charts become server-written only (closes client-writable chart_json).
-- ---------------------------------------------------------------------------
drop policy if exists "Owners can create their charts" on public.charts;
drop policy if exists "Owners can delete their charts" on public.charts;
revoke insert, delete on public.charts from authenticated;

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------
create table public.relationships (
  id uuid primary key default gen_random_uuid(),
  status text not null default 'active' check (status in ('active', 'ended')),
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  ended_at timestamptz,
  ended_by uuid references auth.users (id) on delete set null
);

create table public.relationship_members (
  relationship_id uuid not null references public.relationships (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  joined_at timestamptz not null default now(),
  left_at timestamptz,
  primary key (relationship_id, user_id)
);

-- One active connection per user.
create unique index relationship_members_one_active_idx
  on public.relationship_members (user_id) where left_at is null;
create index relationship_members_user_id_idx on public.relationship_members (user_id);

create table public.relationship_invites (
  id uuid primary key default gen_random_uuid(),
  inviter_user_id uuid not null references auth.users (id) on delete cascade,
  token_hash text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  status text not null default 'pending'
    check (status in ('pending', 'accepted', 'declined', 'revoked')),
  inviter_policy_version text not null check (char_length(inviter_policy_version) between 1 and 32),
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  responded_at timestamptz,
  responded_by uuid references auth.users (id) on delete set null
);

-- At most one pending invite per inviter.
create unique index relationship_invites_one_pending_idx
  on public.relationship_invites (inviter_user_id) where status = 'pending';

create table public.synastry (
  relationship_id uuid primary key references public.relationships (id) on delete cascade,
  input_hash text not null check (input_hash ~ '^[0-9a-f]{64}$'),
  facts_json jsonb not null,
  calculation_version text not null,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Consents: partner sharing, scoped to a relationship
-- ---------------------------------------------------------------------------
alter table public.consents
  add column relationship_id uuid references public.relationships (id) on delete cascade;
alter table public.consents drop constraint consents_consent_type_check;
alter table public.consents add constraint consents_consent_type_check
  check (consent_type in ('age_confirmation', 'terms', 'privacy', 'partner_sharing'));
alter table public.consents add constraint consents_partner_sharing_relationship_check
  check ((consent_type = 'partner_sharing') = (relationship_id is not null));
create index consents_relationship_id_idx on public.consents (relationship_id);

-- ---------------------------------------------------------------------------
-- Membership helpers (SECURITY DEFINER avoids recursive RLS)
-- ---------------------------------------------------------------------------
create or replace function public.is_member(p_relationship_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.relationship_members m
    where m.relationship_id = p_relationship_id and m.user_id = (select auth.uid())
  );
$$;

create or replace function public.is_active_member(p_relationship_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.relationship_members m
    join public.relationships r on r.id = m.relationship_id
    where m.relationship_id = p_relationship_id
      and m.user_id = (select auth.uid())
      and m.left_at is null
      and r.status = 'active'
  );
$$;

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
alter table public.relationships enable row level security;
alter table public.relationship_members enable row level security;
alter table public.relationship_invites enable row level security;
alter table public.synastry enable row level security;

create policy "Members can view their relationships"
  on public.relationships for select to authenticated
  using (public.is_member(relationships.id));

create policy "Members can view relationship members"
  on public.relationship_members for select to authenticated
  using (public.is_member(relationship_members.relationship_id));

create policy "Active members can view synastry"
  on public.synastry for select to authenticated
  using (public.is_active_member(synastry.relationship_id));

-- relationship_invites: intentionally no policies; access only via functions.

revoke all on public.relationships, public.relationship_members,
  public.relationship_invites, public.synastry from anon, authenticated;
grant select on public.relationships, public.relationship_members, public.synastry
  to authenticated;

-- ---------------------------------------------------------------------------
-- Functions
-- ---------------------------------------------------------------------------
create or replace function public.create_invite(p_token_hash text, p_policy_version text)
returns timestamptz
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_id uuid;
  v_expires timestamptz := now() + interval '7 days';
begin
  if v_uid is null then raise exception 'not_authenticated' using errcode = '42501'; end if;
  -- Serialise this user's state changes (invite, accept, connect).
  perform pg_advisory_xact_lock(hashtextextended(v_uid::text, 0));
  if p_token_hash is null or p_token_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'invalid_token' using errcode = '22023';
  end if;
  if p_policy_version is null or char_length(p_policy_version) not between 1 and 32 then
    raise exception 'invalid_policy' using errcode = '22023';
  end if;
  if not exists (select 1 from public.profiles where id = v_uid and onboarded_at is not null) then
    raise exception 'not_onboarded';
  end if;
  if not exists (select 1 from public.birth_profiles where owner_user_id = v_uid) then
    raise exception 'no_birth_profile';
  end if;
  if exists (select 1 from public.relationship_members where user_id = v_uid and left_at is null) then
    raise exception 'already_connected';
  end if;

  update public.relationship_invites
    set status = 'revoked', responded_at = now()
    where inviter_user_id = v_uid and status = 'pending';

  insert into public.relationship_invites (inviter_user_id, token_hash, inviter_policy_version, expires_at)
  values (v_uid, p_token_hash, p_policy_version, v_expires)
  returning id into v_id;

  insert into public.audit_events (actor_user_id, event_type, resource_type, resource_id)
  values (v_uid, 'invite.created', 'relationship_invite', v_id::text);

  return v_expires;
end;
$$;

create or replace function public.revoke_invite()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_id uuid;
begin
  if v_uid is null then raise exception 'not_authenticated' using errcode = '42501'; end if;
  update public.relationship_invites
    set status = 'revoked', responded_at = now()
    where inviter_user_id = v_uid and status = 'pending'
    returning id into v_id;
  if v_id is not null then
    insert into public.audit_events (actor_user_id, event_type, resource_type, resource_id)
    values (v_uid, 'invite.revoked', 'relationship_invite', v_id::text);
  end if;
end;
$$;

create or replace function public.get_my_pending_invite()
returns table (expires_at timestamptz, created_at timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  select i.expires_at, i.created_at
  from public.relationship_invites i
  where i.inviter_user_id = (select auth.uid())
    and i.status = 'pending'
    and i.expires_at > now();
$$;

create or replace function public.get_invite_preview(p_token_hash text)
returns table (inviter_name text, state text, is_own boolean)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_inv public.relationship_invites%rowtype;
  v_name text;
  v_state text;
begin
  select * into v_inv from public.relationship_invites where token_hash = p_token_hash;
  if not found then
    return query select null::text, 'not_found'::text, false;
    return;
  end if;
  v_state := case
    when v_inv.status in ('accepted', 'declined') then 'used'
    when v_inv.status = 'revoked' then 'revoked'
    when v_inv.expires_at <= now() then 'expired'
    else 'valid'
  end;
  if v_state = 'valid' then
    select display_name into v_name from public.profiles where id = v_inv.inviter_user_id;
  end if;
  return query select v_name, v_state, coalesce(v_inv.inviter_user_id = auth.uid(), false);
end;
$$;

create or replace function public.accept_invite(p_token_hash text, p_policy_version text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_inv public.relationship_invites%rowtype;
  v_rel uuid;
  v_inviter uuid;
begin
  if v_uid is null then raise exception 'not_authenticated' using errcode = '42501'; end if;
  if p_policy_version is null or char_length(p_policy_version) not between 1 and 32 then
    raise exception 'invalid_policy' using errcode = '22023';
  end if;

  -- Serialise both users' state changes, in a fixed order. Locks are taken
  -- before the invite row lock (same order as create_invite: user lock, then
  -- invite row) so the two functions cannot deadlock. The inviter never
  -- changes for a given token, so reading it unlocked is safe.
  select inviter_user_id into v_inviter from public.relationship_invites
    where token_hash = p_token_hash;
  if found then
    perform pg_advisory_xact_lock(hashtextextended(least(v_uid, v_inviter)::text, 0));
    perform pg_advisory_xact_lock(hashtextextended(greatest(v_uid, v_inviter)::text, 0));
  end if;

  select * into v_inv from public.relationship_invites
    where token_hash = p_token_hash for update;
  if not found then raise exception 'invite_not_found'; end if;
  if v_inv.status in ('accepted', 'declined') then raise exception 'invite_used'; end if;
  if v_inv.status = 'revoked' then raise exception 'invite_revoked'; end if;
  if v_inv.expires_at <= now() then raise exception 'invite_expired'; end if;
  if v_inv.inviter_user_id = v_uid then raise exception 'self_invite'; end if;
  if not exists (select 1 from public.profiles where id = v_uid and onboarded_at is not null) then
    raise exception 'not_onboarded';
  end if;
  if exists (
    select 1 from public.relationship_members
    where user_id in (v_uid, v_inv.inviter_user_id) and left_at is null
  ) then
    raise exception 'already_connected';
  end if;

  insert into public.relationships (created_by) values (v_inv.inviter_user_id)
  returning id into v_rel;

  insert into public.relationship_members (relationship_id, user_id)
  values (v_rel, v_inv.inviter_user_id), (v_rel, v_uid);

  insert into public.consents (user_id, relationship_id, consent_type, policy_version)
  values
    (v_inv.inviter_user_id, v_rel, 'partner_sharing', v_inv.inviter_policy_version),
    (v_uid, v_rel, 'partner_sharing', p_policy_version);

  update public.relationship_invites
    set status = 'accepted', responded_at = now(), responded_by = v_uid
    where id = v_inv.id;

  -- The accepting user may have had their own pending invite; it is now moot.
  update public.relationship_invites
    set status = 'revoked', responded_at = now()
    where inviter_user_id = v_uid and status = 'pending';

  insert into public.audit_events (actor_user_id, event_type, resource_type, resource_id)
  values (v_uid, 'relationship.created', 'relationship', v_rel::text);

  return v_rel;
end;
$$;

create or replace function public.decline_invite(p_token_hash text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_inv public.relationship_invites%rowtype;
begin
  if v_uid is null then raise exception 'not_authenticated' using errcode = '42501'; end if;
  select * into v_inv from public.relationship_invites
    where token_hash = p_token_hash for update;
  if not found then raise exception 'invite_not_found'; end if;
  if v_inv.status in ('accepted', 'declined') then raise exception 'invite_used'; end if;
  if v_inv.status = 'revoked' then raise exception 'invite_revoked'; end if;
  if v_inv.inviter_user_id = v_uid then raise exception 'self_invite'; end if;
  if v_inv.expires_at <= now() then raise exception 'invite_expired'; end if;

  update public.relationship_invites
    set status = 'declined', responded_at = now(), responded_by = v_uid
    where id = v_inv.id;

  insert into public.audit_events (actor_user_id, event_type, resource_type, resource_id)
  values (v_uid, 'invite.declined', 'relationship_invite', v_inv.id::text);
end;
$$;

create or replace function public.end_relationship(p_relationship_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'not_authenticated' using errcode = '42501'; end if;
  if not exists (
    select 1
    from public.relationship_members m
    join public.relationships r on r.id = m.relationship_id
    where m.relationship_id = p_relationship_id and m.user_id = v_uid
      and m.left_at is null and r.status = 'active'
  ) then
    raise exception 'not_a_member';
  end if;

  update public.relationships
    set status = 'ended', ended_at = now(), ended_by = v_uid
    where id = p_relationship_id and status = 'active';
  -- A concurrent call already ended it.
  if not found then raise exception 'not_a_member'; end if;
  update public.relationship_members
    set left_at = now()
    where relationship_id = p_relationship_id and left_at is null;
  delete from public.synastry where relationship_id = p_relationship_id;
  update public.consents
    set revoked_at = now()
    where relationship_id = p_relationship_id and revoked_at is null;

  insert into public.audit_events (actor_user_id, event_type, resource_type, resource_id)
  values (v_uid, 'relationship.ended', 'relationship', p_relationship_id::text);
end;
$$;

create or replace function public.get_my_relationship()
returns table (relationship_id uuid, partner_user_id uuid, partner_display_name text, connected_at timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  select r.id, pm.user_id, p.display_name, me.joined_at
  from public.relationship_members me
  join public.relationships r on r.id = me.relationship_id and r.status = 'active'
  join public.relationship_members pm
    on pm.relationship_id = me.relationship_id and pm.user_id <> me.user_id
  join public.profiles p on p.id = pm.user_id
  where me.user_id = (select auth.uid()) and me.left_at is null
  limit 1;
$$;

-- ---------------------------------------------------------------------------
-- Triggers
-- ---------------------------------------------------------------------------

-- Deleting an account removes its member row (cascade). End the relationship so
-- the remaining partner is not stranded and shared data does not outlive it.
create or replace function public.handle_relationship_member_deleted()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.left_at is not null then return null; end if;

  update public.relationships
    set status = 'ended', ended_at = now(), ended_by = null
    where id = old.relationship_id and status = 'active';
  -- Not found: already ended, or the relationship itself is being deleted.
  if not found then return null; end if;

  update public.relationship_members
    set left_at = now()
    where relationship_id = old.relationship_id and left_at is null;
  delete from public.synastry where relationship_id = old.relationship_id;
  update public.consents
    set revoked_at = now()
    where relationship_id = old.relationship_id and revoked_at is null;

  insert into public.audit_events (actor_user_id, event_type, resource_type, resource_id, metadata)
  values (
    null, 'relationship.ended', 'relationship', old.relationship_id::text,
    jsonb_build_object('reason', 'member_deleted')
  );
  return null;
end;
$$;

create trigger relationship_members_after_delete
  after delete on public.relationship_members
  for each row execute function public.handle_relationship_member_deleted();

-- Synastry may only exist for an active relationship. The secret-key client
-- bypasses RLS but not triggers, so this closes the end-vs-recompute race.
create or replace function public.ensure_synastry_relationship_active()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1 from public.relationships r
    where r.id = new.relationship_id and r.status = 'active'
  ) then
    raise exception 'relationship_not_active';
  end if;
  return new;
end;
$$;

create trigger synastry_require_active_relationship
  before insert or update on public.synastry
  for each row execute function public.ensure_synastry_relationship_active();

-- ---------------------------------------------------------------------------
-- Function privileges
-- ---------------------------------------------------------------------------
revoke all on function public.handle_relationship_member_deleted()
  from public, anon, authenticated;
revoke all on function public.ensure_synastry_relationship_active()
  from public, anon, authenticated;
revoke all on function public.is_member(uuid) from public, anon;
revoke all on function public.is_active_member(uuid) from public, anon;
revoke all on function public.create_invite(text, text) from public, anon;
revoke all on function public.revoke_invite() from public, anon;
revoke all on function public.get_my_pending_invite() from public, anon;
revoke all on function public.get_invite_preview(text) from public;
revoke all on function public.accept_invite(text, text) from public, anon;
revoke all on function public.decline_invite(text) from public, anon;
revoke all on function public.end_relationship(uuid) from public, anon;
revoke all on function public.get_my_relationship() from public, anon;

grant execute on function public.is_member(uuid) to authenticated;
grant execute on function public.is_active_member(uuid) to authenticated;
grant execute on function public.create_invite(text, text) to authenticated;
grant execute on function public.revoke_invite() to authenticated;
grant execute on function public.get_my_pending_invite() to authenticated;
grant execute on function public.get_invite_preview(text) to anon, authenticated;
grant execute on function public.accept_invite(text, text) to authenticated;
grant execute on function public.decline_invite(text) to authenticated;
grant execute on function public.end_relationship(uuid) to authenticated;
grant execute on function public.get_my_relationship() to authenticated;
