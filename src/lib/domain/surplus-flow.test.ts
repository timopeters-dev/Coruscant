import { describe, expect, it } from "vitest";
import {
  calculateConsolidatedCashflow,
  type DomainCashflowItem,
  type HouseholdCashflowInput,
  type VariableExpenseBasis,
} from "./cashflow";
import {
  buildPotProgressBar,
  buildSurplusFlow,
  FULL_BPS,
  type SurplusFlow,
} from "./surplus-flow";
import { calculateWaterfallSuggestion, type DomainPot } from "./waterfall";

const household = (
  over: Partial<HouseholdCashflowInput> = {},
): HouseholdCashflowInput => ({
  balanceCents: 100_000,
  recurringInflowCents: 460_000,
  recurringOutflowCents: 195_000,
  variableBudgetsCents: 95_000,
  variableRollingAvg3MCents: 90_000,
  variableRollingAvg6MCents: 85_000,
  ...over,
});

const contractItem = (id: string, cents: number): DomainCashflowItem => ({
  id: `contract:${id}`,
  name: `Musterkredit ${id}`,
  direction: "outflow",
  amountCents: cents,
  frequency: "monthly",
  source: "contract_linked",
  active: true,
});

const manualItem = (
  id: string,
  direction: "inflow" | "outflow",
  cents: number,
  active = true,
): DomainCashflowItem => ({
  id,
  name: `Muster-Posten ${id}`,
  direction,
  amountCents: cents,
  frequency: "monthly",
  source: "manual",
  active,
});

const propItem = (
  id: string,
  direction: "inflow" | "outflow",
  cents: number,
): DomainCashflowItem => ({
  id: `property:${id}:${direction}`,
  name: `Musterwohnung ${id}`,
  direction,
  amountCents: cents,
  frequency: "monthly",
  source: "property_linked",
  active: true,
});

function summaryOf(
  over: Partial<Parameters<typeof calculateConsolidatedCashflow>[0]> = {},
) {
  return calculateConsolidatedCashflow({
    household: household(),
    variableBasis: "budget",
    manualItems: [],
    ...over,
  });
}

const pot = (id: string, over: Partial<DomainPot> = {}): DomainPot => ({
  id,
  name: `Topf ${id}`,
  priority: 1,
  currentCents: 0,
  targetCents: 1_000_000,
  ruleType: "fixed_monthly",
  fixedMonthlyCents: 1_000,
  ...over,
});

function flowOf(
  summary = summaryOf(),
  pots: DomainPot[] = [],
  isDummy = false,
): SurplusFlow {
  const plan =
    pots.length === 0
      ? null
      : calculateWaterfallSuggestion(
          pots,
          Math.max(0, summary.monthlySurplusCents),
          { mode: "monthly" },
        );
  return buildSurplusFlow({ summary, isDummy, plan });
}

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

describe("buildSurplusFlow – Summen & Invarianten", () => {
  it("Happy Path: Summen entsprechen der Summary", () => {
    const summary = summaryOf({
      contractItems: [contractItem("a", 30_000), contractItem("b", 20_000)],
      includeContractItems: true,
    });
    const pots = [
      pot("pot-1", { name: "Notgroschen", priority: 1 }),
      pot("pot-2", { name: "Urlaub", priority: 2 }),
    ];
    const flow = flowOf(summary, pots);
    expect(sum(flow.inflows.map((i) => i.amountCents))).toBe(
      summary.totalInflowCents,
    );
    expect(sum(flow.steps.map((s) => s.amountCents))).toBe(
      summary.totalOutflowCents,
    );
    expect(flow.surplusCents).toBe(summary.monthlySurplusCents);
    expect(sum(flow.pots.map((p) => p.amountCents))).toBe(flow.surplusCents);
    expect(flow.status).toBe("surplus");
  });

  it.each<[VariableExpenseBasis, number]>([
    ["budget", 95_000],
    ["avg_3m", 90_000],
    ["avg_6m", 85_000],
  ])("Variable-Basis %s", (basis, expected) => {
    const summary = summaryOf({ variableBasis: basis });
    const flow = flowOf(summary);
    expect(flow.steps.find((s) => s.kind === "variable")?.amountCents).toBe(
      expected,
    );
    expect(summary.variableOutflowCents).toBe(expected);
  });

  it("ohne Vertrags-/Objekt-Einbezug keine entsprechenden Stufen", () => {
    const summary = summaryOf({
      contractItems: [contractItem("a", 30_000)],
      includeContractItems: false,
      propertyItems: [propItem("x", "outflow", 10_000)],
      includePropertyItems: false,
    });
    const flow = flowOf(summary);
    expect(flow.steps.map((s) => s.kind)).toEqual(["fixed", "variable"]);
    expect(sum(flow.steps.map((s) => s.amountCents))).toBe(
      summary.totalOutflowCents,
    );
  });

  it("feste Stufen-Reihenfolge, 0-Cent-Stufen fehlen", () => {
    const summary = summaryOf({
      household: household({ variableBudgetsCents: 0 }),
      manualItems: [manualItem("m1", "outflow", 1_000)],
      contractItems: [contractItem("a", 30_000)],
      includeContractItems: true,
      propertyItems: [propItem("x", "outflow", 10_000)],
      includePropertyItems: true,
    });
    const flow = flowOf(summary);
    expect(flow.steps.map((s) => s.kind)).toEqual([
      "fixed",
      "contracts",
      "property_costs",
      "manual_out",
    ]);
  });

  it("laufender Rest ist lückenlos", () => {
    const summary = summaryOf({
      contractItems: [contractItem("a", 30_000)],
      includeContractItems: true,
    });
    const flow = flowOf(summary);
    expect(flow.steps[0]!.startCents).toBe(flow.totalInflowCents);
    for (let i = 1; i < flow.steps.length; i += 1) {
      expect(flow.steps[i]!.startCents).toBe(flow.steps[i - 1]!.endCents);
    }
    expect(flow.steps.at(-1)!.endCents).toBe(flow.surplusCents);
  });
});

describe("buildSurplusFlow – Plan-Posten bleiben sichtbar", () => {
  it("aktive manuelle Posten erscheinen als modellierte Segmente", () => {
    const summary = summaryOf({
      manualItems: [
        manualItem("m1", "inflow", 5_000),
        manualItem("m2", "outflow", 4_000),
      ],
    });
    const flow = flowOf(summary);
    expect(flow.hasManualItems).toBe(true);
    expect(flow.inflows.find((i) => i.kind === "manual_in")?.provenance).toBe(
      "modeled",
    );
    expect(flow.steps.find((s) => s.kind === "manual_out")?.provenance).toBe(
      "modeled",
    );
    expect(flow.surplusCents).toBe(summary.monthlySurplusCents);
  });

  it("inaktive Posten erzeugen nichts", () => {
    const summary = summaryOf({
      manualItems: [
        manualItem("m1", "inflow", 5_000, false),
        manualItem("m2", "outflow", 4_000, false),
      ],
    });
    const flow = flowOf(summary);
    expect(flow.hasManualItems).toBe(false);
    expect(flow.inflows.some((i) => i.kind === "manual_in")).toBe(false);
    expect(flow.steps.some((s) => s.kind === "manual_out")).toBe(false);
  });
});

describe("buildSurplusFlow – Herkunft", () => {
  it("Live-Haushalt pur → alles geeicht", () => {
    const flow = flowOf();
    expect(flow.surplusProvenance).toBe("calibrated");
    expect(flow.inflows.every((i) => i.provenance === "calibrated")).toBe(true);
    expect(flow.steps.every((s) => s.provenance === "calibrated")).toBe(true);
  });

  it("Dummy-Haushalt → modelliert", () => {
    const flow = flowOf(summaryOf(), [], true);
    expect(flow.surplusProvenance).toBe("modeled");
    expect(flow.inflows[0]!.provenance).toBe("modeled");
    expect(flow.steps.every((s) => s.provenance === "modeled")).toBe(true);
  });

  it("Live-Haushalt + Vertragsstufe → Überschuss modelliert", () => {
    const flow = flowOf(
      summaryOf({
        contractItems: [contractItem("a", 30_000)],
        includeContractItems: true,
      }),
    );
    expect(flow.surplusProvenance).toBe("modeled");
    expect(flow.steps.find((s) => s.kind === "fixed")?.provenance).toBe(
      "calibrated",
    );
  });

  it("ohne Haushalt nur Objekt-Daten → alles modelliert", () => {
    const flow = flowOf(
      summaryOf({
        household: null,
        propertyItems: [
          propItem("x", "inflow", 80_000),
          propItem("x", "outflow", 20_000),
        ],
        includePropertyItems: true,
      }),
    );
    expect(flow.status).toBe("surplus");
    expect(flow.surplusProvenance).toBe("modeled");
    expect(flow.inflows.every((i) => i.provenance === "modeled")).toBe(true);
  });
});

describe("buildSurplusFlow – Rand- und Negativfälle", () => {
  it("no_data: keine Division durch 0", () => {
    const flow = flowOf(summaryOf({ household: null }));
    expect(flow.status).toBe("no_data");
    expect(flow.inflows).toEqual([]);
    expect(flow.steps).toEqual([]);
    expect(flow.pots).toEqual([]);
    expect(flow.inflowBarBps).toEqual({ fromBps: 0, toBps: 0 });
    expect(flow.surplusBarBps).toEqual({ fromBps: 0, toBps: 0 });
  });

  it("zero: keine Töpfe, Balken ohne Breite", () => {
    const summary = summaryOf({
      household: household({
        recurringInflowCents: 100_000,
        recurringOutflowCents: 50_000,
        variableBudgetsCents: 50_000,
      }),
    });
    const flow = flowOf(summary, [pot("pot-1")]);
    expect(flow.status).toBe("zero");
    expect(flow.pots).toEqual([]);
    expect(flow.surplusBarBps.fromBps).toBe(flow.surplusBarBps.toBps);
  });

  it("deficit: Überschuss-Balken links der Null", () => {
    const summary = summaryOf({
      household: household({
        recurringInflowCents: 100_000,
        recurringOutflowCents: 50_000,
        variableBudgetsCents: 62_345,
      }),
    });
    const flow = flowOf(summary, [pot("pot-1")]);
    expect(flow.status).toBe("deficit");
    expect(flow.scaleMinCents).toBe(-12_345);
    expect(flow.pots).toEqual([]);
    const zeroPos = flow.inflowBarBps.fromBps;
    expect(flow.surplusBarBps.toBps).toBe(zeroPos);
    expect(flow.surplusBarBps.fromBps).toBe(0);
  });

  it("nur Ausgaben (Einnahmen 0)", () => {
    const flow = flowOf(
      summaryOf({
        household: null,
        contractItems: [contractItem("a", 50_000)],
        includeContractItems: true,
      }),
    );
    expect(flow.totalInflowCents).toBe(0);
    expect(flow.scaleMaxCents).toBe(0);
    expect(flow.scaleMinCents).toBe(-50_000);
    for (const s of flow.steps) {
      expect(s.fromBps).toBeGreaterThanOrEqual(0);
      expect(s.toBps).toBeLessThanOrEqual(FULL_BPS);
    }
  });

  it("alle Bps sind Integer in [0, 10000] mit from <= to", () => {
    const fixtures = [
      summaryOf(),
      summaryOf({ variableBasis: "avg_3m" }),
      summaryOf({
        contractItems: [contractItem("a", 777_777)],
        includeContractItems: true,
      }),
      summaryOf({ household: null }),
      summaryOf({
        household: household({ recurringInflowCents: 1 }),
      }),
      summaryOf({
        manualItems: [manualItem("m", "outflow", 33_333)],
      }),
    ];
    for (const f of fixtures) {
      const flow = flowOf(f);
      const bars = [
        flow.inflowBarBps,
        flow.surplusBarBps,
        ...flow.steps.map((s) => ({ fromBps: s.fromBps, toBps: s.toBps })),
      ];
      for (const b of bars) {
        expect(Number.isInteger(b.fromBps)).toBe(true);
        expect(Number.isInteger(b.toBps)).toBe(true);
        expect(b.fromBps).toBeGreaterThanOrEqual(0);
        expect(b.toBps).toBeLessThanOrEqual(FULL_BPS);
        expect(b.fromBps).toBeLessThanOrEqual(b.toBps);
      }
    }
  });

  it("inkonsistenter Plan → RangeError", () => {
    const summary = summaryOf();
    const plan = calculateWaterfallSuggestion([pot("pot-1")], 1_000, {
      mode: "monthly",
    });
    expect(() => buildSurplusFlow({ summary, isDummy: false, plan })).toThrow(
      RangeError,
    );
  });

  it("Überschuss > 0 ohne Plan → keine Töpfe", () => {
    const flow = flowOf();
    expect(flow.pots).toEqual([]);
    expect(flow.potsAvailable).toBe(false);
  });
});

describe("buildSurplusFlow – Töpfe", () => {
  it("3 Töpfe mit Rest → 4 Segmente, Breiten ergeben 10000", () => {
    const flow = flowOf(summaryOf(), [
      pot("pot-1", { priority: 1, fixedMonthlyCents: 50_000 }),
      pot("pot-2", { priority: 2, fixedMonthlyCents: 30_000 }),
      pot("pot-3", { priority: 3, fixedMonthlyCents: 10_000 }),
    ]);
    expect(flow.pots).toHaveLength(4);
    expect(flow.pots.at(-1)!.kind).toBe("unallocated");
    expect(sum(flow.pots.map((p) => p.widthBps))).toBe(FULL_BPS);
    expect(flow.potsAvailable).toBe(true);
  });

  it("Topf mit Zuteilung 0 (Ziel erreicht) erscheint nicht", () => {
    const flow = flowOf(summaryOf(), [
      pot("pot-1", {
        priority: 1,
        currentCents: 100_000,
        targetCents: 100_000,
        ruleType: "fill_to_target",
        fixedMonthlyCents: null,
      }),
      pot("pot-2", { priority: 2, fixedMonthlyCents: 10_000 }),
    ]);
    expect(flow.pots.some((p) => p.potIds.includes("pot-1"))).toBe(false);
    expect(flow.pots.some((p) => p.potIds.includes("pot-2"))).toBe(true);
  });

  it("12 Töpfe → 5 Einzelsegmente + Gruppe + Nicht verteilt", () => {
    const summary = summaryOf({
      household: household({
        recurringInflowCents: 100_000,
        recurringOutflowCents: 40_000,
        variableBudgetsCents: 40_000,
      }),
    });
    expect(summary.monthlySurplusCents).toBe(20_000);
    const pots = Array.from({ length: 12 }, (_, i) =>
      pot(`pot-${String(i + 1).padStart(2, "0")}`, { priority: i + 1 }),
    );
    const flow = flowOf(summary, pots);
    expect(flow.pots).toHaveLength(7);
    expect(flow.pots.slice(0, 5).map((p) => p.kind)).toEqual(
      Array(5).fill("pot"),
    );
    const group = flow.pots[5]!;
    expect(group.kind).toBe("pot_group");
    expect(group.label).toBe("Weitere Töpfe (7)");
    expect(group.potIds).toHaveLength(7);
    expect(group.amountCents).toBe(7_000);
    expect(flow.pots[6]!.kind).toBe("unallocated");
    expect(flow.pots[6]!.amountCents).toBe(8_000);
    expect(flow.pots[0]!.label).toBe("#1 Topf pot-01");
    expect(sum(flow.pots.map((p) => p.amountCents))).toBe(20_000);
  });

  it("genau 6 Töpfe mit Zuteilung → keine Gruppe", () => {
    const pots = Array.from({ length: 6 }, (_, i) =>
      pot(`pot-${i + 1}`, { priority: i + 1 }),
    );
    const flow = flowOf(summaryOf(), pots);
    expect(flow.pots.some((p) => p.kind === "pot_group")).toBe(false);
    expect(flow.pots.filter((p) => p.kind === "pot")).toHaveLength(6);
  });

  it("Rundung: 1,00 € auf 33/33/34 % bleibt deterministisch", () => {
    const summary = summaryOf({
      household: household({
        recurringInflowCents: 100_000,
        recurringOutflowCents: 50_000,
        variableBudgetsCents: 49_900,
      }),
    });
    expect(summary.monthlySurplusCents).toBe(100);
    const pots = [
      pot("pot-1", {
        priority: 1,
        ruleType: "percentage_of_remainder",
        remainderPercentage: 33,
        targetCents: null,
        fixedMonthlyCents: null,
      }),
      pot("pot-2", {
        priority: 2,
        ruleType: "percentage_of_remainder",
        remainderPercentage: 33,
        targetCents: null,
        fixedMonthlyCents: null,
      }),
      pot("pot-3", {
        priority: 3,
        ruleType: "percentage_of_remainder",
        remainderPercentage: 34,
        targetCents: null,
        fixedMonthlyCents: null,
      }),
    ];
    const plan = calculateWaterfallSuggestion(pots, 100, { mode: "monthly" });
    const a = buildSurplusFlow({ summary, isDummy: false, plan });
    const b = buildSurplusFlow({ summary, isDummy: false, plan });
    expect(a).toEqual(b);
    expect(a.pots.map((p) => p.amountCents)).toEqual(
      plan.suggestions.map((s) => s.allocatedCents).filter((c) => c > 0),
    );
    expect(sum(a.pots.map((p) => p.widthBps))).toBe(FULL_BPS);
  });

  it("Überschuss 1 Cent → ein Segment mit voller Breite", () => {
    const summary = summaryOf({
      household: household({
        recurringInflowCents: 100_001,
        recurringOutflowCents: 50_000,
        variableBudgetsCents: 50_000,
      }),
    });
    const flow = flowOf(summary, [pot("pot-1")]);
    expect(flow.pots).toHaveLength(1);
    expect(flow.pots[0]!.widthBps).toBe(FULL_BPS);
    expect(flow.pots[0]!.showLabel).toBe(true);
  });

  it("showLabel ab 900 Bps", () => {
    // 100 Cent Überschuss: 9 Cent = 900 Bps, 8 Cent = 800 Bps
    const summary = summaryOf({
      household: household({
        recurringInflowCents: 100_100,
        recurringOutflowCents: 50_000,
        variableBudgetsCents: 50_000,
      }),
    });
    const flow = flowOf(summary, [
      pot("pot-1", { priority: 1, fixedMonthlyCents: 9 }),
      pot("pot-2", { priority: 2, fixedMonthlyCents: 8 }),
    ]);
    const p1 = flow.pots.find((p) => p.key === "pot-1")!;
    const p2 = flow.pots.find((p) => p.key === "pot-2")!;
    expect(p1.widthBps).toBe(900);
    expect(p1.showLabel).toBe(true);
    expect(p2.widthBps).toBe(800);
    expect(p2.showLabel).toBe(false);
  });
});

describe("buildPotProgressBar", () => {
  const base = { pendingCents: 0, allocatedCents: 0 };

  it("ohne Ziel → null", () => {
    expect(
      buildPotProgressBar({ ...base, currentCents: 100, targetCents: null }),
    ).toBeNull();
    expect(
      buildPotProgressBar({ ...base, currentCents: 100, targetCents: 0 }),
    ).toBeNull();
  });

  it("50 % Ist + 25 % Vorschau", () => {
    expect(
      buildPotProgressBar({
        currentCents: 5_000,
        pendingCents: 1_000,
        allocatedCents: 1_500,
        targetCents: 10_000,
      }),
    ).toEqual({ currentBps: 5_000, previewBps: 2_500, reached: false });
  });

  it("Vorschau über Ziel wird gedeckelt", () => {
    const bar = buildPotProgressBar({
      currentCents: 9_000,
      pendingCents: 5_000,
      allocatedCents: 5_000,
      targetCents: 10_000,
    })!;
    expect(bar.currentBps + bar.previewBps).toBe(FULL_BPS);
  });

  it("Überzahlung → 10000, keine Vorschau", () => {
    expect(
      buildPotProgressBar({
        currentCents: 12_000,
        pendingCents: 500,
        allocatedCents: 500,
        targetCents: 10_000,
      }),
    ).toEqual({ currentBps: 10_000, previewBps: 0, reached: true });
  });

  it("alles 0", () => {
    expect(
      buildPotProgressBar({ ...base, currentCents: 0, targetCents: 10_000 }),
    ).toEqual({ currentBps: 0, previewBps: 0, reached: false });
  });

  it("rundet ab: 1 von 3 Cent = 3333 Bps", () => {
    expect(
      buildPotProgressBar({ ...base, currentCents: 1, targetCents: 3 })!
        .currentBps,
    ).toBe(3_333);
  });

  it("negative oder Float-Eingaben → RangeError", () => {
    expect(() =>
      buildPotProgressBar({ ...base, currentCents: -1, targetCents: 100 }),
    ).toThrow(RangeError);
    expect(() =>
      buildPotProgressBar({ ...base, currentCents: 1.5, targetCents: 100 }),
    ).toThrow(RangeError);
    expect(() =>
      buildPotProgressBar({
        currentCents: 1,
        pendingCents: -1,
        allocatedCents: 0,
        targetCents: 100,
      }),
    ).toThrow(RangeError);
  });
});
