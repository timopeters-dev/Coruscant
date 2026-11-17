import {
  getAllocationSettings,
  getPendingTransferCentsByPotId,
  listManualCashflowItems,
  listPots,
  type PotRow,
} from "@/db/queries/allocation";
import {
  getLatestExternalSnapshot,
  parseSnapshotHousehold,
} from "@/db/queries/cockpit";
import { listContracts, type FinancialContractRow } from "@/db/queries/contracts";
import {
  calculateConsolidatedCashflow,
  deriveContractCashflowItems,
  type ConsolidatedCashflowSummary,
} from "@/lib/domain/cashflow";
import { applyPendingTransfers } from "@/lib/domain/pot-sync";
import { resolveHouseholdDataForWorkspace } from "@/lib/integrations/household-dummy";

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
