import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { formatWholeEuroDE } from "@/frontend/charts/chart-scale";
import { CURRENT_PURCHASE_COST_RULE_SET } from "@/domain/planning/purchase-defaults";
import { calculatePurchaseCostsCents, PROPERTY_VS_ETF_DEFAULTS } from "@/domain/planning/property-vs-etf-defaults";
import { simulatePropertyVsEtf } from "@/domain/planning/property-vs-etf";
import { PropertyVsEtfWorkbench } from "@/frontend/planung/property-vs-etf-dialog";
import { toPropertyVsEtfKpis } from "@/frontend/planung/property-vs-etf-chart-data";
import {
  createPropertyVsEtfFormState,
  evaluatePropertyVsEtf,
  propertyVsEtfReducer,
  type PropertyVsEtfAction,
  type PropertyVsEtfFormState,
} from "@/frontend/planung/property-vs-etf-state";

const OBJ_B = {
  purchasePriceCents: 30_000_000,
  livingAreaCentiSqm: 7_000,
  coldRentPerSqmCents: 2_500,
};

function build(...actions: PropertyVsEtfAction[]): PropertyVsEtfFormState {
  return actions.reduce(propertyVsEtfReducer, createPropertyVsEtfFormState());
}

const fillObject: PropertyVsEtfAction[] = [
  { type: "setField", field: "purchasePriceCents", value: OBJ_B.purchasePriceCents },
  { type: "setField", field: "livingAreaCentiSqm", value: OBJ_B.livingAreaCentiSqm },
  { type: "setField", field: "coldRentPerSqmCents", value: OBJ_B.coldRentPerSqmCents },
];

function render(state: PropertyVsEtfFormState): string {
  return renderToStaticMarkup(
    <PropertyVsEtfWorkbench state={state} dispatch={() => undefined} />,
  );
}

describe("PropertyVsEtfWorkbench", () => {
  it("zeigt im Leerzustand Hinweistext, KPI-Platzhalter und kein Chart", () => {
    const html = render(createPropertyVsEtfFormState());
    expect(html).toContain(
      "Kaufpreis, Wohnfläche und Kaltmiete pro qm eingeben – dann erscheint der Vergleich.",
    );
    expect(html).not.toContain('<svg role="img"');
    expect(html).toContain("Modelliert");
    expect(html).toContain(
      "Modelliert, vereinfachte Steuerlogik, keine Steuerberatung.",
    );
    expect(html.match(/>–</g)).toHaveLength(3);
    expect(html).toContain("border-dashed");
  });

  it("belegt keines der drei Pflichtfelder vor", () => {
    const html = render(createPropertyVsEtfFormState());
    for (const label of ["Kaufpreis", "Wohnfläche", "Kaltmiete pro qm"]) {
      const match = html.match(
        new RegExp(`<label[^>]*for="([^"]+)"[^>]*>${label}</label>`),
      );
      expect(match, label).not.toBeNull();
      const id = match![1]!;
      const input = html.match(new RegExp(`<input[^>]*id="${id.replace(/:/g, ":")}"[^>]*>`));
      expect(input, label).not.toBeNull();
      expect(input![0]).toContain('value=""');
    }
  });

  it("rendert gefüllt zwei gestrichelte Linien, Marker, KPIs und Tabelle", () => {
    const state = build(...fillObject);
    const html = render(state);
    expect(html.match(/<path[^>]*stroke-dasharray="6 4"/g)).toHaveLength(2);
    expect(html).toContain("Break-even");
    expect(html).toContain("Werte als Tabelle");

    const ev = evaluatePropertyVsEtf(state);
    expect(ev.status).toBe("ok");
    if (ev.status !== "ok") return;
    expect(ev.result).toEqual(simulatePropertyVsEtf(ev.input, ev.tax));
    for (const kpi of toPropertyVsEtfKpis(ev.result)) {
      expect(html).toContain(kpi.value);
      expect(html).toMatch(
        new RegExp(`tabular-nums[^"]*"[^>]*>${kpi.value.replace(/[+.]/g, "\\$&")}<`),
      );
    }
    expect(html).toContain('aria-label="Ergebnis"');
    expect(html).toMatch(/aria-label="Ergebnis"[^>]*class="[^"]*border-dashed/);
  });

  it("zeigt Objekt offen, Annahmen und Steuern als geschlossene details", () => {
    const html = render(build(...fillObject));
    expect(html).toContain(">Objekt</h3>");
    expect(html).not.toMatch(/<details[^>]*>\s*<summary[^>]*>\s*Objekt/);
    const details = html.match(/<details[^>]*>/g) ?? [];
    // zwei Blöcke + Tabellen-Aufklapper
    expect(details.length).toBeGreaterThanOrEqual(3);
    for (const d of details) expect(d).not.toContain("open");
    expect(html).toMatch(/<summary[^>]*>Annahmen/);
    expect(html).toMatch(/<summary[^>]*>Steuern &amp; Verkauf/);
  });

  it("ergänzt „(angepasst)“ nach geänderter ETF-Rendite", () => {
    expect(render(build(...fillObject))).not.toContain("(angepasst)");
    const html = render(
      build(...fillObject, { type: "setField", field: "etfAnnualReturnBps", value: 700 }),
    );
    expect(html).toContain("(angepasst)");
  });

  it("deaktiviert bei Steuern aus die Steuerfelder, nicht aber Verkaufskosten", () => {
    const html = render(
      build(...fillObject, { type: "setTaxesEnabled", value: false }),
    );
    const idOf = (label: string) => {
      const m = html.match(new RegExp(`<label[^>]*for="([^"]+)"[^>]*>${label}</label>`));
      expect(m, label).not.toBeNull();
      return m![1]!;
    };
    const inputTag = (id: string) => {
      const m = html.match(new RegExp(`<input[^>]*id="${id}"[^>]*>`));
      expect(m).not.toBeNull();
      return m![0];
    };
    expect(inputTag(idOf("Grenzsteuersatz"))).toContain('disabled=""');
    expect(inputTag(idOf("Maklerprovision \\(Verkäufer\\)"))).not.toContain('disabled=""');
    expect(inputTag(idOf("Sonstige Verkaufskosten"))).not.toContain('disabled=""');
    expect(inputTag(idOf("Rücklage wird verwendet nach"))).toContain('disabled=""');
    expect(html).toContain("ohne Steuern");
    expect(html).toContain("Verkaufskosten wirken auch ohne Steuern");
  });

  it("zeigt Klemm-Hinweis und Reset-Link nur bei manuellem Eigenkapital unter den Nebenkosten", () => {
    const manual = render(build(...fillObject, { type: "setEquity", value: 1 }));
    expect(manual).toContain("auf die Kaufnebenkosten angehoben");
    expect(manual).toContain("Auf Nebenkosten zurücksetzen");

    const auto = render(build(...fillObject));
    expect(auto).not.toContain("auf die Kaufnebenkosten angehoben");
    expect(auto).not.toContain("Auf Nebenkosten zurücksetzen");

    const high = render(
      build(...fillObject, { type: "setEquity", value: 900_000_000 }),
    );
    expect(high).toContain("auf Kaufpreis plus Nebenkosten begrenzt");
  });

  it("zeigt bei ungültiger Eingabe den Feldfehler und ohne letzten Stand den Leerzustand", () => {
    const html = render(
      build(...fillObject, { type: "setField", field: "interestRateBps", value: 1_501 }),
    );
    expect(html).toContain("Zinssatz: höchstens 15,00 %");
    expect(html).toContain("Bitte Eingaben prüfen.");
    expect(html).not.toContain("<svg role=\"img\"");
  });

  it("zeigt Nebenkosten und Eigenkapital-Grenzen schon mit nur dem Kaufpreis (Leerzustand bleibt)", () => {
    const price = OBJ_B.purchasePriceCents;
    const html = render(
      build({ type: "setField", field: "purchasePriceCents", value: price }),
    );
    const costs = calculatePurchaseCostsCents(
      price,
      PROPERTY_VS_ETF_DEFAULTS.purchaseCostsBps,
    );
    expect(html).toContain(`= ${formatWholeEuroDE(costs)}`);
    expect(html).toContain("mind. " + formatWholeEuroDE(costs));
    expect(html).toContain("Kaufpreis, Wohnfläche und Kaltmiete pro qm eingeben");
    expect(html).toContain(`value="${(costs / 100).toFixed(2).replace(".", ",")}"`);

    const clamped = render(
      build(
        { type: "setField", field: "purchasePriceCents", value: price },
        { type: "setEquity", value: 1 },
      ),
    );
    expect(clamped).toContain("auf die Kaufnebenkosten angehoben");
  });

  it("liest Posten, Hinweise und Notiz aus dem Regelwerk", () => {
    const html = render(createPropertyVsEtfFormState())
      .replace(/&#x27;/g, "'")
      .replace(/&amp;/g, "&");
    const ruleSet = CURRENT_PURCHASE_COST_RULE_SET;
    expect(html).toContain(ruleSet.note);
    for (const item of ruleSet.items) {
      expect(html).toContain(item.label);
      expect(html).toContain(item.hint);
    }
  });

  it("zeigt bei gültigem Zustand den zugeklappten Erklär-Aufklapper mit Domänenwerten", () => {
    const state = build(...fillObject);
    const html = render(state);
    expect(html).toContain("Wie wurde gerechnet?");
    const evaluation = evaluatePropertyVsEtf(state);
    if (evaluation.status !== "ok") throw new Error("nicht ok");
    const marker = html.indexOf("Wie wurde gerechnet?");
    const detailsStart = html.lastIndexOf("<details", marker);
    expect(html.slice(detailsStart, marker)).not.toContain(" open");
    expect(html).toContain(formatWholeEuroDE(evaluation.result.loanPrincipalCents));
  });

  it("zeigt im Leerzustand keinen Erklär-Aufklapper", () => {
    expect(render(createPropertyVsEtfFormState())).not.toContain(
      "Wie wurde gerechnet?",
    );
  });

  it("zeigt den Kaufrechner-Hinweis nur mit origin im Leerzustand", () => {
    const empty = createPropertyVsEtfFormState();
    const withOrigin = renderToStaticMarkup(
      <PropertyVsEtfWorkbench state={empty} dispatch={() => undefined} origin="kaufrechner" />,
    );
    expect(withOrigin).toContain("Aus dem Kaufrechner übernommen");
    expect(render(empty)).not.toContain("Aus dem Kaufrechner übernommen");
  });

  it("rendert „Link kopieren“ nur mit onCopyLink", () => {
    const state = createPropertyVsEtfFormState();
    const withCopy = renderToStaticMarkup(
      <PropertyVsEtfWorkbench
        state={state}
        dispatch={() => undefined}
        onCopyLink={async () => ({ copied: true, url: "x" })}
      />,
    );
    expect(withCopy).toContain("Link kopieren");
    expect(render(state)).not.toContain("Link kopieren");
  });
});
