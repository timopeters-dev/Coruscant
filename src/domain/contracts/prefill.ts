import type { ContractCategory, RepaymentType } from "./contract";
import type { OptionRight, RateChangeScope, SpecialRepaymentBasis } from "./loan-options";
import { formatBpsDE, formatEuroDE } from "@/domain/core/money";

export interface ExtractedContractData {
  name?: string | null;
  provider?: string | null;
  category?: ContractCategory | null;
  currentBalanceCents?: number | null;
  balanceAsOfDate?: string | null;
  monthlyRateCents?: number | null;
  interestRateBps?: number | null;
  repaymentType?: RepaymentType | null;
  originalPrincipalCents?: number | null;
  specialRepaymentRight?: OptionRight | null;
  specialRepaymentBasis?: SpecialRepaymentBasis | null;
  specialRepaymentMaxYearlyCents?: number | null;
  specialRepaymentPercentBps?: number | null;
  rateChangeRight?: OptionRight | null;
  rateChangeTotalCount?: number | null;
  rateChangeScope?: RateChangeScope | null;
  rateChangeMinRepaymentBps?: number | null;
  rateChangeMaxRepaymentBps?: number | null;
  rateChangeMinMonthlyCents?: number | null;
  rateChangeMaxMonthlyCents?: number | null;
  fixedInterestUntil?: string | null;
  targetSumCents?: number | null;
  allocationThresholdPercent?: number | null;
  futureLoanInterestRateBps?: number | null;
  milestoneDate?: string | null;
  milestoneLabel?: string | null;
}

export interface ContractPrefillSource {
  documentDate: string | null;
  issuer: string | null;
  detectedBalanceCents: number | null;
  extractedContract: ExtractedContractData | null;
  todayIsoDate: string;
}

export interface ContractPrefillValues {
  name: string | null;
  provider: string | null;
  category: ContractCategory;
  currentBalanceCents: number | null;
  balanceAsOfDate: string;
  monthlyRateCents: number | null;
  interestRateBps: number | null;
  repaymentType: RepaymentType;
  originalPrincipalCents: number | null;
  specialRepaymentRight: OptionRight;
  specialRepaymentBasis: SpecialRepaymentBasis | null;
  specialRepaymentMaxYearlyCents: number | null;
  specialRepaymentPercentBps: number | null;
  rateChangeRight: OptionRight;
  rateChangeTotalCount: number | null;
  rateChangeScope: RateChangeScope | null;
  rateChangeMinRepaymentBps: number | null;
  rateChangeMaxRepaymentBps: number | null;
  rateChangeMinMonthlyCents: number | null;
  rateChangeMaxMonthlyCents: number | null;
  fixedInterestUntil: string | null;
  targetSumCents: number | null;
  allocationThresholdPercent: number | null;
  futureLoanInterestRateBps: number | null;
  milestoneDate: string | null;
  milestoneLabel: string | null;
}

export interface ContractPrefillResult {
  values: ContractPrefillValues;
  reviewHints: string[];
  hasExtractedContract: boolean;
  hasExtractedLoanOptions: boolean;
}

function normalizeOptionalText(value: string | null | undefined): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function resolveCleanedLoanOptions(
  ec: ExtractedContractData | null | undefined,
  repaymentType: RepaymentType,
): {
  originalPrincipalCents: number | null;
  specialRepaymentRight: OptionRight;
  specialRepaymentBasis: SpecialRepaymentBasis | null;
  specialRepaymentMaxYearlyCents: number | null;
  specialRepaymentPercentBps: number | null;
  rateChangeRight: OptionRight;
  rateChangeTotalCount: number | null;
  rateChangeScope: RateChangeScope | null;
  rateChangeMinRepaymentBps: number | null;
  rateChangeMaxRepaymentBps: number | null;
  rateChangeMinMonthlyCents: number | null;
  rateChangeMaxMonthlyCents: number | null;
  hasAnyOption: boolean;
  hints: string[];
} {
  const hints: string[] = [];
  const originalPrincipalCents =
    ec?.originalPrincipalCents != null && ec.originalPrincipalCents > 0
      ? ec.originalPrincipalCents
      : null;

  const rawSrRight = ec?.specialRepaymentRight ?? null;
  const rawSrBasis = ec?.specialRepaymentBasis ?? null;
  const rawSrMax =
    ec?.specialRepaymentMaxYearlyCents != null
      ? ec.specialRepaymentMaxYearlyCents
      : null;
  const rawSrPct =
    ec?.specialRepaymentPercentBps != null
      ? ec.specialRepaymentPercentBps
      : null;

  const rawRcRight = ec?.rateChangeRight ?? null;
  const rawRcCount =
    ec?.rateChangeTotalCount != null ? ec.rateChangeTotalCount : null;
  const rawRcScope = ec?.rateChangeScope ?? null;
  const rawRcMinBps =
    ec?.rateChangeMinRepaymentBps != null ? ec.rateChangeMinRepaymentBps : null;
  const rawRcMaxBps =
    ec?.rateChangeMaxRepaymentBps != null ? ec.rateChangeMaxRepaymentBps : null;
  const rawRcMinCents =
    ec?.rateChangeMinMonthlyCents != null ? ec.rateChangeMinMonthlyCents : null;
  const rawRcMaxCents =
    ec?.rateChangeMaxMonthlyCents != null ? ec.rateChangeMaxMonthlyCents : null;

  const hasAnyOption =
    originalPrincipalCents !== null ||
    rawSrRight !== null ||
    rawSrBasis !== null ||
    rawSrMax !== null ||
    rawSrPct !== null ||
    rawRcRight !== null ||
    rawRcCount !== null ||
    rawRcScope !== null ||
    rawRcMinBps !== null ||
    rawRcMaxBps !== null ||
    rawRcMinCents !== null ||
    rawRcMaxCents !== null;

  // Clean special repayment group
  let specialRepaymentRight: OptionRight = "unknown";
  let specialRepaymentBasis: SpecialRepaymentBasis | null = null;
  let specialRepaymentMaxYearlyCents: number | null = null;
  let specialRepaymentPercentBps: number | null = null;

  if (rawSrRight === "none") {
    specialRepaymentRight = "none";
  } else if (rawSrBasis === "fixed_yearly") {
    if (rawSrMax !== null && rawSrMax > 0) {
      specialRepaymentRight = "allowed";
      specialRepaymentBasis = "fixed_yearly";
      specialRepaymentMaxYearlyCents = rawSrMax;
    } else {
      specialRepaymentRight = rawSrRight === "allowed" ? "allowed" : "unknown";
      hints.push("Sondertilgungshöhe nicht eindeutig erkannt");
    }
  } else if (
    rawSrBasis === "percent_original" ||
    rawSrBasis === "percent_balance"
  ) {
    if (rawSrPct !== null && rawSrPct > 0 && rawSrPct <= 10_000) {
      specialRepaymentRight = "allowed";
      specialRepaymentBasis = rawSrBasis;
      specialRepaymentPercentBps = rawSrPct;
    } else {
      specialRepaymentRight = rawSrRight === "allowed" ? "allowed" : "unknown";
      hints.push("Sondertilgungshöhe nicht eindeutig erkannt");
    }
  } else if (rawSrMax !== null && rawSrMax > 0) {
    specialRepaymentRight = "allowed";
    specialRepaymentBasis = "fixed_yearly";
    specialRepaymentMaxYearlyCents = rawSrMax;
  } else if (rawSrMax === 0) {
    specialRepaymentRight = "none";
  } else if (rawSrPct !== null && rawSrPct > 0 && rawSrPct <= 10_000) {
    specialRepaymentRight = "allowed";
    specialRepaymentBasis = "percent_original";
    specialRepaymentPercentBps = rawSrPct;
    hints.push("Sondertilgungsbasis (Ursprung vs. Restschuld) bitte prüfen");
  } else if (rawSrRight === "allowed") {
    specialRepaymentRight = "allowed";
  }

  // Clean rate change group
  let rateChangeRight: OptionRight = "unknown";
  let rateChangeTotalCount: number | null = null;
  let rateChangeScope: RateChangeScope | null = null;
  let rateChangeMinRepaymentBps: number | null = null;
  let rateChangeMaxRepaymentBps: number | null = null;
  let rateChangeMinMonthlyCents: number | null = null;
  let rateChangeMaxMonthlyCents: number | null = null;

  const hasRateDetail =
    rawRcCount !== null ||
    rawRcScope !== null ||
    rawRcMinBps !== null ||
    rawRcMaxBps !== null ||
    rawRcMinCents !== null ||
    rawRcMaxCents !== null;

  if (repaymentType === "lump_sum" || rawRcRight === "none") {
    rateChangeRight = "none";
  } else if (rawRcRight === "allowed" || hasRateDetail) {
    rateChangeRight = "allowed";
    rateChangeTotalCount = rawRcCount;
    rateChangeScope = rawRcScope;
    if (
      rawRcMinBps !== null &&
      rawRcMaxBps !== null &&
      rawRcMinBps > rawRcMaxBps
    ) {
      hints.push("Tilgungssatz-Korridor nicht eindeutig erkannt");
    } else {
      rateChangeMinRepaymentBps = rawRcMinBps;
      rateChangeMaxRepaymentBps = rawRcMaxBps;
    }
    if (
      rawRcMinCents !== null &&
      rawRcMaxCents !== null &&
      rawRcMinCents > rawRcMaxCents
    ) {
      hints.push("Raten-Korridor nicht eindeutig erkannt");
    } else {
      rateChangeMinMonthlyCents = rawRcMinCents;
      rateChangeMaxMonthlyCents = rawRcMaxCents;
    }
  }

  if (hasAnyOption) {
    hints.push("Darlehensoptionen aus dem Dokument – bitte prüfen");
  }

  return {
    originalPrincipalCents,
    specialRepaymentRight,
    specialRepaymentBasis,
    specialRepaymentMaxYearlyCents,
    specialRepaymentPercentBps,
    rateChangeRight,
    rateChangeTotalCount,
    rateChangeScope,
    rateChangeMinRepaymentBps,
    rateChangeMaxRepaymentBps,
    rateChangeMinMonthlyCents,
    rateChangeMaxMonthlyCents,
    hasAnyOption,
    hints,
  };
}

/**
 * Maps document metadata and optional AI-extracted contract fields into
 * deterministic prefill values and a list of core fields needing manual review.
 */
export function buildContractPrefillFromExtraction(
  source: ContractPrefillSource,
): ContractPrefillResult {
  const ec = source.extractedContract;
  const hasExtractedContract = ec !== null && ec !== undefined;

  const name = normalizeOptionalText(ec?.name);
  const provider =
    normalizeOptionalText(ec?.provider) ?? normalizeOptionalText(source.issuer);
  const category: ContractCategory = ec?.category ?? "loan";
  const repaymentType: RepaymentType = ec?.repaymentType ?? "annuity";

  const directBalance =
    ec?.currentBalanceCents !== null && ec?.currentBalanceCents !== undefined
      ? ec.currentBalanceCents
      : null;
  const fallbackBalance =
    source.detectedBalanceCents !== null &&
    source.detectedBalanceCents !== undefined
      ? source.detectedBalanceCents
      : null;
  const currentBalanceCents = directBalance ?? fallbackBalance;

  const directAsOfDate = normalizeOptionalText(ec?.balanceAsOfDate);
  const balanceAsOfDate =
    directAsOfDate ??
    normalizeOptionalText(source.documentDate) ??
    source.todayIsoDate;

  const monthlyRateCents =
    ec?.monthlyRateCents !== null && ec?.monthlyRateCents !== undefined
      ? ec.monthlyRateCents
      : null;

  const interestRateBps =
    ec?.interestRateBps !== null && ec?.interestRateBps !== undefined
      ? ec.interestRateBps
      : null;

  const reviewHints: string[] = [];

  if (name === null) {
    reviewHints.push("Vertragsname");
  }
  if (directBalance === null) {
    reviewHints.push(
      fallbackBalance !== null
        ? "Restschuld / Guthaben (Fallback genutzt)"
        : "Restschuld / Guthaben",
    );
  }
  if (directAsOfDate === null) {
    reviewHints.push("Stichtag (Fallback genutzt)");
  }
  if (monthlyRateCents === null) {
    reviewHints.push("Monatsrate");
  }
  if (interestRateBps === null) {
    reviewHints.push("Zinssatz");
  }

  const loanOptions =
    category === "loan"
      ? resolveCleanedLoanOptions(ec, repaymentType)
      : {
          originalPrincipalCents: null,
          specialRepaymentRight: "unknown" as const,
          specialRepaymentBasis: null,
          specialRepaymentMaxYearlyCents: null,
          specialRepaymentPercentBps: null,
          rateChangeRight: "unknown" as const,
          rateChangeTotalCount: null,
          rateChangeScope: null,
          rateChangeMinRepaymentBps: null,
          rateChangeMaxRepaymentBps: null,
          rateChangeMinMonthlyCents: null,
          rateChangeMaxMonthlyCents: null,
          hasAnyOption: false,
          hints: [] as string[],
        };

  for (const hint of loanOptions.hints) {
    reviewHints.push(hint);
  }

  return {
    values: {
      name,
      provider,
      category,
      currentBalanceCents,
      balanceAsOfDate,
      monthlyRateCents,
      interestRateBps,
      repaymentType,
      originalPrincipalCents: loanOptions.originalPrincipalCents,
      specialRepaymentRight: loanOptions.specialRepaymentRight,
      specialRepaymentBasis: loanOptions.specialRepaymentBasis,
      specialRepaymentMaxYearlyCents: loanOptions.specialRepaymentMaxYearlyCents,
      specialRepaymentPercentBps: loanOptions.specialRepaymentPercentBps,
      rateChangeRight: loanOptions.rateChangeRight,
      rateChangeTotalCount: loanOptions.rateChangeTotalCount,
      rateChangeScope: loanOptions.rateChangeScope,
      rateChangeMinRepaymentBps: loanOptions.rateChangeMinRepaymentBps,
      rateChangeMaxRepaymentBps: loanOptions.rateChangeMaxRepaymentBps,
      rateChangeMinMonthlyCents: loanOptions.rateChangeMinMonthlyCents,
      rateChangeMaxMonthlyCents: loanOptions.rateChangeMaxMonthlyCents,
      fixedInterestUntil: normalizeOptionalText(ec?.fixedInterestUntil),
      targetSumCents:
        ec?.targetSumCents !== null && ec?.targetSumCents !== undefined
          ? ec.targetSumCents
          : null,
      allocationThresholdPercent:
        ec?.allocationThresholdPercent !== null &&
        ec?.allocationThresholdPercent !== undefined
          ? ec.allocationThresholdPercent
          : null,
      futureLoanInterestRateBps:
        ec?.futureLoanInterestRateBps !== null &&
        ec?.futureLoanInterestRateBps !== undefined
          ? ec.futureLoanInterestRateBps
          : null,
      milestoneDate: normalizeOptionalText(ec?.milestoneDate),
      milestoneLabel: normalizeOptionalText(ec?.milestoneLabel),
    },
    reviewHints,
    hasExtractedContract,
    hasExtractedLoanOptions: loanOptions.hasAnyOption,
  };
}

export interface LoanOptionDiffEntry {
  field: string;
  label: string;
  before: string;
  after: string;
}

export interface LoanOptionPatchPayload {
  originalPrincipalCents?: number;
  specialRepaymentRight?: OptionRight;
  specialRepaymentBasis?: SpecialRepaymentBasis;
  specialRepaymentMaxYearlyCents?: number;
  specialRepaymentPercentBps?: number;
  rateChangeRight?: OptionRight;
  rateChangeTotalCount?: number;
  rateChangeScope?: RateChangeScope;
  rateChangeMinRepaymentBps?: number;
  rateChangeMaxRepaymentBps?: number;
  rateChangeMinMonthlyCents?: number;
  rateChangeMaxMonthlyCents?: number;
}

export interface ExistingLoanOptionFields {
  category: ContractCategory;
  repaymentType?: RepaymentType | null;
  originalPrincipalCents?: number | null;
  specialRepaymentRight?: OptionRight | null;
  specialRepaymentBasis?: SpecialRepaymentBasis | null;
  specialRepaymentMaxYearlyCents?: number | null;
  specialRepaymentPercentBps?: number | null;
  rateChangeRight?: OptionRight | null;
  rateChangeTotalCount?: number | null;
  rateChangeScope?: RateChangeScope | null;
  rateChangeMinRepaymentBps?: number | null;
  rateChangeMaxRepaymentBps?: number | null;
  rateChangeMinMonthlyCents?: number | null;
  rateChangeMaxMonthlyCents?: number | null;
}

const RIGHT_LABEL: Record<OptionRight, string> = {
  unknown: "Unbekannt",
  none: "Nicht möglich",
  allowed: "Möglich",
};

const BASIS_LABEL: Record<SpecialRepaymentBasis, string> = {
  fixed_yearly: "€ pro Jahr",
  percent_original: "% vom Ursprung",
  percent_balance: "% der Restschuld",
};

const SCOPE_LABEL: Record<RateChangeScope, string> = {
  term: "Gesamtlaufzeit",
  fixed_period: "je Zinsbindung",
  per_year: "pro Jahr",
};

/**
 * Computes the diff list and non-null patch payload for applying AI-extracted loan options
 * onto an existing loan contract. Never touches usage fields.
 */
export function buildLoanOptionsDiff(
  existing: ExistingLoanOptionFields,
  extracted: ExtractedContractData | null | undefined,
): { diffs: LoanOptionDiffEntry[]; patch: LoanOptionPatchPayload } {
  if (existing.category !== "loan" || !extracted) {
    return { diffs: [], patch: {} };
  }

  const cleaned = resolveCleanedLoanOptions(
    extracted,
    existing.repaymentType ?? "annuity",
  );
  if (!cleaned.hasAnyOption) {
    return { diffs: [], patch: {} };
  }

  const diffs: LoanOptionDiffEntry[] = [];
  const patch: LoanOptionPatchPayload = {};

  const checkField = <T,>(
    field: keyof LoanOptionPatchPayload,
    label: string,
    beforeVal: T | null | undefined,
    afterVal: T | null,
    fmt: (v: T | null | undefined) => string,
    includeWhenExtracted: boolean,
  ) => {
    if (!includeWhenExtracted || afterVal === null) return;
    if ((beforeVal ?? null) === afterVal) return;
    (patch as Record<string, unknown>)[field] = afterVal;
    diffs.push({
      field,
      label,
      before: fmt(beforeVal),
      after: fmt(afterVal),
    });
  };

  const fmtEuro = (v: number | null | undefined) =>
    v != null ? formatEuroDE(v) : "—";
  const fmtBps = (v: number | null | undefined) =>
    v != null ? formatBpsDE(v) : "—";
  const fmtRight = (v: OptionRight | null | undefined) =>
    v ? RIGHT_LABEL[v] : "Unbekannt";
  const fmtBasis = (v: SpecialRepaymentBasis | null | undefined) =>
    v ? BASIS_LABEL[v] : "—";
  const fmtScope = (v: RateChangeScope | null | undefined) =>
    v ? SCOPE_LABEL[v] : "—";
  const fmtCount = (v: number | null | undefined) =>
    v != null ? String(v) : "—";

  const hasSrExtracted =
    extracted.specialRepaymentRight != null ||
    extracted.specialRepaymentBasis != null ||
    extracted.specialRepaymentMaxYearlyCents != null ||
    extracted.specialRepaymentPercentBps != null;

  const hasRcExtracted =
    extracted.rateChangeRight != null ||
    extracted.rateChangeTotalCount != null ||
    extracted.rateChangeScope != null ||
    extracted.rateChangeMinRepaymentBps != null ||
    extracted.rateChangeMaxRepaymentBps != null ||
    extracted.rateChangeMinMonthlyCents != null ||
    extracted.rateChangeMaxMonthlyCents != null;

  checkField(
    "originalPrincipalCents",
    "Ursprungsbetrag",
    existing.originalPrincipalCents,
    cleaned.originalPrincipalCents,
    fmtEuro,
    extracted.originalPrincipalCents != null,
  );
  checkField(
    "specialRepaymentRight",
    "Sondertilgungsrecht",
    existing.specialRepaymentRight ?? "unknown",
    cleaned.specialRepaymentRight,
    fmtRight,
    hasSrExtracted && cleaned.specialRepaymentRight !== "unknown",
  );
  checkField(
    "specialRepaymentBasis",
    "Sondertilgungs-Basis",
    existing.specialRepaymentBasis,
    cleaned.specialRepaymentBasis,
    fmtBasis,
    hasSrExtracted,
  );
  checkField(
    "specialRepaymentMaxYearlyCents",
    "Sondertilgung/Jahr (€)",
    existing.specialRepaymentMaxYearlyCents,
    cleaned.specialRepaymentMaxYearlyCents,
    fmtEuro,
    hasSrExtracted,
  );
  checkField(
    "specialRepaymentPercentBps",
    "Sondertilgung (%)",
    existing.specialRepaymentPercentBps,
    cleaned.specialRepaymentPercentBps,
    fmtBps,
    hasSrExtracted,
  );
  checkField(
    "rateChangeRight",
    "Tilgungssatzwechsel",
    existing.rateChangeRight ?? "unknown",
    cleaned.rateChangeRight,
    fmtRight,
    hasRcExtracted && cleaned.rateChangeRight !== "unknown",
  );
  checkField(
    "rateChangeTotalCount",
    "Erlaubte Wechsel",
    existing.rateChangeTotalCount,
    cleaned.rateChangeTotalCount,
    fmtCount,
    hasRcExtracted,
  );
  checkField(
    "rateChangeScope",
    "Wechsel-Bezug",
    existing.rateChangeScope,
    cleaned.rateChangeScope,
    fmtScope,
    hasRcExtracted,
  );
  checkField(
    "rateChangeMinRepaymentBps",
    "Min. Tilgungssatz",
    existing.rateChangeMinRepaymentBps,
    cleaned.rateChangeMinRepaymentBps,
    fmtBps,
    hasRcExtracted,
  );
  checkField(
    "rateChangeMaxRepaymentBps",
    "Max. Tilgungssatz",
    existing.rateChangeMaxRepaymentBps,
    cleaned.rateChangeMaxRepaymentBps,
    fmtBps,
    hasRcExtracted,
  );
  checkField(
    "rateChangeMinMonthlyCents",
    "Min. Monatsrate",
    existing.rateChangeMinMonthlyCents,
    cleaned.rateChangeMinMonthlyCents,
    fmtEuro,
    hasRcExtracted,
  );
  checkField(
    "rateChangeMaxMonthlyCents",
    "Max. Monatsrate",
    existing.rateChangeMaxMonthlyCents,
    cleaned.rateChangeMaxMonthlyCents,
    fmtEuro,
    hasRcExtracted,
  );

  return { diffs, patch };
}
