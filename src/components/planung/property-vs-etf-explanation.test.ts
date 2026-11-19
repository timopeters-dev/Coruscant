import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { formatBpsDE, formatCentsDE, formatWholeEuroDE } from "@/lib/domain/money";
import { buildPropertyVsEtfExplanation } from "./property-vs-etf-explanation";
import {
  createPropertyVsEtfFormState,
  evaluatePropertyVsEtf,
  propertyVsEtfReducer,
  type PropertyVsEtfAction,
  type PropertyVsEtfEvaluation,
} from "./property-vs-etf-state";

type Ok = Extract<PropertyVsEtfEvaluation, { status: "ok" }>;

function evaluate(...actions: PropertyVsEtfAction[]): Ok {
  const base: PropertyVsEtfAction[] = [
    { type: "setField", field: "purchasePriceCents", value: 30_000_000 },
    { type: "setField", field: "livingAreaCentiSqm", value: 7_000 },
    { type: "setField", field: "coldRentPerSqmCents", value: 1_250 },
  ];
  const state = [...base, ...actions].reduce(
    propertyVsEtfReducer,
    createPropertyVsEtfFormState(),
  );
  const evaluation = evaluatePropertyVsEtf(state);
  if (evaluation.status !== "ok") throw new Error("Fixture nicht rechenbar");
  return evaluation;
}

function text(shown: Ok): string {
  return buildPropertyVsEtfExplanation(shown)
    .flatMap((s) => [
      s.title,
      ...s.items.map((i) => `${i.label}: ${i.value}`),
      s.note ?? "",
    ])
    .join("\n");
}

function section(shown: Ok, key: string): string {
  const s = buildPropertyVsEtfExplanation(shown).find((x) => x.key === key)!;
  return [...s.items.map((i) => `${i.label}: ${i.value}`), s.note ?? ""].join("\n");
}

describe("buildPropertyVsEtfExplanation", () => {
  it("liefert alle acht Abschnitte mit formatierten Domänen-Werten", () => {
    const shown = evaluate();
    const sections = buildPropertyVsEtfExplanation(shown);
    expect(sections.map((s) => s.key)).toEqual([
      "financing",
      "loan",
      "rent",
      "cashflow",
      "etf",
      "taxes",
      "sale",
      "limits",
    ]);
    const t = text(shown);
    expect(t).toContain(formatWholeEuroDE(shown.result.loanPrincipalCents));
    expect(t).toContain(formatCentsDE(shown.result.monthlyLoanRateCents));
    expect(t).toContain(formatWholeEuroDE(shown.result.depreciationBasisCents));
    expect(t).toContain(`steuerfrei ab Jahr ${shown.result.speculationFreeFromYear}`);
    expect(t).toContain(formatBpsDE(1_00));
    expect(t).toContain("1,00 %");
  });

  it("zeigt exakt die Werte der Auswertung (keine Parallelrechnung)", () => {
    const shown = evaluate();
    const fake: Ok = {
      ...shown,
      result: {
        ...shown.result,
        loanPrincipalCents: 123_456_700,
        monthlyLoanRateCents: 987_654,
        annualDepreciationCents: 55_555_500,
      },
    };
    const t = text(fake);
    expect(t).toContain(formatWholeEuroDE(123_456_700));
    expect(t).toContain(formatCentsDE(987_654));
    expect(t).toContain(formatWholeEuroDE(55_555_500));
    expect(section(fake, "financing")).not.toContain(
      `Darlehen: ${formatWholeEuroDE(shown.result.loanPrincipalCents)}`,
    );
  });

  it("Steuern aus: Aus-Text, keine AfA-/Spekulationszeilen, Verkaufskosten bleiben", () => {
    const shown = evaluate(
      { type: "setTaxesEnabled", value: false },
      { type: "setTaxField", field: "saleCostsBps", value: 300 },
    );
    const taxes = section(shown, "taxes");
    expect(taxes).toContain("nicht berücksichtigt");
    expect(taxes).not.toContain("AfA");
    expect(taxes).not.toContain("Spekulationsfrist");
    expect(section(shown, "sale")).toContain("3,00 %");
  });

  it("Variante ohne Darlehen (EK = Gesamtkosten)", () => {
    const shown = evaluate({ type: "setEquity", value: 40_000_000 });
    expect(shown.result.flags.noLoan).toBe(true);
    expect(section(shown, "loan")).toContain("kein Darlehen");
  });

  it("Variante ohne Tilgung", () => {
    const shown = evaluate({
      type: "setField",
      field: "initialRepaymentBps",
      value: 0,
    });
    expect(shown.result.flags.noAmortization).toBe(true);
    expect(section(shown, "loan")).toContain("Ohne Tilgung");
  });

  it("Darlehen im Horizont getilgt: Text mit Jahr; sonst nicht getilgt", () => {
    const paid = evaluate(
      { type: "setField", field: "initialRepaymentBps", value: 600 },
      { type: "setField", field: "interestRateBps", value: 100 },
      { type: "setField", field: "horizonYears", value: 40 },
    );
    expect(paid.result.loanPaidOffInMonth).not.toBeNull();
    expect(section(paid, "loan")).toMatch(/getilgt in Jahr \d+, Monat \d+/);

    const open = evaluate({ type: "setField", field: "horizonYears", value: 5 });
    expect(section(open, "loan")).toContain("innerhalb des Horizonts nicht getilgt");
  });

  it("Zuzahlung, Überschuss und Erstattung erscheinen nur bei gesetzten Flags", () => {
    const shown = evaluate();
    const flagged: Ok = {
      ...shown,
      result: {
        ...shown.result,
        flags: {
          ...shown.result.flags,
          hadTopUps: true,
          hadSurplus: true,
          hadRefunds: true,
        },
      },
    };
    expect(section(flagged, "cashflow")).toContain("Zuzahlungen");
    expect(section(flagged, "cashflow")).toContain("Überschüsse");
    expect(section(flagged, "taxes")).toContain("Erstattungen");

    const plain: Ok = {
      ...shown,
      result: {
        ...shown.result,
        flags: {
          ...shown.result.flags,
          hadTopUps: false,
          hadSurplus: false,
          hadRefunds: false,
        },
      },
    };
    expect(section(plain, "cashflow")).not.toContain("Im Verlauf");
    expect(section(plain, "taxes")).not.toContain("Im Verlauf");
  });

  it("Eigenkapital angehoben/begrenzt erzeugt eine Zusatzzeile", () => {
    const raised = evaluate({ type: "setEquity", value: 1 });
    expect(raised.equity.clamped).toBe("raised_to_costs");
    expect(section(raised, "financing")).toContain("angehoben");

    const lowered = evaluate({ type: "setEquity", value: 999_999_999 });
    expect(lowered.equity.clamped).toBe("lowered_to_total");
    expect(section(lowered, "financing")).toContain("begrenzt");

    expect(section(evaluate(), "financing")).not.toContain("Hinweis");
  });

  it("importiert keine Rechenfunktionen", () => {
    const source = fs.readFileSync(
      path.resolve(process.cwd(), "src/components/planung/property-vs-etf-explanation.ts"),
      "utf8",
    );
    expect(source).not.toContain("simulatePropertyVsEtf");
    expect(source).not.toMatch(/\bcalculate[A-Z]\w*/);
    expect(source).not.toContain("defaultEquityCents");
    expect(source).not.toContain("property-vs-etf-tax");
  });
});
