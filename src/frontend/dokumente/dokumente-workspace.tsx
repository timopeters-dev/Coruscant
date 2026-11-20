"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Badge } from "@/frontend/ui/badge";
import type { FinancialContractRow } from "@/backend/db/queries/contracts";
import type { PropertyRow } from "@/backend/db/queries/properties";
import type { DocumentRow } from "@/backend/db/queries/documents";
import { DokumenteViewSwitch } from "./dokumente-view-switch";
import { DocumentArchive } from "./document-archive";
import { DocumentReviewPanel } from "./document-review-panel";
import { PdfUploadDropzone } from "./pdf-upload-dropzone";

interface DokumenteWorkspaceProps {
  documents: DocumentRow[];
  properties: PropertyRow[];
  contracts: FinancialContractRow[];
  todayIsoDate: string;
}

export function DokumenteWorkspace({
  documents,
  properties,
  contracts,
  todayIsoDate,
}: DokumenteWorkspaceProps) {
  const router = useRouter();
  const [selectedDocId, setSelectedDocId] = React.useState<string | null>(null);

  const pendingDocuments = React.useMemo(
    () => documents.filter((d) => d.status === "pending_review"),
    [documents],
  );
  const verifiedDocuments = React.useMemo(
    () => documents.filter((d) => d.status === "verified"),
    [documents],
  );

  return (
    <div className="space-y-8">
      <DokumenteViewSwitch active="inbox" />
      <div className="space-y-1">
        <h1 className="page-title">
          KI-Dokumenten-Inbox
        </h1>
        <p className="text-sm text-[var(--text-secondary)]">
          PDF-Upload, KI-gestützte Extraktion mit 1-Klick-Freigabe,
          Steuer-Tagging und Vertrags-Eichung.
        </p>
      </div>

      <PdfUploadDropzone
        onUploaded={(doc) => {
          setSelectedDocId(doc.id);
          router.refresh();
        }}
      />

      <section className="space-y-3">
        <div className="flex items-center gap-2">
          <h2 className="text-lg font-semibold text-[var(--text-primary)]">
            Zu prüfen
          </h2>
          <Badge className="tabular-nums">{pendingDocuments.length}</Badge>
        </div>

        <DocumentReviewPanel
          pendingDocuments={pendingDocuments}
          selectedDocId={selectedDocId}
          onSelectDoc={setSelectedDocId}
          properties={properties}
          contracts={contracts}
          todayIsoDate={todayIsoDate}
          onMutated={() => router.refresh()}
        />
      </section>

      <section className="space-y-3">
        <div className="flex items-center gap-2">
          <h2 className="text-lg font-semibold text-[var(--text-primary)]">
            Archiv &amp; Steuer-Übersicht
          </h2>
          <Badge variant="outline" className="tabular-nums">
            {verifiedDocuments.length}
          </Badge>
        </div>

        <DocumentArchive
          verifiedDocuments={verifiedDocuments}
          properties={properties}
          contracts={contracts}
          onMutated={() => router.refresh()}
        />
      </section>
    </div>
  );
}
