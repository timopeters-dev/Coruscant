import { deleteValuationHistoryEntry } from "@/backend/db/queries/property-valuations";
import { json, route, type RouteContext } from "@/backend/http";

export const dynamic = "force-dynamic";

export const DELETE = route(async (_request, { params }: RouteContext<{ id: string; historyId: string }>) => {
  const { id, historyId } = await params;
  deleteValuationHistoryEntry(id, historyId);
  return json({ deleted: historyId });
});
