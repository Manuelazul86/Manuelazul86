import { describe, expect, it } from "vitest";

import {
  isE164,
  normalizePhone,
  formatPhoneForDisplay,
} from "@/lib/phone";

describe("E.164 validation", () => {
  it("accepts well formed international numbers", () => {
    expect(isE164("+529981234567")).toBe(true);
    expect(isE164("+14155552671")).toBe(true);
    expect(isE164("+34612345678")).toBe(true);
  });

  it("rejects numbers without a plus", () => {
    expect(isE164("529981234567")).toBe(false);
  });

  it("rejects a leading zero country code", () => {
    expect(isE164("+0529981234567")).toBe(false);
  });

  it("rejects numbers that are too short or too long", () => {
    expect(isE164("+5299")).toBe(false);
    expect(isE164(`+52${"9".repeat(20)}`)).toBe(false);
  });

  it("rejects letters and separators", () => {
    expect(isE164("+52 998 123 4567")).toBe(false);
    expect(isE164("+52998ABC4567")).toBe(false);
  });
});

describe("phone normalization", () => {
  it("strips human formatting", () => {
    expect(normalizePhone("+52 (998) 123-4567")).toBe("+529981234567");
    expect(normalizePhone(" +52 998 123 4567 ")).toBe("+529981234567");
  });

  it("assumes the default country for a bare 10 digit number", () => {
    expect(normalizePhone("9981234567")).toBe("+529981234567");
  });

  it("honours an explicit default country code", () => {
    expect(normalizePhone("6123456789", "34")).toBe("+346123456789");
  });

  it("converts the 00 international prefix", () => {
    expect(normalizePhone("00529981234567")).toBe("+529981234567");
  });

  it("converts the legacy Mexican 01 prefix", () => {
    expect(normalizePhone("019981234567")).toBe("+529981234567");
  });

  it("returns null rather than guessing on unusable input", () => {
    expect(normalizePhone("")).toBeNull();
    expect(normalizePhone("   ")).toBeNull();
    expect(normalizePhone("hola")).toBeNull();
    expect(normalizePhone("12345")).toBeNull();
    expect(normalizePhone("+0000")).toBeNull();
  });

  it("never invents a country code when the input already has a plus", () => {
    // +9981234567 is a valid-looking E.164 on its own; it must not be
    // rewritten to +529981234567.
    expect(normalizePhone("+9981234567")).toBe("+9981234567");
  });
});

describe("display formatting", () => {
  it("groups digits readably", () => {
    expect(formatPhoneForDisplay("+529981234567")).toBe("+52 998 123 4567");
    expect(formatPhoneForDisplay("+14155552671")).toBe("+1 415 555 2671");
  });

  it("does not mistake a long national number for a 3 digit country code", () => {
    expect(formatPhoneForDisplay("+529981234567").startsWith("+52 ")).toBe(true);
  });

  it("passes through anything that is not E.164", () => {
    expect(formatPhoneForDisplay("no-es-un-numero")).toBe("no-es-un-numero");
  });
});
