import { AllokationWorkspace } from "@/components/allokation/allokation-workspace";
import {
  listManualCashflowItems,
  listPots,
  listRecentPotAllocations,
} from "@/db/queries/allocation";
import { listContracts, listProperties } from "@/db/queries/contracts";
import {
  calculateMonthlyCashflow,
  deriveContractCashflowItems,
} from "@/lib/domain/cashflow";

export const dynamic = "force-dynamic";

export default function AllokationPage() {
  const manualItems = listManualCashflowItems();
  const contracts = listContracts();
  const properties = listProperties();
  const pots = listPots();
  const recentAllocations = listRecentPotAllocations(10);

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
    />
  );
}
