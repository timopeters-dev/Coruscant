import { ZodError } from "zod";
import {
  assertPotTargetDateInWindow,
  deletePot,
  getPotById,
  updatePot,
} from "@/backend/db/queries/allocation";
import { NotFoundError } from "@/backend/errors";
import { json, readJson, route, validationError, type RouteContext } from "@/backend/http";
import { potUpdateSchema } from "@/validation/allocation";

export const dynamic = "force-dynamic";

const notFound = () => new NotFoundError("Topf nicht gefunden.");

export const GET = route(async (_request, { params }: RouteContext) => {
  const pot = getPotById((await params).id);
  if (!pot) throw notFound();
  return json({ pot });
});

export const PATCH = route(async (request, { params }: RouteContext) => {
  const patch = await readJson(request, potUpdateSchema);
  const { id } = await params;
  const existing = getPotById(id);
  if (!existing) throw notFound();
  if (patch.targetDate !== existing.targetDate) assertPotTargetDateInWindow(patch.targetDate);

  let pot;
  try {
    pot = updatePot(id, patch);
  } catch (error) {
    if (error instanceof ZodError) throw validationError(error);
    throw error;
  }
  if (!pot) throw notFound();
  return json({ pot });
});

export const DELETE = route(async (_request, { params }: RouteContext) => {
  const deletedId = deletePot((await params).id);
  if (!deletedId) throw notFound();
  return json({ deletedId });
});
