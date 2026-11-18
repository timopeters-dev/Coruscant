import { describe, expect, it } from "vitest";
import { decideValuationWrite } from "./valuation-write-decision";

describe("valuation-write-decision", () => {
  it("writes on auto trigger with immoanalyse source and no deviation", () => {
    expect(
      decideValuationWrite({
        trigger: "auto",
        currentSource: "immoanalyse",
        currentValueCents: 30_000_000,
        warnings: [],
      }),
    ).toEqual({ action: "write" });
  });

  it("protects manual source when currentValueCents > 0", () => {
    expect(
      decideValuationWrite({
        trigger: "auto",
        currentSource: "manual",
        currentValueCents: 30_000_000,
        warnings: [],
      }),
    ).toEqual({ action: "history_only", reason: "manual_source" });
  });

  it("writes on auto trigger when manual source has value 0", () => {
    expect(
      decideValuationWrite({
        trigger: "auto",
        currentSource: "manual",
        currentValueCents: 0,
        warnings: [],
      }),
    ).toEqual({ action: "write" });
  });

  it("holds on auto trigger when deviation warning is present", () => {
    expect(
      decideValuationWrite({
        trigger: "auto",
        currentSource: "immoanalyse",
        currentValueCents: 30_000_000,
        warnings: [{ code: "deviates_from_current", deviationBps: 4_500 }],
      }),
    ).toEqual({ action: "history_only", reason: "deviation" });
  });

  it("always returns manual_trigger for manual runs", () => {
    expect(
      decideValuationWrite({
        trigger: "manual",
        currentSource: "immoanalyse",
        currentValueCents: 0,
        warnings: [],
      }),
    ).toEqual({ action: "history_only", reason: "manual_trigger" });
  });
});
