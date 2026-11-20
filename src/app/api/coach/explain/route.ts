import { json, readJson, route } from "@/backend/http";
import { explainRecommendation } from "@/backend/services/investment-coach";
import { explainRequestSchema } from "@/validation/recommendation";

export const dynamic = "force-dynamic";

export const POST = route(async (request) => json(await explainRecommendation(await readJson(request, explainRequestSchema))));
