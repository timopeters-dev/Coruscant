import type { DomainContract } from "./contracts";
import { extractContractMilestones, projectContractBalance } from "./contracts";
import { countCompletedMonths, diffCalendarDays } from "./date";
import {
  allocateProportionally,
  assertNonNegativeInteger,
  assertSafeInteger,
} from "./money";
import {
  containsEmail,
  containsIban,
  containsLongDigitRun,
} from "./pii-patterns";

export const MAX_CONTEXT_POSITIONS = 20;
export const MAX_CONTEXT_GOALS = 10;
export const MAX_CONTEXT_MILESTONES = 8;
export const MAX_INSTRUMENT_NAME_LENGTH = 80;

export const CONTEXT_ASSET_CLASSES = ["etf", "stock", "crypto"] as const;
export type ContextAssetClass = (typeof CONTEXT_ASSET_CLASSES)[number];
export type ContextPotPurpose = "emergency_fund" | "goal" | "investment";
export type ContextAccountType = "checking" | "savings" | "brokerage" | "paypal";

export interface InvestmentContextInput {
  /** YYYY-MM-DD */
  asOfDate: string;
  /** ISO-Zeitstempel des letzten Snapshots */
  snapshotFetchedAt: string | null;
  isDummyHousehold: boolean;
  positions: {
    id: string;
    accountId: string;
    name: string;
    isin: string | null;
    assetClass: ContextAssetClass;
    marketValueCents: number;
  }[];
  accounts: {
    id: string;
    name: string;
    type: ContextAccountType;
    scope: string;
    balanceCents: number;
  }[];
  pots: {
    id: string;
    name: string;
    priority: number;
    purpose: ContextPotPurpose | null;
    currentCents: number;
    targetCents: number | null;
    linkedContractId: string | null;
    linkedPropertyId: string | null;
  }[];
  contracts: DomainContract[];
  /** null = keine Haushaltsdaten */
  monthlyLivingCostsCents: number | null;
  /** signed, konsolidiert wie /allokation */
  monthlySurplusCents: number;
  /** ≥ 0 */
  monthlySavingsRateCents: number;
}

export type ContextGoalKind =
  | "loan_payoff"
  | "savings_contract"
  | "property"
  | "general";

export interface InvestmentContext {
  schemaVersion: 1;
  asOfMonth: string;
  dataQuality: {
    snapshotAgeDays: number | null;
    isDummyHousehold: boolean;
    positionCount: number;
    truncatedPositionCount: number;
  };
  portfolio: {
    totalValueCents: number;
    assetClasses: {
      assetClass: ContextAssetClass;
      valueCents: number;
      weightBps: number;
    }[];
    positions: {
      ref: string;
      assetClass: ContextAssetClass;
      weightBps: number;
      instrumentName: string | null;
      isin: string | null;
    }[];
    otherPositionsWeightBps: number;
    largestPositionWeightBps: number;
  };
  liquidity: {
    liquidCents: number;
    brokerageCashCents: number;
    monthlyLivingCostsCents: number | null;
    coverageMonthsTenths: number | null;
  };
  emergencyFund: {
    configured: boolean;
    currentCents: number;
    targetCents: number | null;
    coverageMonthsTenths: number | null;
  };
  goals: {
    ref: string;
    purpose: "goal" | "investment" | "unspecified";
    kind: ContextGoalKind;
    currentCents: number;
    targetCents: number | null;
    horizonMonths: number | null;
  }[];
  milestones: {
    ref: string;
    category: "loan" | "savings_contract";
    kind: "milestone" | "fixed_interest_end";
    monthsUntil: number;
    outstandingBalanceCents: number | null;
    interestRateBps: number | null;
  }[];
  cashflow: {
    monthlySurplusCents: number;
    monthlySavingsRateCents: number;
  };
}

const REF_PREFIX: Record<ContextAssetClass, string> = {
  etf: "ETF",
  stock: "AKTIE",
  crypto: "KRYPTO",
};

/**
 * Anteile in Basispunkten per Largest-Remainder. Summe = exakt 10.000, sobald die
 * Gesamtsumme > 0 ist; sonst alle 0. Negative Werte werfen.
 */
export function allocateWeightsBps(values: readonly number[]): number[] {
  return allocateProportionally(10_000, values);
}

/**
 * Bereinigt einen ETF-Namen. Gibt `null` zurück, wenn der Name nach PII aussieht
 * (IBAN, E-Mail, Ziffernfolge ≥ 8 Stellen) oder leer ist.
 */
export function sanitizeInstrumentName(raw: string): string | null {
  const normalized = raw.replace(/\s+/g, " ").trim();
  if (normalized.length === 0) return null;
  if (
    containsIban(normalized) ||
    containsEmail(normalized) ||
    containsLongDigitRun(normalized, 8)
  ) {
    return null;
  }
  return normalized.slice(0, MAX_INSTRUMENT_NAME_LENGTH).trim();
}

/** Akzeptiert nur das ISIN-Format `^[A-Z]{2}[A-Z0-9]{9}\d$` (Großbuchstaben, getrimmt). */
export function normalizeIsin(raw: string | null): string | null {
  if (raw === null) return null;
  const trimmed = raw.trim();
  return /^[A-Z]{2}[A-Z0-9]{9}\d$/.test(trimmed) ? trimmed : null;
}

function compareStrings(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function coverageTenths(
  cents: number,
  monthlyCostsCents: number | null,
): number | null {
  if (monthlyCostsCents === null || monthlyCostsCents <= 0) return null;
  return Number((BigInt(cents) * 10n) / BigInt(monthlyCostsCents));
}

/**
 * Einzige Quelle für die Ref-Vergabe der Positionen (Wert absteigend, Gleichstand nach id;
 * Refs je Klasse). Wird vom Builder und von der UI-Label-Zuordnung gemeinsam genutzt.
 */
export function rankContextPositions<
  P extends { id: string; assetClass: ContextAssetClass; marketValueCents: number },
>(positions: readonly P[]): { position: P; ref: string }[] {
  const active = positions
    .map((p) => ({
      ...p,
      marketValueCents: assertNonNegativeInteger(
        p.marketValueCents,
        "position.marketValueCents",
      ),
    }))
    .filter((p) => p.marketValueCents > 0)
    .sort(
      (a, b) =>
        b.marketValueCents - a.marketValueCents || compareStrings(a.id, b.id),
    );

  // Refs je Klasse nach Sortierung (größte Position = Nr. 1).
  const classCounters: Record<ContextAssetClass, number> = {
    etf: 0,
    stock: 0,
    crypto: 0,
  };
  return active.map((p) => {
    classCounters[p.assetClass] += 1;
    return {
      position: p,
      ref: `${REF_PREFIX[p.assetClass]}-${classCounters[p.assetClass]}`,
    };
  });
}

/** Töpfe, die als Ziele (ZIEL-n) in den Kontext gehen – geordnet nach priority, id. */
export function selectContextGoalPots<
  T extends { id: string; priority: number; purpose: ContextPotPurpose | null },
>(pots: readonly T[]): T[] {
  return pots
    .filter((p) => p.purpose !== "emergency_fund")
    .sort((a, b) => a.priority - b.priority || compareStrings(a.id, b.id))
    .slice(0, MAX_CONTEXT_GOALS);
}

/** Meilensteine (MEILENSTEIN-n): aktive Verträge, nicht überfällig, chronologisch, gekappt. */
export function selectContextMilestones(
  contracts: readonly DomainContract[],
  asOfDate: string,
) {
  return extractContractMilestones(
    contracts.filter((c) => c.status === "active"),
    asOfDate,
  )
    .filter((m) => !m.isOverdue)
    .slice(0, MAX_CONTEXT_MILESTONES);
}

function buildPortfolio(
  input: InvestmentContextInput,
): InvestmentContext["portfolio"] & { positionCount: number } {
  const withRefs = rankContextPositions(input.positions);
  const active = withRefs.map((w) => w.position);

  const totalValueCents = assertSafeInteger(
    active.reduce((sum, p) => sum + p.marketValueCents, 0),
    "totalValueCents",
  );

  const classValues = CONTEXT_ASSET_CLASSES.map((assetClass) =>
    active
      .filter((p) => p.assetClass === assetClass)
      .reduce((sum, p) => sum + p.marketValueCents, 0),
  );
  const classWeights = allocateWeightsBps(classValues);
  const positionWeights = allocateWeightsBps(
    active.map((p) => p.marketValueCents),
  );

  const included = withRefs.slice(0, MAX_CONTEXT_POSITIONS);
  const otherPositionsWeightBps = positionWeights
    .slice(MAX_CONTEXT_POSITIONS)
    .reduce((sum, w) => sum + w, 0);

  return {
    totalValueCents,
    assetClasses: CONTEXT_ASSET_CLASSES.map((assetClass, i) => ({
      assetClass,
      valueCents: classValues[i]!,
      weightBps: classWeights[i]!,
    })),
    positions: included.map(({ position, ref }, i) => {
      const isEtf = position.assetClass === "etf";
      return {
        ref,
        assetClass: position.assetClass,
        weightBps: positionWeights[i]!,
        instrumentName: isEtf ? sanitizeInstrumentName(position.name) : null,
        isin: isEtf ? normalizeIsin(position.isin) : null,
      };
    }),
    otherPositionsWeightBps,
    largestPositionWeightBps: positionWeights.reduce(
      (max, w) => (w > max ? w : max),
      0,
    ),
    positionCount: active.length,
  };
}

function buildHorizonMonths(
  contract: DomainContract | undefined,
  asOfDate: string,
): number | null {
  if (!contract) return null;
  const dates = [contract.milestoneDate, contract.fixedInterestUntil].filter(
    (d): d is string => typeof d === "string" && d.length > 0,
  );
  if (dates.length === 0) return null;

  const future = dates.filter((d) => diffCalendarDays(asOfDate, d) >= 0).sort();
  if (future.length === 0) return 0;
  return countCompletedMonths(asOfDate, future[0]!);
}

/**
 * Baut den anonymisierten, deterministisch verdichteten KI-Kontext. Jedes Feld wird
 * explizit gebaut (Allowlist) – kein Spread/Durchreichen von Eingabeobjekten.
 */
export function buildInvestmentContext(
  input: InvestmentContextInput,
): InvestmentContext {
  const { positionCount, ...portfolio } = buildPortfolio(input);
  const costs =
    input.monthlyLivingCostsCents === null
      ? null
      : assertNonNegativeInteger(
          input.monthlyLivingCostsCents,
          "monthlyLivingCostsCents",
        );

  let liquid = 0;
  let brokerageCash = 0;
  for (const account of input.accounts) {
    assertSafeInteger(account.balanceCents, "account.balanceCents");
    if (account.type === "brokerage") {
      brokerageCash += account.balanceCents;
    } else {
      liquid += account.balanceCents;
    }
  }
  const liquidCents = Math.max(0, liquid);
  const brokerageCashCents = Math.max(0, brokerageCash);

  const emergencyPots = input.pots.filter((p) => p.purpose === "emergency_fund");
  const emergencyCurrent = emergencyPots.reduce(
    (sum, p) => sum + assertNonNegativeInteger(p.currentCents, "pot.currentCents"),
    0,
  );
  const emergencyTarget = emergencyPots.every((p) => p.targetCents !== null)
    ? emergencyPots.reduce((sum, p) => sum + (p.targetCents ?? 0), 0)
    : null;
  const emergencyConfigured = emergencyPots.length > 0;

  const contractById = new Map(input.contracts.map((c) => [c.id, c]));
  const propertyLinked = (p: { linkedPropertyId: string | null }) =>
    p.linkedPropertyId !== null;

  const goals = selectContextGoalPots(input.pots)
    .map((pot, index): InvestmentContext["goals"][number] => {
      const contract =
        pot.linkedContractId !== null
          ? contractById.get(pot.linkedContractId)
          : undefined;
      const kind: ContextGoalKind = contract
        ? contract.category === "loan"
          ? "loan_payoff"
          : "savings_contract"
        : propertyLinked(pot)
          ? "property"
          : "general";
      return {
        ref: `ZIEL-${index + 1}`,
        purpose: pot.purpose === "emergency_fund" ? "unspecified" : (pot.purpose ?? "unspecified"),
        kind,
        currentCents: pot.currentCents,
        targetCents: pot.targetCents,
        horizonMonths: buildHorizonMonths(contract, input.asOfDate),
      };
    });

  const milestones = selectContextMilestones(input.contracts, input.asOfDate)
    .map((m, index): InvestmentContext["milestones"][number] => {
      const contract = contractById.get(m.contractId);
      let outstanding: number | null = null;
      if (contract) {
        try {
          outstanding = projectContractBalance(
            contract,
            input.asOfDate,
          ).projectedBalanceCents;
        } catch {
          outstanding = null;
        }
      }
      return {
        ref: `MEILENSTEIN-${index + 1}`,
        category: m.category === "loan" ? "loan" : "savings_contract",
        kind: m.kind,
        monthsUntil: countCompletedMonths(input.asOfDate, m.date),
        outstandingBalanceCents: outstanding,
        interestRateBps: contract ? contract.interestRateBps : null,
      };
    });

  return {
    schemaVersion: 1,
    asOfMonth: input.asOfDate.slice(0, 7),
    dataQuality: {
      snapshotAgeDays:
        input.snapshotFetchedAt === null
          ? null
          : diffCalendarDays(input.snapshotFetchedAt.slice(0, 10), input.asOfDate),
      isDummyHousehold: input.isDummyHousehold,
      positionCount,
      truncatedPositionCount: Math.max(0, positionCount - MAX_CONTEXT_POSITIONS),
    },
    portfolio: {
      totalValueCents: portfolio.totalValueCents,
      assetClasses: portfolio.assetClasses,
      positions: portfolio.positions,
      otherPositionsWeightBps: portfolio.otherPositionsWeightBps,
      largestPositionWeightBps: portfolio.largestPositionWeightBps,
    },
    liquidity: {
      liquidCents,
      brokerageCashCents,
      monthlyLivingCostsCents: costs,
      coverageMonthsTenths: coverageTenths(liquidCents, costs),
    },
    emergencyFund: {
      configured: emergencyConfigured,
      currentCents: emergencyConfigured ? emergencyCurrent : 0,
      targetCents: emergencyConfigured ? emergencyTarget : null,
      coverageMonthsTenths: emergencyConfigured
        ? coverageTenths(emergencyCurrent, costs)
        : null,
    },
    goals,
    milestones,
    cashflow: {
      monthlySurplusCents: assertSafeInteger(
        input.monthlySurplusCents,
        "monthlySurplusCents",
      ),
      monthlySavingsRateCents: assertNonNegativeInteger(
        input.monthlySavingsRateCents,
        "monthlySavingsRateCents",
      ),
    },
  };
}

export function isInvestmentContextUsable(ctx: InvestmentContext): boolean {
  return ctx.dataQuality.positionCount > 0;
}

/** Rein: liefert eine neue Instanz mit geänderter Sparrate (Client-Vorschau). */
export function withSavingsRate(
  ctx: InvestmentContext,
  cents: number,
): InvestmentContext {
  return {
    ...ctx,
    cashflow: {
      monthlySurplusCents: ctx.cashflow.monthlySurplusCents,
      monthlySavingsRateCents: assertNonNegativeInteger(
        cents,
        "monthlySavingsRateCents",
      ),
    },
  };
}

/**
 * Stabile Serialisierung (feste Schlüsselreihenfolge durch den Builder).
 * Genau dieser String geht an die KI und wird in „Was die KI sieht“ angezeigt.
 */
export function serializeInvestmentContext(ctx: InvestmentContext): string {
  return JSON.stringify(ctx, null, 2);
}

/** Alle gültigen Refs des Kontexts (inkl. `NOTGROSCHEN` bei `configured: true`). */
export function collectContextRefs(ctx: InvestmentContext): Set<string> {
  const refs = new Set<string>();
  for (const p of ctx.portfolio.positions) refs.add(p.ref);
  for (const g of ctx.goals) refs.add(g.ref);
  for (const m of ctx.milestones) refs.add(m.ref);
  if (ctx.emergencyFund.configured) refs.add("NOTGROSCHEN");
  return refs;
}
