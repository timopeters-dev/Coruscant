import { type DomainContract, projectContractBalance } from "./contracts";
import { parseIsoDate } from "./date";
import { assertNonNegativeInteger, assertSafeInteger } from "./money";
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

export interface BalanceInput {
  asOfDate: string;
  properties: readonly DomainProperty[];
  contracts: readonly DomainContract[];
  pots: readonly DomainPot[];
  externalSnapshot?: DomainExternalSnapshot | null;
}

export interface BalanceSummary {
  asOfDate: string;
  householdLiquidCents: number;
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
  for (const pot of input.pots) {
    householdLiquidCents += assertNonNegativeInteger(
      pot.currentCents,
      `pot(${pot.id}).currentCents`,
    );
  }

  let personalExternalAssetsCents = 0;
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
    assertSafeInteger(
      input.externalSnapshot.totalPersonalNetWorthCents,
      "externalSnapshot.totalPersonalNetWorthCents",
    );
    personalExternalAssetsCents = cash + etf + crypto;
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
  let personalLiabilitiesCents = 0;

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
