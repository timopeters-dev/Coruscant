import crypto from "node:crypto";
import path from "node:path";
import { ApiError, NotFoundError, isFileNotFound } from "@/backend/errors";
import { createFileStore, PathTraversalError } from "./file-store";

export { PathTraversalError };

export const MAX_PDF_SIZE_BYTES = 20 * 1024 * 1024; // 20 MB

const store = createFileStore({
  envVar: "DOCUMENTS_DIR",
  defaultDir: "data/documents",
  pathPattern: /^\d{4}\/[0-9a-f-]{36}\.pdf$/i,
  traversalMessage: "Ungültiger Dokumentenpfad.",
});

export class InvalidPdfError extends ApiError {
  constructor(message = "Ungültige PDF-Datei.") {
    super(400, message);
  }
}

export class PdfTooLargeError extends ApiError {
  constructor() {
    super(413, `Die PDF-Datei überschreitet das Limit von ${MAX_PDF_SIZE_BYTES / (1024 * 1024)} MB.`);
  }
}

export const resolveDocumentsBaseDir = store.baseDir;
export const resolveSafeStoragePath = store.resolveSafe;
export const readPdfFile = store.read;
export const deletePdfFileIfExists = store.deleteIfExists;
export const getPdfFileSize = store.size;

export function sanitizeOriginalFilename(filename: string): string {
  const base = path.posix.basename(filename.replace(/\\/g, "/"));
  const cleaned = base.replace(/[\u0000-\u001f\u007f/\\]/g, "").trim().slice(0, 255);
  return cleaned.length > 0 ? cleaned : "dokument.pdf";
}

export function validatePdfBuffer(buffer: Buffer): void {
  if (buffer.byteLength === 0) throw new InvalidPdfError("Die hochgeladene Datei ist leer.");
  if (buffer.byteLength > MAX_PDF_SIZE_BYTES) throw new PdfTooLargeError();
  if (buffer.subarray(0, 5).toString("ascii") !== "%PDF-") {
    throw new InvalidPdfError("Die Datei ist kein gültiges PDF-Dokument (fehlende %PDF-Signatur).");
  }
}

export function computeSha256Hex(buffer: Buffer): string {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

export interface SavedPdfResult {
  storagePath: string;
  sha256Hash: string;
  byteSize: number;
}

export function savePdfFile(buffer: Buffer, year: number, baseDir?: string): SavedPdfResult {
  validatePdfBuffer(buffer);
  if (!Number.isInteger(year) || year < 1900 || year > 2100) {
    throw new RangeError(`Ungültiges Speicher-Jahr: ${String(year)}`);
  }
  const storagePath = `${year}/${crypto.randomUUID()}.pdf`;
  store.writeNew(storagePath, buffer, baseDir);
  return { storagePath, sha256Hash: computeSha256Hex(buffer), byteSize: buffer.byteLength };
}

/** Liest die PDF eines Dokuments; fehlende Dateien und unsichere Pfade werden zu 404. */
export function readPdfFileOrNotFound(storagePath: string): Buffer {
  try {
    return readPdfFile(storagePath);
  } catch (error) {
    if (error instanceof PathTraversalError || isFileNotFound(error)) {
      throw new NotFoundError("PDF-Datei nicht gefunden.");
    }
    throw error;
  }
}
