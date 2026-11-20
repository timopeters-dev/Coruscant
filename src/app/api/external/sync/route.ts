import { json, readJson, route } from "@/backend/http";
import { syncWithFinanzCockpit } from "@/backend/services/external-sync";
import { externalSyncRequestSchema } from "@/validation/external";

export const dynamic = "force-dynamic";

/** Leerer Body = manueller Sync. */
export const POST = route(async (request) => {
  const { mode } = await readJson(request, externalSyncRequestSchema, { emptyBody: {} });
  const { httpStatus, body } = await syncWithFinanzCockpit(mode);
  return json(body, httpStatus);
});
