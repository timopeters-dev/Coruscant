import { describe, expect, it } from "vitest";
import {
  CURRENT_PURCHASE_COST_RULE_SET,
  PROPERTY_PURCHASE_EXAMPLE_SCENARIO,
} from "@/domain/planning/purchase-defaults";
import { validatePropertyPurchaseForm } from "@/validation/property-purchase";

function makeValidRaw() {
  return {
    ...PROPERTY_PURCHASE_EXAMPLE_SCENARIO,
    costItems: CURRENT_PURCHASE_COST_RULE_SET.items.map(
      ({ key, label, bps }) => ({ key, label, bps }),
    ),
    equityCents: 6_000_000,
  };
}

describe("validatePropertyPurchaseForm", () => {
  it("accepts valid defaults", () => {
    const result = validatePropertyPurchaseForm(makeValidRaw());
    expect(result.ok).toBe(true);
  });

  it("rejects invalid fields with German messages at the right paths", () => {
    const negPrice = validatePropertyPurchaseForm({
      ...makeValidRaw(),
      purchasePriceCents: -100,
    });
    expect(negPrice.ok).toBe(false);
    if (!negPrice.ok) {
      expect(negPrice.fieldErrors.purchasePriceCents).toContain("mindestens");
    }

    const floatCent = validatePropertyPurchaseForm({
      ...makeValidRaw(),
      equityCents: 100.5,
    });
    expect(floatCent.ok).toBe(false);
    if (!floatCent.ok) {
      expect(floatCent.fieldErrors.equityCents).toContain("Cent");
    }

    const stringNumber = validatePropertyPurchaseForm({
      ...makeValidRaw(),
      purchasePriceCents: "25000000",
    });
    expect(stringNumber.ok).toBe(false);
    if (!stringNumber.ok) {
      expect(stringNumber.fieldErrors.purchasePriceCents).toBeDefined();
    }

    const highRates = validatePropertyPurchaseForm({
      ...makeValidRaw(),
      interestRateBps: 1_501,
      initialRepaymentBps: 1_001,
    });
    expect(highRates.ok).toBe(false);
    if (!highRates.ok) {
      expect(highRates.fieldErrors.interestRateBps).toContain("15,00 %");
      expect(highRates.fieldErrors.initialRepaymentBps).toContain("10,00 %");
    }

    for (const badYears of [0, 41, 1.5]) {
      const res = validatePropertyPurchaseForm({
        ...makeValidRaw(),
        fixedRateYears: badYears,
      });
      expect(res.ok).toBe(false);
      if (!res.ok) {
        expect(res.fieldErrors.fixedRateYears).toContain("zwischen 1 und 40");
      }
    }

    const badCostBps = validatePropertyPurchaseForm({
      ...makeValidRaw(),
      costItems: [
        { key: "a", label: "Posten A", bps: 200 },
        { key: "b", label: "", bps: 2_001 },
      ],
    });
    expect(badCostBps.ok).toBe(false);
    if (!badCostBps.ok) {
      expect(badCostBps.fieldErrors["costItems.1.bps"]).toContain("20,00 %");
      expect(badCostBps.fieldErrors["costItems.1.label"]).toBeDefined();
    }

    const dupKeys = validatePropertyPurchaseForm({
      ...makeValidRaw(),
      costItems: [
        { key: "dup", label: "A", bps: 100 },
        { key: "dup", label: "B", bps: 200 },
      ],
    });
    expect(dupKeys.ok).toBe(false);
    if (!dupKeys.ok) {
      expect(dupKeys.fieldErrors["costItems.1.key"]).toContain("doppelter");
    }

    const emptyItems = validatePropertyPurchaseForm({
      ...makeValidRaw(),
      costItems: [],
    });
    expect(emptyItems.ok).toBe(false);
    if (!emptyItems.ok) {
      expect(emptyItems.fieldErrors.costItems).toBeDefined();
    }

    const tooManyItems = validatePropertyPurchaseForm({
      ...makeValidRaw(),
      costItems: Array.from({ length: 11 }, (_, i) => ({
        key: `k${i}`,
        label: `L${i}`,
        bps: 100,
      })),
    });
    expect(tooManyItems.ok).toBe(false);
    if (!tooManyItems.ok) {
      expect(tooManyItems.fieldErrors.costItems).toBeDefined();
    }

    const missingField: Record<string, unknown> = { ...makeValidRaw() };
    delete missingField.equityCents;
    const missingRes = validatePropertyPurchaseForm(missingField);
    expect(missingRes.ok).toBe(false);
    if (!missingRes.ok) {
      expect(missingRes.fieldErrors.equityCents).toBeDefined();
    }

    const stringBool = validatePropertyPurchaseForm({
      ...makeValidRaw(),
      requireEquityCoversCosts: "true",
    });
    expect(stringBool.ok).toBe(false);
    if (!stringBool.ok) {
      expect(stringBool.fieldErrors.requireEquityCoversCosts).toBeDefined();
    }
  });
});
