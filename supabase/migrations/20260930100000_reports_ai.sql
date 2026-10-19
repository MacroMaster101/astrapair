-- Sprint 4: compatibility reports, AI threads and messages, usage events.
-- Reads are RLS-scoped; every write comes from the server (secret-key client)
-- after authorization and limit checks. Also fixes the Sprint 3 synastry
-- recompute race and removes derived data when a birth profile is deleted.

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------
create table public.compatibility_reports (
  relationship_id uuid primary key references public.relationships (id) on delete cascade,
  status text not null check (status in ('generating', 'ready', 'failed')),
  cache_key text check (cache_key ~ '^[0-9a-f]{64}$'),
  pending_cache_key text check (pending_cache_key ~ '^[0-9a-f]{64}$'),
  -- Per-claim nonce: only the claimant holding it may finish the generation.
  claim_id uuid,
  synastry_input_hash text check (synastry_input_hash ~ '^[0-9a-f]{64}$'),
  facts_json jsonb,
  interpretation_json jsonb,
  prompt_version text,
  model text,
  -- Deliberately not a foreign key to auth.users: the report is deleted
  -- whenever the relationship ends (including account deletion), so it never
  -- outlives the user, and no FK means no RI lock on auth.users and no
  -- deadlock with account deletion.
  generated_by uuid,
  generation_started_at timestamptz,
  completed_at timestamptz,
  -- A generating row may still hold the previous ready report.
  check (status <> 'ready' or (interpretation_json is not null and cache_key is not null)),
  check (status <> 'failed' or interpretation_json is null),
  -- Only a generating row is owned by a claim.
  check ((status = 'generating') = (claim_id is not null))
);

create table public.ai_threads (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null references auth.users (id) on delete cascade,
  relationship_id uuid references public.relationships (id) on delete cascade,
  thread_type text not null check (thread_type in ('chart', 'relationship')),
  title text not null check (char_length(title) between 1 and 80),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((thread_type = 'relationship') = (relationship_id is not null))
);
create index ai_threads_owner_updated_idx on public.ai_threads (owner_user_id, updated_at desc);
create index ai_threads_relationship_id_idx on public.ai_threads (relationship_id);

create table public.ai_messages (
  id uuid primary key default gen_random_uuid(),
  thread_id uuid not null references public.ai_threads (id) on delete cascade,
  role text not null check (role in ('user', 'assistant')),
  content text not null check (char_length(content) between 1 and 8000),
  model text,
  prompt_version text,
  input_tokens integer check (input_tokens >= 0),
  output_tokens integer check (output_tokens >= 0),
  created_at timestamptz not null default now()
);
create index ai_messages_thread_created_idx on public.ai_messages (thread_id, created_at);

create table public.ai_usage_events (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  relationship_id uuid references public.relationships (id) on delete set null,
  kind text not null check (kind in ('question', 'report')),
  model text not null,
  prompt_version text not null,
  input_tokens integer not null default 0 check (input_tokens >= 0),
  output_tokens integer not null default 0 check (output_tokens >= 0),
  -- 1 for the first model call of a question or report generation, 2 and up
  -- for retries. Daily limits count attempt 1 only, so a retry does not use up
  -- a second daily generation.
  attempt smallint not null default 1 check (attempt between 1 and 5),
  created_at timestamptz not null default now()
);
create index ai_usage_events_user_kind_idx on public.ai_usage_events (user_id, kind, created_at desc);
create index ai_usage_events_relationship_kind_idx
  on public.ai_usage_events (relationship_id, kind, created_at desc);

-- ---------------------------------------------------------------------------
-- RLS: clients read only; the server writes with the secret-key client.
-- ---------------------------------------------------------------------------
alter table public.compatibility_reports enable row level security;
alter table public.ai_threads enable row level security;
alter table public.ai_messages enable row level security;
alter table public.ai_usage_events enable row level security;

create policy "Active members can view their report"
  on public.compatibility_reports for select to authenticated
  using (public.is_active_member(compatibility_reports.relationship_id));

create policy "Owners can view their threads"
  on public.ai_threads for select to authenticated
  using (
    ai_threads.owner_user_id = (select auth.uid())
    and (ai_threads.relationship_id is null or public.is_active_member(ai_threads.relationship_id))
  );

create policy "Owners can view their messages"
  on public.ai_messages for select to authenticated
  using (exists (
    select 1 from public.ai_threads t
    where t.id = ai_messages.thread_id
      and t.owner_user_id = (select auth.uid())
      and (t.relationship_id is null or public.is_active_member(t.relationship_id))
  ));

-- ai_usage_events: intentionally no policies.

revoke all on public.compatibility_reports, public.ai_threads, public.ai_messages,
  public.ai_usage_events from anon, authenticated;
grant select on public.compatibility_reports, public.ai_threads, public.ai_messages
  to authenticated;
-- The server writes these tables with the secret key. Say so here instead of
-- relying on the project's default privileges. Inserting into the identity
-- column of ai_usage_events needs no separate grant on its sequence.
grant select, insert, update, delete
  on public.compatibility_reports, public.ai_threads, public.ai_messages,
     public.ai_usage_events
  to service_role;

-- ---------------------------------------------------------------------------
-- Derived rows may only be written for an active relationship.
--
-- The guard is an AFTER row trigger on purpose. BEFORE triggers fire ahead of
-- the unique/arbiter check, so an INSERT ... ON CONFLICT would take the
-- relationship lock first and only then wait on the derived row, the reverse
-- of end_relationship. AFTER triggers run once the derived row is written (and
-- any wait on it is over), so every writer takes derived row first, then FOR
-- SHARE on the relationship row. end_relationship deletes derived rows, updates
-- the relationship, then deletes derived rows again: the same order, so a
-- racing write either waits for it and fails, or is removed by its second
-- delete. Residual: a three-party interleave (one writer inserts a derived row
-- between end_relationship's two statements, another updates it before the
-- second delete) can still form a lock cycle. Postgres' deadlock detector
-- resolves it by aborting one transaction with 40P01, and nothing is left
-- behind; callers should treat 40P01 from end_relationship as retryable.
-- ---------------------------------------------------------------------------
create or replace function public.ensure_relationship_active_for_row()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.relationship_id is null then return null; end if;
  perform 1 from public.relationships r
    where r.id = new.relationship_id and r.status = 'active'
    for share;
  if not found then
    -- AP001 is a custom SQLSTATE so callers match on the code, not the message.
    raise exception 'relationship_not_active' using errcode = 'AP001';
  end if;
  return null;
end;
$$;

-- Replace the Sprint 3 synastry check (plain read, BEFORE) with the locking
-- AFTER version.
drop trigger synastry_require_active_relationship on public.synastry;
drop function public.ensure_synastry_relationship_active();
create trigger synastry_require_active_relationship
  after insert or update on public.synastry
  for each row execute function public.ensure_relationship_active_for_row();

create trigger compatibility_reports_require_active_relationship
  after insert or update on public.compatibility_reports
  for each row execute function public.ensure_relationship_active_for_row();

create trigger ai_threads_require_active_relationship
  after insert or update on public.ai_threads
  for each row execute function public.ensure_relationship_active_for_row();

-- ---------------------------------------------------------------------------
-- Shared clean-up of everything derived from a relationship.
-- ---------------------------------------------------------------------------
create or replace function public.delete_relationship_derived_data(p_relationship_id uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  delete from public.synastry where relationship_id = p_relationship_id;
  delete from public.compatibility_reports where relationship_id = p_relationship_id;
  delete from public.ai_threads where relationship_id = p_relationship_id;
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

  -- Before: take derived-row locks first (same order as a racing write, whose
  -- guard trigger runs after the derived row is locked).
  perform public.delete_relationship_derived_data(p_relationship_id);

  update public.relationships
    set status = 'ended', ended_at = now(), ended_by = v_uid
    where id = p_relationship_id and status = 'active';
  if not found then raise exception 'not_a_member'; end if;
  update public.relationship_members
    set left_at = now()
    where relationship_id = p_relationship_id and left_at is null;

  -- After: remove anything a racing write committed before our update.
  perform public.delete_relationship_derived_data(p_relationship_id);
  update public.consents
    set revoked_at = now()
    where relationship_id = p_relationship_id and revoked_at is null;

  insert into public.audit_events (actor_user_id, event_type, resource_type, resource_id)
  values (v_uid, 'relationship.ended', 'relationship', p_relationship_id::text);
end;
$$;

create or replace function public.handle_relationship_member_deleted()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.left_at is not null then return null; end if;

  perform public.delete_relationship_derived_data(old.relationship_id);
  update public.relationships
    set status = 'ended', ended_at = now(), ended_by = null
    where id = old.relationship_id and status = 'active';
  if not found then return null; end if;

  update public.relationship_members
    set left_at = now()
    where relationship_id = old.relationship_id and left_at is null;
  perform public.delete_relationship_derived_data(old.relationship_id);
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

-- A deleted birth profile invalidates synastry and the report of the
-- owner's active relationship (both were derived from it).
create or replace function public.handle_birth_profile_deleted()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_rel uuid;
begin
  select m.relationship_id into v_rel
  from public.relationship_members m
  where m.user_id = old.owner_user_id and m.left_at is null;
  if v_rel is not null then
    delete from public.synastry where relationship_id = v_rel;
    delete from public.compatibility_reports where relationship_id = v_rel;
  end if;
  return null;
end;
$$;

create trigger birth_profiles_after_delete
  after delete on public.birth_profiles
  for each row execute function public.handle_birth_profile_deleted();

-- ---------------------------------------------------------------------------
-- Report generation claim / finish (server only).
-- ---------------------------------------------------------------------------
create or replace function public.claim_report_generation(
  p_relationship_id uuid, p_pending_cache_key text, p_claim_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_claimed boolean;
begin
  if p_claim_id is null then raise exception 'invalid_claim'; end if;
  -- generated_by is left alone: a retained previous report stays attributed to
  -- whoever generated it. finish_report_generation sets it on success.
  insert into public.compatibility_reports as cr
    (relationship_id, status, pending_cache_key, claim_id, generation_started_at)
  values (p_relationship_id, 'generating', p_pending_cache_key, p_claim_id, now())
  on conflict (relationship_id) do update
    set status = 'generating',
        pending_cache_key = excluded.pending_cache_key,
        claim_id = excluded.claim_id,
        generation_started_at = now()
    where cr.status <> 'generating'
       -- Lease: keep in step with GENERATION_LEASE_MS in src/lib/report/service.ts.
       -- It must exceed the worst-case generation time (two model calls of up
       -- to 150 s each), or a slow generation could be taken over while it runs.
       or cr.generation_started_at < now() - interval '10 minutes'
  returning true into v_claimed;
  return coalesce(v_claimed, false);
end;
$$;

create or replace function public.finish_report_generation(
  p_relationship_id uuid, p_claim_id uuid, p_success boolean, p_report jsonb
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_success then
    update public.compatibility_reports
      set status = 'ready',
          cache_key = p_report ->> 'cache_key',
          synastry_input_hash = p_report ->> 'synastry_input_hash',
          -- A JSON null is not an SQL null: nullif keeps it from passing the
          -- "ready needs an interpretation" check.
          facts_json = nullif(p_report -> 'facts_json', 'null'::jsonb),
          interpretation_json = nullif(p_report -> 'interpretation_json', 'null'::jsonb),
          prompt_version = p_report ->> 'prompt_version',
          model = p_report ->> 'model',
          -- Keep the existing generator when the payload names none.
          generated_by = coalesce((p_report ->> 'generated_by')::uuid, generated_by),
          pending_cache_key = null,
          claim_id = null,
          completed_at = now()
      where relationship_id = p_relationship_id
        and status = 'generating'
        and claim_id = p_claim_id;
  else
    update public.compatibility_reports
      set status = case when interpretation_json is null then 'failed' else 'ready' end,
          pending_cache_key = null,
          claim_id = null
      where relationship_id = p_relationship_id
        and status = 'generating'
        and claim_id = p_claim_id;
  end if;
  return found;
end;
$$;

-- ---------------------------------------------------------------------------
-- Function privileges
-- ---------------------------------------------------------------------------
revoke all on function public.ensure_relationship_active_for_row() from public, anon, authenticated;
revoke all on function public.delete_relationship_derived_data(uuid) from public, anon, authenticated;
revoke all on function public.handle_relationship_member_deleted() from public, anon, authenticated;
revoke all on function public.handle_birth_profile_deleted() from public, anon, authenticated;
revoke all on function public.claim_report_generation(uuid, text, uuid) from public, anon, authenticated;
revoke all on function public.finish_report_generation(uuid, uuid, boolean, jsonb) from public, anon, authenticated;
grant execute on function public.claim_report_generation(uuid, text, uuid) to service_role;
grant execute on function public.finish_report_generation(uuid, uuid, boolean, jsonb) to service_role;
revoke all on function public.end_relationship(uuid) from public, anon;
grant execute on function public.end_relationship(uuid) to authenticated;
