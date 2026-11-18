import { allocateProportionally, formatCentsDE, roundHalfUpBigInt } from "@/lib/domain/money";
import type { DeadlinePotInput } from "@/lib/domain/pot-deadline";
import type {
  EquitySourceEvaluation,
  PropertyPurchaseInput,
  PropertyPurchaseResult,
} from "@/lib/domain/property-purchase";
import {
  CURRENT_PURCHASE_COST_RULE_SET,
  PROPERTY_PURCHASE_EXAMPLE_SCENARIO,
} from "@/lib/domain/property-purchase-defaults";

export interface EquityPotOption extends DeadlinePotInput {
  purpose?: string | null;
}

export interface PurchaseHint {
  key: string;
  text: string;
}

export interface BreakdownSegment {
  key: "interest" | "principal" | "non_recoverable" | "maintenance";
  label: string;
  amountCents: number;
  widthBps: number;
}

export interface BreakdownBarData {
  rentCents: number;
  rentWidthBps: number;
  totalOutflowsCents: number;
  segments: BreakdownSegment[];
  surplusGapBps: number;
}

/**
 * Picks the default equity pot:
 * 1. first pot with purpose === "goal" and targetDate
 * 2. else first pot with purpose === "goal"
 * 3. else null
 * Sorted deterministically by priority asc, then id asc.
 */
export function pickDefaultEquityPot(
  pots: readonly EquityPotOption[],
): EquityPotOption | null {
  const sorted = [...pots].sort((a, b) => {
    if (a.priority !== b.priority) return a.priority - b.priority;
    return a.id.localeCompare(b.id);
  });

  const goalWithDate = sorted.find(
    (p) => p.purpose === "goal" && p.targetDate != null && p.targetDate !== "",
  );
  if (goalWithDate) return goalWithDate;

  const goalAny = sorted.find((p) => p.purpose === "goal");
  return goalAny ?? null;
}

export function defaultEquityForPot(
  pot: Pick<EquityPotOption, "currentCents" | "targetCents"> | null,
  fallbackCents: number,
): number {
  if (!pot) return fallbackCents;
  return pot.targetCents ?? pot.currentCents;
}

/**
 * Parses a non-negative integer string (e.g. "10" -> 10).
 * Rejects decimals, negative signs, empty strings, and non-digit characters.
 */
export function parseIntegerInput(raw: string): number | null {
  const trimmed = raw.trim();
  if (!/^\d+$/.test(trimmed)) {
    return null;
  }
  const parsed = Number(trimmed);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

export function getExampleDefaultPurchaseCostsCents(): number {
  return CURRENT_PURCHASE_COST_RULE_SET.items.reduce((sum, item) => {
    const amount = roundHalfUpBigInt(
      BigInt(PROPERTY_PURCHASE_EXAMPLE_SCENARIO.purchasePriceCents) *
        BigInt(item.bps),
      10_000n,
    );
    return sum + Number(amount);
  }, 0);
}

export function buildInitialFormState(
  equityCents?: number,
): PropertyPurchaseInput {
  return {
    ...PROPERTY_PURCHASE_EXAMPLE_SCENARIO,
    costItems: CURRENT_PURCHASE_COST_RULE_SET.items.map(
      ({ key, label, bps }) => ({ key, label, bps }),
    ),
    equityCents: equityCents ?? getExampleDefaultPurchaseCostsCents(),
  };
}

export function buildPurchaseHints(
  result: PropertyPurchaseResult,
  equitySource: EquitySourceEvaluation | null,
  household: { hasHouseholdData: boolean; isDummy: boolean },
): PurchaseHint[] {
  const hints: PurchaseHint[] = [];

  if (result.flags.belowMinimumEquity) {
    hints.push({
      key: "below_minimum_equity",
      text: "Bank finanziert Nebenkosten in der Regel nicht – gerechnet wird mit dem Mindest-Eigenkapital.",
    });
  }
  if (result.flags.equityExceedsTotal) {
    hints.push({
      key: "equity_exceeds_total",
      text: "Eingesetztes Eigenkapital übersteigt die Gesamtkosten; der Überschuss bleibt ungenutzt.",
    });
  }
  if (result.flags.loanFinancesPurchaseCosts) {
    hints.push({
      key: "loan_finances_costs",
      text: "Vollfinanzierung inkl. Nebenkosten (Schalter für Mindest-EK ist deaktiviert).",
    });
  }
  if (result.flags.noAmortization) {
    hints.push({
      key: "no_amortization",
      text: "Keine Tilgung im 1. Monat – die Restschuld bleibt unverändert.",
    });
  }
  if (equitySource && equitySource.targetCoversRequirement === false) {
    hints.push({
      key: "pot_target_shortfall",
      text: "Das aktuelle Topfziel liegt unter dem benötigten Eigenkapitalbedarf.",
    });
  }
  if (!household.hasHouseholdData) {
    hints.push({
      key: "no_household_data",
      text: "Keine Haushaltsdaten aus finanz_cockpit – der Überschuss enthält nur manuelle Posten und Verträge.",
    });
  } else if (household.isDummy) {
    hints.push({
      key: "dummy_household_data",
      text: "Haushaltsüberschuss basiert aktuell auf Dummy-Daten.",
    });
  }

  return hints;
}

export function buildBreakdownSegments(
  result: PropertyPurchaseResult,
  input: Pick<
    PropertyPurchaseInput,
    | "monthlyColdRentCents"
    | "monthlyNonRecoverableCostsCents"
    | "monthlyMaintenanceCents"
  >,
): BreakdownBarData {
  const rentCents = input.monthlyColdRentCents;
  const interestCents = result.loan.firstMonthInterestCents;
  const principalCents = result.loan.firstMonthPrincipalCents;
  const nonRecoverableCents = input.monthlyNonRecoverableCostsCents;
  const maintenanceCents = input.monthlyMaintenanceCents;

  const totalOutflowsCents =
    interestCents + principalCents + nonRecoverableCents + maintenanceCents;
  const scale = Math.max(rentCents, totalOutflowsCents);

  if (scale === 0) {
    return {
      rentCents: 0,
      rentWidthBps: 0,
      totalOutflowsCents: 0,
      segments: [
        { key: "interest", label: "Zins (1. Mon.)", amountCents: 0, widthBps: 0 },
        { key: "principal", label: "Tilgung (1. Mon.)", amountCents: 0, widthBps: 0 },
        { key: "non_recoverable", label: "Nicht umlagefähig", amountCents: 0, widthBps: 0 },
        { key: "maintenance", label: "Instandhaltung", amountCents: 0, widthBps: 0 },
      ],
      surplusGapBps: 0,
    };
  }

  const [rentWidthBps] = allocateProportionally(10_000, [
    rentCents,
    scale - rentCents,
  ]);

  const [
    interestBps,
    principalBps,
    nonRecoverableBps,
    maintenanceBps,
    surplusGapBps,
  ] = allocateProportionally(10_000, [
    interestCents,
    principalCents,
    nonRecoverableCents,
    maintenanceCents,
    scale - totalOutflowsCents,
  ]);

  return {
    rentCents,
    rentWidthBps: rentWidthBps!,
    totalOutflowsCents,
    segments: [
      {
        key: "interest",
        label: "Zins (1. Mon.)",
        amountCents: interestCents,
        widthBps: interestBps!,
      },
      {
        key: "principal",
        label: "Tilgung (1. Mon.)",
        amountCents: principalCents,
        widthBps: principalBps!,
      },
      {
        key: "non_recoverable",
        label: "Nicht umlagefähig",
        amountCents: nonRecoverableCents,
        widthBps: nonRecoverableBps!,
      },
      {
        key: "maintenance",
        label: "Instandhaltung",
        amountCents: maintenanceCents,
        widthBps: maintenanceBps!,
      },
    ],
    surplusGapBps: surplusGapBps!,
  };
}

export function formatBreakEvenEquityText(
  breakEven: PropertyPurchaseResult["breakEven"],
): string {
  if (breakEven.equity.kind === "unreachable") {
    return "trägt sich auch mit 100 % EK nicht";
  }
  if (breakEven.equity.kind === "at_minimum") {
    return breakEven.equity.equityCents === 0
      ? "trägt sich auch bei Vollfinanzierung"
      : "trägt sich bereits mit dem Mindest-EK";
  }
  const gap = breakEven.equityGapToBreakEvenCents ?? 0;
  const suffix =
    gap > 0
      ? `noch ${formatCentsDE(gap)} mehr EK als benötigt`
      : `${formatCentsDE(Math.abs(gap))} Puffer`;
  return `${formatCentsDE(breakEven.equity.equityCents)} (${suffix})`;
}
