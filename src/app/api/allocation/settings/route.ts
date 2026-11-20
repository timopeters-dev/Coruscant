import { z } from "zod";
import { getAllocationSettings, saveAllocationSettings } from "@/backend/db/queries/allocation-settings";
import { json, readJson, route } from "@/backend/http";
import { allocationSettingsSchema } from "@/validation/external";

export const dynamic = "force-dynamic";

const allocationSettingsPatchSchema = allocationSettingsSchema
  .extend({ includePropertyItems: z.boolean() })
  .partial()
  .refine(
    (data) =>
      data.variableBasis !== undefined ||
      data.includeContractItems !== undefined ||
      data.includePropertyItems !== undefined,
    { message: "Mindestens ein Einstellungsfeld muss übergeben werden." },
  );

export const GET = route(() => json(getAllocationSettings()));

export const PATCH = route(async (request) =>
  json(saveAllocationSettings(await readJson(request, allocationSettingsPatchSchema))),
);
