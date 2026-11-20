import { json, readJson, route, type RouteContext } from "@/backend/http";
import { isDevMode } from "@/backend/dev-mode";
import { getBerlinClockSnapshot } from "@/backend/jobs/berlin-clock";
import {
  prepareValuationRequest,
  runPropertyValuation,
  toValuationApiError,
} from "@/backend/services/property-valuation-service";
import { valuationPostBodySchema } from "@/validation/immoanalyse";

export const dynamic = "force-dynamic";

/** Vorschau: Ist das Objekt bewertbar? Im Dev-Modus mit dem Request, der gesendet würde. */
export const GET = route(async (_request, { params }: RouteContext) => {
  const prepared = prepareValuationRequest((await params).id, getBerlinClockSnapshot(new Date()).dateKey);
  if (prepared.kind === "error") throw toValuationApiError(prepared);
  return json({ ...(isDevMode() ? { requestJson: prepared.requestJson } : {}), usable: true });
});

/** Manuelle Wertschätzung über ImmoAnalyse. */
export const POST = route(async (request, { params }: RouteContext) => {
  await readJson(request, valuationPostBodySchema, { emptyBody: {} });
  const result = await runPropertyValuation((await params).id, { trigger: "manual" });
  if (result.kind === "error") throw toValuationApiError(result);
  return json({
    valuation: result.valuation,
    warnings: result.warnings,
    historyId: result.historyId,
    ...(isDevMode() ? { requestJson: result.requestJson } : {}),
    cached: result.cached,
    quota: result.quota,
  });
});
