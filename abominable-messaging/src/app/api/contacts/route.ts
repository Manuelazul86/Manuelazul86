import { NextRequest } from "next/server";

import { apiError, apiOk, parseJsonBody } from "@/lib/api";
import { getSessionContext } from "@/lib/auth";
import { createServerSupabase } from "@/lib/supabase/server";
import { contactInputSchema } from "@/lib/validation";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const context = await getSessionContext();
  if (!context) return apiError(401, "unauthorized", "Sesión requerida");

  const supabase = await createServerSupabase();
  const search = request.nextUrl.searchParams.get("search")?.trim();

  let query = supabase
    .from("contacts")
    .select("*")
    .eq("organization_id", context.organization.id)
    .order("created_at", { ascending: false })
    .limit(200);

  if (search) {
    const escaped = search.replace(/[%_,]/g, "");
    if (escaped) {
      query = query.or(
        `name.ilike.%${escaped}%,phone.ilike.%${escaped}%,company.ilike.%${escaped}%,email.ilike.%${escaped}%`,
      );
    }
  }

  const { data, error } = await query;
  if (error) return apiError(500, "query_failed", error.message);

  return apiOk(data);
}

export async function POST(request: NextRequest) {
  const context = await getSessionContext();
  if (!context) return apiError(401, "unauthorized", "Sesión requerida");

  const parsed = await parseJsonBody(request, contactInputSchema);
  if (!parsed.ok) return parsed.response;

  const supabase = await createServerSupabase();

  const { data, error } = await supabase
    .from("contacts")
    .insert({
      organization_id: context.organization.id,
      name: parsed.data.name,
      phone: parsed.data.phone,
      email: parsed.data.email ?? null,
      company: parsed.data.company ?? null,
      notes: parsed.data.notes ?? null,
      tags: parsed.data.tags,
    })
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
    return apiError(500, "insert_failed", error.message);
  }

  return apiOk(data, 201);
}
