import { NextResponse } from "next/server";
import {
  deleteProperty,
  getPropertyById,
  MaintenancePotValidationError,
  PropertyValidationError,
  RentalProfileValidationError,
  serializePropertyForApi,
  updateProperty,
} from "@/backend/db/queries/contracts";
import {
  badRequestResponse,
  internalErrorResponse,
  notFoundResponse,
  parseJsonBody,
  validationErrorResponse,
} from "@/backend/http";
import { deletePropertyImageIfExists } from "@/backend/storage/property-image-storage";
import { propertyUpdateSchema } from "@/validation/contracts";

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
    return NextResponse.json(
      { property: serializePropertyForApi(property) },
      { status: 200 },
    );
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
    return NextResponse.json(
      { property: serializePropertyForApi(property) },
      { status: 200 },
    );
  } catch (error) {
    if (
      error instanceof RentalProfileValidationError ||
      error instanceof MaintenancePotValidationError ||
      error instanceof PropertyValidationError
    ) {
      return badRequestResponse(error.message, error.fieldErrors);
    }
    return internalErrorResponse();
  }
}

export async function DELETE(
  _request: Request,
  context: RouteContext,
): Promise<NextResponse> {
  try {
    const { id } = await context.params;
    const deleted = deleteProperty(id);
    if (!deleted) {
      return notFoundResponse("Immobilie nicht gefunden.");
    }
    if (deleted.imagePath) {
      try {
        deletePropertyImageIfExists(deleted.imagePath);
      } catch {
        // Best-effort cleanup after DB delete
      }
    }
    return NextResponse.json({ deletedId: deleted.id }, { status: 200 });
  } catch {
    return internalErrorResponse();
  }
}
