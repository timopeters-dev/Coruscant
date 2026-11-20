import crypto from "node:crypto";
import { and, asc, desc, eq, gt, inArray, isNotNull, isNull, ne, or } from "drizzle-orm";
import { getDb } from "@/backend/db/connection";
import {
  appMeta,
  type ExternalSnapshotRow,
  cashflowItems,
  financialContracts,
  potAllocations,
  pots,
  properties,
} from "@/backend/db/schema";
import {
  getLatestExternalSnapshot,
  insertExternalSnapshot,
  parseSnapshotAccounts,
  parseSnapshotPositions,
} from "./external-snapshots";
import { isHouseholdScope } from "@/domain/core/household-scope";
import {
  computePotSyncPlan,
  findAccountPositionOverlap,
  type PotSyncOutcome,
  resolveExternalLinkValue,
} from "@/domain/allocation/pot-sync";
import {
  type AllocationSettings,
  allocationSettingsSchema,
  type FinanzCockpitSummary,
  variableExpenseBasisSchema,
} from "@/validation/external";
import {
  type CashflowCreateInput,
  type CashflowUpdateInput,
  type PotAllocateInput,
  type PotCreateInput,
  potCreateSchema,
  type PotUpdateInput,
} from "@/validation/allocation";

export type CashflowItemRow = typeof cashflowItems.$inferSelect;
export type PotRow = typeof pots.$inferSelect;
export type PotAllocationRow = typeof potAllocations.$inferSelect;

export interface RecentPotAllocationRow {
  id: string;
  potId: string;
  potName: string;
  amountCents: number;
  sourceLabel: string;
  allocatedAt: string;
}

export class NonManualCashflowItemError extends Error {
  constructor(id: string) {
    super(`Cashflow item is not manual: ${id}`);
    this.name = "NonManualCashflowItemError";
  }
}

export class LinkedPropertyNotFoundError extends Error {
  constructor(propertyId: string) {
    super(`Linked property not found: ${propertyId}`);
    this.name = "LinkedPropertyNotFoundError";
  }
}

export class LinkedContractNotFoundError extends Error {
  constructor(contractId: string) {
    super(`Linked contract not found: ${contractId}`);
    this.name = "LinkedContractNotFoundError";
  }
}

export class RemainderPercentageExceededError extends Error {
  readonly availablePercentage: number;

  constructor(availablePercentage: number) {
    super(
      `Sum of remainderPercentage exceeds 100% (available: ${availablePercentage}%)`,
    );
    this.name = "RemainderPercentageExceededError";
    this.availablePercentage = availablePercentage;
  }
}

export class InvalidPotOrderError extends Error {
  constructor(message = "Ungültige Topf-Reihenfolge.") {
    super(message);
    this.name = "InvalidPotOrderError";
  }
}

export class PotNotFoundError extends Error {
  readonly potId: string;

  constructor(potId: string) {
    super(`Pot not found: ${potId}`);
    this.name = "PotNotFoundError";
    this.potId = potId;
  }
}

export class PotLinkedBalanceReadOnlyError extends Error {
  constructor() {
    super("Der Stand eines gekoppelten Topfs wird per Sync übernommen.");
    this.name = "PotLinkedBalanceReadOnlyError";
  }
}

export class PotExternalLinkConflictError extends Error {
  constructor() {
    super("Dieses Konto bzw. diese Position ist bereits mit einem Topf gekoppelt.");
    this.name = "PotExternalLinkConflictError";
  }
}

export class PotExternalLinkTargetNotFoundError extends Error {
  constructor() {
    super("Das Kopplungsziel ist im letzten Stand aus Bespin nicht enthalten.");
    this.name = "PotExternalLinkTargetNotFoundError";
  }
}

export class PotExternalLinkOutOfScopeError extends Error {
  constructor() {
    super("Nur Haushalts-Konten und -Positionen können gekoppelt werden.");
    this.name = "PotExternalLinkOutOfScopeError";
  }
}

export class AllocationValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AllocationValidationError";
  }
}

// --- Cashflow Items (Manual) ---

export function listManualCashflowItems(): CashflowItemRow[] {
  const db = getDb();
  return db
    .select()
    .from(cashflowItems)
    .where(eq(cashflowItems.source, "manual"))
    .orderBy(
      asc(cashflowItems.direction),
      asc(cashflowItems.name),
      desc(cashflowItems.updatedAt),
    )
    .all();
}

export function getCashflowItemById(id: string): CashflowItemRow | null {
  const db = getDb();
  const row = db
    .select()
    .from(cashflowItems)
    .where(eq(cashflowItems.id, id))
    .get();
  return row ?? null;
}

export function createManualCashflowItem(
  input: CashflowCreateInput,
): CashflowItemRow {
  const db = getDb();
  const now = new Date().toISOString();
  const [created] = db
    .insert(cashflowItems)
    .values({
      id: crypto.randomUUID(),
      name: input.name,
      direction: input.direction,
      amountCents: input.amountCents,
      frequency: input.frequency,
      source: "manual",
      linkedContractId: null,
      active: input.active,
      updatedAt: now,
    })
    .returning()
    .all();

  if (!created) {
    throw new Error("Failed to create cashflow item");
  }
  return created;
}

export function updateManualCashflowItem(
  id: string,
  patch: CashflowUpdateInput,
): CashflowItemRow | null {
  const existing = getCashflowItemById(id);
  if (!existing) {
    return null;
  }
  if (existing.source !== "manual") {
    throw new NonManualCashflowItemError(id);
  }

  const db = getDb();
  const now = new Date().toISOString();
  const [updated] = db
    .update(cashflowItems)
    .set({
      name: patch.name ?? existing.name,
      direction: patch.direction ?? existing.direction,
      amountCents: patch.amountCents ?? existing.amountCents,
      frequency: patch.frequency ?? existing.frequency,
      active: patch.active ?? existing.active,
      updatedAt: now,
    })
    .where(eq(cashflowItems.id, id))
    .returning()
    .all();

  return updated ?? null;
}

export function deleteManualCashflowItem(id: string): string | null {
  const existing = getCashflowItemById(id);
  if (!existing) {
    return null;
  }
  if (existing.source !== "manual") {
    throw new NonManualCashflowItemError(id);
  }

  const db = getDb();
  const [deleted] = db
    .delete(cashflowItems)
    .where(eq(cashflowItems.id, id))
    .returning({ id: cashflowItems.id })
    .all();

  return deleted?.id ?? null;
}

// --- Pots ---

type DbInstance = ReturnType<typeof getDb>;
type DbTx = Parameters<Parameters<DbInstance["transaction"]>[0]>[0];

function assertLinksExist(
  tx: DbTx,
  linkedPropertyId: string | null,
  linkedContractId: string | null,
): void {
  if (linkedPropertyId !== null) {
    const property = tx
      .select({ id: properties.id })
      .from(properties)
      .where(eq(properties.id, linkedPropertyId))
      .get();
    if (!property) {
      throw new LinkedPropertyNotFoundError(linkedPropertyId);
    }
  }

  if (linkedContractId !== null) {
    const contract = tx
      .select({ id: financialContracts.id })
      .from(financialContracts)
      .where(eq(financialContracts.id, linkedContractId))
      .get();
    if (!contract) {
      throw new LinkedContractNotFoundError(linkedContractId);
    }
  }
}

function assertRemainderPercentageWithinLimit(
  tx: DbTx,
  newPercentage: number | null,
  excludePotId?: string,
): void {
  if (newPercentage === null) {
    return;
  }

  const rows = excludePotId
    ? tx
        .select({
          ruleType: pots.ruleType,
          remainderPercentage: pots.remainderPercentage,
        })
        .from(pots)
        .where(ne(pots.id, excludePotId))
        .all()
    : tx
        .select({
          ruleType: pots.ruleType,
          remainderPercentage: pots.remainderPercentage,
        })
        .from(pots)
        .all();

  const existingSum = rows.reduce((sum, row) => {
    if (
      row.ruleType === "percentage_of_remainder" &&
      row.remainderPercentage !== null
    ) {
      return sum + row.remainderPercentage;
    }
    return sum;
  }, 0);

  if (existingSum + newPercentage > 100) {
    throw new RemainderPercentageExceededError(Math.max(0, 100 - existingSum));
  }
}

export function listPots(): PotRow[] {
  const db = getDb();
  return db
    .select()
    .from(pots)
    .orderBy(asc(pots.priority), asc(pots.id))
    .all();
}

export function getPotById(id: string): PotRow | null {
  const db = getDb();
  const row = db.select().from(pots).where(eq(pots.id, id)).get();
  return row ?? null;
}

interface ResolvedLinkState {
  kind: "account" | "position" | null;
  ref: string | null;
  scope: "personal" | "household" | null;
  syncedAt: string | null;
  linkedAt: string | null;
  currentCents: number;
}

/**
 * Applies the latest snapshot value to a (new or changed) link. A new link
 * must point to a target of the latest snapshot and must not overlap with an
 * existing link (account vs. one of its positions).
 */
function resolveLinkState(
  tx: DbTx,
  link: { kind: "account" | "position"; ref: string } | null | undefined,
  fallbackCents: number,
  previous: {
    kind: "account" | "position" | null;
    ref: string | null;
    scope: "personal" | "household" | null;
    syncedAt: string | null;
    linkedAt: string | null;
  } | null,
  excludePotId: string | null,
): ResolvedLinkState {
  if (!link) {
    return {
      kind: null,
      ref: null,
      scope: null,
      syncedAt: null,
      linkedAt: null,
      currentCents: fallbackCents,
    };
  }

  if (previous && previous.kind === link.kind && previous.ref === link.ref) {
    return {
      kind: link.kind,
      ref: link.ref,
      scope: previous.scope,
      syncedAt: previous.syncedAt,
      linkedAt: previous.linkedAt,
      currentCents: fallbackCents,
    };
  }

  const snapshot = getLatestExternalSnapshot();
  const accounts = snapshot ? parseSnapshotAccounts(snapshot) : [];
  const positions = (snapshot ? parseSnapshotPositions(snapshot) : []).map(
    (p) => ({
      id: p.id,
      accountId: p.accountId,
      marketValueCents: p.marketValueCents,
    }),
  );
  const resolved = snapshot
    ? resolveExternalLinkValue(link.kind, link.ref, accounts, positions)
    : null;

  if (!snapshot || !resolved) {
    throw new PotExternalLinkTargetNotFoundError();
  }
  if (!isHouseholdScope(resolved.scope)) {
    throw new PotExternalLinkOutOfScopeError();
  }

  const otherLinks = tx
    .select({ kind: pots.externalLinkKind, ref: pots.externalLinkRef })
    .from(pots)
    .where(
      excludePotId === null
        ? isNotNull(pots.externalLinkKind)
        : and(isNotNull(pots.externalLinkKind), ne(pots.id, excludePotId)),
    )
    .all()
    .flatMap((row) =>
      row.kind !== null && row.ref !== null
        ? [{ kind: row.kind, ref: row.ref }]
        : [],
    );
  if (findAccountPositionOverlap([...otherLinks, link], positions)) {
    throw new PotExternalLinkConflictError();
  }

  return {
    kind: link.kind,
    ref: link.ref,
    scope: resolved.scope,
    syncedAt: resolved.asOf ?? snapshot.fetchedAt,
    linkedAt: new Date().toISOString(),
    currentCents: resolved.valueCents,
  };
}

function isUniqueConstraintError(error: unknown): boolean {
  return (
    error instanceof Error &&
    "code" in error &&
    typeof (error as { code?: unknown }).code === "string" &&
    (error as { code: string }).code.startsWith("SQLITE_CONSTRAINT_UNIQUE")
  );
}

export function createPot(input: PotCreateInput): PotRow {
  const db = getDb();
  try {
    return createPotInTransaction(db, input);
  } catch (error) {
    if (input.externalLink && isUniqueConstraintError(error)) {
      throw new PotExternalLinkConflictError();
    }
    throw error;
  }
}

function createPotInTransaction(db: DbInstance, input: PotCreateInput): PotRow {
  return db.transaction((tx) => {
    assertLinksExist(tx, input.linkedPropertyId, input.linkedContractId);
    if (input.ruleType === "percentage_of_remainder") {
      assertRemainderPercentageWithinLimit(tx, input.remainderPercentage);
    }

    const existingPots = tx
      .select({ priority: pots.priority })
      .from(pots)
      .all();
    const maxPriority = existingPots.reduce(
      (max, row) => (row.priority > max ? row.priority : max),
      0,
    );

    const linkState = resolveLinkState(
      tx,
      input.externalLink,
      input.currentCents,
      null,
      null,
    );

    const now = new Date().toISOString();
    const [created] = tx
      .insert(pots)
      .values({
        id: crypto.randomUUID(),
        name: input.name,
        priority: maxPriority + 1,
        currentCents: linkState.currentCents,
        targetCents: input.targetCents,
        targetDate: input.targetDate,
        ruleType: input.ruleType,
        fixedMonthlyCents: input.fixedMonthlyCents,
        remainderPercentage: input.remainderPercentage,
        linkedContractId: input.linkedContractId,
        linkedPropertyId: input.linkedPropertyId,
        purpose: input.purpose,
        externalLinkKind: linkState.kind,
        externalLinkRef: linkState.ref,
        externalLinkScope: linkState.scope,
        externalSyncedAt: linkState.syncedAt,
        externalLinkedAt: linkState.linkedAt,
        updatedAt: now,
      })
      .returning()
      .all();

    if (!created) {
      throw new Error("Failed to create pot");
    }
    return created;
  });
}

export function updatePot(id: string, patch: PotUpdateInput): PotRow | null {
  const db = getDb();
  try {
    return updatePotInTransaction(db, id, patch);
  } catch (error) {
    if (patch.externalLink && isUniqueConstraintError(error)) {
      throw new PotExternalLinkConflictError();
    }
    throw error;
  }
}

function updatePotInTransaction(
  db: DbInstance,
  id: string,
  patch: PotUpdateInput,
): PotRow | null {
  return db.transaction((tx) => {
    const existing = tx.select().from(pots).where(eq(pots.id, id)).get();
    if (!existing) {
      return null;
    }

    const existingLink =
      existing.externalLinkKind !== null && existing.externalLinkRef !== null
        ? { kind: existing.externalLinkKind, ref: existing.externalLinkRef }
        : null;
    const effectiveLink =
      patch.externalLink !== undefined ? patch.externalLink : existingLink;

    if (effectiveLink !== null && patch.currentCents !== undefined) {
      throw new PotLinkedBalanceReadOnlyError();
    }

    const merged = potCreateSchema.parse({
      name: patch.name !== undefined ? patch.name : existing.name,
      currentCents:
        patch.currentCents !== undefined
          ? patch.currentCents
          : existing.currentCents,
      targetCents:
        patch.targetCents !== undefined
          ? patch.targetCents
          : existing.targetCents,
      targetDate:
        patch.targetDate !== undefined
          ? patch.targetDate
          : existing.targetDate,
      ruleType:
        patch.ruleType !== undefined ? patch.ruleType : existing.ruleType,
      fixedMonthlyCents:
        patch.fixedMonthlyCents !== undefined
          ? patch.fixedMonthlyCents
          : existing.fixedMonthlyCents,
      remainderPercentage:
        patch.remainderPercentage !== undefined
          ? patch.remainderPercentage
          : existing.remainderPercentage,
      linkedContractId:
        patch.linkedContractId !== undefined
          ? patch.linkedContractId
          : existing.linkedContractId,
      linkedPropertyId:
        patch.linkedPropertyId !== undefined
          ? patch.linkedPropertyId
          : existing.linkedPropertyId,
      externalLink: effectiveLink,
      purpose: patch.purpose !== undefined ? patch.purpose : existing.purpose,
    });

    const linkState = resolveLinkState(
      tx,
      merged.externalLink,
      merged.currentCents,
      existingLink
        ? {
            ...existingLink,
            scope: existing.externalLinkScope,
            syncedAt: existing.externalSyncedAt,
            linkedAt: existing.externalLinkedAt,
          }
        : null,
      id,
    );

    assertLinksExist(tx, merged.linkedPropertyId, merged.linkedContractId);
    if (merged.ruleType === "percentage_of_remainder") {
      assertRemainderPercentageWithinLimit(
        tx,
        merged.remainderPercentage,
        id,
      );
    }

    const now = new Date().toISOString();
    const [updated] = tx
      .update(pots)
      .set({
        name: merged.name,
        currentCents: linkState.currentCents,
        targetCents: merged.targetCents,
        targetDate: merged.targetDate,
        ruleType: merged.ruleType,
        fixedMonthlyCents: merged.fixedMonthlyCents,
        remainderPercentage: merged.remainderPercentage,
        linkedContractId: merged.linkedContractId,
        linkedPropertyId: merged.linkedPropertyId,
        purpose: merged.purpose,
        externalLinkKind: linkState.kind,
        externalLinkRef: linkState.ref,
        externalLinkScope: linkState.scope,
        externalSyncedAt: linkState.syncedAt,
        externalLinkedAt: linkState.linkedAt,
        updatedAt: now,
      })
      .where(eq(pots.id, id))
      .returning()
      .all();

    return updated ?? null;
  });
}

export function deletePot(id: string): string | null {
  const db = getDb();
  return db.transaction((tx) => {
    const [deleted] = tx
      .delete(pots)
      .where(eq(pots.id, id))
      .returning({ id: pots.id })
      .all();

    if (!deleted) {
      return null;
    }

    const remaining = tx
      .select({ id: pots.id, priority: pots.priority })
      .from(pots)
      .orderBy(asc(pots.priority), asc(pots.id))
      .all();

    const now = new Date().toISOString();
    remaining.forEach((row, index) => {
      const nextPriority = index + 1;
      if (row.priority !== nextPriority) {
        tx.update(pots)
          .set({ priority: nextPriority, updatedAt: now })
          .where(eq(pots.id, row.id))
          .run();
      }
    });

    return deleted.id;
  });
}

export function reorderPots(orderedPotIds: readonly string[]): PotRow[] {
  const db = getDb();
  return db.transaction((tx) => {
    const currentPots = tx.select({ id: pots.id }).from(pots).all();
    if (orderedPotIds.length !== currentPots.length) {
      throw new InvalidPotOrderError(
        "Die Sortierliste muss alle vorhandenen Töpfe enthalten.",
      );
    }

    const existingIds = new Set(currentPots.map((p) => p.id));
    for (const id of orderedPotIds) {
      if (!existingIds.has(id)) {
        throw new InvalidPotOrderError(`Unbekannte Topf-ID: ${id}`);
      }
    }

    const now = new Date().toISOString();
    orderedPotIds.forEach((id, index) => {
      tx.update(pots)
        .set({ priority: index + 1, updatedAt: now })
        .where(eq(pots.id, id))
        .run();
    });

    return tx
      .select()
      .from(pots)
      .orderBy(asc(pots.priority), asc(pots.id))
      .all();
  });
}

// --- Pot Allocations & Journal ---

export function listRecentPotAllocations(
  limit = 10,
): RecentPotAllocationRow[] {
  const db = getDb();
  return db
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
  /** Linked pots: journal entry only, the transfer must be executed manually. */
  transferPlanPotIds: string[];
}

export function executeWaterfallAllocation(
  input: PotAllocateInput,
): ExecuteWaterfallAllocationResult {
  const db = getDb();
  return db.transaction((tx) => {
    const allPots = tx
      .select()
      .from(pots)
      .orderBy(asc(pots.priority), asc(pots.id))
      .all();
    const potById = new Map<string, PotRow>(allPots.map((p) => [p.id, p]));

    let totalBigInt = 0n;
    for (const entry of input.allocations) {
      if (!potById.has(entry.potId)) {
        throw new PotNotFoundError(entry.potId);
      }
      totalBigInt += BigInt(entry.amountCents);
    }

    if (totalBigInt > BigInt(Number.MAX_SAFE_INTEGER)) {
      throw new AllocationValidationError(
        "Die Summe der Zuteilungen überschreitet den zulässigen Wertebereich.",
      );
    }

    const totalAllocatedCents = Number(totalBigInt);

    if (totalAllocatedCents <= 0) {
      throw new AllocationValidationError(
        "Mindestens ein Topf muss einen Betrag > 0 € erhalten.",
      );
    }

    if (totalAllocatedCents > input.inputAmountCents) {
      throw new AllocationValidationError(
        "Die Summe der Zuteilungen darf den verfügbaren Betrag nicht überschreiten.",
      );
    }

    const now = new Date().toISOString();
    const createdAllocations: PotAllocationRow[] = [];
    const transferPlanPotIds: string[] = [];

    for (const entry of input.allocations) {
      if (entry.amountCents === 0) {
        continue;
      }

      const existing = potById.get(entry.potId);
      if (!existing) {
        throw new PotNotFoundError(entry.potId);
      }

      const nextCents = existing.currentCents + entry.amountCents;
      if (!Number.isSafeInteger(nextCents)) {
        throw new AllocationValidationError(
          `Topf-Stand überschreitet den zulässigen Wertebereich für "${existing.name}".`,
        );
      }

      if (existing.externalLinkKind === null) {
        tx.update(pots)
          .set({ currentCents: nextCents, updatedAt: now })
          .where(eq(pots.id, existing.id))
          .run();
      } else {
        transferPlanPotIds.push(existing.id);
      }

      const [allocation] = tx
        .insert(potAllocations)
        .values({
          id: crypto.randomUUID(),
          potId: existing.id,
          amountCents: entry.amountCents,
          sourceLabel: input.sourceLabel,
          allocatedAt: now,
        })
        .returning()
        .all();

      if (!allocation) {
        throw new Error("Failed to create pot allocation");
      }
      createdAllocations.push(allocation);
    }

    const updatedPots = tx
      .select()
      .from(pots)
      .orderBy(asc(pots.priority), asc(pots.id))
      .all();

    return {
      allocations: createdAllocations,
      updatedPots,
      totalAllocatedCents,
      unallocatedCents: input.inputAmountCents - totalAllocatedCents,
      transferPlanPotIds,
    };
  });
}

// --- External Pot Sync ---

/**
 * Applies a freshly stored finanz_cockpit snapshot to all externally linked
 * pots in one transaction. Virtual pots are never touched; pots whose target
 * is missing keep their last calibrated stand.
 */
function applyPotSyncInTx(
  tx: DbTx,
  snapshot: ExternalSnapshotRow,
): PotSyncOutcome[] {
  const accounts = parseSnapshotAccounts(snapshot);
  const positions = parseSnapshotPositions(snapshot);

  const linkedPots = tx
    .select()
    .from(pots)
    .where(isNotNull(pots.externalLinkKind))
    .orderBy(asc(pots.priority), asc(pots.id))
    .all();

  const outcomes = computePotSyncPlan({
    pots: linkedPots,
    accounts,
    positions,
  });

  const now = new Date().toISOString();
  for (const outcome of outcomes) {
    if (outcome.status === "link_missing" || outcome.status === "link_conflict") {
      continue;
    }
    if (outcome.status === "link_out_of_scope") {
      // Keep stand and sync time frozen; only remember the scope (idempotent).
      tx.update(pots)
        .set({ externalLinkScope: "personal" })
        .where(
          and(eq(pots.id, outcome.potId), isNotNull(pots.externalLinkKind)),
        )
        .run();
      continue;
    }
    const where = and(
      eq(pots.id, outcome.potId),
      isNotNull(pots.externalLinkKind),
    );
    if (outcome.status === "updated") {
      tx.update(pots)
        .set({
          currentCents: outcome.nextCents,
          externalLinkScope: outcome.scope,
          externalSyncedAt: outcome.asOf ?? snapshot.fetchedAt,
          updatedAt: now,
        })
        .where(where)
        .run();
    } else {
      tx.update(pots)
        .set({
          externalLinkScope: outcome.scope,
          externalSyncedAt: outcome.asOf ?? snapshot.fetchedAt,
        })
        .where(where)
        .run();
    }
  }

  return outcomes;
}

export function applyPotSyncFromSnapshot(
  snapshot: ExternalSnapshotRow,
): PotSyncOutcome[] {
  return getDb().transaction((tx) => applyPotSyncInTx(tx, snapshot));
}

/**
 * Stores the snapshot and syncs all linked pots atomically: if the pot sync
 * fails, no snapshot is persisted (so the next sync is not skipped as fresh).
 */
export function storeSnapshotAndSyncPots(summary: FinanzCockpitSummary): {
  snapshot: ExternalSnapshotRow;
  outcomes: PotSyncOutcome[];
} {
  return getDb().transaction((tx) => {
    const snapshot = insertExternalSnapshot(summary, tx);
    const outcomes = applyPotSyncInTx(tx, snapshot);
    return { snapshot, outcomes };
  });
}

/**
 * Sum of transfers that were planned (journal entries) after the last sync of
 * a linked pot and are therefore not yet reflected in its calibrated stand.
 */
export function getPendingTransferCentsByPotId(): Map<string, number> {
  const db = getDb();
  const linked = db
    .select({
      id: pots.id,
      syncedAt: pots.externalSyncedAt,
      linkedAt: pots.externalLinkedAt,
    })
    .from(pots)
    .where(
      and(
        isNotNull(pots.externalLinkKind),
        or(isNull(pots.externalLinkScope), ne(pots.externalLinkScope, "personal")),
      ),
    )
    .all();

  const result = new Map<string, number>();
  for (const pot of linked) {
    if (pot.syncedAt === null) {
      continue;
    }
    // Entries before (re-)linking were plain bookings or concerned an old target.
    const windowStart =
      pot.linkedAt !== null && pot.linkedAt > pot.syncedAt
        ? pot.linkedAt
        : pot.syncedAt;
    const rows = db
      .select({ amountCents: potAllocations.amountCents })
      .from(potAllocations)
      .where(
        and(
          eq(potAllocations.potId, pot.id),
          gt(potAllocations.allocatedAt, windowStart),
        ),
      )
      .all();
    let sum = 0;
    for (const row of rows) {
      sum += row.amountCents;
    }
    if (!Number.isSafeInteger(sum)) {
      throw new RangeError(`Pending transfers overflow for pot ${pot.id}`);
    }
    if (sum > 0) {
      result.set(pot.id, sum);
    }
  }
  return result;
}

// --- Allocation Settings (app_meta) ---

export interface AllocationSettingsState extends AllocationSettings {
  includePropertyItems: boolean;
}

const ALLOCATION_META_KEYS = {
  variableBasis: "allocation_variable_basis",
  includeContractItems: "allocation_include_contract_items",
  includePropertyItems: "allocation_include_property_items",
} as const;

const LEGACY_INCLUDE_CONTRACTS_KEY = "allocation_include_contracts_mode_b";

export const DEFAULT_ALLOCATION_SETTINGS: AllocationSettingsState = {
  variableBasis: "budget",
  includeContractItems: false,
  includePropertyItems: true,
};

export function getAllocationSettings(): AllocationSettingsState {
  const db = getDb();
  const rows = db
    .select()
    .from(appMeta)
    .where(
      inArray(appMeta.key, [
        ALLOCATION_META_KEYS.variableBasis,
        ALLOCATION_META_KEYS.includeContractItems,
        ALLOCATION_META_KEYS.includePropertyItems,
        LEGACY_INCLUDE_CONTRACTS_KEY,
      ]),
    )
    .all();

  const map = new Map(rows.map((r) => [r.key, r.value]));

  const parsedBasis = variableExpenseBasisSchema.safeParse(
    map.get(ALLOCATION_META_KEYS.variableBasis),
  );
  const rawInclude =
    map.get(ALLOCATION_META_KEYS.includeContractItems) ??
    map.get(LEGACY_INCLUDE_CONTRACTS_KEY);
  const rawIncludeProperty = map.get(ALLOCATION_META_KEYS.includePropertyItems);

  return {
    variableBasis: parsedBasis.success
      ? parsedBasis.data
      : DEFAULT_ALLOCATION_SETTINGS.variableBasis,
    includeContractItems:
      rawInclude === "true"
        ? true
        : rawInclude === "false"
          ? false
          : DEFAULT_ALLOCATION_SETTINGS.includeContractItems,
    includePropertyItems:
      rawIncludeProperty === "true"
        ? true
        : rawIncludeProperty === "false"
          ? false
          : DEFAULT_ALLOCATION_SETTINGS.includePropertyItems,
  };
}

export function saveAllocationSettings(
  patch: Partial<AllocationSettingsState>,
): AllocationSettingsState {
  const current = getAllocationSettings();
  const parsedBase = allocationSettingsSchema.parse({
    variableBasis: patch.variableBasis ?? current.variableBasis,
    includeContractItems:
      patch.includeContractItems ?? current.includeContractItems,
  });
  const nextIncludeProperty =
    patch.includePropertyItems ?? current.includePropertyItems;
  const next: AllocationSettingsState = {
    ...parsedBase,
    includePropertyItems: Boolean(nextIncludeProperty),
  };

  const db = getDb();
  const now = new Date().toISOString();

  const entries: Array<{ key: string; value: string }> = [
    { key: ALLOCATION_META_KEYS.variableBasis, value: next.variableBasis },
    {
      key: ALLOCATION_META_KEYS.includeContractItems,
      value: String(next.includeContractItems),
    },
    {
      key: ALLOCATION_META_KEYS.includePropertyItems,
      value: String(next.includePropertyItems),
    },
  ];

  db.transaction((tx) => {
    for (const entry of entries) {
      tx.insert(appMeta)
        .values({
          key: entry.key,
          value: entry.value,
          updatedAt: now,
        })
        .onConflictDoUpdate({
          target: appMeta.key,
          set: { value: entry.value, updatedAt: now },
        })
        .run();
    }
  });

  return next;
}
