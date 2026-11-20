import { describe, expect, it } from "vitest";
import { buildPrepaymentDefaults } from "@/domain/planning/prepayment-vs-etf";
import type { DomainPot } from "@/domain/allocation/waterfall";
import {
  buildPlanningHref,
  createFreeMoneyState,
  createRecommendationUiState,
  createSalaryState,
  deriveFreeMoneyView,
  deriveSalaryView,
  freeMoneyReducer,
  isFreeMoneyAdvancedModified,
  isSalaryAdvancedModified,
  parsePlanningEntry,
  parsePlanningView,
  recommendationReducer,
  safeBreakEven,
  salaryReducer,
  type LoanOption,
} from "@/frontend/planung/planning-state";

const loans: LoanOption[] = [
  {
    id: "loan-1",
    name: "Musterbank Kredit A",
    provider: "Musterbank",
    defaults: buildPrepaymentDefaults(
      {
        id: "loan-1",
        name: "Musterbank Kredit A",
        category: "loan",
        status: "active",
        currentBalanceCents: 10_000_000,
        balanceAsOfDate: "2026-11-19",
        monthlyRateCents: 80_000,
        interestRateBps: 350,
        repaymentType: "annuity",
        fixedInterestUntil: "2036-11-19",
        specialRepaymentMaxYearlyCents: 500_000,
      },
      "2026-11-19",
    ),
  },
  {
    id: "loan-2",
    name: "Musterbank Kredit B",
    provider: "Musterbank",
    defaults: buildPrepaymentDefaults(
      {
        id: "loan-2",
        name: "Musterbank Kredit B",
        category: "loan",
        status: "active",
        currentBalanceCents: 5_000_000,
        balanceAsOfDate: "2026-11-19",
        monthlyRateCents: 40_000,
        interestRateBps: 400,
        repaymentType: "annuity",
        fixedInterestUntil: "2031-11-19",
        specialRepaymentMaxYearlyCents: 250_000,
      },
      "2026-11-19",
    ),
  },
];

const samplePots: DomainPot[] = [
  {
    id: "pot-1",
    name: "Notgroschen",
    priority: 1,
    currentCents: 100_000,
    targetCents: 300_000,
    ruleType: "fill_to_target",
    fixedMonthlyCents: null,
    remainderPercentage: null,
  },
  {
    id: "pot-2",
    name: "Rücklage",
    priority: 2,
    currentCents: 0,
    targetCents: null,
    ruleType: "fixed_monthly",
    fixedMonthlyCents: 10_000,
    remainderPercentage: null,
  },
];

describe("parsePlanningEntry & buildPlanningHref", () => {
  it("parses valid entries and rejects invalid ones", () => {
    expect(parsePlanningEntry("geld")).toBe("geld");
    expect(parsePlanningEntry(" gehalt ")).toBe("gehalt");
    expect(parsePlanningEntry(["coach", "geld"])).toBe("coach");
    expect(parsePlanningEntry("GELD")).toBeNull();
    expect(parsePlanningEntry("kauf")).toBeNull();
    expect(parsePlanningEntry("")).toBeNull();
    expect(parsePlanningEntry(undefined)).toBeNull();
    expect(parsePlanningEntry(null)).toBeNull();
  });

  it("round-trips hrefs", () => {
    expect(buildPlanningHref(null)).toBe("/planung");
    expect(buildPlanningHref("geld")).toBe("/planung?frage=geld");
    expect(buildPlanningHref("gehalt")).toBe("/planung?frage=gehalt");
    expect(buildPlanningHref("coach")).toBe("/planung?frage=coach");
  });
});

describe("freeMoneyReducer & deriveFreeMoneyView", () => {
  it("resets all fields and isAdvancedModified to defaults", () => {
    let state = createFreeMoneyState(loans, "2026-11-19");
    state = freeMoneyReducer(
      state,
      { type: "setField", field: "allowanceCents", value: 50_000 },
      loans,
    );
    state = freeMoneyReducer(
      state,
      { type: "setHorizon", date: "2034-01-01" },
      loans,
    );
    state = freeMoneyReducer(state, { type: "setLoan", loanId: "loan-2" }, loans);
    expect(isFreeMoneyAdvancedModified(state)).toBe(true);

    const reset = freeMoneyReducer(state, {
      type: "reset",
      loans,
      asOfDate: "2026-11-19",
    });
    expect(reset).toEqual(createFreeMoneyState(loans, "2026-11-19"));
    expect(isFreeMoneyAdvancedModified(reset)).toBe(false);
  });

  it("ignores invalid numbers, clamps negatives/allowance, and ignores invalid dates/loans", () => {
    const initial = createFreeMoneyState(loans, "2026-11-19");

    expect(
      freeMoneyReducer(initial, {
        type: "setField",
        field: "oneTimeCents",
        value: Number.NaN,
      }),
    ).toBe(initial);
    expect(
      freeMoneyReducer(initial, {
        type: "setField",
        field: "oneTimeCents",
        value: 1.5,
      }),
    ).toBe(initial);
    expect(
      freeMoneyReducer(initial, {
        type: "setField",
        field: "oneTimeCents",
        value: Number.POSITIVE_INFINITY,
      }),
    ).toBe(initial);

    const neg = freeMoneyReducer(initial, {
      type: "setField",
      field: "oneTimeCents",
      value: -500,
    });
    expect(neg.oneTimeCents).toBe(0);

    const overMax = freeMoneyReducer(initial, {
      type: "setField",
      field: "allowanceCents",
      value: 999_999,
    });
    expect(overMax.allowanceCents).toBe(200_000);

    expect(freeMoneyReducer(initial, { type: "setChurchTax", bps: 700 })).toBe(
      initial,
    );
    expect(
      freeMoneyReducer(initial, { type: "setLoan", loanId: "unknown" }, loans),
    ).toBe(initial);
    expect(freeMoneyReducer(initial, { type: "setHorizon", date: "" })).toBe(
      initial,
    );
    expect(
      freeMoneyReducer(initial, { type: "setHorizon", date: "2026-02-30" }),
    ).toBe(initial);
  });

  it("returns invalid view for out-of-range returnBps without throwing", () => {
    const state = freeMoneyReducer(createFreeMoneyState(loans, "2026-11-19"), {
      type: "setField",
      field: "returnBps",
      value: 3500,
    });
    const view = deriveFreeMoneyView(state, loans, "2026-11-19");
    expect(view.kind).toBe("invalid");
  });

  it("handles zero_budget and no_loans", () => {
    let state = createFreeMoneyState(loans, "2026-11-19");
    state = freeMoneyReducer(state, {
      type: "setField",
      field: "oneTimeCents",
      value: 0,
    });
    expect(deriveFreeMoneyView(state, loans, "2026-11-19").kind).toBe("ok");

    state = freeMoneyReducer(state, {
      type: "setField",
      field: "monthlyCents",
      value: 0,
    });
    expect(deriveFreeMoneyView(state, loans, "2026-11-19").kind).toBe(
      "zero_budget",
    );

    const emptyState = createFreeMoneyState([], "2026-11-19");
    expect(emptyState.loanId).toBe("");
    const emptyView = deriveFreeMoneyView(emptyState, [], "2026-11-19");
    expect(emptyView.kind).toBe("no_loans");
    expect(safeBreakEven(emptyView)).toBeNull();
  });

  it("keeps horizonOverride bound to its loanId across loan switches", () => {
    let state = createFreeMoneyState(loans, "2026-11-19");
    state = freeMoneyReducer(state, { type: "setHorizon", date: "2033-05-01" });
    state = freeMoneyReducer(state, { type: "setLoan", loanId: "loan-2" }, loans);
    const v2 = deriveFreeMoneyView(state, loans, "2026-11-19");
    expect(v2.kind).toBe("ok");
    if (v2.kind === "ok") {
      expect(v2.horizonEndDate).toBe("2031-11-19");
    }

    state = freeMoneyReducer(state, { type: "setLoan", loanId: "loan-1" }, loans);
    const v1 = deriveFreeMoneyView(state, loans, "2026-11-19");
    expect(v1.kind).toBe("ok");
    if (v1.kind === "ok") {
      expect(v1.horizonEndDate).toBe("2033-05-01");
    }
  });

  it("computes identical break-even regardless of returnBps", () => {
    const s1 = createFreeMoneyState(loans, "2026-11-19");
    const s2 = freeMoneyReducer(s1, {
      type: "setField",
      field: "returnBps",
      value: 900,
    });
    const be1 = safeBreakEven(deriveFreeMoneyView(s1, loans, "2026-11-19"));
    const be2 = safeBreakEven(deriveFreeMoneyView(s2, loans, "2026-11-19"));
    expect(be1).toEqual(be2);
  });
});

describe("salaryReducer & deriveSalaryView", () => {
  it("validates fromMonth, horizonYears, and reset", () => {
    let s = createSalaryState("2026-12");
    expect(
      salaryReducer(s, {
        type: "setFromMonth",
        value: "2026-13",
        startMonth: "2026-12",
      }),
    ).toBe(s);
    s = salaryReducer(s, {
      type: "setFromMonth",
      value: "2026-01",
      startMonth: "2026-12",
    });
    expect(s.fromMonth).toBe("2026-12");

    s = salaryReducer(s, { type: "setHorizonYears", value: 0 });
    expect(s.horizonYears).toBe(1);
    s = salaryReducer(s, { type: "setHorizonYears", value: 99 });
    expect(s.horizonYears).toBe(40);
    expect(isSalaryAdvancedModified(s)).toBe(true);

    s = salaryReducer(s, { type: "reset", startMonth: "2026-12" });
    expect(s).toEqual(createSalaryState("2026-12"));
    expect(isSalaryAdvancedModified(s)).toBe(false);
  });

  it("handles no_pots, non-positive base surplus, and targetless pots", () => {
    const s = createSalaryState("2026-12");
    expect(
      deriveSalaryView(s, {
        baseSurplusCents: 50_000,
        pots: [],
        startMonth: "2026-12",
      }).kind,
    ).toBe("no_pots");

    const zeroBase = deriveSalaryView(s, {
      baseSurplusCents: 0,
      pots: samplePots,
      startMonth: "2026-12",
    });
    expect(zeroBase.kind).toBe("ok");
    if (zeroBase.kind === "ok") {
      expect(zeroBase.baseSurplusNonPositive).toBe(true);
      expect(zeroBase.targetPotCount).toBe(1);
      expect(zeroBase.hiddenPotCount).toBe(1);
    }

    const noTargetPots = deriveSalaryView(s, {
      baseSurplusCents: 50_000,
      pots: [samplePots[1]!],
      startMonth: "2026-12",
    });
    expect(noTargetPots.kind).toBe("ok");
    if (noTargetPots.kind === "ok") {
      expect(noTargetPots.targetPotCount).toBe(0);
    }
  });
});

describe("parsePlanningView, buildPlanningHref & recommendationReducer", () => {
  it("parses valid, invalid, and array ansicht params", () => {
    expect(parsePlanningView("empfehlung")).toBe("empfehlung");
    expect(parsePlanningView("sparrate")).toBe("sparrate");
    expect(parsePlanningView("vergleich")).toBe("vergleich");
    expect(parsePlanningView("ungueltig")).toBe("empfehlung");
    expect(parsePlanningView(["sparrate", "vergleich"])).toBe("sparrate");
    expect(parsePlanningView(null)).toBe("empfehlung");
  });

  it("builds hrefs with optional view", () => {
    expect(buildPlanningHref("geld", "sparrate")).toBe(
      "/planung?frage=geld&ansicht=sparrate",
    );
    expect(buildPlanningHref("geld", "empfehlung")).toBe("/planung?frage=geld");
  });

  it("clamps negative amount to 0, ignores out-of-bounds assumptions, and resets", () => {
    let s = createRecommendationUiState();
    s = recommendationReducer(s, { type: "setAmount", value: -500 });
    expect(s.amountCents).toBe(0);

    const beforeInvalid = s;
    s = recommendationReducer(s, {
      type: "setAssumption",
      field: "emergencyFundMonths",
      value: 0,
    });
    expect(s).toBe(beforeInvalid);

    s = recommendationReducer(s, {
      type: "setAssumption",
      field: "safetyMarginBps",
      value: 600,
    });
    expect(s).toBe(beforeInvalid);

    s = recommendationReducer(s, {
      type: "setAssumption",
      field: "etfAnnualReturnBps",
      value: 700,
    });
    expect(s.assumptions.etfAnnualReturnBps).toBe(700);

    s = recommendationReducer(s, { type: "reset" });
    expect(s).toEqual(createRecommendationUiState());
  });
});

describe("freeMoneyReducer rate corridor clamping & isFreeMoneyAdvancedModified", () => {
  const corridorLoan: LoanOption = {
    id: "loan-corridor",
    name: "Musterbank Korridor",
    provider: "Musterbank",
    defaults: buildPrepaymentDefaults(
      {
        id: "loan-corridor",
        name: "Musterbank Korridor",
        category: "loan",
        status: "active",
        currentBalanceCents: 20_000_000,
        balanceAsOfDate: "2026-11-19",
        monthlyRateCents: 110_000,
        interestRateBps: 380,
        repaymentType: "annuity",
        fixedInterestUntil: "2030-06-01",
        originalPrincipalCents: 25_000_000,
        specialRepaymentRight: "allowed",
        specialRepaymentBasis: "fixed_yearly",
        specialRepaymentMaxYearlyCents: 1_000_000,
        specialRepaymentUsedCents: 250_000,
        specialRepaymentUsedYear: 2026,
        rateChangeRight: "allowed",
        rateChangeTotalCount: 2,
        rateChangeScope: "fixed_period",
        rateChangeUsedCount: 0,
        rateChangeMinMonthlyCents: 90_000,
        rateChangeMaxMonthlyCents: 162_892, // headroom = 52_892
      },
      "2026-11-19",
    ),
  };

  it("clamps monthlyCents in rate_increase channel and rateStartMonth to latestChangeDate", () => {
    let s = createFreeMoneyState([corridorLoan], "2026-11-19");
    s = freeMoneyReducer(
      s,
      { type: "setMonthlyChannel", channel: "rate_increase" },
      [corridorLoan],
    );
    s = freeMoneyReducer(
      s,
      { type: "setField", field: "monthlyCents", value: 500_000 },
      [corridorLoan],
    );
    expect(s.monthlyCents).toBe(52_892);

    s = freeMoneyReducer(
      s,
      { type: "setRateStartMonth", month: 120 },
      [corridorLoan],
    );
    // 2026-11 to 2030-06 is 43 months
    expect(s.rateStartMonth).toBe(43);
  });

  it("treats persisted usedThisYearCents as unmodified until user changes it", () => {
    const initial = createFreeMoneyState([corridorLoan], "2026-11-19");
    expect(initial.usedThisYearCents).toBe(250_000);
    expect(isFreeMoneyAdvancedModified(initial, corridorLoan)).toBe(false);

    const modified = freeMoneyReducer(
      initial,
      { type: "setField", field: "usedThisYearCents", value: 300_000 },
      [corridorLoan],
    );
    expect(isFreeMoneyAdvancedModified(modified, corridorLoan)).toBe(true);
  });
});
