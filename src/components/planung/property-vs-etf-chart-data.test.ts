import { describe, expect, it } from "vitest";
import { formatWholeEuroDE } from "@/components/charts/chart-scale";
import {
  simulatePropertyVsEtf,
  type PropertyVsEtfInput,
  type PropertyVsEtfResult,
} from "@/lib/domain/property-vs-etf";
import type { PropertyVsEtfTaxInput } from "@/lib/domain/property-vs-etf-tax";
import {
  PROPERTY_VS_ETF_DEFAULTS,
  PROPERTY_VS_ETF_TAX_DEFAULTS,
  defaultEquityCents,
} from "@/lib/domain/property-vs-etf-defaults";
import {
  buildHorizonYearTicks,
  describeBreakEven,
  describeFinancing,
  describeInitialCashflow,
  describeKpiBasis,
  toPropertyVsEtfChart,
  toPropertyVsEtfKpis,
} from "./property-vs-etf-chart-data";

const OBJ_A = {
  purchasePriceCents: 30_000_000,
  livingAreaCentiSqm: 7_000,
  coldRentPerSqmCents: 1_200,
};
const OBJ_B = { ...OBJ_A, coldRentPerSqmCents: 2_500 };

function makeInput(
  overrides: Partial<PropertyVsEtfInput> & { purchasePriceCents?: number } = {},
  base = OBJ_B,
): PropertyVsEtfInput {
  const merged = { ...PROPERTY_VS_ETF_DEFAULTS, ...base, ...overrides };
  return {
    ...merged,
    equityCents:
      overrides.equityCents ??
      defaultEquityCents(merged.purchasePriceCents, merged.purchaseCostsBps),
  };
}

function simulate(
  overrides: Partial<PropertyVsEtfInput> = {},
  tax: Partial<PropertyVsEtfTaxInput> = {},
  base = OBJ_B,
): PropertyVsEtfResult {
  return simulatePropertyVsEtf(makeInput(overrides, base), {
    ...PROPERTY_VS_ETF_TAX_DEFAULTS,
    ...tax,
  });
}

describe("toPropertyVsEtfChart – Serien", () => {
  it("liefert zwei gestrichelte Serien mit Liquidationswerten inkl. Jahr 0", () => {
    const result = simulate();
    const model = toPropertyVsEtfChart(result);
    expect(model.series.map((s) => s.id)).toEqual(["property", "etf"]);
    expect(model.series.map((s) => s.role)).toEqual(["bound", "optionB"]);
    expect(model.series.every((s) => s.dashed)).toBe(true);
    for (const s of model.series) {
      expect(s.points).toHaveLength(result.years.length);
      expect(s.points).toHaveLength(PROPERTY_VS_ETF_DEFAULTS.horizonYears + 1);
    }
    result.years.forEach((y, i) => {
      expect(model.series[0]!.points[i]).toEqual({
        x: y.year,
        y: y.propertyLiquidationCents,
      });
      expect(model.series[1]!.points[i]).toEqual({
        x: y.year,
        y: y.etfLiquidationCents,
      });
    });
    expect(model.xDomain).toEqual([0, 20]);
  });

  it.each([
    [1, 2],
    [40, 41],
  ])("Horizont %i ergibt %i Punkte", (horizonYears, points) => {
    const model = toPropertyVsEtfChart(simulate({ horizonYears }));
    expect(model.series[0]!.points).toHaveLength(points);
    expect(model.xDomain).toEqual([0, horizonYears]);
  });
});

describe("buildHorizonYearTicks", () => {
  const xs = (h: number) => buildHorizonYearTicks(h).map((t) => t.x);

  it("H = 1 → Kauf, 1 J.", () => {
    expect(buildHorizonYearTicks(1)).toEqual([
      { x: 0, label: "Kauf" },
      { x: 1, label: "1 J." },
    ]);
  });

  it("H = 7 → Schritt 1", () => {
    expect(xs(7)).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
  });

  it("H = 20 → Schritt 5, letzter Tick 20", () => {
    expect(xs(20)).toEqual([0, 5, 10, 15, 20]);
  });

  it("H = 40 → Schritt 10 mit fünf Ticks", () => {
    expect(xs(40)).toEqual([0, 10, 20, 30, 40]);
  });

  it("endet immer mit H; ein zu naher letzter Tick entfällt", () => {
    // 20 ist 1 < 2,5 von 21 entfernt → entfällt
    expect(xs(21)).toEqual([0, 5, 10, 15, 21]);
    // 20 ist 3 ≥ 2,5 von 23 entfernt → bleibt
    expect(xs(23)).toEqual([0, 5, 10, 15, 20, 23]);
  });

  it("hat nie mehr als 8 Ticks und beginnt immer mit „Kauf“", () => {
    for (let h = 1; h <= 40; h += 1) {
      const ticks = buildHorizonYearTicks(h);
      expect(ticks.length).toBeLessThanOrEqual(8);
      expect(ticks[0]).toEqual({ x: 0, label: "Kauf" });
      expect(ticks[ticks.length - 1]!.x).toBe(h);
      const unique = new Set(ticks.map((t) => t.x));
      expect(unique.size).toBe(ticks.length);
    }
  });
});

describe("Marker", () => {
  it("setzt genau einen Break-even-Marker (Rolle milestone)", () => {
    const result = simulate();
    expect(result.breakEven.kind).toBe("year");
    const model = toPropertyVsEtfChart(result);
    const milestones = model.markers.filter((m) => m.role === "milestone");
    expect(milestones).toHaveLength(1);
    expect(milestones[0]!.x).toBe(
      result.breakEven.kind === "year" ? result.breakEven.year : -1,
    );
    expect(milestones[0]!.label).toContain("Break-even");
  });

  it("setzt keinen Break-even-Marker bei „never“", () => {
    const result = simulate({ coldRentPerSqmCents: 0 });
    expect(result.breakEven.kind).toBe("never");
    const model = toPropertyVsEtfChart(result);
    expect(model.markers.filter((m) => m.role === "milestone")).toHaveLength(0);
  });

  it("setzt den Marker bei x = 0, wenn der Break-even in Jahr 0 liegt", () => {
    const base = simulate();
    const result: PropertyVsEtfResult = {
      ...base,
      breakEven: { kind: "year", year: 0 },
      speculationFreeFromYear: null,
    };
    const model = toPropertyVsEtfChart(result);
    expect(model.markers).toEqual([
      { x: 0, label: "Break-even", role: "milestone" },
    ]);
  });

  it("Spekulationsmarker: Frist 10, H 20 → baseline bei 11", () => {
    const result = simulate({}, { speculationPeriodYears: 10 });
    expect(result.speculationFreeFromYear).toBe(11);
    const model = toPropertyVsEtfChart(result);
    const base = model.markers.find((m) => m.role === "baseline");
    expect(base).toEqual({ x: 11, label: "§ 23 steuerfrei", role: "baseline" });
  });

  it("kein Spekulationsmarker bei Steuern aus", () => {
    const result = simulate({}, { taxesEnabled: false });
    expect(result.speculationFreeFromYear).toBeNull();
    expect(
      toPropertyVsEtfChart(result).markers.some((m) => m.role === "baseline"),
    ).toBe(false);
  });

  it("kein Spekulationsmarker, wenn die Frist ≥ H ist", () => {
    const result = simulate({ horizonYears: 10 }, { speculationPeriodYears: 10 });
    expect(result.speculationFreeFromYear).toBe(11);
    expect(
      toPropertyVsEtfChart(result).markers.some((m) => m.role === "baseline"),
    ).toBe(false);
  });

  it("kombiniert gleiche Jahre zu einem Marker", () => {
    const base = simulate({}, { speculationPeriodYears: 10 });
    const result: PropertyVsEtfResult = {
      ...base,
      breakEven: { kind: "year", year: 11 },
    };
    expect(toPropertyVsEtfChart(result).markers).toEqual([
      { x: 11, label: "Break-even · § 23 steuerfrei", role: "milestone" },
    ]);
  });

  it("kürzt das Label bei 1 Jahr Abstand", () => {
    const base = simulate({}, { speculationPeriodYears: 10 });
    for (const year of [10, 12]) {
      const result: PropertyVsEtfResult = {
        ...base,
        breakEven: { kind: "year", year },
      };
      const markers = toPropertyVsEtfChart(result).markers;
      expect(markers).toHaveLength(2);
      expect(markers.find((m) => m.role === "baseline")!.label).toBe("§ 23");
      expect(markers.find((m) => m.role === "milestone")!.label).toBe(
        "Break-even",
      );
    }
  });
});

describe("toPropertyVsEtfKpis", () => {
  it("übernimmt die Endwerte unverändert formatiert", () => {
    const result = simulate();
    const [property, etf, advantage] = toPropertyVsEtfKpis(result);
    expect(property).toMatchObject({
      key: "property",
      value: formatWholeEuroDE(result.final.propertyLiquidationCents),
      tone: "bound",
    });
    expect(etf).toMatchObject({
      key: "etf",
      value: formatWholeEuroDE(result.final.etfLiquidationCents),
      tone: "accent",
    });
    expect(advantage!.key).toBe("advantage");
    expect(advantage!.value).toBe(
      formatWholeEuroDE(result.final.advantageCents, { showPlusSign: true }),
    );
  });

  const withAdvantage = (advantageCents: number): PropertyVsEtfResult => {
    const base = simulate();
    return { ...base, final: { ...base.final, advantageCents } };
  };

  it("positiver Vorteil: Plus und Ton positive", () => {
    const kpi = toPropertyVsEtfKpis(withAdvantage(1_234_500))[2]!;
    expect(kpi.value).toBe("+12.345 €");
    expect(kpi.tone).toBe("positive");
  });

  it("negativer Vorteil: Minus und Ton negative", () => {
    const kpi = toPropertyVsEtfKpis(withAdvantage(-1_234_500))[2]!;
    expect(kpi.value).toBe("−12.345 €");
    expect(kpi.tone).toBe("negative");
  });

  it("Vorteil 0: neutral ohne Vorzeichen", () => {
    const kpi = toPropertyVsEtfKpis(withAdvantage(0))[2]!;
    expect(kpi.value).toBe("0 €");
    expect(kpi.tone).toBe("neutral");
  });
});

describe("Texte", () => {
  const base = simulate();

  it("describeBreakEven: alle Fälle", () => {
    expect(
      describeBreakEven({
        ...base,
        breakEven: { kind: "year", year: 7 },
        leadsAtHorizon: true,
      }),
    ).toBe("Immobilie liegt ab Jahr 7 vorn.");
    expect(
      describeBreakEven({
        ...base,
        breakEven: { kind: "year", year: 0 },
        leadsAtHorizon: true,
      }),
    ).toBe("Immobilie liegt von Anfang an vorn.");
    expect(
      describeBreakEven({
        ...base,
        breakEven: { kind: "year", year: 7 },
        leadsAtHorizon: false,
      }),
    ).toBe("Immobilie liegt ab Jahr 7 vorn, fällt bis Jahr 20 aber wieder zurück.");
    expect(
      describeBreakEven({
        ...base,
        breakEven: { kind: "never" },
        leadsAtHorizon: false,
      }),
    ).toBe("Innerhalb von 20 Jahren liegt der ETF durchgehend vorn.");
  });

  it("describeKpiBasis: Steuern an und aus", () => {
    expect(describeKpiBasis(base)).toBe(
      "Verkauf Ende Jahr 20, nach Verkaufskosten und Steuern",
    );
    expect(describeKpiBasis(simulate({}, { taxesEnabled: false }))).toBe(
      "Verkauf Ende Jahr 20, nach Verkaufskosten, ohne Steuern",
    );
  });

  it("Cashflow- und Finanzierungszeile nutzen Domänenwerte", () => {
    const taxed = simulate();
    const line = describeInitialCashflow(taxed);
    expect(line).toContain("nach Steuern");
    expect(line).toContain(
      formatWholeEuroDE(taxed.initialMonthlyCashflowBeforeTaxCents, {
        showPlusSign: true,
      }),
    );
    const untaxed = simulate({}, { taxesEnabled: false });
    expect(describeInitialCashflow(untaxed)).not.toContain("nach Steuern");
    const financing = describeFinancing(taxed);
    expect(financing).toContain(formatWholeEuroDE(taxed.loanPrincipalCents));
    expect(financing).toContain(formatWholeEuroDE(taxed.monthlyLoanRateCents));
    expect(financing).toContain(
      formatWholeEuroDE(taxed.initialMonthlyColdRentCents),
    );
  });
});

describe("Tooltip & Tabelle", () => {
  it("Tooltip-Titel", () => {
    const model = toPropertyVsEtfChart(simulate());
    expect(model.tooltipTitle(0)).toBe("Kauf (Jahr 0)");
    expect(model.tooltipTitle(5)).toBe("Verkauf Ende Jahr 5");
  });

  it("tooltipExtra liefert zwei Zeilen aus der Jahreszeile", () => {
    const result = simulate();
    const model = toPropertyVsEtfChart(result);
    const row = result.years[5]!;
    const extra = model.tooltipExtra(5);
    expect(extra).toHaveLength(2);
    expect(extra[0]).toEqual({
      label: "Vorteil Immobilie",
      value: formatWholeEuroDE(row.advantageCents, { showPlusSign: true }),
    });
    expect(extra[1]!.label).toBe("Bestand ohne Verkauf");
    expect(extra[1]!.value).toContain(formatWholeEuroDE(row.propertyNetWorthCents));
    expect(extra[1]!.value).toContain(formatWholeEuroDE(row.etfValueCents));
    expect(model.tooltipExtra(999)).toEqual([]);
  });

  it("Tabelle hat H + 1 Zeilen, die erste heißt „Kauf“", () => {
    const result = simulate();
    const model = toPropertyVsEtfChart(result);
    expect(model.tableRows).toHaveLength(21);
    expect(model.tableRows[0]!.year).toBe("Kauf");
    expect(model.tableRows[20]!.year).toBe("20 J.");
    expect(model.tableRows[20]!.property).toBe(
      formatWholeEuroDE(result.years[20]!.propertyLiquidationCents),
    );
  });
});
