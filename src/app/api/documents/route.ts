import { listDocuments } from "@/backend/db/queries/documents";
import { ApiError } from "@/backend/errors";
import { json, readUploadedFile, route } from "@/backend/http";
import { uploadDocument } from "@/backend/services/document-intake";
import { documentStatusSchema } from "@/validation/documents";

export const dynamic = "force-dynamic";

export const GET = route((request) => {
  const params = new URL(request.url).searchParams;
  const statusParam = params.get("status");
  const taxYearParam = params.get("taxYear");

  const status = statusParam ? documentStatusSchema.safeParse(statusParam) : null;
  if (status && !status.success) throw new ApiError(400, "Ungültiger Status-Filter.");

  const taxYear = taxYearParam ? Number(taxYearParam) : undefined;
  if (taxYear !== undefined && !(Number.isInteger(taxYear) && taxYear >= 1900 && taxYear <= 2100)) {
    throw new ApiError(400, "Ungültiges Steuerjahr.");
  }

  const documents = listDocuments({
    status: status?.data,
    taxYear,
    propertyId: params.get("propertyId") || undefined,
    contractId: params.get("contractId") || undefined,
    onlyTaxRelevant: params.get("onlyTaxRelevant") === "true",
  });
  return json({ documents });
});

export const POST = route(async (request) => {
  const file = await readUploadedFile(request, {
    invalidForm: "Ungültige Multipart-Anfrage.",
    missingFile: "Bitte eine PDF-Datei über das Feld 'file' hochladen.",
  });
  return json(await uploadDocument(file), 201);
});
