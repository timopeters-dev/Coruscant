import { NextResponse } from "next/server";
import { loadPropertyValuationSource } from "@/db/queries/contracts";
import {
  badRequestResponse,
  internalErrorResponse,
  notFoundResponse,
  validationErrorResponse,
} from "@/lib/api/http";
import { getTodayIsoDate } from "@/lib/domain/date";
import { validatePropertyValuation } from "@/lib/domain/property-valuation";
import {
  assertValuationContextSafe,
  buildPropertyValuationContext,
  serializePropertyValuationContext,
  ValuationContextPiiError,
  type ValuationContextUnavailableReason,
} from "@/lib/domain/property-valuation-context";
import { createDefaultPropertyValuator } from "@/lib/integrations/gemini-property-valuator";
import type {
  PropertyValuator,
  ValuatorErrorCode,
} from "@/lib/integrations/property-valuator";
import { valuationPostBodySchema } from "@/lib/validation/property-valuation";

export type PropertyValuatorFactory = () => PropertyValuator;

export interface RouteContext {
  params: Promise<{ id: string }>;
}

const STATUS_BY_ERROR_CODE: Record<ValuatorErrorCode, number> = {
  not_configured: 503,
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
};

type PreparedContextResult =
  | {
      ok: true;
      contextJson: string;
      context: Extract<
        ReturnType<typeof buildPropertyValuationContext>,
        { ok: true }
      >["context"];
      currentValueCents: number;
      today: string;
    }
  | {
      ok: false;
      response: NextResponse;
    };

function preparePropertyValuationContext(
  id: string,
  today: string,
): PreparedContextResult {
  const source = loadPropertyValuationSource(id, today);
  if (!source) {
    return {
      ok: false,
      response: notFoundResponse("Immobilie nicht gefunden."),
    };
  }

  const built = buildPropertyValuationContext(source.contextInput);
  if (!built.ok) {
    return {
      ok: false,
      response: NextResponse.json(
        {
          code: "valuation_context_unavailable",
          reason: built.reason,
          error: UNAVAILABLE_MESSAGE[built.reason],
        },
        { status: 422 },
      ),
    };
  }

  try {
    assertValuationContextSafe(
      built.context,
      source.contextInput.forbiddenTerms,
    );
  } catch (error) {
    if (error instanceof ValuationContextPiiError) {
      return {
        ok: false,
        response: NextResponse.json(
          {
            code: "valuation_context_unsafe",
            error:
              "Kontext enthält potenziell personenbezogene Daten und wird nicht gesendet.",
          },
          { status: 422 },
        ),
      };
    }
    throw error;
  }

  return {
    ok: true,
    context: built.context,
    contextJson: serializePropertyValuationContext(built.context),
    currentValueCents: source.currentValueCents,
    today,
  };
}

export function createValuationPreviewHandler() {
  return async function GET(
    _request: Request,
    context: RouteContext,
  ): Promise<NextResponse> {
    try {
      const { id } = await context.params;
      const prepared = preparePropertyValuationContext(id, getTodayIsoDate());
      if (!prepared.ok) {
        return prepared.response;
      }
      return NextResponse.json(
        { contextJson: prepared.contextJson, usable: true },
        { status: 200 },
      );
    } catch {
      return internalErrorResponse();
    }
  };
}

export function createValuationEstimateHandler(
  valuatorFactory: PropertyValuatorFactory = createDefaultPropertyValuator,
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
      const prepared = preparePropertyValuationContext(id, getTodayIsoDate());
      if (!prepared.ok) {
        return prepared.response;
      }

      const result = await valuatorFactory().estimate(prepared.contextJson);
      if (!result.ok) {
        return NextResponse.json(
          { error: result.message, code: result.code },
          { status: STATUS_BY_ERROR_CODE[result.code] },
        );
      }

      const validated = validatePropertyValuation({
        rawOutput: result.data,
        sources: result.grounding.sources,
        searchQueries: result.grounding.webSearchQueries,
        context: prepared.context,
        currentValueCents: prepared.currentValueCents,
        today: prepared.today,
      });

      if (!validated.ok) {
        return NextResponse.json(
          {
            code: "valuation_rejected",
            reason: validated.reason,
            error: "KI-Wertschätzung konnte nicht plausibilisiert werden.",
          },
          { status: 422 },
        );
      }

      return NextResponse.json(
        {
          valuation: validated.valuation,
          warnings: validated.warnings,
          model: result.model,
          contextJson: prepared.contextJson,
        },
        { status: 200 },
      );
    } catch {
      return internalErrorResponse();
    }
  };
}
