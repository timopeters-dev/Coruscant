import { serializePropertyForApi } from "@/backend/db/queries/contracts";
import { saveValuationAdjustments } from "@/backend/db/queries/property-valuations";
import { json, readJson, route, type RouteContext } from "@/backend/http";
import { valuationAdjustmentsPutBodySchema } from "@/validation/valuation-adjustments";

export const dynamic = "force-dynamic";

export const PUT = route(async (request, { params }: RouteContext) => {
  const body = await readJson(request, valuationAdjustmentsPutBodySchema);
  const result = saveValuationAdjustments((await params).id, body.adjustments, {
    expectedEstimatedValueCents: body.expectedEstimatedValueCents,
    nowIso: new Date().toISOString(),
  });
  return json({
    property: serializePropertyForApi(result.property),
    adjustments: result.adjustments,
    totalBps: result.totalBps,
    recompute: result.recompute,
    reason: result.reason,
  });
});
