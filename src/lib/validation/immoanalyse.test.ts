import { describe, expect, it } from "vitest";
import {
  immoAnalyseValuationResponseSchema,
  parseImmoAnalyseErrorPayload,
  valuationAdoptBodySchema,
} from "./immoanalyse";

const validPayload = {
  request_id: "req_123",
  cached: false,
  data_as_of: "2026-11-01",
  bewertbarkeit: {
    status: "valuable" as const,
    begruendung: "Solide Vergleichsdaten",
    limitations: ["Keine Innenbesichtigung"],
  },
  marktwert: {
    min: 280000,
    median: 320000,
    max: 360000,
    preis_pro_m2: 3200,
  },
  konfidenz: {
    wert: 78,
    level: "hoch" as const,
  },
  kennzahlen: {
    merkmal_anpassung: {
      posten: [{ merkmal: "baujahr", label: "Baujahr 1998", prozent: 2.5 }],
    },
  },
  kontingent: {
    limit: 10,
    verbraucht: 1,
    verbleibend: 9,
    reset_at: "2026-12-01T00:00:00Z",
    tarif: "free",
  },
};

describe("validation/immoanalyse", () => {
  it("accepts a valid response and strips unknown extra fields", () => {
    const parsed = immoAnalyseValuationResponseSchema.safeParse({
      ...validPayload,
      future_field: "ignored",
      bewertbarkeit: {
        ...validPayload.bewertbarkeit,
        extra: 42,
      },
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect("future_field" in parsed.data).toBe(false);
    }
  });

  it("accepts not_reliably_valuable without marktwert", () => {
    const parsed = immoAnalyseValuationResponseSchema.safeParse({
      request_id: "req_456",
      bewertbarkeit: {
        status: "not_reliably_valuable",
        begruendung: "Zu wenige Vergleichsobjekte",
      },
    });
    expect(parsed.success).toBe(true);
  });

  it("rejects valuable without marktwert", () => {
    const parsed = immoAnalyseValuationResponseSchema.safeParse({
      request_id: "req_789",
      bewertbarkeit: {
        status: "valuable",
      },
    });
    expect(parsed.success).toBe(false);
  });

  it("rejects unknown status, string median, and negative or float verbleibend", () => {
    expect(
      immoAnalyseValuationResponseSchema.safeParse({
        ...validPayload,
        bewertbarkeit: { status: "unknown" },
      }).success,
    ).toBe(false);

    expect(
      immoAnalyseValuationResponseSchema.safeParse({
        ...validPayload,
        marktwert: { ...validPayload.marktwert, median: "320000" },
      }).success,
    ).toBe(false);

    expect(
      immoAnalyseValuationResponseSchema.safeParse({
        ...validPayload,
        kontingent: { ...validPayload.kontingent, verbleibend: -1 },
      }).success,
    ).toBe(false);

    expect(
      immoAnalyseValuationResponseSchema.safeParse({
        ...validPayload,
        kontingent: { ...validPayload.kontingent, verbleibend: 2.5 },
      }).success,
    ).toBe(false);
  });

  it("parses error schema tolerantly and returns null when error object is missing", () => {
    expect(
      parseImmoAnalyseErrorPayload({
        error: {
          code: "quota_exceeded",
          status: 402,
          message: "Kontingent aufgebraucht",
        },
      }),
    ).toEqual({
      error: {
        code: "quota_exceeded",
        status: 402,
        message: "Kontingent aufgebraucht",
      },
    });

    expect(parseImmoAnalyseErrorPayload({ message: "other" })).toBeNull();
  });

  it("validates valuationAdoptBodySchema strictly", () => {
    expect(
      valuationAdoptBodySchema.safeParse({
        historyId: "11111111-1111-4111-8111-111111111111",
        choice: "median",
      }).success,
    ).toBe(true);

    expect(
      valuationAdoptBodySchema.safeParse({
        historyId: "11111111-1111-4111-8111-111111111111",
        choice: "median",
        medianCents: 32_000_000,
      }).success,
    ).toBe(false);

    expect(
      valuationAdoptBodySchema.safeParse({
        historyId: "not-a-uuid",
        choice: "median",
      }).success,
    ).toBe(false);
  });
});
