import { AllokationWorkspace } from "@/components/allokation/allokation-workspace";
import {
  getAllocationSettings,
  getPendingTransferCentsByPotId,
  listManualCashflowItems,
  listPots,
  listRecentPotAllocations,
} from "@/db/queries/allocation";
import {
  getLatestExternalSnapshot,
  parseSnapshotAccounts,
  parseSnapshotHousehold,
  parseSnapshotPositions,
} from "@/db/queries/cockpit";
import { listContracts, listProperties } from "@/db/queries/contracts";
import { deriveContractCashflowItems } from "@/lib/domain/cashflow";
import { buildPotLinkOptions, computePotSyncPlan } from "@/lib/domain/pot-sync";
import { getFinanzCockpitBridgeConfig } from "@/lib/integrations/finanz-cockpit-client";
import { resolveHouseholdDataForWorkspace } from "@/lib/integrations/household-dummy";

export const dynamic = "force-dynamic";

export default function AllokationPage() {
  const manualItems = listManualCashflowItems();
  const contracts = listContracts();
  const properties = listProperties();
  const pots = listPots();
  const recentAllocations = listRecentPotAllocations(10);
  const pendingTransferCentsByPotId = Object.fromEntries(
    getPendingTransferCentsByPotId(),
  );

  const initialSettings = getAllocationSettings();
  const latestSnapshot = getLatestExternalSnapshot();
  const bridgeConfig = getFinanzCockpitBridgeConfig();
  const snapshotHousehold = parseSnapshotHousehold(latestSnapshot);
  const resolvedHousehold = resolveHouseholdDataForWorkspace(snapshotHousehold);

  const linkOptions = buildPotLinkOptions(
    parseSnapshotAccounts(latestSnapshot),
    parseSnapshotPositions(latestSnapshot),
  );

  // Current link health per pot (pure calculation against the latest snapshot).
  const linkStatusByPotId: Record<
    string,
    { status: "ok" | "missing" | "conflict"; clampedNegative: boolean }
  > = {};
  for (const outcome of computePotSyncPlan({
    pots,
    accounts: parseSnapshotAccounts(latestSnapshot),
    positions: parseSnapshotPositions(latestSnapshot),
  })) {
    linkStatusByPotId[outcome.potId] = {
      status:
        outcome.status === "link_missing"
          ? "missing"
          : outcome.status === "link_conflict"
            ? "conflict"
            : "ok",
      clampedNegative:
        (outcome.status === "updated" || outcome.status === "unchanged") &&
        outcome.clampedNegative,
    };
  }

  const derivedContractItems = deriveContractCashflowItems(contracts);
  const excludedContractsCount = contracts.length - derivedContractItems.length;

  return (
    <AllokationWorkspace
      manualItems={manualItems}
      derivedContractItems={derivedContractItems}
      excludedContractsCount={excludedContractsCount}
      pots={pots}
      linkOptions={linkOptions}
      pendingTransferCentsByPotId={pendingTransferCentsByPotId}
      linkStatusByPotId={linkStatusByPotId}
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
