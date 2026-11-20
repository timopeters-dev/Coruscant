import { getPropertyById } from "@/backend/db/queries/properties";
import {
  getLatestPendingSuggestion,
  listValuationHistory,
  PropertyNotFoundError,
} from "@/backend/db/queries/property-valuations";
import { json, route, type RouteContext } from "@/backend/http";
import {
  applyValuationAdjustmentToBounds,
  parseValuationAdjustments,
  sumAdjustmentBps,
} from "@/domain/properties/valuation/adjustments";

export const dynamic = "force-dynamic";

/** Bewertungsverlauf und offener Vorschlag – mit den aktuellen Zu-/Abschlägen. */
export const GET = route(async (_request, { params }: RouteContext) => {
  const { id } = await params;
  const property = getPropertyById(id);
  if (!property) throw new PropertyNotFoundError();

  const pending = getLatestPendingSuggestion(id);
  let pendingSuggestion = null;
  if (pending) {
    const adjustmentBps = sumAdjustmentBps(parseValuationAdjustments(property.valuationAdjustments));
    const adjusted = applyValuationAdjustmentToBounds(pending, adjustmentBps);
    pendingSuggestion = {
      ...pending,
      adjustmentBps,
      adjustedLowerCents: adjusted.lowerCents,
      adjustedMedianCents: adjusted.medianCents,
      adjustedUpperCents: adjusted.upperCents,
    };
  }
  return json({ entries: listValuationHistory(id), pendingSuggestion });
});
