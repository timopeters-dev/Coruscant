import { randomUUID } from "node:crypto";
import { asc, eq } from "drizzle-orm";
import { getDb, getSqlite } from "@/backend/db/connection";
import { balanceSnapshots } from "@/backend/db/schema";
import type { BalanceHistoryPoint } from "@/domain/cockpit/balance-history";

export type BalanceSnapshotTrigger = "sync" | "scheduler" | "startup";

/**
 * Inserts or updates the daily balance snapshot for point.date (Europe/Berlin).
 * Preserves the existing row id on conflict update.
 */
export function upsertBalanceSnapshot(
  point: BalanceHistoryPoint,
  meta: { trigger: BalanceSnapshotTrigger; capturedAt: string },
): { action: "inserted" | "updated" } {
  const db = getDb();
  const sqlite = getSqlite();

  return sqlite.transaction((): { action: "inserted" | "updated" } => {
    const existing = db
      .select({ id: balanceSnapshots.id })
      .from(balanceSnapshots)
      .where(eq(balanceSnapshots.snapshotDate, point.date))
      .get();

    db.insert(balanceSnapshots)
      .values({
        id: randomUUID(),
        snapshotDate: point.date,
        totalAssetsCents: point.totalAssetsCents,
        liabilitiesCents: point.liabilitiesCents,
        netWorthCents: point.netWorthCents,
        freeAssetsCents: point.freeAssetsCents,
        boundAssetsCents: point.boundAssetsCents,
        propertiesValueCents: point.propertiesValueCents,
        savingsContractsValueCents: point.savingsContractsValueCents,
        hasModeledValues: point.hasModeledValues,
        trigger: meta.trigger,
        capturedAt: meta.capturedAt,
      })
      .onConflictDoUpdate({
        target: balanceSnapshots.snapshotDate,
        set: {
          totalAssetsCents: point.totalAssetsCents,
          liabilitiesCents: point.liabilitiesCents,
          netWorthCents: point.netWorthCents,
          freeAssetsCents: point.freeAssetsCents,
          boundAssetsCents: point.boundAssetsCents,
          propertiesValueCents: point.propertiesValueCents,
          savingsContractsValueCents: point.savingsContractsValueCents,
          hasModeledValues: point.hasModeledValues,
          trigger: meta.trigger,
          capturedAt: meta.capturedAt,
        },
      })
      .run();

    return { action: existing ? "updated" : "inserted" };
  })();
}

/**
 * Lists all recorded daily balance snapshots ordered chronologically ascending.
 */
export function listBalanceSnapshots(): BalanceHistoryPoint[] {
  const db = getDb();
  const rows = db
    .select()
    .from(balanceSnapshots)
    .orderBy(asc(balanceSnapshots.snapshotDate))
    .all();

  return rows.map((row) => ({
    date: row.snapshotDate,
    totalAssetsCents: row.totalAssetsCents,
    liabilitiesCents: row.liabilitiesCents,
    netWorthCents: row.netWorthCents,
    freeAssetsCents: row.freeAssetsCents,
    boundAssetsCents: row.boundAssetsCents,
    propertiesValueCents: row.propertiesValueCents,
    savingsContractsValueCents: row.savingsContractsValueCents,
    hasModeledValues: Boolean(row.hasModeledValues),
  }));
}
