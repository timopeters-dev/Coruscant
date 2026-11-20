import { NextResponse } from "next/server";
import { getTaxYearOverview } from "@/backend/db/queries/tax";
import {
  badRequestResponse,
  internalErrorResponse,
  notFoundResponse,
} from "@/backend/http";
import { buildTaxSummaryCsv, buildTaxSummaryJson } from "@/domain/tax/export";
import { buildTaxArchive, TaxExportTooLargeError } from "@/backend/storage/tax-archive";
import { parseTaxYearParam, taxExportFormatSchema } from "@/validation/tax";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const params = new URL(request.url).searchParams;
    const year = parseTaxYearParam(params.get("year"));
    if (year === null) {
      return badRequestResponse("Ungültiges Steuerjahr.", {
        year: "Bitte ein Jahr zwischen 1900 und 2100 angeben.",
      });
    }
    const format = taxExportFormatSchema.safeParse(params.get("format") ?? undefined);
    if (!format.success) {
      return badRequestResponse("Ungültiges Format.", {
        format: "Erlaubt: zip, csv, json.",
      });
    }

    const { summary, storagePathById } = getTaxYearOverview(year);
    if (summary.documentCount === 0) {
      return notFoundResponse(`Keine Belege für ${year} vorhanden.`);
    }

    const generatedAt = new Date().toISOString();
    const baseHeaders = {
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    };
    const disposition = (name: string) => `attachment; filename="${name}"`;

    if (format.data === "csv") {
      return new NextResponse(buildTaxSummaryCsv(summary), {
        status: 200,
        headers: {
          ...baseHeaders,
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": disposition(`Steuer-Uebersicht_${year}.csv`),
        },
      });
    }

    if (format.data === "json") {
      return new NextResponse(buildTaxSummaryJson(summary, { generatedAt }), {
        status: 200,
        headers: {
          ...baseHeaders,
          "Content-Type": "application/json; charset=utf-8",
          "Content-Disposition": disposition(`Steuer-Uebersicht_${year}.json`),
        },
      });
    }

    const { zip, missingFiles } = buildTaxArchive({
      summary,
      storagePathById,
      generatedAt,
    });
    return new NextResponse(new Uint8Array(zip.buffer as ArrayBuffer, zip.byteOffset, zip.byteLength), {
      status: 200,
      headers: {
        ...baseHeaders,
        "Content-Type": "application/zip",
        "Content-Disposition": disposition(`Steuer-Belegmappe_${year}.zip`),
        "X-Missing-Receipts": String(missingFiles.length),
      },
    });
  } catch (error) {
    if (error instanceof TaxExportTooLargeError) {
      return NextResponse.json({ error: error.message }, { status: 413 });
    }
    console.error("GET /api/tax/export failed:", error);
    return internalErrorResponse();
  }
}
