import { NextResponse } from "next/server";
import {
  deleteDocumentRecord,
  DocumentLinkedEntityNotFoundError,
  DocumentNotFoundError,
  DocumentValidationError,
  updateDocumentRecord,
} from "@/backend/db/queries/documents";
import {
  badRequestResponse,
  internalErrorResponse,
  notFoundResponse,
  parseJsonBody,
  validationErrorResponse,
} from "@/backend/http";
import { deletePdfFileIfExists } from "@/backend/storage/pdf-storage";
import { documentUpdateSchema } from "@/validation/documents";

export const dynamic = "force-dynamic";

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await context.params;
    const body = await parseJsonBody(request);
    if (!body.ok) {
      return body.response;
    }

    const parsed = documentUpdateSchema.safeParse(body.data);
    if (!parsed.success) {
      return validationErrorResponse(parsed.error);
    }

    const updated = updateDocumentRecord(id, parsed.data);
    return NextResponse.json({ document: updated }, { status: 200 });
  } catch (error) {
    if (error instanceof DocumentNotFoundError) {
      return notFoundResponse(error.message);
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
    console.error("PATCH /api/documents/[id] failed:", error);
    return internalErrorResponse();
  }
}

export async function DELETE(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await context.params;
    const deleted = deleteDocumentRecord(id);
    deletePdfFileIfExists(deleted.storagePath);
    return NextResponse.json({ deletedId: deleted.id }, { status: 200 });
  } catch (error) {
    if (error instanceof DocumentNotFoundError) {
      return notFoundResponse(error.message);
    }
    console.error("DELETE /api/documents/[id] failed:", error);
    return internalErrorResponse();
  }
}
