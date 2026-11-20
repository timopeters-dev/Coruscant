import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { simulatePropertyVsEtf } from "@/lib/domain/property-vs-etf";
import {
  DEFAULT_REINVEST_SURPLUS,
  PROPERTY_VS_ETF_TAX_DEFAULTS,
} from "@/lib/domain/property-vs-etf-defaults";
import {
  describeKpiBasis,
  toPropertyVsEtfChart,
} from "./property-vs-etf-chart-data";
import { PropertyVsEtfWorkbench } from "./property-vs-etf-dialog";
import { buildPropertyVsEtfExplanation } from "./property-vs-etf-explanation";
import { PROPERTY_VS_ETF_FIELD_INFO } from "./property-vs-etf-field-info";
import {
  mergePropertyVsEtfQuery,
  parsePropertyVsEtfQuery,
  PROPERTY_VS_ETF_QUERY_KEYS,
  serializePropertyVsEtfState,
} from "./property-vs-etf-query";
import {
  createPropertyVsEtfFormState,
  evaluatePropertyVsEtf,
  isAssumptionsModified,
  isTaxModified,
  PROPERTY_VS_ETF_UI_SLIDERS,
  propertyVsEtfReducer,
  type PropertyVsEtfAction,
  type PropertyVsEtfEvaluation,
  type PropertyVsEtfFormState,
} from "./property-vs-etf-state";
import { SliderField } from "./euro-slider-field";

type Ok = Extract<PropertyVsEtfEvaluation, { status: "ok" }>;

const OBJECT: PropertyVsEtfAction[] = [
  { type: "setField", field: "purchasePriceCents", value: 30_000_000 },
  { type: "setField", field: "livingAreaCentiSqm", value: 7_000 },
  // positiver Cashflow (hohe Miete)
  { type: "setField", field: "coldRentPerSqmCents", value: 2_500 },
];

function build(...actions: PropertyVsEtfAction[]): PropertyVsEtfFormState {
  return [...OBJECT, ...actions].reduce(
    propertyVsEtfReducer,
    createPropertyVsEtfFormState(),
  );
}
function evaluate(...actions: PropertyVsEtfAction[]): Ok {
  const e = evaluatePropertyVsEtf(build(...actions));
  if (e.status !== "ok") throw new Error("nicht rechenbar");
  return e;
}
const parse = (q: string) => parsePropertyVsEtfQuery(new URLSearchParams(q));
const OPEN = "dialog=immo-etf";

describe("State 25e", () => {
  it("Standardzustand", () => {
    const s = createPropertyVsEtfFormState();
    expect(s.reinvestSurplus).toBe(false);
    expect(DEFAULT_REINVEST_SURPLUS).toBe(false);
    expect(s.tax.brokerFeeBps).toBe(357);
    expect(s.tax.otherSaleCostsBps).toBe(30);
    expect(s.tax.reserveDeductionLagYears).toBe(5);
  });

  it("setReinvestSurplus und Reset", () => {
    const on = propertyVsEtfReducer(createPropertyVsEtfFormState(), {
      type: "setReinvestSurplus",
      value: true,
    });
    expect(isAssumptionsModified(on)).toBe(true);
    const reset = propertyVsEtfReducer(on, { type: "resetAssumptions" });
    expect(reset.reinvestSurplus).toBe(false);
    expect(isAssumptionsModified(reset)).toBe(false);
    expect(
      propertyVsEtfReducer(on, { type: "resetAll" }).reinvestSurplus,
    ).toBe(false);
  });

  it.each([
    ["brokerFeeBps", 100],
    ["otherSaleCostsBps", 100],
    ["reserveDeductionLagYears", 1],
  ] as const)("Steuerfeld %s markiert Steuern als angepasst", (field, value) => {
    const s = propertyVsEtfReducer(createPropertyVsEtfFormState(), {
      type: "setTaxField",
      field,
      value,
    });
    expect(isTaxModified(s)).toBe(true);
    expect(isTaxModified(propertyVsEtfReducer(s, { type: "resetTaxes" }))).toBe(false);
  });

  it("reicht reinvestSurplus an die Domäne durch", () => {
    expect(evaluate({ type: "setReinvestSurplus", value: true }).result.reinvestSurplus).toBe(true);
    expect(evaluate().result.reinvestSurplus).toBe(false);
  });

  it("ungültiger Makler ergibt Feldfehler", () => {
    const e = evaluatePropertyVsEtf(
      build({ type: "setTaxField", field: "brokerFeeBps", value: 2_500 }),
    );
    expect(e.status).toBe("invalid");
    if (e.status === "invalid") expect(e.fieldErrors.brokerFeeBps).toBeDefined();
  });

  it("Regler liegen in den Domänengrenzen und 3,57 % ist treffbar", () => {
    expect(PROPERTY_VS_ETF_UI_SLIDERS.brokerFeeBps).toEqual({ min: 0, max: 700, step: 1 });
    expect(PROPERTY_VS_ETF_UI_SLIDERS.otherSaleCostsBps).toEqual({ min: 0, max: 200, step: 5 });
    expect(PROPERTY_VS_ETF_UI_SLIDERS.reserveDeductionLagYears).toEqual({ min: 0, max: 15, step: 1 });
  });
});

describe("Query 25e", () => {
  it("Rundlauf und Reihenfolge", () => {
    const s = createPropertyVsEtfFormState();
    s.reinvestSurplus = true;
    s.tax.brokerFeeBps = 200;
    s.tax.otherSaleCostsBps = 10;
    s.tax.reserveDeductionLagYears = 2;
    s.tax.churchTaxBps = 900;
    const q = serializePropertyVsEtfState(s).toString();
    expect(q).toBe("reinv=1&kist=900&makler=200&vks=10&ihrv=2");
    const back = parse(`${OPEN}&${q}`).state;
    expect(back).toEqual(s);
  });

  it("Standardwerte werden nicht geschrieben", () => {
    expect(serializePropertyVsEtfState(createPropertyVsEtfFormState()).toString()).toBe("");
  });

  it("reservierte Schlüssel", () => {
    for (const k of ["makler", "vks", "ihrv", "reinv", "vk"]) {
      expect(PROPERTY_VS_ETF_QUERY_KEYS).toContain(k);
    }
  });

  it.each([
    ["vk=350", 350, 0],
    ["vk=350&vks=20", 350, 20],
    ["vk=350&makler=200", 200, 30],
    ["vk=abc", 357, 30],
    ["vk=2000", 2_000, 0],
    ["vk=2001", 357, 30],
    ["", 357, 30],
  ])("altes Lesezeichen %s", (q, broker, other) => {
    const s = parse(`${OPEN}&${q}`).state;
    expect(s.tax.brokerFeeBps).toBe(broker);
    expect(s.tax.otherSaleCostsBps).toBe(other);
    expect(s.tax.reserveDeductionLagYears).toBe(5);
    expect(s.reinvestSurplus).toBe(false);
  });

  it("Steuern aus + vk: Ergebnis gleich der 25d-Eingabe", () => {
    const q = `${OPEN}&kp=30000000&wfl=7000&kmqm=2500&steuer=0&vk=350`;
    const state = parse(q).state;
    const e = evaluatePropertyVsEtf(state);
    expect(e.status).toBe("ok");
    if (e.status !== "ok") return;
    const direct = simulatePropertyVsEtf(e.input, {
      ...e.tax,
      brokerFeeBps: 350,
      otherSaleCostsBps: 0,
      reserveDeductionLagYears: 0,
    });
    expect(e.result).toEqual(direct);
  });

  it("Steuern an + vk: gleiche Verkaufskosten, abweichende Steuer in Jahr 1", () => {
    const base = `${OPEN}&kp=30000000&wfl=7000&kmqm=1200&vk=350`;
    const e = evaluatePropertyVsEtf(parse(base).state);
    expect(e.status).toBe("ok");
    if (e.status !== "ok") return;
    const old = simulatePropertyVsEtf(e.input, {
      ...e.tax,
      brokerFeeBps: 350,
      otherSaleCostsBps: 0,
      reserveDeductionLagYears: 0,
    });
    e.result.years.forEach((row, i) => {
      expect(row.saleCostsCents).toBe(old.years[i]!.saleCostsCents);
    });
    expect(e.result.years[1]!.rentalIncomeTaxYearCents).toBeGreaterThan(
      old.years[1]!.rentalIncomeTaxYearCents,
    );
  });

  it("merge entfernt vk und schreibt makler/vks", () => {
    const state = parse(`${OPEN}&vk=350&foo=bar`).state;
    const merged = mergePropertyVsEtfQuery(`?${OPEN}&vk=350&foo=bar`, true, state);
    const p = new URLSearchParams(merged);
    expect(p.has("vk")).toBe(false);
    expect(p.get("makler")).toBe("350");
    expect(p.get("vks")).toBe("0");
    expect(p.get("foo")).toBe("bar");
  });

  it.each(["makler=-1", "makler=3.5", "vks=99999", "ihrv=16", "ihrv=x", "reinv=ja", "reinv="])(
    "kaputter Wert %s ergibt Standard",
    (q) => {
      const s = parse(`${OPEN}&${q}`).state;
      const d = createPropertyVsEtfFormState();
      expect(s).toEqual(d);
    },
  );
});

describe("Chart-Adapter 25e", () => {
  const off = () => toPropertyVsEtfChart(evaluate().result);
  const on = () =>
    toPropertyVsEtfChart(
      evaluate({ type: "setReinvestSurplus", value: true }).result,
    );

  it("Schalter aus: zwei Serien, vier Spalten", () => {
    const c = off();
    expect(c.series.map((x) => x.id)).toEqual(["property", "etf"]);
    expect(c.series[0]!.label).toBe("Immobilie (nach Verkauf)");
    expect(c.tableColumns).toHaveLength(4);
    expect(c.tableRows[1]).not.toHaveProperty("propertyWithoutDepot");
  });

  it("Schalter an: drei gestrichelte Serien, fünf Spalten", () => {
    const shown = evaluate({ type: "setReinvestSurplus", value: true });
    const c = toPropertyVsEtfChart(shown.result);
    expect(c.series.map((x) => x.id)).toEqual(["property", "propertyWithoutDepot", "etf"]);
    expect(c.series.map((x) => x.role)).toEqual(["bound", "baseline", "optionB"]);
    expect(c.series.every((x) => x.dashed)).toBe(true);
    expect(c.series[1]!.points[3]!.y).toBe(
      shown.result.years[3]!.propertyLiquidationWithoutDepotCents,
    );
    expect(c.series[0]!.points[3]!.y).toBe(shown.result.years[3]!.propertyLiquidationCents);
    expect(c.tableColumns).toHaveLength(5);
    expect(c.legend).toHaveLength(3);
    expect(c.ariaLabel).toContain("Überschuss-Depot");
    const labels = c.tooltipExtra(3).map((x) => x.label);
    expect(labels).toContain("Überschuss-Depot (nach Steuern)");
    expect(labels).toContain("Immobilie mit zinslosem Überschuss");
    expect(describeKpiBasis(shown.result)).toContain("Überschuss-Depot");
    expect(describeKpiBasis(evaluate().result)).not.toContain("Überschuss-Depot");
  });

  it("nur negativer Cashflow: dritte Linie trotzdem, deckungsgleich", () => {
    const shown = evaluate(
      { type: "setField", field: "coldRentPerSqmCents", value: 800 },
      { type: "setReinvestSurplus", value: true },
    );
    const c = toPropertyVsEtfChart(shown.result);
    expect(c.series).toHaveLength(3);
    expect(c.series[0]!.points).toEqual(c.series[1]!.points);
  });
  void off;
  void on;
});

describe("Erklärung 25e", () => {
  const text = (shown: Ok) =>
    buildPropertyVsEtfExplanation(shown)
      .flatMap((s) => [s.title, ...s.items.map((i) => `${i.label}: ${i.value}`), s.note ?? ""])
      .join("\n");

  it("Überschuss-Text hängt vom Schalter ab", () => {
    const aus = text(evaluate());
    const an = text(evaluate({ type: "setReinvestSurplus", value: true }));
    expect(aus).toContain("zinslos");
    expect(aus).not.toContain("Überschuss-Depot");
    expect(an).toContain("Überschuss-Depot");
    expect(an).toContain("Einzahlungen ins Depot");
    expect(an).toContain("Depot-Steuer");
    expect(an).toContain("je Szenario einmal");
  });

  it("Verzögerung", () => {
    expect(text(evaluate())).toContain("erst nach 5 Jahren");
    expect(text(evaluate({ type: "setTaxField", field: "reserveDeductionLagYears", value: 0 }))).toContain(
      "im Jahr der Zahlung",
    );
    expect(
      text(
        evaluate(
          { type: "setTaxField", field: "reserveDeductionLagYears", value: 15 },
          { type: "setField", field: "horizonYears", value: 10 },
        ),
      ),
    ).toContain("Innerhalb des Horizonts wird keine Rücklage abgesetzt");
  });

  it("Verkaufskosten, Nicht-abgebildet, kein altes Wording", () => {
    const t = text(evaluate());
    expect(t).toContain("3,57 %");
    expect(t).toContain("0,30 %");
    expect(t).toContain("3,87 %");
    expect(t).toContain("Vorfälligkeitsentschädigung");
    expect(t).toContain("§ 6 Abs. 1 Nr. 1a EStG");
    expect(t).not.toContain("gilt als abzugsfähig");
  });

  it("Steuern aus", () => {
    const t = text(evaluate({ type: "setTaxesEnabled", value: false }));
    expect(t).toContain("Rücklage-Verzögerung: ohne Wirkung");
    expect(t).toContain("Makler 3,57 %");
  });
});

describe("Field-Info 25e", () => {
  const keys = [
    ...Object.keys(PROPERTY_VS_ETF_UI_SLIDERS),
    "purchasePriceCents",
    "livingAreaCentiSqm",
    "coldRentPerSqmCents",
    "equityCents",
    "monthlyHoaCostsCents",
    "saverAllowanceCents",
    "churchTaxBps",
    "taxesEnabled",
    "reinvestSurplus",
  ];
  it.each(keys)("%s hat einen kurzen Text ohne Technikjargon", (key) => {
    const text = (PROPERTY_VS_ETF_FIELD_INFO as Record<string, string>)[key];
    expect(text).toBeTruthy();
    expect(text!.length).toBeLessThanOrEqual(280);
    expect(text).not.toContain("Cent");
    expect(text).not.toContain("bps");
  });
});

describe("InfoTip & SliderField", () => {
  const slider = (info?: string) =>
    renderToStaticMarkup(
      <SliderField
        id="x"
        label="Zins"
        value={100}
        min={0}
        max={500}
        step={5}
        kind="percent"
        onChange={() => undefined}
        info={info}
      />,
    );

  it("ohne info kein Info-Button, mit info ein geschlossener", () => {
    expect(slider()).not.toContain("Erklärung:");
    const html = slider("Text");
    expect(html).toContain('aria-label="Erklärung: Zins"');
    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain('aria-controls="x-info"');
    expect(html).toMatch(/<span id="x-info"[^>]*hidden/);
  });
});

describe("Dialog 25e", () => {
  const render = (s: PropertyVsEtfFormState) =>
    renderToStaticMarkup(<PropertyVsEtfWorkbench state={s} dispatch={() => undefined} />).replace(
      /&#x27;/g,
      "'",
    );

  it("neue Eingaben, Summe und Info-Buttons", () => {
    const html = render(build());
    expect(html).toContain("Positiven Cashflow im ETF anlegen");
    expect(html).toMatch(/role="switch"[^>]*aria-checked="false"|aria-checked="false"[^>]*role="switch"/);
    expect(html).toContain("Maklerprovision (Verkäufer)");
    expect(html).toContain("Sonstige Verkaufskosten");
    expect(html).toContain("Rücklage wird verwendet nach");
    expect(html).toContain("Verkaufskosten gesamt: 3,87 %");
    expect(html).not.toMatch(/>Verkaufskosten<\/label>/);
    for (const label of ["Darlehenszins", "Kaufpreis", "Kirchensteuer", "Steuern berücksichtigen", "Sparerpauschbetrag"]) {
      expect(html).toContain(`aria-label="Erklärung: ${label}"`);
    }
  });

  it("Schalter an zeigt drei Legenden-Einträge", () => {
    const html = render(build({ type: "setReinvestSurplus", value: true }));
    expect(html).toContain("Immobilie mit Überschuss-Depot");
    expect(html).toContain("Immobilie mit zinslosem Überschuss");
  });

  it("Steuersatz-Default ist durchgereicht", () => {
    expect(PROPERTY_VS_ETF_TAX_DEFAULTS.reserveDeductionLagYears).toBe(5);
  });
});

describe("KPI Überschusslinie", () => {
  it("nur bei eingeschaltetem Schalter, Wert aus der Domäne", async () => {
    const { toPropertyVsEtfKpis } = await import("./property-vs-etf-chart-data");
    const { formatWholeEuroDE } = await import("@/components/charts/chart-scale");
    const offKpis = toPropertyVsEtfKpis(evaluate().result);
    expect(offKpis.map((k) => k.key)).toEqual(["property", "etf", "advantage"]);
    const shown = evaluate({ type: "setReinvestSurplus", value: true });
    const kpis = toPropertyVsEtfKpis(shown.result);
    expect(kpis.map((k) => k.key)).toEqual([
      "property",
      "etf",
      "advantage",
      "propertyWithoutDepot",
    ]);
    expect(kpis[3]!.value).toBe(
      formatWholeEuroDE(shown.result.final.propertyLiquidationWithoutDepotCents),
    );
  });
});

describe("KPI-Beschriftung bei Überschuss-Depot", () => {
  it("nennt das Depot im ersten KPI nur bei eingeschaltetem Schalter", async () => {
    const { toPropertyVsEtfKpis } = await import("./property-vs-etf-chart-data");
    expect(toPropertyVsEtfKpis(evaluate().result)[0]!.label).toBe("Immobilien-Vermögen");
    const on = toPropertyVsEtfKpis(
      evaluate({ type: "setReinvestSurplus", value: true }).result,
    );
    expect(on[0]!.label).toBe("Immobilien-Vermögen inkl. Überschuss-Depot");
    expect(on[3]!.label).toBe("Immobilien-Vermögen mit zinslosem Überschuss");
  });
});
