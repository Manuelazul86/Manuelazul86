/**
 * Timezone handling.
 *
 * Rule for the whole codebase: the database only ever stores UTC
 * (timestamptz). A wall-clock date + time that the user typed is
 * meaningless without the zone it was typed in, so the composer always
 * sends { date, time, timezone } and we resolve it to a UTC instant here.
 *
 * We do the conversion with Intl rather than pulling in a date library,
 * so there is exactly one implementation and no tz-database drift
 * between client and server.
 */

import { DEFAULT_TIMEZONE } from "./constants";

/**
 * The offset, in minutes, that `timeZone` is from UTC at the given
 * instant. Positive means ahead of UTC.
 */
export function timezoneOffsetMinutes(instant: Date, timeZone: string): number {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });

  const parts = dtf.formatToParts(instant);
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((p) => p.type === type)?.value ?? "0");

  // Intl renders hour 24 for midnight under hour12:false in some engines.
  const hour = get("hour") % 24;

  const asUtc = Date.UTC(
    get("year"),
    get("month") - 1,
    get("day"),
    hour,
    get("minute"),
    get("second"),
  );

  return (asUtc - Math.floor(instant.getTime() / 1000) * 1000) / 60000;
}

/**
 * Convert a wall clock reading in `timeZone` to the UTC instant it names.
 *
 * Implemented by guessing UTC, measuring the offset the guess lands on,
 * then correcting — and measuring once more, which settles the DST
 * boundary cases where the first correction crosses a transition.
 */
export function zonedWallClockToUtc(
  date: string, // YYYY-MM-DD
  time: string, // HH:mm
  timeZone: string = DEFAULT_TIMEZONE,
): Date | null {
  const dateMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date.trim());
  const timeMatch = /^(\d{1,2}):(\d{2})$/.exec(time.trim());
  if (!dateMatch || !timeMatch) return null;

  const [, y, m, d] = dateMatch.map(Number) as unknown as number[];
  const [, hh, mm] = timeMatch.map(Number) as unknown as number[];

  if (m < 1 || m > 12 || d < 1 || d > 31 || hh > 23 || mm > 59) return null;

  const naive = Date.UTC(y, m - 1, d, hh, mm, 0, 0);

  let utc = naive - timezoneOffsetMinutes(new Date(naive), timeZone) * 60000;
  utc = naive - timezoneOffsetMinutes(new Date(utc), timeZone) * 60000;

  const result = new Date(utc);
  return Number.isNaN(result.getTime()) ? null : result;
}

/** Split a UTC instant into the { date, time } a user sees in `timeZone`. */
export function utcToZonedWallClock(
  instant: Date | string,
  timeZone: string = DEFAULT_TIMEZONE,
): { date: string; time: string } {
  const value = typeof instant === "string" ? new Date(instant) : instant;

  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).formatToParts(value);

  const get = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((p) => p.type === type)?.value ?? "00";

  const hour = String(Number(get("hour")) % 24).padStart(2, "0");

  return {
    date: `${get("year")}-${get("month")}-${get("day")}`,
    time: `${hour}:${get("minute")}`,
  };
}

/** Human-readable rendering of a UTC instant in the display timezone. */
export function formatInTimezone(
  instant: Date | string | null | undefined,
  timeZone: string = DEFAULT_TIMEZONE,
  options: Intl.DateTimeFormatOptions = {},
): string {
  if (!instant) return "—";
  const value = typeof instant === "string" ? new Date(instant) : instant;
  if (Number.isNaN(value.getTime())) return "—";

  return new Intl.DateTimeFormat("es-MX", {
    timeZone,
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    ...options,
  }).format(value);
}

export function isValidTimezone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone });
    return true;
  } catch {
    return false;
  }
}

/** Start and end of "today" in `timeZone`, expressed as UTC instants. */
export function dayBoundsUtc(
  timeZone: string = DEFAULT_TIMEZONE,
  reference: Date = new Date(),
): { start: Date; end: Date } {
  const { date } = utcToZonedWallClock(reference, timeZone);
  const start = zonedWallClockToUtc(date, "00:00", timeZone) ?? reference;
  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
  return { start, end };
}
