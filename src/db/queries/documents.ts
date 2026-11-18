import crypto from "node:crypto";
import { and, desc, eq, type SQL } from "drizzle-orm";
import { getDb } from "@/db";
import { type FinancialContractRow, toContractRow } from "@/db/queries/contracts";
import { documents, financialContracts, properties } from "@/db/schema";
import {
  type ContractCalibrationEvaluation,
  type DocumentStatus,
  type DocumentType,
  evaluateContractCalibration,
  resolveDocumentTaxYear,
  type TaxCategory,
} from "@/lib/domain/documents";
import type {
  DocumentCreateContractInput,
  DocumentUpdateInput,
  DocumentVerifyInput,
} from "@/lib/validation/documents";

export type DocumentRow = typeof documents.$inferSelect;

export class DuplicateDocumentError extends Error {
  readonly existingDocument: DocumentRow;

  constructor(existingDocument: DocumentRow) {
    super(`Dokument mit identischem Hash existiert bereits (${existingDocument.filename}).`);
    this.name = "DuplicateDocumentError";
    this.existingDocument = existingDocument;
  }
}

export class DocumentNotFoundError extends Error {
  readonly documentId: string;

  constructor(documentId: string) {
    super(`Dokument nicht gefunden: ${documentId}`);
    this.name = "DocumentNotFoundError";
    this.documentId = documentId;
  }
}

export class DocumentLinkedEntityNotFoundError extends Error {
  readonly field: "linkedPropertyId" | "linkedContractId";
  readonly entityId: string;

  constructor(
    field: "linkedPropertyId" | "linkedContractId",
    entityId: string,
  ) {
    super(`Verknüpfte Entität nicht gefunden (${field}: ${entityId}).`);
    this.name = "DocumentLinkedEntityNotFoundError";
    this.field = field;
    this.entityId = entityId;
  }
}

export class ContractCalibrationConflictError extends Error {
  readonly evaluation: ContractCalibrationEvaluation;

  constructor(evaluation: ContractCalibrationEvaluation) {
    super(
      `Vertrag ist bereits auf neueres Datum (${evaluation.previousAsOfDate}) geeicht als das Belegdatum (${evaluation.effectiveDate}).`,
    );
    this.name = "ContractCalibrationConflictError";
    this.evaluation = evaluation;
  }
}

export class DocumentValidationError extends Error {
  readonly field: string;

  constructor(field: string, message: string) {
    super(message);
    this.name = "DocumentValidationError";
    this.field = field;
  }
}

export class DocumentAlreadyVerifiedError extends Error {
  readonly documentId: string;

  constructor(documentId: string) {
    super(
      "Bereits verifizierte Belege können nicht erneut durch die KI überschrieben werden.",
    );
    this.name = "DocumentAlreadyVerifiedError";
    this.documentId = documentId;
  }
}

export class DocumentAlreadyLinkedError extends Error {
  readonly documentId: string;
  readonly linkedContractId: string;

  constructor(documentId: string, linkedContractId: string) {
    super(
      `Dokument ist bereits mit einem Vertrag verknüpft (${linkedContractId}).`,
    );
    this.name = "DocumentAlreadyLinkedError";
    this.documentId = documentId;
    this.linkedContractId = linkedContractId;
  }
}

export interface ListDocumentsFilters {
  status?: DocumentStatus;
  taxYear?: number;
  propertyId?: string;
  contractId?: string;
  onlyTaxRelevant?: boolean;
}

export function listDocuments(
  filters: ListDocumentsFilters = {},
): DocumentRow[] {
  const db = getDb();
  const conditions: SQL[] = [];

  if (filters.status) {
    conditions.push(eq(documents.status, filters.status));
  }
  if (filters.propertyId) {
    conditions.push(eq(documents.linkedPropertyId, filters.propertyId));
  }
  if (filters.contractId) {
    conditions.push(eq(documents.linkedContractId, filters.contractId));
  }
  if (filters.onlyTaxRelevant) {
    conditions.push(eq(documents.isTaxRelevant, true));
  }

  const query = db.select().from(documents);
  const rows = (
    conditions.length > 0 ? query.where(and(...conditions)) : query
  )
    .orderBy(desc(documents.createdAt), desc(documents.id))
    .all();

  if (filters.taxYear !== undefined) {
    return rows.filter((row) => resolveDocumentTaxYear(row) === filters.taxYear);
  }

  return rows;
}

export function listVerifiedDocumentsForContract(
  contractId: string,
): DocumentRow[] {
  return listDocuments({ status: "verified", contractId });
}

export function listVerifiedDocumentsForProperty(
  propertyId: string,
): DocumentRow[] {
  return listDocuments({ status: "verified", propertyId });
}

export function getDocumentById(id: string): DocumentRow | null {
  const db = getDb();
  const row = db.select().from(documents).where(eq(documents.id, id)).get();
  return row ?? null;
}

export function getDocumentBySha256(sha256Hash: string): DocumentRow | null {
  const db = getDb();
  const row = db
    .select()
    .from(documents)
    .where(eq(documents.sha256Hash, sha256Hash))
    .get();
  return row ?? null;
}

function assertLinkedEntitiesExist(
  dbClient: ReturnType<typeof getDb>,
  linkedPropertyId: string | null | undefined,
  linkedContractId: string | null | undefined,
): void {
  if (linkedPropertyId) {
    const property = dbClient
      .select({ id: properties.id })
      .from(properties)
      .where(eq(properties.id, linkedPropertyId))
      .get();
    if (!property) {
      throw new DocumentLinkedEntityNotFoundError(
        "linkedPropertyId",
        linkedPropertyId,
      );
    }
  }

  if (linkedContractId) {
    const contract = dbClient
      .select({ id: financialContracts.id })
      .from(financialContracts)
      .where(eq(financialContracts.id, linkedContractId))
      .get();
    if (!contract) {
      throw new DocumentLinkedEntityNotFoundError(
        "linkedContractId",
        linkedContractId,
      );
    }
  }
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
  const existing = getDocumentBySha256(input.sha256Hash);
  if (existing) {
    throw new DuplicateDocumentError(existing);
  }

  const db = getDb();
  assertLinkedEntitiesExist(
    db,
    input.linkedPropertyId,
    input.linkedContractId,
  );

  const now = new Date().toISOString();
  try {
    const [created] = db
      .insert(documents)
      .values({
        id: crypto.randomUUID(),
        filename: input.filename,
        storagePath: input.storagePath,
        sha256Hash: input.sha256Hash,
        status: "pending_review",
        documentType: input.documentType ?? "other",
        documentDate: input.documentDate ?? null,
        issuer: input.issuer ?? null,
        totalAmountCents: input.totalAmountCents ?? null,
        linkedPropertyId: input.linkedPropertyId ?? null,
        linkedContractId: input.linkedContractId ?? null,
        isTaxRelevant: input.isTaxRelevant ?? false,
        taxYear: input.taxYear ?? null,
        taxCategory: input.taxCategory ?? null,
        deductibleAmountCents: input.deductibleAmountCents ?? null,
        detectedBalanceCents: input.detectedBalanceCents ?? null,
        extractedContractJson: input.extractedContractJson ?? null,
        createdAt: now,
      })
      .returning()
      .all();

    if (!created) {
      throw new Error("Dokument-Datensatz konnte nicht angelegt werden.");
    }
    return created;
  } catch (error) {
    const duplicateCheck = getDocumentBySha256(input.sha256Hash);
    if (duplicateCheck) {
      throw new DuplicateDocumentError(duplicateCheck);
    }
    throw error;
  }
}

export function updateDocumentRecord(
  id: string,
  patch: DocumentUpdateInput,
): DocumentRow {
  const existing = getDocumentById(id);
  if (!existing) {
    throw new DocumentNotFoundError(id);
  }

  const db = getDb();
  const nextLinkedPropertyId =
    patch.linkedPropertyId !== undefined
      ? patch.linkedPropertyId
      : existing.linkedPropertyId;
  const nextLinkedContractId =
    patch.linkedContractId !== undefined
      ? patch.linkedContractId
      : existing.linkedContractId;

  assertLinkedEntitiesExist(db, nextLinkedPropertyId, nextLinkedContractId);

  const nextDocumentDate =
    patch.documentDate !== undefined
      ? patch.documentDate
      : existing.documentDate;
  const nextTotalAmountCents =
    patch.totalAmountCents !== undefined
      ? patch.totalAmountCents
      : existing.totalAmountCents;
  const nextIsTaxRelevant =
    patch.isTaxRelevant !== undefined
      ? patch.isTaxRelevant
      : existing.isTaxRelevant;

  let nextTaxYear =
    patch.taxYear !== undefined ? patch.taxYear : existing.taxYear;
  if (nextIsTaxRelevant && nextTaxYear == null && nextDocumentDate != null) {
    nextTaxYear = Number(nextDocumentDate.slice(0, 4));
  }

  const nextTaxCategory = nextIsTaxRelevant
    ? patch.taxCategory !== undefined
      ? patch.taxCategory
      : existing.taxCategory
    : null;
  const nextDeductibleAmountCents = nextIsTaxRelevant
    ? patch.deductibleAmountCents !== undefined
      ? patch.deductibleAmountCents
      : existing.deductibleAmountCents
    : null;

  if (
    nextTotalAmountCents != null &&
    nextDeductibleAmountCents != null &&
    nextDeductibleAmountCents > nextTotalAmountCents
  ) {
    throw new DocumentValidationError(
      "deductibleAmountCents",
      "Der absetzbare Betrag darf den Gesamtbetrag nicht übersteigen.",
    );
  }

  const [updated] = db
    .update(documents)
    .set({
      filename: patch.filename ?? existing.filename,
      documentType: patch.documentType ?? existing.documentType,
      documentDate: nextDocumentDate,
      issuer: patch.issuer !== undefined ? patch.issuer : existing.issuer,
      totalAmountCents: nextTotalAmountCents,
      linkedPropertyId: nextLinkedPropertyId,
      linkedContractId: nextLinkedContractId,
      isTaxRelevant: nextIsTaxRelevant,
      taxYear: nextTaxYear,
      taxCategory: nextTaxCategory,
      deductibleAmountCents: nextDeductibleAmountCents,
      detectedBalanceCents:
        patch.detectedBalanceCents !== undefined
          ? patch.detectedBalanceCents
          : existing.detectedBalanceCents,
    })
    .where(eq(documents.id, id))
    .returning()
    .all();

  if (!updated) {
    throw new DocumentNotFoundError(id);
  }
  return updated;
}

export interface VerifyDocumentResult {
  document: DocumentRow;
  calibratedContract: FinancialContractRow | null;
  calibrationEvaluation: ContractCalibrationEvaluation | null;
}

export function verifyDocumentAndOptionallyCalibrate(
  id: string,
  input: DocumentVerifyInput,
  todayIsoDate: string,
): VerifyDocumentResult {
  const db = getDb();

  return db.transaction((tx) => {
    const existing = tx
      .select()
      .from(documents)
      .where(eq(documents.id, id))
      .get();

    if (!existing) {
      throw new DocumentNotFoundError(id);
    }

    if (input.linkedPropertyId) {
      const property = tx
        .select({ id: properties.id })
        .from(properties)
        .where(eq(properties.id, input.linkedPropertyId))
        .get();
      if (!property) {
        throw new DocumentLinkedEntityNotFoundError(
          "linkedPropertyId",
          input.linkedPropertyId,
        );
      }
    }

    if (input.linkedContractId) {
      const contractExists = tx
        .select({ id: financialContracts.id })
        .from(financialContracts)
        .where(eq(financialContracts.id, input.linkedContractId))
        .get();
      if (!contractExists) {
        throw new DocumentLinkedEntityNotFoundError(
          "linkedContractId",
          input.linkedContractId,
        );
      }
    }

    let calibratedContract: FinancialContractRow | null = null;
    let calibrationEvaluation: ContractCalibrationEvaluation | null = null;
    let persistedDetectedBalanceCents = input.detectedBalanceCents ?? null;

    if (input.calibrateContract) {
      if (!input.linkedContractId) {
        throw new DocumentValidationError(
          "linkedContractId",
          "Für eine Vertrags-Eichung muss ein Vertrag verknüpft sein.",
        );
      }

      const contract = tx
        .select()
        .from(financialContracts)
        .where(eq(financialContracts.id, input.linkedContractId))
        .get();
      if (!contract) {
        throw new DocumentLinkedEntityNotFoundError(
          "linkedContractId",
          input.linkedContractId,
        );
      }

      const targetBalanceCents =
        input.calibratedBalanceCents ?? input.detectedBalanceCents;
      if (targetBalanceCents == null) {
        throw new DocumentValidationError(
          "calibratedBalanceCents",
          "Für eine Vertrags-Eichung muss ein neuer Vertragsstand angegeben sein.",
        );
      }

      calibrationEvaluation = evaluateContractCalibration(
        contract,
        targetBalanceCents,
        input.calibrationDate ?? input.documentDate ?? null,
        todayIsoDate,
      );

      if (
        calibrationEvaluation.isOlderThanCurrentCalibration &&
        !input.allowOlderCalibrationDate
      ) {
        throw new ContractCalibrationConflictError(calibrationEvaluation);
      }

      const now = new Date().toISOString();
      const [updatedContract] = tx
        .update(financialContracts)
        .set({
          currentBalanceCents: calibrationEvaluation.newBalanceCents,
          balanceAsOfDate: calibrationEvaluation.effectiveDate,
          updatedAt: now,
        })
        .where(eq(financialContracts.id, contract.id))
        .returning()
        .all();

      if (!updatedContract) {
        throw new DocumentLinkedEntityNotFoundError(
          "linkedContractId",
          contract.id,
        );
      }

      calibratedContract = toContractRow(updatedContract);
      persistedDetectedBalanceCents = targetBalanceCents;
    }

    const [updatedDoc] = tx
      .update(documents)
      .set({
        filename: input.filename ?? existing.filename,
        status: "verified",
        documentType: input.documentType,
        documentDate: input.documentDate,
        issuer: input.issuer,
        totalAmountCents: input.totalAmountCents,
        linkedPropertyId: input.linkedPropertyId,
        linkedContractId: input.linkedContractId,
        isTaxRelevant: input.isTaxRelevant,
        taxYear: input.taxYear,
        taxCategory: input.taxCategory,
        deductibleAmountCents: input.deductibleAmountCents,
        detectedBalanceCents: persistedDetectedBalanceCents,
      })
      .where(eq(documents.id, id))
      .returning()
      .all();

    if (!updatedDoc) {
      throw new DocumentNotFoundError(id);
    }

    return {
      document: updatedDoc,
      calibratedContract,
      calibrationEvaluation,
    };
  });
}

export function applyAiExtractionIfPending(
  id: string,
  extraction: {
    documentType: DocumentType;
    documentDate: string | null;
    issuer: string | null;
    totalAmountCents: number | null;
    isTaxRelevant: boolean;
    taxYear: number | null;
    taxCategory: TaxCategory | null;
    deductibleAmountCents: number | null;
    detectedBalanceCents: number | null;
    extractedContractJson?: string | null;
  },
): DocumentRow {
  const db = getDb();

  return db.transaction((tx) => {
    const existing = tx
      .select()
      .from(documents)
      .where(eq(documents.id, id))
      .get();

    if (!existing) {
      throw new DocumentNotFoundError(id);
    }

    if (existing.status === "verified") {
      throw new DocumentAlreadyVerifiedError(id);
    }

    const [updated] = tx
      .update(documents)
      .set({
        documentType: extraction.documentType,
        documentDate: extraction.documentDate,
        issuer: extraction.issuer,
        totalAmountCents: extraction.totalAmountCents,
        isTaxRelevant: extraction.isTaxRelevant,
        taxYear: extraction.taxYear,
        taxCategory: extraction.taxCategory,
        deductibleAmountCents: extraction.deductibleAmountCents,
        detectedBalanceCents: extraction.detectedBalanceCents,
        extractedContractJson: extraction.extractedContractJson ?? null,
      })
      .where(and(eq(documents.id, id), eq(documents.status, "pending_review")))
      .returning()
      .all();

    if (!updated) {
      throw new DocumentAlreadyVerifiedError(id);
    }
    return updated;
  });
}

export interface CreateContractFromDocumentResult {
  contract: FinancialContractRow;
  document: DocumentRow;
}

export function createContractFromDocument(
  documentId: string,
  input: DocumentCreateContractInput,
): CreateContractFromDocumentResult {
  const db = getDb();

  return db.transaction((tx) => {
    const existing = tx
      .select()
      .from(documents)
      .where(eq(documents.id, documentId))
      .get();

    if (!existing) {
      throw new DocumentNotFoundError(documentId);
    }

    if (existing.linkedContractId !== null) {
      throw new DocumentAlreadyLinkedError(
        documentId,
        existing.linkedContractId,
      );
    }

    const effectiveDocPropertyId =
      input.document?.linkedPropertyId !== undefined
        ? input.document.linkedPropertyId
        : input.contract.linkedPropertyId;

    const propertyIdsToCheck = new Set<string>();
    if (input.contract.linkedPropertyId) {
      propertyIdsToCheck.add(input.contract.linkedPropertyId);
    }
    if (effectiveDocPropertyId) {
      propertyIdsToCheck.add(effectiveDocPropertyId);
    }

    for (const propertyId of propertyIdsToCheck) {
      const property = tx
        .select({ id: properties.id })
        .from(properties)
        .where(eq(properties.id, propertyId))
        .get();
      if (!property) {
        throw new DocumentLinkedEntityNotFoundError(
          "linkedPropertyId",
          propertyId,
        );
      }
    }

    const docPatch = input.document;
    const nextDocumentDate =
      docPatch?.documentDate !== undefined
        ? docPatch.documentDate
        : existing.documentDate;
    const nextTotalAmountCents =
      docPatch?.totalAmountCents !== undefined
        ? docPatch.totalAmountCents
        : existing.totalAmountCents;
    const nextIsTaxRelevant =
      docPatch?.isTaxRelevant !== undefined
        ? docPatch.isTaxRelevant
        : existing.isTaxRelevant;

    let nextTaxYear =
      docPatch?.taxYear !== undefined ? docPatch.taxYear : existing.taxYear;
    if (nextIsTaxRelevant && nextTaxYear == null && nextDocumentDate != null) {
      nextTaxYear = Number(nextDocumentDate.slice(0, 4));
    }

    const nextTaxCategory = nextIsTaxRelevant
      ? docPatch?.taxCategory !== undefined
        ? docPatch.taxCategory
        : existing.taxCategory
      : null;
    const nextDeductibleAmountCents = nextIsTaxRelevant
      ? docPatch?.deductibleAmountCents !== undefined
        ? docPatch.deductibleAmountCents
        : existing.deductibleAmountCents
      : null;

    if (
      nextTotalAmountCents != null &&
      nextDeductibleAmountCents != null &&
      nextDeductibleAmountCents > nextTotalAmountCents
    ) {
      throw new DocumentValidationError(
        "deductibleAmountCents",
        "Der absetzbare Betrag darf den Gesamtbetrag nicht übersteigen.",
      );
    }

    const now = new Date().toISOString();
    const [createdContract] = tx
      .insert(financialContracts)
      .values({
        id: crypto.randomUUID(),
        ...input.contract,
        updatedAt: now,
      })
      .returning()
      .all();

    if (!createdContract) {
      throw new Error("Vertrag konnte nicht angelegt werden.");
    }

    const [updatedDoc] = tx
      .update(documents)
      .set({
        filename: docPatch?.filename ?? existing.filename,
        status: "verified",
        documentType: docPatch?.documentType ?? existing.documentType,
        documentDate: nextDocumentDate,
        issuer:
          docPatch?.issuer !== undefined ? docPatch.issuer : existing.issuer,
        totalAmountCents: nextTotalAmountCents,
        linkedPropertyId: effectiveDocPropertyId,
        linkedContractId: createdContract.id,
        isTaxRelevant: nextIsTaxRelevant,
        taxYear: nextTaxYear,
        taxCategory: nextTaxCategory,
        deductibleAmountCents: nextDeductibleAmountCents,
        detectedBalanceCents:
          docPatch?.detectedBalanceCents !== undefined
            ? docPatch.detectedBalanceCents
            : existing.detectedBalanceCents,
      })
      .where(eq(documents.id, documentId))
      .returning()
      .all();

    if (!updatedDoc) {
      throw new DocumentNotFoundError(documentId);
    }

    return {
      contract: toContractRow(createdContract),
      document: updatedDoc,
    };
  });
}

export function deleteDocumentRecord(id: string): DocumentRow {
  const db = getDb();
  const [deleted] = db
    .delete(documents)
    .where(eq(documents.id, id))
    .returning()
    .all();

  if (!deleted) {
    throw new DocumentNotFoundError(id);
  }
  return deleted;
}
