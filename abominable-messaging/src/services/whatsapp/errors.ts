/**
 * Classify a Meta Cloud API error into "try again later" vs "this will
 * never work".
 *
 * Retrying a permanent error burns quota and delays the failure the user
 * needs to see, so the default for anything we do not recognise is:
 * 4xx is permanent, 5xx and network faults are transient.
 *
 * Reference: Cloud API error codes.
 */

const PERMANENT_ERROR_CODES = new Set([
  100, // Invalid parameter
  131_008, // Required parameter is missing
  131_009, // Parameter value is not valid
  131_026, // Message undeliverable (unregistered number / cannot receive)
  131_047, // Re-engagement message: outside the 24h window, template required
  131_051, // Unsupported message type
  132_000, // Template param count mismatch
  132_001, // Template does not exist
  132_005, // Template hydrated text too long
  132_007, // Template format character policy violated
  132_012, // Template parameter format mismatch
  133_010, // Phone number not registered
  190, // Access token expired / invalid
]);

const TRANSIENT_ERROR_CODES = new Set([
  1, // Unknown API error
  2, // Service temporarily unavailable
  4, // Too many calls (app rate limit)
  80_007, // Rate limit issues
  130_429, // Cloud API rate limit hit
  131_000, // Something went wrong
  131_016, // Service temporarily unavailable
  133_016, // Rate limit on registration
]);

export function isRetryableMetaError(
  code: number | undefined,
  httpStatus: number,
): boolean {
  if (code !== undefined) {
    if (TRANSIENT_ERROR_CODES.has(code)) return true;
    if (PERMANENT_ERROR_CODES.has(code)) return false;
  }

  if (httpStatus === 429) return true;
  if (httpStatus >= 500) return true;
  if (httpStatus >= 400) return false;

  return true;
}
