import { describe, expect, it } from "vitest";
import { planAdjustmentRecompute } from "@/domain/properties/valuation/adjustment-recompute";

const BASE_ENTRY = {
  lowerCents: 46_000_000,
  medianCents: 49_000_000,
  upperCents: 52_000_000,
};

describe("valuation-adjustment-recompute", () => {
  it("returns none/manual_source when currentSource is manual", () => {
    expect(
      planAdjustmentRecompute({
        currentSource: "manual",
        currentValueCents: 49_000_000,
        appliedEntry: { ...BASE_ENTRY, appliedChoice: "median" },
        newTotalBps: -1_000,
      }),
    ).toEqual({ action: "none", reason: "manual_source" });
  });

  it("returns none/no_applied_entry when appliedEntry is null", () => {
    expect(
      planAdjustmentRecompute({
        currentSource: "immoanalyse",
        currentValueCents: 49_000_000,
        appliedEntry: null,
        newTotalBps: -1_000,
      }),
    ).toEqual({ action: "none", reason: "no_applied_entry" });
  });

  it("returns none/unchanged when new adjusted value equals currentValueCents", () => {
    expect(
      planAdjustmentRecompute({
        currentSource: "immoanalyse",
        currentValueCents: 44_100_000,
        appliedEntry: { ...BASE_ENTRY, appliedChoice: "median" },
        newTotalBps: -1_000,
      }),
    ).toEqual({ action: "none", reason: "unchanged" });
  });

  it("recomputes on upperCents when appliedChoice is upper", () => {
    expect(
      planAdjustmentRecompute({
        currentSource: "immoanalyse",
        currentValueCents: 52_000_000,
        appliedEntry: { ...BASE_ENTRY, appliedChoice: "upper" },
        newTotalBps: -1_000,
      }),
    ).toEqual({
      action: "recompute",
      fromCents: 52_000_000,
      toCents: 46_800_000,
      choice: "upper",
    });
  });

  it("falls back to median when appliedChoice is null", () => {
    expect(
      planAdjustmentRecompute({
        currentSource: "immoanalyse",
        currentValueCents: 49_000_000,
        appliedEntry: { ...BASE_ENTRY, appliedChoice: null },
        newTotalBps: -1_000,
      }),
    ).toEqual({
      action: "recompute",
      fromCents: 49_000_000,
      toCents: 44_100_000,
      choice: "median",
    });
  });
});
