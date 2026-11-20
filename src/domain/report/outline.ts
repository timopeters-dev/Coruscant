/** Inhaltsverzeichnis des Berater-Berichts. */
import type { AdvisorReport, AdvisorReportOutlineItem } from "./types";

export function buildAdvisorReportOutline(
  report: AdvisorReport,
): AdvisorReportOutlineItem[] {
  const recommendationCount =
    report.recommendations.monthly.items.length +
    (report.recommendations.oneTime?.items.length ?? 0);

  return [
    {
      sectionId: "profile",
      label: "Kurzprofil",
      count: null,
      isEmpty: false,
    },
    {
      sectionId: "balance",
      label: "Bilanz",
      count: null,
      isEmpty:
        report.balance.totalAssetsCents === 0 &&
        report.balance.liabilitiesCents === 0,
    },
    {
      sectionId: "history",
      label: "Verlauf",
      count: report.history.rows.length,
      isEmpty: report.history.rows.length === 0,
    },
    {
      sectionId: "contracts",
      label: "Verträge & Kredite",
      count: report.contracts.length,
      isEmpty: report.contracts.length === 0,
    },
    {
      sectionId: "properties",
      label: "Immobilien",
      count: report.properties.length,
      isEmpty: report.properties.length === 0,
    },
    {
      sectionId: "pots",
      label: "Töpfe & Ziele",
      count: report.pots.length,
      isEmpty: report.pots.length === 0,
    },
    {
      sectionId: "cashflow",
      label: "Cashflow",
      count: null,
      isEmpty:
        !report.cashflow.hasHouseholdData &&
        report.cashflow.totalInflowCents === 0 &&
        report.cashflow.totalOutflowCents === 0,
    },
    {
      sectionId: "recommendations",
      label: "Empfehlungen",
      count: recommendationCount,
      isEmpty: recommendationCount === 0,
    },
  ];
}
