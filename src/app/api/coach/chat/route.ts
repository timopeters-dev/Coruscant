import { json, readJson, route } from "@/backend/http";
import { chatWithCoach } from "@/backend/services/investment-coach";
import { coachChatRequestSchema } from "@/validation/coach";

export const dynamic = "force-dynamic";

export const POST = route(async (request) => json(await chatWithCoach(await readJson(request, coachChatRequestSchema))));
