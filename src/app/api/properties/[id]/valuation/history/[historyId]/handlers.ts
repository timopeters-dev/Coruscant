import { NextResponse } from "next/server";
import {
  deleteValuationHistoryEntry,
  ValuationHistoryNotFoundError,
} from "@/backend/db/queries/property-valuations";
import { internalErrorResponse, notFoundResponse } from "@/backend/http";

export interface RouteContext {
  params: Promise<{ id: string; historyId: string }>;
}

export function createValuationHistoryEntryDeleteHandler() {
  return async function DELETE(
    _request: Request,
    context: RouteContext,
  ): Promise<NextResponse> {
    try {
      const { id, historyId } = await context.params;
      deleteValuationHistoryEntry(id, historyId);
      return NextResponse.json({ deleted: historyId }, { status: 200 });
    } catch (error) {
      if (error instanceof ValuationHistoryNotFoundError) {
        return notFoundResponse(error.message);
      }
      return internalErrorResponse();
    }
  };
}
