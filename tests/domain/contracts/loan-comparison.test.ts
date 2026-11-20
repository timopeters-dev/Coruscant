import { describe, expect, it } from "vitest";
import type { DomainContract } from "@/domain/contracts/contract";
import {
  buildLoanComparison,
  LOAN_COMPARISON_PROBE_CENTS,
  type LoanComparisonAssumptions,
} from "@/domain/contracts/loan-comparison";

const defaultAssumptions: LoanComparisonAssumptions = {
  etfAnnualReturnBps: 600,
  safetyMarginBps: 100,
  saverAllowanceCents: 100_000,
  churchTaxBps: 0,
};

function makeLoan(overrides: Partial<DomainContract> = {}): DomainContract {
  return {
    id: "loan-muster-1",
    name: "Hauskredit Musterbank",
    category: "loan",
    status: "active",
    currentBalanceCents: 20_000_000,
    balanceAsOfDate: "2026-01-01",
    monthlyRateCents: 100_000,
    interestRateBps: 380,
    repaymentType: "annuity",
    fixedInterestUntil: "2036-01-01",
    originalPrincipalCents: 25_000_000,
    specialRepaymentRight: "allowed",
    specialRepaymentBasis: "percent_original",
    specialRepaymentPercentBps: 500,
    rateChangeRight: "allowed",
    rateChangeTotalCount: 2,
    rateChangeScope: "fixed_period",
    rateChangeUsedCount: 0,
    rateChangeMinRepaymentBps: 100,
    rateChangeMaxRepaymentBps: 500,
    ...overrides,
  };
}

describe("buildLoanComparison", () => {
  it("excludes non-loans, paused/closed loans, and zero-balance loans", () => {
    const contracts: DomainContract[] = [
      makeLoan({ id: "sav-1", category: "savings_contract", repaymentType: null }),
      makeLoan({ id: "paused-1", status: "paused" }),
      makeLoan({ id: "closed-1", status: "closed" }),
      makeLoan({ id: "zero-1", currentBalanceCents: 0 }),
    ];
    expect(
      buildLoanComparison(contracts, {
        asOfDate: "2026-11-19",
        assumptions: defaultAssumptions,
      }),
    ).toEqual([]);
  });

  it("sorts higher break-even first, then interestRateBps descending, then id ascending", () => {
    const highRate = makeLoan({
      id: "loan-b",
      name: "Musterbank 4,2%",
      interestRateBps: 420,
    });
    const lowRate = makeLoan({
      id: "loan-a",
      name: "Beispielkasse 1,2%",
      interestRateBps: 120,
    });
    const rows = buildLoanComparison([lowRate, highRate], {
      asOfDate: "2026-11-19",
      assumptions: defaultAssumptions,
    });
    expect(rows.map((r) => r.loanId)).toEqual(["loan-b", "loan-a"]);

    // Tie-breaking by id when break-even and interestRateBps are identical
    const tie2 = makeLoan({ id: "loan-2", interestRateBps: 300 });
    const tie1 = makeLoan({ id: "loan-1", interestRateBps: 300 });
    const tiedRows = buildLoanComparison([tie2, tie1], {
      asOfDate: "2026-11-19",
      assumptions: defaultAssumptions,
    });
    expect(tiedRows.map((r) => r.loanId)).toEqual(["loan-1", "loan-2"]);
  });

  it("limits special probe to remaining allowance and returns null when right is none", () => {
    const limited = makeLoan({
      id: "loan-lim",
      specialRepaymentRight: "allowed",
      specialRepaymentBasis: "fixed_yearly",
      specialRepaymentMaxYearlyCents: 100_000,
      specialRepaymentPercentBps: null,
      specialRepaymentUsedCents: 70_000,
      specialRepaymentUsedYear: 2026,
    });
    const none = makeLoan({
      id: "loan-none",
      specialRepaymentRight: "none",
      specialRepaymentBasis: null,
      specialRepaymentPercentBps: null,
      specialRepaymentMaxYearlyCents: null,
    });
    const rows = buildLoanComparison([limited, none], {
      asOfDate: "2026-11-19",
      assumptions: defaultAssumptions,
    });
    const limRow = rows.find((r) => r.loanId === "loan-lim")!;
    expect(limRow.special?.probeCents).toBe(30_000);
    expect(limRow.special?.probeLimited).toBe(true);

    const noneRow = rows.find((r) => r.loanId === "loan-none")!;
    expect(noneRow.special).toBeNull();
  });

  it("limits rate probe to corridor headroom and returns null for lump_sum, none, or exhausted", () => {
    const narrow = makeLoan({
      id: "loan-narrow",
      monthlyRateCents: 100_000,
      rateChangeMinRepaymentBps: null,
      rateChangeMaxRepaymentBps: null,
      rateChangeMinMonthlyCents: 80_000,
      rateChangeMaxMonthlyCents: 104_000, // only +40 € headroom
    });
    const lump = makeLoan({
      id: "loan-lump",
      repaymentType: "lump_sum",
      monthlyRateCents: 0,
    });
    const noRc = makeLoan({
      id: "loan-norc",
      rateChangeRight: "none",
      rateChangeMinRepaymentBps: null,
      rateChangeMaxRepaymentBps: null,
    });
    const exhausted = makeLoan({
      id: "loan-exh",
      rateChangeTotalCount: 2,
      rateChangeUsedCount: 2,
    });

    const rows = buildLoanComparison([narrow, lump, noRc, exhausted], {
      asOfDate: "2026-11-19",
      assumptions: defaultAssumptions,
    });
    const narrowRow = rows.find((r) => r.loanId === "loan-narrow")!;
    expect(narrowRow.rate?.probeCents).toBe(4_000);
    expect(narrowRow.rate?.probeLimited).toBe(true);
    expect(narrowRow.special?.probeCents).toBe(LOAN_COMPARISON_PROBE_CENTS);
    expect(narrowRow.special?.probeLimited).toBe(false);

    expect(rows.find((r) => r.loanId === "loan-lump")!.rate).toBeNull();
    expect(rows.find((r) => r.loanId === "loan-norc")!.rate).toBeNull();
    expect(rows.find((r) => r.loanId === "loan-exh")!.rate).toBeNull();
  });

  it("computes verdict 'close' within safetyMarginBps and exact boundary ±1 bps", () => {
    const loan = makeLoan({ interestRateBps: 380 });
    const probe = buildLoanComparison([loan], {
      asOfDate: "2026-11-19",
      assumptions: defaultAssumptions,
    })[0]!;
    expect(probe.bestBreakEven?.kind).toBe("bps");
    const beBps = probe.bestBreakEven!.kind === "bps" ? probe.bestBreakEven!.bps : 0;

    const atMarginMinus1 = buildLoanComparison([loan], {
      asOfDate: "2026-11-19",
      assumptions: {
        ...defaultAssumptions,
        etfAnnualReturnBps: beBps + 99,
        safetyMarginBps: 100,
      },
    })[0]!;
    expect(atMarginMinus1.verdict).toBe("close");

    const atMarginExact = buildLoanComparison([loan], {
      asOfDate: "2026-11-19",
      assumptions: {
        ...defaultAssumptions,
        etfAnnualReturnBps: beBps + 100,
        safetyMarginBps: 100,
      },
    })[0]!;
    expect(atMarginExact.verdict).toBe("etf");

    const belowMarginExact = buildLoanComparison([loan], {
      asOfDate: "2026-11-19",
      assumptions: {
        ...defaultAssumptions,
        etfAnnualReturnBps: beBps - 100,
        safetyMarginBps: 100,
      },
    })[0]!;
    expect(belowMarginExact.verdict).toBe("loan");

    const belowMarginPlus1 = buildLoanComparison([loan], {
      asOfDate: "2026-11-19",
      assumptions: {
        ...defaultAssumptions,
        etfAnnualReturnBps: beBps - 99,
        safetyMarginBps: 100,
      },
    })[0]!;
    expect(belowMarginPlus1.verdict).toBe("close");
  });
});
