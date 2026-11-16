import crypto from "node:crypto";
import { asc, desc, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { financialContracts, properties } from "@/db/schema";
import {
  type ContractCreateInput,
  contractCreateSchema,
  type ContractUpdateInput,
  type PropertyCreateInput,
  type PropertyUpdateInput,
} from "@/lib/validation/contracts";

export type PropertyRow = typeof properties.$inferSelect;
export type FinancialContractRow = typeof financialContracts.$inferSelect;

export class LinkedPropertyNotFoundError extends Error {
  constructor(propertyId: string) {
    super(`Linked property not found: ${propertyId}`);
    this.name = "LinkedPropertyNotFoundError";
  }
}

export function listProperties(): PropertyRow[] {
  const db = getDb();
  return db
    .select()
    .from(properties)
    .orderBy(asc(properties.name), desc(properties.updatedAt))
    .all();
}

export function getPropertyById(id: string): PropertyRow | null {
  const db = getDb();
  const row = db
    .select()
    .from(properties)
    .where(eq(properties.id, id))
    .get();
  return row ?? null;
}

export function createProperty(input: PropertyCreateInput): PropertyRow {
  const db = getDb();
  const now = new Date().toISOString();
  const [created] = db
    .insert(properties)
    .values({
      id: crypto.randomUUID(),
      name: input.name,
      usage: input.usage,
      purchaseDate: input.purchaseDate ?? null,
      purchasePriceCents: input.purchasePriceCents ?? null,
      estimatedValueCents: input.estimatedValueCents,
      updatedAt: now,
    })
    .returning()
    .all();

  if (!created) {
    throw new Error("Failed to create property");
  }
  return created;
}

export function updateProperty(
  id: string,
  input: PropertyUpdateInput,
): PropertyRow | null {
  const existing = getPropertyById(id);
  if (!existing) {
    return null;
  }

  const db = getDb();
  const now = new Date().toISOString();
  const [updated] = db
    .update(properties)
    .set({
      name: input.name ?? existing.name,
      usage: input.usage ?? existing.usage,
      purchaseDate:
        input.purchaseDate !== undefined
          ? input.purchaseDate
          : existing.purchaseDate,
      purchasePriceCents:
        input.purchasePriceCents !== undefined
          ? input.purchasePriceCents
          : existing.purchasePriceCents,
      estimatedValueCents:
        input.estimatedValueCents ?? existing.estimatedValueCents,
      updatedAt: now,
    })
    .where(eq(properties.id, id))
    .returning()
    .all();

  return updated ?? null;
}

export function deleteProperty(id: string): string | null {
  const db = getDb();
  const [deleted] = db
    .delete(properties)
    .where(eq(properties.id, id))
    .returning({ id: properties.id })
    .all();

  return deleted?.id ?? null;
}

function assertLinkedPropertyExists(linkedPropertyId: string | null): void {
  if (linkedPropertyId === null) {
    return;
  }
  const property = getPropertyById(linkedPropertyId);
  if (!property) {
    throw new LinkedPropertyNotFoundError(linkedPropertyId);
  }
}

export function listContracts(): FinancialContractRow[] {
  const db = getDb();
  return db
    .select()
    .from(financialContracts)
    .orderBy(
      asc(financialContracts.status),
      asc(financialContracts.category),
      asc(financialContracts.name),
    )
    .all();
}

export function getContractById(id: string): FinancialContractRow | null {
  const db = getDb();
  const row = db
    .select()
    .from(financialContracts)
    .where(eq(financialContracts.id, id))
    .get();
  return row ?? null;
}

export function createContract(
  input: ContractCreateInput,
): FinancialContractRow {
  assertLinkedPropertyExists(input.linkedPropertyId);

  const db = getDb();
  const now = new Date().toISOString();
  const [created] = db
    .insert(financialContracts)
    .values({
      id: crypto.randomUUID(),
      ...input,
      updatedAt: now,
    })
    .returning()
    .all();

  if (!created) {
    throw new Error("Failed to create contract");
  }
  return created;
}

export function updateContract(
  id: string,
  patch: ContractUpdateInput,
): FinancialContractRow | null {
  const existing = getContractById(id);
  if (!existing) {
    return null;
  }

  const merged = contractCreateSchema.parse({
    name: patch.name !== undefined ? patch.name : existing.name,
    provider: patch.provider !== undefined ? patch.provider : existing.provider,
    sphere: patch.sphere !== undefined ? patch.sphere : existing.sphere,
    category: patch.category !== undefined ? patch.category : existing.category,
    status: patch.status !== undefined ? patch.status : existing.status,
    currentBalanceCents:
      patch.currentBalanceCents !== undefined
        ? patch.currentBalanceCents
        : existing.currentBalanceCents,
    balanceAsOfDate:
      patch.balanceAsOfDate !== undefined
        ? patch.balanceAsOfDate
        : existing.balanceAsOfDate,
    monthlyRateCents:
      patch.monthlyRateCents !== undefined
        ? patch.monthlyRateCents
        : existing.monthlyRateCents,
    interestRateBps:
      patch.interestRateBps !== undefined
        ? patch.interestRateBps
        : existing.interestRateBps,
    linkedPropertyId:
      patch.linkedPropertyId !== undefined
        ? patch.linkedPropertyId
        : existing.linkedPropertyId,
    milestoneDate:
      patch.milestoneDate !== undefined
        ? patch.milestoneDate
        : existing.milestoneDate,
    milestoneLabel:
      patch.milestoneLabel !== undefined
        ? patch.milestoneLabel
        : existing.milestoneLabel,
    repaymentType:
      patch.repaymentType !== undefined
        ? patch.repaymentType
        : existing.repaymentType,
    specialRepaymentMaxYearlyCents:
      patch.specialRepaymentMaxYearlyCents !== undefined
        ? patch.specialRepaymentMaxYearlyCents
        : existing.specialRepaymentMaxYearlyCents,
    fixedInterestUntil:
      patch.fixedInterestUntil !== undefined
        ? patch.fixedInterestUntil
        : existing.fixedInterestUntil,
    targetSumCents:
      patch.targetSumCents !== undefined
        ? patch.targetSumCents
        : existing.targetSumCents,
    allocationThresholdPercent:
      patch.allocationThresholdPercent !== undefined
        ? patch.allocationThresholdPercent
        : existing.allocationThresholdPercent,
    futureLoanInterestRateBps:
      patch.futureLoanInterestRateBps !== undefined
        ? patch.futureLoanInterestRateBps
        : existing.futureLoanInterestRateBps,
  });

  assertLinkedPropertyExists(merged.linkedPropertyId);

  const db = getDb();
  const now = new Date().toISOString();
  const [updated] = db
    .update(financialContracts)
    .set({
      ...merged,
      updatedAt: now,
    })
    .where(eq(financialContracts.id, id))
    .returning()
    .all();

  return updated ?? null;
}

export function deleteContract(id: string): string | null {
  const db = getDb();
  const [deleted] = db
    .delete(financialContracts)
    .where(eq(financialContracts.id, id))
    .returning({ id: financialContracts.id })
    .all();

  return deleted?.id ?? null;
}
