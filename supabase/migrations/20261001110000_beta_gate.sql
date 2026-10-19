-- Sprint 5 closed-beta sign-up gate: invite codes and a "Before User Created"
-- auth hook that only lets a sign-up through with a valid code.
--
-- To turn the gate on, open the Supabase dashboard: Authentication, Hooks,
-- Before user created, choose "Postgres function" and pick
-- public.hook_before_user_created. Also set BETA_GATE=on for the app so the
-- sign-up form asks for the code.
--
-- The hook is what enforces the gate. Disabling the hook in the dashboard
-- reopens sign-ups to everyone, whatever BETA_GATE says.
--
-- Only the sha256 hex of a code is stored (scripts/ops/beta-code.mjs creates
-- the codes and prints each one once).
--
-- A code is normalised before it is hashed or compared: whitespace and hyphens
-- removed, upper-cased. The same rule is in scripts/ops/lib/beta-code-normalize.mjs
-- (used by the ops script and the sign-up action): keep the two in step.
--
-- Other ways in: with the hook on, every creation path that does not carry a
-- beta_code (OAuth, one-time-password sign-in that creates users, anonymous
-- sign-in) is rejected too. Check that auth.admin.createUser still works for
-- your tests and ops before running integration suites with the hook enabled.
--
-- The sign-up action sends the code as user metadata, so it is saved in
-- auth.users and appears in the new user's first token. The action clears it
-- right after sign-up, but that is best effort: keep multi-use codes
-- short-lived and disable them once the cohort has joined.
--
-- A use is counted when the hook accepts the sign-up. If sign-up then fails (for
-- example the confirmation email cannot be sent) that use stays counted.

-- ---------------------------------------------------------------------------
-- Invite codes. Written and read only by the ops script (secret key).
-- ---------------------------------------------------------------------------
create table public.beta_invite_codes (
  code_hash text primary key check (code_hash ~ '^[0-9a-f]{64}$'),
  label text not null,
  max_uses integer not null default 1 check (max_uses > 0),
  uses integer not null default 0 check (uses >= 0 and uses <= max_uses),
  created_at timestamptz not null default now(),
  disabled_at timestamptz
);

alter table public.beta_invite_codes enable row level security;
-- Intentionally no policies. supabase_auth_admin gets nothing on the table:
-- the hook below is security definer and reads it as its owner.
revoke all on public.beta_invite_codes from anon, authenticated;
grant select, insert, update on public.beta_invite_codes to service_role;

-- ---------------------------------------------------------------------------
-- Before User Created hook. Receives {user: {..., user_metadata}, metadata}.
-- Returns {} to allow the sign-up, or an error object to reject it with 403.
--
-- It never raises for bad input (an exception would be a 500 for every
-- sign-up): a missing, empty, non-string or over-long code is rejected with
-- the same message as an unknown or used up one.
--
-- The single update decides success, so two sign-ups racing for the last use
-- of a code cannot both win: the second waits for the row lock, re-checks
-- uses < max_uses and updates nothing.
-- ---------------------------------------------------------------------------
create or replace function public.hook_before_user_created(event jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_rejection constant jsonb := jsonb_build_object(
    'error',
    jsonb_build_object('message', 'beta_code_invalid', 'http_code', 403)
  );
  v_code text;
begin
  if jsonb_typeof(event -> 'user' -> 'user_metadata' -> 'beta_code') is distinct from 'string' then
    return v_rejection;
  end if;

  v_code := event -> 'user' -> 'user_metadata' ->> 'beta_code';
  -- The length limit applies to what was sent, before normalising.
  if length(v_code) = 0 or length(v_code) > 64 then
    return v_rejection;
  end if;

  v_code := upper(regexp_replace(v_code, '[ \t\n\r\f\v-]', '', 'g'));
  if v_code = '' then
    return v_rejection;
  end if;

  update public.beta_invite_codes
  set uses = uses + 1
  where code_hash = encode(sha256(convert_to(v_code, 'utf8')), 'hex')
    and disabled_at is null
    and uses < max_uses;

  if not found then
    return v_rejection;
  end if;

  return '{}'::jsonb;
end;
$$;

revoke all on function public.hook_before_user_created(jsonb) from public, anon, authenticated;
grant usage on schema public to supabase_auth_admin;
grant execute on function public.hook_before_user_created(jsonb) to supabase_auth_admin;
-- service_role may call it so the integration tests can exercise it directly.
grant execute on function public.hook_before_user_created(jsonb) to service_role;

-- ---------------------------------------------------------------------------
-- Read-only check used by the sign-up action before it calls the auth server,
-- so a wrong code is refused without telling anyone whether an email is already
-- registered. Normalises like the hook, never consumes a use, never raises.
-- The hook above stays the enforcement point.
-- ---------------------------------------------------------------------------
create or replace function public.check_beta_code(p_code text)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_code text;
begin
  if p_code is null or length(p_code) = 0 or length(p_code) > 64 then
    return false;
  end if;

  v_code := upper(regexp_replace(p_code, '[ \t\n\r\f\v-]', '', 'g'));
  if v_code = '' then
    return false;
  end if;

  return exists (
    select 1
    from public.beta_invite_codes
    where code_hash = encode(sha256(convert_to(v_code, 'utf8')), 'hex')
      and disabled_at is null
      and uses < max_uses
  );
end;
$$;

revoke all on function public.check_beta_code(text) from public, anon, authenticated;
grant execute on function public.check_beta_code(text) to service_role;
