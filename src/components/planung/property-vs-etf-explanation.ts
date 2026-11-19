import {
  formatBpsDE,
  formatCentsDE,
  formatWholeEuroDE,
} from "@/lib/domain/money";
import type { PropertyVsEtfEvaluation } from "./property-vs-etf-state";

export interface ExplanationItem {
  label: string;
  value: string;
}

export interface ExplanationSection {
  key: string;
  title: string;
  items: ExplanationItem[];
  note?: string;
}

type OkEvaluation = Extract<PropertyVsEtfEvaluation, { status: "ok" }>;

/** Hundertstel-qm → „65,50 qm“ (reine Formatierung). */
function formatCentiSqm(centiSqm: number): string {
  const whole = Math.trunc(centiSqm / 100);
  const frac = String(centiSqm % 100).padStart(2, "0");
  return `${whole},${frac} qm`;
}

function formatYearAndMonth(month: number): string {
  const year = Math.floor((month - 1) / 12) + 1;
  const monthInYear = ((month - 1) % 12) + 1;
  return `Jahr ${year}, Monat ${monthInYear}`;
}

function joinNotes(...parts: Array<string | null>): string | undefined {
  const text = parts.filter((p): p is string => p !== null).join(" ");
  return text === "" ? undefined : text;
}

/**
 * Klartext-Erklärung der Rechnung. Liest ausschließlich `input`, `tax`,
 * `result` und `equity` der angezeigten Auswertung und formatiert nur.
 */
export function buildPropertyVsEtfExplanation(
  shown: OkEvaluation,
): ExplanationSection[] {
  const { input, tax, result, equity } = shown;
  const flags = result.flags;
  const horizon = input.horizonYears;

  // 1. Finanzierung
  const financingItems: ExplanationItem[] = [
    { label: "Kaufpreis", value: formatWholeEuroDE(input.purchasePriceCents) },
    {
      label: `Kaufnebenkosten (${formatBpsDE(input.purchaseCostsBps)})`,
      value: formatWholeEuroDE(result.purchaseCostsCents),
    },
    { label: "Gesamtkosten", value: formatWholeEuroDE(result.totalCostCents) },
    { label: "Eigenkapital", value: formatWholeEuroDE(input.equityCents) },
    { label: "Darlehen", value: formatWholeEuroDE(result.loanPrincipalCents) },
  ];
  if (equity.clamped === "raised_to_costs") {
    financingItems.push({
      label: "Hinweis",
      value: "Eigenkapital wurde auf die Kaufnebenkosten angehoben.",
    });
  } else if (equity.clamped === "lowered_to_total") {
    financingItems.push({
      label: "Hinweis",
      value: "Eigenkapital wurde auf die Gesamtkosten begrenzt.",
    });
  }

  // 2. Darlehen
  const loanItems: ExplanationItem[] = [
    { label: "Zins", value: formatBpsDE(input.interestRateBps) },
    { label: "Anfangstilgung", value: formatBpsDE(input.initialRepaymentBps) },
    {
      label: "Monatsrate",
      value: formatCentsDE(result.monthlyLoanRateCents),
    },
  ];
  let payoff: string | null = null;
  if (flags.noLoan) {
    payoff =
      "Das Eigenkapital deckt die Gesamtkosten, es gibt kein Darlehen und damit keine Rate.";
  } else if (flags.noAmortization) {
    payoff = "Ohne Tilgung bleibt die Restschuld über den ganzen Horizont gleich.";
  } else if (result.loanPaidOffInMonth !== null) {
    payoff = `Das Darlehen ist getilgt in ${formatYearAndMonth(result.loanPaidOffInMonth)}.`;
  } else {
    payoff = "Das Darlehen ist innerhalb des Horizonts nicht getilgt.";
  }
  loanItems.push({ label: "Tilgungsende", value: payoff });

  // 3. Miete & laufende Kosten
  const rentItems: ExplanationItem[] = [
    {
      label: "Kaltmiete (Start)",
      value: `${formatCentsDE(input.coldRentPerSqmCents)} je qm × ${formatCentiSqm(input.livingAreaCentiSqm)} = ${formatWholeEuroDE(result.initialMonthlyColdRentCents)} je Monat`,
    },
    { label: "Mietsteigerung", value: formatBpsDE(input.rentGrowthBps) },
    { label: "Mietausfallwagnis", value: formatBpsDE(input.vacancyBps) },
    {
      label: "WEG-Kosten (nicht umlagefähig)",
      value: `${formatCentsDE(input.monthlyHoaCostsCents)} je Monat`,
    },
    {
      label: "Kostensteigerung",
      value: `${formatBpsDE(input.costGrowthBps)} (wirkt nur auf die WEG-Kosten)`,
    },
    {
      label: "Instandhaltungsrücklage",
      value: `${formatBpsDE(input.maintenanceReserveBps)} p. a. vom jeweiligen Immobilienwert, wächst mit der Wertsteigerung`,
    },
    { label: "Wertsteigerung", value: formatBpsDE(input.valueGrowthBps) },
  ];

  // 4. Zuzahlung & Überschuss
  const cashflowItems: ExplanationItem[] = [
    {
      label: "Cashflow im 1. Monat (nach Steuern)",
      value: formatWholeEuroDE(result.initialMonthlyCashflowCents, {
        showPlusSign: true,
      }),
    },
    {
      label: "Cashflow im 1. Monat (vor Steuern)",
      value: formatWholeEuroDE(result.initialMonthlyCashflowBeforeTaxCents, {
        showPlusSign: true,
      }),
    },
  ];
  const cashflowNote = joinNotes(
    "Negativ: Zuzahlung, derselbe Betrag geht in den ETF. Positiv: sammelt sich zinslos auf der Immobilien-Seite.",
    flags.hadTopUps
      ? "Im Verlauf gab es Zuzahlungen, die in den ETF geflossen sind."
      : null,
    flags.hadSurplus
      ? "Im Verlauf gab es Überschüsse, die zinslos angesammelt wurden."
      : null,
  );

  // 5. ETF
  const etfItems: ExplanationItem[] = [
    { label: "Startwert", value: `${formatWholeEuroDE(input.equityCents)} (= Eigenkapital)` },
    { label: "Rendite", value: `${formatBpsDE(input.etfAnnualReturnBps)} p. a.` },
    { label: "Monatliche Verzinsung", value: "(1 + Rendite)^(1/12)" },
  ];

  // 6. Steuern
  let taxSection: ExplanationSection;
  if (!tax.taxesEnabled) {
    taxSection = {
      key: "taxes",
      title: "Steuern",
      items: [
        {
          label: "Steuern",
          value:
            "nicht berücksichtigt (Einkommen-, Spekulations- und ETF-Steuer entfallen)",
        },
        {
          label: "Verkaufskosten",
          value: `${formatBpsDE(tax.saleCostsBps)} wirken weiter`,
        },
      ],
    };
  } else {
    const speculation =
      result.speculationFreeFromYear === null
        ? `Frist ${tax.speculationPeriodYears} Jahre`
        : `Frist ${tax.speculationPeriodYears} Jahre, steuerfrei ab Jahr ${result.speculationFreeFromYear}`;
    taxSection = {
      key: "taxes",
      title: "Steuern",
      items: [
        { label: "Grenzsteuersatz", value: formatBpsDE(tax.marginalTaxRateBps) },
        {
          label: `AfA (${formatBpsDE(tax.depreciationRateBps)})`,
          value: `${formatWholeEuroDE(result.annualDepreciationCents)} je Jahr auf ${formatWholeEuroDE(result.depreciationBasisCents)} (Gebäudeanteil ${formatBpsDE(tax.buildingShareBps)})`,
        },
        { label: "Spekulationsfrist", value: speculation },
        {
          label: "Kapitalertragsteuer inkl. Soli",
          value: "26,375 % (fest)",
        },
        { label: "Kirchensteuer", value: formatBpsDE(tax.churchTaxBps) },
        { label: "Teilfreistellung (ETF)", value: formatBpsDE(tax.partialExemptionBps) },
        { label: "Sparerpauschbetrag", value: formatWholeEuroDE(tax.saverAllowanceCents) },
        { label: "Verkaufskosten", value: formatBpsDE(tax.saleCostsBps) },
      ],
      note: joinNotes(
        "Ein steuerlicher Verlust führt zu einer Erstattung.",
        flags.hadRefunds ? "Im Verlauf gab es Erstattungen." : null,
        "Vorabpauschale vereinfachend ignoriert.",
      ),
    };
  }

  // 7. Verkauf & Liquidationssicht
  const saleItems: ExplanationItem[] = [
    {
      label: "Chart",
      value: `Jedes Jahr zeigt: Verkauf in diesem Jahr, nach Verkaufskosten (${formatBpsDE(tax.saleCostsBps)}) und Steuern.`,
    },
    {
      label: "Immobilie",
      value:
        "Wert − Restschuld + Überschüsse − Verkaufskosten − Spekulationssteuer",
    },
    { label: "ETF", value: "Depotwert − ETF-Steuer" },
    { label: "Horizont", value: `${horizon} Jahre` },
  ];

  return [
    { key: "financing", title: "Finanzierung", items: financingItems },
    { key: "loan", title: "Darlehen", items: loanItems, note: "Konstante Annuität. Zinsbindung und Anschlussfinanzierung nicht modelliert, der Zins bleibt konstant." },
    { key: "rent", title: "Miete & laufende Kosten", items: rentItems },
    { key: "cashflow", title: "Zuzahlung & Überschuss", items: cashflowItems, note: cashflowNote },
    { key: "etf", title: "ETF", items: etfItems },
    taxSection,
    { key: "sale", title: "Verkauf & Liquidationssicht", items: saleItems },
    {
      key: "limits",
      title: "Nicht abgebildet",
      items: [
        { label: "Zinsbindung", value: "Anschlussfinanzierung nicht modelliert" },
        { label: "Vorabpauschale", value: "vereinfachend ignoriert" },
        {
          label: "Bundesland",
          value: "Besonderheiten nur über die Kaufnebenkosten",
        },
      ],
      note: "Modelliert, vereinfachte Steuerlogik, keine Steuerberatung.",
    },
  ];
}
