import { getPropertyById, updatePropertyImagePath } from "@/backend/db/queries/properties";
import { PropertyNotFoundError } from "@/backend/db/queries/property-valuations";
import { NotFoundError } from "@/backend/errors";
import { fileResponse, json, readUploadedFile, route, type RouteContext } from "@/backend/http";
import {
  deletePropertyImageQuietly,
  MAX_PROPERTY_IMAGE_BYTES,
  PropertyImageTooLargeError,
  readPropertyImageOrNotFound,
  savePropertyImageFile,
} from "@/backend/storage/property-image-storage";

export const dynamic = "force-dynamic";

export const GET = route(async (_request, { params }: RouteContext) => {
  const imagePath = getPropertyById((await params).id)?.imagePath;
  if (!imagePath) throw new NotFoundError("Kein Objektbild vorhanden.");
  const { buffer, mimeType } = readPropertyImageOrNotFound(imagePath);
  return fileResponse(buffer, { "Content-Type": mimeType, "Content-Length": String(buffer.byteLength) });
});

export const POST = route(async (request, { params }: RouteContext) => {
  const { id } = await params;
  if (!getPropertyById(id)) throw new PropertyNotFoundError();

  const file = await readUploadedFile(request, {
    invalidForm: "Ungültige multipart/form-data-Anfrage für den Bildupload.",
    missingFile: "Bitte eine Bilddatei im Feld 'file' hochladen.",
  });
  if (file.size > MAX_PROPERTY_IMAGE_BYTES) throw new PropertyImageTooLargeError();

  const saved = savePropertyImageFile(Buffer.from(await file.arrayBuffer()), file.type);
  let updated;
  try {
    updated = updatePropertyImagePath(id, saved.storagePath);
  } finally {
    if (!updated) deletePropertyImageQuietly(saved.storagePath);
  }
  if (!updated) throw new PropertyNotFoundError();
  if (updated.previousImagePath !== saved.storagePath) deletePropertyImageQuietly(updated.previousImagePath);
  return json({ property: updated.property });
});

export const DELETE = route(async (_request, { params }: RouteContext) => {
  const updated = updatePropertyImagePath((await params).id, null);
  if (!updated) throw new PropertyNotFoundError();
  deletePropertyImageQuietly(updated.previousImagePath);
  return json({ property: updated.property });
});
