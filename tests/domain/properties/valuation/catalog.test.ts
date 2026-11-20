import { describe, expect, it } from "vitest";
import {
  MAX_ADJUSTMENT_ITEM_BPS,
  MAX_ADJUSTMENT_LABEL_LENGTH,
  normalizeAdjustmentLabel,
  normalizeValuationAdjustments,
  parseValuationAdjustments,
  serializeValuationAdjustments,
  validateValuationAdjustments,
  type ValuationAdjustment,
} from "@/domain/properties/valuation/adjustments";
import {
  catalogItemsFor,
  matchCatalogItemByLabel,
  reconcileWithCatalog,
  resolveCatalogToggle,
  summarizeAdjustmentDraft,
  VALUATION_ADJUSTMENT_CATALOG,
  VALUATION_CATALOG_GROUPS,
  VALUATION_CATALOG_VERSION,
} from "@/domain/properties/valuation/catalog";

describe("VALUATION_ADJUSTMENT_CATALOG integrity", () => {
  it("has valid version, unique keys/labels, non-empty groups, and >=2 items per exclusiveGroup", () => {
    expect(VALUATION_CATALOG_VERSION).toBe(1);
    expect(VALUATION_ADJUSTMENT_CATALOG).toHaveLength(19);

    const keys = new Set<string>();
    const labels = new Set<string>();
    const groupCounts = new Map<string, number>();
    const exclusiveCounts = new Map<string, number>();

    for (const item of VALUATION_ADJUSTMENT_CATALOG) {
      expect(keys.has(item.key)).toBe(false);
      keys.add(item.key);

      const normLabel = normalizeAdjustmentLabel(item.label).toLocaleLowerCase(
        "de-DE",
      );
      expect(labels.has(normLabel)).toBe(false);
      labels.add(normLabel);

      expect(item.label.length).toBeLessThanOrEqual(MAX_ADJUSTMENT_LABEL_LENGTH);
      expect(item.suggestedBps).not.toBe(0);
      expect(Math.abs(item.suggestedBps)).toBeLessThanOrEqual(
        MAX_ADJUSTMENT_ITEM_BPS,
      );

      groupCounts.set(item.group, (groupCounts.get(item.group) ?? 0) + 1);
      if (item.exclusiveGroup) {
        exclusiveCounts.set(
          item.exclusiveGroup,
          (exclusiveCounts.get(item.exclusiveGroup) ?? 0) + 1,
        );
      }
    }

    for (const group of VALUATION_CATALOG_GROUPS) {
      expect(groupCounts.get(group.id) ?? 0).toBeGreaterThan(0);
    }

    for (const [, count] of exclusiveCounts) {
      expect(count).toBeGreaterThanOrEqual(2);
    }
  });
});

describe("summarizeAdjustmentDraft & exact BigInt rounding", () => {
  it("sums bps and applies half-up BigInt rounding", () => {
    const draft: ValuationAdjustment[] = [
      { label: "Ruhige Lage / Seitenstraße", bps: 300, catalogKey: "location_quiet" },
      { label: "Freier Abschlag", bps: -700 },
      { label: "Zuschlag", bps: 333 },
    ];
    const summary = summarizeAdjustmentDraft(draft, 12_345_678);
    expect(summary.validation).toEqual({ ok: true });
    expect(summary.totalBps).toBe(-67);
    // 12_345_678 * 9_933 / 10_000 = 12_262_961.9574 -> 12_262_962
    expect(summary.adjustedCents).toBe(12_262_962);
  });

  it("rounds exact half-cent boundaries half-up", () => {
    // 5_000 * (10_000 + 1) / 10_000 = 5_000.5 -> 5_001
    const res = summarizeAdjustmentDraft([{ label: "Mini", bps: 1 }], 5_000);
    expect(res.adjustedCents).toBe(5_001);
  });

  it("returns baseCents for empty selection and null when baseCents is null", () => {
    expect(summarizeAdjustmentDraft([], 25_000_000)).toEqual({
      validation: { ok: true },
      totalBps: 0,
      adjustedCents: 25_000_000,
    });
    expect(summarizeAdjustmentDraft([], null)).toEqual({
      validation: { ok: true },
      totalBps: 0,
      adjustedCents: null,
    });
  });

  it("handles ±50% boundary accurately", () => {
    const plus5000 = summarizeAdjustmentDraft(
      [{ label: "Max Plus", bps: 5000 }],
      10_000,
    );
    expect(plus5000.validation.ok).toBe(true);
    expect(plus5000.totalBps).toBe(5000);
    expect(plus5000.adjustedCents).toBe(15_000);

    const minus5000 = summarizeAdjustmentDraft(
      [{ label: "Max Minus", bps: -5000 }],
      10_001,
    );
    expect(minus5000.validation.ok).toBe(true);
    // 10_001 * 0.5 = 5_000.5 -> 5_001
    expect(minus5000.adjustedCents).toBe(5_001);

    const over = summarizeAdjustmentDraft(
      [
        { label: "A", bps: 5000 },
        { label: "B", bps: 1 },
      ],
      10_000,
    );
    expect(over.validation).toEqual({
      ok: false,
      errors: [{ code: "total_out_of_range" }],
    });
    expect(over.totalBps).toBeNull();
    expect(over.adjustedCents).toBeNull();
  });
});

describe("resolveCatalogToggle & 8-item limit", () => {
  const eightItems: ValuationAdjustment[] = [
    { label: "Ruhige Lage / Seitenstraße", bps: 300, catalogKey: "location_quiet" },
    { label: "Besondere Aussicht / Wasser- oder Parknähe", bps: 500, catalogKey: "location_view" },
    { label: "Vollkeller", bps: 300, catalogKey: "basement_full" },
    { label: "Kürzlich umfassend modernisiert", bps: 500, catalogKey: "condition_modernized" },
    { label: "Hochwertige Ausstattung", bps: 500, catalogKey: "features_premium" },
    { label: "Balkon / Terrasse / Loggia", bps: 300, catalogKey: "features_balcony" },
    { label: "Garage / Stellplatz", bps: 300, catalogKey: "features_parking" },
    { label: "Freier Posten", bps: -200 },
  ];

  it("blocks adding a 9th non-exclusive item", () => {
    expect(resolveCatalogToggle(eightItems, "legal_monument")).toEqual({
      action: "blocked",
      reason: "too_many",
    });
  });

  it("allows swapping within an exclusive group even at 8 items", () => {
    const res = resolveCatalogToggle(eightItems, "location_noise");
    expect(res.action).toBe("add");
    if (res.action === "add") {
      expect(res.item.key).toBe("location_noise");
      expect(res.replaceKeys).toEqual(["location_quiet"]);
    }
  });

  it("removes when toggling an already selected key", () => {
    expect(resolveCatalogToggle(eightItems, "location_quiet")).toEqual({
      action: "remove",
      key: "location_quiet",
    });
  });

  it("throws RangeError for unknown catalog key", () => {
    expect(() => resolveCatalogToggle([], "unknown_key")).toThrow(RangeError);
  });

  it("rejects 9 items in validateValuationAdjustments", () => {
    const nine = [...eightItems, { label: "Neunter Posten", bps: 100 }];
    const res = validateValuationAdjustments(nine);
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.errors.some((e) => e.code === "too_many")).toBe(true);
    }
  });
});

describe("validation & tolerant normalization of catalog keys", () => {
  it("reports catalog_key_duplicate, label_duplicate, exclusive_conflict, and catalog_key_unknown", () => {
    const dupKey = validateValuationAdjustments([
      { label: "Vollkeller", bps: 300, catalogKey: "basement_full" },
      { label: "Vollkeller", bps: 300, catalogKey: "basement_full" },
    ]);
    expect(dupKey.ok).toBe(false);
    if (!dupKey.ok) {
      expect(dupKey.errors.some((e) => e.code === "catalog_key_duplicate" && e.index === 1)).toBe(
        true,
      );
    }

    const dupLabel = validateValuationAdjustments([
      { label: "Vollkeller", bps: 200 },
      { label: "Vollkeller", bps: 300, catalogKey: "basement_full" },
    ]);
    expect(dupLabel.ok).toBe(false);
    if (!dupLabel.ok) {
      expect(dupLabel.errors).toEqual([{ index: 1, code: "label_duplicate" }]);
    }

    const conflict = validateValuationAdjustments([
      { label: "Balkon / Terrasse / Loggia", bps: 300, catalogKey: "features_balcony" },
      { label: "Kein Balkon", bps: -300, catalogKey: "features_no_balcony" },
    ]);
    expect(conflict).toEqual({
      ok: false,
      errors: [{ index: 1, code: "exclusive_conflict" }],
    });

    const unknown = validateValuationAdjustments([
      { label: "Unbekannt", bps: 100, catalogKey: "does_not_exist" },
    ]);
    expect(unknown).toEqual({
      ok: false,
      errors: [{ index: 0, code: "catalog_key_unknown" }],
    });
  });

  it("tolerantly skips duplicates/conflicts and strips unknown keys in normalizeValuationAdjustments", () => {
    const normalized = normalizeValuationAdjustments([
      { label: "alter text", bps: 300, catalogKey: "features_balcony" },
      { label: "Kein Balkon", bps: -300, catalogKey: "features_no_balcony" },
      { label: "Balkon / Terrasse / Loggia", bps: 300, catalogKey: "features_balcony" },
      { label: "Freier Posten", bps: 200, catalogKey: "unknown_key" },
    ]);
    expect(normalized).toEqual([
      {
        label: "Balkon / Terrasse / Loggia",
        bps: 300,
        catalogKey: "features_balcony",
      },
      { label: "Freier Posten", bps: 200 },
    ]);
  });
});

describe("reconcileWithCatalog, catalogItemsFor & round-trip", () => {
  it("upgrades legacy items matching catalog labels and stays idempotent", () => {
    const once = reconcileWithCatalog([
      { label: "  fertighaus (holzständerbauweise) ", bps: -800 },
      { label: "Eigener Posten", bps: 250 },
    ]);
    expect(once).toEqual([
      {
        label: "Fertighaus (Holzständerbauweise)",
        bps: -800,
        catalogKey: "construction_prefab",
      },
      { label: "Eigener Posten", bps: 250 },
    ]);
    expect(reconcileWithCatalog(once)).toEqual(once);
    expect(matchCatalogItemByLabel("  VOLLKELLER ")?.key).toBe("basement_full");
  });

  it("filters features_no_balcony by propertyType", () => {
    expect(
      catalogItemsFor("efh").some((i) => i.key === "features_no_balcony"),
    ).toBe(false);
    expect(
      catalogItemsFor("etw").some((i) => i.key === "features_no_balcony"),
    ).toBe(true);
    expect(
      catalogItemsFor(null).some((i) => i.key === "features_no_balcony"),
    ).toBe(true);
  });

  it("preserves catalogKey on serialize -> parse and reads legacy JSON", () => {
    const input: ValuationAdjustment[] = [
      { label: "Denkmalschutz", bps: -500, catalogKey: "legal_monument" },
      { label: "Frei", bps: 100 },
    ];
    const json = serializeValuationAdjustments(input);
    expect(parseValuationAdjustments(json)).toEqual(input);

    const legacyJson = JSON.stringify([{ label: "Altbestand", bps: -200 }]);
    expect(parseValuationAdjustments(legacyJson)).toEqual([
      { label: "Altbestand", bps: -200 },
    ]);
  });
});
