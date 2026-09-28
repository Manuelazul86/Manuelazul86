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
