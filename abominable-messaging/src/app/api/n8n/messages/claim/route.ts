import { NextRequest } from "next/server";

import { apiError, apiOk, authorizeN8nRequest, parseJsonBody } from "@/lib/api";
import { createAdminSupabase } from "@/lib/supabase/admin";
import { claimRequestSchema } from "@/lib/validation";
import type { ClaimedMessage } from "@/types/database";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * POST /api/n8n/messages/claim
 *
 * Atomically moves due messages from `scheduled` to `processing` and
 * returns them, each with a single-use claim_token.
 *
 * Calling this twice concurrently is safe and is the expected worst
 * case: the underlying SELECT ... FOR UPDATE SKIP LOCKED means the
 * second caller receives the rows the first did not take. A message can
 * therefore be handed out exactly once.
 *
 * Auth: Authorization: Bearer <N8N_API_SECRET>
 */
export async function POST(request: NextRequest) {
  if (!authorizeN8nRequest(request)) {
    return apiError(401, "unauthorized", "Credenciales inválidas");
  }

  const parsed = await parseJsonBody(request, claimRequestSchema);
  if (!parsed.ok) return parsed.response;

  const admin = createAdminSupabase();

  const { data, error } = await admin.rpc("claim_due_messages", {
    p_limit: parsed.data.limit,
    p_worker: parsed.data.worker,
  });

  if (error) return apiError(500, "claim_failed", error.message);

  const messages = (data ?? []) as ClaimedMessage[];

  return apiOk({ count: messages.length, messages });
}
