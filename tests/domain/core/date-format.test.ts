import { describe, expect, it } from "vitest";
import {
  formatDateDE,
  formatDateTimeDE,
  formatMonthDE,
  formatMonthPartsDE,
} from "@/domain/core/date-format";

describe("formatDateDE", () => {
  it("formats ISO dates as TT.MM.JJJJ", () => {
    expect(formatDateDE("2027-03-05")).toBe("05.03.2027");
    expect(formatDateDE("2024-02-29")).toBe("29.02.2024");
  });

  it("uses the date prefix of timestamps", () => {
    expect(formatDateDE("2026-01-31T23:10:00.000Z")).toBe("31.01.2026");
  });

  it("returns empty input as empty string and unknown input unchanged", () => {
    expect(formatDateDE("")).toBe("");
    expect(formatDateDE(null)).toBe("");
    expect(formatDateDE(undefined)).toBe("");
    expect(formatDateDE("bald")).toBe("bald");
    expect(formatDateDE("2027-03")).toBe("2027-03");
  });
});

describe("formatMonthDE", () => {
  it("formats year-months and dates as MM.JJJJ", () => {
    expect(formatMonthDE("2061-07")).toBe("07.2061");
    expect(formatMonthDE("2061-07-01")).toBe("07.2061");
  });

  it("leaves unknown input unchanged", () => {
    expect(formatMonthDE("")).toBe("");
    expect(formatMonthDE("07/2061")).toBe("07/2061");
    expect(formatMonthDE("2061-071")).toBe("2061-071");
  });
});

describe("formatMonthPartsDE", () => {
  it("pads month and year", () => {
    expect(formatMonthPartsDE(2027, 3)).toBe("03.2027");
    expect(formatMonthPartsDE(999, 12)).toBe("12.0999");
  });
});

describe("formatDateTimeDE", () => {
  it("formats in Berlin time across the date line", () => {
    // 23:30 UTC on 31.12. is already 00:30 on 01.01. in Berlin (winter time)
    expect(formatDateTimeDE("2026-12-31T23:30:00.000Z")).toBe("01.01.2027, 00:30");
    // summer time (UTC+2)
    expect(formatDateTimeDE("2026-07-01T09:05:00.000Z")).toBe("01.07.2026, 11:05");
  });

  it("returns invalid input unchanged", () => {
    expect(formatDateTimeDE("kaputt")).toBe("kaputt");
    expect(formatDateTimeDE(new Date(Number.NaN))).toBe("");
  });
});
