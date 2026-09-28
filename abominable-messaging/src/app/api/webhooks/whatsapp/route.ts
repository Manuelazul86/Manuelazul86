import { NextRequest, NextResponse } from "next/server";

import { serverEnv, isMockMode } from "@/lib/env";
import { secureCompare } from "@/lib/api";
import { createAdminSupabase } from "@/lib/supabase/admin";
import { verifyMetaSignature } from "@/services/whatsapp/signature";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * WhatsApp Cloud API webhook.
 *
 * GET  — Meta's subscription handshake. Echoes hub.challenge when
 *        hub.verify_token matches WHATSAPP_VERIFY_TOKEN.
 * POST — status callbacks (sent / delivered / read / failed), matched
 *        back to our rows via provider_message_id.
 *
 * SECURITY
 * Meta signs the raw body with the app secret (X-Hub-Signature-256). We
 * read the body as TEXT and verify before parsing — re-serialising JSON
 * would change the bytes and break the comparison.
 *
 * If META_APP_SECRET is not configured the endpoint refuses POSTs in
 * production. Accepting unsigned callbacks would let anyone mark any
 * message as delivered.
 */

interface WhatsAppStatus {
  id?: string;
  status?: string;
  timestamp?: string;
  recipient_id?: string;
  errors?: Array<{ code?: number; title?: string; message?: string; error_data?: { details?: string } }>;
}

interface WhatsAppWebhookBody {
  object?: string;
  entry?: Array<{
    id?: string;
    changes?: Array<{
      field?: string;
      value?: {
        messaging_product?: string;
        statuses?: WhatsAppStatus[];
      };
    }>;
  }>;
}

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const mode = params.get("hub.mode");
  const token = params.get("hub.verify_token");
  const challenge = params.get("hub.challenge");

  let expected: string;
  try {
    expected = serverEnv.whatsappVerifyToken;
  } catch {
    return new NextResponse("Webhook not configured", { status: 503 });
  }

  if (mode === "subscribe" && token && secureCompare(token, expected)) {
    return new NextResponse(challenge ?? "", {
      status: 200,
      headers: { "Content-Type": "text/plain" },
    });
  }

  return new NextResponse("Forbidden", { status: 403 });
}

export async function POST(request: NextRequest) {
  // Read raw bytes first — signature verification depends on them.
  const rawBody = await request.text();
  const signature = request.headers.get("x-hub-signature-256");

  const appSecret = serverEnv.metaAppSecret;

  if (!appSecret) {
    // No secret configured. Tolerated only for local mock development.
    if (!isMockMode()) {
      return new NextResponse("Signature verification not configured", {
        status: 503,
      });
    }
  } else if (!verifyMetaSignature(rawBody, signature, appSecret)) {
    return new NextResponse("Invalid signature", { status: 401 });
  }

  let body: WhatsAppWebhookBody;
  try {
    body = JSON.parse(rawBody) as WhatsAppWebhookBody;
  } catch {
    // Acknowledge malformed payloads: replying non-2xx makes Meta retry
    // something that will never parse.
    return NextResponse.json({ received: true, processed: 0 });
  }

  const admin = createAdminSupabase();
  let processed = 0;

  for (const entry of body.entry ?? []) {
    for (const change of entry.changes ?? []) {
      for (const status of change.value?.statuses ?? []) {
        if (!status.id || !status.status) continue;

        const firstError = status.errors?.[0];
        const occurredAt = status.timestamp
          ? new Date(Number(status.timestamp) * 1000).toISOString()
          : new Date().toISOString();

        const { data, error } = await admin.rpc("apply_provider_status", {
          p_provider_message_id: status.id,
          p_status: status.status,
          p_occurred_at: occurredAt,
          p_error_code:
            firstError?.code !== undefined ? String(firstError.code) : null,
          p_error_message:
            firstError?.error_data?.details ??
            firstError?.message ??
            firstError?.title ??
            null,
          p_raw: status as unknown as Record<string, unknown>,
        });

        if (!error && data === true) processed += 1;
      }
    }
  }

  // Always 200: Meta retries aggressively on anything else, and every
  // status update is idempotent on our side anyway.
  return NextResponse.json({ received: true, processed });
}
