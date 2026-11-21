import type { InvestmentContext } from "@/domain/recommendation/investment-context";

export const ASSET_CLASS_LABELS = {
  etf: "ETF",
  stock: "Einzelaktien",
  crypto: "Krypto",
} as const;

const GOAL_KIND_LABELS: Record<InvestmentContext["goals"][number]["kind"], string> = {
  loan_payoff: "Darlehens-Ablösung",
  savings_contract: "Sparvertrag",
  property: "Immobilie",
  general: "Allgemeines Ziel",
};

const MILESTONE_KIND_LABELS: Record<
  InvestmentContext["milestones"][number]["kind"],
  string
> = {
  milestone: "Meilenstein",
  fixed_interest_end: "Zinsbindungsende",
};

export function formatMonthsDE(months: number): string {
  return `${months} ${months === 1 ? "Monat" : "Monate"}`;
}

/** Coverage in tenths of months (34 → „3,4 Monate“) – ganzzahlig, ohne Float. */
export function formatCoverageTenthsDE(tenths: number): string {
  const whole = Math.trunc(tenths / 10);
  const frac = tenths % 10;
  return `${whole},${frac} Monate`;
}

/**
 * Löst einen KI-Ref lokal zu einem lesbaren Label auf, z. B.
 * „Darlehen A · Darlehens-Ablösung · 34 Monate“. Die KI kennt die echten Namen nie.
 */
export function describeRef(
  ref: string,
  ctx: InvestmentContext,
  labels: Readonly<Record<string, string>>,
): string {
  const name = labels[ref] ?? ref;

  const goal = ctx.goals.find((g) => g.ref === ref);
  if (goal) {
    const parts = [name, GOAL_KIND_LABELS[goal.kind]];
    if (goal.horizonMonths !== null) parts.push(formatMonthsDE(goal.horizonMonths));
    return parts.join(" · ");
  }

  const milestone = ctx.milestones.find((m) => m.ref === ref);
  if (milestone) {
    return [
      name,
      MILESTONE_KIND_LABELS[milestone.kind],
      `in ${formatMonthsDE(milestone.monthsUntil)}`,
    ].join(" · ");
  }

  if (ref === "NOTGROSCHEN" && ctx.emergencyFund.coverageMonthsTenths !== null) {
    return `${name} · ${formatCoverageTenthsDE(ctx.emergencyFund.coverageMonthsTenths)}`;
  }

  return name;
}
