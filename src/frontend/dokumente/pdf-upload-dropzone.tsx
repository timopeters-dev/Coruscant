"use client";

import * as React from "react";
import { AlertCircle, CheckCircle2, FileUp, Loader2 } from "lucide-react";
import { Button } from "@/frontend/ui/button";
import type { DocumentRow } from "@/backend/db/queries/documents";

const MAX_FILE_BYTES = 20 * 1024 * 1024;

interface AiUploadStatus {
  status: "extracted" | "skipped" | "failed";
  message?: string;
  model?: string;
}

interface PdfUploadDropzoneProps {
  onUploaded: (document: DocumentRow, ai: AiUploadStatus) => void;
}

export function PdfUploadDropzone({ onUploaded }: PdfUploadDropzoneProps) {
  const inputRef = React.useRef<HTMLInputElement | null>(null);
  const [isDragging, setIsDragging] = React.useState(false);
  const [isUploading, setIsUploading] = React.useState(false);
  const [errorMessage, setErrorMessage] = React.useState<string | null>(null);
  const [infoMessage, setInfoMessage] = React.useState<string | null>(null);
  const [successMessage, setSuccessMessage] = React.useState<string | null>(
    null,
  );

  async function uploadFile(file: File) {
    setErrorMessage(null);
    setInfoMessage(null);
    setSuccessMessage(null);

    if (file.size === 0) {
      setErrorMessage("Die ausgewählte Datei ist leer.");
      return;
    }
    if (file.size > MAX_FILE_BYTES) {
      setErrorMessage("Die PDF-Datei überschreitet das Limit von 20 MB.");
      return;
    }

    setIsUploading(true);
    try {
      const formData = new FormData();
      formData.append("file", file);

      const response = await fetch("/api/documents", {
        method: "POST",
        body: formData,
      });

      const body = (await response.json()) as {
        error?: string;
        existingDocument?: DocumentRow;
        document?: DocumentRow;
        ai?: AiUploadStatus;
      };

      if (response.status === 409 && body.existingDocument) {
        const statusLabel =
          body.existingDocument.status === "verified"
            ? "Verifiziert"
            : "Zu prüfen";
        setErrorMessage(
          `Duplikat erkannt: „${body.existingDocument.filename}“ liegt bereits vor (Status: ${statusLabel}).`,
        );
        return;
      }

      if (!response.ok || !body.document || !body.ai) {
        setErrorMessage(body.error ?? "Upload fehlgeschlagen.");
        return;
      }

      if (body.ai.status === "extracted") {
        setSuccessMessage(
          `„${body.document.filename}“ hochgeladen und per KI (${body.ai.model ?? "Gemini"}) voranalysiert.`,
        );
      } else {
        setInfoMessage(
          "Beleg gespeichert, KI nicht verfügbar – Werte bitte manuell prüfen.",
        );
      }

      onUploaded(body.document, body.ai);
    } catch {
      setErrorMessage("Netzwerkfehler beim Hochladen des Belegs.");
    } finally {
      setIsUploading(false);
      if (inputRef.current) {
        inputRef.current.value = "";
      }
    }
  }

  function handleFileList(files: FileList | null) {
    const file = files?.[0];
    if (!file) return;
    void uploadFile(file);
  }

  return (
    <div className="space-y-3">
      <div
        onDragOver={(e) => {
          e.preventDefault();
          if (!isUploading) setIsDragging(true);
        }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setIsDragging(false);
          if (!isUploading) {
            handleFileList(e.dataTransfer.files);
          }
        }}
        className={`flex flex-col items-center justify-between gap-4 rounded-xl border border-dashed p-5 transition-colors sm:flex-row ${
          isDragging
            ? "border-[var(--accent)] bg-[var(--accent)]/5"
            : "border-[var(--border-sub)] bg-[var(--surface)]"
        }`}
      >
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-[var(--border)] bg-[var(--surface-elevated)] text-[var(--accent)]">
            {isUploading ? (
              <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" />
            ) : (
              <FileUp className="h-5 w-5" aria-hidden="true" />
            )}
          </div>
          <div>
            <p className="text-sm font-medium text-[var(--text-primary)]">
              PDF-Beleg hierher ziehen oder auswählen
            </p>
            <p className="text-xs text-[var(--text-secondary)]">
              Max. 20 MB · Lokaler Speicher + SHA-256-Duplikatprüfung · KI-Vorschlag
              ohne automatische Buchung
            </p>
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          <input
            ref={inputRef}
            type="file"
            accept="application/pdf,.pdf"
            className="hidden"
            onChange={(e) => handleFileList(e.target.files)}
            disabled={isUploading}
          />
          <Button
            type="button"
            variant="default"
            size="sm"
            onClick={() => inputRef.current?.click()}
            disabled={isUploading}
          >
            {isUploading ? "Lädt hoch..." : "PDF auswählen"}
          </Button>
        </div>
      </div>

      {errorMessage ? (
        <div className="flex items-start gap-2 rounded-lg border border-[var(--rose)]/40 bg-[var(--rose)]/10 px-3 py-2 text-xs text-[var(--rose)]">
          <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>{errorMessage}</span>
        </div>
      ) : null}

      {infoMessage ? (
        <div className="flex items-start gap-2 rounded-lg border border-[var(--amber)]/40 bg-[var(--amber)]/10 px-3 py-2 text-xs text-[var(--amber)]">
          <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>{infoMessage}</span>
        </div>
      ) : null}

      {successMessage ? (
        <div className="flex items-start gap-2 rounded-lg border border-[var(--emerald)]/40 bg-[var(--emerald)]/10 px-3 py-2 text-xs text-[var(--emerald)]">
          <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>{successMessage}</span>
        </div>
      ) : null}
    </div>
  );
}
