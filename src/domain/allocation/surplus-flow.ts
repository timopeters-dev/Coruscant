import type { ConsolidatedCashflowSummary } from "./cashflow";
import {
  allocateProportionally,
  assertNonNegativeInteger,
  assertSafeInteger,
} from "@/domain/core/money";
import type { WaterfallPlan } from "./waterfall";

export const MAX_FLOW_POT_SEGMENTS = 6;
export const MIN_LABEL_BPS = 900;
export const FULL_BPS = 10_000;

export type FlowProvenance = "calibrated" | "modeled";

export type FlowStepKind =
  | "fixed"
  | "variable"
  | "contracts"
  | "property_costs"
  | "manual_out";

export type FlowInflowKind = "household" | "property_rent" | "manual_in";

export interface FlowInflowSegment {
  kind: FlowInflowKind;
  amountCents: number;
  provenance: FlowProvenance;
  widthBps: number;
}

export interface FlowStep {
  kind: FlowStepKind;
  amountCents: number;
  provenance: FlowProvenance;
  startCents: number;
  endCents: number;
  fromBps: number;
  toBps: number;
}

export interface FlowPotSegment {
  key: string;
  label: string;
  kind: "pot" | "pot_group" | "unallocated";
  amountCents: number;
  potIds: string[];
  widthBps: number;
  showLabel: boolean;
}

export type SurplusFlowStatus = "no_data" | "deficit" | "zero" | "surplus";

export interface SurplusFlow {
  status: SurplusFlowStatus;
  totalInflowCents: number;
  totalOutflowCents: number;
  surplusCents: number;
  surplusProvenance: FlowProvenance;
  scaleMinCents: number;
  scaleMaxCents: number;
  inflowBarBps: { fromBps: number; toBps: number };
  surplusBarBps: { fromBps: number; toBps: number };
  inflows: FlowInflowSegment[];
  steps: FlowStep[];
  pots: FlowPotSegment[];
  potsAvailable: boolean;
  hasManualItems: boolean;
}

function assertInvariant(actual: number, expected: number, name: string): void {
  if (actual !== expected) {
    throw new RangeError(
      `${name} inkonsistent: erwartet ${expected}, erhalten ${actual}`,
    );
  }
}

/**
 * Reine Abbildung von `ConsolidatedCashflowSummary` + `WaterfallPlan` auf
 * Wasserfall-Geometrie (Integer-Basispunkte). Keine neue Finanzmathematik.
 */
export function buildSurplusFlow(input: {
  summary: ConsolidatedCashflowSummary;
  isDummy: boolean;
  plan: WaterfallPlan | null;
}): SurplusFlow {
  const { summary, isDummy, plan } = input;

  const totalInflowCents = assertSafeInteger(
    summary.totalInflowCents,
    "totalInflowCents",
  );
  const totalOutflowCents = assertSafeInteger(
    summary.totalOutflowCents,
    "totalOutflowCents",
  );
  const surplusCents = assertSafeInteger(
    summary.monthlySurplusCents,
    "monthlySurplusCents",
  );
  assertInvariant(
    totalInflowCents - totalOutflowCents,
    surplusCents,
    "monthlySurplusCents",
  );

  const hasManualItems =
    summary.manualInflowCents > 0 || summary.manualOutflowCents > 0;

  const emptyBar = { fromBps: 0, toBps: 0 };
  if (totalInflowCents === 0 && totalOutflowCents === 0) {
    return {
      status: "no_data",
      totalInflowCents: 0,
      totalOutflowCents: 0,
      surplusCents: 0,
      surplusProvenance: "modeled",
      scaleMinCents: 0,
      scaleMaxCents: 0,
      inflowBarBps: emptyBar,
      surplusBarBps: emptyBar,
      inflows: [],
      steps: [],
      pots: [],
      potsAvailable: plan !== null && plan.suggestions.length > 0,
      hasManualItems,
    };
  }

  const householdProvenance: FlowProvenance =
    summary.hasHouseholdData && !isDummy ? "calibrated" : "modeled";

  const status: SurplusFlowStatus =
    surplusCents < 0 ? "deficit" : surplusCents === 0 ? "zero" : "surplus";

  const scaleMinCents = Math.min(0, surplusCents);
  const scaleMaxCents = Math.max(totalInflowCents, 0);
  const span = BigInt(scaleMaxCents - scaleMinCents);
  const pos = (value: number): number => {
    const scaled =
      ((BigInt(value) - BigInt(scaleMinCents)) * BigInt(FULL_BPS)) / span;
    const n = Number(scaled);
    return Math.min(FULL_BPS, Math.max(0, n));
  };

  const inflowBarBps = { fromBps: pos(0), toBps: pos(totalInflowCents) };
  const surplusBarBps =
    surplusCents >= 0
      ? { fromBps: pos(0), toBps: pos(surplusCents) }
      : { fromBps: pos(surplusCents), toBps: pos(0) };

  const allInflowDefs: Array<{
    kind: FlowInflowKind;
    amountCents: number;
    provenance: FlowProvenance;
  }> = [
    {
      kind: "household",
      amountCents: summary.calibratedInflowCents,
      provenance: householdProvenance,
    },
    {
      kind: "property_rent",
      amountCents: summary.propertyInflowCents,
      provenance: "modeled",
    },
    {
      kind: "manual_in",
      amountCents: summary.manualInflowCents,
      provenance: "modeled",
    },
  ];
  const inflowDefs = allInflowDefs.filter((d) => d.amountCents > 0);

  const inflowWidths = allocateProportionally(
    inflowBarBps.toBps - inflowBarBps.fromBps,
    inflowDefs.map((d) => d.amountCents),
  );
  const inflows: FlowInflowSegment[] = inflowDefs.map((d, i) => ({
    ...d,
    widthBps: inflowWidths[i] ?? 0,
  }));
  assertInvariant(
    inflows.reduce((s, x) => s + x.amountCents, 0),
    totalInflowCents,
    "Σ inflows",
  );

  const allStepDefs: Array<{
    kind: FlowStepKind;
    amountCents: number;
    provenance: FlowProvenance;
  }> = [
    {
      kind: "fixed",
      amountCents: summary.calibratedFixedOutflowCents,
      provenance: householdProvenance,
    },
    {
      kind: "variable",
      amountCents: summary.variableOutflowCents,
      provenance: householdProvenance,
    },
    {
      kind: "contracts",
      amountCents: summary.contractOutflowCents,
      provenance: "modeled",
    },
    {
      kind: "property_costs",
      amountCents: summary.propertyOutflowCents,
      provenance: "modeled",
    },
    {
      kind: "manual_out",
      amountCents: summary.manualOutflowCents,
      provenance: "modeled",
    },
  ];
  const stepDefs = allStepDefs.filter((d) => d.amountCents > 0);

  let running = totalInflowCents;
  const steps: FlowStep[] = stepDefs.map((d) => {
    const startCents = running;
    const endCents = running - d.amountCents;
    running = endCents;
    return {
      ...d,
      startCents,
      endCents,
      fromBps: pos(Math.min(startCents, endCents)),
      toBps: pos(Math.max(startCents, endCents)),
    };
  });
  assertInvariant(
    steps.reduce((s, x) => s + x.amountCents, 0),
    totalOutflowCents,
    "Σ steps",
  );
  assertInvariant(running, surplusCents, "Rest nach Abzügen");

  const surplusProvenance: FlowProvenance =
    inflows.length + steps.length > 0 &&
    [...inflows, ...steps].every((x) => x.provenance === "calibrated")
      ? "calibrated"
      : "modeled";

  const pots: FlowPotSegment[] = [];
  if (status === "surplus" && plan !== null) {
    assertInvariant(plan.inputAmountCents, surplusCents, "plan.inputAmountCents");

    const funded = plan.suggestions.filter((s) => s.allocatedCents > 0);
    const raw: Array<Omit<FlowPotSegment, "widthBps" | "showLabel">> = [];
    const label = (s: (typeof funded)[number]) => `#${s.priority} ${s.potName}`;

    if (funded.length > MAX_FLOW_POT_SEGMENTS) {
      const single = funded.slice(0, MAX_FLOW_POT_SEGMENTS - 1);
      const rest = funded.slice(MAX_FLOW_POT_SEGMENTS - 1);
      for (const s of single) {
        raw.push({
          key: s.potId,
          label: label(s),
          kind: "pot",
          amountCents: s.allocatedCents,
          potIds: [s.potId],
        });
      }
      raw.push({
        key: "rest",
        label: `Weitere Töpfe (${rest.length})`,
        kind: "pot_group",
        amountCents: rest.reduce((sum, s) => sum + s.allocatedCents, 0),
        potIds: rest.map((s) => s.potId),
      });
    } else {
      for (const s of funded) {
        raw.push({
          key: s.potId,
          label: label(s),
          kind: "pot",
          amountCents: s.allocatedCents,
          potIds: [s.potId],
        });
      }
    }
    if (plan.unallocatedCents > 0) {
      raw.push({
        key: "unallocated",
        label: "Nicht verteilt",
        kind: "unallocated",
        amountCents: plan.unallocatedCents,
        potIds: [],
      });
    }

    const widths = allocateProportionally(
      FULL_BPS,
      raw.map((r) => r.amountCents),
    );
    raw.forEach((r, i) => {
      const widthBps = widths[i] ?? 0;
      pots.push({ ...r, widthBps, showLabel: widthBps >= MIN_LABEL_BPS });
    });
    assertInvariant(
      pots.reduce((s, p) => s + p.amountCents, 0),
      surplusCents,
      "Σ pots",
    );
  }

  return {
    status,
    totalInflowCents,
    totalOutflowCents,
    surplusCents,
    surplusProvenance,
    scaleMinCents,
    scaleMaxCents,
    inflowBarBps,
    surplusBarBps,
    inflows,
    steps,
    pots,
    potsAvailable: plan !== null && plan.suggestions.length > 0,
    hasManualItems,
  };
}

export interface PotProgressBar {
  currentBps: number;
  previewBps: number;
  reached: boolean;
}

export function buildPotProgressBar(input: {
  currentCents: number;
  pendingCents: number;
  allocatedCents: number;
  targetCents: number | null;
}): PotProgressBar | null {
  const current = assertNonNegativeInteger(input.currentCents, "currentCents");
  const pending = assertNonNegativeInteger(input.pendingCents, "pendingCents");
  const allocated = assertNonNegativeInteger(
    input.allocatedCents,
    "allocatedCents",
  );
  if (input.targetCents === null) return null;
  const target = assertNonNegativeInteger(input.targetCents, "targetCents");
  if (target <= 0) return null;

  const bps = (v: number): number =>
    Number((BigInt(v) * BigInt(FULL_BPS)) / BigInt(target));

  const currentBps = Math.min(FULL_BPS, bps(current));
  const reached = current >= target;
  const totalBps = Math.min(FULL_BPS, bps(current + pending + allocated));
  const previewBps = reached ? 0 : Math.max(0, totalBps - currentBps);
  return { currentBps, previewBps, reached };
}
