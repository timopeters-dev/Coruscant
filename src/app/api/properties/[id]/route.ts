import { NextResponse } from "next/server";
import {
  deleteProperty,
  getPropertyById,
  updateProperty,
} from "@/db/queries/contracts";
import {
  internalErrorResponse,
  notFoundResponse,
  parseJsonBody,
  validationErrorResponse,
} from "@/lib/api/http";
import { propertyUpdateSchema } from "@/lib/validation/contracts";

export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function GET(
  _request: Request,
  context: RouteContext,
): Promise<NextResponse> {
  try {
    const { id } = await context.params;
    const property = getPropertyById(id);
    if (!property) {
      return notFoundResponse("Immobilie nicht gefunden.");
    }
    return NextResponse.json({ property }, { status: 200 });
  } catch {
    return internalErrorResponse();
  }
}

export async function PATCH(
  request: Request,
  context: RouteContext,
): Promise<NextResponse> {
  const body = await parseJsonBody(request);
  if (!body.ok) {
    return body.response;
  }

  const parsed = propertyUpdateSchema.safeParse(body.data);
  if (!parsed.success) {
    return validationErrorResponse(parsed.error);
  }

  try {
    const { id } = await context.params;
    const property = updateProperty(id, parsed.data);
    if (!property) {
      return notFoundResponse("Immobilie nicht gefunden.");
    }
    return NextResponse.json({ property }, { status: 200 });
  } catch {
    return internalErrorResponse();
  }
}

export async function DELETE(
  _request: Request,
  context: RouteContext,
): Promise<NextResponse> {
  try {
    const { id } = await context.params;
    const deletedId = deleteProperty(id);
    if (!deletedId) {
      return notFoundResponse("Immobilie nicht gefunden.");
    }
    return NextResponse.json({ deletedId }, { status: 200 });
  } catch {
    return internalErrorResponse();
  }
}
