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
