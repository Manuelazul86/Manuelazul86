import { NextRequest } from "next/server";

import { apiError, apiOk, parseJsonBody } from "@/lib/api";
import { getSessionContext } from "@/lib/auth";
import { createServerSupabase } from "@/lib/supabase/server";
import { contactInputSchema } from "@/lib/validation";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

export async function PATCH(request: NextRequest, { params }: Params) {
  const context = await getSessionContext();
  if (!context) return apiError(401, "unauthorized", "Sesión requerida");

  const { id } = await params;
  const parsed = await parseJsonBody(request, contactInputSchema);
  if (!parsed.ok) return parsed.response;

  const supabase = await createServerSupabase();

  const { data, error } = await supabase
    .from("contacts")
    .update({
      name: parsed.data.name,
      phone: parsed.data.phone,
      email: parsed.data.email ?? null,
      company: parsed.data.company ?? null,
      notes: parsed.data.notes ?? null,
      tags: parsed.data.tags,
    })
    .eq("id", id)
    .eq("organization_id", context.organization.id)
    .select()
    .single();

  if (error) {
    if (error.code === "23505") {
      return apiError(
        409,
        "duplicate_phone",
        "Ya existe un contacto con ese número",
      );
    }
    return apiError(500, "update_failed", error.message);
  }
  if (!data) return apiError(404, "not_found", "Contacto no encontrado");

  return apiOk(data);
}

export async function DELETE(_request: NextRequest, { params }: Params) {
  const context = await getSessionContext();
  if (!context) return apiError(401, "unauthorized", "Sesión requerida");

  const { id } = await params;
  const supabase = await createServerSupabase();

  const { error } = await supabase
    .from("contacts")
    .delete()
    .eq("id", id)
    .eq("organization_id", context.organization.id);

  if (error) return apiError(500, "delete_failed", error.message);

  return apiOk({ id });
}
