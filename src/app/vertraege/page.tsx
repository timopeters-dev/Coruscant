import { VertraegeWorkspace } from "@/frontend/vertraege/vertraege-workspace";
import { listPots } from "@/backend/db/queries/pots";
import { listContracts } from "@/backend/db/queries/contracts";
import { listProperties } from "@/backend/db/queries/properties";
import { type DocumentRow, listDocuments } from "@/backend/db/queries/documents";
import {
  type ContractProjectionResult,
  projectContractBalance,
} from "@/domain/contracts/contract";
import { buildContractOverview } from "@/domain/contracts/overview";
import type { ContractOverview } from "@/domain/contracts/amortization-types";
import { getTodayIsoDate } from "@/domain/core/date";
import { summarizeProperties } from "@/domain/properties/properties";
import { summarizeRentalPortfolio } from "@/domain/properties/rental";
import { isDevMode } from "@/backend/dev-mode";
import { parsePurchaseDraft } from "@/validation/property-draft";

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
