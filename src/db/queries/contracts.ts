import crypto from "node:crypto";
import { asc, desc, eq } from "drizzle-orm";
import { getDb } from "@/db";
import {
  financialContracts,
  pots,
  properties,
  propertyValuationHistory,
} from "@/db/schema";
import { getTodayIsoDate } from "@/lib/domain/date";
import {
  parseRenovations,
  serializeRenovations,
} from "@/lib/domain/property-renovations";
import type { PropertyValuationContextInput } from "@/lib/domain/property-valuation-context";
import { validateRentalProfile } from "@/lib/domain/rental";
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

export class RentalProfileValidationError extends Error {
  readonly fieldErrors: Record<string, string>;
  constructor(fieldErrors: Record<string, string>) {
    super("Mietprofil-Validierung fehlgeschlagen.");
    this.name = "RentalProfileValidationError";
    this.fieldErrors = fieldErrors;
  }
}

export class MaintenancePotValidationError extends Error {
  readonly fieldErrors: Record<string, string>;
  constructor(message: string) {
    super(message);
    this.name = "MaintenancePotValidationError";
    this.fieldErrors = { maintenanceReservePotId: message };
  }
}

export class PropertyValidationError extends Error {
  readonly fieldErrors: Record<string, string>;
  constructor(message: string, fieldErrors: Record<string, string>) {
    super(message);
    this.name = "PropertyValidationError";
    this.fieldErrors = fieldErrors;
  }
}

export function assertMaintenancePotAssignable(
  potId: string,
  propertyId?: string,
): void {
  const db = getDb();
  const pot = db.select({ id: pots.id }).from(pots).where(eq(pots.id, potId)).get();
  if (!pot) {
    throw new MaintenancePotValidationError("Unbekannter Topf.");
  }

  const assigned = db
    .select({ id: properties.id })
    .from(properties)
    .where(eq(properties.maintenanceReservePotId, potId))
    .all();

  if (assigned.some((row) => row.id !== propertyId)) {
    throw new MaintenancePotValidationError(
      "Topf ist bereits Rücklage für ein anderes Objekt.",
    );
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

export interface PropertyValuationSourceData {
  contextInput: PropertyValuationContextInput;
  currentValueCents: number;
  currentSource: PropertyRow["estimatedValueSource"];
  autoValuationInterval: PropertyRow["autoValuationInterval"];
  lastAutoValuationAt: string | null;
  lastAutoValuationAttemptAt: string | null;
  lastAutoValuationOutcome: PropertyRow["lastAutoValuationOutcome"];
}

export function loadPropertyValuationSource(
  id: string,
  asOfDate: string = getTodayIsoDate(),
): PropertyValuationSourceData | null {
  const db = getDb();
  const row = db
    .select({
      usage: properties.usage,
      propertyType: properties.propertyType,
      postalCode: properties.postalCode,
      city: properties.city,
      livingAreaSqm: properties.livingAreaSqm,
      plotAreaSqm: properties.plotAreaSqm,
      constructionYear: properties.constructionYear,
      energyClass: properties.energyClass,
      renovations: properties.renovations,
      monthlyColdRentCents: properties.monthlyColdRentCents,
      street: properties.street,
      houseNumber: properties.houseNumber,
      estimatedValueCents: properties.estimatedValueCents,
      estimatedValueSource: properties.estimatedValueSource,
      autoValuationInterval: properties.autoValuationInterval,
      lastAutoValuationAt: properties.lastAutoValuationAt,
      lastAutoValuationAttemptAt: properties.lastAutoValuationAttemptAt,
      lastAutoValuationOutcome: properties.lastAutoValuationOutcome,
    })
    .from(properties)
    .where(eq(properties.id, id))
    .get();

  if (!row) {
    return null;
  }

  return {
    contextInput: {
      asOfDate,
      usage: row.usage,
      propertyType: row.propertyType,
      postalCode: row.postalCode,
      city: row.city,
      livingAreaSqm: row.livingAreaSqm,
      plotAreaSqm: row.plotAreaSqm,
      constructionYear: row.constructionYear,
      energyClass: row.energyClass,
      renovations: parseRenovations(row.renovations),
      monthlyColdRentCents: row.monthlyColdRentCents,
      forbiddenTerms: {
        street: row.street,
        houseNumber: row.houseNumber,
      },
    },
    currentValueCents: row.estimatedValueCents,
    currentSource: row.estimatedValueSource,
    autoValuationInterval: row.autoValuationInterval,
    lastAutoValuationAt: row.lastAutoValuationAt,
    lastAutoValuationAttemptAt: row.lastAutoValuationAttemptAt,
    lastAutoValuationOutcome: row.lastAutoValuationOutcome,
  };
}

export function loadPropertyValuationInput(
  id: string,
  asOfDate: string = getTodayIsoDate(),
): PropertyValuationContextInput | null {
  return loadPropertyValuationSource(id, asOfDate)?.contextInput ?? null;
}

function assertEstimatedValueAsOfNotInFuture(
  asOf: string | null,
  today: string,
): void {
  if (asOf != null && asOf > today) {
    throw new PropertyValidationError(
      "Bewertungsdatum darf nicht in der Zukunft liegen.",
      { estimatedValueAsOf: "Bewertungsdatum darf nicht in der Zukunft liegen." },
    );
  }
}

export type PropertyCreateParams = Omit<
  PropertyCreateInput,
  "autoValuationInterval"
> & {
  autoValuationInterval?: PropertyCreateInput["autoValuationInterval"];
};

export function createProperty(
  input: PropertyCreateParams,
  asOfDate?: string,
): PropertyRow {
  const today = asOfDate ?? getTodayIsoDate();
  assertEstimatedValueAsOfNotInFuture(input.estimatedValueAsOf ?? null, today);

  if (input.maintenanceReservePotId != null) {
    assertMaintenancePotAssignable(input.maintenanceReservePotId);
  }

  const estimatedValueAsOf =
    input.estimatedValueAsOf !== undefined
      ? input.estimatedValueAsOf
      : input.estimatedValueCents > 0
        ? today
        : null;
  const renovations =
    input.renovations != null ? serializeRenovations(input.renovations) : null;

  const db = getDb();
  const now = new Date().toISOString();
  const [created] = db
    .insert(properties)
    .values({
      id: crypto.randomUUID(),
      name: input.name,
      usage: input.usage,
      propertyType: input.propertyType ?? null,
      autoValuationInterval: input.autoValuationInterval ?? "off",
      estimatedValueSource: "manual",
      purchaseDate: input.purchaseDate ?? null,
      purchasePriceCents: input.purchasePriceCents ?? null,
      estimatedValueCents: input.estimatedValueCents,
      estimatedValueAsOf,
      maintenanceReservePotId: input.maintenanceReservePotId ?? null,
      monthlyColdRentCents: input.monthlyColdRentCents ?? null,
      monthlyNonRecoverableCostsCents:
        input.monthlyNonRecoverableCostsCents ?? null,
      monthlyMaintenanceAllowanceCents:
        input.monthlyMaintenanceAllowanceCents ?? null,
      depreciationBasisCents: input.depreciationBasisCents ?? null,
      street: input.street ?? null,
      houseNumber: input.houseNumber ?? null,
      postalCode: input.postalCode ?? null,
      city: input.city ?? null,
      livingAreaSqm: input.livingAreaSqm ?? null,
      usableAreaSqm: input.usableAreaSqm ?? null,
      plotAreaSqm: input.plotAreaSqm ?? null,
      constructionYear: input.constructionYear ?? null,
      energyClass: input.energyClass ?? null,
      renovations,
      features: input.features ?? null,
      imagePath: null,
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
  asOfDate?: string,
): PropertyRow | null {
  const existing = getPropertyById(id);
  if (!existing) {
    return null;
  }

  const today = asOfDate ?? getTodayIsoDate();
  let mergedEstimatedValueAsOf: string | null;
  if (input.estimatedValueAsOf !== undefined) {
    assertEstimatedValueAsOfNotInFuture(input.estimatedValueAsOf, today);
    mergedEstimatedValueAsOf = input.estimatedValueAsOf;
  } else if (
    input.estimatedValueCents !== undefined &&
    input.estimatedValueCents !== existing.estimatedValueCents
  ) {
    mergedEstimatedValueAsOf = today;
  } else {
    mergedEstimatedValueAsOf = existing.estimatedValueAsOf;
  }

  const mergedConstructionYear =
    input.constructionYear !== undefined
      ? input.constructionYear
      : existing.constructionYear;

  const mergedRenovationsList =
    input.renovations !== undefined
      ? (input.renovations ?? [])
      : parseRenovations(existing.renovations);

  if (
    mergedConstructionYear != null &&
    mergedRenovationsList.some((item) => item.year < mergedConstructionYear)
  ) {
    throw new PropertyValidationError(
      `Sanierungsjahr darf nicht vor dem Baujahr (${mergedConstructionYear}) liegen.`,
      {
        renovations: `Sanierungsjahr darf nicht vor dem Baujahr (${mergedConstructionYear}) liegen.`,
      },
    );
  }

  const mergedRenovationsRaw =
    input.renovations !== undefined
      ? input.renovations != null
        ? serializeRenovations(input.renovations)
        : null
      : existing.renovations;

  const mergedUsage = input.usage ?? existing.usage;
  const mergedColdRent =
    input.monthlyColdRentCents !== undefined
      ? input.monthlyColdRentCents
      : existing.monthlyColdRentCents;
  const mergedNonRecoverable =
    input.monthlyNonRecoverableCostsCents !== undefined
      ? input.monthlyNonRecoverableCostsCents
      : existing.monthlyNonRecoverableCostsCents;
  const mergedMaintenanceAllowance =
    input.monthlyMaintenanceAllowanceCents !== undefined
      ? input.monthlyMaintenanceAllowanceCents
      : existing.monthlyMaintenanceAllowanceCents;
  const mergedDepreciationBasis =
    input.depreciationBasisCents !== undefined
      ? input.depreciationBasisCents
      : existing.depreciationBasisCents;
  const mergedMaintenancePotId =
    input.maintenanceReservePotId !== undefined
      ? input.maintenanceReservePotId
      : existing.maintenanceReservePotId;

  const profileErrors = validateRentalProfile(mergedUsage, {
    monthlyColdRentCents: mergedColdRent,
    monthlyNonRecoverableCostsCents: mergedNonRecoverable,
    monthlyMaintenanceAllowanceCents: mergedMaintenanceAllowance,
    depreciationBasisCents: mergedDepreciationBasis,
  });
  if (Object.keys(profileErrors).length > 0) {
    throw new RentalProfileValidationError(profileErrors);
  }

  if (mergedMaintenancePotId != null) {
    assertMaintenancePotAssignable(mergedMaintenancePotId, id);
  }

  const db = getDb();
  const now = new Date().toISOString();
  const nextEstimatedValueCents =
    input.estimatedValueCents ?? existing.estimatedValueCents;
  const valueChanged =
    input.estimatedValueCents !== undefined &&
    input.estimatedValueCents !== existing.estimatedValueCents;

  const updated = db.transaction((tx) => {
    const [row] = tx
      .update(properties)
      .set({
        name: input.name ?? existing.name,
        usage: mergedUsage,
        propertyType:
          input.propertyType !== undefined
            ? input.propertyType
            : existing.propertyType,
        autoValuationInterval:
          input.autoValuationInterval !== undefined
            ? input.autoValuationInterval
            : existing.autoValuationInterval,
        purchaseDate:
          input.purchaseDate !== undefined
            ? input.purchaseDate
            : existing.purchaseDate,
        purchasePriceCents:
          input.purchasePriceCents !== undefined
            ? input.purchasePriceCents
            : existing.purchasePriceCents,
        estimatedValueCents: nextEstimatedValueCents,
        estimatedValueAsOf: mergedEstimatedValueAsOf,
        estimatedValueSource: valueChanged
          ? "manual"
          : existing.estimatedValueSource,
        maintenanceReservePotId: mergedMaintenancePotId,
        monthlyColdRentCents: mergedColdRent,
        monthlyNonRecoverableCostsCents: mergedNonRecoverable,
        monthlyMaintenanceAllowanceCents: mergedMaintenanceAllowance,
        depreciationBasisCents: mergedDepreciationBasis,
        street: input.street !== undefined ? input.street : existing.street,
        houseNumber:
          input.houseNumber !== undefined
            ? input.houseNumber
            : existing.houseNumber,
        postalCode:
          input.postalCode !== undefined ? input.postalCode : existing.postalCode,
        city: input.city !== undefined ? input.city : existing.city,
        livingAreaSqm:
          input.livingAreaSqm !== undefined
            ? input.livingAreaSqm
            : existing.livingAreaSqm,
        usableAreaSqm:
          input.usableAreaSqm !== undefined
            ? input.usableAreaSqm
            : existing.usableAreaSqm,
        plotAreaSqm:
          input.plotAreaSqm !== undefined
            ? input.plotAreaSqm
            : existing.plotAreaSqm,
        constructionYear: mergedConstructionYear,
        energyClass:
          input.energyClass !== undefined
            ? input.energyClass
            : existing.energyClass,
        renovations: mergedRenovationsRaw,
        features:
          input.features !== undefined ? input.features : existing.features,
        updatedAt: now,
      })
      .where(eq(properties.id, id))
      .returning()
      .all();

    if (valueChanged && nextEstimatedValueCents > 0) {
      tx.insert(propertyValuationHistory)
        .values({
          id: crypto.randomUUID(),
          propertyId: id,
          valuedAt: now,
          dataAsOf: mergedEstimatedValueAsOf,
          lowerCents: nextEstimatedValueCents,
          medianCents: nextEstimatedValueCents,
          upperCents: nextEstimatedValueCents,
          confidence: null,
          confidenceScore: null,
          valuability: null,
          source: "manual",
          trigger: "manual",
          requestId: null,
          appliedAt: now,
          previousValueCents: existing.estimatedValueCents,
        })
        .run();
    }

    return row ?? null;
  });

  return updated;
}

export function updatePropertyImagePath(
  id: string,
  imagePath: string | null,
): { property: PropertyRow; previousImagePath: string | null } | null {
  const existing = getPropertyById(id);
  if (!existing) {
    return null;
  }

  const db = getDb();
  const now = new Date().toISOString();
  const [updated] = db
    .update(properties)
    .set({
      imagePath,
      updatedAt: now,
    })
    .where(eq(properties.id, id))
    .returning()
    .all();

  if (!updated) {
    return null;
  }

  return {
    property: updated,
    previousImagePath: existing.imagePath ?? null,
  };
}

export function deleteProperty(
  id: string,
): { id: string; imagePath: string | null } | null {
  const db = getDb();
  const [deleted] = db
    .delete(properties)
    .where(eq(properties.id, id))
    .returning({ id: properties.id, imagePath: properties.imagePath })
    .all();

  return deleted ?? null;
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
