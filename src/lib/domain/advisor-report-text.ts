import type { AdvisorDataQualityHint } from "./advisor-report";
import type {
  AdvisorReportView,
  AdvisorReportViewLoanOptions,
  AdvisorReportViewRecommendation,
} from "./advisor-report-anonymize";
import type { RateChangeScope } from "./loan-options";
import { formatBpsDE, formatEuroDE, formatWholeEuroDE } from "./money";

export const ADVISOR_STARTER_PROMPT = [
  "Du bist ein unabhängiger, honorarbasierter Finanzberater in Deutschland.",
  "Unten steht der anonymisierte Ist-Stand eines Haushalts. Technische Referenzen (z. B. KREDIT-1, IMMOBILIE-1, TOPF-1) ersetzen echte Namen; alle Beträge sind in Euro angegeben.",
  "",
  "Bitte beantworte strukturiert:",
  "1. Lage einschätzen (Liquidität, Verschuldung, Vermögensstruktur, Cashflow).",
  "2. Risiken und Engpässe benennen (z. B. Zinsbindung, Notgroschen, Fristen).",
  "3. Priorisierte nächste Schritte ableiten.",
  "4. Konkrete Rückfragen stellen, wenn wichtige Angaben fehlen.",
  "",
  "Grenzen: Keine Empfehlung einzelner Wertpapiere oder Anbieter – bleibe bei Asset-Klassen und Produkttypen. Werte mit der Kennzeichnung „(modelliert)“ sind Schätzungen oder Projektionen und entsprechend vorsichtig zu behandeln.",
].join("\n");

export function formatDataQualityHintDE(hint: AdvisorDataQualityHint): string {
  switch (hint.code) {
    case "NO_SNAPSHOT":
      return "Kein Sync-Snapshot vorhanden – Bank- und Depotdaten fehlen möglicherweise.";
    case "SNAPSHOT_STALE":
      return `Letzter Sync ist ${hint.ageDays} Tage alt – Salden könnten veraltet sein.`;
    case "DUMMY_HOUSEHOLD":
      return "Haushalts-Cashflow nutzt Beispieldaten (Dummy-Modus).";
    case "NO_HOUSEHOLD_CASHFLOW":
      return "Keine kalibrierten Haushalts-Cashflow-Daten hinterlegt.";
    case "PROJECTED_CONTRACTS":
      return `${hint.count} ${hint.count === 1 ? "Vertrag ist" : "Verträge sind"} ab dem letzten Eich-Datum fortgeschrieben (modelliert).`;
    case "STALE_CALIBRATION":
      return `Bei ${hint.count} ${hint.count === 1 ? "Vertrag ist" : "Verträgen ist"} die letzte Eichung älter als 12 Monate.`;
    case "EXCLUDED_POTS":
      return `${hint.count} ${hint.count === 1 ? "Topf" : "Töpfe"} (${formatEuroDE(hint.cents)}) sind wegen Überschneidung oder Scope-Grenze aus der Haushalts-Liquidität ausgeschlossen.`;
    case "HISTORY_SPARSE":
      return `Verlauf enthält erst ${hint.monthCount} ${hint.monthCount === 1 ? "Monatswert" : "Monatswerte"} (weniger als 2 Monate).`;
    case "PROPERTY_VALUES_ESTIMATED":
      return `${hint.count} ${hint.count === 1 ? "Immobilienwert ist" : "Immobilienwerte sind"} als Schätzung hinterlegt (modelliert).`;
  }
}

function formatTenthsDE(tenths: number): string {
  const whole = Math.trunc(tenths / 10);
  const frac = Math.abs(tenths % 10);
  return `${whole},${frac}`;
}

function formatVariableBasisDE(
  basis: AdvisorReportView["cashflow"]["variableBasis"],
): string {
  switch (basis) {
    case "budget":
      return "Budgets";
    case "avg_3m":
      return "3-Monats-Schnitt";
    case "avg_6m":
      return "6-Monats-Schnitt";
  }
}

function formatDeadlineStatusDE(
  status: NonNullable<AdvisorReportView["pots"][number]["deadline"]>["status"],
): string {
  switch (status) {
    case "reached":
      return "erreicht";
    case "overdue":
      return "überfällig";
    case "on_track":
      return "im Plan";
    case "tight":
      return "knapp";
    case "at_risk":
      return "gefährdet";
  }
}

const RATE_CHANGE_SCOPE_DE: Record<RateChangeScope, string> = {
  term: "Laufzeit",
  fixed_period: "je Zinsbindung",
  per_year: "pro Jahr",
};

export function formatLoanSpecialRepaymentLineDE(
  opts: AdvisorReportViewLoanOptions,
): string {
  const sr = opts.specialRepayment;
  if (sr.status === "none") {
    return "Sondertilgung: nicht möglich";
  }
  if (sr.status === "unknown") {
    return "Sondertilgungsrecht: unbekannt";
  }
  if (sr.capThisYearCents !== null) {
    const basisPrefix =
      sr.basis === "percent_original" && sr.percentBps !== null
        ? `${formatBpsDE(sr.percentBps)} vom Ursprungsbetrag = `
        : sr.basis === "percent_balance" && sr.percentBps !== null
          ? `${formatBpsDE(sr.percentBps)} der Restschuld = `
          : "";
    const remaining = sr.remainingThisYearCents ?? 0;
    return `Sondertilgung: ${basisPrefix}${formatWholeEuroDE(sr.capThisYearCents)}/Jahr, genutzt ${formatWholeEuroDE(sr.usedThisYearCents)}, frei ${formatWholeEuroDE(remaining)}`;
  }
  if (sr.flags.missingOriginalPrincipal) {
    return "Sondertilgung: möglich (Höhe unbekannt, Ursprungsbetrag fehlt)";
  }
  return "Sondertilgung: möglich (Höhe unbekannt)";
}

export function formatLoanRateChangeLineDE(
  opts: AdvisorReportViewLoanOptions,
): string {
  const rc = opts.rateChange;
  if (rc.status === "not_applicable") {
    return "Tilgungssatzwechsel: nicht anwendbar (endfällig)";
  }
  if (rc.status === "none") {
    return "Tilgungssatzwechsel: nicht möglich";
  }
  if (rc.status === "unknown") {
    return "Tilgungssatzwechsel: unbekannt";
  }

  let countText: string;
  if (rc.flags.exhausted) {
    countText =
      rc.totalCount !== null
        ? `erschöpft (${rc.usedCount}/${rc.totalCount})`
        : "erschöpft";
  } else if (rc.remainingChanges !== null && rc.totalCount !== null) {
    countText = `${rc.remainingChanges} von ${rc.totalCount} übrig`;
  } else {
    countText = "Anzahl unbekannt";
  }

  const scopePart = rc.scope ? ` (${RATE_CHANGE_SCOPE_DE[rc.scope]})` : "";

  let corridorPart = "";
  if (rc.minMonthlyCents !== null && rc.maxMonthlyCents !== null) {
    const bpsPart =
      rc.minRepaymentBps !== null && rc.maxRepaymentBps !== null
        ? `${formatBpsDE(rc.minRepaymentBps)}–${formatBpsDE(rc.maxRepaymentBps)} Tilgung ≈ `
        : "";
    const assumedPart = rc.flags.corridorAssumed ? " (angenommen)" : "";
    corridorPart = `, Korridor ${bpsPart}${formatWholeEuroDE(rc.minMonthlyCents)}–${formatWholeEuroDE(rc.maxMonthlyCents)}/Monat${assumedPart}`;
  }

  const currentPart =
    rc.currentRepaymentBpsApprox !== null
      ? `, aktuell ≈ ${formatBpsDE(rc.currentRepaymentBpsApprox)}`
      : "";
  const latestPart = rc.latestChangeDateDisplay
    ? `, bis ${rc.latestChangeDateDisplay}`
    : "";

  return `Tilgungssatzwechsel: ${countText}${scopePart}${corridorPart}${currentPart}${latestPart}`;
}

function renderRecommendationBlock(
  title: string,
  rec: AdvisorReportViewRecommendation,
): string[] {
  const lines: string[] = [`### ${title}`, rec.headline];

  if (rec.items.length > 0) {
    lines.push("");
    for (const item of rec.items) {
      lines.push(
        `- **${item.targetLabel}**: ${formatEuroDE(item.amountCents)}`,
      );
      for (const reason of item.reasons) {
        lines.push(`  - ${reason}`);
      }
    }
  }

  if (rec.notes.length > 0) {
    lines.push("");
    lines.push("Hinweise:");
    for (const note of rec.notes) {
      lines.push(`- ${note}`);
    }
  }

  return lines;
}

export function renderAdvisorReportText(
  view: AdvisorReportView,
  options: { question: string | null },
): string {
  const lines: string[] = [];

  lines.push(ADVISOR_STARTER_PROMPT);
  lines.push("");
  lines.push("---");
  lines.push("");
  lines.push("# Finanz-Überblick Haushalt");
  lines.push(
    `Stand: ${view.meta.asOfDateDisplay} | Erstellt: ${view.meta.generatedDateDisplay} | Modus: ${view.meta.mode === "anonymized" ? "Anonymisiert" : "Vollständig"}`,
  );
  lines.push(`Hinweis: ${view.meta.disclaimer}`);

  // Datenqualität
  lines.push("");
  lines.push("## Datenqualität");
  if (view.dataQuality.hints.length === 0) {
    lines.push("Keine Auffälligkeiten.");
  } else {
    for (const hint of view.dataQuality.hints) {
      lines.push(`- ${formatDataQualityHintDE(hint)}`);
    }
  }

  // 1. Kurzprofil
  lines.push("");
  lines.push("## 1. Kurzprofil");
  lines.push(
    `- Immobilien: ${view.profile.propertyCount} (eigengenutzt: ${view.profile.ownerOccupiedCount}, vermietet: ${view.profile.rentedCount})`,
  );
  lines.push(
    `- Verträge: ${view.profile.loanCount} Kredite, ${view.profile.savingsContractCount} Bausparer`,
  );
  lines.push(`- Ziel-Töpfe: ${view.profile.potCount}`);
  lines.push(
    `- Haushalts-Cashflow: ${view.profile.hasHouseholdCashflow ? "vorhanden" : "keine kalibrierten Daten"}`,
  );
  lines.push(
    `- Notgroschen-Abdeckung: ${
      view.profile.emergencyCoverageMonthsTenths !== null
        ? `${formatTenthsDE(view.profile.emergencyCoverageMonthsTenths)} Monatsausgaben`
        : "nicht berechenbar"
    }`,
  );

  // 2. Bilanz
  lines.push("");
  lines.push("## 2. Bilanz");
  const modeledSuffix = view.balance.isModeled ? " (modelliert)" : "";
  if (
    view.balance.totalAssetsCents === 0 &&
    view.balance.liabilitiesCents === 0
  ) {
    lines.push("keine Daten");
  } else {
    lines.push(
      `- Nettovermögen: ${formatEuroDE(view.balance.netWorthCents)}${modeledSuffix}`,
    );
    lines.push(
      `- Aktiva gesamt: ${formatEuroDE(view.balance.totalAssetsCents)}${modeledSuffix}`,
    );
    lines.push(
      `  - Frei verfügbar: ${formatEuroDE(view.balance.freeAssetsCents)} (${formatBpsDE(view.balance.freeShareBps)})`,
    );
    lines.push(
      `  - Gebundenes Vermögen: ${formatEuroDE(view.balance.boundAssetsCents)} (${formatBpsDE(view.balance.boundShareBps)})${modeledSuffix}`,
    );
    lines.push(
      `- Passiva / Schulden: ${formatEuroDE(view.balance.liabilitiesCents)} (${formatBpsDE(view.balance.liabilitiesShareBps)})`,
    );
    if (view.balance.excludedPotsCents > 0) {
      lines.push(
        `- Aus Liquidität ausgeschlossene Töpfe: ${formatEuroDE(view.balance.excludedPotsCents)}`,
      );
    }
  }

  // 3. Verlauf
  lines.push("");
  lines.push("## 3. Verlauf (Monatsendwerte)");
  if (view.history.rows.length === 0) {
    lines.push("keine Daten");
  } else {
    if (view.history.netWorthDeltaCents !== null) {
      lines.push(
        `Veränderung Nettovermögen im Zeitraum: ${formatEuroDE(view.history.netWorthDeltaCents, { showPlusSign: true })}${view.history.anyModeled ? " (modelliert)" : ""}`,
      );
    }
    for (const row of view.history.rows) {
      const tag = row.hasModeledValues ? " (modelliert)" : "";
      lines.push(
        `- ${row.monthDisplay}: Netto ${formatEuroDE(row.netWorthCents)} | Frei ${formatEuroDE(row.freeAssetsCents)} | Gebunden ${formatEuroDE(row.boundAssetsCents)} | Schulden ${formatEuroDE(row.liabilitiesCents)}${tag}`,
      );
    }
  }

  // 4. Verträge & Kredite
  lines.push("");
  lines.push("## 4. Verträge & Kredite");
  if (view.contracts.length === 0) {
    lines.push("keine Daten");
  } else {
    for (const c of view.contracts) {
      const providerPart = c.provider ? ` (${c.provider})` : "";
      const refPart = view.meta.mode === "full" ? ` [${c.ref}]` : "";
      const projTag = c.isProjected ? " (modelliert)" : "";
      const statusTag = c.status === "paused" ? " [pausiert]" : "";
      const details: string[] = [
        `Stand: ${formatEuroDE(c.projectedBalanceCents)}${projTag} (Eichung: ${c.calibratedAsOfDisplay})`,
        `Rate: ${formatEuroDE(c.monthlyRateCents)}/Monat`,
        `Zins: ${formatBpsDE(c.interestRateBps)}`,
      ];
      if (c.fixedInterestUntilDisplay) {
        details.push(`Zinsbindung bis ${c.fixedInterestUntilDisplay}`);
      }
      if (c.loanOptions?.originalPrincipalCents != null) {
        details.push(
          `Ursprungsbetrag: ${formatEuroDE(c.loanOptions.originalPrincipalCents)}`,
        );
      }
      if (c.targetSumCents !== null) {
        const prog =
          c.targetProgressBps !== null
            ? ` (${formatBpsDE(c.targetProgressBps)})`
            : "";
        details.push(`Bausparsumme ${formatEuroDE(c.targetSumCents)}${prog}`);
      }
      if (c.milestone) {
        details.push(`Meilenstein: ${c.milestone.text}`);
      }
      lines.push(
        `- **${c.displayName}**${providerPart}${refPart}${statusTag}: ${details.join(" · ")}`,
      );
      if (c.loanOptions !== null) {
        lines.push(`  - ${formatLoanSpecialRepaymentLineDE(c.loanOptions)}`);
        lines.push(`  - ${formatLoanRateChangeLineDE(c.loanOptions)}`);
        if (view.meta.mode === "full" && c.loanOptions.note) {
          lines.push(`  - Notiz: ${c.loanOptions.note}`);
        }
      }
    }
  }

  // 5. Immobilien
  lines.push("");
  lines.push("## 5. Immobilien");
  if (view.properties.length === 0) {
    lines.push("keine Daten");
  } else {
    for (const p of view.properties) {
      const refPart = view.meta.mode === "full" ? ` [${p.ref}]` : "";
      const parts: string[] = [
        `Schätzwert: ${formatEuroDE(p.estimatedValueCents)} (modelliert)`,
        `Kredite: ${formatEuroDE(p.linkedLoanBalanceCents)}`,
        `Eigenkapital: ${formatEuroDE(p.netEquityCents)}`,
      ];
      if (p.ltvBps !== null) {
        parts.push(`Beleihung (LTV): ${formatBpsDE(p.ltvBps)}`);
      }
      if (p.purchaseYear !== null) {
        parts.push(`Kaufjahr: ${p.purchaseYear}`);
      }
      lines.push(`- **${p.displayName}**${refPart}: ${parts.join(" · ")}`);
      if (p.rental) {
        const rentalParts: string[] = [
          `Kaltmiete: ${formatEuroDE(p.rental.monthlyColdRentCents)}/Monat`,
          `Nicht umlagefähig: ${formatEuroDE(p.rental.monthlyNonRecoverableCostsCents)}/Monat`,
          `Instandhaltung: ${formatEuroDE(p.rental.monthlyMaintenanceAllowanceCents)}/Monat`,
          `Netto-Cashflow vor Rücklage: ${formatEuroDE(p.rental.netCashflowBeforeReserveCents, { showPlusSign: true })}/Monat`,
        ];
        if (p.rental.grossYieldBps !== null) {
          rentalParts.push(
            `Bruttorendite: ${formatBpsDE(p.rental.grossYieldBps)}`,
          );
        }
        if (p.rental.netYieldBps !== null) {
          rentalParts.push(
            `Nettorendite: ${formatBpsDE(p.rental.netYieldBps)}`,
          );
        }
        lines.push(`  - Vermietung (vor Steuern): ${rentalParts.join(" · ")}`);
      }
    }
  }

  // 6. Töpfe & Ziele
  lines.push("");
  lines.push("## 6. Töpfe & Ziele");
  if (view.pots.length === 0) {
    lines.push("keine Daten");
  } else {
    for (const pot of view.pots) {
      const refPart = view.meta.mode === "full" ? ` [${pot.ref}]` : "";
      const parts: string[] = [`Stand: ${formatEuroDE(pot.currentCents)}`];
      if (pot.targetCents !== null) {
        const prog =
          pot.progressBps !== null ? ` (${formatBpsDE(pot.progressBps)})` : "";
        parts.push(`Ziel: ${formatEuroDE(pot.targetCents)}${prog}`);
      }
      if (pot.targetMonthDisplay) {
        const statusStr = pot.deadline
          ? ` (${formatDeadlineStatusDE(pot.deadline.status)})`
          : "";
        parts.push(`Termin: ${pot.targetMonthDisplay}${statusStr}`);
      }
      if (pot.liquidityExclusion) {
        parts.push("nicht in Haushalts-Liquidität gezählt");
      }
      lines.push(`- **${pot.displayName}**${refPart}: ${parts.join(" · ")}`);
    }
  }

  // 7. Cashflow
  lines.push("");
  lines.push("## 7. Cashflow (monatlich)");
  if (
    !view.cashflow.hasHouseholdData &&
    view.cashflow.totalInflowCents === 0 &&
    view.cashflow.totalOutflowCents === 0
  ) {
    lines.push("keine Daten");
  } else {
    const cfModeled = view.cashflow.isModeled ? " (modelliert)" : "";
    lines.push(
      `- Einnahmen gesamt: ${formatEuroDE(view.cashflow.totalInflowCents)}${cfModeled}`,
    );
    lines.push(
      `- Ausgaben gesamt: ${formatEuroDE(view.cashflow.totalOutflowCents)}${cfModeled}`,
    );
    lines.push(
      `- Monatlicher Überschuss: ${formatEuroDE(view.cashflow.monthlySurplusCents, { showPlusSign: true })}${cfModeled}`,
    );
    lines.push(
      `- Variable Ausgabenbasis: ${formatVariableBasisDE(view.cashflow.variableBasis)}`,
    );
  }

  // 8. Empfehlungen
  lines.push("");
  lines.push("## 8. Empfehlungen (modelliert)");
  lines.push(
    ...renderRecommendationBlock(
      "Monatliche Sparrate",
      view.recommendations.monthly,
    ),
  );
  if (view.recommendations.oneTime) {
    lines.push("");
    lines.push(
      ...renderRecommendationBlock(
        `Einmalbetrag (${formatEuroDE(view.recommendations.oneTime.amountCents)})`,
        view.recommendations.oneTime,
      ),
    );
  }

  // 9. Wobei brauche ich Rat? (nur bei nicht leerer Frage)
  const trimmedQuestion = options.question?.trim() ?? "";
  if (trimmedQuestion.length > 0) {
    lines.push("");
    lines.push("## 9. Wobei brauche ich Rat?");
    lines.push(trimmedQuestion);
  }

  // 10. Anhang: Annahmen & Methodik
  lines.push("");
  lines.push("## Anhang: Annahmen & Methodik");
  lines.push(`- ${view.recommendations.monthly.assumptionsSummary}`);
  if (view.recommendations.monthly.loanOrder.length > 0) {
    lines.push(
      `- Kredit-Reihenfolge der Empfehlung: ${view.recommendations.monthly.loanOrder.join(" → ")}`,
    );
  }
  lines.push(
    "- „(modelliert)“ kennzeichnet Schätzwerte (Immobilien), fortgeschriebene Vertragssalden oder Simulationsannahmen.",
  );
  lines.push(
    "- Topf-Stände entsprechen der Planungsbasis inkl. offener Überweisungen.",
  );
  lines.push(
    `- Datenquelle: lokale Haushalts-App (Stand ${view.meta.asOfDateDisplay}).`,
  );

  return lines.join("\n");
}
