import { ZodError } from "zod";
import { deleteContract, getContractById, updateContract } from "@/backend/db/queries/contracts";
import { NotFoundError } from "@/backend/errors";
import { json, readJson, route, validationError, type RouteContext } from "@/backend/http";
import { contractUpdateSchema } from "@/validation/contracts";

export const dynamic = "force-dynamic";

const notFound = () => new NotFoundError("Vertrag nicht gefunden.");

export const GET = route(async (_request, { params }: RouteContext) => {
  const contract = getContractById((await params).id);
  if (!contract) throw notFound();
  return json({ contract });
});

export const PATCH = route(async (request, { params }: RouteContext) => {
  const patch = await readJson(request, contractUpdateSchema);
  let contract;
  try {
    contract = updateContract((await params).id, patch);
  } catch (error) {
    // Regeln, die erst am zusammengeführten Datensatz greifen (z. B. negative
    // Restschuld nach Wechsel Bausparvertrag -> Darlehen), sind Eingabefehler.
    if (error instanceof ZodError) throw validationError(error);
    throw error;
  }
  if (!contract) throw notFound();
  return json({ contract });
});

export const DELETE = route(async (_request, { params }: RouteContext) => {
  const deletedId = deleteContract((await params).id);
  if (!deletedId) throw notFound();
  return json({ deletedId });
});
