import { formatMonthDE } from "@/domain/core/date-format";
import { formatBpsDE, formatEuroDE } from "@/domain/core/money";
import type {
  RecommendationAssumptions,
  RecommendationItem,
  RecommendationItemKind,
  RecommendationNote,
  RecommendationReason,
  RecommendationResult,
} from "./recommendation";

export interface RecommendationLabels {
  potNames: Record<string, string>;
  loanNames: Record<string, string>;
}

function formatYearMonthDE(ym: string): string {
  return formatMonthDE(ym);
}

function formatIsoDateMonthYearDE(iso: string): string {
  return formatYearMonthDE(iso.slice(0, 7));
}

export const KIND_LABEL_DE: Record<RecommendationItemKind, string> = {
  emergency_fund: "Notgroschen",
  pot_deadline: "Ziel-Topf",
  loan_prepayment: "Sondertilgung",
  loan_rate_increase: "Ratenerhöhung",
  loan_reserve: "Tilgungsreserve",
  etf: "Breit gestreuter ETF",
  keep_liquid: "Liquidität / Puffer",
};

export function resolveItemLabel(
  item: RecommendationItem,
  labels: RecommendationLabels,
): string {
  if (item.target.type === "pot") {
    return labels.potNames[item.target.potId] ?? KIND_LABEL_DE[item.kind];
  }
  if (item.target.type === "loan") {
    return labels.loanNames[item.target.loanId] ?? "Kredit";
  }
  switch (item.kind) {
    case "emergency_fund":
      return "Notgroschen";
    case "etf":
      return "Breit gestreuter ETF";
    case "keep_liquid":
      return "Haushaltskonto (Puffer)";
    case "loan_reserve":
      return "Tilgungsreserve";
    default:
      return KIND_LABEL_DE[item.kind];
  }
}

type ReasonFormatterMap = {
  [K in RecommendationReason["code"]]: (
    r: Extract<RecommendationReason, { code: K }>,
  ) => string;
};

const REASON_FORMATTERS = {
  EMERGENCY_FUND_GAP: (r) =>
    r.targetSource === "pots"
      ? `Füllt die Notgroschen-Lücke (Stand ${formatEuroDE(r.currentCents)} von ${formatEuroDE(r.targetCents)} Topf-Ziel).`
      : `Füllt die Notgroschen-Lücke auf ${r.months} Monatsausgaben (${formatEuroDE(r.currentCents)} von ${formatEuroDE(r.targetCents)}).`,
  EMERGENCY_FUND_NO_POT: () =>
    "Noch kein Notgroschen-Topf vorhanden – lege bei Bedarf einen Topf mit Zweck „Notgroschen“ an.",
  POT_DEADLINE_GAP: (r) =>
    r.status === "overdue"
      ? `Termin ${formatYearMonthDE(r.targetMonth)} ist überfällig; aktueller Fehlbetrag ${formatEuroDE(r.shortfallAtDeadlineCents)}.`
      : `Schließt die Lücke bis Termin ${formatYearMonthDE(r.targetMonth)} (${r.restMonths} Monate, ${formatEuroDE(r.shortfallAtDeadlineCents)} offen).`,
  POT_DEADLINE_UNREACHABLE: (r) =>
    `Für Termin ${formatYearMonthDE(r.targetMonth)} bleiben ${formatEuroDE(r.remainingGapCents)} ungedeckt.`,
  PREPAYMENT_BEATS_ETF: (r) =>
    r.breakEvenBps !== null
      ? `Kreditzins (${formatBpsDE(r.interestRateBps)}) schlägt die erwartete ETF-Rendite (${formatBpsDE(r.expectedReturnBps)}) inkl. ${formatBpsDE(r.safetyMarginBps)} Sicherheitsaufschlag (Break-even ${formatBpsDE(r.breakEvenBps)}).`
      : `Sondertilgung liegt über der erwarteten ETF-Rendite (${formatBpsDE(r.expectedReturnBps)}).`,
  PREPAYMENT_CAP_REACHED: (r) =>
    `Jahreslimit für Sondertilgungen erreicht (${formatEuroDE(r.usedCents)} genutzt von ${formatEuroDE(r.capCents)}); ${formatEuroDE(r.overflowCents)} fließen weiter.`,
  PREPAYMENT_CAP_UNKNOWN: () =>
    "Kein jährliches Sondertilgungslimit hinterlegt – bitte im Darlehensvertrag prüfen.",
  FIXED_INTEREST_ENDS_SOON: (r) =>
    r.futureRateBps !== null
      ? `Zinsbindung endet in ${r.monthsUntil} Monaten (${formatIsoDateMonthYearDE(r.fixedInterestUntil)}, erwarteter Folgezins ${formatBpsDE(r.futureRateBps)}); als Reserve bis zum Zinsende parken.`
      : `Zinsbindung endet in ${r.monthsUntil} Monaten (${formatIsoDateMonthYearDE(r.fixedInterestUntil)}); als Reserve bis zum Zinsende parken.`,
  HORIZON_ESTIMATED: (r) =>
    `Zinsbindung fehlt oder ist abgelaufen – gerechnet mit ${r.horizonMonths} Monaten Horizont.`,
  ETF_BEATS_PREPAYMENT: (r) =>
    `Erwartete ETF-Rendite (${formatBpsDE(r.expectedReturnBps)}) liegt mindestens ${formatBpsDE(r.safetyMarginBps)} über dem Kredit-Break-even (${formatBpsDE(r.breakEvenBps)} bei ${formatBpsDE(r.interestRateBps)} Zins).`,
  ETF_NO_LOAN: () =>
    "Keine aktiven Kredite vorhanden – der Betrag fließt in einen breit gestreuten ETF.",
  ETF_AFTER_LOANS: () =>
    "Verbleibender Betrag nach Berücksichtigung der Kredite für einen breit gestreuten ETF.",
  KEEP_LIQUID_NON_POSITIVE_RETURN: (r) =>
    `Bei erwarteter Rendite von ${formatBpsDE(r.expectedReturnBps)} bleibt der Betrag liquide auf dem Konto.`,
  SURPLUS_BUFFER: (r) =>
    `${formatBpsDE(r.bufferBps)} Puffer bleiben als Liquiditätsreserve auf dem Haushaltskonto.`,
  EMERGENCY_FUND_MONTHLY: (r) =>
    `Monatliche Rate zum Auffüllen der Notgroschen-Lücke (${formatEuroDE(r.gapCents)}) in ${r.fillMonths} Monaten.`,
  POT_MONTHLY_REQUIRED: (r) =>
    `Erforderliche Monatsrate von ${formatEuroDE(r.requiredMonthlyCents)} für Termin ${formatYearMonthDE(r.targetMonth)}.`,
  POT_MONTHLY_INSUFFICIENT: (r) =>
    `Der freie Überschuss deckt nur ${formatEuroDE(r.allocatedCents)} statt ${formatEuroDE(r.requiredMonthlyCents)} für Termin ${formatYearMonthDE(r.targetMonth)}.`,
  RATE_INCREASE_BEATS_ETF: (r) =>
    r.breakEvenBps !== null
      ? `Rate von ${formatEuroDE(r.currentMonthlyRateCents)} auf ${formatEuroDE(r.newMonthlyRateCents)} erhöhen: Kreditzins (${formatBpsDE(r.interestRateBps)}) schlägt die erwartete ETF-Rendite (${formatBpsDE(r.expectedReturnBps)}) inkl. ${formatBpsDE(r.safetyMarginBps)} Sicherheitsaufschlag (Break-even ${formatBpsDE(r.breakEvenBps)}).`
      : `Rate von ${formatEuroDE(r.currentMonthlyRateCents)} auf ${formatEuroDE(r.newMonthlyRateCents)} erhöhen: Ratenerhöhung liegt über der erwarteten ETF-Rendite (${formatBpsDE(r.expectedReturnBps)}).`,
  RATE_CHANGE_CORRIDOR_LIMIT: (r) =>
    `Begrenzt durch die vertragliche Maximalrate von ${formatEuroDE(r.maxMonthlyCents)} pro Monat.`,
  RATE_CHANGE_SHARE_LIMIT: (r) =>
    `Begrenzt auf höchstens ${formatBpsDE(r.shareBps)} des monatlichen Überschusses.`,
  RATE_CHANGE_COUNT_UNKNOWN: () =>
    "Anzahl erlaubter Tilgungssatzwechsel im Vertrag nicht hinterlegt – bitte vor Beantragung prüfen.",
  PREPAYMENT_CAP_PERCENT_OF_BALANCE: (r) =>
    `Sondertilgungsdeckel entspricht ${formatBpsDE(r.percentBps)} der aktuellen Restschuld (${formatEuroDE(r.capCents)} pro Jahr).`,
} satisfies ReasonFormatterMap;

export function formatRecommendationReason(reason: RecommendationReason): string {
  const fn = REASON_FORMATTERS[reason.code] as (r: RecommendationReason) => string;
  return fn(reason);
}

type NoteFormatterMap = {
  [K in RecommendationNote["code"]]: (
    n: Extract<RecommendationNote, { code: K }>,
    labels: RecommendationLabels,
  ) => string;
};

const NOTE_FORMATTERS = {
  AMOUNT_ZERO: () => "Gib einen Betrag ein, um eine Aufteilung zu berechnen.",
  NO_SURPLUS: (n) =>
    `Aktuell bleibt kein monatlicher Überschuss (${formatEuroDE(n.surplusCents)}).`,
  EMERGENCY_FUND_FULL: (n) =>
    `Notgroschen ist bereits gedeckt (${formatEuroDE(n.currentCents)} von ${formatEuroDE(n.targetCents)}).`,
  EMERGENCY_TARGET_UNKNOWN: () =>
    "Notgroschen-Ziel unbekannt (keine Haushaltsausgaben und kein Topf-Ziel hinterlegt).",
  POT_ON_TRACK: (n, labels) =>
    `Topf „${labels.potNames[n.potId] ?? "Ziel-Topf"}“ liegt bis ${formatYearMonthDE(n.targetMonth)} im Plan.`,
  POT_NO_DEADLINE_SKIPPED: (n, labels) =>
    `Topf „${labels.potNames[n.potId] ?? "Ziel-Topf"}“ hat keinen Termin und wird hier übersprungen.`,
  LOAN_NO_PREPAYMENT_RIGHT: (n, labels) =>
    `Kredit „${labels.loanNames[n.loanId] ?? "Kredit"}“ hat kein Sondertilgungsrecht.`,
  LOAN_RATE_BELOW_INTEREST: (n, labels) =>
    `Bei „${labels.loanNames[n.loanId] ?? "Kredit"}“ deckt die Monatsrate die laufenden Zinsen nicht.`,
  POT_DUE_ONE_TIME: (n, labels) =>
    `Topf „${labels.potNames[n.potId] ?? "Ziel-Topf"}“ ist diesen Monat fällig (${formatEuroDE(n.shortfallCents)} offen – prüfe „Wohin mit X €?“).`,
  RATE_DECREASE_POSSIBLE: (n, labels) =>
    `Bei „${labels.loanNames[n.loanId] ?? "Kredit"}“ wäre eine Ratensenkung von ${formatEuroDE(n.currentMonthlyRateCents)} auf bis zu ${formatEuroDE(n.minMonthlyCents)} möglich (Entlastung bis ${formatEuroDE(n.reliefCents)} pro Monat).`,
  RATE_CHANGE_ALTERNATIVE: (n, labels) =>
    n.remainingChanges !== null
      ? `Bei „${labels.loanNames[n.loanId] ?? "Kredit"}“ ist eine monatliche Ratenerhöhung bis ${formatEuroDE(n.maxMonthlyCents)} pro Monat als Alternative möglich (${n.remainingChanges} Wechsel übrig).`
      : `Bei „${labels.loanNames[n.loanId] ?? "Kredit"}“ ist eine monatliche Ratenerhöhung bis ${formatEuroDE(n.maxMonthlyCents)} pro Monat als Alternative möglich.`,
  RATE_CHANGE_RIGHT_UNKNOWN: (n, labels) =>
    `Bei „${labels.loanNames[n.loanId] ?? "Kredit"}“ könnte eine Ratenerhöhung lohnen – Tilgungssatzwechsel im Vertrag prüfen.`,
  RATE_CHANGE_SKIPPED_FIXED_END_SOON: (n, labels) =>
    `Bei „${labels.loanNames[n.loanId] ?? "Kredit"}“ endet die Zinsbindung bald (${formatIsoDateMonthYearDE(n.fixedInterestUntil)}) – keinen Tilgungssatzwechsel mehr vorgeschlagen.`,
  SPECIAL_REPAYMENT_AMOUNT_UNKNOWN: (n, labels) =>
    n.missingOriginalPrincipal
      ? `Bei „${labels.loanNames[n.loanId] ?? "Kredit"}“ fehlt der Ursprungsbetrag – Sondertilgungshöhe daher unbekannt.`
      : `Bei „${labels.loanNames[n.loanId] ?? "Kredit"}“ ist die Höhe des Sondertilgungsrechts nicht hinterlegt.`,
} satisfies NoteFormatterMap;

export function formatRecommendationNote(
  note: RecommendationNote,
  labels: RecommendationLabels = { potNames: {}, loanNames: {} },
): string {
  const fn = NOTE_FORMATTERS[note.code] as (
    n: RecommendationNote,
    l: RecommendationLabels,
  ) => string;
  return fn(note, labels);
}

export function formatRecommendationHeadline(
  result: RecommendationResult,
  labels: RecommendationLabels,
): string {
  if (result.items.length === 0) {
    return result.mode === "one_time"
      ? "Gib einen Betrag ein."
      : "Aktuell bleibt kein Überschuss.";
  }

  const parts = result.items.map((item) => {
    const amt = formatEuroDE(item.amountCents);
    const label = resolveItemLabel(item, labels);
    switch (item.kind) {
      case "emergency_fund":
        return item.target.type === "pot"
          ? `${amt} in „${label}“`
          : `${amt} in den Notgroschen`;
      case "pot_deadline":
        return `${amt} in „${label}“`;
      case "loan_prepayment":
        return `${amt} Sondertilgung ${label}`;
      case "loan_rate_increase":
        return item.newMonthlyRateCents !== undefined
          ? `${amt} höhere Rate (${label} auf ${formatEuroDE(item.newMonthlyRateCents)})`
          : `${amt} Ratenerhöhung ${label}`;
      case "loan_reserve":
        return `${amt} Tilgungsreserve (${label})`;
      case "etf":
        return result.mode === "monthly"
          ? `${amt} ETF-Sparplan`
          : `${amt} in einen breit gestreuten ETF`;
      case "keep_liquid":
        return result.mode === "monthly" ? `${amt} Puffer` : `${amt} liquide halten`;
    }
  });

  if (result.mode === "monthly") {
    return `Von ${formatEuroDE(result.amountCents)} Überschuss: ${parts.join(", ")}.`;
  }
  return `${parts.join(", ")}.`;
}

export function formatAssumptionsSummary(
  a: RecommendationAssumptions,
): string {
  const church =
    a.churchTaxBps === 0
      ? "ohne Kirchensteuer"
      : `${formatBpsDE(a.churchTaxBps)} Kirchensteuer`;
  return `Annahmen: ETF ${formatBpsDE(a.etfAnnualReturnBps)} p. a. · Aufschlag ${formatBpsDE(a.safetyMarginBps).replace(" %", " Prozentpunkte")} · Notgroschen ${a.emergencyFundMonths} Monatsausgaben · Termin nah ≤ ${a.shortHorizonMonths} Monate · Steuer: Pauschbetrag ${formatEuroDE(a.saverAllowanceCents)}, ${church}`;
}
