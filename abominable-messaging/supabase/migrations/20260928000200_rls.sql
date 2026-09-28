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
