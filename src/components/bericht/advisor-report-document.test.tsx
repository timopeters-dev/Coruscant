import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { buildAdvisorReport } from "@/lib/domain/advisor-report";
import { buildAdvisorReportView } from "@/lib/domain/advisor-report-anonymize";
import { calculateHouseholdBalance } from "@/lib/domain/balance";
import { calculateConsolidatedCashflow } from "@/lib/domain/cashflow";
import { AdvisorReportDocument } from "./advisor-report-document";

describe("AdvisorReportDocument", () => {
  it("renders empty states, disclaimer, data quality hints, and print-break-before on appendix", () => {
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

    const html = renderToStaticMarkup(<AdvisorReportDocument view={view} />);

    expect(html).toContain("Orientierung, keine Anlageberatung");
    expect(html).toContain("Keine Bilanzdaten vorhanden.");
    expect(html).toContain("Keine aktiven oder pausierten Verträge vorhanden.");
    expect(html).toContain("Keine Immobilien hinterlegt.");
    expect(html).toContain("Keine Ziel-Töpfe vorhanden.");
    expect(html).toContain("Keine Cashflow-Daten vorhanden.");
    expect(html).toContain("Kein Sync-Snapshot vorhanden");
    expect(html).toContain("print-break-before");
    expect(html).toContain("Anhang: Annahmen &amp; Methodik");
  });

  it("renders visible Modelliert badges on property values and projected contracts", () => {
    const asOfDate = "2026-11-19";
    const properties = [
      {
        id: "prop-1",
        name: "Musterstraße 1",
        usage: "owner_occupied" as const,
        purchaseDate: "2020-01-01",
        purchasePriceCents: 30_000_000,
        estimatedValueCents: 35_000_000,
      },
    ];
    const contracts = [
      {
        id: "loan-1",
        name: "Darlehen Musterbank",
        provider: "Musterbank",
        category: "loan" as const,
        status: "active" as const,
        currentBalanceCents: 10_000_000,
        balanceAsOfDate: "2026-06-01",
        monthlyRateCents: 100_000,
        interestRateBps: 350,
        repaymentType: "annuity" as const,
        futureLoanInterestRateBps: null,
      },
    ];
    const balance = calculateHouseholdBalance({
      asOfDate,
      properties,
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
      properties,
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
    const view = buildAdvisorReportView(report, "anonymized");

    const html = renderToStaticMarkup(<AdvisorReportDocument view={view} />);

    // Multiple Modelliert badges: balance, contract projection, property, recommendations
    const modeledCount = (html.match(/>Modelliert</g) ?? []).length;
    expect(modeledCount).toBeGreaterThanOrEqual(3);
    expect(html).toContain("KREDIT-1 · Annuität");
    expect(html).toContain("IMMOBILIE-1 · eigengenutzt");
  });
});
