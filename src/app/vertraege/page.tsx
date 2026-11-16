import { VertraegeWorkspace } from "@/components/vertraege/vertraege-workspace";
import { listContracts, listProperties } from "@/db/queries/contracts";
import { type DocumentRow, listDocuments } from "@/db/queries/documents";
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
  const verifiedDocuments = listDocuments({ status: "verified" });

  const projectionsById: Record<string, ContractProjectionResult> = {};
  for (const contract of contracts) {
    projectionsById[contract.id] = projectContractBalance(contract, asOfDate);
  }

  const documentsByContractId: Record<string, DocumentRow[]> = {};
  const documentsByPropertyId: Record<string, DocumentRow[]> = {};
  for (const doc of verifiedDocuments) {
    if (doc.linkedContractId) {
      const list = (documentsByContractId[doc.linkedContractId] ??= []);
      list.push(doc);
    }
    if (doc.linkedPropertyId) {
      const list = (documentsByPropertyId[doc.linkedPropertyId] ??= []);
      list.push(doc);
    }
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
      documentsByContractId={documentsByContractId}
      documentsByPropertyId={documentsByPropertyId}
    />
  );
}
