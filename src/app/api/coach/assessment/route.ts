import { json, readJson, route } from "@/backend/http";
import { assessPortfolio } from "@/backend/services/investment-coach";
import { coachAssessmentRequestSchema } from "@/validation/coach";

export const dynamic = "force-dynamic";

export const POST = route(async (request) => json(await assessPortfolio(await readJson(request, coachAssessmentRequestSchema))));
