import "server-only";

import { serverEnv } from "@/lib/env";

import { isRetryableMetaError } from "./errors";
import type { SendRequest, SendResult } from "./types";

/**
 * WhatsApp Business Cloud API (official Meta API) transport.
 *
 * This module is the ONLY place that talks to Meta. It runs server-side
 * exclusively — WHATSAPP_ACCESS_TOKEN must never reach the browser.
 *
 * We do not implement retries here: retry policy belongs to the
 * scheduler, which owns attempt_count and the backoff, so a retry is
 * always recorded and always bounded.
 */

interface MetaErrorBody {
  error?: {
    message?: string;
    code?: number;
    error_subcode?: number;
    error_data?: { details?: string };
  };
}

interface MetaSendResponse {
  messages?: Array<{ id?: string }>;
}

/**
 * Build the Cloud API payload.
 *
 * Template variables arrive as a { "1": "...", "2": "..." } map because
 * WhatsApp's positional body parameters are 1-indexed. We sort
 * numerically so "10" does not land before "2".
 */
export function buildPayload(request: SendRequest): Record<string, unknown> {
  if (request.kind === "text") {
    return {
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: request.to,
      type: "text",
      text: { preview_url: false, body: request.body },
    };
  }

  const ordered = Object.keys(request.variables)
    .sort((a, b) => Number(a) - Number(b))
    .map((key) => ({ type: "text", text: request.variables[key] }));

  return {
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to: request.to,
    type: "template",
    template: {
      name: request.templateName,
      language: { code: request.languageCode },
      ...(ordered.length > 0
        ? { components: [{ type: "body", parameters: ordered }] }
        : {}),
    },
  };
}

export async function sendViaCloudApi(
  request: SendRequest,
  options: { timeoutMs?: number } = {},
): Promise<SendResult> {
  const url = `https://graph.facebook.com/${serverEnv.whatsappApiVersion}/${serverEnv.whatsappPhoneNumberId}/messages`;

  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    options.timeoutMs ?? 20_000,
  );

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${serverEnv.whatsappAccessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(buildPayload(request)),
      signal: controller.signal,
      cache: "no-store",
    });

    const text = await response.text();
    let parsed: unknown = null;
    try {
      parsed = text ? JSON.parse(text) : null;
    } catch {
      parsed = null;
    }

    if (!response.ok) {
      const body = (parsed ?? {}) as MetaErrorBody;
      const code = body.error?.code;

      return {
        ok: false,
        errorCode: code !== undefined ? String(code) : `http_${response.status}`,
        errorMessage:
          body.error?.error_data?.details ??
          body.error?.message ??
          text.slice(0, 500) ??
          "Error desconocido de WhatsApp Cloud API",
        retryable: isRetryableMetaError(code, response.status),
        mock: false,
      };
    }

    const providerMessageId = (parsed as MetaSendResponse)?.messages?.[0]?.id;

    if (!providerMessageId) {
      // 2xx without an id means we cannot correlate webhooks to this
      // row. Treat it as a permanent failure rather than claiming a
      // send we can never confirm.
      return {
        ok: false,
        errorCode: "missing_message_id",
        errorMessage:
          "WhatsApp respondió 200 pero sin messages[0].id; no se puede rastrear el envío",
        retryable: false,
        mock: false,
      };
    }

    return { ok: true, providerMessageId, mock: false };
  } catch (error) {
    const aborted = error instanceof Error && error.name === "AbortError";
    return {
      ok: false,
      errorCode: aborted ? "timeout" : "network_error",
      errorMessage:
        error instanceof Error ? error.message : "Fallo de red desconocido",
      retryable: true,
      mock: false,
    };
  } finally {
    clearTimeout(timeout);
  }
}
