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
