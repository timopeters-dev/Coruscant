import { NextResponse } from "next/server";
import {
  ContractCalibrationConflictError,
  DocumentLinkedEntityNotFoundError,
  DocumentNotFoundError,
  DocumentValidationError,
  verifyDocumentAndOptionallyCalibrate,
} from "@/db/queries/documents";
import {
  badRequestResponse,
  internalErrorResponse,
  notFoundResponse,
  parseJsonBody,
  validationErrorResponse,
} from "@/lib/api/http";
import { getTodayIsoDate } from "@/lib/domain/date";
import { documentVerifySchema } from "@/lib/validation/documents";

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

    const parsed = documentVerifySchema.safeParse(body.data);
    if (!parsed.success) {
      return validationErrorResponse(parsed.error);
    }

    const result = verifyDocumentAndOptionallyCalibrate(
      id,
      parsed.data,
      getTodayIsoDate(),
    );

    return NextResponse.json(result, { status: 200 });
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
    if (error instanceof ContractCalibrationConflictError) {
      return NextResponse.json(
        {
          error: error.message,
          code: "calibration_date_conflict",
          evaluation: error.evaluation,
          previousAsOfDate: error.evaluation.previousAsOfDate,
          effectiveDate: error.evaluation.effectiveDate,
        },
        { status: 409 },
      );
    }
    console.error("POST /api/documents/[id]/verify failed:", error);
    return internalErrorResponse();
  }
}
