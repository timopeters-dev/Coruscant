import { NextResponse } from "next/server";
import { getTaxYearOverview } from "@/backend/db/queries/tax";
import { badRequestResponse, internalErrorResponse } from "@/backend/http";
import { parseTaxYearParam } from "@/validation/tax";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const year = parseTaxYearParam(new URL(request.url).searchParams.get("year"));
    if (year === null) {
      return badRequestResponse("Ungültiges Steuerjahr.", {
        year: "Bitte ein Jahr zwischen 1900 und 2100 angeben.",
      });
    }

    const { summary, availableYears } = getTaxYearOverview(year);
    return NextResponse.json(
      { summary, availableYears },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (error) {
    console.error("GET /api/tax/summary failed:", error);
    return internalErrorResponse();
  }
}
