import { describe, expect, it } from "vitest";
import {
  applyValuationAdjustment,
  applyValuationAdjustmentToBounds,
  formatAdjustmentSummary,
  parseValuationAdjustments,
  serializeValuationAdjustments,
  sumAdjustmentBps,
  validateValuationAdjustments,
  type ValuationAdjustment,
} from "./property-valuation-adjustments";

describe("property-valuation-adjustments", () => {
  describe("applyValuationAdjustment", () => {
    it("applies -1000 bps to 49,000,000 cents -> 44,100,000", () => {
      expect(applyValuationAdjustment(49_000_000, -1_000)).toBe(44_100_000);
    });

    it("applies summed bps (+300 and -1000 = -700) to 49,000,000 -> 45,570,000", () => {
      const list: ValuationAdjustment[] = [
        { label: "Ruhige Lage", bps: 300 },
        { label: "Fertighaus", bps: -1_000 },
      ];
      const total = sumAdjustmentBps(list);
      expect(total).toBe(-700);
      expect(applyValuationAdjustment(49_000_000, total)).toBe(45_570_000);
    });

    it("returns base unchanged for 0 bps", () => {
      expect(applyValuationAdjustment(49_000_000, 0)).toBe(49_000_000);
      expect(sumAdjustmentBps([])).toBe(0);
    });

    it("rounds half-up at boundaries", () => {
      // 1 * 0.5 = 0.5 -> 1
      expect(applyValuationAdjustment(1, -5_000)).toBe(1);
      // 3 * 0.5 = 1.5 -> 2
      expect(applyValuationAdjustment(3, -5_000)).toBe(2);
      // 333 * 1.0001 = 333.0333 -> 333
      expect(applyValuationAdjustment(333, 1)).toBe(333);
    });

    it("accepts ±5000 bps and throws RangeError on ±5001 bps", () => {
      expect(applyValuationAdjustment(10_000, -5_000)).toBe(5_000);
      expect(applyValuationAdjustment(10_000, 5_000)).toBe(15_000);
      expect(() => applyValuationAdjustment(10_000, -5_001)).toThrow(
        RangeError,
      );
      expect(() => applyValuationAdjustment(10_000, 5_001)).toThrow(RangeError);
    });

    it("throws RangeError on non-positive, non-integer, or unsafe base cents", () => {
      expect(() => applyValuationAdjustment(0, -1_000)).toThrow(RangeError);
      expect(() => applyValuationAdjustment(-100, -1_000)).toThrow(RangeError);
      expect(() => applyValuationAdjustment(100.5, -1_000)).toThrow(RangeError);
      expect(() => applyValuationAdjustment(Number.NaN, -1_000)).toThrow(
        RangeError,
      );
      expect(() =>
        applyValuationAdjustment(Number.MAX_SAFE_INTEGER, 1_000),
      ).toThrow(RangeError);
      expect(() =>
        applyValuationAdjustment(Number.MAX_SAFE_INTEGER + 1, 0),
      ).toThrow(RangeError);
    });
  });

  describe("applyValuationAdjustmentToBounds", () => {
    it("preserves lower <= median <= upper across boundary cases", () => {
      const cases = [
        { lowerCents: 40_000_000, medianCents: 49_000_000, upperCents: 55_000_000 },
        { lowerCents: 100, medianCents: 101, upperCents: 102 },
        { lowerCents: 1, medianCents: 1, upperCents: 1 },
        { lowerCents: 30_000_000, medianCents: 30_000_000, upperCents: 30_000_000 },
      ];
      for (const bounds of cases) {
        for (const totalBps of [-5_000, -1_000, -1, 0, 1, 1_000, 5_000]) {
          const adj = applyValuationAdjustmentToBounds(bounds, totalBps);
          expect(adj.lowerCents).toBeLessThanOrEqual(adj.medianCents);
          expect(adj.medianCents).toBeLessThanOrEqual(adj.upperCents);
        }
      }
    });
  });

  describe("sumAdjustmentBps", () => {
    it("throws RangeError if sum exceeds ±5000", () => {
      expect(() =>
        sumAdjustmentBps([
          { label: "Fertighaus", bps: -3_000 },
          { label: "Ruhige Lage", bps: -3_000 },
        ]),
      ).toThrow(RangeError);
      expect(() =>
        sumAdjustmentBps([
          { label: "A", bps: 3_000 },
          { label: "B", bps: 2_001 },
        ]),
      ).toThrow(RangeError);
    });
  });

  describe("validateValuationAdjustments", () => {
    it("rejects 9 items with too_many", () => {
      const list = Array.from({ length: 9 }, (_, i) => ({
        label: `Posten ${i + 1}`,
        bps: 100,
      }));
      const res = validateValuationAdjustments(list);
      expect(res.ok).toBe(false);
      if (!res.ok) {
        expect(res.errors).toContainEqual({ code: "too_many" });
      }
    });

    it("rejects empty or >60-char labels", () => {
      const res = validateValuationAdjustments([
        { label: "   ", bps: 100 },
        { label: "a".repeat(61), bps: 100 },
      ]);
      expect(res.ok).toBe(false);
      if (!res.ok) {
        expect(res.errors).toContainEqual({ index: 0, code: "label_empty" });
        expect(res.errors).toContainEqual({ index: 1, code: "label_too_long" });
      }
    });

    it("rejects case-insensitive duplicate labels after trimming", () => {
      const res = validateValuationAdjustments([
        { label: "Fertighaus", bps: -1_000 },
        { label: "  fertighaus ", bps: -500 },
      ]);
      expect(res.ok).toBe(false);
      if (!res.ok) {
        expect(res.errors).toContainEqual({
          index: 1,
          code: "label_duplicate",
        });
      }
    });

    it("rejects bps = 0, float bps, NaN, item out of range, and total out of range", () => {
      const res1 = validateValuationAdjustments([
        { label: "Zero", bps: 0 },
        { label: "Float", bps: 2.5 },
        { label: "NaN", bps: Number.NaN },
        { label: "TooBig", bps: 5_001 },
      ]);
      expect(res1.ok).toBe(false);
      if (!res1.ok) {
        expect(res1.errors).toContainEqual({ index: 0, code: "bps_zero" });
        expect(res1.errors).toContainEqual({
          index: 1,
          code: "bps_not_integer",
        });
        expect(res1.errors).toContainEqual({
          index: 2,
          code: "bps_not_integer",
        });
        expect(res1.errors).toContainEqual({
          index: 3,
          code: "bps_item_out_of_range",
        });
      }

      const res2 = validateValuationAdjustments([
        { label: "A", bps: -3_000 },
        { label: "B", bps: -3_000 },
      ]);
      expect(res2.ok).toBe(false);
      if (!res2.ok) {
        expect(res2.errors).toContainEqual({ code: "total_out_of_range" });
      }
    });
  });

  describe("parseValuationAdjustments & serializeValuationAdjustments", () => {
    it("round-trips valid adjustments and returns null for empty", () => {
      const list: ValuationAdjustment[] = [
        { label: "  Fertighaus   Holz ", bps: -1_000 },
        { label: "Ruhige Lage", bps: 300 },
      ];
      const serialized = serializeValuationAdjustments(list);
      expect(serialized).not.toBeNull();
      expect(parseValuationAdjustments(serialized)).toEqual([
        { label: "Fertighaus Holz", bps: -1_000 },
        { label: "Ruhige Lage", bps: 300 },
      ]);
      expect(serializeValuationAdjustments([])).toBeNull();
    });

    it("tolerates broken JSON, non-arrays, and invalid objects", () => {
      expect(parseValuationAdjustments(null)).toEqual([]);
      expect(parseValuationAdjustments("")).toEqual([]);
      expect(parseValuationAdjustments("{broken")).toEqual([]);
      expect(parseValuationAdjustments('{"label":"x","bps":100}')).toEqual([]);
      expect(
        parseValuationAdjustments(JSON.stringify([{}, { label: "x" }, null])),
      ).toEqual([]);
    });
  });

  describe("formatAdjustmentSummary", () => {
    it("formats adjustments with signs and German bps", () => {
      expect(formatAdjustmentSummary([])).toBe("");
      expect(
        formatAdjustmentSummary([
          { label: "Fertighaus", bps: -1_000 },
          { label: "Ruhige Lage", bps: 300 },
        ]),
      ).toBe("-10,00 % · Fertighaus; +3,00 % · Ruhige Lage");
    });
  });
});
