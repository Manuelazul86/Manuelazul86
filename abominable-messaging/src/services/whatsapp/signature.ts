import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Verify Meta's X-Hub-Signature-256 header.
 *
 * Meta signs the RAW request body with the app secret. The body must be
 * read as text and passed here unmodified — re-serialising parsed JSON
 * changes the bytes and the signature will never match.
 */
export function verifyMetaSignature(
  rawBody: string,
  signatureHeader: string | null,
  appSecret: string,
): boolean {
  if (!signatureHeader || !appSecret) return false;

  const [algorithm, provided] = signatureHeader.split("=");
  if (algorithm !== "sha256" || !provided) return false;

  const expected = createHmac("sha256", appSecret)
    .update(rawBody, "utf8")
    .digest("hex");

  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(provided.trim(), "utf8");
  if (a.length !== b.length) return false;

  return timingSafeEqual(a, b);
}
