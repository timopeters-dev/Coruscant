import { asc, eq } from "drizzle-orm";
import { getDb } from "@/backend/db/connection";
import { firstRow, mergePatch, newId, nowIso } from "@/backend/db/helpers";
import { financialContracts, properties } from "@/backend/db/schema";
import { LinkedPropertyNotFoundError } from "@/backend/errors";
import { contractCreateSchema, type ContractCreateInput, type ContractUpdateInput } from "@/validation/contracts";

type StoredContractRow = typeof financialContracts.$inferSelect;

/**
 * Vertrag, wie ihn die App sieht. Die Alt-Spalte `sphere` bleibt in der DB
 * (Default `household`, Entfernen ist Tech-Debt), verlässt aber nie diese Schicht.
 */
export type FinancialContractRow = Omit<StoredContractRow, "sphere">;

export function toContractRow(row: StoredContractRow): FinancialContractRow {
  const { sphere: _legacySphere, ...rest } = row;
  void _legacySphere;
  return rest;
}

function assertLinkedPropertyExists(linkedPropertyId: string | null): void {
  if (linkedPropertyId !== null && !getDb().select({ id: properties.id }).from(properties).where(eq(properties.id, linkedPropertyId)).get()) {
    throw new LinkedPropertyNotFoundError();
  }
}

export function listContracts(): FinancialContractRow[] {
  return getDb()
    .select()
    .from(financialContracts)
    .orderBy(asc(financialContracts.status), asc(financialContracts.category), asc(financialContracts.name))
    .all()
    .map(toContractRow);
}

export function getContractById(id: string): FinancialContractRow | null {
  const row = getDb().select().from(financialContracts).where(eq(financialContracts.id, id)).get();
  return row ? toContractRow(row) : null;
}

export function createContract(input: ContractCreateInput): FinancialContractRow {
  assertLinkedPropertyExists(input.linkedPropertyId);
  const rows = getDb().insert(financialContracts).values({ id: newId(), ...input, updatedAt: nowIso() }).returning().all();
  return toContractRow(firstRow(rows, "contract"));
}

/** Regeln über mehrere Felder greifen erst am zusammengeführten Datensatz (wirft ZodError). */
export function updateContract(id: string, patch: ContractUpdateInput): FinancialContractRow | null {
  const existing = getContractById(id);
  if (!existing) return null;
  const merged = contractCreateSchema.parse(mergePatch(existing, patch));
  assertLinkedPropertyExists(merged.linkedPropertyId);
  const [updated] = getDb()
    .update(financialContracts)
    .set({ ...merged, updatedAt: nowIso() })
    .where(eq(financialContracts.id, id))
    .returning()
    .all();
  return updated ? toContractRow(updated) : null;
}

export function deleteContract(id: string): string | null {
  const [deleted] = getDb().delete(financialContracts).where(eq(financialContracts.id, id)).returning({ id: financialContracts.id }).all();
  return deleted?.id ?? null;
}
