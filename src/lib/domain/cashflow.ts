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

export interface HouseholdCashflowInput {
  balanceCents: number;
  recurringInflowCents: number;
  recurringOutflowCents: number;
  variableBudgetsCents: number;
  variableRollingAvg3MCents: number;
  variableRollingAvg6MCents: number;
}

export interface CalculateConsolidatedCashflowInput {
  household: HouseholdCashflowInput | null;
  variableBasis: VariableExpenseBasis;
  manualItems: readonly DomainCashflowItem[];
  contractItems?: readonly DomainCashflowItem[];
  includeContractItems?: boolean;
}

export interface ConsolidatedCashflowSummary {
  hasHouseholdData: boolean;
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
 * Calculates the consolidated 3-account household monthly cashflow summary
 * combining calibrated joint-account figures (if available), optional manual
 * plan items, and optionally derived household contract outflows.
 */
export function calculateConsolidatedCashflow(
  input: CalculateConsolidatedCashflowInput,
): ConsolidatedCashflowSummary {
  let hasHouseholdData = false;
  let calibratedInflowCents = 0;
  let calibratedFixedOutflowCents = 0;
  let variableOutflowCents = 0;

  if (input.household !== null) {
    hasHouseholdData = true;
    assertSafeInteger(input.household.balanceCents, "household.balanceCents");
    calibratedInflowCents = assertNonNegativeInteger(
      input.household.recurringInflowCents,
      "household.recurringInflowCents",
    );
    calibratedFixedOutflowCents = assertNonNegativeInteger(
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
  if (input.contractItems) {
    for (const item of input.contractItems) {
      const monthlyCents = normalizeItemToMonthlyCents(
        item.amountCents,
        item.frequency,
      );
      if (!input.includeContractItems || !item.active) {
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
    hasHouseholdData,
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
