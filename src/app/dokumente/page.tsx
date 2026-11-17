import { DokumenteWorkspace } from "@/components/dokumente/dokumente-workspace";
import { listContracts, listProperties } from "@/db/queries/contracts";
import { listDocuments } from "@/db/queries/documents";
import { getTodayIsoDate } from "@/lib/domain/date";

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
