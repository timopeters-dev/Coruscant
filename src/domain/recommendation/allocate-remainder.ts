/** Verteilt den Rest nach Notgroschen und Fristen auf Kredite (Sondertilgung, Ratenerhöhung) oder ETF. */
import { addMonthsToIsoDate, parseIsoDate } from "@/domain/core/date";
import { resolveYearlyCapCents } from "@/domain/contracts/loan-options";
import { countRemainingMonths } from "@/domain/allocation/pot-deadline";
import { DEFAULT_ESTIMATED_HORIZON_MONTHS, findBreakEvenReturnBps, simulatePrepaymentVsEtf } from "@/domain/planning/scenarios";
import { type DraftItem, addOrMergeItem, hasPotHeadroom } from "./draft-items";
import { isFixedInterestEndingSoon, resolveLoanSpecialRule } from "./loan-ranking";
import { RATE_INCREASE_STEP_CENTS, type RecommendationAssumptions, type RecommendationLoan, type RecommendationNote, type RecommendationPot, type RecommendationReason, type RecommendationState, type RecommendationTarget } from "./types";

export function allocateRemainder(
  mode: "one_time" | "monthly",
  initialRest: number,
  state: RecommendationState,
  sortedLoans: readonly RecommendationLoan[],
  sortedPots: readonly RecommendationPot[],
  assumptions: RecommendationAssumptions,
  drafts: DraftItem[],
  notes: RecommendationNote[],
): void {
  let rest = initialRest;
  if (rest <= 0) return;

  let lastEtfWinningLoan: {
    interestRateBps: number;
    breakEvenBps: number;
  } | null = null;
  let anyLoanSkippedOrCapped = false;

  const today = parseIsoDate(state.asOfDate, "asOfDate");
  const remainingMonthsInYear = Math.max(1, 12 - today.month + 1);
  const hasEmergencyFundMonthly = drafts.some((d) =>
    d.reasons.some((r) => r.code === "EMERGENCY_FUND_MONTHLY"),
  );
  const maxTotalRateIncreaseCents =
    mode === "monthly" && state.monthlySurplusCents > 0
      ? Number(
          (BigInt(state.monthlySurplusCents) *
            BigInt(assumptions.rateIncreaseMaxSurplusShareBps)) /
            10_000n,
        )
      : 0;
  let allocatedRateIncreasesCents = 0;

  for (const loan of sortedLoans) {
    if (rest <= 0) break;

    const isSoon = isFixedInterestEndingSoon(loan, state.asOfDate);

    if (isSoon && loan.fixedInterestUntil != null) {
      const fixedEnd = loan.fixedInterestUntil;
      const rc = loan.rateCorridor ?? null;
      if (
        mode === "monthly" &&
        rc !== null &&
        rc.status === "allowed" &&
        !rc.flags.corridorAssumed &&
        !rc.flags.exhausted &&
        !rc.flags.corridorEmpty &&
        rc.remainingChanges !== 0 &&
        rc.maxMonthlyCents !== null &&
        rc.maxMonthlyCents > loan.monthlyRateCents
      ) {
        notes.push({
          code: "RATE_CHANGE_SKIPPED_FIXED_END_SOON",
          loanId: loan.id,
          fixedInterestUntil: fixedEnd,
        });
      }

      const monthsUntil = countRemainingMonths(state.asOfDate, fixedEnd);
      const effectiveRateBps =
        loan.futureLoanInterestRateBps ?? loan.interestRateBps;

      // Project remaining debt at fixedInterestUntil without extra prepayments
      let projectedBalanceAtFixedEnd = loan.balanceCents;
      if (monthsUntil > 0) {
        const projSim = simulatePrepaymentVsEtf({
          loan: {
            balanceCents: loan.balanceCents,
            interestRateBps: loan.interestRateBps,
            monthlyRateCents: loan.monthlyRateCents,
            repaymentType: loan.repaymentType,
            specialRepaymentMaxYearlyCents: 0,
          },
          startDate: state.asOfDate,
          horizonEndDate: fixedEnd,
          oneTimeAmountCents: 0,
          monthlyAmountCents: 0,
          saverAllowanceCents: assumptions.saverAllowanceCents,
          churchTaxBps: assumptions.churchTaxBps,
          etfAnnualReturnBps: assumptions.etfAnnualReturnBps,
        });
        projectedBalanceAtFixedEnd = projSim.prepayment.remainingDebtCents;
      }

      const reserveAmount = Math.min(rest, projectedBalanceAtFixedEnd);
      if (reserveAmount <= 0) {
        anyLoanSkippedOrCapped = true;
        continue;
      }

      const horizonEndDate = addMonthsToIsoDate(
        fixedEnd,
        DEFAULT_ESTIMATED_HORIZON_MONTHS,
      );
      const simLoan = {
        balanceCents: projectedBalanceAtFixedEnd,
        interestRateBps: effectiveRateBps,
        monthlyRateCents: loan.monthlyRateCents,
        repaymentType: loan.repaymentType,
        specialRepaymentMaxYearlyCents: null,
      };
      const simInput = {
        loan: simLoan,
        startDate: fixedEnd,
        horizonEndDate,
        oneTimeAmountCents: mode === "one_time" ? reserveAmount : 0,
        monthlyAmountCents: mode === "monthly" ? reserveAmount : 0,
        specialRepaymentUsedThisYearCents: 0,
        saverAllowanceCents: assumptions.saverAllowanceCents,
        churchTaxBps: assumptions.churchTaxBps,
      };

      const breakEven = findBreakEvenReturnBps(simInput);
      const simAtExpected = simulatePrepaymentVsEtf({
        ...simInput,
        etfAnnualReturnBps: assumptions.etfAnnualReturnBps,
      });
      if (simAtExpected.flags.rateBelowInterest) {
        notes.push({ code: "LOAN_RATE_BELOW_INTEREST", loanId: loan.id });
      }

      const etfWins =
        breakEven.kind === "identical" ||
        (breakEven.kind === "bps" &&
          assumptions.etfAnnualReturnBps >=
            breakEven.bps + assumptions.safetyMarginBps);

      if (!etfWins) {
        const linkedPot = sortedPots.find(
          (p) =>
            p.linkedContractId === loan.id &&
            hasPotHeadroom(p, reserveAmount, drafts),
        );
        const target: RecommendationTarget = linkedPot
          ? { type: "pot", potId: linkedPot.id }
          : { type: "none" };
        addOrMergeItem(drafts, {
          kind: "loan_reserve",
          amountCents: reserveAmount,
          target,
          reasons: [
            {
              code: "FIXED_INTEREST_ENDS_SOON",
              fixedInterestUntil: fixedEnd,
              monthsUntil,
              futureRateBps: loan.futureLoanInterestRateBps,
            },
            {
              code: "PREPAYMENT_BEATS_ETF",
              interestRateBps: effectiveRateBps,
              breakEvenBps: breakEven.kind === "bps" ? breakEven.bps : null,
              expectedReturnBps: assumptions.etfAnnualReturnBps,
              safetyMarginBps: assumptions.safetyMarginBps,
            },
          ],
        });
        rest -= reserveAmount;
        if (rest > 0) {
          anyLoanSkippedOrCapped = true;
        }
      } else {
        if (breakEven.kind === "bps") {
          lastEtfWinningLoan = {
            interestRateBps: effectiveRateBps,
            breakEvenBps: breakEven.bps,
          };
        }
      }
      continue;
    }

    // Normal case (not ending soon)
    const rule = resolveLoanSpecialRule(loan);
    const cap =
      loan.specialRepaymentRule !== undefined
        ? resolveYearlyCapCents(rule, loan.balanceCents)
        : loan.specialRepaymentMaxYearlyCents;

    if (rule.kind === "allowed_unknown_amount") {
      notes.push({
        code: "SPECIAL_REPAYMENT_AMOUNT_UNKNOWN",
        loanId: loan.id,
        missingOriginalPrincipal: rule.missingOriginalPrincipal,
      });
    }

    const horizonEstimated =
      loan.fixedInterestUntil == null ||
      loan.fixedInterestUntil <= state.asOfDate;
    const horizonEndDate = horizonEstimated
      ? addMonthsToIsoDate(state.asOfDate, DEFAULT_ESTIMATED_HORIZON_MONTHS)
      : loan.fixedInterestUntil!;

    const usedThisYear =
      assumptions.specialRepaymentUsedThisYearCentsByLoanId[loan.id] ??
      loan.specialRepaymentUsedThisYearCents ??
      0;

    let specialCappedOrUnavailable = false;
    let specialEvaluatedLoanWins: boolean | null = null;
    let rateBelowInterestNoted = false;

    if (rule.kind === "none" || cap === 0) {
      notes.push({ code: "LOAN_NO_PREPAYMENT_RIGHT", loanId: loan.id });
      anyLoanSkippedOrCapped = true;
      specialCappedOrUnavailable = true;
    } else {
      const annualRoom =
        cap === null ? Number.MAX_SAFE_INTEGER : Math.max(0, cap - usedThisYear);
      const effectiveRoom =
        mode === "one_time" || cap === null
          ? annualRoom
          : Math.floor(annualRoom / remainingMonthsInYear);

      if (effectiveRoom <= 0) {
        anyLoanSkippedOrCapped = true;
        specialCappedOrUnavailable = true;
      } else {
        const amount = Math.min(rest, effectiveRoom, loan.balanceCents);
        if (amount <= 0) {
          anyLoanSkippedOrCapped = true;
          specialCappedOrUnavailable = true;
        } else {
          const simLoan = {
            balanceCents: loan.balanceCents,
            interestRateBps: loan.interestRateBps,
            monthlyRateCents: loan.monthlyRateCents,
            repaymentType: loan.repaymentType,
            specialRepaymentMaxYearlyCents: cap,
            specialRepaymentRule: rule,
          };
          const simInput = {
            loan: simLoan,
            startDate: state.asOfDate,
            horizonEndDate,
            oneTimeAmountCents: mode === "one_time" ? amount : 0,
            monthlyAmountCents: mode === "monthly" ? amount : 0,
            specialRepaymentUsedThisYearCents: usedThisYear,
            saverAllowanceCents: assumptions.saverAllowanceCents,
            churchTaxBps: assumptions.churchTaxBps,
          };

          const breakEven = findBreakEvenReturnBps(simInput);
          const simAtExpected = simulatePrepaymentVsEtf({
            ...simInput,
            etfAnnualReturnBps: assumptions.etfAnnualReturnBps,
          });
          if (simAtExpected.flags.rateBelowInterest) {
            notes.push({ code: "LOAN_RATE_BELOW_INTEREST", loanId: loan.id });
            rateBelowInterestNoted = true;
          }

          const etfWins =
            breakEven.kind === "identical" ||
            (breakEven.kind === "bps" &&
              assumptions.etfAnnualReturnBps >=
                breakEven.bps + assumptions.safetyMarginBps);

          specialEvaluatedLoanWins = !etfWins;

          if (!etfWins) {
            const reasons: RecommendationReason[] = [
              {
                code: "PREPAYMENT_BEATS_ETF",
                interestRateBps: loan.interestRateBps,
                breakEvenBps: breakEven.kind === "bps" ? breakEven.bps : null,
                expectedReturnBps: assumptions.etfAnnualReturnBps,
                safetyMarginBps: assumptions.safetyMarginBps,
              },
            ];
            if (rule.kind === "percent_balance" && cap !== null) {
              reasons.push({
                code: "PREPAYMENT_CAP_PERCENT_OF_BALANCE",
                percentBps: rule.bps,
                capCents: cap,
              });
            }
            if (cap === null) {
              reasons.push({ code: "PREPAYMENT_CAP_UNKNOWN" });
            }
            if (horizonEstimated) {
              reasons.push({
                code: "HORIZON_ESTIMATED",
                horizonMonths: DEFAULT_ESTIMATED_HORIZON_MONTHS,
              });
            }
            if (cap !== null && rest > amount && amount === effectiveRoom) {
              reasons.push({
                code: "PREPAYMENT_CAP_REACHED",
                capCents: cap,
                usedCents: usedThisYear,
                overflowCents: rest - amount,
              });
              specialCappedOrUnavailable = true;
            }
            addOrMergeItem(drafts, {
              kind: "loan_prepayment",
              amountCents: amount,
              target: { type: "loan", loanId: loan.id },
              reasons,
            });
            rest -= amount;
            if (rest > 0) {
              anyLoanSkippedOrCapped = true;
            }
          } else {
            if (breakEven.kind === "bps") {
              lastEtfWinningLoan = {
                interestRateBps: loan.interestRateBps,
                breakEvenBps: breakEven.bps,
              };
            }
          }
        }
      }
    }

    // Step 2: Rate increase (monthly mode) or rate-change note (one_time / unknown)
    const corridor = loan.rateCorridor ?? null;
    if (rest > 0 && corridor !== null) {
      if (mode === "monthly") {
        if (corridor.status === "unknown") {
          let wouldWin = specialEvaluatedLoanWins;
          if (wouldWin === null) {
            const probeAmount = Math.min(rest, loan.balanceCents);
            if (probeAmount > 0) {
              const rateBe = findBreakEvenReturnBps({
                loan: {
                  balanceCents: loan.balanceCents,
                  interestRateBps: loan.interestRateBps,
                  monthlyRateCents: loan.monthlyRateCents,
                  repaymentType: loan.repaymentType,
                  specialRepaymentMaxYearlyCents: cap,
                  specialRepaymentRule: rule,
                },
                startDate: state.asOfDate,
                horizonEndDate,
                oneTimeAmountCents: 0,
                monthlyAmountCents: probeAmount,
                monthlyChannel: "rate_increase",
                monthlyStartMonth: 1,
                saverAllowanceCents: assumptions.saverAllowanceCents,
                churchTaxBps: assumptions.churchTaxBps,
              });
              const etfWinsProbe =
                rateBe.kind === "identical" ||
                (rateBe.kind === "bps" &&
                  assumptions.etfAnnualReturnBps >=
                    rateBe.bps + assumptions.safetyMarginBps);
              wouldWin = !etfWinsProbe;
            }
          }
          if (wouldWin) {
            notes.push({ code: "RATE_CHANGE_RIGHT_UNKNOWN", loanId: loan.id });
          }
        } else if (
          corridor.status === "allowed" &&
          !corridor.flags.corridorAssumed &&
          !corridor.flags.exhausted &&
          !corridor.flags.corridorEmpty &&
          corridor.remainingChanges !== 0 &&
          corridor.maxMonthlyCents !== null &&
          corridor.maxMonthlyCents > loan.monthlyRateCents &&
          !hasEmergencyFundMonthly
        ) {
          const corridorHeadroom =
            corridor.maxMonthlyCents - loan.monthlyRateCents;
          const shareHeadroom = Math.max(
            0,
            maxTotalRateIncreaseCents - allocatedRateIncreasesCents,
          );
          const rawIncrease = Math.min(rest, corridorHeadroom, shareHeadroom);
          const steppedIncrease =
            Math.floor(rawIncrease / RATE_INCREASE_STEP_CENTS) *
            RATE_INCREASE_STEP_CENTS;

          if (steppedIncrease > 0) {
            const rateSimInput = {
              loan: {
                balanceCents: loan.balanceCents,
                interestRateBps: loan.interestRateBps,
                monthlyRateCents: loan.monthlyRateCents,
                repaymentType: loan.repaymentType,
                specialRepaymentMaxYearlyCents: cap,
                specialRepaymentRule: rule,
              },
              startDate: state.asOfDate,
              horizonEndDate,
              oneTimeAmountCents: 0,
              monthlyAmountCents: steppedIncrease,
              monthlyChannel: "rate_increase" as const,
              monthlyStartMonth: 1,
              saverAllowanceCents: assumptions.saverAllowanceCents,
              churchTaxBps: assumptions.churchTaxBps,
            };
            const rateBreakEven = findBreakEvenReturnBps(rateSimInput);
            if (!rateBelowInterestNoted) {
              const rateSimAtExpected = simulatePrepaymentVsEtf({
                ...rateSimInput,
                etfAnnualReturnBps: assumptions.etfAnnualReturnBps,
              });
              if (rateSimAtExpected.flags.rateBelowInterest) {
                notes.push({
                  code: "LOAN_RATE_BELOW_INTEREST",
                  loanId: loan.id,
                });
              }
            }

            const etfWinsRate =
              rateBreakEven.kind === "identical" ||
              (rateBreakEven.kind === "bps" &&
                assumptions.etfAnnualReturnBps >=
                  rateBreakEven.bps + assumptions.safetyMarginBps);

            if (!etfWinsRate) {
              const newMonthlyRateCents =
                loan.monthlyRateCents + steppedIncrease;
              const remainingChangesAfter =
                corridor.remainingChanges !== null
                  ? corridor.flags.perYearUsageUntracked
                    ? corridor.remainingChanges
                    : Math.max(0, corridor.remainingChanges - 1)
                  : null;
              const reasons: RecommendationReason[] = [
                {
                  code: "RATE_INCREASE_BEATS_ETF",
                  interestRateBps: loan.interestRateBps,
                  breakEvenBps:
                    rateBreakEven.kind === "bps" ? rateBreakEven.bps : null,
                  expectedReturnBps: assumptions.etfAnnualReturnBps,
                  safetyMarginBps: assumptions.safetyMarginBps,
                  currentMonthlyRateCents: loan.monthlyRateCents,
                  newMonthlyRateCents,
                  remainingChangesAfter,
                  latestChangeDate: corridor.latestChangeDate,
                },
              ];
              if (corridorHeadroom < rest && rawIncrease === corridorHeadroom) {
                reasons.push({
                  code: "RATE_CHANGE_CORRIDOR_LIMIT",
                  maxMonthlyCents: corridor.maxMonthlyCents,
                });
              }
              if (shareHeadroom < rest && rawIncrease === shareHeadroom) {
                reasons.push({
                  code: "RATE_CHANGE_SHARE_LIMIT",
                  shareBps: assumptions.rateIncreaseMaxSurplusShareBps,
                });
              }
              if (corridor.remainingChanges === null) {
                reasons.push({ code: "RATE_CHANGE_COUNT_UNKNOWN" });
              }
              if (horizonEstimated) {
                reasons.push({
                  code: "HORIZON_ESTIMATED",
                  horizonMonths: DEFAULT_ESTIMATED_HORIZON_MONTHS,
                });
              }
              addOrMergeItem(drafts, {
                kind: "loan_rate_increase",
                amountCents: steppedIncrease,
                target: { type: "loan", loanId: loan.id },
                currentMonthlyRateCents: loan.monthlyRateCents,
                newMonthlyRateCents,
                reasons,
              });
              rest -= steppedIncrease;
              allocatedRateIncreasesCents += steppedIncrease;
              if (rest > 0) {
                anyLoanSkippedOrCapped = true;
              }
            } else if (
              rateBreakEven.kind === "bps" &&
              lastEtfWinningLoan === null
            ) {
              lastEtfWinningLoan = {
                interestRateBps: loan.interestRateBps,
                breakEvenBps: rateBreakEven.bps,
              };
            }
          }
        }
      } else if (
        mode === "one_time" &&
        specialCappedOrUnavailable &&
        corridor.status === "allowed" &&
        !corridor.flags.corridorAssumed &&
        !corridor.flags.exhausted &&
        !corridor.flags.corridorEmpty &&
        corridor.remainingChanges !== 0 &&
        corridor.maxMonthlyCents !== null &&
        corridor.maxMonthlyCents > loan.monthlyRateCents
      ) {
        let loanWins = specialEvaluatedLoanWins;
        if (loanWins === null) {
          const probeMonthly = Math.min(
            10_000,
            corridor.maxMonthlyCents - loan.monthlyRateCents,
          );
          if (probeMonthly > 0) {
            const rateBe = findBreakEvenReturnBps({
              loan: {
                balanceCents: loan.balanceCents,
                interestRateBps: loan.interestRateBps,
                monthlyRateCents: loan.monthlyRateCents,
                repaymentType: loan.repaymentType,
                specialRepaymentMaxYearlyCents: cap,
                specialRepaymentRule: rule,
              },
              startDate: state.asOfDate,
              horizonEndDate,
              oneTimeAmountCents: 0,
              monthlyAmountCents: probeMonthly,
              monthlyChannel: "rate_increase",
              monthlyStartMonth: 1,
              saverAllowanceCents: assumptions.saverAllowanceCents,
              churchTaxBps: assumptions.churchTaxBps,
            });
            const etfWinsProbe =
              rateBe.kind === "identical" ||
              (rateBe.kind === "bps" &&
                assumptions.etfAnnualReturnBps >=
                  rateBe.bps + assumptions.safetyMarginBps);
            loanWins = !etfWinsProbe;
          }
        }
        if (loanWins) {
          notes.push({
            code: "RATE_CHANGE_ALTERNATIVE",
            loanId: loan.id,
            remainingChanges: corridor.remainingChanges,
            maxMonthlyCents: corridor.maxMonthlyCents,
          });
        }
      }
    }
  }

  if (rest > 0) {
    if (assumptions.etfAnnualReturnBps <= 0) {
      addOrMergeItem(drafts, {
        kind: "keep_liquid",
        amountCents: rest,
        target: { type: "none" },
        reasons: [
          {
            code: "KEEP_LIQUID_NON_POSITIVE_RETURN",
            expectedReturnBps: assumptions.etfAnnualReturnBps,
          },
        ],
      });
    } else {
      const etfReason: RecommendationReason = lastEtfWinningLoan
        ? {
            code: "ETF_BEATS_PREPAYMENT",
            interestRateBps: lastEtfWinningLoan.interestRateBps,
            breakEvenBps: lastEtfWinningLoan.breakEvenBps,
            expectedReturnBps: assumptions.etfAnnualReturnBps,
            safetyMarginBps: assumptions.safetyMarginBps,
          }
        : sortedLoans.length === 0 || !anyLoanSkippedOrCapped
          ? sortedLoans.length === 0
            ? { code: "ETF_NO_LOAN" }
            : { code: "ETF_AFTER_LOANS" }
          : { code: "ETF_AFTER_LOANS" };

      const alreadyAllocatedByPot = new Map<string, number>();
      for (const d of drafts) {
        if (d.target.type === "pot") {
          alreadyAllocatedByPot.set(
            d.target.potId,
            (alreadyAllocatedByPot.get(d.target.potId) ?? 0) + d.amountCents,
          );
        }
      }

      const investmentPot = sortedPots.find((p) => {
        if (p.purpose !== "investment") return false;
        if (p.targetCents === null) return true;
        const used = alreadyAllocatedByPot.get(p.id) ?? 0;
        const headroom = p.targetCents - p.currentCents - used;
        return headroom >= rest;
      });

      addOrMergeItem(drafts, {
        kind: "etf",
        amountCents: rest,
        target: investmentPot
          ? { type: "pot", potId: investmentPot.id }
          : { type: "none" },
        reasons: [etfReason],
      });
    }
  }
}
