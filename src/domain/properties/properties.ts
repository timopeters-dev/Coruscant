import {
  type DomainContract,
  projectContractBalance,
} from "@/domain/contracts/contract";
import { parseIsoDate } from "@/domain/core/date";
import {
  assertNonNegativeInteger,
  assertSafeInteger,
  roundHalfUpBigInt,
} from "@/domain/core/money";

export type PropertyUsage = "owner_occupied" | "rented";

export interface DomainPropertyDetail {
  id: string;
  name: string;
  usage: PropertyUsage;
  purchaseDate?: string | null;
  purchasePriceCents?: number | null;
  estimatedValueCents: number;
}

export type DomainLinkedContract = DomainContract & {
  linkedPropertyId?: string | null;
};

export interface PropertySummary {
  propertyId: string;
  estimatedValueCents: number;
  linkedLoanBalanceCents: number;
  linkedSavingsBalanceCents: number;
  netEquityCents: number;
  ltvBps: number | null;
  linkedContractIds: string[];
}

/**
 * Summarizes properties with their linked non-closed contract projections,
 * net equity (estimatedValue - linkedLoans), and LTV in basis points.
 */
export function summarizeProperties(
  properties: readonly DomainPropertyDetail[],
  contracts: readonly DomainLinkedContract[],
  asOfDate: string,
): Record<string, PropertySummary> {
  parseIsoDate(asOfDate, "asOfDate");

  const summaries: Record<string, PropertySummary> = {};

  for (const property of properties) {
    const estimatedValueCents = assertNonNegativeInteger(
      property.estimatedValueCents,
      "estimatedValueCents",
    );
    if (property.purchasePriceCents != null) {
      assertNonNegativeInteger(
        property.purchasePriceCents,
        "purchasePriceCents",
      );
    }
    if (property.purchaseDate != null) {
      parseIsoDate(property.purchaseDate, "purchaseDate");
    }

    summaries[property.id] = {
      propertyId: property.id,
      estimatedValueCents,
      linkedLoanBalanceCents: 0,
      linkedSavingsBalanceCents: 0,
      netEquityCents: estimatedValueCents,
      ltvBps: estimatedValueCents === 0 ? null : 0,
      linkedContractIds: [],
    };
  }

  for (const contract of contracts) {
    if (contract.status === "closed" || !contract.linkedPropertyId) {
      continue;
    }

    const summary = summaries[contract.linkedPropertyId];
    if (!summary) {
      continue;
    }

    const projection = projectContractBalance(contract, asOfDate);
    summary.linkedContractIds.push(contract.id);

    if (contract.category === "loan") {
      summary.linkedLoanBalanceCents = assertNonNegativeInteger(
        summary.linkedLoanBalanceCents + projection.projectedBalanceCents,
        "linkedLoanBalanceCents",
      );
    } else {
      summary.linkedSavingsBalanceCents = assertNonNegativeInteger(
        summary.linkedSavingsBalanceCents + projection.projectedBalanceCents,
        "linkedSavingsBalanceCents",
      );
    }
  }

  for (const summary of Object.values(summaries)) {
    summary.netEquityCents = assertSafeInteger(
      summary.estimatedValueCents - summary.linkedLoanBalanceCents,
      "netEquityCents",
    );

    if (summary.estimatedValueCents === 0) {
      summary.ltvBps = null;
    } else {
      const ltv = roundHalfUpBigInt(
        BigInt(summary.linkedLoanBalanceCents) * 10_000n,
        BigInt(summary.estimatedValueCents),
      );
      summary.ltvBps = assertNonNegativeInteger(Number(ltv), "ltvBps");
    }
  }

  return summaries;
}
