import { describe, expect, it } from "vitest";

import {
  dayBoundsUtc,
  formatInTimezone,
  isValidTimezone,
  timezoneOffsetMinutes,
  utcToZonedWallClock,
  zonedWallClockToUtc,
} from "@/lib/datetime";

describe("timezone offsets", () => {
  it("knows Cancun is UTC-5 year round (no DST since 2015)", () => {
    expect(
      timezoneOffsetMinutes(new Date("2026-01-15T12:00:00Z"), "America/Cancun"),
    ).toBe(-300);
    expect(
      timezoneOffsetMinutes(new Date("2026-07-15T12:00:00Z"), "America/Cancun"),
    ).toBe(-300);
  });

  it("tracks DST where it exists", () => {
    const winter = timezoneOffsetMinutes(
      new Date("2026-01-15T12:00:00Z"),
      "America/New_York",
    );
    const summer = timezoneOffsetMinutes(
      new Date("2026-07-15T12:00:00Z"),
      "America/New_York",
    );

    expect(winter).toBe(-300);
    expect(summer).toBe(-240);
  });

  it("reports zero for UTC", () => {
    expect(timezoneOffsetMinutes(new Date(), "UTC")).toBe(0);
  });
});

describe("wall clock -> UTC", () => {
  it("resolves a Cancun reading to the right instant", () => {
    const instant = zonedWallClockToUtc("2026-03-15", "09:00", "America/Cancun");
    expect(instant?.toISOString()).toBe("2026-03-15T14:00:00.000Z");
  });

  it("resolves midnight without slipping a day", () => {
    const instant = zonedWallClockToUtc("2026-03-15", "00:00", "America/Cancun");
    expect(instant?.toISOString()).toBe("2026-03-15T05:00:00.000Z");
  });

  it("applies the summer offset in a DST zone", () => {
    const instant = zonedWallClockToUtc(
      "2026-07-15",
      "09:00",
      "America/New_York",
    );
    expect(instant?.toISOString()).toBe("2026-07-15T13:00:00.000Z");
  });

  it("applies the winter offset in the same DST zone", () => {
    const instant = zonedWallClockToUtc(
      "2026-01-15",
      "09:00",
      "America/New_York",
    );
    expect(instant?.toISOString()).toBe("2026-01-15T14:00:00.000Z");
  });

  it("treats UTC input as UTC", () => {
    const instant = zonedWallClockToUtc("2026-03-15", "09:00", "UTC");
    expect(instant?.toISOString()).toBe("2026-03-15T09:00:00.000Z");
  });

  it("rejects malformed input instead of guessing", () => {
    expect(zonedWallClockToUtc("15-03-2026", "09:00", "UTC")).toBeNull();
    expect(zonedWallClockToUtc("2026-03-15", "9am", "UTC")).toBeNull();
    expect(zonedWallClockToUtc("2026-13-15", "09:00", "UTC")).toBeNull();
    expect(zonedWallClockToUtc("2026-03-15", "25:00", "UTC")).toBeNull();
  });
});

describe("UTC -> wall clock", () => {
  it("renders the instant in the target zone", () => {
    expect(
      utcToZonedWallClock("2026-03-15T14:00:00.000Z", "America/Cancun"),
    ).toEqual({ date: "2026-03-15", time: "09:00" });
  });

  it("rolls back to the previous day when the zone is behind UTC", () => {
    expect(
      utcToZonedWallClock("2026-03-15T02:00:00.000Z", "America/Cancun"),
    ).toEqual({ date: "2026-03-14", time: "21:00" });
  });

  it("renders midnight as 00:00, never 24:00", () => {
    expect(
      utcToZonedWallClock("2026-03-15T05:00:00.000Z", "America/Cancun").time,
    ).toBe("00:00");
  });
});

describe("round trip", () => {
  const cases: Array<[string, string, string]> = [
    ["2026-03-15", "09:00", "America/Cancun"],
    ["2026-12-31", "23:59", "America/Cancun"],
    ["2026-01-01", "00:00", "America/Mexico_City"],
    ["2026-07-04", "18:30", "America/New_York"],
    ["2026-07-04", "18:30", "Europe/Madrid"],
    ["2026-11-01", "12:00", "UTC"],
  ];

  it.each(cases)(
    "%s %s in %s survives the trip through UTC",
    (date, time, timezone) => {
      const instant = zonedWallClockToUtc(date, time, timezone);
      expect(instant).not.toBeNull();
      expect(utcToZonedWallClock(instant!, timezone)).toEqual({ date, time });
    },
  );
});

describe("day bounds", () => {
  it("spans exactly 24 hours in a zone without DST", () => {
    const { start, end } = dayBoundsUtc(
      "America/Cancun",
      new Date("2026-03-15T18:00:00Z"),
    );

    expect(start.toISOString()).toBe("2026-03-15T05:00:00.000Z");
    expect(end.toISOString()).toBe("2026-03-16T05:00:00.000Z");
  });

  it("contains the reference instant", () => {
    const reference = new Date("2026-03-15T18:00:00Z");
    const { start, end } = dayBoundsUtc("America/Cancun", reference);

    expect(reference.getTime()).toBeGreaterThanOrEqual(start.getTime());
    expect(reference.getTime()).toBeLessThan(end.getTime());
  });
});

describe("misc helpers", () => {
  it("validates IANA identifiers", () => {
    expect(isValidTimezone("America/Cancun")).toBe(true);
    expect(isValidTimezone("Mars/Olympus_Mons")).toBe(false);
  });

  it("renders a dash for missing instants rather than Invalid Date", () => {
    expect(formatInTimezone(null)).toBe("—");
    expect(formatInTimezone(undefined)).toBe("—");
    expect(formatInTimezone("not-a-date")).toBe("—");
  });
});
