import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";

import { buildPayload } from "@/services/whatsapp/client";
import { isRetryableMetaError } from "@/services/whatsapp/errors";
import { isMockMessageId, sendViaMock } from "@/services/whatsapp/mock";
import { verifyMetaSignature } from "@/services/whatsapp/signature";

describe("Cloud API payload", () => {
  it("builds a text message", () => {
    expect(
      buildPayload({ kind: "text", to: "+529981234567", body: "Hola" }),
    ).toEqual({
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: "+529981234567",
      type: "text",
      text: { preview_url: false, body: "Hola" },
    });
  });

  it("orders template variables numerically, not lexicographically", () => {
    const payload = buildPayload({
      kind: "template",
      to: "+529981234567",
      templateName: "recordatorio",
      languageCode: "es_MX",
      variables: { "10": "diez", "2": "dos", "1": "uno" },
    }) as {
      template: { components: Array<{ parameters: Array<{ text: string }> }> };
    };

    expect(payload.template.components[0].parameters.map((p) => p.text)).toEqual(
      ["uno", "dos", "diez"],
    );
  });

  it("omits the components block when a template has no variables", () => {
    const payload = buildPayload({
      kind: "template",
      to: "+529981234567",
      templateName: "bienvenida",
      languageCode: "es_MX",
      variables: {},
    }) as { template: Record<string, unknown> };

    expect(payload.template.components).toBeUndefined();
  });
});

describe("error classification", () => {
  it("retries rate limits and transient faults", () => {
    expect(isRetryableMetaError(130_429, 429)).toBe(true);
    expect(isRetryableMetaError(2, 500)).toBe(true);
    expect(isRetryableMetaError(undefined, 503)).toBe(true);
  });

  it("does not retry a permanently undeliverable message", () => {
    expect(isRetryableMetaError(131_026, 400)).toBe(false);
  });

  it("does not retry outside the 24h window (template required)", () => {
    expect(isRetryableMetaError(131_047, 400)).toBe(false);
  });

  it("does not retry an expired access token", () => {
    expect(isRetryableMetaError(190, 401)).toBe(false);
  });

  it("does not retry a missing template", () => {
    expect(isRetryableMetaError(132_001, 400)).toBe(false);
  });

  it("defaults unknown 4xx to permanent and unknown 5xx to transient", () => {
    expect(isRetryableMetaError(999_999, 400)).toBe(false);
    expect(isRetryableMetaError(999_999, 502)).toBe(true);
  });
});

describe("mock transport", () => {
  it("returns a clearly marked mock id", async () => {
    const result = await sendViaMock({
      kind: "text",
      to: "+529981234567",
      body: "Hola",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.mock).toBe(true);
    expect(isMockMessageId(result.providerMessageId)).toBe(true);
    expect(result.providerMessageId).toContain("MOCK");
  });

  it("never returns the same id twice", async () => {
    const a = await sendViaMock({ kind: "text", to: "+529981234567", body: "a" });
    const b = await sendViaMock({ kind: "text", to: "+529981234567", body: "b" });

    expect(a.ok && b.ok && a.providerMessageId !== b.providerMessageId).toBe(true);
  });

  it("simulates a permanent failure for the reserved suffix", async () => {
    const result = await sendViaMock({
      kind: "text",
      to: "+529981230000",
      body: "Hola",
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.retryable).toBe(false);
  });

  it("does not mistake a real wamid for a mock id", () => {
    expect(isMockMessageId("wamid.HBgMNTIxOTk4MTIzNDU2Nw==")).toBe(false);
    expect(isMockMessageId(null)).toBe(false);
  });
});

describe("webhook signature", () => {
  const SECRET = "app-secret-de-prueba";
  const BODY = JSON.stringify({ object: "whatsapp_business_account" });

  function sign(body: string, secret = SECRET) {
    return `sha256=${createHmac("sha256", secret).update(body, "utf8").digest("hex")}`;
  }

  it("accepts a correctly signed body", () => {
    expect(verifyMetaSignature(BODY, sign(BODY), SECRET)).toBe(true);
  });

  it("rejects a body that was tampered with after signing", () => {
    const signature = sign(BODY);
    expect(verifyMetaSignature(`${BODY} `, signature, SECRET)).toBe(false);
  });

  it("rejects a signature made with the wrong secret", () => {
    expect(verifyMetaSignature(BODY, sign(BODY, "otro-secreto"), SECRET)).toBe(
      false,
    );
  });

  it("rejects a missing signature header", () => {
    expect(verifyMetaSignature(BODY, null, SECRET)).toBe(false);
  });

  it("rejects an unexpected algorithm", () => {
    const hex = createHmac("sha256", SECRET).update(BODY).digest("hex");
    expect(verifyMetaSignature(BODY, `sha1=${hex}`, SECRET)).toBe(false);
  });

  it("fails closed when no app secret is configured", () => {
    expect(verifyMetaSignature(BODY, sign(BODY), "")).toBe(false);
  });
});
