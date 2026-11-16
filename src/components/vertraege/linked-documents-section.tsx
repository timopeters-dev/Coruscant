import Link from "next/link";
import { ExternalLink, FileText } from "lucide-react";
import type { DocumentRow } from "@/db/queries/documents";
import { formatCentsDE } from "@/lib/domain/money";

interface LinkedDocumentsSectionProps {
  documents: DocumentRow[];
  emptyText: string;
}

export function LinkedDocumentsSection({
  documents,
  emptyText,
}: LinkedDocumentsSectionProps) {
  return (
    <div className="space-y-2.5">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-[var(--text-secondary)]">
          <FileText className="h-3.5 w-3.5" aria-hidden="true" />
          <span>Verknüpfte Belege ({documents.length})</span>
        </div>
        <Link
          href="/dokumente"
          className="text-xs font-medium text-[var(--accent)] hover:underline"
        >
          Zur Inbox →
        </Link>
      </div>

      {documents.length === 0 ? (
        <p className="rounded-xl border border-dashed border-[var(--border-sub)] p-4 text-xs text-[var(--text-secondary)]">
          {emptyText}
        </p>
      ) : (
        <div className="space-y-2">
          {documents.map((doc) => {
            const displayAmount =
              doc.totalAmountCents ?? doc.detectedBalanceCents;
            return (
              <a
                key={doc.id}
                href={`/api/documents/${doc.id}/file`}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center justify-between gap-3 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-3 text-left transition-colors hover:bg-[var(--surface-elevated)]"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-[var(--text-primary)]">
                    {doc.issuer ? `${doc.issuer} – ${doc.filename}` : doc.filename}
                  </p>
                  <p className="tabular-nums text-xs text-[var(--text-secondary)]">
                    {doc.documentDate ?? doc.createdAt.slice(0, 10)}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  {displayAmount != null ? (
                    <span className="tabular-nums text-xs font-semibold text-[var(--text-primary)]">
                      {formatCentsDE(displayAmount)}
                    </span>
                  ) : null}
                  <ExternalLink
                    className="h-3.5 w-3.5 text-[var(--text-secondary)]"
                    aria-hidden="true"
                  />
                </div>
              </a>
            );
          })}
        </div>
      )}
    </div>
  );
}
