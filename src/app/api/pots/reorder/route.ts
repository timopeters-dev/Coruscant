import { reorderPots } from "@/backend/db/queries/pots";
import { json, readJson, route } from "@/backend/http";
import { potReorderSchema } from "@/validation/allocation";

export const dynamic = "force-dynamic";

export const POST = route(async (request) => {
  const { orderedPotIds } = await readJson(request, potReorderSchema);
  return json({ pots: reorderPots(orderedPotIds) });
});
