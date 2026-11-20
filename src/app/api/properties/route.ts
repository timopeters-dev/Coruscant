import { createProperty, listProperties, serializePropertyForApi } from "@/backend/db/queries/contracts";
import { json, readJson, route } from "@/backend/http";
import { propertyCreateSchema } from "@/validation/contracts";

export const dynamic = "force-dynamic";

export const GET = route(() => json({ properties: listProperties().map(serializePropertyForApi) }));

export const POST = route(async (request) => {
  const property = createProperty(await readJson(request, propertyCreateSchema));
  return json({ property: serializePropertyForApi(property) }, 201);
});
