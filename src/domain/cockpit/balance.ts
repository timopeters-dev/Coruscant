import { type DomainContract, projectContractBalance } from "@/domain/contracts/contract";
import { parseIsoDate } from "@/domain/core/date";
import { assertNonNegativeInteger, roundHalfUpBigInt } from "@/domain/core/money";
import type { DomainPot } from "@/domain/allocation/waterfall";

export interface DomainProperty {
  id: string;
  name: string;
  estimatedValueCents: number;
}

export interface BalancePot extends DomainPot {
  /**
   * Set for pots that must not count towards liquidity: their link overlaps
   * another linked pot (`link_conflict`) or points outside the household
   * (`out_of_scope`).
   */
  liquidityExclusion?: "link_conflict" | "out_of_scope" | null;
}

export interface BalanceInput {
  asOfDate: string;
  properties: readonly DomainProperty[];
  contracts: readonly DomainContract[];
  pots: readonly BalancePot[];
}

export interface BalanceSummary {
  asOfDate: string;
  freeAssetsCents: number;
  conflictingLinkedPotsCents: number;
  outOfScopeLinkedPotsCents: number;
  propertiesValueCents: number;
  savingsContractsValueCents: number;
  boundAssetsCents: number;
  totalAssetsCents: number;
  liabilitiesCents: number;
  netWorthCents: number;
}

/**
 * Calculates the consolidated household balance sheet (Free vs. Bound vs. Liabilities)
 * using projected non-closed contract balances as of asOfDate.
 */
export function calculateHouseholdBalance(input: BalanceInput): BalanceSummary {
  parseIsoDate(input.asOfDate, "asOfDate");

  let freeAssetsCents = 0;
  let conflictingLinkedPotsCents = 0;
  let outOfScopeLinkedPotsCents = 0;
  for (const pot of input.pots) {
    const potCents = assertNonNegativeInteger(
      pot.currentCents,
      `pot(${pot.id}).currentCents`,
    );
    if (pot.liquidityExclusion === "link_conflict") {
      conflictingLinkedPotsCents += potCents;
    } else if (pot.liquidityExclusion === "out_of_scope") {
      outOfScopeLinkedPotsCents += potCents;
    } else {
      freeAssetsCents += potCents;
    }
  }

  let propertiesValueCents = 0;
  for (const prop of input.properties) {
    propertiesValueCents += assertNonNegativeInteger(
      prop.estimatedValueCents,
      `property(${prop.id}).estimatedValueCents`,
    );
  }

  let savingsContractsValueCents = 0;
  let liabilitiesCents = 0;
  for (const contract of input.contracts) {
    if (contract.status === "closed") {
      continue;
    }
    const projection = projectContractBalance(contract, input.asOfDate);
    if (contract.category === "savings_contract") {
      savingsContractsValueCents += projection.projectedBalanceCents;
    } else {
      liabilitiesCents += projection.projectedBalanceCents;
    }
  }

  // Bausparverträge können durch die Abschlussgebühr negativ starten. Negative
  // Salden werden mit anderen Bausparguthaben verrechnet; ein insgesamt
  // negativer Bauspar-Saldo erscheint als Verbindlichkeit (Aktiva bleiben >= 0,
  // das Nettovermögen ist in beiden Fällen gleich).
  if (savingsContractsValueCents < 0) {
    liabilitiesCents += -savingsContractsValueCents;
    savingsContractsValueCents = 0;
  }

  const boundAssetsCents = propertiesValueCents + savingsContractsValueCents;
  const totalAssetsCents = freeAssetsCents + boundAssetsCents;
  const netWorthCents = totalAssetsCents - liabilitiesCents;

  return {
    asOfDate: input.asOfDate,
    freeAssetsCents,
    conflictingLinkedPotsCents,
    outOfScopeLinkedPotsCents,
    propertiesValueCents,
    savingsContractsValueCents,
    boundAssetsCents,
    totalAssetsCents,
    liabilitiesCents,
    netWorthCents,
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
