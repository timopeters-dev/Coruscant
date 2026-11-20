import { NextResponse } from "next/server";
import { serializePropertyForApi } from "@/backend/db/queries/contracts";
import {
  PropertyNotFoundError,
  saveValuationAdjustments,
  ValuationValueConflictError,
} from "@/backend/db/queries/property-valuations";
import {
  badRequestResponse,
  internalErrorResponse,
  notFoundResponse,
  validationErrorResponse,
} from "@/backend/http";
import { valuationAdjustmentsPutBodySchema } from "@/validation/valuation-adjustments";

export interface RouteContext {
  params: Promise<{ id: string }>;
}

export function createValuationAdjustmentsHandler(
  nowFn: () => Date = () => new Date(),
) {
  return async function PUT(
    request: Request,
    context: RouteContext,
  ): Promise<NextResponse> {
    let rawBody: unknown;
    try {
      rawBody = await request.json();
    } catch {
      return badRequestResponse("Ungültiger JSON-Body.");
    }

    const parsed = valuationAdjustmentsPutBodySchema.safeParse(rawBody);
    if (!parsed.success) {
      return validationErrorResponse(parsed.error);
    }

    try {
      const { id } = await context.params;
      const result = saveValuationAdjustments(id, parsed.data.adjustments, {
        expectedEstimatedValueCents: parsed.data.expectedEstimatedValueCents,
        nowIso: nowFn().toISOString(),
      });

      return NextResponse.json(
        {
          property: serializePropertyForApi(result.property),
          adjustments: result.adjustments,
          totalBps: result.totalBps,
          recompute: result.recompute,
          reason: result.reason,
        },
        { status: 200 },
      );
    } catch (error) {
      if (error instanceof PropertyNotFoundError) {
        return notFoundResponse(error.message);
      }
      if (error instanceof ValuationValueConflictError) {
        return NextResponse.json(
          {
            code: "value_changed",
            currentValueCents: error.currentValueCents,
            error: error.message,
          },
          { status: 409 },
        );
      }
      return internalErrorResponse();
    }
  };
}
