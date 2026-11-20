import { and, asc, eq, isNotNull, ne } from "drizzle-orm";
import { getDb } from "@/backend/db/connection";
import { firstRow, isUniqueConstraintError, mergePatch, newId, nowIso, type DbOrTx, type DbTx } from "@/backend/db/helpers";
import { financialContracts, pots, properties } from "@/backend/db/schema";
import {
  ApiError,
  FieldValidationError,
  LinkedContractNotFoundError,
  LinkedPropertyNotFoundError,
} from "@/backend/errors";
import { getTodayIsoDate } from "@/domain/core/date";
import { isHouseholdScope } from "@/domain/core/household-scope";
import { findAccountPositionOverlap, resolveExternalLinkValue } from "@/domain/allocation/pot-sync";
import {
  potCreateSchema,
  validatePotTargetDateWindow,
  type ExternalLinkInput,
  type PotCreateInput,
  type PotUpdateInput,
} from "@/validation/allocation";
import { getLatestExternalSnapshot, parseSnapshotAccounts, parseSnapshotPositions } from "./external-snapshots";

export type PotRow = typeof pots.$inferSelect;

export class RemainderPercentageExceededError extends FieldValidationError {
  constructor(readonly availablePercentage: number) {
    super(
      `Die Summe aller Rest-Prozentsätze darf 100 % nicht überschreiten (noch verfügbar: ${availablePercentage} %).`,
      { remainderPercentage: `Maximal noch ${availablePercentage} % verfügbar.` },
    );
  }
}

export class InvalidPotOrderError extends FieldValidationError {
  constructor(message = "Ungültige Topf-Reihenfolge.") {
    super(message, "orderedPotIds");
  }
}

export class PotLinkedBalanceReadOnlyError extends FieldValidationError {
  constructor() {
    super("Der Stand eines gekoppelten Topfs wird per Sync übernommen.", {
      currentCents: "Wird beim Abgleich aus Bespin übernommen.",
    });
  }
}

export class PotExternalLinkConflictError extends ApiError {
  constructor() {
    super(409, "Dieses Konto bzw. diese Position ist bereits gekoppelt.", {
      fieldErrors: { externalLink: "Bereits mit einem anderen Topf gekoppelt." },
    });
  }
}

export class PotExternalLinkTargetNotFoundError extends FieldValidationError {
  constructor() {
    super("Das Kopplungsziel ist im letzten Stand aus Bespin nicht enthalten.", {
      externalLink: "Ziel nicht im letzten Snapshot gefunden.",
    });
  }
}

export class PotExternalLinkOutOfScopeError extends FieldValidationError {
  constructor() {
    super("Nur Haushalts-Konten und -Positionen können gekoppelt werden.", {
      externalLink: "Nur Haushalts-Konten können gekoppelt werden.",
    });
  }
}

/** Neue bzw. geänderte Zieldaten müssen im erlaubten Fenster ab heute liegen. */
export function assertPotTargetDateInWindow(targetDate: string | null | undefined): void {
  if (!targetDate) return;
  const message = validatePotTargetDateWindow(targetDate, getTodayIsoDate());
  if (message !== null) throw new FieldValidationError(message, "targetDate");
}

/** Alle Töpfe in Wasserfall-Reihenfolge. */
export function selectPotsInOrder(tx: DbOrTx = getDb()): PotRow[] {
  return tx.select().from(pots).orderBy(asc(pots.priority), asc(pots.id)).all();
}

export const listPots = (): PotRow[] => selectPotsInOrder();

export function getPotById(id: string): PotRow | null {
  return getDb().select().from(pots).where(eq(pots.id, id)).get() ?? null;
}

function assertLinksExist(tx: DbTx, linkedPropertyId: string | null, linkedContractId: string | null): void {
  if (linkedPropertyId !== null && !tx.select({ id: properties.id }).from(properties).where(eq(properties.id, linkedPropertyId)).get()) {
    throw new LinkedPropertyNotFoundError();
  }
  if (
    linkedContractId !== null &&
    !tx.select({ id: financialContracts.id }).from(financialContracts).where(eq(financialContracts.id, linkedContractId)).get()
  ) {
    throw new LinkedContractNotFoundError();
  }
}

/** Die Rest-Prozentsätze aller Töpfe dürfen zusammen 100 % nicht überschreiten. */
function assertRemainderPercentageWithinLimit(tx: DbTx, input: { ruleType: string; remainderPercentage: number | null }, potId?: string): void {
  if (input.ruleType !== "percentage_of_remainder" || input.remainderPercentage === null) return;
  const others = tx
    .select({ ruleType: pots.ruleType, remainderPercentage: pots.remainderPercentage })
    .from(pots)
    .where(potId ? ne(pots.id, potId) : undefined)
    .all();
  const used = others.reduce(
    (sum, row) => (row.ruleType === "percentage_of_remainder" && row.remainderPercentage !== null ? sum + row.remainderPercentage : sum),
    0,
  );
  if (used + input.remainderPercentage > 100) throw new RemainderPercentageExceededError(Math.max(0, 100 - used));
}

interface LinkColumns {
  externalLinkKind: "account" | "position" | null;
  externalLinkRef: string | null;
  externalLinkScope: "personal" | "household" | null;
  externalSyncedAt: string | null;
  externalLinkedAt: string | null;
}

const NO_LINK: LinkColumns = {
  externalLinkKind: null,
  externalLinkRef: null,
  externalLinkScope: null,
  externalSyncedAt: null,
  externalLinkedAt: null,
};

/**
 * Kopplungsspalten für einen (neuen oder geänderten) Link samt Stand aus dem
 * letzten Snapshot. Ein neuer Link muss dort enthalten sein, im Haushalt
 * liegen und darf sich nicht mit einem anderen überschneiden (Konto vs.
 * eine seiner Positionen). Unveränderte Links behalten ihren Stand.
 */
function resolveLink(
  tx: DbTx,
  link: ExternalLinkInput | null,
  fallbackCents: number,
  existing: PotRow | null,
): LinkColumns & { currentCents: number } {
  if (!link) return { ...NO_LINK, currentCents: fallbackCents };
  if (existing && existing.externalLinkKind === link.kind && existing.externalLinkRef === link.ref) {
    const { externalLinkKind, externalLinkRef, externalLinkScope, externalSyncedAt, externalLinkedAt } = existing;
    return { externalLinkKind, externalLinkRef, externalLinkScope, externalSyncedAt, externalLinkedAt, currentCents: fallbackCents };
  }

  const snapshot = getLatestExternalSnapshot();
  if (!snapshot) throw new PotExternalLinkTargetNotFoundError();
  const positions = parseSnapshotPositions(snapshot).map(({ id, accountId, marketValueCents }) => ({ id, accountId, marketValueCents }));
  const resolved = resolveExternalLinkValue(link.kind, link.ref, parseSnapshotAccounts(snapshot), positions);
  if (!resolved) throw new PotExternalLinkTargetNotFoundError();
  if (!isHouseholdScope(resolved.scope)) throw new PotExternalLinkOutOfScopeError();

  const otherLinks = tx
    .select({ kind: pots.externalLinkKind, ref: pots.externalLinkRef })
    .from(pots)
    .where(existing ? and(isNotNull(pots.externalLinkKind), ne(pots.id, existing.id)) : isNotNull(pots.externalLinkKind))
    .all()
    .flatMap((row) => (row.kind !== null && row.ref !== null ? [{ kind: row.kind, ref: row.ref }] : []));
  if (findAccountPositionOverlap([...otherLinks, link], positions)) throw new PotExternalLinkConflictError();

  return {
    externalLinkKind: link.kind,
    externalLinkRef: link.ref,
    externalLinkScope: resolved.scope,
    externalSyncedAt: resolved.asOf ?? snapshot.fetchedAt,
    externalLinkedAt: nowIso(),
    currentCents: resolved.valueCents,
  };
}

/** Prüft Verknüpfungen und Prozent-Limit und liefert die zu schreibenden Spalten. */
function potColumns(tx: DbTx, input: PotCreateInput, existing: PotRow | null) {
  assertLinksExist(tx, input.linkedPropertyId, input.linkedContractId);
  assertRemainderPercentageWithinLimit(tx, input, existing?.id);
  const { externalLink, ...fields } = input;
  const { currentCents, ...link } = resolveLink(tx, externalLink, input.currentCents, existing);
  return { ...fields, currentCents, ...link, updatedAt: nowIso() };
}

/** Eine eindeutige Kopplung kann auch erst beim Schreiben (Unique-Index) scheitern. */
function withLinkConflict<T>(hasLink: boolean, write: () => T): T {
  try {
    return write();
  } catch (error) {
    if (hasLink && isUniqueConstraintError(error)) throw new PotExternalLinkConflictError();
    throw error;
  }
}

export function createPot(input: PotCreateInput): PotRow {
  return withLinkConflict(Boolean(input.externalLink), () =>
    getDb().transaction((tx) => {
      const maxPriority = tx.select({ priority: pots.priority }).from(pots).all().reduce((max, row) => Math.max(max, row.priority), 0);
      const rows = tx
        .insert(pots)
        .values({ id: newId(), priority: maxPriority + 1, ...potColumns(tx, input, null) })
        .returning()
        .all();
      return firstRow(rows, "pot");
    }),
  );
}

export function updatePot(id: string, patch: PotUpdateInput): PotRow | null {
  return withLinkConflict(Boolean(patch.externalLink), () =>
    getDb().transaction((tx) => {
      const existing = tx.select().from(pots).where(eq(pots.id, id)).get();
      if (!existing) return null;

      const existingLink =
        existing.externalLinkKind !== null && existing.externalLinkRef !== null
          ? { kind: existing.externalLinkKind, ref: existing.externalLinkRef }
          : null;
      const externalLink = patch.externalLink !== undefined ? patch.externalLink : existingLink;
      if (externalLink !== null && patch.currentCents !== undefined) throw new PotLinkedBalanceReadOnlyError();

      // Erst der zusammengeführte Datensatz zeigt, ob die Regel-Felder zusammenpassen.
      const merged = potCreateSchema.parse({ ...mergePatch(existing, patch), externalLink });
      const [updated] = tx.update(pots).set(potColumns(tx, merged, existing)).where(eq(pots.id, id)).returning().all();
      return updated ?? null;
    }),
  );
}

export function deletePot(id: string): string | null {
  return getDb().transaction((tx) => {
    const [deleted] = tx.delete(pots).where(eq(pots.id, id)).returning({ id: pots.id }).all();
    if (!deleted) return null;
    // Prioritäten lückenlos halten.
    const now = nowIso();
    selectPotsInOrder(tx).forEach((row, index) => {
      if (row.priority !== index + 1) tx.update(pots).set({ priority: index + 1, updatedAt: now }).where(eq(pots.id, row.id)).run();
    });
    return deleted.id;
  });
}

export function reorderPots(orderedPotIds: readonly string[]): PotRow[] {
  return getDb().transaction((tx) => {
    const existingIds = new Set(tx.select({ id: pots.id }).from(pots).all().map((p) => p.id));
    if (orderedPotIds.length !== existingIds.size) {
      throw new InvalidPotOrderError("Die Sortierliste muss alle vorhandenen Töpfe enthalten.");
    }
    const unknown = orderedPotIds.find((id) => !existingIds.has(id));
    if (unknown !== undefined) throw new InvalidPotOrderError(`Unbekannte Topf-ID: ${unknown}`);

    const now = nowIso();
    orderedPotIds.forEach((id, index) => tx.update(pots).set({ priority: index + 1, updatedAt: now }).where(eq(pots.id, id)).run());
    return selectPotsInOrder(tx);
  });
}
