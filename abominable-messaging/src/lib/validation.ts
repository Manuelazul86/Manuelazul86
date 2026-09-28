import { z } from "zod";

import {
  DEFAULT_TIMEZONE,
  MAX_TEXT_LENGTH,
  MIN_SCHEDULE_LEAD_SECONDS,
  MESSAGE_STATUSES,
} from "./constants";
import { isValidTimezone, zonedWallClockToUtc } from "./datetime";
import { normalizePhone } from "./phone";

/**
 * A single source of truth for input shapes. Route handlers parse with
 * these schemas before anything touches the database — the UI validates
 * with the same objects, so client and server never disagree.
 */

const phoneSchema = z
  .string()
  .min(1, "El teléfono es obligatorio")
  .transform((value, ctx) => {
    const normalized = normalizePhone(value);
    if (!normalized) {
      ctx.addIssue({
        code: "custom",
        message: "Usa formato internacional E.164, por ejemplo +529981234567",
      });
      return z.NEVER;
    }
    return normalized;
  });

const timezoneSchema = z
  .string()
  .default(DEFAULT_TIMEZONE)
  .refine(isValidTimezone, "Zona horaria no reconocida");

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((v) => (v === "" ? undefined : v));

// ---------------------------------------------------------------------
// Contacts
// ---------------------------------------------------------------------
export const contactInputSchema = z.object({
  name: z.string().trim().min(1, "El nombre es obligatorio").max(120),
  phone: phoneSchema,
  email: z
    .union([z.literal(""), z.string().trim().email("Email inválido")])
    .optional()
    .transform((v) => (v === "" || v === undefined ? undefined : v)),
  company: optionalText(120),
  notes: optionalText(2000),
  tags: z.array(z.string().trim().min(1).max(40)).max(20).default([]),
});

export type ContactInput = z.infer<typeof contactInputSchema>;

// ---------------------------------------------------------------------
// Messages
// ---------------------------------------------------------------------
const templateVariablesSchema = z
  .record(z.string(), z.string().max(1024))
  .default({});

/**
 * The composer posts either a "text" message with a body, or a
 * "template" message with a name + language. `superRefine` keeps the two
 * shapes honest without forcing the UI into a discriminated union.
 */
const messageBase = z.object({
  contact_id: z.string().uuid().nullish(),
  phone: phoneSchema,
  message_type: z.enum(["text", "template"]).default("text"),
  body: z.string().max(MAX_TEXT_LENGTH).optional(),
  template_name: optionalText(120),
  template_language: optionalText(20),
  template_variables: templateVariablesSchema,
  timezone: timezoneSchema,
});

function refineMessageShape(
  value: {
    message_type: "text" | "template";
    body?: string;
    template_name?: string;
    template_language?: string;
  },
  ctx: z.RefinementCtx,
) {
  if (value.message_type === "text") {
    if (!value.body || value.body.trim() === "") {
      ctx.addIssue({
        code: "custom",
        path: ["body"],
        message: "El mensaje no puede estar vacío",
      });
    }
    return;
  }

  if (!value.template_name) {
    ctx.addIssue({
      code: "custom",
      path: ["template_name"],
      message: "Selecciona una plantilla",
    });
  }
  if (!value.template_language) {
    ctx.addIssue({
      code: "custom",
      path: ["template_language"],
      message: "Indica el idioma de la plantilla",
    });
  }
}

/** "Send now" — no date/time is supplied at all. */
export const sendNowSchema = messageBase
  .extend({ mode: z.literal("now") })
  .superRefine(refineMessageShape);

/** "Schedule" — a wall clock reading plus the zone it was typed in. */
export const scheduleSchema = messageBase
  .extend({
    mode: z.literal("schedule"),
    scheduled_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Fecha inválida"),
    scheduled_time: z.string().regex(/^\d{1,2}:\d{2}$/, "Hora inválida"),
  })
  .superRefine((value, ctx) => {
    refineMessageShape(value, ctx);

    const instant = zonedWallClockToUtc(
      value.scheduled_date,
      value.scheduled_time,
      value.timezone,
    );

    if (!instant) {
      ctx.addIssue({
        code: "custom",
        path: ["scheduled_date"],
        message: "No pudimos interpretar esa fecha y hora",
      });
      return;
    }

    if (instant.getTime() < Date.now() + MIN_SCHEDULE_LEAD_SECONDS * 1000) {
      ctx.addIssue({
        code: "custom",
        path: ["scheduled_time"],
        message: "La fecha programada debe estar en el futuro",
      });
    }
  });

export const createMessageSchema = z.discriminatedUnion("mode", [
  sendNowSchema,
  scheduleSchema,
]);

export type CreateMessageInput = z.infer<typeof createMessageSchema>;

/** Editing an existing scheduled message. */
export const updateMessageSchema = z
  .object({
    body: z.string().max(MAX_TEXT_LENGTH).optional(),
    template_variables: templateVariablesSchema.optional(),
    scheduled_date: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, "Fecha inválida")
      .optional(),
    scheduled_time: z
      .string()
      .regex(/^\d{1,2}:\d{2}$/, "Hora inválida")
      .optional(),
    timezone: timezoneSchema.optional(),
  })
  .refine(
    (v) =>
      (v.scheduled_date === undefined) === (v.scheduled_time === undefined),
    { message: "Fecha y hora deben enviarse juntas", path: ["scheduled_time"] },
  );

export type UpdateMessageInput = z.infer<typeof updateMessageSchema>;

export const messageFilterSchema = z.object({
  status: z.enum(MESSAGE_STATUSES).optional(),
  search: z.string().trim().max(120).optional(),
});

// ---------------------------------------------------------------------
// n8n internal API
// ---------------------------------------------------------------------
export const claimRequestSchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(25),
  worker: z.string().trim().max(64).default("n8n"),
});

export const markSentSchema = z.object({
  message_id: z.string().uuid(),
  claim_token: z.string().uuid(),
  provider_message_id: z.string().trim().min(1).max(256),
});

export const markFailedSchema = z.object({
  message_id: z.string().uuid(),
  claim_token: z.string().uuid(),
  error_code: z.string().trim().max(64).default("unknown_error"),
  error_message: z.string().trim().max(2000).default("Unknown error"),
  retryable: z.boolean().default(true),
});

// ---------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------
export const credentialsSchema = z.object({
  email: z.string().trim().email("Email inválido"),
  password: z.string().min(8, "Mínimo 8 caracteres").max(200),
});
