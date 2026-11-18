import { describe, expect, it } from "vitest";
import {
  buildLoanDraftFromPurchase,
  buildPurchaseDraftSearchParams,
  parsePurchaseDraft,
} from "./property-draft";

describe("property-draft validation", () => {
  it("parses a valid purchase draft and defaults missing optional values to 0 / null", () => {
    const res = parsePurchaseDraft({
      entwurf: "kaufrechner",
      kp: "25000000",
    });

    expect(res.reason).toBeNull();
    expect(res.draft).toEqual({
      purchasePriceCents: 25_000_000,
      monthlyColdRentCents: 0,
      monthlyNonRecoverableCostsCents: 0,
      monthlyMaintenanceAllowanceCents: 0,
      loanAmountCents: 0,
      monthlyRateCents: 0,
      interestRateBps: 0,
      fixedRateYears: null,
    });
  });

  it("returns null without reason when entwurf is absent, and null with reason when invalid", () => {
    expect(parsePurchaseDraft({})).toEqual({ draft: null, reason: null });

    const wrongSource = parsePurchaseDraft({
      entwurf: "anderes",
      kp: "25000000",
    });
    expect(wrongSource.draft).toBeNull();
    expect(wrongSource.reason).toBeTruthy();

    const missingKp = parsePurchaseDraft({ entwurf: "kaufrechner" });
    expect(missingKp.draft).toBeNull();
    expect(missingKp.reason).toBeTruthy();

    for (const badKp of ["-100", "abc", "123.45", "", "99999999999"]) {
      const bad = parsePurchaseDraft({ entwurf: "kaufrechner", kp: badKp });
      expect(bad.draft).toBeNull();
      expect(bad.reason).toBeTruthy();
    }
  });

  it("ignores unknown parameters and contains no address or name fields (allowlist)", () => {
    const params = buildPurchaseDraftSearchParams(
      {
        purchasePriceCents: 25_000_000,
        monthlyColdRentCents: 80_000,
        monthlyNonRecoverableCostsCents: 6_000,
        monthlyMaintenanceCents: 5_000,
        interestRateBps: 350,
        fixedRateYears: 10,
      },
      {
        loan: {
          principalCents: 20_000_000,
          monthlyRateCents: 91_667,
          firstMonthInterestCents: 58_333,
          firstMonthPrincipalCents: 33_334,
          fixedRateMonths: 120,
          remainingDebtCents: 15_000_000,
          totalInterestInFixedPeriodCents: 5_000_000,
          paidOffInMonth: null,
        },
      },
    );

    expect(Array.from(params.keys()).sort()).toEqual([
      "darlehen",
      "entwurf",
      "ihr",
      "kp",
      "miete",
      "nuk",
      "rate",
      "zb",
      "zins",
    ]);

    params.set("name", "Geheim");
    params.set("street", "Geheimstraße 1");

    const parsed = parsePurchaseDraft(params);
    expect(parsed.reason).toBeNull();
    expect(parsed.draft).toEqual({
      purchasePriceCents: 25_000_000,
      monthlyColdRentCents: 80_000,
      monthlyNonRecoverableCostsCents: 6_000,
      monthlyMaintenanceAllowanceCents: 5_000,
      loanAmountCents: 20_000_000,
      monthlyRateCents: 91_667,
      interestRateBps: 350,
      fixedRateYears: 10,
    });
    expect("name" in (parsed.draft ?? {})).toBe(false);
    expect("street" in (parsed.draft ?? {})).toBe(false);
  });

  it("builds loan draft with leap-year/month-end clamping and returns null when loanAmountCents is 0", () => {
    const baseDraft = {
      purchasePriceCents: 25_000_000,
      monthlyColdRentCents: 80_000,
      monthlyNonRecoverableCostsCents: 6_000,
      monthlyMaintenanceAllowanceCents: 5_000,
      loanAmountCents: 20_000_000,
      monthlyRateCents: 91_667,
      interestRateBps: 350,
      fixedRateYears: 1,
    };

    // Leap day + 1 year -> 2025-02-28
    expect(
      buildLoanDraftFromPurchase(baseDraft, "prop-1", "2024-02-29"),
    ).toEqual({
      category: "loan",
      repaymentType: "annuity",
      currentBalanceCents: 20_000_000,
      monthlyRateCents: 91_667,
      interestRateBps: 350,
      linkedPropertyId: "prop-1",
      balanceAsOfDate: "2024-02-29",
      fixedInterestUntil: "2025-02-28",
    });

    // Zero loan -> null
    expect(
      buildLoanDraftFromPurchase(
        { ...baseDraft, loanAmountCents: 0 },
        "prop-1",
        "2026-11-18",
      ),
    ).toBeNull();
  });
});
