import "server-only";

import { redirect } from "next/navigation";

import { createServerSupabase } from "@/lib/supabase/server";
import { DEFAULT_TIMEZONE } from "@/lib/constants";
import type { Organization } from "@/types/database";

export interface SessionContext {
  userId: string;
  email: string;
  organization: Organization;
}

/**
 * Resolve the signed-in user and their organization, creating the
 * organization on first sign-in.
 *
 * Every Server Component and internal Route Handler goes through this,
 * so no page can accidentally render without a tenant scope.
 */
export async function getSessionContext(): Promise<SessionContext | null> {
  const supabase = await createServerSupabase();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return null;

  const { data: membership } = await supabase
    .from("organization_members")
    .select("organization_id, organizations(*)")
    .eq("user_id", user.id)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  let organization = (membership?.organizations ??
    null) as Organization | null;

  if (!organization) {
    // First sign-in: create the organization. The RPC is idempotent, so
    // two tabs racing here still produce exactly one organization.
    const { data: orgId, error } = await supabase.rpc(
      "bootstrap_organization",
      { p_name: "Abominable", p_timezone: DEFAULT_TIMEZONE },
    );

    if (error || !orgId) return null;

    const { data: created } = await supabase
      .from("organizations")
      .select("*")
      .eq("id", orgId)
      .single();

    organization = (created ?? null) as Organization | null;
    if (!organization) return null;
  }

  return {
    userId: user.id,
    email: user.email ?? "",
    organization,
  };
}

/** Same as above, but sends anonymous visitors to /login. */
export async function requireSessionContext(): Promise<SessionContext> {
  const context = await getSessionContext();
  if (!context) redirect("/login");
  return context;
}
