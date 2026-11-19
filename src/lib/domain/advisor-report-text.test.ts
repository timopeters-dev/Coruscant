import { describe, expect, it } from "vitest";
import { buildAdvisorReport } from "./advisor-report";
import { buildAdvisorReportView } from "./advisor-report-anonymize";
import {
  ADVISOR_STARTER_PROMPT,
  renderAdvisorReportText,
} from "./advisor-report-text";
import { calculateHouseholdBalance } from "./balance";
import { calculateConsolidatedCashflow } from "./cashflow";

describe("advisor-report-text", () => {
  it("renders starter prompt, stand, disclaimer, modeled tags, German number formats, and assumptions", () => {
    const asOfDate = "2026-11-19";
    const properties = [
      {
        id: "prop-1",
        name: "Musterstraße 1",
        usage: "owner_occupied" as const,
        purchaseDate: "2021-01-01",
        purchasePriceCents: 40_000_000,
        estimatedValueCents: 42_000_000,
      },
    ];
    const contracts = [
      {
        id: "loan-1",
        name: "Kredit Musterbank",
        provider: "Musterbank",
        category: "loan" as const,
        status: "active" as const,
        currentBalanceCents: 123_456,
        balanceAsOfDate: "2026-10-01",
        monthlyRateCents: 10_000,
        interestRateBps: 350,
        repaymentType: "annuity" as const,
        futureLoanInterestRateBps: null,
      },
    ];
    const pots = [
      {
        id: "pot-1",
        name: "Notgroschen",
        priority: 1,
        purpose: "emergency_fund" as const,
        currentCents: 123_456,
        targetCents: 500_000,
        targetDate: null,
        ruleType: "fill_to_target" as const,
        linkedContractId: null,
        linkedPropertyId: null,
        liquidityExclusion: null,
      },
    ];
    const balance = calculateHouseholdBalance({
      asOfDate,
      properties,
      contracts,
      pots,
    });
    const cashflow = calculateConsolidatedCashflow({
      household: null,
      manualItems: [],
      variableBasis: "budget",
    });

    const report = buildAdvisorReport({
      asOfDate,
      generatedAt: "2026-11-19T10:00:00.000Z",
      snapshotFetchedAt: null,
      isDummyHousehold: false,
      balance,
      properties,
      contracts,
      pots,
      cashflow,
      history: [],
      recommendationState: {
        asOfDate,
        monthlyExpensesCents: null,
        monthlySurplusCents: 0,
        pots,
        loans: [],
      },
      oneTimeAmountCents: null,
    });

    const view = buildAdvisorReportView(report, "anonymized");
    const text = renderAdvisorReportText(view, { question: null });

    expect(text.startsWith(ADVISOR_STARTER_PROMPT)).toBe(true);
    expect(text).toContain("Stand: 19.11.2026");
    expect(text).toContain("Orientierung, keine Anlageberatung");
    expect(text).toContain("(modelliert)");
    expect(text).toContain("1.234,56 €");
    expect(text).toContain("3,50 %");
    expect(text).toContain("Annahmen:");
    expect(text).not.toContain("## 9. Wobei brauche ich Rat?");
  });

  it("includes trimmed question block only when non-empty", () => {
    const asOfDate = "2026-11-19";
    const balance = calculateHouseholdBalance({
      asOfDate,
      properties: [],
      contracts: [],
      pots: [],
    });
    const cashflow = calculateConsolidatedCashflow({
      household: null,
      manualItems: [],
      variableBasis: "budget",
    });
    const report = buildAdvisorReport({
      asOfDate,
      generatedAt: "2026-11-19T10:00:00.000Z",
      snapshotFetchedAt: null,
      isDummyHousehold: false,
      balance,
      properties: [],
      contracts: [],
      pots: [],
      cashflow,
      history: [],
      recommendationState: {
        asOfDate,
        monthlyExpensesCents: null,
        monthlySurplusCents: 0,
        pots: [],
        loans: [],
      },
      oneTimeAmountCents: null,
    });
    const view = buildAdvisorReportView(report, "anonymized");

    const whitespaceText = renderAdvisorReportText(view, {
      question: "   \n  ",
    });
    expect(whitespaceText).not.toContain("## 9. Wobei brauche ich Rat?");
    expect(whitespaceText).toContain("keine Daten");

    const withQuestion = renderAdvisorReportText(view, {
      question: "  Soll ich erst tilgen oder anlegen?  ",
    });
    expect(withQuestion).toContain("## 9. Wobei brauche ich Rat?");
    expect(withQuestion).toContain("Soll ich erst tilgen oder anlegen?");
  });
});
