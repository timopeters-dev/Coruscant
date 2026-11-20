import { storeSnapshotAndSyncPots } from "@/backend/db/queries/external-pot-sync";
import { getLatestExternalSnapshot } from "@/backend/db/queries/cockpit";
import { fetchFinanzCockpitSummary, getFinanzCockpitBridgeConfig } from "@/backend/integrations/finanz-cockpit-client";
import { runBalanceSnapshotJob } from "@/backend/jobs/balance-snapshot-job";
import { summarizePotSync } from "@/domain/allocation/pot-sync";
import { evaluateSnapshotFreshness } from "@/domain/cockpit/external-sync";

export interface SyncResult {
  httpStatus: number;
  body: Record<string, unknown>;
}

const skipped = (reason: "disabled" | "fresh", message: string, snapshot = getLatestExternalSnapshot()): SyncResult => ({
  httpStatus: 200,
  body: { status: "skipped", reason, snapshot, message },
});

/**
 * Abgleich mit Bespin (`finanz_cockpit`): Snapshot holen, speichern, gekoppelte
 * Töpfe nachziehen und einen Verlaufspunkt schreiben. Im Modus `auto` nur,
 * wenn der automatische Sync aktiv und der letzte Stand veraltet ist. Ist
 * Bespin nicht erreichbar, kommt der letzte bekannte Stand zurück.
 */
export async function syncWithFinanzCockpit(mode: "manual" | "auto"): Promise<SyncResult> {
  if (mode === "auto") {
    const { syncIntervalMinutes } = getFinanzCockpitBridgeConfig();
    if (syncIntervalMinutes === 0) return skipped("disabled", "Automatischer Sync ist deaktiviert.");
    const latest = getLatestExternalSnapshot();
    const freshness = evaluateSnapshotFreshness({
      latestFetchedAt: latest?.fetchedAt ?? null,
      intervalMinutes: syncIntervalMinutes,
    });
    if (!freshness.shouldSync) return skipped("fresh", "Stand aus Bespin ist noch aktuell.", latest);
  }

  const result = await fetchFinanzCockpitSummary();
  if (!result.ok) {
    const isConfigIssue = result.code === "not_configured" || result.code === "invalid_config";
    return {
      httpStatus: isConfigIssue ? 503 : 502,
      body: {
        status: isConfigIssue ? "unconfigured" : "offline_fallback",
        errorCode: result.code,
        message: result.message,
        snapshot: getLatestExternalSnapshot(),
      },
    };
  }

  const { snapshot, outcomes } = storeSnapshotAndSyncPots(result.data);
  const historyRecorded = await runBalanceSnapshotJob({ trigger: "sync" }).then(
    (job) => job.status === "success",
    () => false,
  );
  return {
    httpStatus: 200,
    body: { status: "synced", snapshot, potSync: summarizePotSync(outcomes), historyRecorded, message: "Mit Bespin abgeglichen." },
  };
}
