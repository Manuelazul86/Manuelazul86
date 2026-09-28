import { describe, expect, it, vi } from "vitest";

import { authorizeN8nRequest, secureCompare } from "@/lib/api";

vi.mock("server-only", () => ({}));

function bearer(token: string) {
  return new Request("http://localhost/api/n8n/messages/claim", {
    method: "POST",
    headers: { authorization: `Bearer ${token}` },
  });
}

describe("constant time comparison", () => {
  it("matches identical strings", () => {
    expect(secureCompare("abc123", "abc123")).toBe(true);
  });

  it("rejects different strings of equal length", () => {
    expect(secureCompare("abc123", "abc124")).toBe(false);
  });

  it("rejects different lengths without throwing", () => {
    expect(secureCompare("short", "much-longer-value")).toBe(false);
  });
});

describe("n8n endpoint authorization", () => {
  const SECRET = process.env.N8N_API_SECRET!;

  it("accepts the configured secret", () => {
    expect(authorizeN8nRequest(bearer(SECRET))).toBe(true);
  });

  it("rejects a wrong secret", () => {
    expect(authorizeN8nRequest(bearer("secreto-incorrecto"))).toBe(false);
  });

  it("rejects a missing Authorization header", () => {
    expect(
      authorizeN8nRequest(
        new Request("http://localhost/api/n8n/messages/claim", { method: "POST" }),
      ),
    ).toBe(false);
  });

  it("rejects a non-Bearer scheme", () => {
    expect(
      authorizeN8nRequest(
        new Request("http://localhost/api/n8n/messages/claim", {
          method: "POST",
          headers: { authorization: `Basic ${SECRET}` },
        }),
      ),
    ).toBe(false);
  });

  it("rejects an empty bearer token", () => {
    expect(
      authorizeN8nRequest(
        new Request("http://localhost/api/n8n/messages/claim", {
          method: "POST",
          headers: { authorization: "Bearer " },
        }),
      ),
    ).toBe(false);
  });

  it("accepts the Bearer scheme case-insensitively, as RFC 7235 requires", () => {
    expect(
      authorizeN8nRequest(
        new Request("http://localhost/api/n8n/messages/claim", {
          method: "POST",
          headers: { authorization: `bearer ${SECRET}` },
        }),
      ),
    ).toBe(true);
  });
});
