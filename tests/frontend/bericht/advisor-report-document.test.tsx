import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { buildAdvisorReport } from "@/domain/report/report";
import { buildAdvisorReportView } from "@/domain/report/anonymize";
import { calculateHouseholdBalance } from "@/domain/cockpit/balance";
import { calculateConsolidatedCashflow } from "@/domain/allocation/cashflow";
import { AdvisorReportDocument } from "@/frontend/bericht/advisor-report-document";

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

  it("renders Optionen column with two lines and shows loan note footnote only in full mode", () => {
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
        rateChangeRight: "allowed" as const,
        rateChangeTotalCount: 2,
        rateChangeScope: "fixed_period" as const,
        rateChangeUsedCount: 0,
        rateChangeMinRepaymentBps: 100,
        rateChangeMaxRepaymentBps: 500,
        loanOptionsNote: "Vertrauliche Notiz Erika Musterfrau",
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

    const fullHtml = renderToStaticMarkup(
      <AdvisorReportDocument view={buildAdvisorReportView(report, "full")} />,
    );
    expect(fullHtml).toContain(">Optionen</th>");
    expect(fullHtml).toContain("print-avoid-break");
    expect(fullHtml).toContain("Sondertilgung:");
    expect(fullHtml).toContain("Tilgungssatzwechsel:");
    expect(fullHtml).toContain("Notiz: Vertrauliche Notiz Erika Musterfrau");

    const anonHtml = renderToStaticMarkup(
      <AdvisorReportDocument
        view={buildAdvisorReportView(report, "anonymized")}
      />,
    );
    expect(anonHtml).toContain("Sondertilgung:");
    expect(anonHtml).toContain("Tilgungssatzwechsel:");
    expect(anonHtml).not.toContain("Erika Musterfrau");
    expect(anonHtml).not.toContain("Notiz:");
  });
});
