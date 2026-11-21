import { z } from "zod";

export const taxYearParamSchema = z.coerce.number().int().min(1900).max(2100);
export const taxExportFormatSchema = z.enum(["zip", "csv", "json"]).default("zip");

/** `""`/fehlend darf nicht per `z.coerce` zu 0 werden. */
export function parseTaxYearParam(raw: string | null | undefined): number | null {
  if (raw === null || raw === undefined || raw.trim() === "") return null;
  const parsed = taxYearParamSchema.safeParse(raw.trim());
  return parsed.success ? parsed.data : null;
}
