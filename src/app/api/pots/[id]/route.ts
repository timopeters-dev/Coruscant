import { NextResponse } from "next/server";
import { ZodError } from "zod";
import {
  deletePot,
  getPotById,
  LinkedContractNotFoundError,
  LinkedPropertyNotFoundError,
  PotExternalLinkConflictError,
  PotExternalLinkTargetNotFoundError,
  PotLinkedBalanceReadOnlyError,
  RemainderPercentageExceededError,
  updatePot,
} from "@/db/queries/allocation";
import {
  badRequestResponse,
  internalErrorResponse,
  notFoundResponse,
  parseJsonBody,
  validationErrorResponse,
} from "@/lib/api/http";
import { getTodayIsoDate } from "@/lib/domain/date";
import {
  potUpdateSchema,
  validatePotTargetDateWindow,
} from "@/lib/validation/allocation";

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
    const pot = getPotById(id);
    if (!pot) {
      return notFoundResponse("Topf nicht gefunden.");
    }
    return NextResponse.json({ pot }, { status: 200 });
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

  const parsed = potUpdateSchema.safeParse(body.data);
  if (!parsed.success) {
    return validationErrorResponse(parsed.error);
  }

  try {
    const { id } = await context.params;
    const existing = getPotById(id);
    if (!existing) {
      return notFoundResponse("Topf nicht gefunden.");
    }

    if (
      parsed.data.targetDate !== undefined &&
      parsed.data.targetDate !== null &&
      parsed.data.targetDate !== existing.targetDate
    ) {
      const dateError = validatePotTargetDateWindow(
        parsed.data.targetDate,
        getTodayIsoDate(),
      );
      if (dateError !== null) {
        return badRequestResponse(dateError, { targetDate: dateError });
      }
    }

    const pot = updatePot(id, parsed.data);
    if (!pot) {
      return notFoundResponse("Topf nicht gefunden.");
    }
    return NextResponse.json({ pot }, { status: 200 });
  } catch (error) {
    if (error instanceof ZodError) {
      return validationErrorResponse(error);
    }
    if (error instanceof PotExternalLinkTargetNotFoundError) {
      return badRequestResponse(error.message, {
        externalLink: "Ziel nicht im letzten Snapshot gefunden.",
      });
    }
    if (error instanceof PotExternalLinkConflictError) {
      return NextResponse.json(
        {
          error: "Dieses Konto bzw. diese Position ist bereits gekoppelt.",
          fieldErrors: {
            externalLink: "Bereits mit einem anderen Topf gekoppelt.",
          },
        },
        { status: 409 },
      );
    }
    if (error instanceof PotLinkedBalanceReadOnlyError) {
      return badRequestResponse(error.message, {
        currentCents: "Wird beim Sync aus finanz_cockpit übernommen.",
      });
    }
    if (error instanceof LinkedPropertyNotFoundError) {
      return badRequestResponse("Verknüpfte Immobilie existiert nicht.", {
        linkedPropertyId: "Unbekannte Immobilie.",
      });
    }
    if (error instanceof LinkedContractNotFoundError) {
      return badRequestResponse("Verknüpfter Vertrag existiert nicht.", {
        linkedContractId: "Unbekannter Vertrag.",
      });
    }
    if (error instanceof RemainderPercentageExceededError) {
      return badRequestResponse(
        `Die Summe aller Rest-Prozentsätze darf 100 % nicht überschreiten (noch verfügbar: ${error.availablePercentage} %).`,
        {
          remainderPercentage: `Maximal noch ${error.availablePercentage} % verfügbar.`,
        },
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
    const deletedId = deletePot(id);
    if (!deletedId) {
      return notFoundResponse("Topf nicht gefunden.");
    }
    return NextResponse.json({ deletedId }, { status: 200 });
  } catch {
    return internalErrorResponse();
  }
}
