import { NextResponse } from "next/server";
import { loadPropertyValuationSource } from "@/db/queries/contracts";
import {
  badRequestResponse,
  internalErrorResponse,
  notFoundResponse,
  validationErrorResponse,
} from "@/lib/api/http";
import {
  assertValuationContextSafe,
  buildPropertyValuationContext,
  ValuationContextPiiError,
  type ValuationContextUnavailableReason,
} from "@/lib/domain/property-valuation-context";
import {
  assertRequestHasNoAddress,
  buildImmoAnalyseRequest,
  serializeImmoAnalyseRequest,
} from "@/lib/integrations/immoanalyse-mapping";
import {
  createDefaultPropertyValuator,
  type PropertyValuator,
  type ValuatorErrorCode,
} from "@/lib/integrations/property-valuator";
import { getBerlinClockSnapshot } from "@/lib/server/berlin-clock";
import { runPropertyValuation } from "@/lib/server/property-valuation-service";
import { valuationPostBodySchema } from "@/lib/validation/immoanalyse";

export type PropertyValuatorFactory = () => PropertyValuator;

export interface RouteContext {
  params: Promise<{ id: string }>;
}

const STATUS_BY_ERROR_CODE: Record<ValuatorErrorCode, number> = {
  not_configured: 503,
  unauthorized: 502,
  quota_exceeded: 429,
  rate_limited: 429,
  not_valuable: 422,
  invalid_request: 502,
  timeout: 504,
  http_error: 502,
  network_error: 502,
  invalid_payload: 502,
};

const UNAVAILABLE_MESSAGE: Record<ValuationContextUnavailableReason, string> = {
  missing_postal_code:
    "Gültige 5-stellige PLZ im Objekt pflegen, um eine Schätzung zu erhalten.",
  missing_living_area:
    "Wohnfläche im Objekt pflegen, um eine Schätzung zu erhalten.",
  missing_property_type:
    "Objekttyp im Objekt pflegen, um eine Schätzung zu erhalten.",
};

export function createValuationPreviewHandler(nowFn: () => Date = () => new Date()) {
  return async function GET(
    _request: Request,
    context: RouteContext,
  ): Promise<NextResponse> {
    try {
      const { id } = await context.params;
      const todayKey = getBerlinClockSnapshot(nowFn()).dateKey;
      const source = loadPropertyValuationSource(id, todayKey);
      if (!source) {
        return notFoundResponse("Immobilie nicht gefunden.");
      }

      const built = buildPropertyValuationContext(source.contextInput);
      if (!built.ok) {
        return NextResponse.json(
          {
            code: "valuation_context_unavailable",
            reason: built.reason,
            error: UNAVAILABLE_MESSAGE[built.reason],
          },
          { status: 422 },
        );
      }

      let requestJson: string;
      try {
        assertValuationContextSafe(
          built.context,
          source.contextInput.forbiddenTerms,
        );
        const body = buildImmoAnalyseRequest(built.context);
        assertRequestHasNoAddress(body);
        requestJson = serializeImmoAnalyseRequest(body);
      } catch (error) {
        if (error instanceof ValuationContextPiiError) {
          return NextResponse.json(
            {
              code: "valuation_context_unsafe",
              error:
                "Kontext enthält potenziell personenbezogene Daten und wird nicht gesendet.",
            },
            { status: 422 },
          );
        }
        throw error;
      }

      return NextResponse.json(
        { requestJson, usable: true },
        { status: 200 },
      );
    } catch {
      return internalErrorResponse();
    }
  };
}

export function createValuationEstimateHandler(
  valuatorFactory: PropertyValuatorFactory = createDefaultPropertyValuator,
  nowFn: () => Date = () => new Date(),
) {
  return async function POST(
    request: Request,
    context: RouteContext,
  ): Promise<NextResponse> {
    let rawBodyData: unknown = {};
    try {
      const rawText = await request.text();
      if (rawText.trim().length > 0) {
        rawBodyData = JSON.parse(rawText);
      }
    } catch {
      return badRequestResponse("Ungültiger JSON-Body.");
    }

    const parsedBody = valuationPostBodySchema.safeParse(rawBodyData);
    if (!parsedBody.success) {
      return validationErrorResponse(parsedBody.error);
    }

    try {
      const { id } = await context.params;
      const result = await runPropertyValuation(id, {
        trigger: "manual",
        valuator: valuatorFactory(),
        now: nowFn(),
      });

      if (result.kind === "ok") {
        return NextResponse.json(
          {
            valuation: result.valuation,
            warnings: result.warnings,
            historyId: result.historyId,
            requestJson: result.requestJson,
            cached: result.cached,
            quota: result.quota,
          },
          { status: 200 },
        );
      }

      if (result.code === "not_found") {
        return notFoundResponse(result.message);
      }

      if (result.code === "unavailable") {
        const reason = result.reason as ValuationContextUnavailableReason;
        return NextResponse.json(
          {
            code: "valuation_context_unavailable",
            reason,
            error: UNAVAILABLE_MESSAGE[reason],
          },
          { status: 422 },
        );
      }

      if (result.code === "unsafe") {
        return NextResponse.json(
          {
            code: "valuation_context_unsafe",
            error:
              "Kontext enthält potenziell personenbezogene Daten und wird nicht gesendet.",
          },
          { status: 422 },
        );
      }

      if (result.code === "valuation_rejected") {
        return NextResponse.json(
          {
            code: "valuation_rejected",
            reason: result.reason,
            ...(result.rationale ? { rationale: result.rationale } : {}),
            error: result.message,
          },
          { status: 422 },
        );
      }

      if (result.code === "quota_exceeded") {
        return NextResponse.json(
          {
            code: "quota_exceeded",
            resetAt: result.quota?.resetAt ?? null,
            error: result.message,
          },
          { status: 429 },
        );
      }

      if (result.code === "not_valuable") {
        return NextResponse.json(
          {
            code: "not_valuable",
            ...(result.apiCode ? { apiCode: result.apiCode } : {}),
            error: result.message,
          },
          { status: 422 },
        );
      }

      return NextResponse.json(
        {
          code: result.code,
          error: result.message,
        },
        { status: STATUS_BY_ERROR_CODE[result.code] },
      );
    } catch {
      return internalErrorResponse();
    }
  };
}
