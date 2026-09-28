import "server-only";

import { dayBoundsUtc, utcToZonedWallClock } from "@/lib/datetime";
import { createServerSupabase } from "@/lib/supabase/server";
import type { Contact, MessageWithContact } from "@/types/database";

const MESSAGE_SELECT = "*, contact:contacts(id, name, phone)";

export interface DashboardMetrics {
  scheduled: number;
  sentToday: number;
  failed: number;
  contacts: number;
}

/** The four dashboard counters, each a HEAD count — no rows transferred. */
export async function getDashboardMetrics(
  organizationId: string,
  timezone: string,
): Promise<DashboardMetrics> {
  const supabase = await createServerSupabase();
  const { start, end } = dayBoundsUtc(timezone);

  const countOpts = { count: "exact" as const, head: true };

  const [scheduled, sentToday, failed, contacts] = await Promise.all([
    supabase
      .from("messages")
      .select("id", countOpts)
      .eq("organization_id", organizationId)
      .in("status", ["scheduled", "processing"]),

    supabase
      .from("messages")
      .select("id", countOpts)
      .eq("organization_id", organizationId)
      .in("status", ["sent", "delivered", "read"])
      .gte("sent_at", start.toISOString())
      .lt("sent_at", end.toISOString()),

    supabase
      .from("messages")
      .select("id", countOpts)
      .eq("organization_id", organizationId)
      .eq("status", "failed"),

    supabase
      .from("contacts")
      .select("id", countOpts)
      .eq("organization_id", organizationId),
  ]);

  return {
    scheduled: scheduled.count ?? 0,
    sentToday: sentToday.count ?? 0,
    failed: failed.count ?? 0,
    contacts: contacts.count ?? 0,
  };
}

/** Next messages waiting to go out, soonest first. */
export async function getUpcomingMessages(
  organizationId: string,
  limit = 10,
): Promise<MessageWithContact[]> {
  const supabase = await createServerSupabase();

  const { data } = await supabase
    .from("messages")
    .select(MESSAGE_SELECT)
    .eq("organization_id", organizationId)
    .in("status", ["scheduled", "processing"])
    .order("scheduled_at", { ascending: true })
    .limit(limit);

  return (data ?? []) as MessageWithContact[];
}

export async function listMessages(
  organizationId: string,
  options: {
    statuses?: string[];
    search?: string;
    limit?: number;
    order?: "scheduled_asc" | "created_desc";
  } = {},
): Promise<MessageWithContact[]> {
  const supabase = await createServerSupabase();

  let query = supabase
    .from("messages")
    .select(MESSAGE_SELECT)
    .eq("organization_id", organizationId)
    .limit(options.limit ?? 100);

  if (options.statuses?.length) {
    query = query.in("status", options.statuses);
  }

  if (options.search) {
    // Strip PostgREST filter metacharacters before interpolating.
    const escaped = options.search.replace(/[%_,()]/g, "").trim();
    if (escaped) {
      query = query.or(`body.ilike.%${escaped}%,phone.ilike.%${escaped}%`);
    }
  }

  query =
    options.order === "scheduled_asc"
      ? query.order("scheduled_at", { ascending: true })
      : query.order("created_at", { ascending: false });

  const { data } = await query;
  return (data ?? []) as MessageWithContact[];
}

export async function getMessage(
  organizationId: string,
  id: string,
): Promise<MessageWithContact | null> {
  const supabase = await createServerSupabase();

  const { data } = await supabase
    .from("messages")
    .select(MESSAGE_SELECT)
    .eq("organization_id", organizationId)
    .eq("id", id)
    .maybeSingle();

  return (data ?? null) as MessageWithContact | null;
}

export async function getMessageEvents(messageId: string, limit = 50) {
  const supabase = await createServerSupabase();

  const { data } = await supabase
    .from("message_events")
    .select("*")
    .eq("message_id", messageId)
    .order("created_at", { ascending: false })
    .limit(limit);

  return data ?? [];
}

export async function listContacts(
  organizationId: string,
  search?: string,
): Promise<Contact[]> {
  const supabase = await createServerSupabase();

  let query = supabase
    .from("contacts")
    .select("*")
    .eq("organization_id", organizationId)
    .order("name", { ascending: true })
    .limit(500);

  if (search) {
    const escaped = search.replace(/[%_,()]/g, "").trim();
    if (escaped) {
      query = query.or(
        `name.ilike.%${escaped}%,phone.ilike.%${escaped}%,company.ilike.%${escaped}%,email.ilike.%${escaped}%`,
      );
    }
  }

  const { data } = await query;
  return (data ?? []) as Contact[];
}

/**
 * Distinct templates seen in past messages.
 *
 * The MVP deliberately has no template editor and does not call Meta's
 * template management API. This gives the Plantillas screen something
 * truthful to show — what has actually been used — without pretending to
 * be a template manager.
 */
export async function listUsedTemplates(organizationId: string) {
  const supabase = await createServerSupabase();

  const { data } = await supabase
    .from("messages")
    .select("template_name, template_language, status, created_at")
    .eq("organization_id", organizationId)
    .eq("message_type", "template")
    .not("template_name", "is", null)
    .order("created_at", { ascending: false })
    .limit(500);

  const byKey = new Map<
    string,
    { name: string; language: string; uses: number; lastUsed: string }
  >();

  for (const row of data ?? []) {
    const name = row.template_name as string;
    const language = (row.template_language as string) ?? "—";
    const key = `${name}::${language}`;
    const existing = byKey.get(key);

    if (existing) {
      existing.uses += 1;
    } else {
      byKey.set(key, {
        name,
        language,
        uses: 1,
        lastUsed: row.created_at as string,
      });
    }
  }

  return [...byKey.values()].sort((a, b) => b.uses - a.uses);
}

/**
 * The date/time the composer pre-fills: fifteen minutes from now, in the
 * organization's timezone.
 *
 * It lives here, not in the page, because reading the clock inside a
 * component body is impure — and because doing it server-side is what
 * keeps the client's first render identical to the server's.
 */
export async function getSuggestedSendTime(
  timezone: string,
): Promise<{ date: string; time: string }> {
  return utcToZonedWallClock(new Date(Date.now() + 15 * 60_000), timezone);
}
