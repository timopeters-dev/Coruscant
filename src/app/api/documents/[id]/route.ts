import { deleteDocumentRecord, updateDocumentRecord } from "@/backend/db/queries/documents";
import { json, readJson, route, type RouteContext } from "@/backend/http";
import { deletePdfFileIfExists } from "@/backend/storage/pdf-storage";
import { documentUpdateSchema } from "@/validation/documents";

export const dynamic = "force-dynamic";

export const PATCH = route(async (request, { params }: RouteContext) => {
  const { id } = await params;
  const document = updateDocumentRecord(id, await readJson(request, documentUpdateSchema));
  return json({ document });
});

export const DELETE = route(async (_request, { params }: RouteContext) => {
  const deleted = deleteDocumentRecord((await params).id);
  deletePdfFileIfExists(deleted.storagePath);
  return json({ deletedId: deleted.id });
});
