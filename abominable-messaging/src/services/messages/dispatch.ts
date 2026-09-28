import "server-only";

import { createAdminSupabase } from "@/lib/supabase/admin";
import { sendWhatsAppMessage, toSendRequest } from "@/services/whatsapp";
import type { ClaimedMessage } from "@/types/database";

/**
 * Take a message that has ALREADY been claimed (status = processing with
 * a valid claim_token) and drive it to a terminal state.
 *
 * The claim is the contract: this function never transitions a message
 * itself, it only reports the outcome through mark_message_sent /
 * mark_message_failed, both of which require the token. A replayed call
 * with a stale token changes nothing.
 */
export async function dispatchClaimedMessage(
  claimed: Pick<
    ClaimedMessage,
    | "id"
    | "phone"
    | "body"
    | "message_type"
    | "template_name"
    | "template_language"
    | "template_variables"
    | "claim_token"
  >,
  actor: string,
): Promise<
  | { status: "sent"; providerMessageId: string; mock: boolean }
  | { status: "failed" | "scheduled"; errorCode: string; errorMessage: string }
> {
  const admin = createAdminSupabase();

  const request = toSendRequest(claimed);

  if (!request) {
    await admin.rpc("mark_message_failed", {
      p_message_id: claimed.id,
      p_claim_token: claimed.claim_token,
      p_error_code: "invalid_payload",
      p_error_message:
        "El mensaje no tiene cuerpo ni plantilla válida para enviarse",
      p_retryable: false,
      p_actor: actor,
    });

    return {
      status: "failed",
      errorCode: "invalid_payload",
      errorMessage: "El mensaje no tiene contenido enviable",
    };
  }

  const result = await sendWhatsAppMessage(request);

  if (result.ok) {
    const { data: applied } = await admin.rpc("mark_message_sent", {
      p_message_id: claimed.id,
      p_claim_token: claimed.claim_token,
      p_provider_message_id: result.providerMessageId,
      p_actor: actor,
    });

    if (applied === false) {
      // The row moved on without us — another worker already resolved
      // it. The message went out; do not touch the row.
      return {
        status: "sent",
        providerMessageId: result.providerMessageId,
        mock: result.mock,
      };
    }

    return {
      status: "sent",
      providerMessageId: result.providerMessageId,
      mock: result.mock,
    };
  }

  const { data: outcome } = await admin.rpc("mark_message_failed", {
    p_message_id: claimed.id,
    p_claim_token: claimed.claim_token,
    p_error_code: result.errorCode,
    p_error_message: result.errorMessage,
    p_retryable: result.retryable,
    p_actor: actor,
  });

  const row = Array.isArray(outcome) ? outcome[0] : outcome;
  const willRetry = Boolean(row?.will_retry);

  return {
    status: willRetry ? "scheduled" : "failed",
    errorCode: result.errorCode,
    errorMessage: result.errorMessage,
  };
}
