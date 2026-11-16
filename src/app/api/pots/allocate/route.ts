import { NextResponse } from "next/server";
import {
  AllocationValidationError,
  executeWaterfallAllocation,
  PotNotFoundError,
} from "@/db/queries/allocation";
import {
  badRequestResponse,
  internalErrorResponse,
  parseJsonBody,
  validationErrorResponse,
} from "@/lib/api/http";
import { potAllocateSchema } from "@/lib/validation/allocation";

export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<NextResponse> {
  const body = await parseJsonBody(request);
  if (!body.ok) {
    return body.response;
  }

  const parsed = potAllocateSchema.safeParse(body.data);
  if (!parsed.success) {
    return validationErrorResponse(parsed.error);
  }

  try {
    const result = executeWaterfallAllocation(parsed.data);
    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    if (error instanceof PotNotFoundError) {
      return badRequestResponse(
        "Mindestens ein ausgewählter Topf existiert nicht.",
        { allocations: "Unbekannter Topf in der Verteilung." },
      );
    }
    if (error instanceof AllocationValidationError) {
      return badRequestResponse(error.message, {
        allocations: error.message,
      });
    }
    return internalErrorResponse();
  }
}
