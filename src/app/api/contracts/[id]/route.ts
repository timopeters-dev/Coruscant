import { NextResponse } from "next/server";
import { ZodError } from "zod";
import {
  deleteContract,
  getContractById,
  LinkedPropertyNotFoundError,
  updateContract,
} from "@/db/queries/contracts";
import {
  badRequestResponse,
  internalErrorResponse,
  notFoundResponse,
  parseJsonBody,
  validationErrorResponse,
} from "@/lib/api/http";
import { contractUpdateSchema } from "@/lib/validation/contracts";

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
    const contract = getContractById(id);
    if (!contract) {
      return notFoundResponse("Vertrag nicht gefunden.");
    }
    return NextResponse.json({ contract }, { status: 200 });
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

  const parsed = contractUpdateSchema.safeParse(body.data);
  if (!parsed.success) {
    return validationErrorResponse(parsed.error);
  }

  try {
    const { id } = await context.params;
    const contract = updateContract(id, parsed.data);
    if (!contract) {
      return notFoundResponse("Vertrag nicht gefunden.");
    }
    return NextResponse.json({ contract }, { status: 200 });
  } catch (error) {
    if (error instanceof LinkedPropertyNotFoundError) {
      return badRequestResponse("Verknüpfte Immobilie existiert nicht.", {
        linkedPropertyId: "Unbekannte Immobilie.",
      });
    }
    // Regeln, die erst am zusammengeführten Datensatz greifen (z. B. negative
    // Restschuld nach Wechsel Bausparvertrag -> Darlehen), als 400 melden.
    if (error instanceof ZodError) {
      return validationErrorResponse(error);
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
    const deletedId = deleteContract(id);
    if (!deletedId) {
      return notFoundResponse("Vertrag nicht gefunden.");
    }
    return NextResponse.json({ deletedId }, { status: 200 });
  } catch {
    return internalErrorResponse();
  }
}
