import { assertPotTargetDateInWindow, createPot, listPots } from "@/backend/db/queries/pots";
import { listRecentPotAllocations } from "@/backend/db/queries/pot-allocations";
import { json, readJson, route } from "@/backend/http";
import { potCreateSchema } from "@/validation/allocation";

export const dynamic = "force-dynamic";

export const GET = route(() => json({ pots: listPots(), recentAllocations: listRecentPotAllocations(10) }));

export const POST = route(async (request) => {
  const input = await readJson(request, potCreateSchema);
  assertPotTargetDateInWindow(input.targetDate);
  return json({ pot: createPot(input) }, 201);
});
