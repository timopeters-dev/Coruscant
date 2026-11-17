import type { DomainContract } from "./contracts";
import {
  assertNonNegativeInteger,
  assertSafeInteger,
  roundHalfUpBigInt,
} from "./money";

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

export type VariableExpenseBasis = "budget" | "avg_3m" | "avg_6m";

export interface ModeBHouseholdInput {
  balanceCents: number;
  recurringInflowCents: number;
  recurringOutflowCents: number;
  variableBudgetsCents: number;
  variableRollingAvg3MCents: number;
  variableRollingAvg6MCents: number;
}

export interface CalculateModeBCashflowInput {
  household: ModeBHouseholdInput;
  variableBasis: VariableExpenseBasis;
  manualItems: readonly DomainCashflowItem[];
  contractItems?: readonly DomainCashflowItem[];
  includeContractItems?: boolean;
}

export interface ModeBCashflowSummary {
  calibratedInflowCents: number;
  calibratedFixedOutflowCents: number;
  variableOutflowCents: number;
  manualInflowCents: number;
  manualOutflowCents: number;
  contractOutflowCents: number;
  totalInflowCents: number;
  totalOutflowCents: number;
  monthlySurplusCents: number;
  isDeficit: boolean;
  selectedVariableBasis: VariableExpenseBasis;
}

/**
 * Calculates the Mode B (joint household account) monthly cashflow summary
 * using calibrated bank recurring inflows/outflows, the selected variable
 * expense basis, manual plan items, and optionally derived contract outflows.
 */
export function calculateModeBCashflow(
  input: CalculateModeBCashflowInput,
): ModeBCashflowSummary {
  assertSafeInteger(input.household.balanceCents, "household.balanceCents");
  const calibratedInflowCents = assertNonNegativeInteger(
    input.household.recurringInflowCents,
    "household.recurringInflowCents",
  );
  const calibratedFixedOutflowCents = assertNonNegativeInteger(
    input.household.recurringOutflowCents,
    "household.recurringOutflowCents",
  );
  const variableBudgetsCents = assertNonNegativeInteger(
    input.household.variableBudgetsCents,
    "household.variableBudgetsCents",
  );
  const variableRollingAvg3MCents = assertNonNegativeInteger(
    input.household.variableRollingAvg3MCents,
    "household.variableRollingAvg3MCents",
  );
  const variableRollingAvg6MCents = assertNonNegativeInteger(
    input.household.variableRollingAvg6MCents,
    "household.variableRollingAvg6MCents",
  );

  let variableOutflowCents: number;
  switch (input.variableBasis) {
    case "budget":
      variableOutflowCents = variableBudgetsCents;
      break;
    case "avg_3m":
      variableOutflowCents = variableRollingAvg3MCents;
      break;
    case "avg_6m":
      variableOutflowCents = variableRollingAvg6MCents;
      break;
  }

  let manualInflowCents = 0;
  let manualOutflowCents = 0;
  for (const item of input.manualItems) {
    const monthlyCents = normalizeItemToMonthlyCents(
      item.amountCents,
      item.frequency,
    );
    if (!item.active || item.source !== "manual") {
      continue;
    }
    if (item.direction === "inflow") {
      manualInflowCents = assertSafeInteger(
        manualInflowCents + monthlyCents,
        "manualInflowCents",
      );
    } else {
      manualOutflowCents = assertSafeInteger(
        manualOutflowCents + monthlyCents,
        "manualOutflowCents",
      );
    }
  }

  let contractOutflowCents = 0;
  if (input.includeContractItems && input.contractItems) {
    for (const item of input.contractItems) {
      const monthlyCents = normalizeItemToMonthlyCents(
        item.amountCents,
        item.frequency,
      );
      if (!item.active) {
        continue;
      }
      if (item.direction === "outflow") {
        contractOutflowCents = assertSafeInteger(
          contractOutflowCents + monthlyCents,
          "contractOutflowCents",
        );
      }
    }
  }

  const totalInflowCents = assertSafeInteger(
    calibratedInflowCents + manualInflowCents,
    "totalInflowCents",
  );
  const totalOutflowCents = assertSafeInteger(
    calibratedFixedOutflowCents +
      variableOutflowCents +
      manualOutflowCents +
      contractOutflowCents,
    "totalOutflowCents",
  );
  const monthlySurplusCents = assertSafeInteger(
    totalInflowCents - totalOutflowCents,
    "monthlySurplusCents",
  );

  return {
    calibratedInflowCents,
    calibratedFixedOutflowCents,
    variableOutflowCents,
    manualInflowCents,
    manualOutflowCents,
    contractOutflowCents,
    totalInflowCents,
    totalOutflowCents,
    monthlySurplusCents,
    isDeficit: monthlySurplusCents < 0,
    selectedVariableBasis: input.variableBasis,
  };
}
