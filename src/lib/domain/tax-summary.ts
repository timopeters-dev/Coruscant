import {
  type DomainDocument,
  resolveDocumentTaxYear,
  TAX_CATEGORIES,
  type TaxCategory,
} from "./documents";
import { assertNonNegativeInteger, roundHalfUpBigInt } from "./money";

export type TaxBucket = TaxCategory | "unassigned";

/** Anzeige-/Sortierreihenfolge der Buckets. */
export const TAX_BUCKETS: readonly TaxBucket[] = [
  ...TAX_CATEGORIES,
  "unassigned",
];

/** Buckets, deren Beträge nur informativ sind und nicht in „Absetzbar gesamt“ einfließen. */
export const INFORMATIONAL_TAX_BUCKETS: ReadonlySet<TaxBucket> = new Set<TaxBucket>([
  "capital_gains",
]);

/**
 * Buckets, deren Beträge nicht in „Absetzbar gesamt“ einfließen: Kapitalerträge sind
 * informativ, bei Belegen ohne Kategorie lässt sich die Absetzbarkeit nicht beurteilen.
 */
export const EXCLUDED_FROM_DEDUCTIBLE_TOTAL: ReadonlySet<TaxBucket> = new Set<TaxBucket>([
  "capital_gains",
  "unassigned",
]);

export type TaxDocumentIssue =
  | "missing_category"
  | "missing_deductible"
  | "missing_labor_share"
  | "missing_total"
  | "deductible_exceeds_total";

export type Section35aCategory = "handwerker_35a" | "haushaltsnahe_dl_35a";

export interface Section35aRule {
  category: Section35aCategory;
  /** Erstes Steuerjahr (inklusiv), ab dem die Regel gilt. */
  validFromYear: number;
  /** Ermäßigungssatz in Basispunkten (2000 = 20 %). */
  rateBps: number;
  /** Höchstbetrag der Steuerermäßigung in Cent. */
  maxCreditCents: number;
  legalReference: string;
}

export const SECTION_35A_RULES: readonly Section35aRule[] = [
  {
    category: "handwerker_35a",
    validFromYear: 2009,
    rateBps: 2000,
    maxCreditCents: 120_000,
    legalReference: "§ 35a Abs. 3 EStG",
  },
  {
    category: "haushaltsnahe_dl_35a",
    validFromYear: 2009,
    rateBps: 2000,
    maxCreditCents: 400_000,
    legalReference: "§ 35a Abs. 2 EStG",
  },
];

/** Letztes Steuerjahr, für das die Regeltabelle gegen den Rechtsstand geprüft wurde. */
export const SECTION_35A_RULES_REVIEWED_THROUGH_YEAR = 2025;

export type Section35aRuleStatus = "reviewed" | "unreviewed" | "no_rule";

export interface Section35aEstimate {
  category: Section35aCategory;
  ruleStatus: Section35aRuleStatus;
  rule: Section35aRule | null;
  laborBaseCents: number;
  rawCreditCents: number;
  creditCents: number;
  maxEligibleBaseCents: number;
  baseAboveCapCents: number;
  isCapped: boolean;
}

export interface TaxSummaryItem {
  documentId: string;
  filename: string;
  issuer: string | null;
  documentDate: string | null;
  linkedPropertyId: string | null;
  bucket: TaxBucket;
  totalAmountCents: number | null;
  deductibleAmountCents: number | null;
  issues: TaxDocumentIssue[];
}

export interface TaxBucketSummary {
  bucket: TaxBucket;
  isInformational: boolean;
  /** true: Betrag wird gezeigt, zählt aber nicht als absetzbar (Kapitalerträge, unzugeordnet). */
  isExcludedFromDeductibleTotal: boolean;
  documentCount: number;
  incompleteCount: number;
  totalAmountCents: number;
  deductibleAmountCents: number;
  section35a: Section35aEstimate | null;
}

export interface TaxYearSummary {
  taxYear: number;
  documentCount: number;
  incompleteCount: number;
  pendingReviewCount: number;
  totalAmountCents: number;
  totalDeductibleCents: number;
  section35aCreditCents: number;
  buckets: TaxBucketSummary[];
  items: TaxSummaryItem[];
}

export type TaxSummaryInputDocument = Pick<
  DomainDocument,
  | "id"
  | "status"
  | "documentDate"
  | "issuer"
  | "totalAmountCents"
  | "linkedPropertyId"
  | "isTaxRelevant"
  | "taxYear"
  | "taxCategory"
  | "deductibleAmountCents"
> & { filename: string };

export function isSection35aCategory(
  bucket: TaxBucket,
): bucket is Section35aCategory {
  return bucket === "handwerker_35a" || bucket === "haushaltsnahe_dl_35a";
}

/**
 * Jüngste Regel mit `validFromYear <= taxYear`. Jahre jenseits des geprüften
 * Rechtsstands werden mit der jüngsten Regel gerechnet, aber als `unreviewed` markiert.
 */
export function resolveSection35aRule(
  category: Section35aCategory,
  taxYear: number,
  rules: readonly Section35aRule[] = SECTION_35A_RULES,
  reviewedThroughYear: number = SECTION_35A_RULES_REVIEWED_THROUGH_YEAR,
): { rule: Section35aRule | null; ruleStatus: Section35aRuleStatus } {
  let best: Section35aRule | null = null;
  for (const rule of rules) {
    if (rule.category !== category || rule.validFromYear > taxYear) continue;
    if (best === null || rule.validFromYear > best.validFromYear) {
      best = rule;
    }
  }
  if (best === null) {
    return { rule: null, ruleStatus: "no_rule" };
  }
  return {
    rule: best,
    ruleStatus: taxYear > reviewedThroughYear ? "unreviewed" : "reviewed",
  };
}

export function estimateSection35a(
  category: Section35aCategory,
  taxYear: number,
  laborBaseCents: number,
  rules: readonly Section35aRule[] = SECTION_35A_RULES,
  reviewedThroughYear: number = SECTION_35A_RULES_REVIEWED_THROUGH_YEAR,
): Section35aEstimate {
  const base = assertNonNegativeInteger(laborBaseCents, "laborBaseCents");
  const { rule, ruleStatus } = resolveSection35aRule(
    category,
    taxYear,
    rules,
    reviewedThroughYear,
  );

  if (rule === null) {
    return {
      category,
      ruleStatus,
      rule: null,
      laborBaseCents: base,
      rawCreditCents: 0,
      creditCents: 0,
      maxEligibleBaseCents: 0,
      baseAboveCapCents: 0,
      isCapped: false,
    };
  }

  if (rule.rateBps <= 0) {
    throw new RangeError("rateBps must be positive");
  }
  const rate = BigInt(rule.rateBps);
  const rawCreditCents = Number(
    roundHalfUpBigInt(BigInt(base) * rate, 10_000n),
  );
  const creditCents = Math.min(rawCreditCents, rule.maxCreditCents);
  const maxEligibleBaseCents = Number(
    (BigInt(rule.maxCreditCents) * 10_000n) / rate,
  );

  return {
    category,
    ruleStatus,
    rule,
    laborBaseCents: base,
    rawCreditCents,
    creditCents,
    maxEligibleBaseCents,
    baseAboveCapCents: Math.max(0, base - maxEligibleBaseCents),
    isCapped: rawCreditCents > rule.maxCreditCents,
  };
}

type YearDocument = Pick<
  TaxSummaryInputDocument,
  "status" | "isTaxRelevant" | "taxYear" | "documentDate"
>;

/** Verfügbare Steuerjahre (absteigend) aus verifizierten, steuerrelevanten Belegen. */
export function listTaxYears(documents: readonly YearDocument[]): number[] {
  const years = new Set<number>();
  for (const doc of documents) {
    if (doc.status !== "verified" || !doc.isTaxRelevant) continue;
    const year = resolveDocumentTaxYear(doc);
    if (year !== null) years.add(year);
  }
  return Array.from(years).sort((a, b) => b - a);
}

/** Neuestes vorhandenes Jahr, sonst das Vorjahr von `todayIsoDate`. */
export function resolveDefaultTaxYear(
  availableYears: readonly number[],
  todayIsoDate: string,
): number {
  if (availableYears.length > 0) {
    return Math.max(...availableYears);
  }
  const match = /^(\d{4})-\d{2}-\d{2}$/.exec(todayIsoDate);
  if (!match) {
    throw new RangeError(`todayIsoDate is invalid: ${todayIsoDate}`);
  }
  return Number(match[1]) - 1;
}

function compareNullableDateAsc(a: string | null, b: string | null): number {
  if (a === b) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  return a < b ? -1 : 1;
}

function classifyIssues(
  bucket: TaxBucket,
  total: number | null,
  deductible: number | null,
): TaxDocumentIssue[] {
  const issues: TaxDocumentIssue[] = [];
  if (bucket === "unassigned") issues.push("missing_category");
  if (total === null) issues.push("missing_total");
  if (
    deductible === null &&
    bucket !== "unassigned" &&
    !INFORMATIONAL_TAX_BUCKETS.has(bucket)
  ) {
    issues.push(
      isSection35aCategory(bucket) ? "missing_labor_share" : "missing_deductible",
    );
  }
  if (total !== null && deductible !== null && deductible > total) {
    issues.push("deductible_exceeds_total");
  }
  return issues;
}

export function summarizeTaxYear(
  documents: readonly TaxSummaryInputDocument[],
  taxYear: number,
  rules: readonly Section35aRule[] = SECTION_35A_RULES,
  reviewedThroughYear: number = SECTION_35A_RULES_REVIEWED_THROUGH_YEAR,
): TaxYearSummary {
  if (!Number.isInteger(taxYear) || taxYear < 1900 || taxYear > 2100) {
    throw new RangeError(`taxYear must be an integer 1900-2100, received: ${String(taxYear)}`);
  }

  let pendingReviewCount = 0;
  const items: TaxSummaryItem[] = [];

  for (const doc of documents) {
    if (!doc.isTaxRelevant) continue;
    if (resolveDocumentTaxYear(doc) !== taxYear) continue;

    if (doc.status === "pending_review") {
      pendingReviewCount += 1;
      continue;
    }
    if (doc.status !== "verified") continue;

    const total =
      doc.totalAmountCents === null
        ? null
        : assertNonNegativeInteger(doc.totalAmountCents, "totalAmountCents");
    const deductible =
      doc.deductibleAmountCents === null
        ? null
        : assertNonNegativeInteger(
            doc.deductibleAmountCents,
            "deductibleAmountCents",
          );
    const bucket: TaxBucket = doc.taxCategory ?? "unassigned";

    items.push({
      documentId: doc.id,
      filename: doc.filename,
      issuer: doc.issuer,
      documentDate: doc.documentDate,
      linkedPropertyId: doc.linkedPropertyId,
      bucket,
      totalAmountCents: total,
      deductibleAmountCents: deductible,
      issues: classifyIssues(bucket, total, deductible),
    });
  }

  const bucketOrder = (bucket: TaxBucket) => TAX_BUCKETS.indexOf(bucket);
  items.sort(
    (a, b) =>
      bucketOrder(a.bucket) - bucketOrder(b.bucket) ||
      compareNullableDateAsc(a.documentDate, b.documentDate) ||
      (a.documentId < b.documentId ? -1 : a.documentId > b.documentId ? 1 : 0),
  );

  let totalAmountCents = 0;
  let totalDeductibleCents = 0;
  let section35aCreditCents = 0;
  let incompleteCount = 0;
  const buckets: TaxBucketSummary[] = [];

  for (const bucket of TAX_BUCKETS) {
    const bucketItems = items.filter((item) => item.bucket === bucket);
    if (bucketItems.length === 0) continue;

    let bucketTotal = 0;
    let bucketDeductible = 0;
    let bucketIncomplete = 0;
    for (const item of bucketItems) {
      bucketTotal = assertNonNegativeInteger(
        bucketTotal + (item.totalAmountCents ?? 0),
        "bucketTotalAmountCents",
      );
      bucketDeductible = assertNonNegativeInteger(
        bucketDeductible + (item.deductibleAmountCents ?? 0),
        "bucketDeductibleAmountCents",
      );
      if (item.issues.length > 0) bucketIncomplete += 1;
    }

    const isInformational = INFORMATIONAL_TAX_BUCKETS.has(bucket);
    const section35a = isSection35aCategory(bucket)
      ? estimateSection35a(bucket, taxYear, bucketDeductible, rules, reviewedThroughYear)
      : null;

    totalAmountCents = assertNonNegativeInteger(
      totalAmountCents + bucketTotal,
      "totalAmountCents",
    );
    const isExcludedFromDeductibleTotal = EXCLUDED_FROM_DEDUCTIBLE_TOTAL.has(bucket);
    if (!isExcludedFromDeductibleTotal) {
      totalDeductibleCents = assertNonNegativeInteger(
        totalDeductibleCents + bucketDeductible,
        "totalDeductibleCents",
      );
    }
    if (section35a) {
      section35aCreditCents += section35a.creditCents;
    }
    incompleteCount += bucketIncomplete;

    buckets.push({
      bucket,
      isInformational,
      isExcludedFromDeductibleTotal,
      documentCount: bucketItems.length,
      incompleteCount: bucketIncomplete,
      totalAmountCents: bucketTotal,
      deductibleAmountCents: bucketDeductible,
      section35a,
    });
  }

  return {
    taxYear,
    documentCount: items.length,
    incompleteCount,
    pendingReviewCount,
    totalAmountCents,
    totalDeductibleCents,
    section35aCreditCents,
    buckets,
    items,
  };
}
