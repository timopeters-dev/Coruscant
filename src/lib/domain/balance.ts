import { type DomainContract, projectContractBalance } from "./contracts";
import { parseIsoDate } from "./date";
import {
  assertNonNegativeInteger,
  assertSafeInteger,
  roundHalfUpBigInt,
} from "./money";
import type { DomainPot } from "./waterfall";

export interface DomainProperty {
  id: string;
  name: string;
  estimatedValueCents: number;
}

export interface DomainExternalSnapshot {
  liquidCashCents: number;
  etfStocksCents: number;
  cryptoCents: number;
  totalPersonalNetWorthCents: number;
  fetchedAt: string;
}

export interface BalancePot extends DomainPot {
  /**
   * Scope of the linked finanz_cockpit account/position. Pots linked to a
   * `personal` target are already part of `personalExternalAssetsCents`.
   */
  externalLinkScope?: "personal" | "household" | null;
  /**
   * Set for pots whose link overlaps another linked pot (account vs. its
   * position): their money is already counted elsewhere.
   */
  excludeFromLiquidity?: boolean;
}

export interface BalanceInput {
  asOfDate: string;
  properties: readonly DomainProperty[];
  contracts: readonly DomainContract[];
  pots: readonly BalancePot[];
  externalSnapshot?: DomainExternalSnapshot | null;
}

export interface BalanceSummary {
  asOfDate: string;
  householdLiquidCents: number;
  personalLinkedPotsCents: number;
  conflictingLinkedPotsCents: number;
  personalExternalAssetsCents: number;
  personalContractsAssetsCents: number;
  personalLiabilitiesCents: number;
  freeAssetsCents: number;
  propertiesValueCents: number;
  savingsContractsValueCents: number;
  boundAssetsCents: number;
  totalAssetsCents: number;
  householdLiabilitiesCents: number;
  liabilitiesCents: number;
  netWorthCents: number;
  householdNetWorthCents: number;
}

/**
 * Calculates the consolidated household balance sheet (Free vs. Bound vs. Liabilities)
 * using projected non-closed contract balances as of asOfDate.
 */
export function calculateHouseholdBalance(input: BalanceInput): BalanceSummary {
  parseIsoDate(input.asOfDate, "asOfDate");

  let householdLiquidCents = 0;
  let personalLinkedPotsCents = 0;
  let conflictingLinkedPotsCents = 0;
  for (const pot of input.pots) {
    const potCents = assertNonNegativeInteger(
      pot.currentCents,
      `pot(${pot.id}).currentCents`,
    );
    if (pot.externalLinkScope === "personal") {
      personalLinkedPotsCents += potCents;
    } else if (pot.excludeFromLiquidity === true) {
      conflictingLinkedPotsCents += potCents;
    } else {
      householdLiquidCents += potCents;
    }
  }

  let personalExternalAssetsCents = 0;
  let externalOverdraftCents = 0;
  if (input.externalSnapshot != null) {
    const cash = assertNonNegativeInteger(
      input.externalSnapshot.liquidCashCents,
      "externalSnapshot.liquidCashCents",
    );
    const etf = assertNonNegativeInteger(
      input.externalSnapshot.etfStocksCents,
      "externalSnapshot.etfStocksCents",
    );
    const crypto = assertNonNegativeInteger(
      input.externalSnapshot.cryptoCents,
      "externalSnapshot.cryptoCents",
    );
    const totalPersonalNetWorthCents = assertSafeInteger(
      input.externalSnapshot.totalPersonalNetWorthCents,
      "externalSnapshot.totalPersonalNetWorthCents",
    );
    personalExternalAssetsCents = cash + etf + crypto;
    externalOverdraftCents = Math.max(
      0,
      personalExternalAssetsCents - totalPersonalNetWorthCents,
    );
  }

  const freeAssetsCents = householdLiquidCents + personalExternalAssetsCents;

  let propertiesValueCents = 0;
  for (const prop of input.properties) {
    propertiesValueCents += assertNonNegativeInteger(
      prop.estimatedValueCents,
      `property(${prop.id}).estimatedValueCents`,
    );
  }

  let savingsContractsValueCents = 0;
  let householdLiabilitiesCents = 0;
  let personalContractsAssetsCents = 0;
  let personalLiabilitiesCents = externalOverdraftCents;

  for (const contract of input.contracts) {
    if (contract.status === "closed") {
      continue;
    }

    const projection = projectContractBalance(contract, input.asOfDate);
    if (contract.sphere === "personal") {
      if (contract.category === "savings_contract") {
        personalContractsAssetsCents += projection.projectedBalanceCents;
      } else {
        personalLiabilitiesCents += projection.projectedBalanceCents;
      }
    } else if (contract.category === "savings_contract") {
      savingsContractsValueCents += projection.projectedBalanceCents;
    } else {
      householdLiabilitiesCents += projection.projectedBalanceCents;
    }
  }

  const householdBoundAssetsCents =
    propertiesValueCents + savingsContractsValueCents;
  const boundAssetsCents =
    householdBoundAssetsCents + personalContractsAssetsCents;
  const totalAssetsCents = freeAssetsCents + boundAssetsCents;
  const liabilitiesCents =
    householdLiabilitiesCents + personalLiabilitiesCents;
  const netWorthCents = totalAssetsCents - liabilitiesCents;
  const householdNetWorthCents =
    householdLiquidCents +
    householdBoundAssetsCents -
    householdLiabilitiesCents;

  return {
    asOfDate: input.asOfDate,
    householdLiquidCents,
    personalLinkedPotsCents,
    conflictingLinkedPotsCents,
    personalExternalAssetsCents,
    personalContractsAssetsCents,
    personalLiabilitiesCents,
    freeAssetsCents,
    propertiesValueCents,
    savingsContractsValueCents,
    boundAssetsCents,
    totalAssetsCents,
    householdLiabilitiesCents,
    liabilitiesCents,
    netWorthCents,
    householdNetWorthCents,
  };
}

export type BalanceBarSegmentId = "free" | "bound" | "liabilities";

export interface BalanceBarSegment {
  id: BalanceBarSegmentId;
  amountCents: number;
  shareBps: number;
}

export interface BalanceBarBreakdown {
  totalVolumeCents: number;
  hasData: boolean;
  freeCents: number;
  boundCents: number;
  liabilitiesCents: number;
  freeShareBps: number;
  boundShareBps: number;
  liabilitiesShareBps: number;
  segments: BalanceBarSegment[];
}

const SEGMENT_PRIORITY: readonly BalanceBarSegmentId[] = [
  "free",
  "bound",
  "liabilities",
];

/**
 * Calculates the 3-segment balance bar breakdown (Free vs. Bound vs. Liabilities)
 * normalized to exactly 10,000 basis points (100.00%) when total volume > 0.
 */
export function calculateBalanceBarBreakdown(
  summary: Pick<
    BalanceSummary,
    "freeAssetsCents" | "boundAssetsCents" | "liabilitiesCents"
  >,
): BalanceBarBreakdown {
  const freeCents = assertNonNegativeInteger(
    summary.freeAssetsCents,
    "freeAssetsCents",
  );
  const boundCents = assertNonNegativeInteger(
    summary.boundAssetsCents,
    "boundAssetsCents",
  );
  const liabilitiesCents = assertNonNegativeInteger(
    summary.liabilitiesCents,
    "liabilitiesCents",
  );

  const totalVolumeCents = freeCents + boundCents + liabilitiesCents;
  if (totalVolumeCents === 0) {
    return {
      totalVolumeCents: 0,
      hasData: false,
      freeCents: 0,
      boundCents: 0,
      liabilitiesCents: 0,
      freeShareBps: 0,
      boundShareBps: 0,
      liabilitiesShareBps: 0,
      segments: [
        { id: "free", amountCents: 0, shareBps: 0 },
        { id: "bound", amountCents: 0, shareBps: 0 },
        { id: "liabilities", amountCents: 0, shareBps: 0 },
      ],
    };
  }

  const totalBig = BigInt(totalVolumeCents);
  const shares: Record<BalanceBarSegmentId, number> = {
    free: Number(roundHalfUpBigInt(BigInt(freeCents) * 10_000n, totalBig)),
    bound: Number(roundHalfUpBigInt(BigInt(boundCents) * 10_000n, totalBig)),
    liabilities: Number(
      roundHalfUpBigInt(BigInt(liabilitiesCents) * 10_000n, totalBig),
    ),
  };

  const amounts: Record<BalanceBarSegmentId, number> = {
    free: freeCents,
    bound: boundCents,
    liabilities: liabilitiesCents,
  };

  const sumBps = shares.free + shares.bound + shares.liabilities;
  const diff = 10_000 - sumBps;
  if (diff !== 0) {
    // Deterministic adjustment on the largest positive segment (tie-breaker: free -> bound -> liabilities)
    let targetId: BalanceBarSegmentId | null = null;
    for (const id of SEGMENT_PRIORITY) {
      if (amounts[id] <= 0) continue;
      if (targetId === null || amounts[id] > amounts[targetId]) {
        targetId = id;
      }
    }
    if (targetId !== null) {
      shares[targetId] += diff;
    }
  }

  return {
    totalVolumeCents,
    hasData: true,
    freeCents,
    boundCents,
    liabilitiesCents,
    freeShareBps: shares.free,
    boundShareBps: shares.bound,
    liabilitiesShareBps: shares.liabilities,
    segments: [
      { id: "free", amountCents: freeCents, shareBps: shares.free },
      { id: "bound", amountCents: boundCents, shareBps: shares.bound },
      {
        id: "liabilities",
        amountCents: liabilitiesCents,
        shareBps: shares.liabilities,
      },
    ],
  };
}
