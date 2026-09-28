import "server-only";

import { createClient } from "@supabase/supabase-js";

import { serverEnv } from "@/lib/env";

/**
 * Service-role client. Bypasses RLS, so it is confined to code paths
 * that have already authenticated the caller themselves:
 *   - /api/n8n/*            (bearer N8N_API_SECRET)
 *   - /api/webhooks/whatsapp (Meta signature)
 *
 * Never import this from a Client Component. The "server-only" import
 * above turns that mistake into a build failure.
 */
export function createAdminSupabase() {
  return createClient(serverEnv.supabaseUrl, serverEnv.supabaseServiceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}
