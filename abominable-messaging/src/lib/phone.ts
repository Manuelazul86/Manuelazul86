/**
 * E.164 handling.
 *
 * E.164 is: a leading "+", a country code starting 1-9, then up to 14
 * more digits (15 digits total, maximum). We normalise generously —
 * people paste "+52 (998) 123-4567" — but we store strictly, because the
 * same CHECK constraint guards the database columns.
 */

export const E164_PATTERN = /^\+[1-9]\d{7,14}$/;

export function isE164(value: string): boolean {
  return E164_PATTERN.test(value);
}

/**
 * Strip formatting and coerce common Mexican shorthands into E.164.
 * Returns null when the input cannot be made valid — never a guess.
 */
export function normalizePhone(
  input: string,
  defaultCountryCode = "52",
): string | null {
  if (typeof input !== "string") return null;

  const trimmed = input.trim();
  if (trimmed === "") return null;

  const hadPlus = trimmed.startsWith("+");
  let digits = trimmed.replace(/\D/g, "");
  if (digits === "") return null;

  if (!hadPlus) {
    // "00" is the international prefix used across most of Europe.
    if (digits.startsWith("00")) {
      digits = digits.slice(2);
    } else if (digits.startsWith("01") && digits.length > 10) {
      // Legacy Mexican long-distance prefix.
      digits = defaultCountryCode + digits.slice(2);
    } else if (digits.length === 10) {
      // A bare national number: assume the default country.
      digits = defaultCountryCode + digits;
    }
  }

  const candidate = `+${digits}`;
  return isE164(candidate) ? candidate : null;
}

/**
 * Country calling codes are 1-3 digits and are NOT derivable from the
 * total length, so we match the longest known prefix instead of
 * guessing. Unknown codes fall back to two digits, which is the most
 * common width.
 */
const KNOWN_COUNTRY_CODES = new Set([
  "1", // US / Canada
  "7", // Russia / Kazakhstan
  "20", "27", "30", "31", "32", "33", "34", "36", "39", "40", "41", "43",
  "44", "45", "46", "47", "48", "49", "51", "52", "53", "54", "55", "56",
  "57", "58", "60", "61", "62", "63", "64", "65", "66", "81", "82", "84",
  "86", "90", "91", "92", "93", "94", "95", "98",
  "212", "213", "216", "351", "352", "353", "358", "380", "420", "421",
  "501", "502", "503", "504", "505", "506", "507", "509", "591", "593",
  "595", "598", "971", "972", "974", "977",
]);

function splitCountryCode(digits: string): [string, string] {
  for (const width of [3, 2, 1]) {
    const candidate = digits.slice(0, width);
    if (KNOWN_COUNTRY_CODES.has(candidate)) {
      return [candidate, digits.slice(width)];
    }
  }
  return [digits.slice(0, 2), digits.slice(2)];
}

/** Display helper: +529981234567 -> +52 998 123 4567 */
export function formatPhoneForDisplay(phone: string): string {
  if (!isE164(phone)) return phone;

  const [country, rest] = splitCountryCode(phone.slice(1));
  if (rest === "") return `+${country}`;

  // Triples from the left, with the final block absorbing the remainder
  // so it is never orphaned: 9981234567 reads 998 123 4567.
  const groups: string[] = [];
  let remaining = rest;
  while (remaining.length > 4) {
    groups.push(remaining.slice(0, 3));
    remaining = remaining.slice(3);
  }
  groups.push(remaining);

  return `+${country} ${groups.join(" ")}`;
}
