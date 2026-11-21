import type { DomainContract } from "@/domain/contracts/contract";
import {
  assertNonNegativeInteger,
  assertSafeInteger,
  roundHalfUpBigInt,
} from "@/domain/core/money";
import type {
  DomainLinkedContract,
  DomainPropertyDetail,
} from "@/domain/properties/properties";
import type { DomainRentalProfile } from "@/domain/properties/rental";

export type CashflowDirection = "inflow" | "outflow";
export type CashflowFrequency = "monthly" | "quarterly" | "yearly";
export type CashflowSource =
  | "manual"
  | "finanz_cockpit_sync"
  | "contract_linked"
  | "property_linked";

export interface DomainCashflowItem {
  id: string;
  name: string;
  direction: CashflowDirection;
  amountCents: number;
  frequency: CashflowFrequency;
  source: CashflowSource;
  linkedContractId?: string | null;
  linkedPropertyId?: string | null;
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

    if (contract.status === "active" && rate > 0) {
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

/**
 * Derives monthly inflow/outflow cashflow items from rented properties
 * (cold rent, non-recoverable costs, and active household rates of linked
 * contracts with deterministic `contract:<id>` IDs so `calculateConsolidatedCashflow`
 * never double-counts them when `includeContractItems` is enabled).
 */
export function derivePropertyCashflowItems(
  properties: readonly (DomainPropertyDetail & DomainRentalProfile)[],
  contracts: readonly DomainLinkedContract[] = [],
): DomainCashflowItem[] {
  const derived: DomainCashflowItem[] = [];

  for (const property of properties) {
    if (property.usage !== "rented") {
      continue;
    }

    const coldRentCents = assertNonNegativeInteger(
      property.monthlyColdRentCents ?? 0,
      "monthlyColdRentCents",
    );
    if (coldRentCents > 0) {
      derived.push({
        id: `property:${property.id}:rent`,
        name: `${property.name} · Kaltmiete`,
        direction: "inflow",
        amountCents: coldRentCents,
        frequency: "monthly",
        source: "property_linked",
        linkedPropertyId: property.id,
        active: true,
      });
    }

    const nonRecoverableCents = assertNonNegativeInteger(
      property.monthlyNonRecoverableCostsCents ?? 0,
      "monthlyNonRecoverableCostsCents",
    );
    if (nonRecoverableCents > 0) {
      derived.push({
        id: `property:${property.id}:costs`,
        name: `${property.name} · nicht umlagefähig`,
        direction: "outflow",
        amountCents: nonRecoverableCents,
        frequency: "monthly",
        source: "property_linked",
        linkedPropertyId: property.id,
        active: true,
      });
    }

    for (const contract of contracts) {
      if (contract.linkedPropertyId !== property.id) {
        continue;
      }
      const rate = assertNonNegativeInteger(
        contract.monthlyRateCents,
        "monthlyRateCents",
      );
      if (contract.status === "active" && rate > 0) {
        derived.push({
          id: `contract:${contract.id}`,
          name: contract.name,
          direction: "outflow",
          amountCents: rate,
          frequency: "monthly",
          source: "property_linked",
          linkedContractId: contract.id,
          linkedPropertyId: property.id,
          active: true,
        });
      }
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
  propertyItems?: readonly DomainCashflowItem[];
  includePropertyItems?: boolean;
}

export interface ConsolidatedCashflowSummary {
  hasHouseholdData: boolean;
  calibratedInflowCents: number;
  calibratedFixedOutflowCents: number;
  variableOutflowCents: number;
  manualInflowCents: number;
  manualOutflowCents: number;
  contractOutflowCents: number;
  propertyInflowCents: number;
  propertyOutflowCents: number;
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

  const seenIds = new Set<string>();

  let manualInflowCents = 0;
  let manualOutflowCents = 0;
  for (const item of input.manualItems) {
    const monthlyCents = normalizeItemToMonthlyCents(
      item.amountCents,
      item.frequency,
    );
    if (!item.active || item.source !== "manual" || seenIds.has(item.id)) {
      continue;
    }
    seenIds.add(item.id);
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
      if (
        !input.includeContractItems ||
        !item.active ||
        item.source !== "contract_linked" ||
        seenIds.has(item.id)
      ) {
        continue;
      }
      seenIds.add(item.id);
      if (item.direction === "outflow") {
        contractOutflowCents = assertSafeInteger(
          contractOutflowCents + monthlyCents,
          "contractOutflowCents",
        );
      }
    }
  }

  let propertyInflowCents = 0;
  let propertyOutflowCents = 0;
  if (input.propertyItems) {
    for (const item of input.propertyItems) {
      const monthlyCents = normalizeItemToMonthlyCents(
        item.amountCents,
        item.frequency,
      );
      if (
        !input.includePropertyItems ||
        !item.active ||
        item.source !== "property_linked" ||
        seenIds.has(item.id)
      ) {
        continue;
      }
      seenIds.add(item.id);
      if (item.direction === "inflow") {
        propertyInflowCents = assertSafeInteger(
          propertyInflowCents + monthlyCents,
          "propertyInflowCents",
        );
      } else {
        propertyOutflowCents = assertSafeInteger(
          propertyOutflowCents + monthlyCents,
          "propertyOutflowCents",
        );
      }
    }
  }

  const totalInflowCents = assertSafeInteger(
    calibratedInflowCents + manualInflowCents + propertyInflowCents,
    "totalInflowCents",
  );
  const totalOutflowCents = assertSafeInteger(
    calibratedFixedOutflowCents +
      variableOutflowCents +
      manualOutflowCents +
      contractOutflowCents +
      propertyOutflowCents,
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
    propertyInflowCents,
    propertyOutflowCents,
    totalInflowCents,
    totalOutflowCents,
    monthlySurplusCents,
    isDeficit: monthlySurplusCents < 0,
    selectedVariableBasis: input.variableBasis,
  };
}
