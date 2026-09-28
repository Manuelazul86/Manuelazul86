import { NextRequest } from "next/server";

import { apiError, apiOk, authorizeN8nRequest, parseJsonBody } from "@/lib/api";
import { createAdminSupabase } from "@/lib/supabase/admin";
import { markFailedSchema } from "@/lib/validation";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * POST /api/n8n/messages/failed
 *
 * Reports a failed send. The database decides what happens next:
 * another attempt is scheduled with exponential backoff while attempts
 * remain and the error is retryable, otherwise the row becomes `failed`.
 *
 * n8n never decides this itself — keeping the retry budget in one place
 * is what stops a misconfigured workflow from looping forever.
 */
export async function POST(request: NextRequest) {
  if (!authorizeN8nRequest(request)) {
    return apiError(401, "unauthorized", "Credenciales inválidas");
  }

  const parsed = await parseJsonBody(request, markFailedSchema);
  if (!parsed.ok) return parsed.response;

  const admin = createAdminSupabase();

  const { data, error } = await admin.rpc("mark_message_failed", {
    p_message_id: parsed.data.message_id,
    p_claim_token: parsed.data.claim_token,
    p_error_code: parsed.data.error_code,
    p_error_message: parsed.data.error_message,
    p_retryable: parsed.data.retryable,
    p_actor: "n8n",
  });

  if (error) return apiError(500, "update_failed", error.message);

  const row = Array.isArray(data) ? data[0] : data;

  return apiOk({
    final_status: row?.final_status ?? null,
    will_retry: Boolean(row?.will_retry),
  });
}
