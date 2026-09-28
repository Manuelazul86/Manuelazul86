import { NextRequest } from "next/server";
import { randomUUID } from "node:crypto";

import { apiError, apiOk, parseJsonBody } from "@/lib/api";
import { getSessionContext } from "@/lib/auth";
import { zonedWallClockToUtc } from "@/lib/datetime";
import { createAdminSupabase } from "@/lib/supabase/admin";
import { createServerSupabase } from "@/lib/supabase/server";
import { createMessageSchema } from "@/lib/validation";
import { dispatchClaimedMessage } from "@/services/messages/dispatch";
import type { ClaimedMessage } from "@/types/database";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const context = await getSessionContext();
  if (!context) return apiError(401, "unauthorized", "Sesión requerida");

  const supabase = await createServerSupabase();
  const status = request.nextUrl.searchParams.get("status");

  let query = supabase
    .from("messages")
    .select("*, contact:contacts(id, name, phone)")
    .eq("organization_id", context.organization.id)
    .order("created_at", { ascending: false })
    .limit(200);

  if (status) query = query.eq("status", status);

  const { data, error } = await query;
  if (error) return apiError(500, "query_failed", error.message);

  return apiOk(data);
}

/**
 * Create a message.
 *
 * Both modes insert the row as `scheduled`:
 *   - mode "schedule" → scheduled_at = the resolved UTC instant
 *   - mode "now"      → scheduled_at = now(), then claimed and sent
 *                       immediately in this request
 *
 * Keeping one insert shape means the immediate path inherits the same
 * atomic claim, the same retry accounting and the same audit trail as
 * the n8n path. There is no second, weaker code path that could double
 * send.
 */
export async function POST(request: NextRequest) {
  const context = await getSessionContext();
  if (!context) return apiError(401, "unauthorized", "Sesión requerida");

  const parsed = await parseJsonBody(request, createMessageSchema);
  if (!parsed.ok) return parsed.response;

  const input = parsed.data;

  let scheduledAt: Date;
  if (input.mode === "schedule") {
    const resolved = zonedWallClockToUtc(
      input.scheduled_date,
      input.scheduled_time,
      input.timezone,
    );
    if (!resolved) {
      return apiError(422, "invalid_schedule", "Fecha u hora inválida");
    }
    scheduledAt = resolved;
  } else {
    scheduledAt = new Date();
  }

  const supabase = await createServerSupabase();

  const { data: created, error } = await supabase
    .from("messages")
    .insert({
      organization_id: context.organization.id,
      contact_id: input.contact_id ?? null,
      phone: input.phone,
      body: input.message_type === "text" ? (input.body ?? null) : null,
      message_type: input.message_type,
      template_name: input.template_name ?? null,
      template_language: input.template_language ?? null,
      template_variables: input.template_variables,
      scheduled_at: scheduledAt.toISOString(),
      timezone: input.timezone,
      status: "scheduled",
      created_by: context.userId,
      idempotency_key: randomUUID(),
    })
    .select("*")
    .single();

  if (error) return apiError(500, "insert_failed", error.message);

  const admin = createAdminSupabase();

  await admin.rpc("log_message_event", {
    p_message_id: created.id,
    p_event_type:
      input.mode === "now" ? "message_created" : "message_scheduled",
    p_actor: "user",
    p_payload: {
      mode: input.mode,
      scheduled_at: scheduledAt.toISOString(),
      timezone: input.timezone,
    },
  });

  if (input.mode === "schedule") {
    return apiOk({ message: created, dispatched: false }, 201);
  }

  // Send now: claim the row we just created, then dispatch it.
  const { data: claimedRows, error: claimError } = await admin.rpc(
    "claim_message_by_id",
    { p_message_id: created.id, p_worker: "app" },
  );

  if (claimError) return apiError(500, "claim_failed", claimError.message);

  const claimed = (claimedRows as ClaimedMessage[] | null)?.[0];

  if (!claimed) {
    // n8n beat us to it (possible when scheduled_at is already due).
    // That is a correct outcome, not an error: the message is in flight.
    return apiOk({ message: created, dispatched: false, reason: "already_claimed" }, 202);
  }

  const outcome = await dispatchClaimedMessage(claimed, "app");

  const { data: refreshed } = await supabase
    .from("messages")
    .select("*, contact:contacts(id, name, phone)")
    .eq("id", created.id)
    .single();

  return apiOk({ message: refreshed ?? created, dispatched: true, outcome }, 201);
}
