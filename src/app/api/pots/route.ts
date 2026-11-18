import { NextResponse } from "next/server";
import {
  createPot,
  LinkedContractNotFoundError,
  LinkedPropertyNotFoundError,
  PotExternalLinkConflictError,
  PotExternalLinkOutOfScopeError,
  PotExternalLinkTargetNotFoundError,
  listPots,
  listRecentPotAllocations,
  RemainderPercentageExceededError,
} from "@/db/queries/allocation";
import {
  badRequestResponse,
  internalErrorResponse,
  parseJsonBody,
  validationErrorResponse,
} from "@/lib/api/http";
import { getTodayIsoDate } from "@/lib/domain/date";
import {
  potCreateSchema,
  validatePotTargetDateWindow,
} from "@/lib/validation/allocation";

export const dynamic = "force-dynamic";

export async function GET(): Promise<NextResponse> {
  try {
    const pots = listPots();
    const recentAllocations = listRecentPotAllocations(10);
    return NextResponse.json({ pots, recentAllocations }, { status: 200 });
  } catch {
    return internalErrorResponse();
  }
}

export async function POST(request: Request): Promise<NextResponse> {
  const body = await parseJsonBody(request);
  if (!body.ok) {
    return body.response;
  }

  const parsed = potCreateSchema.safeParse(body.data);
  if (!parsed.success) {
    return validationErrorResponse(parsed.error);
  }

  if (parsed.data.targetDate !== null) {
    const dateError = validatePotTargetDateWindow(
      parsed.data.targetDate,
      getTodayIsoDate(),
    );
    if (dateError !== null) {
      return badRequestResponse(dateError, { targetDate: dateError });
    }
  }

  try {
    const pot = createPot(parsed.data);
    return NextResponse.json({ pot }, { status: 201 });
  } catch (error) {
    if (error instanceof PotExternalLinkTargetNotFoundError) {
      return badRequestResponse(error.message, {
        externalLink: "Ziel nicht im letzten Snapshot gefunden.",
      });
    }
    if (error instanceof PotExternalLinkOutOfScopeError) {
      return badRequestResponse(error.message, {
        externalLink: "Nur Haushalts-Konten können gekoppelt werden.",
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
