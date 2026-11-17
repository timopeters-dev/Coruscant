import { describe, expect, it } from "vitest";
import {
  calculateRebalancingPlan,
  sanitizeAssessmentRefs,
} from "./coach-rebalancing";

const sum = (values: number[]) => values.reduce((a, b) => a + b, 0);

function plan(
  current: [number, number, number],
  target: [number, number, number],
  rate: number,
) {
  return calculateRebalancingPlan({
    currentValues: { etf: current[0], stock: current[1], crypto: current[2] },
    targetWeightsBps: { etf: target[0], stock: target[1], crypto: target[2] },
    monthlySavingsRateCents: rate,
  });
}

describe("calculateRebalancingPlan", () => {
  it("berechnet Deltas bei 70/20/10 → 80/15/5, Summe der Deltas ist 0", () => {
    const result = plan([700_000, 200_000, 100_000], [8000, 1500, 500], 50_000);
    expect(result.classes.map((c) => c.targetCents)).toEqual([800_000, 150_000, 50_000]);
    expect(result.classes.map((c) => c.deltaCents)).toEqual([100_000, -50_000, -50_000]);
    expect(sum(result.classes.map((c) => c.deltaCents))).toBe(0);
    expect(result.classes.map((c) => c.currentWeightBps)).toEqual([7000, 2000, 1000]);
  });

  it("rundet Soll-Werte exakt auf den Gesamtwert (100.001 Cent, 3333/3333/3334)", () => {
    const result = plan([50_000, 30_001, 20_000], [3333, 3333, 3334], 0);
    expect(sum(result.classes.map((c) => c.targetCents))).toBe(100_001);
    expect(sum(result.classes.map((c) => c.deltaCents))).toBe(0);
  });

  it("rechnet Zukäufe mit Aufrundung (ceil)", () => {
    // current 700k/200k/100k, Soll 70/20/10 mit Schieflage: ETF 600k soll 50 % → T' = 1.200k
    const result = plan([600_000, 300_000, 100_000], [5000, 3000, 2000], 30_000);
    // T' = max(600k*10000/5000=1.2M, 300k/0.3=1M, 100k/0.2=500k) = 1.2M; required 200k
    expect(result.contributionOnly).toEqual({
      status: "ok",
      requiredContributionCents: 200_000,
      monthsNeeded: 7, // ceil(200000 / 30000) = 6,67 → 7
    });
  });

  it("liefert required 0 / months 0, wenn bereits im Soll", () => {
    const result = plan([500_000, 300_000, 200_000], [5000, 3000, 2000], 0);
    expect(result.contributionOnly).toEqual({
      status: "ok",
      requiredContributionCents: 0,
      monthsNeeded: 0,
    });
    expect(result.classes.every((c) => c.deltaCents === 0)).toBe(true);
  });

  it("meldet requires_sale bei Soll 0 und Ist > 0", () => {
    const result = plan([900_000, 0, 100_000], [10_000, 0, 0], 50_000);
    expect(result.contributionOnly).toEqual({
      status: "unavailable",
      reason: "requires_sale",
    });
  });

  it("meldet no_savings_rate bei Sparrate 0 und Bedarf > 0", () => {
    const result = plan([600_000, 300_000, 100_000], [5000, 3000, 2000], 0);
    expect(result.contributionOnly).toEqual({
      status: "unavailable",
      reason: "no_savings_rate",
    });
    expect(result.contributionSplitCents).toEqual({ etf: 0, stock: 0, crypto: 0 });
  });

  it("meldet too_long bei mehr als 600 Monaten", () => {
    const result = plan([600_000, 300_000, 100_000], [5000, 3000, 2000], 1);
    expect(result.contributionOnly).toEqual({ status: "unavailable", reason: "too_long" });
    // Grenze: genau 600 Monate sind noch ok
    const edge = plan([600_000, 300_000, 100_000], [5000, 3000, 2000], 334);
    expect(edge.contributionOnly).toMatchObject({ status: "ok", monthsNeeded: 599 });
    const over = plan([600_000, 300_000, 100_000], [5000, 3000, 2000], 333);
    expect(over.contributionOnly).toEqual({ status: "unavailable", reason: "too_long" });
  });

  it("liefert bei Depotwert 0 nur Nullen", () => {
    const result = plan([0, 0, 0], [6000, 3000, 1000], 10_000);
    expect(result.totalCents).toBe(0);
    expect(result.classes.every((c) => c.deltaCents === 0 && c.targetCents === 0)).toBe(true);
    expect(result.contributionOnly).toEqual({
      status: "ok",
      requiredContributionCents: 0,
      monthsNeeded: 0,
    });
    expect(sum(Object.values(result.contributionSplitCents))).toBe(10_000);
  });

  it("verteilt die Sparrate exakt und nur auf untergewichtete Klassen", () => {
    const result = plan([600_000, 300_000, 100_000], [5000, 3000, 2000], 33_333);
    expect(sum(Object.values(result.contributionSplitCents))).toBe(33_333);
    expect(result.contributionSplitCents.etf).toBe(0);
    expect(result.contributionSplitCents.stock).toBeGreaterThanOrEqual(0);
    const underweight = result.classes.filter((c) => c.deltaCents > 0);
    for (const c of result.classes) {
      if (!underweight.includes(c)) {
        expect(result.contributionSplitCents[c.assetClass]).toBe(0);
      }
    }
  });

  it("wirft bei ungültigen Eingaben", () => {
    expect(() => plan([1, 1, 1], [5000, 3000, 1999], 0)).toThrow(RangeError);
    expect(() => plan([-1, 1, 1], [5000, 3000, 2000], 0)).toThrow(RangeError);
    expect(() => plan([1, 1, 1], [5000, 3000, 2000], -5)).toThrow(RangeError);
    expect(() => plan([1.5, 1, 1], [5000, 3000, 2000], 0)).toThrow(RangeError);
  });
});

describe("sanitizeAssessmentRefs", () => {
  const assessment = {
    summary: "x",
    risks: [{ title: "r", relatedRefs: ["ETF-1", "ETF-9", "NOTGROSCHEN"] }],
    horizonCheck: [{ ref: "ZIEL-1" }, { ref: "ZIEL-7" }, { ref: "NOTGROSCHEN" }],
  };

  it("entfernt unbekannte Refs und verwirft unbekannte horizonCheck-Einträge", () => {
    const result = sanitizeAssessmentRefs(assessment, new Set(["ETF-1", "ZIEL-1"]));
    expect(result.risks[0]!.relatedRefs).toEqual(["ETF-1"]);
    expect(result.horizonCheck).toEqual([{ ref: "ZIEL-1" }]);
    expect(result.summary).toBe("x");
    // Original bleibt unverändert
    expect(assessment.risks[0]!.relatedRefs).toHaveLength(3);
  });

  it("lässt NOTGROSCHEN nur zu, wenn er in validRefs steht", () => {
    expect(
      sanitizeAssessmentRefs(assessment, new Set(["NOTGROSCHEN"])).horizonCheck,
    ).toEqual([{ ref: "NOTGROSCHEN" }]);
    expect(sanitizeAssessmentRefs(assessment, new Set()).horizonCheck).toEqual([]);
  });
});
