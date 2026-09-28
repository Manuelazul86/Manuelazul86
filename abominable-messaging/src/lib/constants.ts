/** Shared, non-secret constants. Safe to import from client components. */

export const APP_NAME = "ABOMINABLE";
export const APP_SUBTITLE = "Messaging";

export const DEFAULT_TIMEZONE = "America/Cancun";

/**
 * Timezones offered in the composer. The list is deliberately short and
 * editable — the column stores any IANA identifier.
 */
export const SUPPORTED_TIMEZONES = [
  "America/Cancun",
  "America/Mexico_City",
  "America/Tijuana",
  "America/Bogota",
  "America/New_York",
  "America/Los_Angeles",
  "Europe/Madrid",
  "UTC",
] as const;

/**
 * WhatsApp caps a text body at 4096 characters. The composer counts
 * against this; the server re-validates.
 */
export const MAX_TEXT_LENGTH = 4096;

/** Smallest gap we accept between "now" and a scheduled send. */
export const MIN_SCHEDULE_LEAD_SECONDS = 30;

export const MESSAGE_STATUSES = [
  "draft",
  "scheduled",
  "processing",
  "sent",
  "delivered",
  "read",
  "failed",
  "cancelled",
] as const;

/** Statuses the user is still allowed to edit, reschedule or cancel. */
export const EDITABLE_STATUSES = ["draft", "scheduled"] as const;
