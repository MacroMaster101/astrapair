-- Sprint 5 hardening: analytics events, orphan cleanup, RLS audit, audit retention.

-- ---------------------------------------------------------------------------
-- Analytics: pseudonymous funnel events, written only by the server.
-- user_ref is HMAC(user_id, ANALYTICS_SALT); it cannot be tied back to a
-- person once the account is deleted. No payload column on purpose.
-- ---------------------------------------------------------------------------
create table public.analytics_events (
  id bigint generated always as identity primary key,
  event text not null check (event in (
    'registration', 'birth_profile_completed', 'chart_generated',
    'partner_invited', 'partner_connected', 'report_generated',
    'ai_question_asked', 'account_deleted'
  )),
  user_ref text not null check (user_ref ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default now()
);
create index analytics_events_event_created_idx on public.analytics_events (event, created_at desc);
create index analytics_events_user_ref_idx on public.analytics_events (user_ref);

alter table public.analytics_events enable row level security;
-- Intentionally no policies.
revoke all on public.analytics_events from anon, authenticated;
grant select, insert, delete on public.analytics_events to service_role;
-- The server writes the account-deletion audit row with the secret key, and
-- afterwards replaces the deleted account's id in resource_id of the user-type
-- rows (sign-up and onboarding) with the salted reference, so no row can be
-- traced back to the person. That is the update grant.
-- Retention deletes go through purge_old_audit_events, not direct deletes by
-- the application; delete is granted for maintenance and test clean-up.
grant select, insert, update, delete on public.audit_events to service_role;

-- ---------------------------------------------------------------------------
-- A relationship with no member rows left (both people deleted their
-- accounts) is removed, together with everything that cascades from it.
-- ---------------------------------------------------------------------------
create or replace function public.cleanup_orphan_relationship()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Lock the relationship row first. Without it, two members deleted in
  -- overlapping transactions each still see the other's member row (not yet
  -- committed as deleted), both skip the delete, and the relationship is left
  -- behind with no members (write skew). With the lock the second transaction
  -- waits, then re-runs the check below on a fresh snapshot.
  perform 1 from public.relationships r where r.id = old.relationship_id for update;

  delete from public.relationships r
  where r.id = old.relationship_id
    and not exists (
      select 1 from public.relationship_members m where m.relationship_id = r.id
    );
  return null;
end;
$$;

create trigger relationship_members_cleanup_orphans
  after delete on public.relationship_members
  for each row execute function public.cleanup_orphan_relationship();

-- ---------------------------------------------------------------------------
-- RLS audit: names of public tables that do not have RLS enabled.
-- ---------------------------------------------------------------------------
create or replace function public.rls_audit()
returns setof text
language sql
stable
security definer
set search_path = ''
as $$
  select c.relname::text
  from pg_catalog.pg_class c
  join pg_catalog.pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public'
    and c.relkind in ('r', 'p')
    and not c.relrowsecurity
  order by c.relname;
$$;

-- ---------------------------------------------------------------------------
-- Audit retention: remove events older than the given interval.
--
-- The same maintenance also repairs a failed account-deletion scrub: the app
-- replaces the deleted account's id in resource_id of user-type rows
-- (sign-up and onboarding) right after the deletion, and this clears any id
-- that is still there (resource_id looks like a uuid and no account has it).
-- The return value is the number of old rows deleted.
-- ---------------------------------------------------------------------------
create or replace function public.purge_old_audit_events(p_older_than interval)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count bigint;
begin
  if p_older_than is null or p_older_than < interval '30 days' then
    raise exception 'retention_too_short';
  end if;
  with deleted as (
    delete from public.audit_events where created_at < now() - p_older_than returning 1
  )
  select count(*) into v_count from deleted;

  update public.audit_events a
  set resource_id = null
  where a.resource_type = 'user'
    and a.resource_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    and not exists (select 1 from auth.users u where u.id::text = lower(a.resource_id));

  return v_count;
end;
$$;

revoke all on function public.cleanup_orphan_relationship() from public, anon, authenticated;
revoke all on function public.rls_audit() from public, anon, authenticated;
revoke all on function public.purge_old_audit_events(interval) from public, anon, authenticated;
grant execute on function public.rls_audit() to service_role;
grant execute on function public.purge_old_audit_events(interval) to service_role;
