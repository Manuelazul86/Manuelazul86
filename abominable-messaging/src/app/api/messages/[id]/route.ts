import { NextRequest } from "next/server";

import { apiError, apiOk, parseJsonBody } from "@/lib/api";
import { getSessionContext } from "@/lib/auth";
import { MIN_SCHEDULE_LEAD_SECONDS } from "@/lib/constants";
import { zonedWallClockToUtc } from "@/lib/datetime";
import { createAdminSupabase } from "@/lib/supabase/admin";
import { createServerSupabase } from "@/lib/supabase/server";
import { updateMessageSchema } from "@/lib/validation";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

export async function GET(_request: NextRequest, { params }: Params) {
  const context = await getSessionContext();
  if (!context) return apiError(401, "unauthorized", "Sesión requerida");

  const { id } = await params;
  const supabase = await createServerSupabase();

  const { data, error } = await supabase
    .from("messages")
    .select("*, contact:contacts(id, name, phone)")
    .eq("id", id)
    .eq("organization_id", context.organization.id)
    .maybeSingle();

  if (error) return apiError(500, "query_failed", error.message);
  if (!data) return apiError(404, "not_found", "Mensaje no encontrado");

  const { data: events } = await supabase
    .from("message_events")
    .select("*")
    .eq("message_id", id)
    .order("created_at", { ascending: false })
    .limit(50);

  return apiOk({ message: data, events: events ?? [] });
}

/**
 * Edit or reschedule a message.
 *
 * Only `draft` and `scheduled` rows are editable. The WHERE clause
 * enforces that on the database side too, so a message that flipped to
 * `processing` between our read and our write is not modified — the
 * update simply matches zero rows.
 */
export async function PATCH(request: NextRequest, { params }: Params) {
  const context = await getSessionContext();
  if (!context) return apiError(401, "unauthorized", "Sesión requerida");

  const { id } = await params;
  const parsed = await parseJsonBody(request, updateMessageSchema);
  if (!parsed.ok) return parsed.response;

  const supabase = await createServerSupabase();

  const { data: existing, error: readError } = await supabase
    .from("messages")
    .select("*")
    .eq("id", id)
    .eq("organization_id", context.organization.id)
    .maybeSingle();

  if (readError) return apiError(500, "query_failed", readError.message);
  if (!existing) return apiError(404, "not_found", "Mensaje no encontrado");

  if (existing.status !== "scheduled" && existing.status !== "draft") {
    return apiError(
      409,
      "not_editable",
      `Un mensaje en estado "${existing.status}" ya no puede editarse`,
    );
  }

  const patch: Record<string, unknown> = {};
  let rescheduled = false;

  if (parsed.data.body !== undefined) {
    if (existing.message_type === "text" && parsed.data.body.trim() === "") {
      return apiError(422, "empty_body", "El mensaje no puede estar vacío");
    }
    patch.body = parsed.data.body;
  }

  if (parsed.data.template_variables !== undefined) {
    patch.template_variables = parsed.data.template_variables;
  }

  const timezone = parsed.data.timezone ?? existing.timezone;
  if (parsed.data.timezone !== undefined) patch.timezone = timezone;

  if (parsed.data.scheduled_date && parsed.data.scheduled_time) {
    const instant = zonedWallClockToUtc(
      parsed.data.scheduled_date,
      parsed.data.scheduled_time,
      timezone,
    );
    if (!instant) {
      return apiError(422, "invalid_schedule", "Fecha u hora inválida");
    }
    if (instant.getTime() < Date.now() + MIN_SCHEDULE_LEAD_SECONDS * 1000) {
      return apiError(
        422,
        "schedule_in_past",
        "La nueva fecha debe estar en el futuro",
      );
    }
    patch.scheduled_at = instant.toISOString();
    // A reschedule is a fresh chance: clear the previous failure state.
    patch.error_code = null;
    patch.error_message = null;
    rescheduled = true;
  }

  if (Object.keys(patch).length === 0) {
    return apiError(400, "nothing_to_update", "No hay cambios que aplicar");
  }

  const { data, error } = await supabase
    .from("messages")
    .update(patch)
    .eq("id", id)
    .eq("organization_id", context.organization.id)
    .in("status", ["draft", "scheduled"])
    .select("*, contact:contacts(id, name, phone)")
    .maybeSingle();

  if (error) return apiError(500, "update_failed", error.message);
  if (!data) {
    return apiError(
      409,
      "state_changed",
      "El mensaje cambió de estado mientras se editaba",
    );
  }

  const admin = createAdminSupabase();
  await admin.rpc("log_message_event", {
    p_message_id: id,
    p_event_type: rescheduled ? "message_rescheduled" : "message_updated",
    p_actor: "user",
    p_payload: patch as Record<string, unknown>,
  });

  return apiOk(data);
}

/**
 * Cancel a message.
 *
 * Cancellation is only possible while the row is still `scheduled` or a
 * `draft`. Once it is `processing` the send is already in flight and
 * there is nothing honest we could do — WhatsApp has no unsend.
 */
export async function DELETE(_request: NextRequest, { params }: Params) {
  const context = await getSessionContext();
  if (!context) return apiError(401, "unauthorized", "Sesión requerida");

  const { id } = await params;
  const supabase = await createServerSupabase();

  const { data, error } = await supabase
    .from("messages")
    .update({ status: "cancelled", cancelled_at: new Date().toISOString() })
    .eq("id", id)
    .eq("organization_id", context.organization.id)
    .in("status", ["draft", "scheduled"])
    .select("*")
    .maybeSingle();

  if (error) return apiError(500, "cancel_failed", error.message);
  if (!data) {
    return apiError(
      409,
      "not_cancellable",
      "Sólo se pueden cancelar mensajes en borrador o programados",
    );
  }

  const admin = createAdminSupabase();
  await admin.rpc("log_message_event", {
    p_message_id: id,
    p_event_type: "message_cancelled",
    p_actor: "user",
    p_payload: {},
  });

  return apiOk(data);
}
