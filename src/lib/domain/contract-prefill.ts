import type { ContractCategory, RepaymentType } from "./contracts";

export interface ExtractedContractData {
  name?: string | null;
  provider?: string | null;
  category?: ContractCategory | null;
  currentBalanceCents?: number | null;
  balanceAsOfDate?: string | null;
  monthlyRateCents?: number | null;
  interestRateBps?: number | null;
  repaymentType?: RepaymentType | null;
  specialRepaymentMaxYearlyCents?: number | null;
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
  specialRepaymentMaxYearlyCents: number | null;
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
}

function normalizeOptionalText(value: string | null | undefined): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
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

  return {
    values: {
      name,
      provider,
      category,
      currentBalanceCents,
      balanceAsOfDate,
      monthlyRateCents,
      interestRateBps,
      repaymentType: ec?.repaymentType ?? "annuity",
      specialRepaymentMaxYearlyCents:
        ec?.specialRepaymentMaxYearlyCents !== null &&
        ec?.specialRepaymentMaxYearlyCents !== undefined
          ? ec.specialRepaymentMaxYearlyCents
          : null,
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
  };
}
