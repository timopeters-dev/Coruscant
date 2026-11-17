import { describe, expect, it } from "vitest";
import {
  estimateSection35a,
  listTaxYears,
  resolveDefaultTaxYear,
  resolveSection35aRule,
  SECTION_35A_RULES,
  SECTION_35A_RULES_REVIEWED_THROUGH_YEAR,
  type Section35aRule,
  summarizeTaxYear,
  TAX_BUCKETS,
  type TaxSummaryInputDocument,
} from "./tax-summary";

function makeDoc(
  overrides: Partial<TaxSummaryInputDocument> = {},
): TaxSummaryInputDocument {
  return {
    id: "doc-1",
    filename: "rechnung.pdf",
    status: "verified",
    documentDate: "2025-06-15",
    issuer: "Musterbetrieb GmbH",
    totalAmountCents: 120_000,
    linkedPropertyId: null,
    isTaxRelevant: true,
    taxYear: 2025,
    taxCategory: "handwerker_35a",
    deductibleAmountCents: 84_000,
    ...overrides,
  };
}

describe("summarizeTaxYear – Filterung", () => {
  it("zählt nur verified && isTaxRelevant; pending nur als Hinweis", () => {
    const summary = summarizeTaxYear(
      [
        makeDoc({ id: "a" }),
        makeDoc({ id: "pending", status: "pending_review", totalAmountCents: 999_900 }),
        makeDoc({ id: "non-tax", isTaxRelevant: false }),
      ],
      2025,
    );
    expect(summary.documentCount).toBe(1);
    expect(summary.pendingReviewCount).toBe(1);
    expect(summary.totalAmountCents).toBe(120_000);
    expect(summary.items.map((i) => i.documentId)).toEqual(["a"]);
  });

  it("explizites taxYear schlägt documentDate", () => {
    const docs = [makeDoc({ documentDate: "2025-01-10", taxYear: 2024 })];
    expect(summarizeTaxYear(docs, 2024).documentCount).toBe(1);
    expect(summarizeTaxYear(docs, 2025).documentCount).toBe(0);
  });

  it("fällt auf documentDate zurück; ohne beides in keinem Jahr", () => {
    const docs = [
      makeDoc({ id: "a", taxYear: null, documentDate: "2025-03-01" }),
      makeDoc({ id: "b", taxYear: null, documentDate: null }),
    ];
    expect(summarizeTaxYear(docs, 2025).items.map((i) => i.documentId)).toEqual(["a"]);
    expect(listTaxYears(docs)).toEqual([2025]);
  });

  it("trennt Grenzdaten 2024-12-31 und 2025-01-01", () => {
    const docs = [
      makeDoc({ id: "a", taxYear: null, documentDate: "2024-12-31" }),
      makeDoc({ id: "b", taxYear: null, documentDate: "2025-01-01" }),
    ];
    expect(summarizeTaxYear(docs, 2024).items.map((i) => i.documentId)).toEqual(["a"]);
    expect(summarizeTaxYear(docs, 2025).items.map((i) => i.documentId)).toEqual(["b"]);
  });
});

describe("summarizeTaxYear – unvollständige Beträge", () => {
  it("fehlender absetzbarer Betrag: Gesamt zählt, absetzbar 0, Issue", () => {
    const summary = summarizeTaxYear([makeDoc({ deductibleAmountCents: null })], 2025);
    expect(summary.totalAmountCents).toBe(120_000);
    expect(summary.totalDeductibleCents).toBe(0);
    expect(summary.incompleteCount).toBe(1);
    expect(summary.items[0]?.issues).toEqual(["missing_labor_share"]);
    expect(summary.items[0]?.deductibleAmountCents).toBeNull();
  });

  it("fehlende Kategorie → unassigned, nicht other", () => {
    const summary = summarizeTaxYear([makeDoc({ taxCategory: null })], 2025);
    expect(summary.buckets.map((b) => b.bucket)).toEqual(["unassigned"]);
    expect(summary.items[0]?.issues).toEqual(["missing_category"]);
  });

  it("fehlender Gesamtbetrag zählt als 0, Item behält null", () => {
    const summary = summarizeTaxYear([makeDoc({ totalAmountCents: null })], 2025);
    expect(summary.totalAmountCents).toBe(0);
    expect(summary.items[0]?.totalAmountCents).toBeNull();
    expect(summary.items[0]?.issues).toEqual(["missing_total"]);
  });

  it("capital_gains ohne absetzbar: kein Issue; Betrag nicht in absetzbar gesamt", () => {
    const summary = summarizeTaxYear(
      [
        makeDoc({
          id: "kap",
          taxCategory: "capital_gains",
          totalAmountCents: 50_000,
          deductibleAmountCents: null,
        }),
        makeDoc({
          id: "kap2",
          taxCategory: "capital_gains",
          totalAmountCents: 10_000,
          deductibleAmountCents: 10_000,
        }),
      ],
      2025,
    );
    expect(summary.incompleteCount).toBe(0);
    expect(summary.totalAmountCents).toBe(60_000);
    expect(summary.totalDeductibleCents).toBe(0);
    expect(summary.buckets[0]?.isInformational).toBe(true);
  });

  it("unassigned mit absetzbar: Betrag sichtbar, aber nicht in absetzbar gesamt", () => {
    const summary = summarizeTaxYear(
      [
        makeDoc({ id: "ok", totalAmountCents: 20_000, deductibleAmountCents: 5_000 }),
        makeDoc({
          id: "un",
          taxCategory: null,
          totalAmountCents: 30_000,
          deductibleAmountCents: 10_000,
        }),
      ],
      2025,
    );
    const bucket = summary.buckets.find((b) => b.bucket === "unassigned");
    expect(bucket?.deductibleAmountCents).toBe(10_000);
    expect(bucket?.isExcludedFromDeductibleTotal).toBe(true);
    expect(summary.totalAmountCents).toBe(50_000);
    expect(summary.totalDeductibleCents).toBe(5_000);
  });

  it("capital_gains mit absetzbar lässt totalDeductibleCents unverändert", () => {
    const base = [makeDoc({ id: "ok", deductibleAmountCents: 5_000 })];
    const withGains = summarizeTaxYear(
      [
        ...base,
        makeDoc({
          id: "kap",
          taxCategory: "capital_gains",
          totalAmountCents: 20_000,
          deductibleAmountCents: 10_000,
        }),
      ],
      2025,
    );
    expect(withGains.totalDeductibleCents).toBe(
      summarizeTaxYear(base, 2025).totalDeductibleCents,
    );
  });

  it("fehlender Absetzbetrag: Lohnanteil nur bei § 35a, sonst allgemeiner Hinweis", () => {
    const summary = summarizeTaxYear(
      [
        makeDoc({ id: "h", taxCategory: "handwerker_35a", deductibleAmountCents: null }),
        makeDoc({ id: "d", taxCategory: "haushaltsnahe_dl_35a", deductibleAmountCents: null }),
        makeDoc({ id: "v", taxCategory: "werbungskosten_vv", deductibleAmountCents: null }),
        makeDoc({ id: "o", taxCategory: "other", deductibleAmountCents: null }),
      ],
      2025,
    );
    const issues = Object.fromEntries(summary.items.map((i) => [i.documentId, i.issues]));
    expect(issues.h).toEqual(["missing_labor_share"]);
    expect(issues.d).toEqual(["missing_labor_share"]);
    expect(issues.v).toEqual(["missing_deductible"]);
    expect(issues.o).toEqual(["missing_deductible"]);
  });

  it("deductible > total: Issue ohne Clamping", () => {
    const summary = summarizeTaxYear(
      [makeDoc({ totalAmountCents: 10_000, deductibleAmountCents: 20_000 })],
      2025,
    );
    expect(summary.items[0]?.issues).toEqual(["deductible_exceeds_total"]);
    expect(summary.totalDeductibleCents).toBe(20_000);
  });

  it("mehrere Issues, Beleg zählt einmal in incompleteCount", () => {
    const summary = summarizeTaxYear(
      [makeDoc({ taxCategory: null, totalAmountCents: null, deductibleAmountCents: null })],
      2025,
    );
    expect(summary.items[0]?.issues).toEqual(["missing_category", "missing_total"]);
    expect(summary.incompleteCount).toBe(1);
    expect(summary.buckets[0]?.incompleteCount).toBe(1);
  });
});

describe("§ 35a", () => {
  it("0-Cent-Lohnanteil → 0, nicht gedeckelt", () => {
    const e = estimateSection35a("handwerker_35a", 2025, 0);
    expect(e.creditCents).toBe(0);
    expect(e.isCapped).toBe(false);
  });

  it("exakt am Deckel (Handwerker)", () => {
    const e = estimateSection35a("handwerker_35a", 2025, 600_000);
    expect(e.creditCents).toBe(120_000);
    expect(e.isCapped).toBe(false);
    expect(e.baseAboveCapCents).toBe(0);
    expect(e.maxEligibleBaseCents).toBe(600_000);
  });

  it("knapp über dem Deckel: Rundung vs. Kappung", () => {
    const a = estimateSection35a("handwerker_35a", 2025, 600_001);
    expect(a.rawCreditCents).toBe(120_000);
    expect(a.isCapped).toBe(false);
    const b = estimateSection35a("handwerker_35a", 2025, 600_003);
    expect(b.rawCreditCents).toBe(120_001);
    expect(b.creditCents).toBe(120_000);
    expect(b.isCapped).toBe(true);
    expect(b.baseAboveCapCents).toBe(3);
  });

  it("rundet half-up an der Grenze", () => {
    expect(estimateSection35a("handwerker_35a", 2025, 2).creditCents).toBe(0);
    expect(estimateSection35a("handwerker_35a", 2025, 3).creditCents).toBe(1);
    expect(estimateSection35a("handwerker_35a", 2025, 5).creditCents).toBe(1);
  });

  it("haushaltsnahe DL: Deckel 4.000 €", () => {
    expect(estimateSection35a("haushaltsnahe_dl_35a", 2025, 2_000_000).creditCents).toBe(400_000);
    const over = estimateSection35a("haushaltsnahe_dl_35a", 2025, 2_500_000);
    expect(over.creditCents).toBe(400_000);
    expect(over.baseAboveCapCents).toBe(500_000);
    expect(over.isCapped).toBe(true);
  });

  it("beide Kategorien werden getrennt gedeckelt", () => {
    const summary = summarizeTaxYear(
      [
        makeDoc({ id: "h", totalAmountCents: 800_000, deductibleAmountCents: 800_000 }),
        makeDoc({
          id: "d",
          taxCategory: "haushaltsnahe_dl_35a",
          totalAmountCents: 500_000,
          deductibleAmountCents: 500_000,
        }),
      ],
      2025,
    );
    expect(summary.section35aCreditCents).toBe(220_000);
  });

  it("ruleStatus: no_rule / reviewed / unreviewed", () => {
    const old = estimateSection35a("handwerker_35a", 2008, 100_000);
    expect(old.ruleStatus).toBe("no_rule");
    expect(old.rule).toBeNull();
    expect(old.creditCents).toBe(0);
    expect(resolveSection35aRule("handwerker_35a", 2009).ruleStatus).toBe("reviewed");
    expect(
      resolveSection35aRule("handwerker_35a", SECTION_35A_RULES_REVIEWED_THROUGH_YEAR).ruleStatus,
    ).toBe("reviewed");
    const next = estimateSection35a(
      "handwerker_35a",
      SECTION_35A_RULES_REVIEWED_THROUGH_YEAR + 1,
      100_000,
    );
    expect(next.ruleStatus).toBe("unreviewed");
    expect(next.rule).not.toBeNull();
    expect(next.creditCents).toBe(20_000);
  });

  it("jüngste passende Regel gewinnt (generische Regeltabelle)", () => {
    const rules: Section35aRule[] = [
      ...SECTION_35A_RULES,
      {
        category: "handwerker_35a",
        validFromYear: 2030,
        rateBps: 1000,
        maxCreditCents: 50_000,
        legalReference: "Testregel",
      },
    ];
    expect(resolveSection35aRule("handwerker_35a", 2029, rules, 2100).rule?.rateBps).toBe(2000);
    const e = estimateSection35a("handwerker_35a", 2030, 1_000_000, rules, 2100);
    expect(e.rule?.legalReference).toBe("Testregel");
    expect(e.creditCents).toBe(50_000);
    expect(e.ruleStatus).toBe("reviewed");
  });
});

describe("summarizeTaxYear – Aggregation & Robustheit", () => {
  it("leere Liste → alles 0", () => {
    const s = summarizeTaxYear([], 2025);
    expect(s).toMatchObject({
      documentCount: 0,
      incompleteCount: 0,
      pendingReviewCount: 0,
      totalAmountCents: 0,
      totalDeductibleCents: 0,
      section35aCreditCents: 0,
      buckets: [],
      items: [],
    });
  });

  it("stabile Bucket- und Item-Reihenfolge", () => {
    const s = summarizeTaxYear(
      [
        makeDoc({ id: "z", taxCategory: null }),
        makeDoc({ id: "c", taxCategory: "capital_gains" }),
        makeDoc({ id: "h3", documentDate: null }),
        makeDoc({ id: "h2", documentDate: "2025-02-01" }),
        makeDoc({ id: "h1b", documentDate: "2025-01-01" }),
        makeDoc({ id: "h1a", documentDate: "2025-01-01" }),
      ],
      2025,
    );
    expect(s.buckets.map((b) => b.bucket)).toEqual([
      "handwerker_35a",
      "capital_gains",
      "unassigned",
    ]);
    expect(s.buckets.map((b) => TAX_BUCKETS.indexOf(b.bucket))).toEqual([0, 3, 5]);
    expect(s.items.map((i) => i.documentId)).toEqual(["h1a", "h1b", "h2", "h3", "c", "z"]);
  });

  it("wirft bei negativen Beträgen und Floats", () => {
    expect(() => summarizeTaxYear([makeDoc({ totalAmountCents: -1 })], 2025)).toThrow(RangeError);
    expect(() => summarizeTaxYear([makeDoc({ deductibleAmountCents: 100.5 })], 2025)).toThrow(RangeError);
  });

  it("wirft RangeError bei ungültigem Steuerjahr", () => {
    for (const year of [1899, 2101, 2025.5, Number.NaN]) {
      expect(() => summarizeTaxYear([], year)).toThrow(RangeError);
    }
  });

  it("wirft bei Summen-Überlauf statt still zu überlaufen", () => {
    const docs = [
      makeDoc({ id: "a", totalAmountCents: Number.MAX_SAFE_INTEGER }),
      makeDoc({ id: "b", totalAmountCents: 10 }),
    ];
    expect(() => summarizeTaxYear(docs, 2025)).toThrow(RangeError);
  });
});

describe("listTaxYears / resolveDefaultTaxYear", () => {
  it("absteigend, dedupliziert, ohne pending/nicht relevante", () => {
    const years = listTaxYears([
      makeDoc({ taxYear: 2023 }),
      makeDoc({ taxYear: 2025 }),
      makeDoc({ taxYear: 2025 }),
      makeDoc({ taxYear: 2022, status: "pending_review" }),
      makeDoc({ taxYear: 2021, isTaxRelevant: false }),
    ]);
    expect(years).toEqual([2025, 2023]);
  });

  it("Default: neuestes Jahr, sonst Vorjahr", () => {
    expect(resolveDefaultTaxYear([2025, 2023], "2026-11-17")).toBe(2025);
    expect(resolveDefaultTaxYear([], "2026-11-17")).toBe(2025);
    expect(() => resolveDefaultTaxYear([], "kaputt")).toThrow(RangeError);
  });
});
