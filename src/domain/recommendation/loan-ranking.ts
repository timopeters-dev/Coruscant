/** Kredite und Töpfe für die Empfehlung ordnen und bewerten. */
import { type SpecialRepaymentRule } from "@/domain/contracts/loan-options";
import { countRemainingMonths } from "@/domain/allocation/pot-deadline";
import { FIXED_INTEREST_SOON_MONTHS, type RecommendationLoan, type RecommendationNote, type RecommendationPot } from "./types";

export function resolveLoanSpecialRule(loan: RecommendationLoan): SpecialRepaymentRule {
  if (loan.specialRepaymentRule !== undefined) {
    return loan.specialRepaymentRule;
  }
  if (loan.specialRepaymentMaxYearlyCents === null) {
    return { kind: "unknown" };
  }
  if (loan.specialRepaymentMaxYearlyCents === 0) {
    return { kind: "none" };
  }
  return { kind: "fixed", capCents: loan.specialRepaymentMaxYearlyCents };
}

export function computeLoanOptionsDigest(
  loans: readonly RecommendationLoan[],
): string {
  return loans
    .map((loan) => {
      const rule = resolveLoanSpecialRule(loan);
      const rc = loan.rateCorridor;
      const rcPart = rc
        ? `${rc.status}:${rc.minMonthlyCents ?? "n"}:${rc.maxMonthlyCents ?? "n"}:${rc.remainingChanges ?? "n"}:${rc.flags.corridorAssumed ? 1 : 0}:${rc.flags.exhausted ? 1 : 0}:${rc.flags.corridorEmpty ? 1 : 0}`
        : "none";
      const rulePart =
        rule.kind === "fixed"
          ? `fixed:${rule.capCents}`
          : rule.kind === "percent_balance"
            ? `pctbal:${rule.bps}`
            : rule.kind === "allowed_unknown_amount"
              ? `unkamt:${rule.missingOriginalPrincipal ? 1 : 0}`
              : rule.kind;
      return `${loan.id}|${rulePart}|${loan.specialRepaymentUsedThisYearCents ?? 0}|${loan.rateChangeScope ?? "n"}|${rcPart}`;
    })
    .join(";");
}

export function collectRateDecreaseNotes(
  sortedLoans: readonly RecommendationLoan[],
  notes: RecommendationNote[],
): void {
  for (const loan of sortedLoans) {
    const rc = loan.rateCorridor;
    if (
      rc != null &&
      rc.status === "allowed" &&
      !rc.flags.corridorAssumed &&
      !rc.flags.exhausted &&
      !rc.flags.corridorEmpty &&
      rc.remainingChanges !== 0 &&
      rc.minMonthlyCents !== null &&
      rc.minMonthlyCents < loan.monthlyRateCents
    ) {
      notes.push({
        code: "RATE_DECREASE_POSSIBLE",
        loanId: loan.id,
        currentMonthlyRateCents: loan.monthlyRateCents,
        minMonthlyCents: rc.minMonthlyCents,
        reliefCents: loan.monthlyRateCents - rc.minMonthlyCents,
      });
    }
  }
}

export function isFixedInterestEndingSoon(
  loan: RecommendationLoan,
  asOfDate: string,
): boolean {
  if (loan.fixedInterestUntil == null) return false;
  if (asOfDate > loan.fixedInterestUntil) return false;
  return (
    countRemainingMonths(asOfDate, loan.fixedInterestUntil) <
    FIXED_INTEREST_SOON_MONTHS
  );
}

function effectiveLoanRateBps(
  loan: RecommendationLoan,
  asOfDate: string,
): number {
  if (isFixedInterestEndingSoon(loan, asOfDate)) {
    return loan.futureLoanInterestRateBps ?? loan.interestRateBps;
  }
  return loan.interestRateBps;
}

export function sortLoansForRecommendation(
  loans: readonly RecommendationLoan[],
  asOfDate: string,
): RecommendationLoan[] {
  return loans
    .filter((l) => l.balanceCents > 0)
    .slice()
    .sort((a, b) => {
      const rateDiff =
        effectiveLoanRateBps(b, asOfDate) - effectiveLoanRateBps(a, asOfDate);
      if (rateDiff !== 0) return rateDiff;
      return a.id.localeCompare(b.id);
    });
}

export function sortPotsByPriority(
  pots: readonly RecommendationPot[],
): RecommendationPot[] {
  return pots.slice().sort((a, b) => {
    if (a.priority !== b.priority) return a.priority - b.priority;
    return a.id.localeCompare(b.id);
  });
}
