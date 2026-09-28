-- =====================================================================
-- ABOMINABLE MESSAGING — INSTALACIÓN COMPLETA EN UN SOLO PASO
--
-- Este archivo es la concatenación, EN ORDEN, de las cuatro migraciones
-- de supabase/migrations/. Existe para que la instalación inicial sea
-- un solo copy-paste en el SQL Editor de Supabase.
--
-- CÓMO USARLO
--   1. Supabase Dashboard -> SQL Editor -> New query
--   2. Pega TODO este archivo
--   3. Run
--   4. Debe terminar con "Success. No rows returned"
--
-- Es seguro ejecutarlo más de una vez: sólo crea, nunca borra.
-- No contiene ningún DROP TABLE ni DELETE.
--
-- Para cambios POSTERIORES usa los archivos numerados de
-- supabase/migrations/, no este. Este es sólo para arrancar.
-- =====================================================================



-- ####################################################################
-- ## 20260928000100_init_core.sql
-- ####################################################################

-- =====================================================================
-- ABOMINABLE MESSAGING — 0001 core schema
-- Organizations, membership, contacts, messages, events.
--
-- Design notes:
--  * organization_id exists from day one on every tenant table so that
--    multi-tenant / white-label can be switched on later WITHOUT a
--    painful data migration. Full multi-tenant UX is NOT built yet.
--  * All timestamps are timestamptz and always stored in UTC.
--    The UI converts to the user's display timezone (default America/Cancun).
-- =====================================================================

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------
do $$ begin
  create type message_status as enum (
    'draft',
    'scheduled',
    'processing',
    'sent',
    'delivered',
    'read',
    'failed',
    'cancelled'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type message_kind as enum ('text', 'template');
exception when duplicate_object then null; end $$;

do $$ begin
  create type org_role as enum ('owner', 'admin', 'member');
exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------------
-- Organizations + membership
-- ---------------------------------------------------------------------
create table if not exists public.organizations (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  slug        text not null unique,
  timezone    text not null default 'America/Cancun',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create table if not exists public.organization_members (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id         uuid not null references auth.users(id) on delete cascade,
  role            org_role not null default 'member',
  created_at      timestamptz not null default now(),
  primary key (organization_id, user_id)
);

create index if not exists organization_members_user_idx
  on public.organization_members (user_id);

-- ---------------------------------------------------------------------
-- Contacts
-- ---------------------------------------------------------------------
create table if not exists public.contacts (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name            text not null,
  phone           text not null,          -- E.164, e.g. +529981234567
  email           text,
  company         text,
  tags            text[] not null default '{}',
  notes           text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint contacts_phone_e164 check (phone ~ '^\+[1-9]\d{7,14}$')
);

-- One contact per phone number per organization.
create unique index if not exists contacts_org_phone_key
  on public.contacts (organization_id, phone);

create index if not exists contacts_org_created_idx
  on public.contacts (organization_id, created_at desc);

-- ---------------------------------------------------------------------
-- Messages
-- ---------------------------------------------------------------------
create table if not exists public.messages (
  id                  uuid primary key default gen_random_uuid(),
  organization_id     uuid not null references public.organizations(id) on delete cascade,
  contact_id          uuid references public.contacts(id) on delete set null,

  phone               text not null,
  body                text,
  message_type        message_kind not null default 'text',

  -- WhatsApp template messages (architecture only in the MVP).
  template_name       text,
  template_language   text,
  template_variables  jsonb not null default '{}'::jsonb,

  scheduled_at        timestamptz,         -- UTC; null when "send now"
  timezone            text not null default 'America/Cancun',

  status              message_status not null default 'draft',

  provider            text not null default 'whatsapp_cloud',
  provider_message_id text,

  -- Lifecycle timestamps
  processing_at       timestamptz,
  sent_at             timestamptz,
  delivered_at        timestamptz,
  read_at             timestamptz,
  failed_at           timestamptz,
  cancelled_at        timestamptz,

  -- Error handling / retries
  error_code          text,
  error_message       text,
  attempt_count       int  not null default 0,
  max_attempts        int  not null default 3,
  last_attempt_at     timestamptz,

  -- Idempotency / claim bookkeeping
  claim_token         uuid,
  claimed_at          timestamptz,
  idempotency_key     text,

  created_by          uuid references auth.users(id) on delete set null,
  metadata            jsonb not null default '{}'::jsonb,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),

  constraint messages_phone_e164 check (phone ~ '^\+[1-9]\d{7,14}$'),
  constraint messages_scheduled_needs_time
    check (status <> 'scheduled' or scheduled_at is not null),
  constraint messages_text_needs_body
    check (message_type <> 'text' or (body is not null and length(btrim(body)) > 0)),
  constraint messages_template_needs_name
    check (message_type <> 'template' or (template_name is not null and template_language is not null))
);

-- The scheduler hot path: "give me scheduled messages that are due".
create index if not exists messages_due_idx
  on public.messages (scheduled_at)
  where status = 'scheduled';

create index if not exists messages_org_status_idx
  on public.messages (organization_id, status, created_at desc);

create index if not exists messages_org_created_idx
  on public.messages (organization_id, created_at desc);

-- Webhook lookups resolve a message by the provider's id.
create index if not exists messages_provider_message_id_idx
  on public.messages (provider_message_id)
  where provider_message_id is not null;

-- Second line of defence against double-sending: an idempotency key can
-- only ever belong to one message within an organization.
create unique index if not exists messages_org_idempotency_key
  on public.messages (organization_id, idempotency_key)
  where idempotency_key is not null;

-- ---------------------------------------------------------------------
-- Audit trail
-- ---------------------------------------------------------------------
create table if not exists public.message_events (
  id              bigint generated always as identity primary key,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  message_id      uuid references public.messages(id) on delete cascade,
  event_type      text not null,          -- message_created, message_sent, ...
  actor           text not null default 'system',  -- user | n8n | webhook | system
  actor_user_id   uuid references auth.users(id) on delete set null,
  payload         jsonb not null default '{}'::jsonb,
  created_at      timestamptz not null default now()
);

create index if not exists message_events_message_idx
  on public.message_events (message_id, created_at desc);

create index if not exists message_events_org_idx
  on public.message_events (organization_id, created_at desc);

-- ---------------------------------------------------------------------
-- updated_at triggers
-- ---------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists organizations_set_updated_at on public.organizations;
create trigger organizations_set_updated_at
  before update on public.organizations
  for each row execute function public.set_updated_at();

drop trigger if exists contacts_set_updated_at on public.contacts;
create trigger contacts_set_updated_at
  before update on public.contacts
  for each row execute function public.set_updated_at();

drop trigger if exists messages_set_updated_at on public.messages;
create trigger messages_set_updated_at
  before update on public.messages
  for each row execute function public.set_updated_at();


-- ####################################################################
-- ## 20260928000200_rls.sql
-- ####################################################################

-- =====================================================================
-- ABOMINABLE MESSAGING — 0002 Row Level Security
--
-- Every tenant table is gated by organization membership. Today there is
-- a single admin user in a single organization, but the policies are
-- already written against organization_members so that teams, clients
-- and white-label tenants only require inserting rows, not rewriting
-- security.
--
-- The service-role key bypasses RLS entirely. It is used ONLY by
-- server-side code (Route Handlers) and is never shipped to the browser.
-- =====================================================================

-- Membership lookup used inside policies. SECURITY DEFINER so that the
-- policy on organization_members itself does not recurse into its own
-- policy while evaluating.
create or replace function public.is_org_member(p_org uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.organization_members m
    where m.organization_id = p_org
      and m.user_id = auth.uid()
  );
$$;

create or replace function public.has_org_role(p_org uuid, p_roles org_role[])
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.organization_members m
    where m.organization_id = p_org
      and m.user_id = auth.uid()
      and m.role = any(p_roles)
  );
$$;

revoke all on function public.is_org_member(uuid) from public;
revoke all on function public.has_org_role(uuid, org_role[]) from public;
grant execute on function public.is_org_member(uuid) to authenticated;
grant execute on function public.has_org_role(uuid, org_role[]) to authenticated;

-- ---------------------------------------------------------------------
alter table public.organizations        enable row level security;
alter table public.organization_members enable row level security;
alter table public.contacts             enable row level security;
alter table public.messages             enable row level security;
alter table public.message_events       enable row level security;

-- Deny-by-default: no policy for the anon role anywhere below, so an
-- unauthenticated client sees nothing at all.

-- organizations -------------------------------------------------------
drop policy if exists organizations_select on public.organizations;
create policy organizations_select on public.organizations
  for select to authenticated
  using (public.is_org_member(id));

drop policy if exists organizations_update on public.organizations;
create policy organizations_update on public.organizations
  for update to authenticated
  using (public.has_org_role(id, array['owner','admin']::org_role[]))
  with check (public.has_org_role(id, array['owner','admin']::org_role[]));

-- organization_members ------------------------------------------------
drop policy if exists organization_members_select on public.organization_members;
create policy organization_members_select on public.organization_members
  for select to authenticated
  using (user_id = auth.uid() or public.is_org_member(organization_id));

drop policy if exists organization_members_write on public.organization_members;
create policy organization_members_write on public.organization_members
  for all to authenticated
  using (public.has_org_role(organization_id, array['owner','admin']::org_role[]))
  with check (public.has_org_role(organization_id, array['owner','admin']::org_role[]));

-- contacts ------------------------------------------------------------
drop policy if exists contacts_select on public.contacts;
create policy contacts_select on public.contacts
  for select to authenticated
  using (public.is_org_member(organization_id));

drop policy if exists contacts_insert on public.contacts;
create policy contacts_insert on public.contacts
  for insert to authenticated
  with check (public.is_org_member(organization_id));

drop policy if exists contacts_update on public.contacts;
create policy contacts_update on public.contacts
  for update to authenticated
  using (public.is_org_member(organization_id))
  with check (public.is_org_member(organization_id));

drop policy if exists contacts_delete on public.contacts;
create policy contacts_delete on public.contacts
  for delete to authenticated
  using (public.is_org_member(organization_id));

-- messages ------------------------------------------------------------
drop policy if exists messages_select on public.messages;
create policy messages_select on public.messages
  for select to authenticated
  using (public.is_org_member(organization_id));

drop policy if exists messages_insert on public.messages;
create policy messages_insert on public.messages
  for insert to authenticated
  with check (public.is_org_member(organization_id));

-- A signed-in user may edit a message only while it has not left our
-- hands. Once it is processing/sent/delivered/read the row is owned by
-- the delivery pipeline and is only writable through the service role.
drop policy if exists messages_update on public.messages;
create policy messages_update on public.messages
  for update to authenticated
  using (
    public.is_org_member(organization_id)
    and status in ('draft', 'scheduled', 'failed', 'cancelled')
  )
  with check (
    public.is_org_member(organization_id)
    and status in ('draft', 'scheduled', 'failed', 'cancelled')
  );

drop policy if exists messages_delete on public.messages;
create policy messages_delete on public.messages
  for delete to authenticated
  using (
    public.is_org_member(organization_id)
    and status in ('draft', 'cancelled', 'failed')
  );

-- message_events ------------------------------------------------------
-- Read-only for users: the audit trail is written server side only.
drop policy if exists message_events_select on public.message_events;
create policy message_events_select on public.message_events
  for select to authenticated
  using (public.is_org_member(organization_id));


-- ####################################################################
-- ## 20260928000300_scheduler_rpc.sql
-- ####################################################################

-- =====================================================================
-- ABOMINABLE MESSAGING — 0003 scheduler RPCs (idempotency core)
--
-- WHY THESE LIVE IN POSTGRES
-- --------------------------
-- "Do not send the same message twice" is a concurrency problem, and the
-- only place it can be solved without a race is inside a single database
-- transaction. Application code that does SELECT-then-UPDATE can always
-- be beaten by a second n8n worker between the two statements.
--
-- claim_due_messages() performs the state transition
--        scheduled -> processing
-- in ONE atomic UPDATE using FOR UPDATE SKIP LOCKED, and returns only
-- the rows it actually won. A second concurrent execution of the n8n
-- workflow skips those locked rows and receives an empty set, so it
-- sends nothing.
--
-- Each claimed row also receives a fresh claim_token. Every later
-- transition (processing -> sent / failed) must present that token, so a
-- stale or replayed worker cannot overwrite the outcome of a newer
-- attempt.
--
-- All of these are SECURITY DEFINER and executable by service_role only.
-- They are reachable from the outside exclusively through our own
-- /api/n8n/* route handlers, which require the N8N_API_SECRET bearer.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Internal: append to the audit trail.
-- ---------------------------------------------------------------------
create or replace function public.log_message_event(
  p_message_id uuid,
  p_event_type text,
  p_actor      text default 'system',
  p_payload    jsonb default '{}'::jsonb
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_org uuid;
begin
  select organization_id into v_org from public.messages where id = p_message_id;
  if v_org is null then
    return;
  end if;

  insert into public.message_events (organization_id, message_id, event_type, actor, payload)
  values (v_org, p_message_id, p_event_type, p_actor, coalesce(p_payload, '{}'::jsonb));
end;
$$;

-- ---------------------------------------------------------------------
-- Atomically claim messages that are due.
--   scheduled -> processing
-- Returns one row per message actually won by THIS caller.
-- ---------------------------------------------------------------------
create or replace function public.claim_due_messages(
  p_limit  int  default 25,
  p_worker text default 'n8n'
)
returns table (
  id                 uuid,
  organization_id    uuid,
  contact_id         uuid,
  phone              text,
  body               text,
  message_type       message_kind,
  template_name      text,
  template_language  text,
  template_variables jsonb,
  claim_token        uuid,
  attempt_count      int,
  max_attempts       int,
  scheduled_at       timestamptz
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_limit int  := greatest(1, least(coalesce(p_limit, 25), 200));
  v_batch uuid := gen_random_uuid();
begin
  return query
  with due as (
    select m.id
    from public.messages m
    where m.status = 'scheduled'
      and m.scheduled_at is not null
      and m.scheduled_at <= now()
      and m.attempt_count < m.max_attempts
    order by m.scheduled_at asc
    limit v_limit
    for update skip locked      -- the whole point: concurrent workers do not collide
  ),
  claimed as (
    update public.messages m
       set status          = 'processing',
           processing_at   = now(),
           claimed_at      = now(),
           claim_token     = gen_random_uuid(),
           attempt_count   = m.attempt_count + 1,
           last_attempt_at = now(),
           metadata        = m.metadata || jsonb_build_object(
                               'claimed_by',  p_worker,
                               'claim_batch', v_batch
                             )
      from due
     where m.id = due.id
    returning
      m.id, m.organization_id, m.contact_id, m.phone, m.body, m.message_type,
      m.template_name, m.template_language, m.template_variables,
      m.claim_token, m.attempt_count, m.max_attempts, m.scheduled_at
  ),
  audited as (
    insert into public.message_events (organization_id, message_id, event_type, actor, payload)
    select c.organization_id, c.id, 'message_processing', p_worker,
           jsonb_build_object('attempt', c.attempt_count, 'claim_batch', v_batch)
    from claimed c
    returning 1
  )
  select c.id, c.organization_id, c.contact_id, c.phone, c.body, c.message_type,
         c.template_name, c.template_language, c.template_variables,
         c.claim_token, c.attempt_count, c.max_attempts, c.scheduled_at
  from claimed c;
end;
$$;

-- ---------------------------------------------------------------------
-- processing -> sent. Requires the matching claim token.
-- Returns true when this call performed the transition.
-- ---------------------------------------------------------------------
create or replace function public.mark_message_sent(
  p_message_id          uuid,
  p_claim_token         uuid,
  p_provider_message_id text,
  p_actor               text default 'n8n'
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_updated int;
begin
  update public.messages
     set status              = 'sent',
         sent_at             = now(),
         provider_message_id = coalesce(p_provider_message_id, provider_message_id),
         error_code          = null,
         error_message       = null,
         claim_token         = null
   where id = p_message_id
     and status = 'processing'
     and claim_token = p_claim_token;

  get diagnostics v_updated = row_count;

  if v_updated > 0 then
    perform public.log_message_event(
      p_message_id, 'message_sent', p_actor,
      jsonb_build_object('provider_message_id', p_provider_message_id)
    );
  end if;

  return v_updated > 0;
end;
$$;

-- ---------------------------------------------------------------------
-- processing -> failed, or back to scheduled for a bounded retry.
-- Retries use exponential backoff: 1, 2, 4 ... minutes, capped at 30.
-- ---------------------------------------------------------------------
create or replace function public.mark_message_failed(
  p_message_id    uuid,
  p_claim_token   uuid,
  p_error_code    text,
  p_error_message text,
  p_retryable     boolean default true,
  p_actor         text default 'n8n'
)
returns table (final_status message_status, will_retry boolean)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_msg     public.messages%rowtype;
  v_retry   boolean;
  v_backoff interval;
begin
  select * into v_msg
  from public.messages
  where id = p_message_id
    and status = 'processing'
    and claim_token = p_claim_token
  for update;

  if not found then
    -- Nothing to do: wrong token, or another worker already resolved it.
    return query select null::message_status, false;
    return;
  end if;

  v_retry := p_retryable and v_msg.attempt_count < v_msg.max_attempts;

  if v_retry then
    v_backoff := make_interval(
      mins => least(30, power(2, greatest(v_msg.attempt_count - 1, 0))::int)
    );

    update public.messages
       set status        = 'scheduled',
           scheduled_at  = now() + v_backoff,
           processing_at = null,
           claim_token   = null,
           claimed_at    = null,
           error_code    = p_error_code,
           error_message = p_error_message
     where id = p_message_id;

    perform public.log_message_event(
      p_message_id, 'message_retry_scheduled', p_actor,
      jsonb_build_object(
        'error_code', p_error_code,
        'error_message', p_error_message,
        'attempt', v_msg.attempt_count,
        'retry_in_minutes', extract(epoch from v_backoff) / 60
      )
    );

    return query select 'scheduled'::message_status, true;
  else
    update public.messages
       set status        = 'failed',
           failed_at     = now(),
           claim_token   = null,
           error_code    = p_error_code,
           error_message = p_error_message
     where id = p_message_id;

    perform public.log_message_event(
      p_message_id, 'message_failed', p_actor,
      jsonb_build_object(
        'error_code', p_error_code,
        'error_message', p_error_message,
        'attempt', v_msg.attempt_count
      )
    );

    return query select 'failed'::message_status, false;
  end if;
end;
$$;

-- ---------------------------------------------------------------------
-- Safety net: a worker that dies mid-send leaves a row stuck in
-- 'processing' forever. Release those back to 'scheduled' once they are
-- older than p_stale_minutes, as long as attempts remain.
-- ---------------------------------------------------------------------
create or replace function public.release_stuck_messages(
  p_stale_minutes int default 15
)
returns int
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_count int;
begin
  with stuck as (
    update public.messages
       set status       = case
                            when attempt_count < max_attempts then 'scheduled'::message_status
                            else 'failed'::message_status
                          end,
           scheduled_at = case
                            when attempt_count < max_attempts then now()
                            else scheduled_at
                          end,
           failed_at    = case
                            when attempt_count >= max_attempts then now()
                            else failed_at
                          end,
           error_code    = coalesce(error_code, 'worker_timeout'),
           error_message = coalesce(error_message, 'Claim expired before the worker reported an outcome'),
           processing_at = null,
           claim_token   = null,
           claimed_at    = null
     where status = 'processing'
       and claimed_at < now() - make_interval(mins => greatest(1, p_stale_minutes))
    returning id, organization_id, status
  )
  insert into public.message_events (organization_id, message_id, event_type, actor, payload)
  select organization_id, id, 'message_claim_released', 'system',
         jsonb_build_object('new_status', status)
  from stuck;

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

-- ---------------------------------------------------------------------
-- Webhook status ingestion.
--
-- WhatsApp delivers status callbacks out of order and more than once.
-- We rank the delivery states and only ever move forward, so a late
-- "delivered" can never clobber a "read" that already arrived.
-- ---------------------------------------------------------------------
create or replace function public.message_status_rank(p_status message_status)
returns int
language sql
immutable
as $$
  select case p_status
    when 'draft'      then 0
    when 'scheduled'  then 1
    when 'processing' then 2
    when 'sent'       then 3
    when 'delivered'  then 4
    when 'read'       then 5
    when 'failed'     then 6
    when 'cancelled'  then 7
  end;
$$;

create or replace function public.apply_provider_status(
  p_provider_message_id text,
  p_status              text,
  p_occurred_at         timestamptz default now(),
  p_error_code          text default null,
  p_error_message       text default null,
  p_raw                 jsonb default '{}'::jsonb
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_msg     public.messages%rowtype;
  v_new     message_status;
  v_updated int;
begin
  if p_provider_message_id is null then
    return false;
  end if;

  v_new := case lower(p_status)
             when 'sent'      then 'sent'
             when 'delivered' then 'delivered'
             when 'read'      then 'read'
             when 'failed'    then 'failed'
             else null
           end::message_status;

  if v_new is null then
    return false;
  end if;

  select * into v_msg
  from public.messages
  where provider_message_id = p_provider_message_id
  for update;

  if not found then
    return false;
  end if;

  -- Monotonic: never regress, never re-apply the same state.
  if v_new <> 'failed'
     and public.message_status_rank(v_new) <= public.message_status_rank(v_msg.status) then
    return false;
  end if;

  if v_new = 'failed' and v_msg.status = 'failed' then
    return false;
  end if;

  update public.messages
     set status        = v_new,
         sent_at       = case when v_new = 'sent'      then coalesce(sent_at, p_occurred_at)      else sent_at end,
         delivered_at  = case when v_new = 'delivered' then coalesce(delivered_at, p_occurred_at) else delivered_at end,
         read_at       = case when v_new = 'read'      then coalesce(read_at, p_occurred_at)      else read_at end,
         failed_at     = case when v_new = 'failed'    then coalesce(failed_at, p_occurred_at)    else failed_at end,
         error_code    = case when v_new = 'failed'    then p_error_code    else error_code end,
         error_message = case when v_new = 'failed'    then p_error_message else error_message end,
         metadata      = metadata || jsonb_build_object('last_webhook', p_raw)
   where id = v_msg.id;

  get diagnostics v_updated = row_count;

  if v_updated > 0 then
    perform public.log_message_event(
      v_msg.id, 'message_' || v_new::text, 'webhook',
      jsonb_build_object('occurred_at', p_occurred_at, 'error_code', p_error_code)
    );
  end if;

  return v_updated > 0;
end;
$$;

-- ---------------------------------------------------------------------
-- Claim ONE specific message by id.
--
-- Used by the "Enviar ahora" path. A send-now message is inserted as
-- 'scheduled' with scheduled_at = now(), then claimed here, so the
-- immediate path and the n8n path share the exact same state machine and
-- the exact same double-send protection: whichever of the two gets the
-- row first wins, and the loser receives null.
-- ---------------------------------------------------------------------
create or replace function public.claim_message_by_id(
  p_message_id uuid,
  p_worker     text default 'app'
)
returns table (
  id                 uuid,
  organization_id    uuid,
  phone              text,
  body               text,
  message_type       message_kind,
  template_name      text,
  template_language  text,
  template_variables jsonb,
  claim_token        uuid,
  attempt_count      int,
  max_attempts       int
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  return query
  with target as (
    select m.id
    from public.messages m
    where m.id = p_message_id
      and m.status = 'scheduled'
      and m.attempt_count < m.max_attempts
    for update skip locked
  ),
  claimed as (
    update public.messages m
       set status          = 'processing',
           processing_at   = now(),
           claimed_at      = now(),
           claim_token     = gen_random_uuid(),
           attempt_count   = m.attempt_count + 1,
           last_attempt_at = now(),
           metadata        = m.metadata || jsonb_build_object('claimed_by', p_worker)
      from target
     where m.id = target.id
    returning m.id, m.organization_id, m.phone, m.body, m.message_type,
              m.template_name, m.template_language, m.template_variables,
              m.claim_token, m.attempt_count, m.max_attempts
  ),
  audited as (
    insert into public.message_events (organization_id, message_id, event_type, actor, payload)
    select c.organization_id, c.id, 'message_processing', p_worker,
           jsonb_build_object('attempt', c.attempt_count)
    from claimed c
    returning 1
  )
  select c.id, c.organization_id, c.phone, c.body, c.message_type,
         c.template_name, c.template_language, c.template_variables,
         c.claim_token, c.attempt_count, c.max_attempts
  from claimed c;
end;
$$;

-- ---------------------------------------------------------------------
-- Grants: these are pipeline-internal. Browser roles must not call them.
-- ---------------------------------------------------------------------
revoke all on function public.log_message_event(uuid, text, text, jsonb) from public;
revoke all on function public.claim_due_messages(int, text) from public;
revoke all on function public.mark_message_sent(uuid, uuid, text, text) from public;
revoke all on function public.mark_message_failed(uuid, uuid, text, text, boolean, text) from public;
revoke all on function public.claim_message_by_id(uuid, text) from public;
revoke all on function public.release_stuck_messages(int) from public;
revoke all on function public.apply_provider_status(text, text, timestamptz, text, text, jsonb) from public;

grant execute on function public.log_message_event(uuid, text, text, jsonb) to service_role;
grant execute on function public.claim_due_messages(int, text) to service_role;
grant execute on function public.mark_message_sent(uuid, uuid, text, text) to service_role;
grant execute on function public.mark_message_failed(uuid, uuid, text, text, boolean, text) to service_role;
grant execute on function public.claim_message_by_id(uuid, text) to service_role;
grant execute on function public.release_stuck_messages(int) to service_role;
grant execute on function public.apply_provider_status(text, text, timestamptz, text, text, jsonb) to service_role;


-- ####################################################################
-- ## 20260928000400_bootstrap.sql
-- ####################################################################

-- =====================================================================
-- ABOMINABLE MESSAGING — 0004 onboarding bootstrap
--
-- The MVP has a single administrator, but we never want an account that
-- exists without an organization: every tenant row hangs off one. On
-- first sign-in the app calls bootstrap_organization(), which is
-- idempotent — a user who already belongs to an organization simply gets
-- that organization's id back.
-- =====================================================================

create or replace function public.bootstrap_organization(
  p_name     text default 'Abominable',
  p_timezone text default 'America/Cancun'
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid  uuid := auth.uid();
  v_org  uuid;
  v_slug text;
begin
  if v_uid is null then
    raise exception 'bootstrap_organization requires an authenticated user'
      using errcode = '28000';
  end if;

  -- Already a member of something? Return the oldest membership.
  select m.organization_id into v_org
  from public.organization_members m
  where m.user_id = v_uid
  order by m.created_at asc
  limit 1;

  if v_org is not null then
    return v_org;
  end if;

  -- Derive a slug that is unique without guessing.
  v_slug := regexp_replace(lower(coalesce(nullif(btrim(p_name), ''), 'abominable')),
                           '[^a-z0-9]+', '-', 'g');
  v_slug := btrim(v_slug, '-');
  if v_slug = '' then
    v_slug := 'org';
  end if;
  v_slug := v_slug || '-' || substr(replace(v_uid::text, '-', ''), 1, 8);

  insert into public.organizations (name, slug, timezone)
  values (coalesce(nullif(btrim(p_name), ''), 'Abominable'), v_slug,
          coalesce(nullif(btrim(p_timezone), ''), 'America/Cancun'))
  returning id into v_org;

  insert into public.organization_members (organization_id, user_id, role)
  values (v_org, v_uid, 'owner');

  return v_org;
end;
$$;

revoke all on function public.bootstrap_organization(text, text) from public;
grant execute on function public.bootstrap_organization(text, text) to authenticated;
grant execute on function public.bootstrap_organization(text, text) to service_role;


-- =====================================================================
-- COMPROBACIÓN
-- Ejecuta esto en una query aparte. Deben salir 5 tablas, todas con
-- rowsecurity = true, y 8 funciones.
-- =====================================================================
-- select tablename, rowsecurity from pg_tables
--   where schemaname = 'public' order by tablename;
--
-- select proname from pg_proc p
--   join pg_namespace n on n.oid = p.pronamespace
--   where n.nspname = 'public' and proname in (
--     'claim_due_messages','claim_message_by_id','mark_message_sent',
--     'mark_message_failed','release_stuck_messages',
--     'apply_provider_status','bootstrap_organization','log_message_event')
--   order by proname;
