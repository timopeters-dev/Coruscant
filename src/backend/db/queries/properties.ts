import { asc, desc, eq } from "drizzle-orm";
import { getDb } from "@/backend/db/connection";
import { firstRow, mergePatch, newId, nowIso } from "@/backend/db/helpers";
import { pots, properties, propertyValuationHistory } from "@/backend/db/schema";
import { FieldValidationError, type FieldErrors } from "@/backend/errors";
import { getTodayIsoDate } from "@/domain/core/date";
import { validateRentalProfile } from "@/domain/properties/rental";
import { parseRenovations, serializeRenovations } from "@/domain/properties/renovations";
import {
  parseValuationAdjustments, type ValuationAdjustment,
} from "@/domain/properties/valuation/adjustments";
import type { PropertyValuationContextInput } from "@/domain/properties/valuation/context";
import type { PropertyCreateInput, PropertyUpdateInput } from "@/validation/contracts";

export type PropertyRow = typeof properties.$inferSelect;

export class RentalProfileValidationError extends FieldValidationError {
  constructor(fieldErrors: FieldErrors) {
    super("Mietprofil-Validierung fehlgeschlagen.", fieldErrors);
  }
}

export class MaintenancePotValidationError extends FieldValidationError {
  constructor(message: string) {
    super(message, "maintenanceReservePotId");
  }
}

export class PropertyValidationError extends FieldValidationError {}

/** Ein Rücklagen-Topf gehört zu höchstens einem Objekt. */
function assertMaintenancePotAssignable(potId: string, propertyId?: string): void {
  const db = getDb();
  if (!db.select({ id: pots.id }).from(pots).where(eq(pots.id, potId)).get()) {
    throw new MaintenancePotValidationError("Unbekannter Topf.");
  }
  const assigned = db.select({ id: properties.id }).from(properties).where(eq(properties.maintenanceReservePotId, potId)).all();
  if (assigned.some((row) => row.id !== propertyId)) {
    throw new MaintenancePotValidationError("Topf ist bereits Rücklage für ein anderes Objekt.");
  }
}

function assertValuationDateNotInFuture(asOf: string | null | undefined, today: string): void {
  if (asOf != null && asOf > today) {
    const message = "Bewertungsdatum darf nicht in der Zukunft liegen.";
    throw new PropertyValidationError(message, { estimatedValueAsOf: message });
  }
}

export function listProperties(): PropertyRow[] {
  return getDb().select().from(properties).orderBy(asc(properties.name), desc(properties.updatedAt)).all();
}

export function getPropertyById(id: string): PropertyRow | null {
  return getDb().select().from(properties).where(eq(properties.id, id)).get() ?? null;
}

/** Objekt, wie es die API ausliefert: Zu-/Abschläge als Liste statt JSON-Text. */
export interface PropertyApiRecord extends Omit<PropertyRow, "valuationAdjustments"> {
  valuationAdjustments: ValuationAdjustment[];
}

export function serializePropertyForApi(row: PropertyRow): PropertyApiRecord {
  return { ...row, valuationAdjustments: parseValuationAdjustments(row.valuationAdjustments) };
}

export interface PropertyValuationSourceData {
  contextInput: PropertyValuationContextInput;
  adjustments: ValuationAdjustment[];
  currentValueCents: number;
  currentSource: PropertyRow["estimatedValueSource"];
  autoValuationInterval: PropertyRow["autoValuationInterval"];
  lastAutoValuationAt: string | null;
  lastAutoValuationAttemptAt: string | null;
  lastAutoValuationOutcome: PropertyRow["lastAutoValuationOutcome"];
}

/** Alles, was eine Wertschätzung braucht; Straße/Hausnummer nur als Verbotsliste. */
export function loadPropertyValuationSource(id: string, asOfDate: string = getTodayIsoDate()): PropertyValuationSourceData | null {
  const row = getPropertyById(id);
  if (!row) return null;
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
      forbiddenTerms: { street: row.street, houseNumber: row.houseNumber },
    },
    adjustments: parseValuationAdjustments(row.valuationAdjustments),
    currentValueCents: row.estimatedValueCents,
    currentSource: row.estimatedValueSource,
    autoValuationInterval: row.autoValuationInterval,
    lastAutoValuationAt: row.lastAutoValuationAt,
    lastAutoValuationAttemptAt: row.lastAutoValuationAttemptAt,
    lastAutoValuationOutcome: row.lastAutoValuationOutcome,
  };
}

export type PropertyCreateParams = Omit<PropertyCreateInput, "autoValuationInterval"> & {
  autoValuationInterval?: PropertyCreateInput["autoValuationInterval"];
};

export function createProperty(input: PropertyCreateParams, asOfDate = getTodayIsoDate()): PropertyRow {
  assertValuationDateNotInFuture(input.estimatedValueAsOf, asOfDate);
  if (input.maintenanceReservePotId != null) assertMaintenancePotAssignable(input.maintenanceReservePotId);

  const rows = getDb()
    .insert(properties)
    .values({
      id: newId(),
      ...input,
      autoValuationInterval: input.autoValuationInterval ?? "off",
      estimatedValueSource: "manual",
      // Ein Wert ohne Datum gilt als heute geschätzt.
      estimatedValueAsOf: input.estimatedValueAsOf !== undefined ? input.estimatedValueAsOf : input.estimatedValueCents > 0 ? asOfDate : null,
      renovations: input.renovations != null ? serializeRenovations(input.renovations) : null,
      imagePath: null,
      updatedAt: nowIso(),
    })
    .returning()
    .all();
  return firstRow(rows, "property");
}

/**
 * Ändert ein Objekt. Ein neuer Wert gilt ab heute als manuelle Schätzung und
 * landet im Bewertungsverlauf; Mietprofil und Sanierungsjahre werden am
 * zusammengeführten Datensatz geprüft.
 */
export function updateProperty(id: string, input: PropertyUpdateInput, asOfDate = getTodayIsoDate()): PropertyRow | null {
  const existing = getPropertyById(id);
  if (!existing) return null;

  const { renovations: renovationsPatch, ...fields } = input;
  const merged = mergePatch(existing, fields);
  const valueChanged = input.estimatedValueCents !== undefined && input.estimatedValueCents !== existing.estimatedValueCents;
  assertValuationDateNotInFuture(input.estimatedValueAsOf, asOfDate);
  const estimatedValueAsOf = input.estimatedValueAsOf !== undefined ? input.estimatedValueAsOf : valueChanged ? asOfDate : existing.estimatedValueAsOf;

  const renovations = renovationsPatch !== undefined ? (renovationsPatch ?? []) : parseRenovations(existing.renovations);
  if (merged.constructionYear != null && renovations.some((item) => item.year < merged.constructionYear!)) {
    const message = `Sanierungsjahr darf nicht vor dem Baujahr (${merged.constructionYear}) liegen.`;
    throw new PropertyValidationError(message, { renovations: message });
  }
  const profileErrors = validateRentalProfile(merged.usage, merged);
  if (Object.keys(profileErrors).length > 0) throw new RentalProfileValidationError(profileErrors);
  if (merged.maintenanceReservePotId != null) assertMaintenancePotAssignable(merged.maintenanceReservePotId, id);

  const now = nowIso();
  return getDb().transaction((tx) => {
    const [row] = tx
      .update(properties)
      .set({
        ...fields,
        estimatedValueAsOf,
        estimatedValueSource: valueChanged ? "manual" : existing.estimatedValueSource,
        ...(renovationsPatch !== undefined ? { renovations: renovationsPatch != null ? serializeRenovations(renovationsPatch) : null } : {}),
        updatedAt: now,
      })
      .where(eq(properties.id, id))
      .returning()
      .all();

    if (valueChanged && merged.estimatedValueCents > 0) {
      tx.insert(propertyValuationHistory)
        .values({
          id: newId(),
          propertyId: id,
          valuedAt: now,
          dataAsOf: estimatedValueAsOf,
          lowerCents: merged.estimatedValueCents,
          medianCents: merged.estimatedValueCents,
          upperCents: merged.estimatedValueCents,
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
}

export function updatePropertyImagePath(id: string, imagePath: string | null): { property: PropertyRow; previousImagePath: string | null } | null {
  const existing = getPropertyById(id);
  if (!existing) return null;
  const [property] = getDb().update(properties).set({ imagePath, updatedAt: nowIso() }).where(eq(properties.id, id)).returning().all();
  return property ? { property, previousImagePath: existing.imagePath ?? null } : null;
}

export function deleteProperty(id: string): { id: string; imagePath: string | null } | null {
  const [deleted] = getDb().delete(properties).where(eq(properties.id, id)).returning({ id: properties.id, imagePath: properties.imagePath }).all();
  return deleted ?? null;
}
