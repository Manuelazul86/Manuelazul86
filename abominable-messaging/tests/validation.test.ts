import { describe, expect, it } from "vitest";

import {
  contactInputSchema,
  createMessageSchema,
  credentialsSchema,
  markFailedSchema,
  markSentSchema,
  updateMessageSchema,
} from "@/lib/validation";

const FUTURE_DATE = (() => {
  const d = new Date(Date.now() + 48 * 60 * 60 * 1000);
  return d.toISOString().slice(0, 10);
})();

const PAST_DATE = (() => {
  const d = new Date(Date.now() - 48 * 60 * 60 * 1000);
  return d.toISOString().slice(0, 10);
})();

describe("contact input", () => {
  it("accepts a minimal contact and normalises the phone", () => {
    const parsed = contactInputSchema.parse({
      name: "  Karla  ",
      phone: "998 123 4567",
      tags: [],
    });

    expect(parsed.name).toBe("Karla");
    expect(parsed.phone).toBe("+529981234567");
  });

  it("rejects a blank name", () => {
    const result = contactInputSchema.safeParse({ name: "   ", phone: "+529981234567" });
    expect(result.success).toBe(false);
  });

  it("rejects an unusable phone", () => {
    const result = contactInputSchema.safeParse({ name: "Karla", phone: "hola" });
    expect(result.success).toBe(false);
  });

  it("treats an empty email as absent instead of invalid", () => {
    const parsed = contactInputSchema.parse({
      name: "Karla",
      phone: "+529981234567",
      email: "",
    });
    expect(parsed.email).toBeUndefined();
  });

  it("rejects a malformed email", () => {
    const result = contactInputSchema.safeParse({
      name: "Karla",
      phone: "+529981234567",
      email: "no-es-email",
    });
    expect(result.success).toBe(false);
  });
});

describe("creating a message", () => {
  it("accepts an immediate text message", () => {
    const parsed = createMessageSchema.parse({
      mode: "now",
      phone: "+529981234567",
      message_type: "text",
      body: "Hola Karla",
      timezone: "America/Cancun",
    });

    expect(parsed.mode).toBe("now");
    expect(parsed.phone).toBe("+529981234567");
  });

  it("rejects an empty body on a text message", () => {
    const result = createMessageSchema.safeParse({
      mode: "now",
      phone: "+529981234567",
      message_type: "text",
      body: "   ",
      timezone: "America/Cancun",
    });

    expect(result.success).toBe(false);
  });

  it("requires a name and language on a template message", () => {
    const result = createMessageSchema.safeParse({
      mode: "now",
      phone: "+529981234567",
      message_type: "template",
      timezone: "America/Cancun",
    });

    expect(result.success).toBe(false);
  });

  it("accepts a complete template message without a body", () => {
    const parsed = createMessageSchema.parse({
      mode: "now",
      phone: "+529981234567",
      message_type: "template",
      template_name: "recordatorio_cita",
      template_language: "es_MX",
      template_variables: { "1": "Karla" },
      timezone: "America/Cancun",
    });

    expect(parsed.message_type).toBe("template");
  });

  it("accepts a future schedule", () => {
    const parsed = createMessageSchema.parse({
      mode: "schedule",
      phone: "+529981234567",
      message_type: "text",
      body: "Recordatorio",
      scheduled_date: FUTURE_DATE,
      scheduled_time: "09:00",
      timezone: "America/Cancun",
    });

    expect(parsed.mode).toBe("schedule");
  });

  it("rejects a schedule in the past", () => {
    const result = createMessageSchema.safeParse({
      mode: "schedule",
      phone: "+529981234567",
      message_type: "text",
      body: "Tarde",
      scheduled_date: PAST_DATE,
      scheduled_time: "09:00",
      timezone: "America/Cancun",
    });

    expect(result.success).toBe(false);
  });

  it("rejects an unknown timezone", () => {
    const result = createMessageSchema.safeParse({
      mode: "now",
      phone: "+529981234567",
      message_type: "text",
      body: "Hola",
      timezone: "Mars/Olympus_Mons",
    });

    expect(result.success).toBe(false);
  });
});

describe("rescheduling", () => {
  it("accepts a date and time together", () => {
    const parsed = updateMessageSchema.parse({
      scheduled_date: FUTURE_DATE,
      scheduled_time: "18:30",
    });

    expect(parsed.scheduled_time).toBe("18:30");
  });

  it("rejects a date without a time", () => {
    const result = updateMessageSchema.safeParse({ scheduled_date: FUTURE_DATE });
    expect(result.success).toBe(false);
  });

  it("rejects a time without a date", () => {
    const result = updateMessageSchema.safeParse({ scheduled_time: "18:30" });
    expect(result.success).toBe(false);
  });

  it("allows editing only the body", () => {
    const parsed = updateMessageSchema.parse({ body: "Nuevo texto" });
    expect(parsed.body).toBe("Nuevo texto");
  });
});

describe("n8n callbacks", () => {
  it("requires a uuid claim token on success", () => {
    expect(
      markSentSchema.safeParse({
        message_id: "11111111-1111-4111-8111-111111111111",
        claim_token: "not-a-uuid",
        provider_message_id: "wamid.X",
      }).success,
    ).toBe(false);
  });

  it("accepts a well formed success report", () => {
    const parsed = markSentSchema.parse({
      message_id: "11111111-1111-4111-8111-111111111111",
      claim_token: "22222222-2222-4222-8222-222222222222",
      provider_message_id: "wamid.HBgM",
    });

    expect(parsed.provider_message_id).toBe("wamid.HBgM");
  });

  it("defaults a failure report to retryable", () => {
    const parsed = markFailedSchema.parse({
      message_id: "11111111-1111-4111-8111-111111111111",
      claim_token: "22222222-2222-4222-8222-222222222222",
    });

    expect(parsed.retryable).toBe(true);
    expect(parsed.error_code).toBe("unknown_error");
  });
});

describe("credentials", () => {
  it("requires at least 8 characters", () => {
    expect(
      credentialsSchema.safeParse({ email: "a@b.com", password: "short" })
        .success,
    ).toBe(false);
  });

  it("requires a valid email", () => {
    expect(
      credentialsSchema.safeParse({ email: "nope", password: "longenough" })
        .success,
    ).toBe(false);
  });
});
