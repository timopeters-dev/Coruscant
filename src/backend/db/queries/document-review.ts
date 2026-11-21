import { and, eq } from "drizzle-orm";
import { getDb } from "@/backend/db/connection";
import { firstRow, newId, nowIso, type DbTx } from "@/backend/db/helpers";
import { documents, financialContracts } from "@/backend/db/schema";
import type { FieldErrors } from "@/backend/errors";
import {
  evaluateContractCalibration, type ContractCalibrationEvaluation, type DocumentType,
  type TaxCategory,
} from "@/domain/documents/documents";
import { contractCreateSchema } from "@/validation/contracts";
import type { DocumentCreateContractInput, DocumentVerifyInput } from "@/validation/documents";
import { toContractRow, type FinancialContractRow } from "./contracts";
import {
  assertLinkedEntitiesExist,
  ContractCalibrationConflictError,
  ContractLoanOptionsValidationError,
  DocumentAlreadyLinkedError,
  DocumentAlreadyVerifiedError,
  DocumentLinkedEntityNotFoundError,
  DocumentNotFoundError,
  DocumentValidationError,
  mergeDocumentMetadata,
  type DocumentRow,
} from "./documents";

type StoredContract = typeof financialContracts.$inferSelect;

function requireDocument(tx: DbTx, id: string): DocumentRow {
  const doc = tx.select().from(documents).where(eq(documents.id, id)).get();
  if (!doc) throw new DocumentNotFoundError();
  return doc;
}

function requireLinkedContract(tx: DbTx, contractId: string | null | undefined, missingMessage: string): StoredContract {
  if (!contractId) throw new DocumentValidationError("linkedContractId", missingMessage);
  const contract = tx.select().from(financialContracts).where(eq(financialContracts.id, contractId)).get();
  if (!contract) throw new DocumentLinkedEntityNotFoundError("linkedContractId", contractId);
  return contract;
}

/** Eichung: Der Vertragsstand wird auf den Belegwert zum Belegdatum gesetzt. */
function calibrateContract(tx: DbTx, input: DocumentVerifyInput, todayIsoDate: string) {
  const contract = requireLinkedContract(tx, input.linkedContractId, "Für eine Vertrags-Eichung muss ein Vertrag verknüpft sein.");
  const targetBalanceCents = input.calibratedBalanceCents ?? input.detectedBalanceCents;
  if (targetBalanceCents == null) {
    throw new DocumentValidationError("calibratedBalanceCents", "Für eine Vertrags-Eichung muss ein neuer Vertragsstand angegeben sein.");
  }
  if (contract.category === "loan" && targetBalanceCents < 0) {
    throw new DocumentValidationError("calibratedBalanceCents", "Die Restschuld eines Darlehens darf nicht negativ sein.");
  }

  const evaluation = evaluateContractCalibration(
    contract,
    targetBalanceCents,
    input.calibrationDate ?? input.documentDate ?? null,
    todayIsoDate,
  );
  if (evaluation.isOlderThanCurrentCalibration && !input.allowOlderCalibrationDate) {
    throw new ContractCalibrationConflictError(evaluation);
  }
  const [updated] = tx
    .update(financialContracts)
    .set({ currentBalanceCents: evaluation.newBalanceCents, balanceAsOfDate: evaluation.effectiveDate, updatedAt: nowIso() })
    .where(eq(financialContracts.id, contract.id))
    .returning()
    .all();
  if (!updated) throw new DocumentLinkedEntityNotFoundError("linkedContractId", contract.id);
  return { contract: toContractRow(updated), evaluation, targetBalanceCents };
}

/** Vertragsrechte, die ein Beleg liefern kann. Nutzungszähler überschreibt er nie. */
const LOAN_OPTION_KEYS = [
  "originalPrincipalCents",
  "specialRepaymentRight",
  "specialRepaymentBasis",
  "specialRepaymentMaxYearlyCents",
  "specialRepaymentPercentBps",
  "rateChangeRight",
  "rateChangeTotalCount",
  "rateChangeScope",
  "rateChangeMinRepaymentBps",
  "rateChangeMaxRepaymentBps",
  "rateChangeMinMonthlyCents",
  "rateChangeMaxMonthlyCents",
] as const;

/** Übernimmt erkannte Darlehensoptionen; leere Werte lassen den Bestand stehen. */
function applyLoanOptions(tx: DbTx, input: DocumentVerifyInput): FinancialContractRow | null {
  const contract = requireLinkedContract(tx, input.linkedContractId, "Für die Übernahme von Darlehensoptionen muss ein Kredit verknüpft sein.");
  if (contract.category !== "loan") {
    throw new DocumentValidationError("applyLoanOptions", "Darlehensoptionen können nur auf Kredite übernommen werden.");
  }

  const incoming = input.loanOptions ?? {};
  const candidate: Record<string, unknown> = { ...contract };
  for (const key of LOAN_OPTION_KEYS) {
    if (incoming[key] != null) candidate[key] = incoming[key];
  }
  const validated = contractCreateSchema.safeParse(candidate);
  if (!validated.success) {
    const fieldErrors: FieldErrors = {};
    for (const issue of validated.error.issues) fieldErrors[issue.path.join(".") || "loanOptions"] ??= issue.message;
    throw new ContractLoanOptionsValidationError(fieldErrors);
  }

  const options = Object.fromEntries(LOAN_OPTION_KEYS.map((key) => [key, validated.data[key]]));
  const [updated] = tx
    .update(financialContracts)
    .set({ ...options, updatedAt: nowIso() })
    .where(eq(financialContracts.id, contract.id))
    .returning()
    .all();
  return updated ? toContractRow(updated) : null;
}

export interface VerifyDocumentResult {
  document: DocumentRow;
  calibratedContract: FinancialContractRow | null;
  calibrationEvaluation: ContractCalibrationEvaluation | null;
}

/** Bestätigt einen Beleg und eicht optional den verknüpften Vertrag – alles oder nichts. */
export function verifyDocumentAndOptionallyCalibrate(id: string, input: DocumentVerifyInput, todayIsoDate: string): VerifyDocumentResult {
  return getDb().transaction((tx) => {
    const existing = requireDocument(tx, id);
    assertLinkedEntitiesExist(tx, input);

    let calibratedContract: FinancialContractRow | null = null;
    let calibrationEvaluation: ContractCalibrationEvaluation | null = null;
    let detectedBalanceCents = input.detectedBalanceCents ?? null;
    if (input.calibrateContract) {
      const calibration = calibrateContract(tx, input, todayIsoDate);
      calibratedContract = calibration.contract;
      calibrationEvaluation = calibration.evaluation;
      detectedBalanceCents = calibration.targetBalanceCents;
    }
    if (input.applyLoanOptions) calibratedContract = applyLoanOptions(tx, input) ?? calibratedContract;

    const [document] = tx
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
        detectedBalanceCents,
      })
      .where(eq(documents.id, id))
      .returning()
      .all();
    if (!document) throw new DocumentNotFoundError();
    return { document, calibratedContract, calibrationEvaluation };
  });
}

export interface AiExtractionFields {
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
}

/** KI-Vorschlag übernehmen – nur solange der Beleg noch nicht verifiziert ist. */
export function applyAiExtractionIfPending(id: string, extraction: AiExtractionFields): DocumentRow {
  return getDb().transaction((tx) => {
    if (requireDocument(tx, id).status === "verified") throw new DocumentAlreadyVerifiedError();
    const [updated] = tx
      .update(documents)
      .set({ ...extraction, extractedContractJson: extraction.extractedContractJson ?? null })
      .where(and(eq(documents.id, id), eq(documents.status, "pending_review")))
      .returning()
      .all();
    if (!updated) throw new DocumentAlreadyVerifiedError();
    return updated;
  });
}

export interface CreateContractFromDocumentResult {
  contract: FinancialContractRow;
  document: DocumentRow;
}

/** Legt aus einem Beleg einen neuen Vertrag an und verifiziert den Beleg damit verknüpft. */
export function createContractFromDocument(documentId: string, input: DocumentCreateContractInput): CreateContractFromDocumentResult {
  return getDb().transaction((tx) => {
    const existing = requireDocument(tx, documentId);
    if (existing.linkedContractId !== null) throw new DocumentAlreadyLinkedError(existing.linkedContractId);

    const docPropertyId = input.document?.linkedPropertyId !== undefined ? input.document.linkedPropertyId : input.contract.linkedPropertyId;
    for (const propertyId of new Set([input.contract.linkedPropertyId, docPropertyId])) {
      assertLinkedEntitiesExist(tx, { linkedPropertyId: propertyId });
    }
    const metadata = mergeDocumentMetadata(existing, input.document);

    const contract = firstRow(
      tx.insert(financialContracts).values({ id: newId(), ...input.contract, updatedAt: nowIso() }).returning().all(),
      "contract",
    );
    const [document] = tx
      .update(documents)
      .set({ ...metadata, status: "verified", linkedPropertyId: docPropertyId, linkedContractId: contract.id })
      .where(eq(documents.id, documentId))
      .returning()
      .all();
    if (!document) throw new DocumentNotFoundError();
    return { contract: toContractRow(contract), document };
  });
}
