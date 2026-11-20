import { describe, expect, it } from "vitest";
import {
  DEFAULT_RECOMMENDATION_ASSUMPTIONS,
  type RecommendationResult,
} from "@/domain/recommendation/recommendation";
import {
  buildAllocationPrefillHref,
  parseAllocationPrefill,
} from "@/frontend/allokation/allocation-prefill";

function makeResult(
  items: RecommendationResult["items"],
): RecommendationResult {
  return {
    mode: "one_time",
    amountCents: items.reduce((a, i) => a + i.amountCents, 0),
    items,
    notes: [],
    assumptions: DEFAULT_RECOMMENDATION_ASSUMPTIONS,
    loanOrder: [],
  };
}

describe("allocation-prefill", () => {
  const pots = [{ id: "pot-1" }, { id: "pot-2" }];

  it("roundtrips pot items only and sums duplicate pot targets", () => {
    const result = makeResult([
      {
        ref: "P1",
        kind: "emergency_fund",
        amountCents: 200_000,
        target: { type: "pot", potId: "pot-1" },
        reasons: [],
      },
      {
        ref: "P2",
        kind: "pot_deadline",
        amountCents: 50_000,
        target: { type: "pot", potId: "pot-1" },
        reasons: [],
      },
      {
        ref: "P3",
        kind: "loan_prepayment",
        amountCents: 300_000,
        target: { type: "loan", loanId: "loan-1" },
        reasons: [],
      },
      {
        ref: "P4",
        kind: "etf",
        amountCents: 100_000,
        target: { type: "pot", potId: "pot-2" },
        reasons: [],
      },
    ]);

    const href = buildAllocationPrefillHref(result);
    expect(href).toBe(
      "/allokation?verteilen=einmal&posten=pot-1:250000,pot-2:100000",
    );

    const url = new URL(`http://localhost${href!}`);
    const parsed = parseAllocationPrefill(
      {
        verteilen: url.searchParams.get("verteilen"),
        posten: url.searchParams.get("posten"),
      },
      pots,
    );
    expect(parsed).toEqual({
      amountCents: 350_000,
      entries: [
        { potId: "pot-1", amountCents: 250_000 },
        { potId: "pot-2", amountCents: 100_000 },
      ],
    });
  });

  it("returns null when there are no pot items", () => {
    const href = buildAllocationPrefillHref(
      makeResult([
        {
          ref: "P1",
          kind: "etf",
          amountCents: 100_000,
          target: { type: "none" },
          reasons: [],
        },
      ]),
    );
    expect(href).toBeNull();
  });

  it("rejects unknown pot IDs, duplicates, 0 ct, > 20 entries, and non-integers", () => {
    expect(
      parseAllocationPrefill(
        { verteilen: "einmal", posten: "unknown:1000" },
        pots,
      ),
    ).toBeNull();
    expect(
      parseAllocationPrefill(
        { verteilen: "einmal", posten: "pot-1:1000,pot-1:2000" },
        pots,
      ),
    ).toBeNull();
    expect(
      parseAllocationPrefill({ verteilen: "einmal", posten: "pot-1:0" }, pots),
    ).toBeNull();
    expect(
      parseAllocationPrefill(
        { verteilen: "einmal", posten: "pot-1:12.5" },
        pots,
      ),
    ).toBeNull();

    const manyPots = Array.from({ length: 21 }, (_, i) => ({ id: `pot-${i}` }));
    const manyPosten = manyPots.map((p) => `${p.id}:100`).join(",");
    expect(
      parseAllocationPrefill(
        { verteilen: "einmal", posten: manyPosten },
        manyPots,
      ),
    ).toBeNull();
  });
});
