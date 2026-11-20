import { parseIsoDate } from "@/domain/core/date";
import { assertNonNegativeInteger, assertSafeInteger } from "@/domain/core/money";
import { calculateRequiredMonthlyCents, evaluatePotDeadlines } from "@/domain/allocation/pot-deadline";
import { allocateRemainder } from "./allocate-remainder";
import { type DraftItem, addOrMergeItem, finalizeItems, getPotAllocatedCents, pickEmergencyPotForRule } from "./draft-items";
import { collectRateDecreaseNotes, computeLoanOptionsDigest, sortLoansForRecommendation, sortPotsByPriority } from "./loan-ranking";
import { type RecommendationAssumptions, type RecommendationNote, type RecommendationPot, type RecommendationReason, type RecommendationResult, type RecommendationState, validateRecommendationAssumptions } from "./types";

function computeEmergencyFundStatus(
  state: RecommendationState,
  assumptions: RecommendationAssumptions,
): {
  emergencyPots: RecommendationPot[];
  currentCents: number;
  targetCents: number | null;
  targetSource: "pots" | "rule" | null;
} {
  const emergencyPots = sortPotsByPriority(
    state.pots.filter((p) => p.purpose === "emergency_fund"),
  );
  const currentCents = emergencyPots.reduce(
    (acc, p) => acc + Math.max(0, p.currentCents),
    0,
  );

  if (
    emergencyPots.length > 0 &&
    emergencyPots.every((p) => p.targetCents !== null)
  ) {
    const targetCents = emergencyPots.reduce(
      (acc, p) => acc + Math.max(0, p.targetCents!),
      0,
    );
    return {
      emergencyPots,
      currentCents,
      targetCents,
      targetSource: "pots",
    };
  }

  if (state.monthlyExpensesCents !== null) {
    const targetCents = assertNonNegativeInteger(
      Math.max(0, state.monthlyExpensesCents) * assumptions.emergencyFundMonths,
      "emergencyTargetCents",
    );
    return {
      emergencyPots,
      currentCents,
      targetCents,
      targetSource: "rule",
    };
  }

  return {
    emergencyPots,
    currentCents,
    targetCents: null,
    targetSource: null,
  };
}

export function recommendUse(
  amountCents: number,
  state: RecommendationState,
  assumptionsInput?: Partial<RecommendationAssumptions>,
): RecommendationResult {
  const safeAmount = assertNonNegativeInteger(amountCents, "amountCents");
  parseIsoDate(state.asOfDate, "asOfDate");
  const assumptions = validateRecommendationAssumptions(assumptionsInput);
  const sortedLoans = sortLoansForRecommendation(state.loans, state.asOfDate);
  const loanOrder = sortedLoans.map((l) => l.id);
  const sortedPots = sortPotsByPriority(state.pots);

  if (safeAmount === 0) {
    return {
      mode: "one_time",
      amountCents: 0,
      items: [],
      notes: [{ code: "AMOUNT_ZERO" }],
      assumptions,
      loanOrder,
    };
  }

  const drafts: DraftItem[] = [];
  const notes: RecommendationNote[] = [];
  let rest = safeAmount;

  // 1. Notgroschen
  const ef = computeEmergencyFundStatus(state, assumptions);
  if (ef.targetCents === null || ef.targetSource === null) {
    notes.push({ code: "EMERGENCY_TARGET_UNKNOWN" });
  } else {
    const gap = Math.max(0, ef.targetCents - ef.currentCents);
    if (gap === 0) {
      notes.push({
        code: "EMERGENCY_FUND_FULL",
        currentCents: ef.currentCents,
        targetCents: ef.targetCents,
      });
    } else if (rest > 0) {
      const alloc = Math.min(rest, gap);
      const gapReason: RecommendationReason = {
        code: "EMERGENCY_FUND_GAP",
        targetCents: ef.targetCents,
        currentCents: ef.currentCents,
        months: assumptions.emergencyFundMonths,
        targetSource: ef.targetSource,
      };
      if (ef.targetSource === "pots") {
        let remainingAlloc = alloc;
        for (const pot of ef.emergencyPots) {
          if (remainingAlloc <= 0) break;
          const potGap = Math.max(0, pot.targetCents! - pot.currentCents);
          const potAlloc = Math.min(remainingAlloc, potGap);
          if (potAlloc > 0) {
            addOrMergeItem(drafts, {
              kind: "emergency_fund",
              amountCents: potAlloc,
              target: { type: "pot", potId: pot.id },
              reasons: [gapReason],
            });
            remainingAlloc -= potAlloc;
          }
        }
      } else if (ef.emergencyPots.length > 0) {
        const targetPot = pickEmergencyPotForRule(
          ef.emergencyPots,
          alloc,
          drafts,
        );
        addOrMergeItem(drafts, {
          kind: "emergency_fund",
          amountCents: alloc,
          target: targetPot
            ? { type: "pot", potId: targetPot.id }
            : { type: "none" },
          reasons: [gapReason],
        });
      } else {
        addOrMergeItem(drafts, {
          kind: "emergency_fund",
          amountCents: alloc,
          target: { type: "none" },
          reasons: [gapReason, { code: "EMERGENCY_FUND_NO_POT" }],
        });
      }
      rest -= alloc;
    }
  }

  // 2. Ziel-Töpfe mit nahem Termin
  for (const pot of sortedPots) {
    if (
      pot.targetDate == null &&
      pot.targetCents !== null &&
      pot.purpose !== "emergency_fund" &&
      pot.purpose !== "investment"
    ) {
      notes.push({ code: "POT_NO_DEADLINE_SKIPPED", potId: pot.id });
    }
  }

  const potById = new Map(sortedPots.map((p) => [p.id, p]));
  const deadlineEvals = evaluatePotDeadlines({
    pots: sortedPots,
    monthlySurplusCents: state.monthlySurplusCents,
    todayIsoDate: state.asOfDate,
  })
    .filter(
      (ev) =>
        ev.restMonths <= assumptions.shortHorizonMonths ||
        ev.status === "overdue",
    )
    .sort((a, b) => {
      if (a.targetDate !== b.targetDate) {
        return a.targetDate.localeCompare(b.targetDate);
      }
      const pA = potById.get(a.potId)?.priority ?? 0;
      const pB = potById.get(b.potId)?.priority ?? 0;
      if (pA !== pB) return pA - pB;
      return a.potId.localeCompare(b.potId);
    });

  for (const ev of deadlineEvals) {
    if (potById.get(ev.potId)?.purpose === "emergency_fund") {
      continue;
    }
    const rawNeed =
      ev.status === "overdue" ? ev.shortfallNowCents : ev.shortfallAtDeadlineCents;
    const need = Math.max(0, rawNeed - getPotAllocatedCents(drafts, ev.potId));
    if (need <= 0) {
      notes.push({
        code: "POT_ON_TRACK",
        potId: ev.potId,
        targetMonth: ev.targetMonth,
      });
      continue;
    }
    if (rest <= 0) continue;
    const alloc = Math.min(rest, need);
    const reasons: RecommendationReason[] = [
      {
        code: "POT_DEADLINE_GAP",
        targetMonth: ev.targetMonth,
        restMonths: ev.restMonths,
        shortfallAtDeadlineCents: need,
        status: ev.status,
      },
    ];
    if (alloc < need) {
      reasons.push({
        code: "POT_DEADLINE_UNREACHABLE",
        targetMonth: ev.targetMonth,
        remainingGapCents: need - alloc,
      });
    }
    addOrMergeItem(drafts, {
      kind: "pot_deadline",
      amountCents: alloc,
      target: { type: "pot", potId: ev.potId },
      reasons,
    });
    rest -= alloc;
  }

  // 3. & 4. Sondertilgung vs. ETF / Rest
  allocateRemainder(
    "one_time",
    rest,
    state,
    sortedLoans,
    sortedPots,
    assumptions,
    drafts,
    notes,
  );

  const loanOptionsDigest = computeLoanOptionsDigest(sortedLoans);

  return {
    mode: "one_time",
    amountCents: safeAmount,
    items: finalizeItems(drafts, safeAmount),
    notes,
    assumptions,
    loanOrder,
    loanOptionsDigest,
  };
}

export function recommendMonthlySavings(
  state: RecommendationState,
  assumptionsInput?: Partial<RecommendationAssumptions>,
): RecommendationResult {
  parseIsoDate(state.asOfDate, "asOfDate");
  const surplus = assertSafeInteger(
    state.monthlySurplusCents,
    "monthlySurplusCents",
  );
  const assumptions = validateRecommendationAssumptions(assumptionsInput);
  const sortedLoans = sortLoansForRecommendation(state.loans, state.asOfDate);
  const loanOrder = sortedLoans.map((l) => l.id);
  const loanOptionsDigest = computeLoanOptionsDigest(sortedLoans);
  const sortedPots = sortPotsByPriority(state.pots);

  if (surplus <= 0) {
    const notes: RecommendationNote[] = [
      { code: "NO_SURPLUS", surplusCents: surplus },
    ];
    collectRateDecreaseNotes(sortedLoans, notes);
    return {
      mode: "monthly",
      amountCents: 0,
      items: [],
      notes,
      assumptions,
      loanOrder,
      loanOptionsDigest,
    };
  }

  const drafts: DraftItem[] = [];
  const notes: RecommendationNote[] = [];

  const buffer = Number(
    (BigInt(surplus) * BigInt(assumptions.savingsBufferBps)) / 10_000n,
  );
  if (buffer > 0) {
    addOrMergeItem(drafts, {
      kind: "keep_liquid",
      amountCents: buffer,
      target: { type: "none" },
      reasons: [
        { code: "SURPLUS_BUFFER", bufferBps: assumptions.savingsBufferBps },
      ],
    });
  }

  let rest = surplus - buffer;

  // 1. Notgroschen monatlich
  const ef = computeEmergencyFundStatus(state, assumptions);
  if (ef.targetCents === null || ef.targetSource === null) {
    notes.push({ code: "EMERGENCY_TARGET_UNKNOWN" });
  } else {
    const gap = Math.max(0, ef.targetCents - ef.currentCents);
    if (gap === 0) {
      notes.push({
        code: "EMERGENCY_FUND_FULL",
        currentCents: ef.currentCents,
        targetCents: ef.targetCents,
      });
    } else {
      collectRateDecreaseNotes(sortedLoans, notes);
      if (rest > 0) {
        const monthlyNeeded = calculateRequiredMonthlyCents(
          gap,
          assumptions.emergencyFillMonths,
        );
        const alloc = Math.min(rest, monthlyNeeded);
        const reason: RecommendationReason = {
          code: "EMERGENCY_FUND_MONTHLY",
          gapCents: gap,
          fillMonths: assumptions.emergencyFillMonths,
        };
        if (ef.targetSource === "pots") {
          let remainingAlloc = alloc;
          for (const pot of ef.emergencyPots) {
            if (remainingAlloc <= 0) break;
            const potGap = Math.max(0, pot.targetCents! - pot.currentCents);
            const potMonthly = calculateRequiredMonthlyCents(
              potGap,
              assumptions.emergencyFillMonths,
            );
            const potAlloc = Math.min(remainingAlloc, potMonthly);
            if (potAlloc > 0) {
              addOrMergeItem(drafts, {
                kind: "emergency_fund",
                amountCents: potAlloc,
                target: { type: "pot", potId: pot.id },
                reasons: [reason],
              });
              remainingAlloc -= potAlloc;
            }
          }
        } else if (ef.emergencyPots.length > 0) {
          const targetPot = pickEmergencyPotForRule(
            ef.emergencyPots,
            alloc,
            drafts,
          );
          addOrMergeItem(drafts, {
            kind: "emergency_fund",
            amountCents: alloc,
            target: targetPot
              ? { type: "pot", potId: targetPot.id }
              : { type: "none" },
            reasons: [reason],
          });
        } else {
          addOrMergeItem(drafts, {
            kind: "emergency_fund",
            amountCents: alloc,
            target: { type: "none" },
            reasons: [reason, { code: "EMERGENCY_FUND_NO_POT" }],
          });
        }
        rest -= alloc;
      }
    }
  }

  // 2. Termin-Töpfe (alle Termine mit restMonths >= 1)
  const potById = new Map(sortedPots.map((p) => [p.id, p]));
  const deadlineEvals = evaluatePotDeadlines({
    pots: sortedPots,
    monthlySurplusCents: 0,
    todayIsoDate: state.asOfDate,
  }).sort((a, b) => {
    if (a.targetDate !== b.targetDate) {
      return a.targetDate.localeCompare(b.targetDate);
    }
    const pA = potById.get(a.potId)?.priority ?? 0;
    const pB = potById.get(b.potId)?.priority ?? 0;
    if (pA !== pB) return pA - pB;
    return a.potId.localeCompare(b.potId);
  });

  for (const ev of deadlineEvals) {
    if (potById.get(ev.potId)?.purpose === "emergency_fund") {
      continue;
    }
    const alreadyAllocated = getPotAllocatedCents(drafts, ev.potId);
    if (ev.shortfallNowCents - alreadyAllocated <= 0) {
      notes.push({
        code: "POT_ON_TRACK",
        potId: ev.potId,
        targetMonth: ev.targetMonth,
      });
      continue;
    }
    if (ev.restMonths === 0) {
      notes.push({
        code: "POT_DUE_ONE_TIME",
        potId: ev.potId,
        shortfallCents: ev.shortfallNowCents - alreadyAllocated,
      });
      continue;
    }
    if (rest <= 0) continue;
    const needed = Math.max(0, ev.requiredMonthlyCents - alreadyAllocated);
    if (needed <= 0) continue;
    const alloc = Math.min(rest, needed);
    const reasons: RecommendationReason[] = [
      {
        code: "POT_MONTHLY_REQUIRED",
        requiredMonthlyCents: needed,
        targetMonth: ev.targetMonth,
      },
    ];
    if (alloc < needed) {
      reasons.push({
        code: "POT_MONTHLY_INSUFFICIENT",
        requiredMonthlyCents: needed,
        allocatedCents: alloc,
        targetMonth: ev.targetMonth,
      });
    }
    addOrMergeItem(drafts, {
      kind: "pot_deadline",
      amountCents: alloc,
      target: { type: "pot", potId: ev.potId },
      reasons,
    });
    rest -= alloc;
  }

  // 3. & 4. Rest monatlich
  allocateRemainder(
    "monthly",
    rest,
    state,
    sortedLoans,
    sortedPots,
    assumptions,
    drafts,
    notes,
  );

  return {
    mode: "monthly",
    amountCents: surplus,
    items: finalizeItems(drafts, surplus),
    notes,
    assumptions,
    loanOrder,
    loanOptionsDigest,
  };
}

export function computeRecommendationFingerprint(
  result: Pick<
    RecommendationResult,
    "mode" | "amountCents" | "items" | "loanOptionsDigest"
  >,
): string {
  const itemParts = result.items.map((item) => {
    const targetId =
      item.target.type === "pot"
        ? item.target.potId
        : item.target.type === "loan"
          ? item.target.loanId
          : "none";
    const ratePart =
      item.newMonthlyRateCents !== undefined
        ? `@${item.currentMonthlyRateCents ?? 0}->${item.newMonthlyRateCents}`
        : "";
    return `${item.ref}:${item.kind}:${targetId}:${item.amountCents}${ratePart}`;
  });
  const parts = [result.mode, String(result.amountCents), ...itemParts];
  if (result.loanOptionsDigest) {
    parts.push(`loans:${result.loanOptionsDigest}`);
  }
  return parts.join("|");
}
