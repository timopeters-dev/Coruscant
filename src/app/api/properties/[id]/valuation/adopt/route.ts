import { serializePropertyForApi } from "@/backend/db/queries/contracts";
import { adoptValuationHistoryEntry } from "@/backend/db/queries/property-valuations";
import { json, readJson, route, type RouteContext } from "@/backend/http";
import { valuationAdoptBodySchema } from "@/validation/immoanalyse";

export const dynamic = "force-dynamic";

export const POST = route(async (request, { params }: RouteContext) => {
  const { historyId, choice } = await readJson(request, valuationAdoptBodySchema);
  const property = adoptValuationHistoryEntry((await params).id, historyId, choice, new Date().toISOString());
  return json({ property: serializePropertyForApi(property) });
});
