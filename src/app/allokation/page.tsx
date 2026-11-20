import { AllokationWorkspace } from "@/frontend/allokation/allokation-workspace";
import { parseAllocationPrefill } from "@/frontend/allokation/allocation-prefill";
import {
  getAllocationSettings,
  getPendingTransferCentsByPotId,
  listManualCashflowItems,
  listPots,
  listRecentPotAllocations,
} from "@/backend/db/queries/allocation";
import {
  getLatestExternalSnapshot,
  parseSnapshotAccounts,
  parseSnapshotHousehold,
  parseSnapshotPositions,
} from "@/backend/db/queries/cockpit";
import { listContracts, listProperties } from "@/backend/db/queries/contracts";
import {
  deriveContractCashflowItems,
  derivePropertyCashflowItems,
} from "@/domain/allocation/cashflow";
import { buildPotLinkOptions, computePotSyncPlan } from "@/domain/allocation/pot-sync";
import { getFinanzCockpitBridgeConfig } from "@/backend/integrations/finanz-cockpit-client";
import { resolveHouseholdDataForWorkspace } from "@/backend/integrations/household-dummy";

export const dynamic = "force-dynamic";

interface AllokationPageProps {
  searchParams?: Promise<{
    verteilen?: string | string[];
    posten?: string | string[];
  }>;
}

export default async function AllokationPage({
  searchParams,
}: AllokationPageProps) {
  const resolved = searchParams ? await searchParams : {};
  const manualItems = listManualCashflowItems();
  const contracts = listContracts();
  const properties = listProperties();
  const pots = listPots();
  const initialPrefill = parseAllocationPrefill(resolved, pots);
  const prefillInvalid =
    resolved.verteilen !== undefined && initialPrefill === null;
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
    { status: "ok" | "missing" | "conflict" | "out_of_scope"; clampedNegative: boolean }
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
            : outcome.status === "link_out_of_scope"
              ? "out_of_scope"
              : "ok",
      clampedNegative:
        (outcome.status === "updated" || outcome.status === "unchanged") &&
        outcome.clampedNegative,
    };
  }

  const derivedContractItems = deriveContractCashflowItems(contracts);
  const derivedPropertyItems = derivePropertyCashflowItems(
    properties,
    contracts,
  );
  const excludedContractsCount = contracts.length - derivedContractItems.length;

  return (
    <AllokationWorkspace
      manualItems={manualItems}
      derivedContractItems={derivedContractItems}
      derivedPropertyItems={derivedPropertyItems}
      excludedContractsCount={excludedContractsCount}
      pots={pots}
      linkOptions={linkOptions}
      pendingTransferCentsByPotId={pendingTransferCentsByPotId}
      linkStatusByPotId={linkStatusByPotId}
      recentAllocations={recentAllocations}
      properties={properties}
      contracts={contracts}
      initialSettings={initialSettings}
      initialPrefill={initialPrefill}
      prefillInvalid={prefillInvalid}
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
