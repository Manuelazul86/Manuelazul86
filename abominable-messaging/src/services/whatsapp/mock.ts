import { randomUUID } from "node:crypto";

import type { SendRequest, SendResult } from "./types";

/** Prefix that makes a simulated id impossible to mistake for a real one. */
export const MOCK_MESSAGE_ID_PREFIX = "wamid.MOCK-";

export function isMockMessageId(id: string | null | undefined): boolean {
  return typeof id === "string" && id.startsWith(MOCK_MESSAGE_ID_PREFIX);
}

/**
 * Simulated transport used while Meta credentials are not available.
 *
 * It exercises the same code path as the real client — same return
 * shape, same failure classification — so the scheduling, claiming and
 * auditing pipeline can be validated end to end before any token exists.
 *
 * A destination number ending in 0000 deliberately fails, which is how
 * the failure/retry path gets tested without waiting for a real outage.
 */
export async function sendViaMock(request: SendRequest): Promise<SendResult> {
  await new Promise((resolve) => setTimeout(resolve, 25));

  if (request.to.endsWith("0000")) {
    return {
      ok: false,
      errorCode: "mock_undeliverable",
      errorMessage:
        "Mock mode: los números terminados en 0000 simulan un fallo permanente",
      retryable: false,
      mock: true,
    };
  }

  return {
    ok: true,
    providerMessageId: `${MOCK_MESSAGE_ID_PREFIX}${randomUUID()}`,
    mock: true,
  };
}
