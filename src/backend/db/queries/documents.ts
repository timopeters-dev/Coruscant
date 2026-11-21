import { and, desc, eq, type SQL } from "drizzle-orm";
import { getDb } from "@/backend/db/connection";
import { firstRow, mergePatch, newId, nowIso, type DbOrTx } from "@/backend/db/helpers";
import { documents, financialContracts, properties } from "@/backend/db/schema";
import { ApiError, FieldValidationError, NotFoundError, type FieldErrors } from "@/backend/errors";
import {
  resolveDocumentTaxYear,
  type ContractCalibrationEvaluation,
  type DocumentStatus,
  type DocumentType,
  type TaxCategory,
} from "@/domain/documents/documents";
import type { DocumentUpdateInput } from "@/validation/documents";

export type DocumentRow = typeof documents.$inferSelect;

export class DuplicateDocumentError extends ApiError {
  constructor(readonly existingDocument: DocumentRow) {
    super(409, `Dieses PDF wurde bereits hochgeladen (${existingDocument.filename}).`, { existingDocument });
  }
}

export class DocumentNotFoundError extends NotFoundError {
  constructor() {
    super("Dokument nicht gefunden.");
  }
}

export class DocumentLinkedEntityNotFoundError extends FieldValidationError {
  constructor(field: "linkedPropertyId" | "linkedContractId", entityId: string) {
    super(`Verknüpfte Entität nicht gefunden (${field}: ${entityId}).`, field);
  }
}

export class DocumentValidationError extends FieldValidationError {
  constructor(field: string, message: string) {
    super(message, field);
  }
}

export class ContractCalibrationConflictError extends ApiError {
  constructor(readonly evaluation: ContractCalibrationEvaluation) {
    super(
      409,
      `Vertrag ist bereits auf neueres Datum (${evaluation.previousAsOfDate}) geeicht als das Belegdatum (${evaluation.effectiveDate}).`,
      {
        code: "calibration_date_conflict",
        evaluation,
        previousAsOfDate: evaluation.previousAsOfDate,
        effectiveDate: evaluation.effectiveDate,
      },
    );
  }
}

export class ContractLoanOptionsValidationError extends ApiError {
  constructor(fieldErrors: FieldErrors) {
    super(422, Object.values(fieldErrors)[0] ?? "Darlehensoptionen sind nach der Zusammenführung nicht konsistent.", {
      fieldErrors,
    });
  }
}

export class DocumentAlreadyVerifiedError extends ApiError {
  constructor() {
    super(409, "Bereits verifizierte Belege können nicht erneut durch die KI überschrieben werden.");
  }
}

export class DocumentAlreadyLinkedError extends ApiError {
  constructor(linkedContractId: string) {
    super(409, `Dokument ist bereits mit einem Vertrag verknüpft (${linkedContractId}).`, { linkedContractId });
  }
}
export interface ListDocumentsFilters {
  status?: DocumentStatus;
  taxYear?: number;
  propertyId?: string;
  contractId?: string;
  onlyTaxRelevant?: boolean;
}

export function listDocuments(filters: ListDocumentsFilters = {}): DocumentRow[] {
  const conditions: SQL[] = [];
  if (filters.status) conditions.push(eq(documents.status, filters.status));
  if (filters.propertyId) conditions.push(eq(documents.linkedPropertyId, filters.propertyId));
  if (filters.contractId) conditions.push(eq(documents.linkedContractId, filters.contractId));
  if (filters.onlyTaxRelevant) conditions.push(eq(documents.isTaxRelevant, true));

  const rows = getDb()
    .select()
    .from(documents)
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(desc(documents.createdAt), desc(documents.id))
    .all();
  // Das Steuerjahr kann aus dem Belegdatum abgeleitet sein – daher nach dem Laden filtern.
  return filters.taxYear === undefined ? rows : rows.filter((row) => resolveDocumentTaxYear(row) === filters.taxYear);
}

export function getDocumentById(id: string): DocumentRow | null {
  return getDb().select().from(documents).where(eq(documents.id, id)).get() ?? null;
}

export function getDocumentBySha256(sha256Hash: string): DocumentRow | null {
  return getDb().select().from(documents).where(eq(documents.sha256Hash, sha256Hash)).get() ?? null;
}

export function assertLinkedEntitiesExist(
  tx: DbOrTx,
  links: { linkedPropertyId?: string | null; linkedContractId?: string | null },
): void {
  const { linkedPropertyId, linkedContractId } = links;
  if (linkedPropertyId && !tx.select({ id: properties.id }).from(properties).where(eq(properties.id, linkedPropertyId)).get()) {
    throw new DocumentLinkedEntityNotFoundError("linkedPropertyId", linkedPropertyId);
  }
  if (
    linkedContractId &&
    !tx.select({ id: financialContracts.id }).from(financialContracts).where(eq(financialContracts.id, linkedContractId)).get()
  ) {
    throw new DocumentLinkedEntityNotFoundError("linkedContractId", linkedContractId);
  }
}

type DocumentMetadataPatch = Omit<DocumentUpdateInput, "linkedPropertyId" | "linkedContractId">;

/**
 * Führt Belegangaben zusammen: Steuerangaben gelten nur für steuerrelevante
 * Belege, das Steuerjahr fällt auf das Belegjahr zurück, und der absetzbare
 * Betrag darf den Gesamtbetrag nicht übersteigen.
 */
export function mergeDocumentMetadata(existing: DocumentRow, patch: DocumentMetadataPatch = {}) {
  const merged = mergePatch(existing, patch);
  const taxYear =
    merged.isTaxRelevant && merged.taxYear == null && merged.documentDate != null ? Number(merged.documentDate.slice(0, 4)) : merged.taxYear;
  const deductibleAmountCents = merged.isTaxRelevant ? merged.deductibleAmountCents : null;
  if (merged.totalAmountCents != null && deductibleAmountCents != null && deductibleAmountCents > merged.totalAmountCents) {
    throw new DocumentValidationError("deductibleAmountCents", "Der absetzbare Betrag darf den Gesamtbetrag nicht übersteigen.");
  }
  return {
    filename: merged.filename,
    documentType: merged.documentType,
    documentDate: merged.documentDate,
    issuer: merged.issuer,
    totalAmountCents: merged.totalAmountCents,
    isTaxRelevant: merged.isTaxRelevant,
    taxYear,
    taxCategory: merged.isTaxRelevant ? merged.taxCategory : null,
    deductibleAmountCents,
    detectedBalanceCents: merged.detectedBalanceCents,
  };
}

export interface CreateDocumentInput {
  filename: string;
  storagePath: string;
  sha256Hash: string;
  documentType?: DocumentType;
  documentDate?: string | null;
  issuer?: string | null;
  totalAmountCents?: number | null;
  linkedPropertyId?: string | null;
  linkedContractId?: string | null;
  isTaxRelevant?: boolean;
  taxYear?: number | null;
  taxCategory?: TaxCategory | null;
  deductibleAmountCents?: number | null;
  detectedBalanceCents?: number | null;
  extractedContractJson?: string | null;
}

export function createDocumentRecord(input: CreateDocumentInput): DocumentRow {
  const duplicate = getDocumentBySha256(input.sha256Hash);
  if (duplicate) throw new DuplicateDocumentError(duplicate);
  const db = getDb();
  assertLinkedEntitiesExist(db, input);
  try {
    const rows = db
      .insert(documents)
      .values({ id: newId(), ...input, status: "pending_review", createdAt: nowIso() })
      .returning()
      .all();
    return firstRow(rows, "document");
  } catch (error) {
    // Paralleler Upload derselben Datei: der Unique-Index auf dem Hash greift.
    const raced = getDocumentBySha256(input.sha256Hash);
    if (raced) throw new DuplicateDocumentError(raced);
    throw error;
  }
}

export function updateDocumentRecord(id: string, patch: DocumentUpdateInput): DocumentRow {
  const existing = getDocumentById(id);
  if (!existing) throw new DocumentNotFoundError();
  const { linkedPropertyId, linkedContractId } = mergePatch(existing, patch);
  const db = getDb();
  assertLinkedEntitiesExist(db, { linkedPropertyId, linkedContractId });
  const [updated] = db
    .update(documents)
    .set({ ...mergeDocumentMetadata(existing, patch), linkedPropertyId, linkedContractId })
    .where(eq(documents.id, id))
    .returning()
    .all();
  if (!updated) throw new DocumentNotFoundError();
  return updated;
}

export function deleteDocumentRecord(id: string): DocumentRow {
  const [deleted] = getDb().delete(documents).where(eq(documents.id, id)).returning().all();
  if (!deleted) throw new DocumentNotFoundError();
  return deleted;
}
