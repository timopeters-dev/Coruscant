import { describe, expect, it } from "vitest";
import {
  countCompletedMonths,
  daysInMonth,
  diffCalendarDays,
  getTodayIsoDate,
  parseIsoDate,
} from "./date";

describe("parseIsoDate & daysInMonth", () => {
  it("parses valid dates including leap-year Feb 29", () => {
    expect(parseIsoDate("2024-02-29")).toEqual({
      year: 2024,
      month: 2,
      day: 29,
    });
    expect(parseIsoDate("2026-11-16")).toEqual({
      year: 2026,
      month: 11,
      day: 16,
    });
    expect(daysInMonth(2024, 2)).toBe(29);
    expect(daysInMonth(2025, 2)).toBe(28);
    expect(daysInMonth(2000, 2)).toBe(29);
    expect(daysInMonth(1900, 2)).toBe(28);
  });

  it("rejects invalid calendar dates and malformed strings", () => {
    expect(() => parseIsoDate("2025-02-29")).toThrow(RangeError);
    expect(() => parseIsoDate("2026-04-31")).toThrow(RangeError);
    expect(() => parseIsoDate("2026-13-01")).toThrow(RangeError);
    expect(() => parseIsoDate("2026-00-10")).toThrow(RangeError);
    expect(() => parseIsoDate("2026/01/01")).toThrow(RangeError);
    expect(() => parseIsoDate("2026-1-1")).toThrow(RangeError);
    expect(() => daysInMonth(2026, 0)).toThrow(RangeError);
    expect(() => daysInMonth(2026, 13)).toThrow(RangeError);
  });
});

describe("countCompletedMonths", () => {
  it("returns 0 when toIsoDate is on or before fromIsoDate", () => {
    expect(countCompletedMonths("2026-05-15", "2026-05-15")).toBe(0);
    expect(countCompletedMonths("2026-05-15", "2026-04-20")).toBe(0);
    expect(countCompletedMonths("2026-05-15", "2026-06-14")).toBe(0);
  });

  it("handles month-end clamping and year boundaries", () => {
    expect(countCompletedMonths("2026-01-31", "2026-02-28")).toBe(1);
    expect(countCompletedMonths("2026-01-31", "2026-03-30")).toBe(1);
    expect(countCompletedMonths("2026-01-31", "2026-03-31")).toBe(2);
    expect(countCompletedMonths("2025-11-15", "2026-02-15")).toBe(3);
  });
});

describe("diffCalendarDays", () => {
  it("computes signed calendar day differences accurately", () => {
    expect(diffCalendarDays("2026-01-01", "2026-01-01")).toBe(0);
    expect(diffCalendarDays("2026-01-01", "2026-01-31")).toBe(30);
    expect(diffCalendarDays("2026-01-31", "2026-01-01")).toBe(-30);
    expect(diffCalendarDays("2024-02-28", "2024-03-01")).toBe(2);
  });
});

describe("getTodayIsoDate", () => {
  it("formats YYYY-MM-DD in the requested time zone", () => {
    const instant = new Date("2026-06-15T23:30:00Z");
    expect(getTodayIsoDate(instant, "Europe/Berlin")).toBe("2026-06-16");
    expect(getTodayIsoDate(instant, "UTC")).toBe("2026-06-15");
    expect(getTodayIsoDate(new Date("2026-01-01T00:05:00Z"), "Europe/Berlin")).toBe(
      "2026-01-01",
    );
  });
});
