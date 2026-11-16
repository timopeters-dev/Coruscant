import type { DomainContract } from "./contracts";
import { assertNonNegativeInteger, roundHalfUpBigInt } from "./money";

export type CashflowDirection = "inflow" | "outflow";
export type CashflowFrequency = "monthly" | "quarterly" | "yearly";
export type CashflowSource =
  | "manual"
  | "finanz_cockpit_sync"
  | "contract_linked";

export interface DomainCashflowItem {
  id: string;
  name: string;
  direction: CashflowDirection;
  amountCents: number;
  frequency: CashflowFrequency;
  source: CashflowSource;
  linkedContractId?: string | null;
  active: boolean;
}

export interface NormalizedCashflowItem extends DomainCashflowItem {
  monthlyAmountCents: number;
}

export interface CashflowSourceTotals {
  inflowCents: number;
  outflowCents: number;
  netCents: number;
}

export interface MonthlyCashflowSummary {
  totalInflowCents: number;
  totalOutflowCents: number;
  monthlySurplusCents: number;
  isDeficit: boolean;
  bySource: Record<CashflowSource, CashflowSourceTotals>;
  normalizedItems: NormalizedCashflowItem[];
}

/**
 * Normalizes a recurring cashflow amount to monthly integer cents using half-up division.
 */
export function normalizeItemToMonthlyCents(
  amountCents: number,
  frequency: CashflowFrequency,
): number {
  const safeAmount = assertNonNegativeInteger(amountCents, "amountCents");

  switch (frequency) {
    case "monthly":
      return safeAmount;
    case "quarterly":
      return Number(roundHalfUpBigInt(BigInt(safeAmount), 3n));
    case "yearly":
      return Number(roundHalfUpBigInt(BigInt(safeAmount), 12n));
  }
}

/**
 * Calculates normalized monthly inflows, outflows, and net surplus (Mode A).
 * Validates all items including inactive ones so invalid amounts are caught early.
 */
export function calculateMonthlyCashflow(
  items: readonly DomainCashflowItem[],
): MonthlyCashflowSummary {
  const bySource: Record<CashflowSource, CashflowSourceTotals> = {
    manual: { inflowCents: 0, outflowCents: 0, netCents: 0 },
    finanz_cockpit_sync: { inflowCents: 0, outflowCents: 0, netCents: 0 },
    contract_linked: { inflowCents: 0, outflowCents: 0, netCents: 0 },
  };

  let totalInflowCents = 0;
  let totalOutflowCents = 0;
  const normalizedItems: NormalizedCashflowItem[] = [];

  for (const item of items) {
    const monthlyAmountCents = normalizeItemToMonthlyCents(
      item.amountCents,
      item.frequency,
    );

    if (!item.active) {
      continue;
    }

    normalizedItems.push({
      ...item,
      monthlyAmountCents,
    });

    const sourceBucket = bySource[item.source];
    if (item.direction === "inflow") {
      totalInflowCents += monthlyAmountCents;
      sourceBucket.inflowCents += monthlyAmountCents;
      sourceBucket.netCents += monthlyAmountCents;
    } else {
      totalOutflowCents += monthlyAmountCents;
      sourceBucket.outflowCents += monthlyAmountCents;
      sourceBucket.netCents -= monthlyAmountCents;
    }
  }

  const monthlySurplusCents = totalInflowCents - totalOutflowCents;

  return {
    totalInflowCents,
    totalOutflowCents,
    monthlySurplusCents,
    isDeficit: monthlySurplusCents < 0,
    bySource,
    normalizedItems,
  };
}

/**
 * Derives monthly outflow cashflow items from active contracts with positive monthly rates.
 */
export function deriveContractCashflowItems(
  contracts: readonly DomainContract[],
): DomainCashflowItem[] {
  const derived: DomainCashflowItem[] = [];

  for (const contract of contracts) {
    const rate = assertNonNegativeInteger(
      contract.monthlyRateCents,
      "monthlyRateCents",
    );

    if (
      contract.status === "active" &&
      contract.sphere === "household" &&
      rate > 0
    ) {
      derived.push({
        id: `contract:${contract.id}`,
        name: contract.name,
        direction: "outflow",
        amountCents: rate,
        frequency: "monthly",
        source: "contract_linked",
        linkedContractId: contract.id,
        active: true,
      });
    }
  }

  return derived;
}
