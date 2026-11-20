import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { FinancialContractRow } from "@/db/queries/contracts";
import { projectContractBalance } from "@/lib/domain/contracts";
import { LoanAmortizationSection } from "./loan-amortization-section";
import { SavingsProgressSection } from "./savings-progress-section";

const DEFAULT_LOAN_OPTION_COLUMNS = {
  originalPrincipalCents: null,
  specialRepaymentRight: "unknown" as const,
  specialRepaymentBasis: null,
  specialRepaymentPercentBps: null,
  specialRepaymentUsedCents: null,
  specialRepaymentUsedYear: null,
  rateChangeRight: "unknown" as const,
  rateChangeTotalCount: null,
  rateChangeScope: null,
  rateChangeUsedCount: 0,
  rateChangeMinRepaymentBps: null,
  rateChangeMaxRepaymentBps: null,
  rateChangeMinMonthlyCents: null,
  rateChangeMaxMonthlyCents: null,
  loanOptionsNote: null,
};

function makeLoanRow(
  overrides: Partial<FinancialContractRow> = {},
): FinancialContractRow {
  return {
    id: "loan-muster-1",
    name: "Hauskredit Musterstraße 1",
    provider: "Musterbank",
    category: "loan",
    status: "active",
    currentBalanceCents: 20_000_000,
    balanceAsOfDate: "2026-01-01",
    monthlyRateCents: 120_000,
    interestRateBps: 350,
    linkedPropertyId: null,
    milestoneDate: null,
    milestoneLabel: null,
    repaymentType: "annuity",
    specialRepaymentMaxYearlyCents: 1_000_000,
    fixedInterestUntil: "2036-01-01",
    targetSumCents: null,
    allocationThresholdPercent: null,
    futureLoanInterestRateBps: null,
    ...DEFAULT_LOAN_OPTION_COLUMNS,
    specialRepaymentRight: "allowed",
    specialRepaymentBasis: "fixed_yearly",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function makeSavingsRow(
  overrides: Partial<FinancialContractRow> = {},
): FinancialContractRow {
  return {
    id: "bauspar-muster-1",
    name: "Bausparvertrag Musterbank",
    provider: "Musterbank",
    category: "savings_contract",
    status: "active",
    currentBalanceCents: 1_500_000,
    balanceAsOfDate: "2026-01-01",
    monthlyRateCents: 30_000,
    interestRateBps: 100,
    linkedPropertyId: null,
    milestoneDate: null,
    milestoneLabel: null,
    repaymentType: null,
    specialRepaymentMaxYearlyCents: null,
    fixedInterestUntil: null,
    targetSumCents: 5_000_000,
    allocationThresholdPercent: 40,
    futureLoanInterestRateBps: 250,
    ...DEFAULT_LOAN_OPTION_COLUMNS,
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("Contract projection charts X-axis", () => {
  it("LoanAmortizationSection ends X-axis with projection end date (MM.JJJJ), not 'heute'", () => {
    const html = renderToStaticMarkup(
      <LoanAmortizationSection
        contract={makeLoanRow()}
        asOfDate="2026-11-19"
      />,
    );
    expect(html).toContain(">01.2026</text>");
    expect(html).not.toContain(">heute</text>");
    // "Heute" remains as marker
    expect(html).toContain("Heute");
  });

  it("LoanAmortizationSection simulator sets special slider max to remaining allowance and rate slider min/max to corridor", () => {
    const html = renderToStaticMarkup(
      <LoanAmortizationSection
        contract={makeLoanRow({
          originalPrincipalCents: 25_000_000,
          specialRepaymentRight: "allowed",
          specialRepaymentBasis: "percent_original",
          specialRepaymentPercentBps: 500, // 12.500 €
          specialRepaymentMaxYearlyCents: null,
          specialRepaymentUsedCents: 200_000, // 2.000 € used -> 10.500 € remaining
          specialRepaymentUsedYear: 2026,
          rateChangeRight: "allowed",
          rateChangeTotalCount: 2,
          rateChangeScope: "fixed_period",
          rateChangeUsedCount: 0,
          rateChangeMinMonthlyCents: 90_000, // 900 €
          rateChangeMaxMonthlyCents: 180_000, // 1.800 €
        })}
        asOfDate="2026-11-19"
        defaultSimulatorOpen={true}
      />,
    );
    // Special repayment slider max = 10500 (€)
    expect(html).toMatch(
      /id="sr-amount-loan-muster-1"[^>]*max="10500"/,
    );
    // Rate slider min = 900 (€) and max = 1800 (€)
    expect(html).toMatch(
      /id="rate-amount-loan-muster-1"[^>]*min="900"[^>]*max="1800"/,
    );
    // Link to ETF comparison with ?kredit=
    expect(html).toContain(
      "/planung?frage=geld&amp;ansicht=vergleich&amp;kredit=loan-muster-1",
    );
  });

  it("LoanAmortizationSection disables special & rate sliders with reasons when right is none", () => {
    const html = renderToStaticMarkup(
      <LoanAmortizationSection
        contract={makeLoanRow({
          specialRepaymentRight: "none",
          specialRepaymentBasis: null,
          specialRepaymentMaxYearlyCents: null,
          rateChangeRight: "none",
        })}
        asOfDate="2026-11-19"
        defaultSimulatorOpen={true}
      />,
    );
    expect(html).toMatch(/id="sr-amount-loan-muster-1"[^>]*disabled=""/);
    expect(html).toContain("Sondertilgung laut Vertrag nicht möglich.");
    expect(html).toMatch(/id="rate-amount-loan-muster-1"[^>]*disabled=""/);
    expect(html).toContain("Tilgungssatzwechsel laut Vertrag nicht möglich.");
  });

  it("SavingsProgressSection ends X-axis with projection end date (MM.JJJJ), not 'heute'", () => {
    const row = makeSavingsRow();
    const projection = projectContractBalance(
      {
        id: row.id,
        name: row.name,
        category: row.category,
        status: row.status,
        currentBalanceCents: row.currentBalanceCents,
        balanceAsOfDate: row.balanceAsOfDate,
        monthlyRateCents: row.monthlyRateCents,
        interestRateBps: row.interestRateBps,
        repaymentType: row.repaymentType,
        milestoneDate: row.milestoneDate,
        milestoneLabel: row.milestoneLabel,
        fixedInterestUntil: row.fixedInterestUntil,
        targetSumCents: row.targetSumCents,
        allocationThresholdPercent: row.allocationThresholdPercent,
        specialRepaymentMaxYearlyCents: row.specialRepaymentMaxYearlyCents,
      },
      "2026-11-19",
    );
    const html = renderToStaticMarkup(
      <SavingsProgressSection
        contract={row}
        projection={projection}
        asOfDate="2026-11-19"
      />,
    );
    expect(html).toContain(">01.2026</text>");
    expect(html).not.toContain(">heute</text>");
  });
});
