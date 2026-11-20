import { createContractFromDocument } from "@/backend/db/queries/document-review";
import { json, readJson, route, type RouteContext } from "@/backend/http";
import { documentCreateContractSchema } from "@/validation/documents";

export const dynamic = "force-dynamic";

export const POST = route(async (request, { params }: RouteContext) => {
  const { id } = await params;
  return json(createContractFromDocument(id, await readJson(request, documentCreateContractSchema)), 201);
});
