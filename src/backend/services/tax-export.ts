import { getTaxYearOverview } from "@/backend/db/queries/tax";
import { FieldValidationError, NotFoundError } from "@/backend/errors";
import { buildTaxArchive } from "@/backend/storage/tax-archive";
import { buildTaxSummaryCsv, buildTaxSummaryJson } from "@/domain/tax/export";
import { parseTaxYearParam, taxExportFormatSchema } from "@/validation/tax";

/** Steuerjahr aus `?year=`; ungültig oder fehlend → 400. */
export function requireTaxYear(request: Request): number {
  const year = parseTaxYearParam(new URL(request.url).searchParams.get("year"));
  if (year === null) {
    throw new FieldValidationError("Ungültiges Steuerjahr.", { year: "Bitte ein Jahr zwischen 1900 und 2100 angeben." });
  }
  return year;
}

export interface TaxExportFile {
  body: Uint8Array | string;
  contentType: string;
  filename: string;
  headers?: Record<string, string>;
}

/** Export eines Steuerjahres als ZIP-Belegmappe, CSV oder JSON (`?format=`). */
export function exportTaxYear(request: Request): TaxExportFile {
  const year = requireTaxYear(request);
  const format = taxExportFormatSchema.safeParse(new URL(request.url).searchParams.get("format") ?? undefined);
  if (!format.success) throw new FieldValidationError("Ungültiges Format.", { format: "Erlaubt: zip, csv, json." });

  const { summary, storagePathById } = getTaxYearOverview(year);
  if (summary.documentCount === 0) throw new NotFoundError(`Keine Belege für ${year} vorhanden.`);

  const generatedAt = new Date().toISOString();
  switch (format.data) {
    case "csv":
      return { body: buildTaxSummaryCsv(summary), contentType: "text/csv; charset=utf-8", filename: `Steuer-Uebersicht_${year}.csv` };
    case "json":
      return {
        body: buildTaxSummaryJson(summary, { generatedAt }),
        contentType: "application/json; charset=utf-8",
        filename: `Steuer-Uebersicht_${year}.json`,
      };
    case "zip": {
      const { zip, missingFiles } = buildTaxArchive({ summary, storagePathById, generatedAt });
      return {
        body: zip,
        contentType: "application/zip",
        filename: `Steuer-Belegmappe_${year}.zip`,
        headers: { "X-Missing-Receipts": String(missingFiles.length) },
      };
    }
  }
}
