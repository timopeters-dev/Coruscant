import { describe, expect, it } from "vitest";
import { buildAdvisorReport } from "@/domain/report/report";
import { buildAdvisorReportView } from "@/domain/report/anonymize";
import {
  ADVISOR_STARTER_PROMPT,
  renderAdvisorReportText,
} from "@/domain/report/text";
import { calculateHouseholdBalance } from "@/domain/cockpit/balance";
import { calculateConsolidatedCashflow } from "@/domain/allocation/cashflow";

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

  it("formats loan special repayment and rate change lines without cent digits and names unknown rights explicitly", () => {
    const asOfDate = "2026-11-19";
    const contracts = [
      {
        id: "loan-1",
        name: "Hauskredit Musterstraße 1",
        provider: "Musterbank",
        category: "loan" as const,
        status: "active" as const,
        currentBalanceCents: 20_000_000,
        balanceAsOfDate: "2026-11-01",
        monthlyRateCents: 120_000,
        interestRateBps: 380,
        repaymentType: "annuity" as const,
        fixedInterestUntil: "2036-06-15",
        futureLoanInterestRateBps: null,
        originalPrincipalCents: 25_000_000,
        specialRepaymentRight: "allowed" as const,
        specialRepaymentBasis: "percent_original" as const,
        specialRepaymentPercentBps: 500,
        specialRepaymentUsedCents: 200_000,
        specialRepaymentUsedYear: 2026,
        rateChangeRight: "allowed" as const,
        rateChangeTotalCount: 2,
        rateChangeScope: "fixed_period" as const,
        rateChangeUsedCount: 1,
        rateChangeMinRepaymentBps: 100,
        rateChangeMaxRepaymentBps: 500,
        loanOptionsNote: "Lokale Notiz Erika Musterfrau",
      },
      {
        id: "loan-2",
        name: "Kredit Beispielkasse",
        provider: "Beispielkasse",
        category: "loan" as const,
        status: "active" as const,
        currentBalanceCents: 5_000_000,
        balanceAsOfDate: "2026-11-01",
        monthlyRateCents: 40_000,
        interestRateBps: 120,
        repaymentType: "annuity" as const,
        fixedInterestUntil: null,
        futureLoanInterestRateBps: null,
      },
    ];
    const balance = calculateHouseholdBalance({
      asOfDate,
      properties: [],
      contracts,
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
      snapshotFetchedAt: "2026-11-18T10:00:00.000Z",
      isDummyHousehold: false,
      balance,
      properties: [],
      contracts,
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

    const anonView = buildAdvisorReportView(report, "anonymized");
    const anonText = renderAdvisorReportText(anonView, { question: null });
    expect(anonText).toContain(
      "Sondertilgung: 5,00 % vom Ursprungsbetrag = 12.500 €/Jahr, genutzt 2.000 €, frei 10.500 €",
    );
    expect(anonText).toContain(
      "Tilgungssatzwechsel: 1 von 2 übrig (je Zinsbindung), Korridor 1,00 %–5,00 % Tilgung",
    );
    expect(anonText).toContain("Sondertilgungsrecht: unbekannt");
    expect(anonText).toContain("Tilgungssatzwechsel: unbekannt");
    expect(anonText).not.toContain("Erika Musterfrau");

    // Option lines must contain zero cent-formatted Euro amounts (e.g. ",50 €")
    const optionLines = anonText
      .split("\n")
      .filter(
        (l) =>
          l.includes("Sondertilgung:") || l.includes("Tilgungssatzwechsel:"),
      );
    expect(optionLines.length).toBeGreaterThanOrEqual(2);
    for (const line of optionLines) {
      expect(line).not.toMatch(/,\d{2}\s*€/);
    }

    const fullView = buildAdvisorReportView(report, "full");
    const fullText = renderAdvisorReportText(fullView, { question: null });
    expect(fullText).toContain("Notiz: Lokale Notiz Erika Musterfrau");
  });
});
