import "server-only";

import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";

import { serverEnv } from "@/lib/env";

/**
 * Request-scoped client that carries the signed-in user's session, so
 * every query it runs is evaluated against RLS as that user.
 */
export async function createServerSupabase() {
  const cookieStore = await cookies();

  return createServerClient(serverEnv.supabaseUrl, serverEnv.supabaseAnonKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) => {
            cookieStore.set(name, value, options);
          });
        } catch {
          // Called from a Server Component, where cookies are read-only.
          // Session refresh is handled by the middleware instead.
        }
      },
    },
  });
}
