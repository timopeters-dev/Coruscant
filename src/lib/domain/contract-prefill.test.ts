import { describe, expect, it } from "vitest";
import { buildContractPrefillFromExtraction } from "./contract-prefill";

describe("buildContractPrefillFromExtraction", () => {
  it("maps complete loan extraction without review hints", () => {
    const result = buildContractPrefillFromExtraction({
      documentDate: "2026-01-15",
      issuer: "Fallback Bank",
      detectedBalanceCents: 20_000_000,
      todayIsoDate: "2026-11-16",
      extractedContract: {
        name: "Hauskredit Musterbank",
        provider: "Musterbank AG",
        category: "loan",
        currentBalanceCents: 29_500_000,
        balanceAsOfDate: "2026-02-01",
        monthlyRateCents: 140_000,
        interestRateBps: 345,
        repaymentType: "annuity",
        specialRepaymentMaxYearlyCents: 1_000_000,
        fixedInterestUntil: "2034-02-01",
        milestoneDate: "2034-02-01",
        milestoneLabel: "Ende Zinsbindung",
      },
    });

    expect(result.hasExtractedContract).toBe(true);
    expect(result.reviewHints).toEqual([]);
    expect(result.values).toEqual({
      name: "Hauskredit Musterbank",
      provider: "Musterbank AG",
      category: "loan",
      currentBalanceCents: 29_500_000,
      balanceAsOfDate: "2026-02-01",
      monthlyRateCents: 140_000,
      interestRateBps: 345,
      repaymentType: "annuity",
      specialRepaymentMaxYearlyCents: 1_000_000,
      fixedInterestUntil: "2034-02-01",
      targetSumCents: null,
      allocationThresholdPercent: null,
      futureLoanInterestRateBps: null,
      milestoneDate: "2034-02-01",
      milestoneLabel: "Ende Zinsbindung",
    });
  });

  it("maps complete savings_contract extraction", () => {
    const result = buildContractPrefillFromExtraction({
      documentDate: "2026-03-01",
      issuer: "Muster-Bausparkasse",
      detectedBalanceCents: null,
      todayIsoDate: "2026-11-16",
      extractedContract: {
        name: "Bausparvertrag Tarif Klassik",
        provider: null,
        category: "savings_contract",
        currentBalanceCents: 1_250_000,
        balanceAsOfDate: "2026-03-01",
        monthlyRateCents: 25_000,
        interestRateBps: 50,
        targetSumCents: 5_000_000,
        allocationThresholdPercent: 40,
        futureLoanInterestRateBps: 250,
        milestoneDate: "2029-06-01",
        milestoneLabel: "Zuteilung",
      },
    });

    expect(result.hasExtractedContract).toBe(true);
    expect(result.reviewHints).toEqual([]);
    expect(result.values.category).toBe("savings_contract");
    expect(result.values.provider).toBe("Muster-Bausparkasse");
    expect(result.values.targetSumCents).toBe(5_000_000);
    expect(result.values.allocationThresholdPercent).toBe(40);
    expect(result.values.futureLoanInterestRateBps).toBe(250);
  });

  it("handles partial extraction and populates reviewHints for missing fields", () => {
    const result = buildContractPrefillFromExtraction({
      documentDate: null,
      issuer: "Musterbank",
      detectedBalanceCents: null,
      todayIsoDate: "2026-11-16",
      extractedContract: {
        name: null,
        category: "loan",
        currentBalanceCents: null,
        balanceAsOfDate: null,
        monthlyRateCents: null,
        interestRateBps: 345,
      },
    });

    expect(result.values.name).toBeNull();
    expect(result.values.provider).toBe("Musterbank");
    expect(result.values.currentBalanceCents).toBeNull();
    expect(result.values.balanceAsOfDate).toBe("2026-11-16");
    expect(result.values.monthlyRateCents).toBeNull();
    expect(result.values.interestRateBps).toBe(345);
    expect(result.reviewHints).toEqual([
      "Vertragsname",
      "Restschuld / Guthaben",
      "Stichtag (Fallback genutzt)",
      "Monatsrate",
    ]);
  });

  it("treats explicit 0-cent and 0-bps values as recognized (no falsy check)", () => {
    const result = buildContractPrefillFromExtraction({
      documentDate: "2026-01-10",
      issuer: "Familie Muster",
      detectedBalanceCents: null,
      todayIsoDate: "2026-11-16",
      extractedContract: {
        name: "Zinsloses Privatdarlehen",
        provider: "Familie Muster",
        category: "loan",
        currentBalanceCents: 0,
        balanceAsOfDate: "2026-01-10",
        monthlyRateCents: 0,
        interestRateBps: 0,
        repaymentType: "lump_sum",
      },
    });

    expect(result.values.currentBalanceCents).toBe(0);
    expect(result.values.monthlyRateCents).toBe(0);
    expect(result.values.interestRateBps).toBe(0);
    expect(result.reviewHints).toEqual([]);
  });

  it("uses fallback chain for balanceAsOfDate and detectedBalanceCents", () => {
    const withDocDate = buildContractPrefillFromExtraction({
      documentDate: "2026-04-20",
      issuer: "Musterbank",
      detectedBalanceCents: 18_500_000,
      todayIsoDate: "2026-11-16",
      extractedContract: null,
    });

    expect(withDocDate.hasExtractedContract).toBe(false);
    expect(withDocDate.values.balanceAsOfDate).toBe("2026-04-20");
    expect(withDocDate.values.currentBalanceCents).toBe(18_500_000);
    expect(withDocDate.values.provider).toBe("Musterbank");
    expect(withDocDate.reviewHints).toEqual([
      "Vertragsname",
      "Restschuld / Guthaben (Fallback genutzt)",
      "Stichtag (Fallback genutzt)",
      "Monatsrate",
      "Zinssatz",
    ]);
  });
});
