import {
  applyAiExtractionIfPending,
  createDocumentRecord,
  DocumentAlreadyVerifiedError,
  DocumentNotFoundError,
  DuplicateDocumentError,
  getDocumentById,
  getDocumentBySha256,
  type DocumentRow,
} from "@/backend/db/queries/documents";
import { createDefaultDocumentExtractor } from "@/backend/integrations/gemini-document-extractor";
import {
  computeSha256Hex,
  deletePdfFileIfExists,
  readPdfFileOrNotFound,
  sanitizeOriginalFilename,
  savePdfFile,
  validatePdfBuffer,
} from "@/backend/storage/pdf-storage";
import { getTodayIsoDate } from "@/domain/core/date";
import type { AiDocumentExtraction } from "@/validation/documents";

export type AiStatus =
  | { status: "extracted"; model: string }
  | { status: "skipped" | "failed"; message: string };

export interface IntakeResult {
  document: DocumentRow;
  ai: AiStatus;
}

/** KI-Extraktion einer PDF; ohne konfigurierten Schlüssel wird sie übersprungen. */
async function extract(filename: string, pdf: Buffer): Promise<{ ai: AiStatus; data: AiDocumentExtraction | null }> {
  const result = await createDefaultDocumentExtractor().extract({
    filename,
    mimeType: "application/pdf",
    pdfBase64: pdf.toString("base64"),
  });
  if (result.ok) return { ai: { status: "extracted", model: result.model }, data: result.data };
  return {
    ai: { status: result.code === "not_configured" ? "skipped" : "failed", message: result.message },
    data: null,
  };
}

function extractionFields(data: AiDocumentExtraction | null) {
  return {
    documentType: data?.documentType ?? "other",
    documentDate: data?.documentDate ?? null,
    issuer: data?.issuer ?? null,
    totalAmountCents: data?.totalAmountCents ?? null,
    isTaxRelevant: data?.isTaxRelevant ?? false,
    taxYear: data?.taxYear ?? null,
    taxCategory: data?.taxCategory ?? null,
    deductibleAmountCents: data?.deductibleAmountCents ?? null,
    detectedBalanceCents: data?.detectedBalanceCents ?? null,
    extractedContractJson: data?.extractedContract ? JSON.stringify(data.extractedContract) : null,
  };
}

/** Ablagejahr: Belegjahr laut KI, sonst das laufende Jahr. */
function storageYear(documentDate: string | null | undefined): number {
  const year = documentDate ? Number(documentDate.slice(0, 4)) : NaN;
  return Number.isInteger(year) && year >= 1900 && year <= 2100 ? year : Number(getTodayIsoDate().slice(0, 4));
}

/** Upload: prüfen, Dublette abweisen, KI-Vorschlag holen, Datei + Datensatz anlegen. */
export async function uploadDocument(file: Blob & { name?: string }): Promise<IntakeResult> {
  const pdf = Buffer.from(await file.arrayBuffer());
  validatePdfBuffer(pdf);

  const existing = getDocumentBySha256(computeSha256Hex(pdf));
  if (existing) throw new DuplicateDocumentError(existing);

  const filename = sanitizeOriginalFilename(file.name?.trim() ? file.name : "dokument.pdf");
  const { ai, data } = await extract(filename, pdf);
  const saved = savePdfFile(pdf, storageYear(data?.documentDate));
  try {
    const document = createDocumentRecord({
      filename,
      storagePath: saved.storagePath,
      sha256Hash: saved.sha256Hash,
      ...extractionFields(data),
    });
    return { document, ai };
  } catch (error) {
    deletePdfFileIfExists(saved.storagePath);
    throw error;
  }
}

/** Erneute KI-Analyse eines noch nicht verifizierten Belegs. */
export async function analyzeDocument(id: string): Promise<IntakeResult> {
  const doc = getDocumentById(id);
  if (!doc) throw new DocumentNotFoundError();
  if (doc.status === "verified") throw new DocumentAlreadyVerifiedError();

  const { ai, data } = await extract(doc.filename, readPdfFileOrNotFound(doc.storagePath));
  if (!data) return { document: doc, ai };
  return { document: applyAiExtractionIfPending(id, extractionFields(data)), ai };
}
