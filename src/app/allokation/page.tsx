import { AllokationWorkspace } from "@/components/allokation/allokation-workspace";
import {
  getAllocationSettings,
  listManualCashflowItems,
  listPots,
  listRecentPotAllocations,
} from "@/db/queries/allocation";
import {
  getLatestExternalSnapshot,
  parseSnapshotHousehold,
} from "@/db/queries/cockpit";
import { listContracts, listProperties } from "@/db/queries/contracts";
import {
  calculateMonthlyCashflow,
  deriveContractCashflowItems,
} from "@/lib/domain/cashflow";
import { getFinanzCockpitBridgeConfig } from "@/lib/integrations/finanz-cockpit-client";
import { resolveHouseholdDataForWorkspace } from "@/lib/integrations/household-dummy";

export const dynamic = "force-dynamic";

export default function AllokationPage() {
  const manualItems = listManualCashflowItems();
  const contracts = listContracts();
  const properties = listProperties();
  const pots = listPots();
  const recentAllocations = listRecentPotAllocations(10);

  const initialSettings = getAllocationSettings();
  const latestSnapshot = getLatestExternalSnapshot();
  const bridgeConfig = getFinanzCockpitBridgeConfig();
  const snapshotHousehold = parseSnapshotHousehold(latestSnapshot);
  const resolvedHousehold = resolveHouseholdDataForWorkspace(snapshotHousehold);

  const derivedContractItems = deriveContractCashflowItems(contracts);
  const summary = calculateMonthlyCashflow([
    ...manualItems,
    ...derivedContractItems,
  ]);
  const excludedContractsCount = contracts.length - derivedContractItems.length;

  return (
    <AllokationWorkspace
      manualItems={manualItems}
      derivedContractItems={derivedContractItems}
      summary={summary}
      excludedContractsCount={excludedContractsCount}
      pots={pots}
      recentAllocations={recentAllocations}
      properties={properties}
      contracts={contracts}
      initialSettings={initialSettings}
      householdData={{
        household: resolvedHousehold.household,
        isDummy: resolvedHousehold.isDummy,
        sourceStatus: resolvedHousehold.sourceStatus,
        fetchedAt: latestSnapshot?.fetchedAt ?? null,
        bridgeConfigured: bridgeConfig.configured,
      }}
    />
  );
}
