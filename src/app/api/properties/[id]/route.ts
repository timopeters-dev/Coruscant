import {
  deleteProperty,
  getPropertyById,
  serializePropertyForApi,
  updateProperty,
} from "@/backend/db/queries/contracts";
import { PropertyNotFoundError } from "@/backend/db/queries/property-valuations";
import { json, readJson, route, type RouteContext } from "@/backend/http";
import { deletePropertyImageQuietly } from "@/backend/storage/property-image-storage";
import { propertyUpdateSchema } from "@/validation/contracts";

export const dynamic = "force-dynamic";

export const GET = route(async (_request, { params }: RouteContext) => {
  const property = getPropertyById((await params).id);
  if (!property) throw new PropertyNotFoundError();
  return json({ property: serializePropertyForApi(property) });
});

export const PATCH = route(async (request, { params }: RouteContext) => {
  const patch = await readJson(request, propertyUpdateSchema);
  const property = updateProperty((await params).id, patch);
  if (!property) throw new PropertyNotFoundError();
  return json({ property: serializePropertyForApi(property) });
});

export const DELETE = route(async (_request, { params }: RouteContext) => {
  const deleted = deleteProperty((await params).id);
  if (!deleted) throw new PropertyNotFoundError();
  deletePropertyImageQuietly(deleted.imagePath);
  return json({ deletedId: deleted.id });
});
