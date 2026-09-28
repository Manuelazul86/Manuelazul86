"use client";

import { createBrowserClient } from "@supabase/ssr";

/**
 * Browser client. Only ever receives the anon key, which is safe to ship
 * because every table is protected by RLS.
 */
export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
}
