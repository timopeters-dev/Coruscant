import { asc, desc, eq } from "drizzle-orm";
import { getDb } from "@/backend/db/connection";
import { firstRow, mergePatch, newId, nowIso } from "@/backend/db/helpers";
import { cashflowItems } from "@/backend/db/schema";
import { ApiError } from "@/backend/errors";
import type { CashflowCreateInput, CashflowUpdateInput } from "@/validation/allocation";

export type CashflowItemRow = typeof cashflowItems.$inferSelect;

/** Nur manuell angelegte Posten sind änderbar; abgeleitete kommen aus Verträgen. */
export class NonManualCashflowItemError extends ApiError {
  constructor(action: "bearbeitet" | "gelöscht") {
    super(400, `Nur manuelle Cashflow-Positionen können ${action} werden.`);
  }
}

export function listManualCashflowItems(): CashflowItemRow[] {
  return getDb()
    .select()
    .from(cashflowItems)
    .where(eq(cashflowItems.source, "manual"))
    .orderBy(asc(cashflowItems.direction), asc(cashflowItems.name), desc(cashflowItems.updatedAt))
    .all();
}

export function getCashflowItemById(id: string): CashflowItemRow | null {
  return getDb().select().from(cashflowItems).where(eq(cashflowItems.id, id)).get() ?? null;
}

export function createManualCashflowItem(input: CashflowCreateInput): CashflowItemRow {
  const rows = getDb()
    .insert(cashflowItems)
    .values({ id: newId(), ...input, source: "manual", linkedContractId: null, updatedAt: nowIso() })
    .returning()
    .all();
  return firstRow(rows, "cashflow item");
}

function requireManual(id: string, action: "bearbeitet" | "gelöscht"): CashflowItemRow | null {
  const existing = getCashflowItemById(id);
  if (existing && existing.source !== "manual") throw new NonManualCashflowItemError(action);
  return existing;
}

export function updateManualCashflowItem(id: string, patch: CashflowUpdateInput): CashflowItemRow | null {
  const existing = requireManual(id, "bearbeitet");
  if (!existing) return null;
  const { name, direction, amountCents, frequency, active } = mergePatch(existing, patch);
  const [updated] = getDb()
    .update(cashflowItems)
    .set({ name, direction, amountCents, frequency, active, updatedAt: nowIso() })
    .where(eq(cashflowItems.id, id))
    .returning()
    .all();
  return updated ?? null;
}

export function deleteManualCashflowItem(id: string): string | null {
  if (!requireManual(id, "gelöscht")) return null;
  const [deleted] = getDb().delete(cashflowItems).where(eq(cashflowItems.id, id)).returning({ id: cashflowItems.id }).all();
  return deleted?.id ?? null;
}
