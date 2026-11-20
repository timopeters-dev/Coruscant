import {
  getAllocationSettings,
  getPendingTransferCentsByPotId,
  listManualCashflowItems,
  listPots,
  type PotRow,
} from "./allocation";
import {
  getLatestExternalSnapshot,
  parseSnapshotHousehold,
} from "./cockpit";
import {
  listContracts,
  listProperties,
  type FinancialContractRow,
} from "./contracts";
import {
  calculateConsolidatedCashflow,
  deriveContractCashflowItems,
  derivePropertyCashflowItems,
  type ConsolidatedCashflowSummary,
} from "@/domain/allocation/cashflow";
import { applyPendingTransfers } from "@/domain/allocation/pot-sync";
import { resolveHouseholdDataForWorkspace } from "@/backend/integrations/household-dummy";

export interface PlanningBase {
  contracts: FinancialContractRow[];
  consolidated: ConsolidatedCashflowSummary;
  isDummy: boolean;
  /** Same basis as /allokation: stand + open transfers. */
  pots: PotRow[];
}

/** Gemeinsame, rein lesende Lade-Logik für /planung und den Investment-Coach. */
export function loadPlanningBase(): PlanningBase {
  const contracts = listContracts();
  const properties = listProperties();
  const settings = getAllocationSettings();
  const resolvedHousehold = resolveHouseholdDataForWorkspace(
    parseSnapshotHousehold(getLatestExternalSnapshot()),
  );
  const consolidated = calculateConsolidatedCashflow({
    household: resolvedHousehold.household,
    variableBasis: settings.variableBasis,
    manualItems: listManualCashflowItems(),
    contractItems: deriveContractCashflowItems(contracts),
    includeContractItems: settings.includeContractItems,
    propertyItems: derivePropertyCashflowItems(properties, contracts),
    includePropertyItems: settings.includePropertyItems,
  });
  const pots = applyPendingTransfers(
    listPots(),
    getPendingTransferCentsByPotId(),
  );

  return {
    contracts,
    consolidated,
    isDummy: resolvedHousehold.isDummy,
    pots,
  };
}
