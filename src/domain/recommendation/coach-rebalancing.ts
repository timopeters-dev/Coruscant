import {
  allocateProportionally,
  assertNonNegativeInteger,
  assertSafeInteger,
} from "@/domain/core/money";

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

interface ContributionOnlyResult {
  plan: ContributionOnlyPlan;
  /** Monatliche Aufteilung, passend zum Zielvolumen T' (nur bei status "ok" und Bedarf > 0). */
  split: number[] | null;
}

function calculateContributionOnly(
  current: number[],
  weights: number[],
  total: number,
  rate: number,
): ContributionOnlyResult {
  const noSplit = (plan: ContributionOnlyPlan): ContributionOnlyResult => ({
    plan,
    split: null,
  });
  if (total === 0) {
    return noSplit({
      status: "ok",
      requiredContributionCents: 0,
      monthsNeeded: 0,
    });
  }

  for (let i = 0; i < weights.length; i++) {
    if (weights[i] === 0 && current[i]! > 0) {
      return noSplit({ status: "unavailable", reason: "requires_sale" });
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
    return noSplit({
      status: "ok",
      requiredContributionCents: 0,
      monthsNeeded: 0,
    });
  }
  if (rate === 0) {
    return noSplit({ status: "unavailable", reason: "no_savings_rate" });
  }

  let months = ceilDiv(required, BigInt(rate));
  if (months > BigInt(MAX_REBALANCING_MONTHS)) {
    return noSplit({ status: "unavailable", reason: "too_long" });
  }

  // Split proportional zum Fehlbetrag gegenüber dem Zielvolumen T' (nicht zum heutigen Gesamtwert):
  // Fehlbetrag_c = T' × w_c / 10.000 − current_c (skaliert mit 10.000, exakt rational).
  const scaledShortfalls = weights.map((w, i) => {
    const diff = neededTotal * BigInt(w) - BigInt(current[i]!) * BigInt(BPS_TOTAL);
    return diff > 0n ? diff : 0n;
  });
  const divisor = BigInt(BPS_TOTAL);
  const split = allocateBigProportionally(rate, scaledShortfalls);

  // Klassen mit minimalem Fehlbetrag (Aufrundung auf 1 Cent) sollen nicht leer ausgehen:
  // 1 Cent vom größten Anteil umbuchen, damit die Monatsrechnung endlich bleibt.
  for (let i = 0; i < weights.length; i++) {
    if (scaledShortfalls[i]! > 0n && split[i] === 0) {
      const donor = split.reduce(
        (best, value, idx) => (value > split[best]! ? idx : best),
        0,
      );
      if (split[donor]! > 1) {
        split[donor] = split[donor]! - 1;
        split[i] = 1;
      }
    }
  }

  // Rundung der Aufteilung kann eine Klasse knapp unter ihr Soll drücken: Monate so anheben,
  // dass current + split × Monate jede Klasse auf T' abdeckt (Invariante).
  for (let i = 0; i < weights.length; i++) {
    const shortfall = ceilDiv(scaledShortfalls[i]!, divisor);
    if (shortfall === 0n) continue;
    if (split[i] === 0) {
      return noSplit({ status: "unavailable", reason: "too_long" });
    }
    const needed = ceilDiv(shortfall, BigInt(split[i]!));
    if (needed > months) months = needed;
  }
  if (months > BigInt(MAX_REBALANCING_MONTHS)) {
    return noSplit({ status: "unavailable", reason: "too_long" });
  }

  return {
    plan: {
      status: "ok",
      requiredContributionCents: Number(required),
      monthsNeeded: Number(months),
    },
    split,
  };
}

function allocateBigProportionally(total: number, weights: bigint[]): number[] {
  const sum = weights.reduce((a, b) => a + b, 0n);
  if (sum === 0n) return weights.map(() => 0);
  const totalBig = BigInt(total);
  const shares = weights.map((w) => (w * totalBig) / sum);
  const order = weights
    .map((w, index) => ({ index, remainder: (w * totalBig) % sum }))
    .sort((a, b) =>
      a.remainder === b.remainder
        ? a.index - b.index
        : a.remainder > b.remainder
          ? -1
          : 1,
    );
  let leftover = totalBig - shares.reduce((a, b) => a + b, 0n);
  for (const { index } of order) {
    if (leftover <= 0n) break;
    shares[index] = shares[index]! + 1n;
    leftover -= 1n;
  }
  return shares.map((s) => Number(s));
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
  const fallbackSplit = allocateProportionally(
    rate,
    shortfallSum > 0 ? shortfalls : weights,
  );
  const contribution = calculateContributionOnly(current, weights, total, rate);
  // Bei Zukauf-Plan: Aufteilung passend zum Zielvolumen T', damit Monate und Split konsistent sind.
  const split = contribution.split ?? fallbackSplit;

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
    contributionOnly: contribution.plan,
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
