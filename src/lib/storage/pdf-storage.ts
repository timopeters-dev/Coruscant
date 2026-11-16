import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

export const MAX_PDF_SIZE_BYTES = 20 * 1024 * 1024; // 20 MB

const STORAGE_PATH_PATTERN = /^\d{4}\/[0-9a-f-]{36}\.pdf$/i;

export class InvalidPdfError extends Error {
  constructor(message = "Ungültige PDF-Datei.") {
    super(message);
    this.name = "InvalidPdfError";
  }
}

export class PdfTooLargeError extends Error {
  constructor(
    message = `Die PDF-Datei überschreitet das Limit von ${MAX_PDF_SIZE_BYTES / (1024 * 1024)} MB.`,
  ) {
    super(message);
    this.name = "PdfTooLargeError";
  }
}

export class PathTraversalError extends Error {
  constructor(message = "Ungültiger Dokumentenpfad.") {
    super(message);
    this.name = "PathTraversalError";
  }
}

export function resolveDocumentsBaseDir(customBaseDir?: string): string {
  const raw =
    customBaseDir ?? process.env.DOCUMENTS_DIR?.trim() ?? "data/documents";
  const target = raw.length > 0 ? raw : "data/documents";
  return path.isAbsolute(target)
    ? path.resolve(target)
    : path.resolve(/* turbopackIgnore: true */ process.cwd(), target);
}

export function sanitizeOriginalFilename(filename: string): string {
  const normalizedSlashes = filename.replace(/\\/g, "/");
  const base = path.posix.basename(normalizedSlashes);
  const cleaned = base
    .replace(/[\u0000-\u001f\u007f/\\]/g, "")
    .trim()
    .slice(0, 255);
  return cleaned.length > 0 ? cleaned : "dokument.pdf";
}

export function validatePdfBuffer(buffer: Buffer): void {
  if (buffer.byteLength === 0) {
    throw new InvalidPdfError("Die hochgeladene Datei ist leer.");
  }
  if (buffer.byteLength > MAX_PDF_SIZE_BYTES) {
    throw new PdfTooLargeError();
  }
  if (buffer.subarray(0, 5).toString("ascii") !== "%PDF-") {
    throw new InvalidPdfError(
      "Die Datei ist kein gültiges PDF-Dokument (fehlende %PDF-Signatur).",
    );
  }
}

export function computeSha256Hex(buffer: Buffer): string {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

export function resolveSafeStoragePath(
  storagePath: string,
  baseDir?: string,
): string {
  if (
    !storagePath ||
    storagePath.includes("\0") ||
    storagePath.includes("\\") ||
    path.isAbsolute(storagePath) ||
    storagePath.split("/").some((segment) => segment === "..")
  ) {
    throw new PathTraversalError();
  }

  if (!STORAGE_PATH_PATTERN.test(storagePath)) {
    throw new PathTraversalError();
  }

  const resolvedBase = resolveDocumentsBaseDir(baseDir);
  const resolvedTarget = path.resolve(resolvedBase, storagePath);
  if (!resolvedTarget.startsWith(resolvedBase + path.sep)) {
    throw new PathTraversalError();
  }

  return resolvedTarget;
}

export interface SavedPdfResult {
  storagePath: string;
  sha256Hash: string;
  byteSize: number;
}

export function savePdfFile(
  buffer: Buffer,
  year: number,
  baseDir?: string,
): SavedPdfResult {
  validatePdfBuffer(buffer);
  if (!Number.isInteger(year) || year < 1900 || year > 2100) {
    throw new RangeError(`Ungültiges Speicher-Jahr: ${String(year)}`);
  }

  const uuid = crypto.randomUUID();
  const storagePath = `${year}/${uuid}.pdf`;
  const targetPath = resolveSafeStoragePath(storagePath, baseDir);

  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  fs.writeFileSync(targetPath, buffer, { flag: "wx" });

  return {
    storagePath,
    sha256Hash: computeSha256Hex(buffer),
    byteSize: buffer.byteLength,
  };
}

export function readPdfFile(storagePath: string, baseDir?: string): Buffer {
  const resolvedBase = resolveDocumentsBaseDir(baseDir);
  const targetPath = resolveSafeStoragePath(storagePath, resolvedBase);

  const realBase = fs.realpathSync(resolvedBase);
  const realTarget = fs.realpathSync(targetPath);
  if (!realTarget.startsWith(realBase + path.sep)) {
    throw new PathTraversalError();
  }

  return fs.readFileSync(realTarget);
}

export function deletePdfFileIfExists(
  storagePath: string,
  baseDir?: string,
): void {
  const targetPath = resolveSafeStoragePath(storagePath, baseDir);
  try {
    fs.unlinkSync(targetPath);
  } catch (error) {
    if (
      error &&
      typeof error === "object" &&
      "code" in error &&
      error.code === "ENOENT"
    ) {
      return;
    }
    throw error;
  }
}
