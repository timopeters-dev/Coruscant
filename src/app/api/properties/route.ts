import { NextResponse } from "next/server";
import { createProperty, listProperties } from "@/db/queries/contracts";
import {
  internalErrorResponse,
  parseJsonBody,
  validationErrorResponse,
} from "@/lib/api/http";
import { propertyCreateSchema } from "@/lib/validation/contracts";

export const dynamic = "force-dynamic";

export async function GET(): Promise<NextResponse> {
  try {
    const properties = listProperties();
    return NextResponse.json({ properties }, { status: 200 });
  } catch {
    return internalErrorResponse();
  }
}

export async function POST(request: Request): Promise<NextResponse> {
  const body = await parseJsonBody(request);
  if (!body.ok) {
    return body.response;
  }

  const parsed = propertyCreateSchema.safeParse(body.data);
  if (!parsed.success) {
    return validationErrorResponse(parsed.error);
  }

  try {
    const property = createProperty(parsed.data);
    return NextResponse.json({ property }, { status: 201 });
  } catch {
    return internalErrorResponse();
  }
}
