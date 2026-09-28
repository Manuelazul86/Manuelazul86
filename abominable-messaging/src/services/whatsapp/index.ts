import "server-only";

import { isMockMode } from "@/lib/env";

import { sendViaCloudApi } from "./client";
import { sendViaMock } from "./mock";
import type { SendRequest, SendResult } from "./types";

export * from "./types";
export { isMockMessageId, MOCK_MESSAGE_ID_PREFIX } from "./mock";
export { isRetryableMetaError } from "./errors";

/**
 * Single entry point for sending. Everything upstream — the immediate
 * send path and the n8n-driven scheduled path — calls this, so mock mode
 * is honoured in exactly one place.
 */
export async function sendWhatsAppMessage(
  request: SendRequest,
): Promise<SendResult> {
  if (isMockMode()) {
    return sendViaMock(request);
  }
  return sendViaCloudApi(request);
}

/** Convenience wrapper matching the row shape we store in `messages`. */
export function toSendRequest(message: {
  phone: string;
  body: string | null;
  message_type: "text" | "template";
  template_name: string | null;
  template_language: string | null;
  template_variables: Record<string, string> | null;
}): SendRequest | null {
  if (message.message_type === "text") {
    if (!message.body) return null;
    return { kind: "text", to: message.phone, body: message.body };
  }

  if (!message.template_name || !message.template_language) return null;

  return {
    kind: "template",
    to: message.phone,
    templateName: message.template_name,
    languageCode: message.template_language,
    variables: message.template_variables ?? {},
  };
}
