import { NextRequest } from "next/server";

import { apiError, apiOk, authorizeN8nRequest } from "@/lib/api";
import { createAdminSupabase } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * POST /api/n8n/messages/release
 *
 * Janitor endpoint. A worker that crashes after claiming but before
 * reporting leaves a row stuck in `processing`. Call this on a slower
 * schedule (every 5-10 minutes) to release claims older than
 * ?stale_minutes back to `scheduled`, or to `failed` once the attempt
 * budget is spent.
 *
 * Without it a single crash would silently strand a message forever.
 */
export async function POST(request: NextRequest) {
  if (!authorizeN8nRequest(request)) {
    return apiError(401, "unauthorized", "Credenciales inválidas");
  }

  const raw = request.nextUrl.searchParams.get("stale_minutes");
  const staleMinutes = Math.min(
    Math.max(Number.parseInt(raw ?? "15", 10) || 15, 1),
    1440,
  );

  const admin = createAdminSupabase();

  const { data, error } = await admin.rpc("release_stuck_messages", {
    p_stale_minutes: staleMinutes,
  });

  if (error) return apiError(500, "release_failed", error.message);

  return apiOk({ released: data ?? 0, stale_minutes: staleMinutes });
}
