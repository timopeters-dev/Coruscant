import { NextResponse } from "next/server";
import {
  createContractFromDocument,
  DocumentAlreadyLinkedError,
  DocumentLinkedEntityNotFoundError,
  DocumentNotFoundError,
  DocumentValidationError,
} from "@/db/queries/documents";
import {
  badRequestResponse,
  internalErrorResponse,
  notFoundResponse,
  parseJsonBody,
  validationErrorResponse,
} from "@/lib/api/http";
import { documentCreateContractSchema } from "@/lib/validation/documents";

export const dynamic = "force-dynamic";

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await context.params;
    const body = await parseJsonBody(request);
    if (!body.ok) {
      return body.response;
    }

    const parsed = documentCreateContractSchema.safeParse(body.data);
    if (!parsed.success) {
      return validationErrorResponse(parsed.error);
    }

    const result = createContractFromDocument(id, parsed.data);
    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    if (error instanceof DocumentNotFoundError) {
      return notFoundResponse(error.message);
    }
    if (error instanceof DocumentAlreadyLinkedError) {
      return NextResponse.json(
        {
          error: error.message,
          linkedContractId: error.linkedContractId,
        },
        { status: 409 },
      );
    }
    if (error instanceof DocumentLinkedEntityNotFoundError) {
      return badRequestResponse(error.message, {
        [error.field]: error.message,
      });
    }
    if (error instanceof DocumentValidationError) {
      return badRequestResponse(error.message, {
        [error.field]: error.message,
      });
    }
    console.error("POST /api/documents/[id]/create-contract failed:", error);
    return internalErrorResponse();
  }
}
