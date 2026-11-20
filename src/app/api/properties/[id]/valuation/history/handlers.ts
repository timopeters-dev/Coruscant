import { NextResponse } from "next/server";
import { getPropertyById } from "@/backend/db/queries/contracts";
import {
  getLatestPendingSuggestion,
  listValuationHistory,
} from "@/backend/db/queries/property-valuations";
import { internalErrorResponse, notFoundResponse } from "@/backend/http";
import {
  applyValuationAdjustmentToBounds,
  parseValuationAdjustments,
  sumAdjustmentBps,
} from "@/domain/properties/valuation/adjustments";

export interface RouteContext {
  params: Promise<{ id: string }>;
}

export function createValuationHistoryHandler() {
  return async function GET(
    _request: Request,
    context: RouteContext,
  ): Promise<NextResponse> {
    try {
      const { id } = await context.params;
      const property = getPropertyById(id);
      if (!property) {
        return notFoundResponse("Immobilie nicht gefunden.");
      }

      const entries = listValuationHistory(id);
      const rawPending = getLatestPendingSuggestion(id);
      const currentAdjustments = parseValuationAdjustments(
        property.valuationAdjustments,
      );
      const currentAdjustmentBps = sumAdjustmentBps(currentAdjustments);

      const pendingSuggestion = rawPending
        ? (() => {
            const adjusted = applyValuationAdjustmentToBounds(
              {
                lowerCents: rawPending.lowerCents,
                medianCents: rawPending.medianCents,
                upperCents: rawPending.upperCents,
              },
              currentAdjustmentBps,
            );
            return {
              ...rawPending,
              adjustmentBps: currentAdjustmentBps,
              adjustedLowerCents: adjusted.lowerCents,
              adjustedMedianCents: adjusted.medianCents,
              adjustedUpperCents: adjusted.upperCents,
            };
          })()
        : null;

      return NextResponse.json(
        { entries, pendingSuggestion },
        { status: 200 },
      );
    } catch {
      return internalErrorResponse();
    }
  };
}
