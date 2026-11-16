import { VertraegeWorkspace } from "@/components/vertraege/vertraege-workspace";
import { listContracts, listProperties } from "@/db/queries/contracts";
import {
  type ContractProjectionResult,
  projectContractBalance,
} from "@/lib/domain/contracts";
import { getTodayIsoDate } from "@/lib/domain/date";
import { summarizeProperties } from "@/lib/domain/properties";

export const dynamic = "force-dynamic";

export default function VertraegePage() {
  const asOfDate = getTodayIsoDate();
  const properties = listProperties();
  const contracts = listContracts();

  const projectionsById: Record<string, ContractProjectionResult> = {};
  for (const contract of contracts) {
    projectionsById[contract.id] = projectContractBalance(contract, asOfDate);
  }

  const propertySummaries = summarizeProperties(
    properties,
    contracts,
    asOfDate,
  );

  return (
    <VertraegeWorkspace
      asOfDate={asOfDate}
      properties={properties}
      contracts={contracts}
      propertySummaries={propertySummaries}
      projectionsById={projectionsById}
    />
  );
}
