import { NextResponse } from "next/server";
import { z } from "zod";
import {
  getAllocationSettings,
  saveAllocationSettings,
} from "@/backend/db/queries/allocation";
import {
  internalErrorResponse,
  parseJsonBody,
  validationErrorResponse,
} from "@/backend/http";
import { allocationSettingsSchema } from "@/validation/external";

export const dynamic = "force-dynamic";

const allocationSettingsPatchSchema = allocationSettingsSchema
  .extend({
    includePropertyItems: z.boolean(),
  })
  .partial()
  .refine(
    (data) =>
      data.variableBasis !== undefined ||
      data.includeContractItems !== undefined ||
      data.includePropertyItems !== undefined,
    { message: "Mindestens ein Einstellungsfeld muss übergeben werden." },
  );

export async function GET(): Promise<Response> {
  try {
    const settings = getAllocationSettings();
    return NextResponse.json(settings, { status: 200 });
  } catch {
    return internalErrorResponse();
  }
}

export async function PATCH(request: Request): Promise<Response> {
  try {
    const bodyResult = await parseJsonBody(request);
    if (!bodyResult.ok) {
      return bodyResult.response;
    }

    const parsed = allocationSettingsPatchSchema.safeParse(bodyResult.data);
    if (!parsed.success) {
      return validationErrorResponse(parsed.error);
    }

    const updated = saveAllocationSettings(parsed.data);
    return NextResponse.json(updated, { status: 200 });
  } catch {
    return internalErrorResponse();
  }
}
