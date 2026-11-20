import {
  type DomainContract,
  projectContractBalance,
} from "./contracts";
import { parseIsoDate } from "./date";
import { assertNonNegativeInteger, assertSafeInteger } from "./money";

export type DocumentStatus = "pending_review" | "verified";

export type DocumentType =
  | "invoice"
  | "bauspar_statement"
  | "loan_statement"
  | "contract"
  | "tax_notice"
  | "other";

export type TaxCategory =
  | "handwerker_35a"
  | "haushaltsnahe_dl_35a"
  | "werbungskosten_vv"
  | "capital_gains"
  | "other";

export const TAX_CATEGORIES: readonly TaxCategory[] = [
  "handwerker_35a",
  "haushaltsnahe_dl_35a",
  "werbungskosten_vv",
  "capital_gains",
  "other",
] as const;

export interface DomainDocument {
  id: string;
  status: DocumentStatus;
  documentType: DocumentType;
  documentDate: string | null;
  issuer: string | null;
  totalAmountCents: number | null;
  linkedPropertyId: string | null;
  linkedContractId: string | null;
  isTaxRelevant: boolean;
  taxYear: number | null;
  taxCategory: TaxCategory | null;
  deductibleAmountCents: number | null;
  detectedBalanceCents: number | null;
  createdAt: string;
}

export interface ContractCalibrationEvaluation {
  effectiveDate: string;
  isOlderThanCurrentCalibration: boolean;
  previousBalanceCents: number;
  previousAsOfDate: string;
  projectedBalanceAtDateCents: number;
  newBalanceCents: number;
  deltaToStoredCents: number;
  deltaToProjectedCents: number;
}

export interface VerifiedDocumentFilters {
  taxYear?: number | null;
  propertyId?: string | null;
  contractId?: string | null;
  onlyTaxRelevant?: boolean;
}

/**
 * Evaluates a candidate contract balance calibration against the currently stored
 * calibration date and the domain-projected balance at the effective date.
 */
export function evaluateContractCalibration(
  contract: DomainContract,
  candidateBalanceCents: number,
  candidateDate: string | null,
  fallbackDate: string,
): ContractCalibrationEvaluation {
  // Bauspar-Auszüge können negativ sein (Abschlussgebühr), Darlehen nicht.
  const newBalanceCents =
    contract.category === "savings_contract"
      ? assertSafeInteger(candidateBalanceCents, "candidateBalanceCents")
      : assertNonNegativeInteger(candidateBalanceCents, "candidateBalanceCents");
  parseIsoDate(fallbackDate, "fallbackDate");
  if (candidateDate !== null) {
    parseIsoDate(candidateDate, "candidateDate");
  }

  const effectiveDate = candidateDate ?? fallbackDate;
  const projection = projectContractBalance(contract, effectiveDate);
  const previousBalanceCents = contract.currentBalanceCents;
  const projectedBalanceAtDateCents = projection.projectedBalanceCents;

  return {
    effectiveDate,
    isOlderThanCurrentCalibration: effectiveDate < contract.balanceAsOfDate,
    previousBalanceCents,
    previousAsOfDate: contract.balanceAsOfDate,
    projectedBalanceAtDateCents,
    newBalanceCents,
    deltaToStoredCents: newBalanceCents - previousBalanceCents,
    deltaToProjectedCents: newBalanceCents - projectedBalanceAtDateCents,
  };
}

/**
 * Resolves the effective tax year from an explicit taxYear or a valid documentDate.
 */
export function resolveDocumentTaxYear(
  document: Pick<DomainDocument, "taxYear" | "documentDate">,
): number | null {
  if (document.taxYear != null) {
    return assertSafeInteger(document.taxYear, "taxYear");
  }
  if (document.documentDate != null) {
    try {
      return parseIsoDate(document.documentDate, "documentDate").year;
    } catch {
      return null;
    }
  }
  return null;
}

/**
 * Filters a list of documents to strictly verified entries matching the given filters.
 */
export function filterVerifiedDocuments<
  T extends Pick<
    DomainDocument,
    | "status"
    | "taxYear"
    | "documentDate"
    | "linkedPropertyId"
    | "linkedContractId"
    | "isTaxRelevant"
  >,
>(documents: readonly T[], filters: VerifiedDocumentFilters = {}): T[] {
  return documents.filter((doc) => {
    if (doc.status !== "verified") {
      return false;
    }
    if (
      filters.taxYear != null &&
      resolveDocumentTaxYear(doc) !== filters.taxYear
    ) {
      return false;
    }
    if (
      filters.propertyId != null &&
      doc.linkedPropertyId !== filters.propertyId
    ) {
      return false;
    }
    if (
      filters.contractId != null &&
      doc.linkedContractId !== filters.contractId
    ) {
      return false;
    }
    if (filters.onlyTaxRelevant && !doc.isTaxRelevant) {
      return false;
    }
    return true;
  });
}
