import {
  deleteManualCashflowItem,
  getCashflowItemById,
  updateManualCashflowItem,
} from "@/backend/db/queries/allocation";
import { NotFoundError } from "@/backend/errors";
import { json, readJson, route, type RouteContext } from "@/backend/http";
import { cashflowUpdateSchema } from "@/validation/allocation";

export const dynamic = "force-dynamic";

const notFound = () => new NotFoundError("Cashflow-Position nicht gefunden.");

export const GET = route(async (_request, { params }: RouteContext) => {
  const item = getCashflowItemById((await params).id);
  if (!item) throw notFound();
  return json({ item });
});

export const PATCH = route(async (request, { params }: RouteContext) => {
  const patch = await readJson(request, cashflowUpdateSchema);
  const item = updateManualCashflowItem((await params).id, patch);
  if (!item) throw notFound();
  return json({ item });
});

export const DELETE = route(async (_request, { params }: RouteContext) => {
  const deletedId = deleteManualCashflowItem((await params).id);
  if (!deletedId) throw notFound();
  return json({ deletedId });
});
