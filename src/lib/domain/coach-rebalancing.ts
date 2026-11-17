import {
  allocateProportionally,
  assertNonNegativeInteger,
  assertSafeInteger,
} from "./money";

export const REBALANCING_ASSET_CLASSES = ["etf", "stock", "crypto"] as const;
export type RebalancingAssetClass = (typeof REBALANCING_ASSET_CLASSES)[number];

export const MAX_REBALANCING_MONTHS = 600;
const BPS_TOTAL = 10_000;

export type ContributionOnlyUnavailableReason =
  | "requires_sale"
  | "no_savings_rate"
  | "too_long";

export type ContributionOnlyPlan =
  | {
      status: "ok";
      requiredContributionCents: number;
      monthsNeeded: number;
    }
  | { status: "unavailable"; reason: ContributionOnlyUnavailableReason };

export interface RebalancingClassRow {
  assetClass: RebalancingAssetClass;
  currentCents: number;
  currentWeightBps: number;
  targetWeightBps: number;
  targetCents: number;
  /** signed: target − current */
  deltaCents: number;
}

export interface RebalancingPlan {
  totalCents: number;
  classes: RebalancingClassRow[];
  contributionOnly: ContributionOnlyPlan;
  contributionSplitCents: Record<RebalancingAssetClass, number>;
}

export interface CalculateRebalancingPlanInput {
  currentValues: Record<RebalancingAssetClass, number>;
  targetWeightsBps: Record<RebalancingAssetClass, number>;
  monthlySavingsRateCents: number;
}

function ceilDiv(numerator: bigint, denominator: bigint): bigint {
  return (numerator + denominator - 1n) / denominator;
}

function calculateContributionOnly(
  current: number[],
  weights: number[],
  total: number,
  rate: number,
): ContributionOnlyPlan {
  if (total === 0) {
    return { status: "ok", requiredContributionCents: 0, monthsNeeded: 0 };
  }

  for (let i = 0; i < weights.length; i++) {
    if (weights[i] === 0 && current[i]! > 0) {
      return { status: "unavailable", reason: "requires_sale" };
    }
  }

  let neededTotal = 0n;
  for (let i = 0; i < weights.length; i++) {
    if (weights[i]! > 0) {
      const candidate = ceilDiv(
        BigInt(current[i]!) * BigInt(BPS_TOTAL),
        BigInt(weights[i]!),
      );
      if (candidate > neededTotal) neededTotal = candidate;
    }
  }

  const required = neededTotal - BigInt(total);
  if (required <= 0n) {
    return { status: "ok", requiredContributionCents: 0, monthsNeeded: 0 };
  }
  if (rate === 0) {
    return { status: "unavailable", reason: "no_savings_rate" };
  }

  const months = ceilDiv(required, BigInt(rate));
  if (months > BigInt(MAX_REBALANCING_MONTHS)) {
    return { status: "unavailable", reason: "too_long" };
  }

  return {
    status: "ok",
    requiredContributionCents: Number(required),
    monthsNeeded: Number(months),
  };
}

/**
 * Deterministische Rebalancing-Rechnung: Die KI liefert nur Ziel-Gewichte (Bps),
 * Soll-Werte, Deltas und Monate bis zum Soll (nur Zukäufe, kein Verkauf) rechnet die Domäne.
 * Die Rechnung ignoriert Kursentwicklung und ist daher *Modelliert*.
 */
export function calculateRebalancingPlan(
  input: CalculateRebalancingPlanInput,
): RebalancingPlan {
  const rate = assertNonNegativeInteger(
    input.monthlySavingsRateCents,
    "monthlySavingsRateCents",
  );
  const current = REBALANCING_ASSET_CLASSES.map((c) =>
    assertNonNegativeInteger(input.currentValues[c], `currentValues.${c}`),
  );
  const weights = REBALANCING_ASSET_CLASSES.map((c) =>
    assertNonNegativeInteger(input.targetWeightsBps[c], `targetWeightsBps.${c}`),
  );

  const weightSum = weights.reduce((a, b) => a + b, 0);
  if (weightSum !== BPS_TOTAL) {
    throw new RangeError(
      `targetWeightsBps must sum to ${BPS_TOTAL}, received: ${weightSum}`,
    );
  }

  const total = assertNonNegativeInteger(
    current.reduce((a, b) => a + b, 0),
    "totalCents",
  );
  const targets = allocateProportionally(total, weights);
  const currentWeights = allocateProportionally(BPS_TOTAL, current);
  const deltas = targets.map((t, i) => assertSafeInteger(t - current[i]!));

  const shortfalls = deltas.map((d) => Math.max(0, d));
  const shortfallSum = shortfalls.reduce((a, b) => a + b, 0);
  // Ohne untergewichtete Klassen (bereits im Soll) → nach Soll-Gewichten verteilen.
  const split = allocateProportionally(
    rate,
    shortfallSum > 0 ? shortfalls : weights,
  );

  const classes = REBALANCING_ASSET_CLASSES.map(
    (assetClass, i): RebalancingClassRow => ({
      assetClass,
      currentCents: current[i]!,
      currentWeightBps: currentWeights[i]!,
      targetWeightBps: weights[i]!,
      targetCents: targets[i]!,
      deltaCents: deltas[i]!,
    }),
  );

  return {
    totalCents: total,
    classes,
    contributionOnly: calculateContributionOnly(current, weights, total, rate),
    contributionSplitCents: {
      etf: split[0]!,
      stock: split[1]!,
      crypto: split[2]!,
    },
  };
}

/**
 * Entfernt unbekannte Refs aus `risks[].relatedRefs` und verwirft `horizonCheck`-Einträge
 * mit unbekanntem `ref`. Reine Ausgabe-Bereinigung, liefert eine neue Instanz.
 */
export function sanitizeAssessmentRefs<
  T extends {
    risks: { relatedRefs: string[] }[];
    horizonCheck: { ref: string }[];
  },
>(assessment: T, validRefs: ReadonlySet<string>): T {
  return {
    ...assessment,
    risks: assessment.risks.map((risk) => ({
      ...risk,
      relatedRefs: risk.relatedRefs.filter((ref) => validRefs.has(ref)),
    })),
    horizonCheck: assessment.horizonCheck.filter((entry) =>
      validRefs.has(entry.ref),
    ),
  };
}
