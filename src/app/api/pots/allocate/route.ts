import { executeWaterfallAllocation } from "@/backend/db/queries/pot-allocations";
import { json, readJson, route } from "@/backend/http";
import { potAllocateSchema } from "@/validation/allocation";

export const dynamic = "force-dynamic";

export const POST = route(async (request) =>
  json(executeWaterfallAllocation(await readJson(request, potAllocateSchema)), 201),
);
