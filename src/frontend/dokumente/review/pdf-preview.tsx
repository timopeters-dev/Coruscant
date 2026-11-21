"use client";

import { formatDateDE } from "@/domain/core/date-format";
import { ExternalLink, Loader2, Sparkles } from "lucide-react";
import { Button } from "@/frontend/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/frontend/ui/card";
import { type DocumentReviewState } from "./use-document-review";

/** PDF-Vorschau des Belegs (bleibt beim Scrollen sichtbar). */
export function ReviewPdfPreview({ ws }: { ws: DocumentReviewState }) {
  const { aiNotice, doc, handleReanalyze, isAnalyzing, isSubmitting } = ws;
  return (
    <>
      {/* Left: PDF Viewer (bleibt beim Scrollen des Formulars sichtbar) */}
      <Card className="lg:sticky lg:top-20 lg:self-start">
        <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2 pb-3">
          <div className="min-w-0">
            <CardTitle className="truncate text-base">{doc.filename}</CardTitle>
            <p className="tabular-nums text-xs text-[var(--text-secondary)]">
              Hochgeladen am {formatDateDE(doc.createdAt)}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={handleReanalyze}
              disabled={isAnalyzing || isSubmitting}
            >
              {isAnalyzing ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Sparkles className="h-3.5 w-3.5 text-[var(--amber)]" />
              )}
              KI-Analyse erneut starten
            </Button>
            <a
              href={`/api/documents/${doc.id}/file`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 text-xs font-medium text-[var(--text-primary)] transition-colors hover:bg-[var(--surface-elevated)]"
            >
              <ExternalLink className="h-3.5 w-3.5" />
              In neuem Tab öffnen
            </a>
          </div>
        </CardHeader>
        <CardContent>
          {aiNotice ? (
            <div className="mb-3 rounded-lg border border-[var(--amber)]/40 bg-[var(--amber)]/10 px-3 py-2 text-xs text-[var(--amber)]">
              {aiNotice}
            </div>
          ) : null}
          <iframe
            src={`/api/documents/${doc.id}/file`}
            title={doc.filename}
            className="h-[640px] w-full rounded-lg lg:h-[calc(100vh-13rem)] lg:min-h-[480px] border border-[var(--border)] bg-[var(--surface-elevated)]"
          />
        </CardContent>
      </Card>
    </>
  );
}
