import { NextResponse } from "next/server";
import {
  deleteManualCashflowItem,
  getCashflowItemById,
  NonManualCashflowItemError,
  updateManualCashflowItem,
} from "@/backend/db/queries/allocation";
import {
  badRequestResponse,
  internalErrorResponse,
  notFoundResponse,
  parseJsonBody,
  validationErrorResponse,
} from "@/backend/http";
import { cashflowUpdateSchema } from "@/validation/allocation";

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
    const item = getCashflowItemById(id);
    if (!item) {
      return notFoundResponse("Cashflow-Position nicht gefunden.");
    }
    return NextResponse.json({ item }, { status: 200 });
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

  const parsed = cashflowUpdateSchema.safeParse(body.data);
  if (!parsed.success) {
    return validationErrorResponse(parsed.error);
  }

  try {
    const { id } = await context.params;
    const item = updateManualCashflowItem(id, parsed.data);
    if (!item) {
      return notFoundResponse("Cashflow-Position nicht gefunden.");
    }
    return NextResponse.json({ item }, { status: 200 });
  } catch (error) {
    if (error instanceof NonManualCashflowItemError) {
      return badRequestResponse(
        "Nur manuelle Cashflow-Positionen können bearbeitet werden.",
      );
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
    const deletedId = deleteManualCashflowItem(id);
    if (!deletedId) {
      return notFoundResponse("Cashflow-Position nicht gefunden.");
    }
    return NextResponse.json({ deletedId }, { status: 200 });
  } catch (error) {
    if (error instanceof NonManualCashflowItemError) {
      return badRequestResponse(
        "Nur manuelle Cashflow-Positionen können gelöscht werden.",
      );
    }
    return internalErrorResponse();
  }
}
