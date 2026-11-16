import {
  type DomainContract,
  projectContractBalance,
} from "./contracts";
import { parseIsoDate } from "./date";
import {
  assertNonNegativeInteger,
  assertSafeInteger,
  roundHalfUpBigInt,
} from "./money";

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

export interface TaxCategorySummary {
  category: TaxCategory;
  documentCount: number;
  totalAmountCents: number;
  deductibleAmountCents: number;
}

export interface TaxYearSummary {
  taxYear: number | null;
  documentCount: number;
  totalAmountCents: number;
  totalDeductibleCents: number;
  section35aBaseCents: number;
  estimatedSection35aCreditCents: number;
  byCategory: TaxCategorySummary[];
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
  const newBalanceCents = assertNonNegativeInteger(
    candidateBalanceCents,
    "candidateBalanceCents",
  );
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

/**
 * Summarizes verified, tax-relevant documents for an optional tax year,
 * computing category totals and an informative 20% § 35a credit estimate.
 */
export function summarizeTaxDocuments(
  documents: readonly DomainDocument[],
  taxYearFilter?: number | null,
): TaxYearSummary {
  const relevantDocs = filterVerifiedDocuments(documents, {
    taxYear: taxYearFilter ?? null,
    onlyTaxRelevant: true,
  });

  const categoryTotals = new Map<
    TaxCategory,
    { documentCount: number; totalAmountCents: number; deductibleAmountCents: number }
  >();

  let totalAmountCents = 0;
  let totalDeductibleCents = 0;
  let section35aBaseCents = 0;

  for (const doc of relevantDocs) {
    const docTotal =
      doc.totalAmountCents != null
        ? assertNonNegativeInteger(doc.totalAmountCents, "totalAmountCents")
        : 0;
    const docDeductible =
      doc.deductibleAmountCents != null
        ? assertNonNegativeInteger(
            doc.deductibleAmountCents,
            "deductibleAmountCents",
          )
        : 0;

    const category: TaxCategory = doc.taxCategory ?? "other";
    const existing = categoryTotals.get(category) ?? {
      documentCount: 0,
      totalAmountCents: 0,
      deductibleAmountCents: 0,
    };

    existing.documentCount += 1;
    existing.totalAmountCents = assertNonNegativeInteger(
      existing.totalAmountCents + docTotal,
      "categoryTotalAmountCents",
    );
    existing.deductibleAmountCents = assertNonNegativeInteger(
      existing.deductibleAmountCents + docDeductible,
      "categoryDeductibleAmountCents",
    );
    categoryTotals.set(category, existing);

    totalAmountCents = assertNonNegativeInteger(
      totalAmountCents + docTotal,
      "totalAmountCents",
    );
    totalDeductibleCents = assertNonNegativeInteger(
      totalDeductibleCents + docDeductible,
      "totalDeductibleCents",
    );

    if (
      category === "handwerker_35a" ||
      category === "haushaltsnahe_dl_35a"
    ) {
      section35aBaseCents = assertNonNegativeInteger(
        section35aBaseCents + docDeductible,
        "section35aBaseCents",
      );
    }
  }

  const byCategory: TaxCategorySummary[] = [];
  for (const category of TAX_CATEGORIES) {
    const entry = categoryTotals.get(category);
    if (entry) {
      byCategory.push({
        category,
        documentCount: entry.documentCount,
        totalAmountCents: entry.totalAmountCents,
        deductibleAmountCents: entry.deductibleAmountCents,
      });
    }
  }

  const estimatedSection35aCreditCents = Number(
    roundHalfUpBigInt(BigInt(section35aBaseCents) * 20n, 100n),
  );

  return {
    taxYear: taxYearFilter ?? null,
    documentCount: relevantDocs.length,
    totalAmountCents,
    totalDeductibleCents,
    section35aBaseCents,
    estimatedSection35aCreditCents,
    byCategory,
  };
}
