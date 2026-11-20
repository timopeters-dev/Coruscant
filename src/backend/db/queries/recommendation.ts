import { loadPlanningBase, type PlanningBase } from "./planning-base";
import { contractRecordToDomain } from "@/domain/contracts/contract";
import type { RecommendationLoan, RecommendationPot, RecommendationState } from "@/domain/recommendation/types";
import { buildPrepaymentDefaults } from "@/domain/planning/scenarios";

export interface LoadRecommendationStateOptions {
  asOfDate: string;
  base?: PlanningBase;
}

export function loadRecommendationState(
  options: LoadRecommendationStateOptions,
): RecommendationState {
  const base = options.base ?? loadPlanningBase();
  const { consolidated } = base;

  const loans: RecommendationLoan[] = [];
  for (const contract of base.contracts) {
    if (contract.category !== "loan" || contract.status !== "active") {
      continue;
    }
    const domainContract = contractRecordToDomain(contract);
    const defaults = buildPrepaymentDefaults(domainContract, options.asOfDate);
    if (defaults.loan.balanceCents <= 0) {
      continue;
    }
    loans.push({
      id: contract.id,
      balanceCents: defaults.loan.balanceCents,
      interestRateBps: defaults.loan.interestRateBps,
      monthlyRateCents: defaults.loan.monthlyRateCents,
      repaymentType: defaults.loan.repaymentType,
      specialRepaymentMaxYearlyCents: defaults.specialAllowance.capCents,
      specialRepaymentRule: defaults.specialAllowance.rule,
      specialRepaymentUsedThisYearCents: defaults.specialAllowance.usedCents,
      rateCorridor: defaults.rateCorridor,
      rateChangeScope: contract.rateChangeScope ?? null,
      fixedInterestUntil: contract.fixedInterestUntil ?? null,
      futureLoanInterestRateBps: contract.futureLoanInterestRateBps ?? null,
    });
  }

  const pots: RecommendationPot[] = base.pots.map((p) => ({
    id: p.id,
    name: p.name,
    priority: p.priority,
    purpose: p.purpose,
    currentCents: p.currentCents,
    targetCents: p.targetCents,
    targetDate: p.targetDate,
    ruleType: p.ruleType,
    fixedMonthlyCents: p.fixedMonthlyCents,
    remainderPercentage: p.remainderPercentage,
    linkedContractId: p.linkedContractId,
  }));

  return {
    asOfDate: options.asOfDate,
    monthlyExpensesCents: consolidated.hasHouseholdData
      ? consolidated.totalOutflowCents
      : null,
    monthlySurplusCents: consolidated.monthlySurplusCents,
    pots,
    loans,
  };
}
