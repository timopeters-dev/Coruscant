import { DokumenteWorkspace } from "@/frontend/dokumente/dokumente-workspace";
import { listContracts, listProperties } from "@/backend/db/queries/contracts";
import { listDocuments } from "@/backend/db/queries/documents";
import { getTodayIsoDate } from "@/domain/core/date";

export const dynamic = "force-dynamic";

export default function DokumentePage() {
  const todayIsoDate = getTodayIsoDate();
  const documents = listDocuments();
  const properties = listProperties();
  const contracts = listContracts();

  return (
    <DokumenteWorkspace
      documents={documents}
      properties={properties}
      contracts={contracts}
      todayIsoDate={todayIsoDate}
    />
  );
}
