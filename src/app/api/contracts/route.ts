import { NextResponse } from "next/server";
import {
  createContract,
  LinkedPropertyNotFoundError,
  listContracts,
} from "@/db/queries/contracts";
import {
  badRequestResponse,
  internalErrorResponse,
  parseJsonBody,
  validationErrorResponse,
} from "@/lib/api/http";
import { contractCreateSchema } from "@/lib/validation/contracts";

export const dynamic = "force-dynamic";

export async function GET(): Promise<NextResponse> {
  try {
    const contracts = listContracts();
    return NextResponse.json({ contracts }, { status: 200 });
  } catch {
    return internalErrorResponse();
  }
}

export async function POST(request: Request): Promise<NextResponse> {
  const body = await parseJsonBody(request);
  if (!body.ok) {
    return body.response;
  }

  const parsed = contractCreateSchema.safeParse(body.data);
  if (!parsed.success) {
    return validationErrorResponse(parsed.error);
  }

  try {
    const contract = createContract(parsed.data);
    return NextResponse.json({ contract }, { status: 201 });
  } catch (error) {
    if (error instanceof LinkedPropertyNotFoundError) {
      return badRequestResponse("Verknüpfte Immobilie existiert nicht.", {
        linkedPropertyId: "Unbekannte Immobilie.",
      });
    }
    return internalErrorResponse();
  }
}
