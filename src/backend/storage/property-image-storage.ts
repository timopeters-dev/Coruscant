import crypto from "node:crypto";
import { ApiError, NotFoundError, isFileNotFound } from "@/backend/errors";
import { createFileStore, PathTraversalError } from "./file-store";

export const MAX_PROPERTY_IMAGE_BYTES = 5 * 1024 * 1024; // 5 MB

const FORMATS = {
  jpg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
} as const;

export type AllowedPropertyImageExtension = keyof typeof FORMATS;
export type AllowedPropertyImageMime = (typeof FORMATS)[AllowedPropertyImageExtension];

const STORAGE_PATH_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|png|webp)$/i;

const store = createFileStore({
  envVar: "PROPERTY_IMAGES_DIR",
  defaultDir: "data/property-images",
  pathPattern: STORAGE_PATH_PATTERN,
  traversalMessage: "Ungültiger Bildpfad.",
});

export class InvalidPropertyImageError extends ApiError {
  constructor(message = "Ungültiges Bildformat (erlaubt: JPEG, PNG, WebP).") {
    super(400, message);
  }
}

export class PropertyImageTooLargeError extends ApiError {
  constructor() {
    super(413, `Das Bild überschreitet das Limit von ${MAX_PROPERTY_IMAGE_BYTES / (1024 * 1024)} MB.`);
  }
}

export const resolvePropertyImagesBaseDir = store.baseDir;
export const resolveSafePropertyImagePath = store.resolveSafe;
export const deletePropertyImageIfExists = store.deleteIfExists;

/** Aufräumen nach DB-Änderungen: Fehler beim Löschen dürfen den Request nicht scheitern lassen. */
export function deletePropertyImageQuietly(storagePath: string | null | undefined): void {
  if (!storagePath) return;
  try {
    store.deleteIfExists(storagePath);
  } catch {
    // Best-effort
  }
}

export interface DetectedPropertyImageFormat {
  extension: AllowedPropertyImageExtension;
  mimeType: AllowedPropertyImageMime;
}

function sniffExtension(buffer: Buffer): AllowedPropertyImageExtension | null {
  const startsWith = (bytes: number[]) => buffer.byteLength >= bytes.length && bytes.every((b, i) => buffer[i] === b);
  if (startsWith([0xff, 0xd8, 0xff])) return "jpg";
  if (startsWith([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "png";
  if (
    buffer.byteLength >= 12 &&
    buffer.subarray(0, 4).toString("ascii") === "RIFF" &&
    buffer.subarray(8, 12).toString("ascii") === "WEBP"
  ) {
    return "webp";
  }
  return null;
}

/** Erkennt das Format am Dateiinhalt; ein abweichender deklarierter Typ wird abgelehnt. */
export function detectPropertyImageFormat(buffer: Buffer, declaredMimeType?: string | null): DetectedPropertyImageFormat {
  if (buffer.byteLength === 0) throw new InvalidPropertyImageError("Die hochgeladene Datei ist leer.");
  if (buffer.byteLength > MAX_PROPERTY_IMAGE_BYTES) throw new PropertyImageTooLargeError();

  const extension = sniffExtension(buffer);
  if (!extension) throw new InvalidPropertyImageError("Die Datei ist kein gültiges JPEG-, PNG- oder WebP-Bild.");
  const mimeType = FORMATS[extension];

  const declared = declaredMimeType?.trim().toLowerCase() ?? "";
  if (declared !== "" && declared !== "application/octet-stream" && declared !== mimeType) {
    throw new InvalidPropertyImageError(
      `Der angegebene Dateityp (${declared}) stimmt nicht mit dem Bildinhalt (${mimeType}) überein.`,
    );
  }
  return { extension, mimeType };
}

export interface SavedPropertyImageResult {
  storagePath: string;
  mimeType: AllowedPropertyImageMime;
  byteSize: number;
}

export function savePropertyImageFile(buffer: Buffer, declaredMimeType?: string | null, baseDir?: string): SavedPropertyImageResult {
  const format = detectPropertyImageFormat(buffer, declaredMimeType);
  const storagePath = `${crypto.randomUUID()}.${format.extension}`;
  store.writeNew(storagePath, buffer, baseDir);
  return { storagePath, mimeType: format.mimeType, byteSize: buffer.byteLength };
}

export function readPropertyImageFile(storagePath: string, baseDir?: string): { buffer: Buffer; mimeType: AllowedPropertyImageMime } {
  const buffer = store.read(storagePath, baseDir);
  const extension = STORAGE_PATH_PATTERN.exec(storagePath)![1]!.toLowerCase() as AllowedPropertyImageExtension;
  return { buffer, mimeType: FORMATS[extension] };
}

/** Liest ein Objektbild; unsichere Pfade und fehlende Dateien werden zu 404. */
export function readPropertyImageOrNotFound(storagePath: string): { buffer: Buffer; mimeType: AllowedPropertyImageMime } {
  try {
    return readPropertyImageFile(storagePath);
  } catch (error) {
    if (error instanceof PathTraversalError) throw new NotFoundError("Kein Objektbild vorhanden.");
    if (isFileNotFound(error)) throw new NotFoundError("Bilddatei nicht gefunden.");
    throw error;
  }
}
