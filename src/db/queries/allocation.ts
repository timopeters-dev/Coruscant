import crypto from "node:crypto";
import { asc, desc, eq, inArray, ne } from "drizzle-orm";
import { getDb } from "@/db";
import {
  appMeta,
  cashflowItems,
  financialContracts,
  potAllocations,
  pots,
  properties,
} from "@/db/schema";
import {
  type AllocationSettings,
  allocationModeSchema,
  allocationSettingsSchema,
  variableExpenseBasisSchema,
} from "@/lib/validation/external";
import {
  type CashflowCreateInput,
  type CashflowUpdateInput,
  type PotAllocateInput,
  type PotCreateInput,
  potCreateSchema,
  type PotUpdateInput,
} from "@/lib/validation/allocation";

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

export function createPot(input: PotCreateInput): PotRow {
  const db = getDb();
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

    const now = new Date().toISOString();
    const [created] = tx
      .insert(pots)
      .values({
        id: crypto.randomUUID(),
        name: input.name,
        priority: maxPriority + 1,
        currentCents: input.currentCents,
        targetCents: input.targetCents,
        ruleType: input.ruleType,
        fixedMonthlyCents: input.fixedMonthlyCents,
        remainderPercentage: input.remainderPercentage,
        linkedContractId: input.linkedContractId,
        linkedPropertyId: input.linkedPropertyId,
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
  return db.transaction((tx) => {
    const existing = tx.select().from(pots).where(eq(pots.id, id)).get();
    if (!existing) {
      return null;
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
    });

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
        currentCents: merged.currentCents,
        targetCents: merged.targetCents,
        ruleType: merged.ruleType,
        fixedMonthlyCents: merged.fixedMonthlyCents,
        remainderPercentage: merged.remainderPercentage,
        linkedContractId: merged.linkedContractId,
        linkedPropertyId: merged.linkedPropertyId,
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

      tx.update(pots)
        .set({ currentCents: nextCents, updatedAt: now })
        .where(eq(pots.id, existing.id))
        .run();

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
    };
  });
}

// --- Allocation Settings (app_meta) ---

const ALLOCATION_META_KEYS = {
  mode: "allocation_cashflow_mode",
  variableBasis: "allocation_variable_basis",
  includeContractsInModeB: "allocation_include_contracts_mode_b",
} as const;

export const DEFAULT_ALLOCATION_SETTINGS: AllocationSettings = {
  mode: "mode_a",
  variableBasis: "budget",
  includeContractsInModeB: false,
};

export function getAllocationSettings(): AllocationSettings {
  const db = getDb();
  const rows = db
    .select()
    .from(appMeta)
    .where(
      inArray(appMeta.key, [
        ALLOCATION_META_KEYS.mode,
        ALLOCATION_META_KEYS.variableBasis,
        ALLOCATION_META_KEYS.includeContractsInModeB,
      ]),
    )
    .all();

  const map = new Map(rows.map((r) => [r.key, r.value]));

  const parsedMode = allocationModeSchema.safeParse(
    map.get(ALLOCATION_META_KEYS.mode),
  );
  const parsedBasis = variableExpenseBasisSchema.safeParse(
    map.get(ALLOCATION_META_KEYS.variableBasis),
  );
  const rawInclude = map.get(ALLOCATION_META_KEYS.includeContractsInModeB);

  return {
    mode: parsedMode.success ? parsedMode.data : DEFAULT_ALLOCATION_SETTINGS.mode,
    variableBasis: parsedBasis.success
      ? parsedBasis.data
      : DEFAULT_ALLOCATION_SETTINGS.variableBasis,
    includeContractsInModeB:
      rawInclude === "true"
        ? true
        : rawInclude === "false"
          ? false
          : DEFAULT_ALLOCATION_SETTINGS.includeContractsInModeB,
  };
}

export function saveAllocationSettings(
  patch: Partial<AllocationSettings>,
): AllocationSettings {
  const current = getAllocationSettings();
  const next = allocationSettingsSchema.parse({
    mode: patch.mode ?? current.mode,
    variableBasis: patch.variableBasis ?? current.variableBasis,
    includeContractsInModeB:
      patch.includeContractsInModeB ?? current.includeContractsInModeB,
  });

  const db = getDb();
  const now = new Date().toISOString();

  const entries: Array<{ key: string; value: string }> = [
    { key: ALLOCATION_META_KEYS.mode, value: next.mode },
    { key: ALLOCATION_META_KEYS.variableBasis, value: next.variableBasis },
    {
      key: ALLOCATION_META_KEYS.includeContractsInModeB,
      value: String(next.includeContractsInModeB),
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
