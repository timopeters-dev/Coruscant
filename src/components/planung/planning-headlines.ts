import { formatWholeEuroDE } from "@/components/charts/chart-scale";
import { addMonthsToYearMonth } from "@/lib/domain/date";
import { formatBpsDE } from "@/lib/domain/money";
import type { BreakEvenResult } from "@/lib/domain/scenarios";
import { formatYearMonthDE } from "./format";
import type { FreeMoneyView, SalaryView } from "./planning-state";

export interface PlanningHeadline {
  primary: string;
  secondary: string | null;
  tone: "neutral" | "warning";
}

/**
 * Formats a month duration in German nominative (e.g. "3 Monate", "1 Jahr und 2 Monate").
 */
export function formatDurationDE(months: number): string {
  const m = Math.max(0, Math.trunc(months));
  if (m === 0) return "sofort";
  const years = Math.trunc(m / 12);
  const rem = m % 12;

  const yearPart = years > 0 ? `${years} ${years === 1 ? "Jahr" : "Jahre"}` : "";
  const monthPart = rem > 0 ? `${rem} ${rem === 1 ? "Monat" : "Monate"}` : "";

  if (yearPart && monthPart) return `${yearPart} und ${monthPart}`;
  return yearPart || monthPart;
}

/**
 * Formats a month duration in German dative after "nach" / "in" (e.g. "15 Jahren", "7 Monaten").
 */
export function formatAfterDurationDE(months: number): string {
  const m = Math.max(0, Math.trunc(months));
  if (m === 0) return "sofort";
  const years = Math.trunc(m / 12);
  const rem = m % 12;

  const yearPart = years > 0 ? `${years} ${years === 1 ? "Jahr" : "Jahren"}` : "";
  const monthPart = rem > 0 ? `${rem} ${rem === 1 ? "Monat" : "Monaten"}` : "";

  if (yearPart && monthPart) return `${yearPart} und ${monthPart}`;
  return yearPart || monthPart;
}

export function buildFreeMoneyHeadlines(
  view: FreeMoneyView,
  breakEven: BreakEvenResult | null,
): PlanningHeadline {
  if (view.kind === "no_loans") {
    return {
      primary: "Ohne Kredit gibt es nichts zu vergleichen.",
      secondary: null,
      tone: "neutral",
    };
  }
  if (view.kind === "zero_budget") {
    return {
      primary:
        "Lege einen Einmalbetrag oder eine Sparrate fest – mit 0 € sind beide Wege identisch.",
      secondary: null,
      tone: "neutral",
    };
  }
  if (view.kind === "horizon_elapsed") {
    return {
      primary:
        "Kein Vergleichszeitraum – die Zinsbindung ist abgelaufen. Lege unter „Erweitert“ einen Horizont fest.",
      secondary: null,
      tone: "neutral",
    };
  }
  if (view.kind === "invalid") {
    return {
      primary: view.message,
      secondary: null,
      tone: "warning",
    };
  }

  const { result, horizonEndDate, input } = view;
  const endMonthLabel = formatYearMonthDE(horizonEndDate.slice(0, 7));
  const prefix =
    result.horizonMonths === 0
      ? `Bis ${endMonthLabel}`
      : `Nach ${formatAfterDurationDE(result.horizonMonths)} (${endMonthLabel})`;

  const isRoundedEqual =
    result.winner === "equal" || Math.abs(result.netAdvantageEtfCents) < 50;

  let primary: string;
  if (isRoundedEqual) {
    primary = `${prefix} liegen beide Wege gleichauf.`;
  } else if (result.winner === "etf") {
    primary = `${prefix}: ETF-Ansparung liegt ${formatWholeEuroDE(result.netAdvantageEtfCents)} vor der Sondertilgung.`;
  } else {
    primary = `${prefix}: Sondertilgung liegt ${formatWholeEuroDE(-result.netAdvantageEtfCents)} vor dem ETF.`;
  }

  let secondary: string | null = null;
  if (breakEven) {
    if (breakEven.kind === "bps") {
      secondary = `Das ETF lohnt sich ab ${formatBpsDE(breakEven.bps)} Rendite p. a. – du rechnest mit ${formatBpsDE(input.etfAnnualReturnBps)}.`;
    } else if (breakEven.kind === "unreachable") {
      secondary =
        "Selbst mit 30 % Rendite holt das ETF die Sondertilgung nicht ein.";
    } else if (breakEven.kind === "identical") {
      secondary =
        "Die Rendite spielt hier keine Rolle – es wird nicht sondergetilgt.";
    }
  }

  return { primary, secondary, tone: "neutral" };
}

export function buildSalaryHeadlines(
  view: SalaryView,
  startMonth: string,
): PlanningHeadline {
  if (view.kind === "no_pots") {
    return {
      primary: "Noch keine Töpfe vorhanden – lege unter Allokation Ziele fest.",
      secondary: null,
      tone: "neutral",
    };
  }
  if (view.kind === "invalid") {
    return {
      primary: view.message,
      secondary: null,
      tone: "warning",
    };
  }

  const { result, input } = view;
  const targetPots = result.pots.filter((p) => p.hasTarget);

  let primary: string;
  if (targetPots.length === 0) {
    primary =
      "Keine Töpfe mit Ziel – lege unter Allokation Ziele fest, dann siehst du hier, wann sie voll sind.";
  } else if (targetPots.every((p) => p.alreadyFilled)) {
    primary = "Alle Ziel-Töpfe sind bereits gefüllt.";
  } else {
    const unfilled = targetPots.filter((p) => !p.alreadyFilled);
    const scenarioUnreached = unfilled.filter(
      (p) => p.scenarioMonthsToFill === null,
    ).length;

    if (scenarioUnreached > 0) {
      primary = `${scenarioUnreached} von ${targetPots.length} Ziel-Töpfen werden in ${formatAfterDurationDE(result.horizonMonths)} nicht voll.`;
    } else {
      const maxScenMonths = Math.max(
        ...unfilled.map((p) => p.scenarioMonthsToFill!),
      );
      const scenFillDate = formatYearMonthDE(
        addMonthsToYearMonth(startMonth, Math.max(0, maxScenMonths - 1)),
      );
      const delta = input.change.deltaMonthlyCents;
      const effectiveFrom =
        input.change.effectiveFromMonth < startMonth
          ? startMonth
          : input.change.effectiveFromMonth;
      const fromStr = formatYearMonthDE(effectiveFrom);

      if (delta === 0) {
        primary = `Ohne Änderung sind alle Ziel-Töpfe ${scenFillDate} voll.`;
      } else {
        const baselineUnreached = unfilled.some(
          (p) => p.baselineMonthsToFill === null,
        );
        const amountLabel = formatWholeEuroDE(Math.abs(delta));
        const directionLabel = delta > 0 ? "mehr" : "weniger";

        if (baselineUnreached) {
          primary = `Mit ${amountLabel} ${directionLabel} pro Monat ab ${fromStr} sind alle Ziel-Töpfe ${scenFillDate} voll (heute nicht im Zeitraum).`;
        } else {
          const maxBaseMonths = Math.max(
            ...unfilled.map((p) => p.baselineMonthsToFill!),
          );
          const diff = maxBaseMonths - maxScenMonths;
          const diffPart =
            diff === 0
              ? "genauso schnell wie heute"
              : `${formatDurationDE(Math.abs(diff))} ${diff > 0 ? "früher" : "später"} als heute`;
          primary = `Mit ${amountLabel} ${directionLabel} pro Monat ab ${fromStr} sind alle Ziel-Töpfe ${scenFillDate} voll – ${diffPart}.`;
        }
      }
    }
  }

  if (result.scenarioDeficitMonths > 0) {
    return {
      primary,
      secondary: `Im Szenario ergibt sich in ${result.scenarioDeficitMonths} ${result.scenarioDeficitMonths === 1 ? "Monat" : "Monaten"} ein Defizit – die Töpfe werden dann nicht gefüllt (keine Entnahme).`,
      tone: "warning",
    };
  }

  return {
    primary,
    secondary: `Neuer Überschuss: ${formatWholeEuroDE(result.scenarioSurplusAfterChangeCents)} / Monat (heute ${formatWholeEuroDE(input.baseMonthlySurplusCents)}).`,
    tone: "neutral",
  };
}
