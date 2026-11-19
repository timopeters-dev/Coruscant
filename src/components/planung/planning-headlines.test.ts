import { describe, expect, it } from "vitest";
import {
  buildPrepaymentDefaults,
  type PrepaymentVsEtfResult,
} from "@/lib/domain/scenarios";
import {
  buildFreeMoneyHeadlines,
  buildSalaryHeadlines,
  formatAfterDurationDE,
  formatDurationDE,
} from "./planning-headlines";
import type { FreeMoneyView, LoanOption, SalaryView } from "./planning-state";

const dummyLoan: LoanOption = {
  id: "loan-1",
  name: "Musterbank Kredit",
  provider: "Musterbank",
  defaults: buildPrepaymentDefaults(
    {
      id: "loan-1",
      name: "Musterbank Kredit",
      category: "loan",
      status: "active",
      currentBalanceCents: 10_000_000,
      balanceAsOfDate: "2026-03-01",
      monthlyRateCents: 80_000,
      interestRateBps: 350,
      repaymentType: "annuity",
      fixedInterestUntil: "2041-03-01",
      specialRepaymentMaxYearlyCents: 500_000,
    },
    "2026-03-01",
  ),
};

function makeFreeMoneyOk(
  winner: "etf" | "prepayment" | "equal",
  netAdvantageEtfCents: number,
): FreeMoneyView {
  const result = {
    horizonMonths: 180,
    winner,
    netAdvantageEtfCents,
    interestSavedCents: 100_000,
    capLimitedOverflowCents: 0,
    flags: {
      capUnknown: false,
      rateBelowInterest: false,
      horizonElapsed: false,
    },
    etf: {
      etfTax: { netValueCents: 2_000_000 },
    },
    timeline: [],
  } as unknown as PrepaymentVsEtfResult;

  return {
    kind: "ok",
    loan: dummyLoan,
    horizonEndDate: "2041-03-01",
    input: {
      loan: dummyLoan.defaults.loan,
      startDate: "2026-03-01",
      horizonEndDate: "2041-03-01",
      oneTimeAmountCents: 1_000_000,
      monthlyAmountCents: 20_000,
      specialRepaymentUsedThisYearCents: 0,
      saverAllowanceCents: 100_000,
      churchTaxBps: 0,
      etfAnnualReturnBps: 600,
    },
    result,
  };
}

const NO_CENTS_REGEX = /,\d{2}\s*€/;

describe("formatDurationDE & formatAfterDurationDE", () => {
  it("handles singular, plural, and dative correctly", () => {
    expect(formatDurationDE(0)).toBe("sofort");
    expect(formatDurationDE(1)).toBe("1 Monat");
    expect(formatDurationDE(2)).toBe("2 Monate");
    expect(formatDurationDE(11)).toBe("11 Monate");
    expect(formatDurationDE(12)).toBe("1 Jahr");
    expect(formatDurationDE(13)).toBe("1 Jahr und 1 Monat");
    expect(formatDurationDE(24)).toBe("2 Jahre");
    expect(formatDurationDE(183)).toBe("15 Jahre und 3 Monate");

    expect(formatAfterDurationDE(0)).toBe("sofort");
    expect(formatAfterDurationDE(1)).toBe("1 Monat");
    expect(formatAfterDurationDE(7)).toBe("7 Monaten");
    expect(formatAfterDurationDE(12)).toBe("1 Jahr");
    expect(formatAfterDurationDE(180)).toBe("15 Jahren");
    expect(formatAfterDurationDE(183)).toBe("15 Jahren und 3 Monaten");
  });
});

describe("buildFreeMoneyHeadlines", () => {
  it("formats etf, prepayment, equal, and break-even variants without cents", () => {
    const etf = buildFreeMoneyHeadlines(makeFreeMoneyOk("etf", 1_234_550), {
      kind: "bps",
      bps: 340,
    });
    expect(etf.primary).toBe(
      "Nach 15 Jahren (03/2041): ETF-Ansparung liegt 12.346 € vor der Sondertilgung.",
    );
    expect(etf.secondary).toContain("3,40 %");
    expect(etf.primary).not.toMatch(NO_CENTS_REGEX);

    const prep = buildFreeMoneyHeadlines(
      makeFreeMoneyOk("prepayment", -421_000),
      { kind: "unreachable" },
    );
    expect(prep.primary).toContain("Sondertilgung liegt 4.210 € vor dem ETF.");
    expect(prep.secondary).toContain("30 % Rendite");

    const eq = buildFreeMoneyHeadlines(makeFreeMoneyOk("equal", 0), {
      kind: "identical",
    });
    expect(eq.primary).toContain("liegen beide Wege gleichauf");
    expect(eq.secondary).toContain("keine Rolle");

    expect(
      buildFreeMoneyHeadlines({ kind: "zero_budget", loan: dummyLoan }, null)
        .primary,
    ).toContain("0 €");
    expect(buildFreeMoneyHeadlines({ kind: "no_loans" }, null).primary).toContain(
      "Ohne Kredit",
    );

    const subFiftyCents = buildFreeMoneyHeadlines(
      makeFreeMoneyOk("etf", 49),
      null,
    );
    expect(subFiftyCents.primary).toBe(
      "Nach 15 Jahren (03/2041) liegen beide Wege gleichauf.",
    );

    const zeroMonthsView = makeFreeMoneyOk("prepayment", -20_000);
    if (zeroMonthsView.kind === "ok") {
      zeroMonthsView.result.horizonMonths = 0;
    }
    const zeroMonths = buildFreeMoneyHeadlines(zeroMonthsView, null);
    expect(zeroMonths.primary).toBe(
      "Bis 03/2041: Sondertilgung liegt 200 € vor dem ETF.",
    );
    expect(zeroMonths.primary).not.toContain("sofort");
  });
});

describe("buildSalaryHeadlines", () => {
  const baseSalaryView = (
    overrides: Partial<Extract<SalaryView, { kind: "ok" }>>,
  ): SalaryView => ({
    kind: "ok",
    input: {
      startMonth: "2027-01",
      baseMonthlySurplusCents: 75_000,
      change: { effectiveFromMonth: "2027-03", deltaMonthlyCents: 50_000 },
      pots: [],
      horizonMonths: 360,
    },
    result: {
      horizonMonths: 360,
      scenarioSurplusAfterChangeCents: 125_000,
      baselineDeficitMonths: 0,
      scenarioDeficitMonths: 0,
      pots: [
        {
          potId: "p1",
          potName: "Urlaub",
          priority: 1,
          targetCents: 200_000,
          hasTarget: true,
          alreadyFilled: false,
          baselineMonthsToFill: 10,
          baselineFillMonth: "2027-10",
          scenarioMonthsToFill: 9,
          scenarioFillMonth: "2027-09",
          monthsGained: 1,
        },
      ],
    },
    targetPotCount: 1,
    hiddenPotCount: 0,
    baseSurplusNonPositive: false,
    ...overrides,
  });

  it("handles earlier, later, unchanged, unreached, already filled, and deficit", () => {
    const earlier = buildSalaryHeadlines(baseSalaryView({}), "2027-01");
    expect(earlier.primary).toContain("1 Monat früher als heute");
    expect(earlier.secondary).toContain("1.250 €");
    expect(earlier.tone).toBe("neutral");

    const deficit = buildSalaryHeadlines(
      baseSalaryView({
        input: {
          startMonth: "2027-01",
          baseMonthlySurplusCents: 75_000,
          change: { effectiveFromMonth: "2027-03", deltaMonthlyCents: -90_000 },
          pots: [],
          horizonMonths: 360,
        },
        result: {
          horizonMonths: 360,
          scenarioSurplusAfterChangeCents: -15_000,
          baselineDeficitMonths: 0,
          scenarioDeficitMonths: 12,
          pots: [
            {
              potId: "p1",
              potName: "Urlaub",
              priority: 1,
              targetCents: 200_000,
              hasTarget: true,
              alreadyFilled: false,
              baselineMonthsToFill: 10,
              baselineFillMonth: "2027-10",
              scenarioMonthsToFill: null,
              scenarioFillMonth: null,
              monthsGained: null,
            },
          ],
        },
      }),
      "2027-01",
    );
    expect(deficit.primary).toContain("1 von 1 Ziel-Töpfen werden in 30 Jahren nicht voll.");
    expect(deficit.tone).toBe("warning");
  });
});
