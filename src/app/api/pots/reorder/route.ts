import { NextResponse } from "next/server";
import { InvalidPotOrderError, reorderPots } from "@/backend/db/queries/allocation";
import {
  badRequestResponse,
  internalErrorResponse,
  parseJsonBody,
  validationErrorResponse,
} from "@/backend/http";
import { potReorderSchema } from "@/validation/allocation";

export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<NextResponse> {
  const body = await parseJsonBody(request);
  if (!body.ok) {
    return body.response;
  }

  const parsed = potReorderSchema.safeParse(body.data);
  if (!parsed.success) {
    return validationErrorResponse(parsed.error);
  }

  try {
    const pots = reorderPots(parsed.data.orderedPotIds);
    return NextResponse.json({ pots }, { status: 200 });
  } catch (error) {
    if (error instanceof InvalidPotOrderError) {
      return badRequestResponse(error.message, {
        orderedPotIds: error.message,
      });
    }
    return internalErrorResponse();
  }
}
