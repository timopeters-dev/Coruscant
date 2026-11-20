import { and, desc, eq, gt, isNotNull, isNull, ne, or } from "drizzle-orm";
import { getDb } from "@/backend/db/connection";
import { firstRow, newId, nowIso } from "@/backend/db/helpers";
import { potAllocations, pots } from "@/backend/db/schema";
import { FieldValidationError } from "@/backend/errors";
import type { PotAllocateInput } from "@/validation/allocation";
import { selectPotsInOrder, type PotRow } from "./pots";

export type PotAllocationRow = typeof potAllocations.$inferSelect;

export interface RecentPotAllocationRow {
  id: string;
  potId: string;
  potName: string;
  amountCents: number;
  sourceLabel: string;
  allocatedAt: string;
}

export class PotNotFoundError extends FieldValidationError {
  constructor() {
    super("Mindestens ein ausgewählter Topf existiert nicht.", { allocations: "Unbekannter Topf in der Verteilung." });
  }
}

export class AllocationValidationError extends FieldValidationError {
  constructor(message: string) {
    super(message, "allocations");
  }
}

export function listRecentPotAllocations(limit = 10): RecentPotAllocationRow[] {
  return getDb()
    .select({
      id: potAllocations.id,
      potId: potAllocations.potId,
      potName: pots.name,
      amountCents: potAllocations.amountCents,
      sourceLabel: potAllocations.sourceLabel,
      allocatedAt: potAllocations.allocatedAt,
    })
    .from(potAllocations)
    .innerJoin(pots, eq(potAllocations.potId, pots.id))
    .orderBy(desc(potAllocations.allocatedAt), desc(potAllocations.id))
    .limit(limit)
    .all();
}

export interface ExecuteWaterfallAllocationResult {
  allocations: PotAllocationRow[];
  updatedPots: PotRow[];
  totalAllocatedCents: number;
  unallocatedCents: number;
  /** Gekoppelte Töpfe: nur Journaleintrag, die Überweisung erfolgt von Hand. */
  transferPlanPotIds: string[];
}

/**
 * Bucht eine bestätigte Verteilung: virtuelle Töpfe werden erhöht, für
 * gekoppelte entsteht nur ein Journaleintrag (der Stand kommt per Sync).
 */
export function executeWaterfallAllocation(input: PotAllocateInput): ExecuteWaterfallAllocationResult {
  return getDb().transaction((tx) => {
    const potById = new Map(selectPotsInOrder(tx).map((p) => [p.id, p]));
    if (input.allocations.some((entry) => !potById.has(entry.potId))) throw new PotNotFoundError();

    const total = input.allocations.reduce((sum, entry) => sum + BigInt(entry.amountCents), 0n);
    if (total > BigInt(Number.MAX_SAFE_INTEGER)) {
      throw new AllocationValidationError("Die Summe der Zuteilungen überschreitet den zulässigen Wertebereich.");
    }
    const totalAllocatedCents = Number(total);
    if (totalAllocatedCents <= 0) throw new AllocationValidationError("Mindestens ein Topf muss einen Betrag > 0 € erhalten.");
    if (totalAllocatedCents > input.inputAmountCents) {
      throw new AllocationValidationError("Die Summe der Zuteilungen darf den verfügbaren Betrag nicht überschreiten.");
    }

    const now = nowIso();
    const allocations: PotAllocationRow[] = [];
    const transferPlanPotIds: string[] = [];
    for (const entry of input.allocations) {
      if (entry.amountCents === 0) continue;
      const pot = potById.get(entry.potId)!;
      const nextCents = pot.currentCents + entry.amountCents;
      if (!Number.isSafeInteger(nextCents)) {
        throw new AllocationValidationError(`Topf-Stand überschreitet den zulässigen Wertebereich für "${pot.name}".`);
      }
      if (pot.externalLinkKind === null) {
        tx.update(pots).set({ currentCents: nextCents, updatedAt: now }).where(eq(pots.id, pot.id)).run();
      } else {
        transferPlanPotIds.push(pot.id);
      }
      const rows = tx
        .insert(potAllocations)
        .values({ id: newId(), potId: pot.id, amountCents: entry.amountCents, sourceLabel: input.sourceLabel, allocatedAt: now })
        .returning()
        .all();
      allocations.push(firstRow(rows, "pot allocation"));
    }

    return {
      allocations,
      updatedPots: selectPotsInOrder(tx),
      totalAllocatedCents,
      unallocatedCents: input.inputAmountCents - totalAllocatedCents,
      transferPlanPotIds,
    };
  });
}

/**
 * Summe der geplanten Überweisungen (Journal) je gekoppeltem Haushaltstopf,
 * die nach dem letzten Sync gebucht wurden und im Stand noch fehlen.
 */
export function getPendingTransferCentsByPotId(): Map<string, number> {
  const db = getDb();
  const linked = db
    .select({ id: pots.id, syncedAt: pots.externalSyncedAt, linkedAt: pots.externalLinkedAt })
    .from(pots)
    .where(and(isNotNull(pots.externalLinkKind), or(isNull(pots.externalLinkScope), ne(pots.externalLinkScope, "personal"))))
    .all();

  const result = new Map<string, number>();
  for (const pot of linked) {
    if (pot.syncedAt === null) continue;
    // Einträge vor dem (Neu-)Koppeln waren normale Buchungen oder betrafen ein altes Ziel.
    const windowStart = pot.linkedAt !== null && pot.linkedAt > pot.syncedAt ? pot.linkedAt : pot.syncedAt;
    const sum = db
      .select({ amountCents: potAllocations.amountCents })
      .from(potAllocations)
      .where(and(eq(potAllocations.potId, pot.id), gt(potAllocations.allocatedAt, windowStart)))
      .all()
      .reduce((acc, row) => acc + row.amountCents, 0);
    if (!Number.isSafeInteger(sum)) throw new RangeError(`Pending transfers overflow for pot ${pot.id}`);
    if (sum > 0) result.set(pot.id, sum);
  }
  return result;
}
