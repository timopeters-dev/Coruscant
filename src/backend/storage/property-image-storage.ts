import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

export const MAX_PROPERTY_IMAGE_BYTES = 5 * 1024 * 1024; // 5 MB

export type AllowedPropertyImageMime =
  | "image/jpeg"
  | "image/png"
  | "image/webp";

export type AllowedPropertyImageExtension = "jpg" | "png" | "webp";

const STORAGE_PATH_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|png|webp)$/i;

const EXTENSION_TO_MIME: Record<
  AllowedPropertyImageExtension,
  AllowedPropertyImageMime
> = {
  jpg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
};

export class InvalidPropertyImageError extends Error {
  constructor(message = "Ungültiges Bildformat (erlaubt: JPEG, PNG, WebP).") {
    super(message);
    this.name = "InvalidPropertyImageError";
  }
}

export class PropertyImageTooLargeError extends Error {
  constructor(
    message = `Das Bild überschreitet das Limit von ${MAX_PROPERTY_IMAGE_BYTES / (1024 * 1024)} MB.`,
  ) {
    super(message);
    this.name = "PropertyImageTooLargeError";
  }
}

export class PropertyImagePathTraversalError extends Error {
  constructor(message = "Ungültiger Bildpfad.") {
    super(message);
    this.name = "PropertyImagePathTraversalError";
  }
}

export function resolvePropertyImagesBaseDir(customBaseDir?: string): string {
  const raw =
    customBaseDir ??
    process.env.PROPERTY_IMAGES_DIR?.trim() ??
    "data/property-images";
  const target = raw.length > 0 ? raw : "data/property-images";
  return path.isAbsolute(target)
    ? path.resolve(target)
    : path.resolve(/* turbopackIgnore: true */ process.cwd(), target);
}

export function resolveSafePropertyImagePath(
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
    throw new PropertyImagePathTraversalError();
  }

  if (!STORAGE_PATH_PATTERN.test(storagePath)) {
    throw new PropertyImagePathTraversalError();
  }

  const resolvedBase = resolvePropertyImagesBaseDir(baseDir);
  const resolvedTarget = path.resolve(resolvedBase, storagePath);
  if (!resolvedTarget.startsWith(resolvedBase + path.sep)) {
    throw new PropertyImagePathTraversalError();
  }

  return resolvedTarget;
}

export interface DetectedPropertyImageFormat {
  extension: AllowedPropertyImageExtension;
  mimeType: AllowedPropertyImageMime;
}

export function detectPropertyImageFormat(
  buffer: Buffer,
  declaredMimeType?: string | null,
): DetectedPropertyImageFormat {
  if (buffer.byteLength === 0) {
    throw new InvalidPropertyImageError("Die hochgeladene Datei ist leer.");
  }
  if (buffer.byteLength > MAX_PROPERTY_IMAGE_BYTES) {
    throw new PropertyImageTooLargeError();
  }

  let detected: DetectedPropertyImageFormat | null = null;

  // JPEG: FF D8 FF
  if (
    buffer.byteLength >= 3 &&
    buffer[0] === 0xff &&
    buffer[1] === 0xd8 &&
    buffer[2] === 0xff
  ) {
    detected = { extension: "jpg", mimeType: "image/jpeg" };
  }
  // PNG: 89 50 4E 47 0D 0A 1A 0A
  else if (
    buffer.byteLength >= 8 &&
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47 &&
    buffer[4] === 0x0d &&
    buffer[5] === 0x0a &&
    buffer[6] === 0x1a &&
    buffer[7] === 0x0a
  ) {
    detected = { extension: "png", mimeType: "image/png" };
  }
  // WebP: RIFF....WEBP
  else if (
    buffer.byteLength >= 12 &&
    buffer.subarray(0, 4).toString("ascii") === "RIFF" &&
    buffer.subarray(8, 12).toString("ascii") === "WEBP"
  ) {
    detected = { extension: "webp", mimeType: "image/webp" };
  }

  if (!detected) {
    throw new InvalidPropertyImageError(
      "Die Datei ist kein gültiges JPEG-, PNG- oder WebP-Bild.",
    );
  }

  const normalizedDeclared = declaredMimeType?.trim().toLowerCase() ?? "";
  if (
    normalizedDeclared.length > 0 &&
    normalizedDeclared !== "application/octet-stream" &&
    normalizedDeclared !== detected.mimeType
  ) {
    throw new InvalidPropertyImageError(
      `Der angegebene Dateityp (${normalizedDeclared}) stimmt nicht mit dem Bildinhalt (${detected.mimeType}) überein.`,
    );
  }

  return detected;
}

export interface SavedPropertyImageResult {
  storagePath: string;
  mimeType: AllowedPropertyImageMime;
  byteSize: number;
}

export function savePropertyImageFile(
  buffer: Buffer,
  declaredMimeType?: string | null,
  baseDir?: string,
): SavedPropertyImageResult {
  const format = detectPropertyImageFormat(buffer, declaredMimeType);
  const storagePath = `${crypto.randomUUID()}.${format.extension}`;
  const targetPath = resolveSafePropertyImagePath(storagePath, baseDir);

  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  fs.writeFileSync(targetPath, buffer, { flag: "wx" });

  return {
    storagePath,
    mimeType: format.mimeType,
    byteSize: buffer.byteLength,
  };
}

export function readPropertyImageFile(
  storagePath: string,
  baseDir?: string,
): { buffer: Buffer; mimeType: AllowedPropertyImageMime } {
  const resolvedBase = resolvePropertyImagesBaseDir(baseDir);
  const targetPath = resolveSafePropertyImagePath(storagePath, resolvedBase);

  const realBase = fs.realpathSync(resolvedBase);
  const realTarget = fs.realpathSync(targetPath);
  if (!realTarget.startsWith(realBase + path.sep)) {
    throw new PropertyImagePathTraversalError();
  }

  const match = STORAGE_PATH_PATTERN.exec(storagePath);
  const ext = (match?.[1]?.toLowerCase() ?? "jpg") as AllowedPropertyImageExtension;

  return {
    buffer: fs.readFileSync(realTarget),
    mimeType: EXTENSION_TO_MIME[ext],
  };
}

export function deletePropertyImageIfExists(
  storagePath: string,
  baseDir?: string,
): void {
  const targetPath = resolveSafePropertyImagePath(storagePath, baseDir);
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
