import {
  formatBpsDE,
  formatCentsDE,
  formatWholeEuroDE,
} from "@/lib/domain/money";
import { totalSaleCostsBps } from "@/lib/domain/property-vs-etf-tax";
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
  const reinvest = result.reinvestSurplus;
  if (reinvest) {
    const f = result.final;
    cashflowItems.push(
      {
        label: "Einzahlungen ins Depot",
        value: formatWholeEuroDE(f.surplusDepotPaidInCents),
      },
      { label: "Depotwert", value: formatWholeEuroDE(f.surplusDepotValueCents) },
      { label: "Depot-Steuer", value: formatWholeEuroDE(f.surplusDepotTaxCents) },
      {
        label: "Immobilien-Vermögen mit zinslosem Überschuss (Vergleich)",
        value: formatWholeEuroDE(f.propertyLiquidationWithoutDepotCents),
      },
    );
  }
  const cashflowNote = joinNotes(
    reinvest
      ? "Negativ: Zuzahlung, derselbe Betrag geht in den ETF. Positiv: fließt in ein Überschuss-Depot auf der Immobilien-Seite (gleiche ETF-Rendite, beim Verkauf mit ETF-Steuer). Spätere Zuzahlungen werden nicht aus dem Depot entnommen."
      : "Negativ: Zuzahlung, derselbe Betrag geht in den ETF. Positiv: sammelt sich zinslos auf der Immobilien-Seite.",
    flags.hadTopUps
      ? "Im Verlauf gab es Zuzahlungen, die in den ETF geflossen sind."
      : null,
    flags.hadSurplus
      ? reinvest
        ? "Im Verlauf gab es Überschüsse, die ins Überschuss-Depot geflossen sind."
        : "Im Verlauf gab es Überschüsse, die zinslos angesammelt wurden."
      : reinvest
        ? "Kein Überschuss im Verlauf."
        : null,
  );

  const saleCostsTotal = formatBpsDE(totalSaleCostsBps(tax));

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
          value: `Makler ${formatBpsDE(tax.brokerFeeBps)} + Sonstiges ${formatBpsDE(tax.otherSaleCostsBps)} = Summe ${saleCostsTotal} wirken weiter`,
        },
        {
          label: "Rücklage-Verzögerung",
          value: "ohne Wirkung (keine Steuern)",
        },
      ],
    };
  } else {
    const lag = tax.reserveDeductionLagYears;
    let reserveText =
      lag === 0
        ? "im Jahr der Zahlung als Werbungskosten abgesetzt"
        : `erst nach ${lag} Jahren abgesetzt (bei Verwendung); Zahlungen der letzten ${lag} Jahre vor dem Verkauf werden nie abgesetzt`;
    if (flags.reserveDeductionDeferred && lag >= horizon) {
      reserveText += ". Innerhalb des Horizonts wird keine Rücklage abgesetzt.";
    }
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
        {
          label: "Sparerpauschbetrag",
          value: reinvest
            ? `${formatWholeEuroDE(tax.saverAllowanceCents)} je Szenario einmal (Vergleichs-ETF und Überschuss-Depot getrennt)`
            : formatWholeEuroDE(tax.saverAllowanceCents),
        },
        { label: "Maklerprovision", value: formatBpsDE(tax.brokerFeeBps) },
        { label: "Sonstige Verkaufskosten", value: formatBpsDE(tax.otherSaleCostsBps) },
        { label: "Verkaufskosten gesamt", value: saleCostsTotal },
        { label: "Instandhaltungsrücklage", value: reserveText },
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
      value: `Jedes Jahr zeigt: Verkauf in diesem Jahr, nach Verkaufskosten (${saleCostsTotal}) und Steuern.`,
    },
    {
      label: "Immobilie",
      value: reinvest
        ? "Wert − Restschuld + Überschuss-Depot nach Steuern − Verkaufskosten − Spekulationssteuer"
        : "Wert − Restschuld + Überschüsse − Verkaufskosten − Spekulationssteuer",
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
          label: "Vorfälligkeitsentschädigung",
          value:
            "bei Verkauf innerhalb der Zinsbindung nicht abgebildet (Zinsbindung nicht modelliert)",
        },
        {
          label: "Anschaffungsnahe Herstellungskosten",
          value: "§ 6 Abs. 1 Nr. 1a EStG nicht abgebildet",
        },
        {
          label: "Erhaltungsaufwand",
          value: "der von der Rücklage abweicht, nicht abgebildet",
        },
        {
          label: "Rücklage beim Verkauf",
          value: "kein Ausgleich im Kaufpreis (konservativ)",
        },
        {
          label: "Bundesland",
          value: "Besonderheiten nur über die Kaufnebenkosten",
        },
      ],
      note: "Modelliert, vereinfachte Steuerlogik, keine Steuerberatung.",
    },
  ];
}
