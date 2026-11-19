import { VertraegeWorkspace } from "@/components/vertraege/vertraege-workspace";
import { listPots } from "@/db/queries/allocation";
import { listContracts, listProperties } from "@/db/queries/contracts";
import { type DocumentRow, listDocuments } from "@/db/queries/documents";
import {
  type ContractProjectionResult,
  projectContractBalance,
} from "@/lib/domain/contracts";
import {
  buildContractOverview,
  type ContractOverview,
} from "@/lib/domain/contract-series";
import { getTodayIsoDate } from "@/lib/domain/date";
import { summarizeProperties } from "@/lib/domain/properties";
import { summarizeRentalPortfolio } from "@/lib/domain/rental";
import { isDevMode } from "@/lib/server/dev-mode";
import { parsePurchaseDraft } from "@/lib/validation/property-draft";

export const dynamic = "force-dynamic";

interface VertraegePageProps {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}

export default async function VertraegePage({
  searchParams,
}: VertraegePageProps) {
  const resolvedSearchParams = (await searchParams) ?? {};
  const rawTab = resolvedSearchParams.tab;
  const tabValue = Array.isArray(rawTab) ? rawTab[0] : rawTab;
  const initialTab = tabValue === "portfolio" ? "portfolio" : "uebersicht";
  const { draft: initialDraft, reason: draftErrorReason } =
    parsePurchaseDraft(resolvedSearchParams);

  const asOfDate = getTodayIsoDate();
  const properties = listProperties();
  const contracts = listContracts();
  const verifiedDocuments = listDocuments({ status: "verified" });
  const pots = listPots().map((p) => ({
    id: p.id,
    name: p.name,
    currentCents: p.currentCents,
    targetCents: p.targetCents,
  }));

  const projectionsById: Record<string, ContractProjectionResult> = {};
  const contractOverviewById: Record<string, ContractOverview> = {};
  for (const contract of contracts) {
    projectionsById[contract.id] = projectContractBalance(contract, asOfDate);
    if (contract.status !== "closed") {
      contractOverviewById[contract.id] = buildContractOverview(
        contract,
        asOfDate,
      );
    }
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
  const rentalPortfolio = summarizeRentalPortfolio(
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
      rentalPortfolio={rentalPortfolio}
      pots={pots}
      projectionsById={projectionsById}
      contractOverviewById={contractOverviewById}
      showDebug={isDevMode()}
      documentsByContractId={documentsByContractId}
      documentsByPropertyId={documentsByPropertyId}
      initialTab={initialTab}
      initialDraft={initialDraft}
      draftErrorReason={draftErrorReason}
    />
  );
}
