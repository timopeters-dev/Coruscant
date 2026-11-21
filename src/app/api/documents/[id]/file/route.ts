import { DocumentNotFoundError, getDocumentById } from "@/backend/db/queries/documents";
import { fileResponse, route, type RouteContext } from "@/backend/http";
import { readPdfFileOrNotFound } from "@/backend/storage/pdf-storage";

export const dynamic = "force-dynamic";

export const GET = route(async (_request, { params }: RouteContext) => {
  const doc = getDocumentById((await params).id);
  if (!doc) throw new DocumentNotFoundError();
  const asciiFallback = doc.filename.replace(/[^\x20-\x7e]|["\;]/g, "_");
  return fileResponse(readPdfFileOrNotFound(doc.storagePath), {
    "Content-Type": "application/pdf",
    "Content-Disposition": `inline; filename="${asciiFallback}"; filename*=UTF-8''${encodeURIComponent(doc.filename)}`,
  });
});
