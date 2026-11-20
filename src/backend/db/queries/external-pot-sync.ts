import { and, asc, eq, isNotNull } from "drizzle-orm";
import { getDb } from "@/backend/db/connection";
import { nowIso, type DbTx } from "@/backend/db/helpers";
import { pots, type ExternalSnapshotRow } from "@/backend/db/schema";
import { computePotSyncPlan, type PotSyncOutcome } from "@/domain/allocation/pot-sync";
import type { FinanzCockpitSummary } from "@/validation/external";
import { insertExternalSnapshot, parseSnapshotAccounts, parseSnapshotPositions } from "./external-snapshots";

/**
 * Überträgt einen frisch gespeicherten Bespin-Snapshot auf alle gekoppelten
 * Töpfe. Virtuelle Töpfe bleiben unberührt; fehlt ein Ziel, bleibt der
 * zuletzt geeichte Stand stehen.
 */
function applyPotSyncInTx(tx: DbTx, snapshot: ExternalSnapshotRow): PotSyncOutcome[] {
  const linkedPots = tx.select().from(pots).where(isNotNull(pots.externalLinkKind)).orderBy(asc(pots.priority), asc(pots.id)).all();
  const outcomes = computePotSyncPlan({
    pots: linkedPots,
    accounts: parseSnapshotAccounts(snapshot),
    positions: parseSnapshotPositions(snapshot),
  });

  const now = nowIso();
  for (const outcome of outcomes) {
    const where = and(eq(pots.id, outcome.potId), isNotNull(pots.externalLinkKind));
    switch (outcome.status) {
      case "link_missing":
      case "link_conflict":
        break;
      case "link_out_of_scope":
        // Stand und Sync-Zeit bleiben eingefroren; nur der Scope wird vermerkt.
        tx.update(pots).set({ externalLinkScope: "personal" }).where(where).run();
        break;
      case "updated":
        tx.update(pots)
          .set({
            currentCents: outcome.nextCents,
            externalLinkScope: outcome.scope,
            externalSyncedAt: outcome.asOf ?? snapshot.fetchedAt,
            updatedAt: now,
          })
          .where(where)
          .run();
        break;
      case "unchanged":
        tx.update(pots).set({ externalLinkScope: outcome.scope, externalSyncedAt: outcome.asOf ?? snapshot.fetchedAt }).where(where).run();
        break;
    }
  }
  return outcomes;
}

export function applyPotSyncFromSnapshot(snapshot: ExternalSnapshotRow): PotSyncOutcome[] {
  return getDb().transaction((tx) => applyPotSyncInTx(tx, snapshot));
}

/**
 * Speichert den Snapshot und synchronisiert die Töpfe atomar: scheitert der
 * Topf-Abgleich, wird kein Snapshot gespeichert (der nächste Sync gilt dann
 * nicht fälschlich als „aktuell“).
 */
export function storeSnapshotAndSyncPots(summary: FinanzCockpitSummary): { snapshot: ExternalSnapshotRow; outcomes: PotSyncOutcome[] } {
  return getDb().transaction((tx) => {
    const snapshot = insertExternalSnapshot(summary, tx);
    return { snapshot, outcomes: applyPotSyncInTx(tx, snapshot) };
  });
}
