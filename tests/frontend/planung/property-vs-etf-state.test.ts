import { describe, expect, it, vi } from "vitest";

const control = vi.hoisted(() => ({ forceThrow: false }));

vi.mock("@/domain/planning/property-vs-etf", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/domain/planning/property-vs-etf")>();
  return {
    ...actual,
    simulatePropertyVsEtf: (
      ...args: Parameters<typeof actual.simulatePropertyVsEtf>
    ) => {
      if (control.forceThrow) {
        throw new RangeError("forced overflow");
      }
      return actual.simulatePropertyVsEtf(...args);
    },
  };
});

import { simulatePropertyVsEtf } from "@/domain/planning/property-vs-etf";
import {
  calculatePurchaseCostsCents,
  defaultEquityCents,
  PROPERTY_VS_ETF_DEFAULTS,
  PROPERTY_VS_ETF_LIMITS,
  PROPERTY_VS_ETF_TAX_DEFAULTS,
  PROPERTY_VS_ETF_TAX_LIMITS,
} from "@/domain/planning/property-vs-etf-defaults";
import {
  createPropertyVsEtfFormState,
  evaluatePropertyVsEtf,
  isAssumptionsModified,
  isTaxModified,
  nextLastOk,
  parseSqmInputToCentiSqm,
  PROPERTY_VS_ETF_UI_SLIDERS,
  propertyVsEtfReducer,
  resolveEquity,
  type PropertyVsEtfAction,
  type PropertyVsEtfFormState,
  type SliderFieldKey,
} from "@/frontend/planung/property-vs-etf-state";

const OBJ_A = {
  purchasePriceCents: 30_000_000,
  livingAreaCentiSqm: 7_000,
  coldRentPerSqmCents: 1_200,
};
const OBJ_B = { ...OBJ_A, coldRentPerSqmCents: 2_500 };

function reduce(
  state: PropertyVsEtfFormState,
  ...actions: PropertyVsEtfAction[]
): PropertyVsEtfFormState {
  return actions.reduce(propertyVsEtfReducer, state);
}

function withObject(
  obj: typeof OBJ_A,
  state = createPropertyVsEtfFormState(),
): PropertyVsEtfFormState {
  return reduce(
    state,
    { type: "setField", field: "purchasePriceCents", value: obj.purchasePriceCents },
    { type: "setField", field: "livingAreaCentiSqm", value: obj.livingAreaCentiSqm },
    { type: "setField", field: "coldRentPerSqmCents", value: obj.coldRentPerSqmCents },
  );
}

describe("createPropertyVsEtfFormState", () => {
  it("startet ohne Objektdaten und mit den Standardannahmen", () => {
    const s = createPropertyVsEtfFormState();
    expect(s.purchasePriceCents).toBeNull();
    expect(s.livingAreaCentiSqm).toBeNull();
    expect(s.coldRentPerSqmCents).toBeNull();
    expect(s.purchaseCostsBps).toBe(PROPERTY_VS_ETF_DEFAULTS.purchaseCostsBps);
    expect(s.interestRateBps).toBe(PROPERTY_VS_ETF_DEFAULTS.interestRateBps);
    expect(s.etfAnnualReturnBps).toBe(PROPERTY_VS_ETF_DEFAULTS.etfAnnualReturnBps);
    expect(s.horizonYears).toBe(PROPERTY_VS_ETF_DEFAULTS.horizonYears);
    expect(s.tax).toEqual(PROPERTY_VS_ETF_TAX_DEFAULTS);
    expect(s.tax.taxesEnabled).toBe(true);
    expect(s.equityMode).toBe("auto");
    expect(isAssumptionsModified(s)).toBe(false);
    expect(isTaxModified(s)).toBe(false);
  });
});

describe("evaluatePropertyVsEtf – Leerzustand", () => {
  const cases: Array<{
    name: string;
    set: Array<"purchasePriceCents" | "livingAreaCentiSqm" | "coldRentPerSqmCents">;
    missing: string[];
  }> = [
    { name: "alle fehlen", set: [], missing: ["purchasePrice", "livingArea", "coldRent"] },
    { name: "nur Preis", set: ["purchasePriceCents"], missing: ["livingArea", "coldRent"] },
    { name: "nur Fläche", set: ["livingAreaCentiSqm"], missing: ["purchasePrice", "coldRent"] },
    { name: "nur Miete", set: ["coldRentPerSqmCents"], missing: ["purchasePrice", "livingArea"] },
  ];

  for (const c of cases) {
    it(`meldet genau die fehlenden Felder (${c.name})`, () => {
      let s = createPropertyVsEtfFormState();
      for (const field of c.set) {
        s = propertyVsEtfReducer(s, { type: "setField", field, value: OBJ_A[field] });
      }
      const ev = evaluatePropertyVsEtf(s);
      expect(ev.status).toBe("empty");
      if (ev.status === "empty") expect(ev.missing).toEqual(c.missing);
    });
  }

  it("zählt Kaltmiete 0 nicht als leer", () => {
    const s = withObject({ ...OBJ_A, coldRentPerSqmCents: 0 });
    expect(evaluatePropertyVsEtf(s).status).toBe("ok");
  });

  it("macht ein geleertes Feld (null) wieder leer", () => {
    const s = reduce(withObject(OBJ_A), {
      type: "setField",
      field: "purchasePriceCents",
      value: null,
    });
    expect(evaluatePropertyVsEtf(s).status).toBe("empty");
  });

  it("ignoriert null für Nicht-Pflichtfelder", () => {
    const s = createPropertyVsEtfFormState();
    const next = propertyVsEtfReducer(s, {
      type: "setField",
      field: "interestRateBps",
      value: null,
    });
    expect(next).toBe(s);
  });
});

describe("Eigenkapital", () => {
  const price = OBJ_A.purchasePriceCents;
  const bps = PROPERTY_VS_ETF_DEFAULTS.purchaseCostsBps;
  const costs = calculatePurchaseCostsCents(price, bps);

  it("resolveEquity ist null ohne Kaufpreis", () => {
    expect(resolveEquity(createPropertyVsEtfFormState())).toBeNull();
  });

  it("auto: folgt den Nebenkosten live", () => {
    let s = withObject(OBJ_A);
    const eq = resolveEquity(s)!;
    expect(eq.effectiveCents).toBe(defaultEquityCents(price, bps));
    expect(eq.clamped).toBe("none");
    s = reduce(s, { type: "setField", field: "purchaseCostsBps", value: 800 });
    expect(resolveEquity(s)!.effectiveCents).toBe(defaultEquityCents(price, 800));
  });

  it("setEquity schaltet auf manual; Wert in den Grenzen bleibt bei Änderungen stehen", () => {
    const manual = costs + 1_000_000;
    let s = reduce(withObject(OBJ_A), { type: "setEquity", value: manual });
    expect(s.equityMode).toBe("manual");
    s = reduce(
      s,
      { type: "setField", field: "purchasePriceCents", value: 31_000_000 },
      { type: "setField", field: "purchaseCostsBps", value: 1_000 },
    );
    const eq = resolveEquity(s)!;
    expect(eq.effectiveCents).toBe(manual);
    expect(eq.clamped).toBe("none");
  });

  it("hebt einen zu kleinen manuellen Wert auf die Nebenkosten an", () => {
    const s = reduce(withObject(OBJ_A), { type: "setEquity", value: costs - 1 });
    const eq = resolveEquity(s)!;
    expect(eq.effectiveCents).toBe(costs);
    expect(eq.clamped).toBe("raised_to_costs");
    expect(evaluatePropertyVsEtf(s).status).toBe("ok");
  });

  it("hebt an, wenn eine NK-Erhöhung über den manuellen Wert steigt", () => {
    let s = reduce(withObject(OBJ_A), { type: "setEquity", value: costs });
    s = reduce(s, { type: "setField", field: "purchaseCostsBps", value: bps + 100 });
    const eq = resolveEquity(s)!;
    expect(eq.effectiveCents).toBe(eq.purchaseCostsCents);
    expect(eq.clamped).toBe("raised_to_costs");
  });

  it("begrenzt oben auf Kaufpreis plus Nebenkosten (Darlehen 0)", () => {
    const s = reduce(withObject(OBJ_A), {
      type: "setEquity",
      value: price + costs + 1,
    });
    const eq = resolveEquity(s)!;
    expect(eq.effectiveCents).toBe(price + costs);
    expect(eq.clamped).toBe("lowered_to_total");
    const ev = evaluatePropertyVsEtf(s);
    expect(ev.status).toBe("ok");
    if (ev.status === "ok") {
      expect(ev.result.loanPrincipalCents).toBe(0);
      expect(ev.result.flags.noLoan).toBe(true);
    }
  });

  it("klemmt genau an beiden Grenzen nicht", () => {
    const low = resolveEquity(
      reduce(withObject(OBJ_A), { type: "setEquity", value: costs }),
    )!;
    const high = resolveEquity(
      reduce(withObject(OBJ_A), { type: "setEquity", value: price + costs }),
    )!;
    expect(low.clamped).toBe("none");
    expect(high.clamped).toBe("none");
  });

  it("resetEquityToCosts schaltet zurück auf auto", () => {
    const s = reduce(
      withObject(OBJ_A),
      { type: "setEquity", value: costs + 5 },
      { type: "resetEquityToCosts" },
    );
    expect(s.equityMode).toBe("auto");
    expect(resolveEquity(s)!.effectiveCents).toBe(costs);
  });
});

describe("Steuern", () => {
  it("setTaxesEnabled(false) lässt alle anderen Werte unverändert", () => {
    const base = reduce(withObject(OBJ_B), {
      type: "setTaxField",
      field: "marginalTaxRateBps",
      value: 4_200,
    });
    const off = reduce(base, { type: "setTaxesEnabled", value: false });
    expect(off.tax).toEqual({ ...base.tax, taxesEnabled: false });
    const on = reduce(off, { type: "setTaxesEnabled", value: true });
    expect(on.tax).toEqual(base.tax);
  });

  it("Schalter aus entspricht dem Domänenergebnis ohne Steuern", () => {
    const s = reduce(withObject(OBJ_B), { type: "setTaxesEnabled", value: false });
    const ev = evaluatePropertyVsEtf(s);
    expect(ev.status).toBe("ok");
    if (ev.status === "ok") {
      expect(ev.result).toEqual(
        simulatePropertyVsEtf(ev.input, { ...s.tax, taxesEnabled: false }),
      );
      expect(ev.result.taxesEnabled).toBe(false);
    }
  });
});

describe("evaluatePropertyVsEtf – Ok-Fall", () => {
  it("liefert exakt das Domänenergebnis (keine UI-Rechnung)", () => {
    for (const obj of [OBJ_A, OBJ_B]) {
      const ev = evaluatePropertyVsEtf(withObject(obj));
      expect(ev.status).toBe("ok");
      if (ev.status === "ok") {
        expect(ev.result).toEqual(simulatePropertyVsEtf(ev.input, ev.tax));
        expect(ev.input.equityCents).toBe(ev.equity.effectiveCents);
        expect(ev.result.years).toHaveLength(ev.input.horizonYears + 1);
      }
    }
  });
});

describe("evaluatePropertyVsEtf – Invalid", () => {
  it("meldet Zinssatz über der Grenze deutsch am Feld", () => {
    const s = reduce(withObject(OBJ_A), {
      type: "setField",
      field: "interestRateBps",
      value: 1_501,
    });
    const ev = evaluatePropertyVsEtf(s);
    expect(ev.status).toBe("invalid");
    if (ev.status === "invalid") {
      expect(ev.fieldErrors.interestRateBps).toBe("Zinssatz: höchstens 15,00 %");
    }
  });

  it("meldet ungültige Kirchensteuer", () => {
    const s = reduce(withObject(OBJ_A), {
      type: "setTaxField",
      field: "churchTaxBps",
      value: 500,
    });
    const ev = evaluatePropertyVsEtf(s);
    expect(ev.status).toBe("invalid");
    if (ev.status === "invalid") {
      expect(ev.fieldErrors.churchTaxBps).toBe("Kirchensteuer: 0 %, 8 % oder 9 %");
    }
  });

  it("meldet Kaufpreis außerhalb der Grenzen ohne zu werfen", () => {
    const s = reduce(withObject(OBJ_A), {
      type: "setField",
      field: "purchasePriceCents",
      value: PROPERTY_VS_ETF_LIMITS.purchasePriceCents.max + 1,
    });
    const ev = evaluatePropertyVsEtf(s);
    expect(ev.status).toBe("invalid");
    if (ev.status === "invalid") {
      expect(ev.fieldErrors.purchasePriceCents).toContain("Kaufpreis");
    }
  });

  it("fängt einen Domänenfehler ab und meldet _form statt zu werfen", () => {
    control.forceThrow = true;
    try {
      const ev = evaluatePropertyVsEtf(withObject(OBJ_B));
      expect(ev.status).toBe("invalid");
      if (ev.status === "invalid") {
        expect(ev.fieldErrors._form).toBe(
          "Eingaben ergeben keinen rechenbaren Fall – bitte Werte prüfen.",
        );
        expect(ev.equity).not.toBeNull();
      }
    } finally {
      control.forceThrow = false;
    }
  });

  it("meldet nicht bildbare Grenzen (negative Nebenkosten) als _form", () => {
    const s = {
      ...withObject(OBJ_A),
      purchaseCostsBps: -5,
    };
    const ev = evaluatePropertyVsEtf(s);
    expect(ev.status).toBe("invalid");
    if (ev.status === "invalid") {
      expect(ev.equity).toBeNull();
      expect(ev.fieldErrors.purchaseCostsBps).toContain("Kaufnebenkosten");
    }
  });
});

describe("Reducer – Resets", () => {
  const touched = (): PropertyVsEtfFormState =>
    reduce(
      withObject(OBJ_B),
      { type: "setField", field: "etfAnnualReturnBps", value: 700 },
      { type: "setField", field: "horizonYears", value: 25 },
      { type: "setTaxField", field: "brokerFeeBps", value: 300 },
      { type: "setEquity", value: 9_999_999 },
      { type: "setField", field: "purchaseCostsBps", value: 900 },
    );

  it("resetAssumptions setzt nur Annahmen zurück", () => {
    const s = reduce(touched(), { type: "resetAssumptions" });
    expect(s.etfAnnualReturnBps).toBe(PROPERTY_VS_ETF_DEFAULTS.etfAnnualReturnBps);
    expect(s.horizonYears).toBe(PROPERTY_VS_ETF_DEFAULTS.horizonYears);
    expect(s.tax.brokerFeeBps).toBe(300);
    expect(s.purchasePriceCents).toBe(OBJ_B.purchasePriceCents);
    expect(s.purchaseCostsBps).toBe(900);
    expect(s.equityMode).toBe("manual");
    expect(isAssumptionsModified(s)).toBe(false);
  });

  it("resetTaxes setzt nur Steuern zurück", () => {
    const s = reduce(touched(), { type: "resetTaxes" });
    expect(s.tax).toEqual(PROPERTY_VS_ETF_TAX_DEFAULTS);
    expect(s.etfAnnualReturnBps).toBe(700);
    expect(isTaxModified(s)).toBe(false);
  });

  it("resetAll setzt alles inkl. equityMode zurück", () => {
    expect(reduce(touched(), { type: "resetAll" })).toEqual(
      createPropertyVsEtfFormState(),
    );
  });

  it("isAssumptionsModified/isTaxModified erkennen Änderungen", () => {
    const base = createPropertyVsEtfFormState();
    const a = reduce(base, { type: "setField", field: "etfAnnualReturnBps", value: 700 });
    expect(isAssumptionsModified(a)).toBe(true);
    expect(isTaxModified(a)).toBe(false);
    expect(isAssumptionsModified(reduce(a, { type: "resetAssumptions" }))).toBe(false);
    const t = reduce(base, { type: "setTaxesEnabled", value: false });
    expect(isTaxModified(t)).toBe(true);
    expect(isAssumptionsModified(t)).toBe(false);
    expect(isTaxModified(reduce(t, { type: "resetTaxes" }))).toBe(false);
  });
});

describe("PROPERTY_VS_ETF_UI_SLIDERS", () => {
  const defaults: Record<SliderFieldKey, number> = {
    ...PROPERTY_VS_ETF_DEFAULTS,
    marginalTaxRateBps: PROPERTY_VS_ETF_TAX_DEFAULTS.marginalTaxRateBps,
    depreciationRateBps: PROPERTY_VS_ETF_TAX_DEFAULTS.depreciationRateBps,
    buildingShareBps: PROPERTY_VS_ETF_TAX_DEFAULTS.buildingShareBps,
    speculationPeriodYears: PROPERTY_VS_ETF_TAX_DEFAULTS.speculationPeriodYears,
    partialExemptionBps: PROPERTY_VS_ETF_TAX_DEFAULTS.partialExemptionBps,
    brokerFeeBps: PROPERTY_VS_ETF_TAX_DEFAULTS.brokerFeeBps,
    otherSaleCostsBps: PROPERTY_VS_ETF_TAX_DEFAULTS.otherSaleCostsBps,
    reserveDeductionLagYears:
      PROPERTY_VS_ETF_TAX_DEFAULTS.reserveDeductionLagYears,
  };

  for (const key of Object.keys(PROPERTY_VS_ETF_UI_SLIDERS) as SliderFieldKey[]) {
    it(`${key}: Regler liegt innerhalb der Domänengrenzen, Default im Bereich`, () => {
      const range = PROPERTY_VS_ETF_UI_SLIDERS[key] as {
        min: number;
        max: number;
        step: number;
      };
      const limit = (
        key in PROPERTY_VS_ETF_LIMITS
          ? PROPERTY_VS_ETF_LIMITS[key as keyof typeof PROPERTY_VS_ETF_LIMITS]
          : PROPERTY_VS_ETF_TAX_LIMITS[key as keyof typeof PROPERTY_VS_ETF_TAX_LIMITS]
      ) as { min: number; max: number };
      expect(range.min).toBeGreaterThanOrEqual(limit.min);
      expect(range.max).toBeLessThanOrEqual(limit.max);
      expect(range.min).toBeLessThan(range.max);
      expect(range.step).toBeGreaterThan(0);
      expect(defaults[key]).toBeGreaterThanOrEqual(range.min);
      expect(defaults[key]).toBeLessThanOrEqual(range.max);
    });
  }
});

describe("parseSqmInputToCentiSqm", () => {
  it("parst Quadratmeter in Hundertstel", () => {
    expect(parseSqmInputToCentiSqm("70")).toBe(7_000);
    expect(parseSqmInputToCentiSqm("65,5")).toBe(6_550);
    expect(parseSqmInputToCentiSqm("65,55")).toBe(6_555);
  });

  it("liefert null bei leerer, ungültiger oder negativer Eingabe", () => {
    expect(parseSqmInputToCentiSqm("")).toBeNull();
    expect(parseSqmInputToCentiSqm("abc")).toBeNull();
    expect(parseSqmInputToCentiSqm("-1")).toBeNull();
    expect(parseSqmInputToCentiSqm("65,555")).toBeNull();
  });
});

describe("nextLastOk", () => {
  it("übernimmt ok, behält bei invalid, verwirft bei empty", () => {
    const ok = evaluatePropertyVsEtf(withObject(OBJ_B));
    expect(ok.status).toBe("ok");
    if (ok.status !== "ok") return;
    const invalid = evaluatePropertyVsEtf(
      reduce(withObject(OBJ_A), { type: "setField", field: "interestRateBps", value: 1_501 }),
    );
    const empty = evaluatePropertyVsEtf(createPropertyVsEtfFormState());
    expect(nextLastOk(null, ok)).toBe(ok);
    expect(nextLastOk(ok, invalid)).toBe(ok);
    expect(nextLastOk(null, invalid)).toBeNull();
    expect(nextLastOk(ok, empty)).toBeNull();
  });

  it("Reset → ungültiges neues Objekt zeigt kein altes Ergebnis", () => {
    const ok = evaluatePropertyVsEtf(withObject(OBJ_B));
    if (ok.status !== "ok") throw new Error("expected ok");
    let last = nextLastOk(null, ok);
    const reset = createPropertyVsEtfFormState();
    last = nextLastOk(last, evaluatePropertyVsEtf(reset));
    const bad = reduce(reset, ...[
      { type: "setField", field: "purchasePriceCents", value: 30_000_000 },
      { type: "setField", field: "livingAreaCentiSqm", value: 7_000 },
      { type: "setField", field: "coldRentPerSqmCents", value: 15_000 },
    ] as PropertyVsEtfAction[]);
    const ev = evaluatePropertyVsEtf(bad);
    expect(ev.status).toBe("invalid");
    expect(nextLastOk(last, ev)).toBeNull();
  });
});
