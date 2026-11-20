import { describe, expect, it } from "vitest";
import { calculatePropertyPurchase } from "@/domain/planning/purchase";
import {
  CURRENT_PURCHASE_COST_RULE_SET,
  PROPERTY_PURCHASE_EXAMPLE_SCENARIO,
  PROPERTY_PURCHASE_LIMITS,
  PURCHASE_COST_RULE_SETS,
} from "@/domain/planning/purchase-defaults";
import { validatePropertyPurchaseForm } from "@/validation/property-purchase";

describe("property-purchase-defaults", () => {
  it("has unique ascending versions, valid ISO reviewedAt, and CURRENT as last entry", () => {
    expect(PURCHASE_COST_RULE_SETS.length).toBeGreaterThan(0);
    expect(CURRENT_PURCHASE_COST_RULE_SET).toBe(
      PURCHASE_COST_RULE_SETS[PURCHASE_COST_RULE_SETS.length - 1],
    );

    const versions = PURCHASE_COST_RULE_SETS.map((r) => r.version);
    expect(new Set(versions).size).toBe(versions.length);

    for (let i = 1; i < versions.length; i += 1) {
      expect(versions[i]! > versions[i - 1]!).toBe(true);
    }

    for (const ruleSet of PURCHASE_COST_RULE_SETS) {
      expect(ruleSet.reviewedAt).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      const parsed = new Date(`${ruleSet.reviewedAt}T00:00:00Z`);
      expect(Number.isNaN(parsed.getTime())).toBe(false);
    }
  });

  it("has valid integer bps within limits and unique keys for all items", () => {
    for (const ruleSet of PURCHASE_COST_RULE_SETS) {
      expect(ruleSet.items.length).toBeGreaterThanOrEqual(
        PROPERTY_PURCHASE_LIMITS.costItems.minCount,
      );
      expect(ruleSet.items.length).toBeLessThanOrEqual(
        PROPERTY_PURCHASE_LIMITS.costItems.maxCount,
      );

      const keys = new Set<string>();
      for (const item of ruleSet.items) {
        expect(Number.isInteger(item.bps)).toBe(true);
        expect(item.bps).toBeGreaterThanOrEqual(
          PROPERTY_PURCHASE_LIMITS.costItems.minBps,
        );
        expect(item.bps).toBeLessThanOrEqual(
          PROPERTY_PURCHASE_LIMITS.costItems.maxBps,
        );
        expect(item.label.trim().length).toBeGreaterThanOrEqual(
          PROPERTY_PURCHASE_LIMITS.costItems.minLabelLength,
        );
        expect(item.label.trim().length).toBeLessThanOrEqual(
          PROPERTY_PURCHASE_LIMITS.costItems.maxLabelLength,
        );
        expect(keys.has(item.key)).toBe(false);
        keys.add(item.key);
      }
    }
  });

  it("example scenario with current cost items passes schema validation and calculates", () => {
    const input = {
      ...PROPERTY_PURCHASE_EXAMPLE_SCENARIO,
      costItems: CURRENT_PURCHASE_COST_RULE_SET.items.map(
        ({ key, label, bps }) => ({ key, label, bps }),
      ),
      equityCents: 6_000_000,
    };

    const validation = validatePropertyPurchaseForm(input);
    expect(validation.ok).toBe(true);
    if (validation.ok) {
      const result = calculatePropertyPurchase(validation.input);
      expect(result.costs.totalCostsCents).toBeGreaterThan(
        input.purchasePriceCents,
      );
    }
  });
});
