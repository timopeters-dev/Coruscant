import { describe, expect, it } from "vitest";
import {
  coachAssessmentRequestSchema,
  coachAssessmentSchema,
  coachChatReplySchema,
  coachChatRequestSchema,
} from "@/validation/coach";

function validAssessment(): Record<string, unknown> {
  return {
    summary: "Ein ruhiger Überblick.",
    strengths: [{ title: "Breit gestreut", detail: "ETF dominiert." }],
    risks: [
      {
        title: "Klumpen",
        detail: "Zwei ähnliche Indizes.",
        severity: "medium",
        relatedRefs: ["ETF-1", "ETF-2"],
      },
    ],
    horizonCheck: [{ ref: "ZIEL-1", fit: "tension", explanation: "Kurzer Horizont." }],
    rebalancing: {
      targetWeightsBps: { etf: 8000, stock: 1500, crypto: 500 },
      rationale: "Weniger Einzeltitel.",
      preferContributionsOnly: true,
    },
    glossary: [{ term: "ETF", explanation: "Börsengehandelter Fonds." }],
  };
}

describe("coachAssessmentSchema", () => {
  it("akzeptiert eine gültige Bewertung, auch mit rebalancing: null", () => {
    expect(coachAssessmentSchema.safeParse(validAssessment()).success).toBe(true);
    expect(
      coachAssessmentSchema.safeParse({ ...validAssessment(), rebalancing: null }).success,
    ).toBe(true);
  });

  it.each([
    ["Summe 9.999", { etf: 8000, stock: 1500, crypto: 499 }],
    ["Summe 10.001", { etf: 8000, stock: 1500, crypto: 501 }],
    ["negatives Bps", { etf: 10_500, stock: -500, crypto: 0 }],
    ["Bps > 10.000", { etf: 10_001, stock: 0, crypto: 0 }],
    ["Float-Bps", { etf: 8000, stock: 1500.5, crypto: 499.5 }],
    ["unbekannte Klasse", { etf: 5000, stock: 3000, crypto: 1000, bonds: 1000 }],
  ])("lehnt ungültige Gewichte ab: %s", (_label, weights) => {
    const bad = validAssessment();
    (bad.rebalancing as Record<string, unknown>).targetWeightsBps = weights;
    expect(coachAssessmentSchema.safeParse(bad).success).toBe(false);
  });

  it("lehnt zusätzliche Schlüssel ab (.strict())", () => {
    expect(
      coachAssessmentSchema.safeParse({ ...validAssessment(), buyRecommendation: "X" })
        .success,
    ).toBe(false);
    const bad = validAssessment();
    (bad.rebalancing as Record<string, unknown>).isin = "IE00B4L5Y983";
    expect(coachAssessmentSchema.safeParse(bad).success).toBe(false);
  });

  it("lehnt leere strengths, zu lange summary und ungültige severity ab", () => {
    expect(
      coachAssessmentSchema.safeParse({ ...validAssessment(), strengths: [] }).success,
    ).toBe(false);
    expect(
      coachAssessmentSchema.safeParse({ ...validAssessment(), summary: "a".repeat(601) })
        .success,
    ).toBe(false);
    const bad = validAssessment();
    (bad.risks as Record<string, unknown>[])[0]!.severity = "critical";
    expect(coachAssessmentSchema.safeParse(bad).success).toBe(false);
  });

  it("lehnt ungültige Ref-Formate ab", () => {
    for (const ref of ["ZIEL-x", "Topf Urlaub", "ETF-1234", "NOTGROSCHEN-1", ""]) {
      const bad = validAssessment();
      (bad.horizonCheck as Record<string, unknown>[])[0]!.ref = ref;
      expect(coachAssessmentSchema.safeParse(bad).success, ref).toBe(false);
    }
    const ok = validAssessment();
    (ok.horizonCheck as Record<string, unknown>[])[0]!.ref = "NOTGROSCHEN";
    expect(coachAssessmentSchema.safeParse(ok).success).toBe(true);
  });
});

describe("coachChatReplySchema", () => {
  const valid = { answer: "Gerne.", followUpQuestions: ["Mehr?"], declinedSecurityAdvice: false };

  it("akzeptiert eine gültige Antwort", () => {
    expect(coachChatReplySchema.safeParse(valid).success).toBe(true);
  });

  it("lehnt leere answer, > 3 Folgefragen und fehlendes Flag ab", () => {
    expect(coachChatReplySchema.safeParse({ ...valid, answer: "  " }).success).toBe(false);
    expect(
      coachChatReplySchema.safeParse({ ...valid, followUpQuestions: ["a", "b", "c", "d"] })
        .success,
    ).toBe(false);
    expect(
      coachChatReplySchema.safeParse({ answer: "x", followUpQuestions: [] }).success,
    ).toBe(false);
  });
});

describe("Request-Schemas", () => {
  it("lehnt ungültige Sparraten ab", () => {
    for (const rate of [-1, 1.5, 10_000_001]) {
      expect(
        coachAssessmentRequestSchema.safeParse({ monthlySavingsRateCents: rate }).success,
      ).toBe(false);
    }
    expect(coachAssessmentRequestSchema.safeParse({}).success).toBe(true);
    expect(
      coachAssessmentRequestSchema.safeParse({ monthlySavingsRateCents: 10_000_000 }).success,
    ).toBe(true);
  });

  it("lehnt ungültige Chat-Requests ab", () => {
    const user = { role: "user" as const, text: "Hallo" };
    expect(coachChatRequestSchema.safeParse({ messages: [user] }).success).toBe(true);
    expect(coachChatRequestSchema.safeParse({ messages: [] }).success).toBe(false);
    expect(
      coachChatRequestSchema.safeParse({
        messages: [user, { role: "coach", text: "Antwort" }],
      }).success,
    ).toBe(false);
    expect(
      coachChatRequestSchema.safeParse({ messages: [{ role: "user", text: "a".repeat(1001) }] })
        .success,
    ).toBe(false);
    expect(
      coachChatRequestSchema.safeParse({ messages: Array(41).fill(user) }).success,
    ).toBe(false);
  });

  it("erlaubt Coach-Nachrichten bis 2.000, Nutzer-Nachrichten nur bis 1.000 Zeichen", () => {
    const user = { role: "user" as const, text: "Frage" };
    expect(
      coachChatRequestSchema.safeParse({
        messages: [{ role: "user", text: "x" }, { role: "coach", text: "a".repeat(2000) }, user],
      }).success,
    ).toBe(true);
    expect(
      coachChatRequestSchema.safeParse({
        messages: [{ role: "user", text: "x" }, { role: "coach", text: "a".repeat(2001) }, user],
      }).success,
    ).toBe(false);
    expect(
      coachChatRequestSchema.safeParse({ messages: [{ role: "user", text: "a".repeat(1001) }] })
        .success,
    ).toBe(false);
  });

  it("lehnt einen vom Client eingeschleusten context ab", () => {
    expect(
      coachChatRequestSchema.safeParse({
        messages: [{ role: "user", text: "Hallo" }],
        context: "{}",
      }).success,
    ).toBe(false);
    expect(
      coachAssessmentRequestSchema.safeParse({ context: "{}" }).success,
    ).toBe(false);
  });
});
