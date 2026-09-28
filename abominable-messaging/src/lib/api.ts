import "server-only";

import { NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { z } from "zod";

import { serverEnv } from "@/lib/env";

/** Consistent JSON error envelope for every route handler. */
export function apiError(
  status: number,
  code: string,
  message: string,
  details?: unknown,
) {
  return NextResponse.json({ error: { code, message, details } }, { status });
}

export function apiOk<T>(data: T, status = 200) {
  return NextResponse.json({ data }, { status });
}

/** Constant-time string comparison, safe on differing lengths. */
export function secureCompare(a: string, b: string): boolean {
  const bufA = Buffer.from(a, "utf8");
  const bufB = Buffer.from(b, "utf8");
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

/**
 * Guard for /api/n8n/*.
 *
 * n8n presents `Authorization: Bearer <N8N_API_SECRET>`. Without it the
 * endpoint is indistinguishable from any other 401 — we never say
 * whether the secret was merely wrong.
 */
export function authorizeN8nRequest(request: Request): boolean {
  const header = request.headers.get("authorization");
  if (!header) return false;

  const [scheme, token] = header.split(" ");
  if (scheme?.toLowerCase() !== "bearer" || !token) return false;

  try {
    return secureCompare(token.trim(), serverEnv.n8nApiSecret);
  } catch {
    // N8N_API_SECRET is not configured: fail closed.
    return false;
  }
}

/** Parse a JSON body against a schema, returning a 400 on failure. */
export async function parseJsonBody<S extends z.ZodType>(
  request: Request,
  schema: S,
): Promise<
  { ok: true; data: z.infer<S> } | { ok: false; response: NextResponse }
> {
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return {
      ok: false,
      response: apiError(400, "invalid_json", "El cuerpo no es JSON válido"),
    };
  }

  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    return {
      ok: false,
      response: apiError(
        422,
        "validation_error",
        "Datos inválidos",
        parsed.error.flatten(),
      ),
    };
  }

  return { ok: true, data: parsed.data };
}
