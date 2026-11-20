/** Zwischenstand der Empfehlung: Posten sammeln, zusammenführen und nummerieren. */
import { assertSafeInteger } from "@/domain/core/money";
import type { RecommendationItem, RecommendationPot, RecommendationTarget } from "./types";

export type DraftItem = Omit<RecommendationItem, "ref">;

function targetKey(target: RecommendationTarget): string {
  if (target.type === "pot") return `pot:${target.potId}`;
  if (target.type === "loan") return `loan:${target.loanId}`;
  return "none";
}

export function getPotAllocatedCents(
  drafts: readonly DraftItem[],
  potId: string,
): number {
  let sum = 0;
  for (const d of drafts) {
    if (d.target.type === "pot" && d.target.potId === potId) {
      sum += d.amountCents;
    }
  }
  return sum;
}

export function hasPotHeadroom(
  pot: RecommendationPot,
  amountCents: number,
  drafts: readonly DraftItem[],
): boolean {
  if (pot.targetCents === null) return true;
  const headroom =
    pot.targetCents - pot.currentCents - getPotAllocatedCents(drafts, pot.id);
  return headroom >= amountCents;
}

export function pickEmergencyPotForRule(
  emergencyPots: readonly RecommendationPot[],
  amountCents: number,
  drafts: readonly DraftItem[],
): RecommendationPot | undefined {
  return (
    emergencyPots.find((p) => p.targetCents === null) ??
    emergencyPots.find((p) => hasPotHeadroom(p, amountCents, drafts))
  );
}

export function addOrMergeItem(drafts: DraftItem[], next: DraftItem): void {
  if (next.amountCents <= 0) return;
  const nextKey = `${next.kind}|${targetKey(next.target)}`;
  const existing = drafts.find(
    (d) => `${d.kind}|${targetKey(d.target)}` === nextKey,
  );
  if (!existing) {
    drafts.push({
      kind: next.kind,
      amountCents: next.amountCents,
      target: next.target,
      reasons: [...next.reasons],
      ...(next.currentMonthlyRateCents !== undefined
        ? { currentMonthlyRateCents: next.currentMonthlyRateCents }
        : {}),
      ...(next.newMonthlyRateCents !== undefined
        ? { newMonthlyRateCents: next.newMonthlyRateCents }
        : {}),
    });
    return;
  }
  existing.amountCents += next.amountCents;
  if (next.newMonthlyRateCents !== undefined) {
    existing.newMonthlyRateCents = next.newMonthlyRateCents;
  }
  for (const r of next.reasons) {
    const serialized = JSON.stringify(r);
    if (!existing.reasons.some((er) => JSON.stringify(er) === serialized)) {
      existing.reasons.push(r);
    }
  }
}

export function finalizeItems(
  drafts: DraftItem[],
  expectedSumCents: number,
): RecommendationItem[] {
  const items = drafts
    .filter((d) => d.amountCents > 0)
    .map((d, idx) => ({
      ref: `P${idx + 1}`,
      kind: d.kind,
      amountCents: assertSafeInteger(d.amountCents, `items[${idx}].amountCents`),
      target: d.target,
      reasons: d.reasons,
      ...(d.currentMonthlyRateCents !== undefined
        ? { currentMonthlyRateCents: d.currentMonthlyRateCents }
        : {}),
      ...(d.newMonthlyRateCents !== undefined
        ? { newMonthlyRateCents: d.newMonthlyRateCents }
        : {}),
    }));

  const actualSum = items.reduce((acc, item) => acc + item.amountCents, 0);
  if (actualSum !== expectedSumCents) {
    throw new Error(
      `Recommendation invariant violated: sum(${actualSum}) !== expected(${expectedSumCents})`,
    );
  }
  return items;
}
