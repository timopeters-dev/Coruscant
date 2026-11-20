import { verifyDocumentAndOptionallyCalibrate } from "@/backend/db/queries/documents";
import { json, readJson, route, type RouteContext } from "@/backend/http";
import { getTodayIsoDate } from "@/domain/core/date";
import { documentVerifySchema } from "@/validation/documents";

export const dynamic = "force-dynamic";

export const POST = route(async (request, { params }: RouteContext) => {
  const { id } = await params;
  const input = await readJson(request, documentVerifySchema);
  return json(verifyDocumentAndOptionallyCalibrate(id, input, getTodayIsoDate()));
});
