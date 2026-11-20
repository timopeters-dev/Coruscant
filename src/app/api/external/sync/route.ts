import { NextResponse } from "next/server";
import { getLatestExternalSnapshot } from "@/db/queries/cockpit";
import { storeSnapshotAndSyncPots } from "@/db/queries/allocation";
import { badRequestResponse, internalErrorResponse } from "@/lib/api/http";
import { evaluateSnapshotFreshness } from "@/lib/domain/external-sync";
import {
  fetchFinanzCockpitSummary,
  getFinanzCockpitBridgeConfig,
} from "@/lib/integrations/finanz-cockpit-client";
import { runBalanceSnapshotJob } from "@/lib/server/balance-snapshot-job";
import { externalSyncRequestSchema } from "@/lib/validation/external";

export const dynamic = "force-dynamic";

async function parseSyncMode(
  request?: Request,
): Promise<
  { ok: true; mode: "manual" | "auto" } | { ok: false; response: Response }
> {
  if (!request) {
    return { ok: true, mode: "manual" };
  }

  let rawText: string;
  try {
    rawText = await request.text();
  } catch {
    return {
      ok: false,
      response: badRequestResponse("Ungültiger Request-Body."),
    };
  }

  if (rawText.trim().length === 0) {
    return { ok: true, mode: "manual" };
  }

  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(rawText);
  } catch {
    return {
      ok: false,
      response: badRequestResponse("Ungültiger JSON-Body."),
    };
  }

  const parsed = externalSyncRequestSchema.safeParse(parsedJson);
  if (!parsed.success) {
    return {
      ok: false,
      response: badRequestResponse("Ungültiger Sync-Modus.", {
        mode: "Erlaubt sind nur 'manual' oder 'auto'.",
      }),
    };
  }

  return { ok: true, mode: parsed.data.mode };
}

export async function POST(request?: Request): Promise<Response> {
  try {
    const modeResult = await parseSyncMode(request);
    if (!modeResult.ok) {
      return modeResult.response;
    }

    if (modeResult.mode === "auto") {
      const config = getFinanzCockpitBridgeConfig();
      if (config.syncIntervalMinutes === 0) {
        return NextResponse.json(
          {
            status: "skipped",
            reason: "disabled",
            snapshot: getLatestExternalSnapshot(),
            message: "Automatischer Sync ist deaktiviert.",
          },
          { status: 200 },
        );
      }

      const latestSnapshot = getLatestExternalSnapshot();
      const freshness = evaluateSnapshotFreshness({
        latestFetchedAt: latestSnapshot?.fetchedAt ?? null,
        intervalMinutes: config.syncIntervalMinutes,
      });

      if (!freshness.shouldSync) {
        return NextResponse.json(
          {
            status: "skipped",
            reason: "fresh",
            snapshot: latestSnapshot,
            message: "Stand aus dem Haushaltsbuch ist noch aktuell.",
          },
          { status: 200 },
        );
      }
    }

    const result = await fetchFinanzCockpitSummary();

    if (result.ok) {
      const { snapshot, outcomes } = storeSnapshotAndSyncPots(result.data);
      const potSync = {
        updated: outcomes.filter((o) => o.status === "updated").length,
        unchanged: outcomes.filter((o) => o.status === "unchanged").length,
        missing: outcomes
          .filter((o) => o.status === "link_missing")
          .map((o) => o.potId),
        conflicts: outcomes
          .filter((o) => o.status === "link_conflict")
          .map((o) => o.potId),
        outOfScope: outcomes
          .filter((o) => o.status === "link_out_of_scope")
          .map((o) => o.potId),
        clamped: outcomes
          .filter(
            (o) =>
              (o.status === "updated" || o.status === "unchanged") &&
              o.clampedNegative,
          )
          .map((o) => o.potId),
      };
      let historyRecorded = false;
      try {
        const historyResult = await runBalanceSnapshotJob({ trigger: "sync" });
        historyRecorded = historyResult.status === "success";
      } catch {
        historyRecorded = false;
      }

      return NextResponse.json(
        {
          status: "synced",
          snapshot,
          potSync,
          historyRecorded,
          message: "Mit dem Haushaltsbuch abgeglichen.",
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
