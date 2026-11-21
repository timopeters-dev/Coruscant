import { json, route, type RouteContext } from "@/backend/http";
import { analyzeDocument } from "@/backend/services/document-intake";

export const dynamic = "force-dynamic";

export const POST = route(async (_request, { params }: RouteContext) => json(await analyzeDocument((await params).id)));
