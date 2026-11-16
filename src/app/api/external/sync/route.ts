import { NextResponse } from "next/server";
import {
  getLatestExternalSnapshot,
  insertExternalSnapshot,
} from "@/db/queries/cockpit";
import { internalErrorResponse } from "@/lib/api/http";
import { fetchFinanzCockpitSummary } from "@/lib/integrations/finanz-cockpit-client";

export const dynamic = "force-dynamic";

export async function POST(): Promise<Response> {
  try {
    const result = await fetchFinanzCockpitSummary();

    if (result.ok) {
      const snapshot = insertExternalSnapshot(result.data);
      return NextResponse.json(
        {
          status: "synced",
          snapshot,
          message: "finanz_cockpit erfolgreich synchronisiert.",
        },
        { status: 200 },
      );
    }

    const fallbackSnapshot = getLatestExternalSnapshot();
    const isConfigIssue =
      result.code === "not_configured" || result.code === "invalid_config";
    const httpStatus = isConfigIssue ? 503 : 502;

    return NextResponse.json(
      {
        status: isConfigIssue ? "unconfigured" : "offline_fallback",
        errorCode: result.code,
        message: result.message,
        snapshot: fallbackSnapshot,
      },
      { status: httpStatus },
    );
  } catch {
    return internalErrorResponse();
  }
}
