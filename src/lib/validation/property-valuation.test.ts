import { describe, expect, it } from "vitest";
import {
  groundingSourceSchema,
  valuationModelOutputSchema,
} from "./property-valuation";

const validPayload = {
  lowerEur: 280_000,
  medianEur: 320_000,
  upperEur: 360_000,
  asOfDate: "2026-11-01",
  rationale: "Solide Nachfrage in Musterstadt bei vergleichbaren Objekten.",
  factors: [
    { label: "Gute Energieklasse", effect: "up" },
    { label: "Heizung 2021 erneuert", effect: "neutral" },
  ],
  confidence: "medium",
};

describe("validation/property-valuation", () => {
  it("accepts valid model output", () => {
    expect(valuationModelOutputSchema.safeParse(validPayload).success).toBe(
      true,
    );
  });

  it("rejects float EUR values, missing fields, and unknown fields like sources or url", () => {
    expect(
      valuationModelOutputSchema.safeParse({
        ...validPayload,
        medianEur: 320_000.5,
      }).success,
    ).toBe(false);

    const withoutRationale: Record<string, unknown> = { ...validPayload };
    delete withoutRationale.rationale;
    expect(
      valuationModelOutputSchema.safeParse(withoutRationale).success,
    ).toBe(false);

    expect(
      valuationModelOutputSchema.safeParse({
        ...validPayload,
        sources: ["https://example.com"],
      }).success,
    ).toBe(false);

    expect(
      valuationModelOutputSchema.safeParse({
        ...validPayload,
        url: "https://example.com",
      }).success,
    ).toBe(false);
  });

  it("rejects empty or overly long rationale, >6 factors, invalid confidence, and invalid calendar date", () => {
    expect(
      valuationModelOutputSchema.safeParse({
        ...validPayload,
        rationale: "   ",
      }).success,
    ).toBe(false);

    expect(
      valuationModelOutputSchema.safeParse({
        ...validPayload,
        rationale: "a".repeat(801),
      }).success,
    ).toBe(false);

    expect(
      valuationModelOutputSchema.safeParse({
        ...validPayload,
        factors: Array.from({ length: 7 }, (_, i) => ({
          label: `Faktor ${i}`,
          effect: "neutral",
        })),
      }).success,
    ).toBe(false);

    expect(
      valuationModelOutputSchema.safeParse({
        ...validPayload,
        confidence: "certain",
      }).success,
    ).toBe(false);

    expect(
      valuationModelOutputSchema.safeParse({
        ...validPayload,
        asOfDate: "2026-02-30",
      }).success,
    ).toBe(false);
  });

  it("validates groundingSourceSchema strictly for https", () => {
    expect(
      groundingSourceSchema.safeParse({
        uri: "https://example.com/report",
        title: "Marktbericht",
      }).success,
    ).toBe(true);

    expect(
      groundingSourceSchema.safeParse({
        uri: "http://example.com/report",
        title: "Marktbericht",
      }).success,
    ).toBe(false);
  });
});
