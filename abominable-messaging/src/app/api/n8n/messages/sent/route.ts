import { NextRequest } from "next/server";

import { apiError, apiOk, authorizeN8nRequest, parseJsonBody } from "@/lib/api";
import { createAdminSupabase } from "@/lib/supabase/admin";
import { markSentSchema } from "@/lib/validation";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * POST /api/n8n/messages/sent
 *
 * Reports a successful send: `processing` -> `sent`.
 *
 * The claim_token must match the one issued by /claim. If n8n retries
 * this call the second attempt finds the row already in `sent` with a
 * cleared token and reports applied=false, which is a no-op rather than
 * an error — retrying a confirmation is always safe.
 */
export async function POST(request: NextRequest) {
  if (!authorizeN8nRequest(request)) {
    return apiError(401, "unauthorized", "Credenciales inválidas");
  }

  const parsed = await parseJsonBody(request, markSentSchema);
  if (!parsed.ok) return parsed.response;

  const admin = createAdminSupabase();

  const { data, error } = await admin.rpc("mark_message_sent", {
    p_message_id: parsed.data.message_id,
    p_claim_token: parsed.data.claim_token,
    p_provider_message_id: parsed.data.provider_message_id,
    p_actor: "n8n",
  });

  if (error) return apiError(500, "update_failed", error.message);

  return apiOk({ applied: data === true });
}
