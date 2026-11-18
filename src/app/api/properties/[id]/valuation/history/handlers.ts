import { NextResponse } from "next/server";
import { getPropertyById } from "@/db/queries/contracts";
import {
  getLatestPendingSuggestion,
  listValuationHistory,
} from "@/db/queries/property-valuations";
import { internalErrorResponse, notFoundResponse } from "@/lib/api/http";

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
      const pendingSuggestion = getLatestPendingSuggestion(id);

      return NextResponse.json(
        { entries, pendingSuggestion },
        { status: 200 },
      );
    } catch {
      return internalErrorResponse();
    }
  };
}
