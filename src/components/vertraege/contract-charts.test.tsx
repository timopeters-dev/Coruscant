import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { FinancialContractRow } from "@/db/queries/contracts";
import { projectContractBalance } from "@/lib/domain/contracts";
import { LoanAmortizationSection } from "./loan-amortization-section";
import { SavingsProgressSection } from "./savings-progress-section";

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
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("Contract projection charts X-axis", () => {
  it("LoanAmortizationSection ends X-axis with projection end date (MM/JJJJ), not 'heute'", () => {
    const html = renderToStaticMarkup(
      <LoanAmortizationSection
        contract={makeLoanRow()}
        asOfDate="2026-11-19"
      />,
    );
    expect(html).toContain(">01/2026</text>");
    expect(html).not.toContain(">heute</text>");
    // "Heute" remains as marker
    expect(html).toContain("Heute");
  });

  it("SavingsProgressSection ends X-axis with projection end date (MM/JJJJ), not 'heute'", () => {
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
    expect(html).toContain(">01/2026</text>");
    expect(html).not.toContain(">heute</text>");
  });
});
