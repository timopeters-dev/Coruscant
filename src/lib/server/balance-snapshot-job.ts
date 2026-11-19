import {
  type BalanceSnapshotTrigger,
  upsertBalanceSnapshot,
} from "@/db/queries/balance-history";
import { loadHouseholdBalance } from "@/db/queries/cockpit";
import { buildBalanceSnapshotRecord } from "@/lib/domain/balance-history";
import { getBerlinClockSnapshot } from "./berlin-clock";
import type { JobRunSummary } from "./property-valuation-job";

function formatDateDE(isoDate: string): string {
  const [y, m, d] = isoDate.split("-");
  return `${d}.${m}.${y}`;
}

export async function runBalanceSnapshotJob(opts: {
  now?: Date;
  trigger: BalanceSnapshotTrigger;
}): Promise<JobRunSummary> {
  const now = opts.now ?? new Date();
  try {
    const dateKey = getBerlinClockSnapshot(now).dateKey;
    const { balance, projectedContractsCount } = loadHouseholdBalance(dateKey);
    const record = buildBalanceSnapshotRecord(balance, {
      projectedContractsCount,
    });

    if (!record) {
      return {
        status: "skipped",
        message: "Noch keine Bilanzdaten.",
        processed: 0,
        written: 0,
        historyOnly: 0,
        failed: 0,
      };
    }

    const { action } = upsertBalanceSnapshot(record, {
      trigger: opts.trigger,
      capturedAt: now.toISOString(),
    });

    const verb = action === "inserted" ? "gespeichert" : "aktualisiert";
    return {
      status: "success",
      message: `Momentaufnahme ${formatDateDE(dateKey)} ${verb}.`,
      processed: 1,
      written: 1,
      historyOnly: 0,
      failed: 0,
    };
  } catch (error) {
    return {
      status: "error",
      message:
        error instanceof Error ? error.message : "Unbekannter Fehler.",
      processed: 1,
      written: 0,
      historyOnly: 0,
      failed: 1,
    };
  }
}
