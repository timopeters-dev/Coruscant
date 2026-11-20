import { NextResponse } from "next/server";
import { serializePropertyForApi } from "@/backend/db/queries/contracts";
import {
  adoptValuationHistoryEntry,
  ValuationHistoryNotFoundError,
} from "@/backend/db/queries/property-valuations";
import {
  badRequestResponse,
  internalErrorResponse,
  notFoundResponse,
  validationErrorResponse,
} from "@/backend/http";
import { valuationAdoptBodySchema } from "@/validation/immoanalyse";

export interface RouteContext {
  params: Promise<{ id: string }>;
}

export function createValuationAdoptHandler(
  nowFn: () => Date = () => new Date(),
) {
  return async function POST(
    request: Request,
    context: RouteContext,
  ): Promise<NextResponse> {
    let rawBody: unknown;
    try {
      rawBody = await request.json();
    } catch {
      return badRequestResponse("Ungültiger JSON-Body.");
    }

    const parsed = valuationAdoptBodySchema.safeParse(rawBody);
    if (!parsed.success) {
      return validationErrorResponse(parsed.error);
    }

    try {
      const { id } = await context.params;
      const property = adoptValuationHistoryEntry(
        id,
        parsed.data.historyId,
        parsed.data.choice,
        nowFn().toISOString(),
      );
      return NextResponse.json(
        { property: serializePropertyForApi(property) },
        { status: 200 },
      );
    } catch (error) {
      if (error instanceof ValuationHistoryNotFoundError) {
        return notFoundResponse(error.message);
      }
      return internalErrorResponse();
    }
  };
}
