import { describe, expect, it } from "vitest";
import {
  dateToIso,
  formatIsoDateInput,
  formatIsoMonthLabel,
  isWithinIsoBounds,
  isoToDate,
  parseDateInput,
  parseIsoMonth,
  toIsoMonth,
} from "./date-input";

describe("parseDateInput", () => {
  it("liest deutsche Schreibweisen", () => {
    expect(parseDateInput("12.03.2025")).toBe("2025-03-12");
    expect(parseDateInput("1.3.2025")).toBe("2025-03-01");
    expect(parseDateInput("01.03.25")).toBe("2025-03-01");
    expect(parseDateInput("01032025")).toBe("2025-03-01");
    expect(parseDateInput(" 31.12.2030 ")).toBe("2030-12-31");
  });

  it("akzeptiert ISO unverändert", () => {
    expect(parseDateInput("2024-02-29")).toBe("2024-02-29");
  });

  it("leer bleibt leer", () => {
    expect(parseDateInput("")).toBe("");
    expect(parseDateInput("   ")).toBe("");
  });

  it("lehnt ungültige Kalendertage ab", () => {
    expect(parseDateInput("29.02.2025")).toBeNull();
    expect(parseDateInput("31.04.2025")).toBeNull();
    expect(parseDateInput("00.01.2025")).toBeNull();
    expect(parseDateInput("12.13.2025")).toBeNull();
    expect(parseDateInput("2025-02-30")).toBeNull();
  });

  it("lehnt Unsinn ab", () => {
    expect(parseDateInput("morgen")).toBeNull();
    expect(parseDateInput("12.03")).toBeNull();
    expect(parseDateInput("12.03.202")).toBeNull();
  });
});

describe("ISO ↔ Date", () => {
  it("Rundreise ohne Zeitzonen-Versatz", () => {
    const date = isoToDate("2026-01-01");
    expect(date?.getDate()).toBe(1);
    expect(date && dateToIso(date)).toBe("2026-01-01");
  });

  it("ungültig → undefined", () => {
    expect(isoToDate("")).toBeUndefined();
    expect(isoToDate(null)).toBeUndefined();
    expect(isoToDate("2026-02-31")).toBeUndefined();
  });

  it("formatiert deutsch", () => {
    expect(formatIsoDateInput("2026-07-04")).toBe("04.07.2026");
    expect(formatIsoDateInput("kaputt")).toBe("");
  });
});

describe("isWithinIsoBounds", () => {
  it("prüft inklusive Grenzen", () => {
    expect(isWithinIsoBounds("2026-01-01", "2026-01-01", "2026-12-31")).toBe(true);
    expect(isWithinIsoBounds("2025-12-31", "2026-01-01")).toBe(false);
    expect(isWithinIsoBounds("2027-01-01", null, "2026-12-31")).toBe(false);
    expect(isWithinIsoBounds("2027-01-01")).toBe(true);
  });
});

describe("Monatswerte", () => {
  it("parst und formatiert YYYY-MM", () => {
    expect(parseIsoMonth("2026-03")).toEqual({ year: 2026, month: 3 });
    expect(parseIsoMonth("2026-13")).toBeNull();
    expect(parseIsoMonth("")).toBeNull();
    expect(toIsoMonth(2026, 3)).toBe("2026-03");
    expect(formatIsoMonthLabel("2026-03")).toBe("März 2026");
    expect(formatIsoMonthLabel("x")).toBe("");
  });
});
