import { describe, expect, it } from "vitest";
import { buildInvestmentContext, type InvestmentContextInput } from "./investment-context";
import {
  recommendMonthlySavings,
  recommendUse,
  type RecommendationState,
} from "./recommendation";
import {
  buildLlmInvestmentContextView,
  buildRecommendationLlmView,
  collectRawCentValues,
  findCentLikeNumbers,
  serializeLlmContext,
  validateExplanation,
} from "./recommendation-llm";

function makeContextInput(): InvestmentContextInput {
  return {
    asOfDate: "2026-11-19",
    snapshotFetchedAt: "2026-11-18T10:00:00.000Z",
    isDummyHousehold: false,
    positions: [
      {
        id: "pos-1",
        accountId: "acc-1",
        name: "MSCI World UCITS ETF",
        isin: "IE00B4L5Y983",
        assetClass: "etf",
        marketValueCents: 1_234_500,
      },
    ],
    accounts: [
      {
        id: "acc-1",
        name: "Musterbank Depot",
        type: "brokerage",
        balanceCents: 50_000,
      },
      {
        id: "acc-2",
        name: "Musterbank Giro",
        type: "checking",
        balanceCents: 300_000,
      },
    ],
    pots: [
      {
        id: "pot-1",
        name: "Notgroschen",
        priority: 1,
        purpose: "emergency_fund",
        currentCents: 500_000,
        targetCents: 750_000,
        linkedContractId: null,
        linkedPropertyId: null,
      },
      {
        id: "pot-2",
        name: "Urlaub",
        priority: 2,
        purpose: "goal",
        currentCents: 100_000,
        targetCents: 300_000,
        linkedContractId: null,
        linkedPropertyId: null,
      },
    ],
    contracts: [],
    monthlyLivingCostsCents: 250_000,
    monthlySurplusCents: 120_000,
    monthlySavingsRateCents: 50_000,
  };
}

describe("buildLlmInvestmentContextView", () => {
  it("formats all money and bps fields into Euro/percent strings without Cents/Bps keys", () => {
    const ctx = buildInvestmentContext(makeContextInput());
    const view = buildLlmInvestmentContextView(ctx);
    const json = serializeLlmContext(view);

    expect(view.schemaVersion).toBe(2);
    expect(view.portfolio.totalValue).toBe("12.345 €");
    expect(view.portfolio.assetClasses[0]?.weight).toBe("100,00 %");
    expect(view.liquidity.coverageMonths).toBe("1,2");

    function assertNoCentOrBpsKeys(obj: unknown): void {
      if (Array.isArray(obj)) {
        obj.forEach(assertNoCentOrBpsKeys);
        return;
      }
      if (obj && typeof obj === "object") {
        for (const [k, v] of Object.entries(obj)) {
          expect(k.endsWith("Cents")).toBe(false);
          expect(k.endsWith("Bps")).toBe(false);
          if (typeof v === "number" && k !== "schemaVersion" && k !== "positionCount" && k !== "truncatedPositionCount" && k !== "snapshotAgeDays" && k !== "horizonMonths" && k !== "monthsUntil") {
            expect(v).toBeLessThan(1000);
          }
          assertNoCentOrBpsKeys(v);
        }
      }
    }
    assertNoCentOrBpsKeys(view);
    expect(json).not.toContain("Cents");
    expect(json).not.toContain("Musterbank");
  });
});

describe("buildRecommendationLlmView & validateExplanation", () => {
  const state: RecommendationState = {
    asOfDate: "2026-11-19",
    monthlyExpensesCents: 250_000,
    monthlySurplusCents: 0,
    pots: [
      {
        id: "pot-1",
        name: "Notgroschen",
        priority: 1,
        purpose: "emergency_fund",
        currentCents: 0,
        targetCents: 750_000,
        targetDate: null,
        ruleType: "fill_to_target",
        linkedContractId: null,
      },
      {
        id: "pot-2",
        name: "Urlaub",
        priority: 2,
        purpose: "goal",
        currentCents: 0,
        targetCents: 300_000,
        targetDate: "2027-07-01",
        ruleType: "fill_to_target",
        linkedContractId: null,
      },
    ],
    loans: [
      {
        id: "loan-1",
        balanceCents: 5_000_000,
        interestRateBps: 550,
        monthlyRateCents: 50_000,
        repaymentType: "annuity",
        specialRepaymentMaxYearlyCents: 200_000,
        fixedInterestUntil: "2030-01-01",
        futureLoanInterestRateBps: null,
      },
    ],
  };

  it("excludes names, IDs, and providers and covers all referenced placeholders", () => {
    const result = recommendUse(1_200_000, state);
    const view = buildRecommendationLlmView(result, state, {
      isDummyHousehold: false,
    });
    const serialized = serializeLlmContext(view);

    expect(serialized).not.toContain("Notgroschen");
    expect(serialized).not.toContain("Urlaub");
    expect(serialized).not.toContain("pot-1");
    expect(serialized).not.toContain("pot-2");
    expect(serialized).not.toContain("loan-1");
    expect(serialized).not.toContain("Musterbank");
    expect(view.posten.map((p) => p.ziel)).toContain("NOTGROSCHEN");
    expect(view.posten.map((p) => p.ziel)).toContain("KREDIT-1");

    for (const p of view.posten) {
      for (const g of p.gruende) {
        for (const ph of g.platzhalter) {
          expect(view.werte[ph]).toBeDefined();
        }
      }
    }
  });

  it("validates placeholders, rejects cent numbers, literal amounts, unknown numbers, unknown refs, and invalid JSON", () => {
    const result = recommendUse(1_000_000, state);
    const view = buildRecommendationLlmView(result, state, {
      isDummyHousehold: false,
    });

    // Valid with placeholders at sentence end and adjacent placeholders + allowlisted month/year
    const valid = validateExplanation(
      {
        summary: "Wir verteilen {BETRAG} sinnvoll.",
        items: [
          {
            ref: "P1",
            text: "Zuerst {P1.betrag}{P1.ziel} in 8 Monaten bis 2027.",
          },
        ],
        caveats: [],
      },
      view,
      [750_000],
    );
    expect(valid.ok).toBe(true);
    if (valid.ok) {
      expect(valid.explanation.summary).toBe("Wir verteilen 10.000 € sinnvoll.");
    }

    // Cent number
    const centHit = validateExplanation(
      {
        summary: "Ziel ist 750000 Cent.",
        items: [{ ref: "P1", text: "Betrag {P1.betrag}." }],
        caveats: [],
      },
      view,
      [750_000],
    );
    expect(centHit.ok).toBe(false);

    const rawCent = validateExplanation(
      {
        summary: "Ziel ist 750000.",
        items: [{ ref: "P1", text: "Betrag {P1.betrag}." }],
        caveats: [],
      },
      view,
      [750_000],
    );
    expect(rawCent.ok).toBe(false);
    if (!rawCent.ok) {
      expect(rawCent.violations[0]?.code).toBe("cent_like");
    }

    // Invented literal amount
    const literal = validateExplanation(
      {
        summary: "Lege 3.500 € zurück.",
        items: [{ ref: "P1", text: "Betrag {P1.betrag}." }],
        caveats: [],
      },
      view,
    );
    expect(literal.ok).toBe(false);
    if (!literal.ok) {
      expect(literal.violations[0]?.code).toBe("literal_amount");
    }

    // Unknown number not in allowlist
    const unknownNum = validateExplanation(
      {
        summary: "In 42 Monaten fertig.",
        items: [{ ref: "P1", text: "Betrag {P1.betrag}." }],
        caveats: [],
      },
      view,
    );
    expect(unknownNum.ok).toBe(false);
    if (!unknownNum.ok) {
      expect(unknownNum.violations[0]?.code).toBe("unknown_number");
    }

    // Unknown placeholder
    const unknownPh = validateExplanation(
      {
        summary: "Betrag {P9.betrag}.",
        items: [{ ref: "P1", text: "Betrag {P1.betrag}." }],
        caveats: [],
      },
      view,
    );
    expect(unknownPh.ok).toBe(false);
    if (!unknownPh.ok) {
      expect(unknownPh.violations[0]?.code).toBe("unknown_placeholder");
    }

    // Unknown or duplicate ref
    const unknownRef = validateExplanation(
      {
        summary: "Betrag {BETRAG}.",
        items: [{ ref: "P99", text: "Betrag {P1.betrag}." }],
        caveats: [],
      },
      view,
    );
    expect(unknownRef.ok).toBe(false);
    if (!unknownRef.ok) {
      expect(unknownRef.violations[0]?.code).toBe("unknown_ref");
    }

    // Invalid JSON / schema
    const badSchema = validateExplanation({ items: [] }, view);
    expect(badSchema.ok).toBe(false);
    if (!badSchema.ok) {
      expect(badSchema.violations[0]?.code).toBe("invalid_json");
    }
  });

  it("rejects invented percentages even when the number is in allowedLiterals, and allows view refs with digits", () => {
    const result = recommendUse(1_200_000, state);
    const view = buildRecommendationLlmView(result, state, {
      isDummyHousehold: false,
    });

    // 8 is in allowedLiterals (8 Monate), but "8 %", "8 Prozent", "8 %." must be literal_amount
    for (const badText of [
      "Rendite liegt bei 8 % pro Jahr.",
      "Rund 8 Prozent Rendite.",
      "Anteil 8 %.",
    ]) {
      const res = validateExplanation(
        {
          summary: badText,
          items: [{ ref: "P1", text: "{P1.betrag}" }],
          caveats: [],
        },
        view,
      );
      expect(res.ok).toBe(false);
      if (!res.ok) {
        expect(res.violations[0]?.code).toBe("literal_amount");
      }
    }

    // Refs from view (ZIEL-1, KREDIT-1, P1, P2, P3) are allowed
    const withRefs = validateExplanation(
      {
        summary: "Verteilung auf NOTGROSCHEN, ZIEL-1 und KREDIT-1.",
        items: [
          { ref: "P1", text: "{P1.betrag} für P1." },
          { ref: "P2", text: "{P2.betrag} für ZIEL-1." },
          { ref: "P3", text: "{P3.betrag} gehen an KREDIT-1." },
        ],
        caveats: [],
      },
      view,
    );
    expect(withRefs.ok).toBe(true);
  });

  it("findCentLikeNumbers detects raw cent values but allows normal small numbers and years", () => {
    const ctx = buildInvestmentContext(makeContextInput());
    const raw = collectRawCentValues(ctx);
    expect(
      findCentLikeNumbers(["3 bis 6 Monate bis 2027"], raw),
    ).toEqual([]);
    expect(findCentLikeNumbers(["Wert 1234500"], raw)).toEqual(["1234500"]);
    expect(findCentLikeNumbers(["Nur 50 Cent"], raw)).toEqual(["50"]);
  });

  it("includes loan_rate_increase in LLM view with Euro values, accepts valid placeholder rates, and rejects invented rates or corridors", () => {
    const rateState: RecommendationState = {
      asOfDate: "2026-01-15",
      monthlyExpensesCents: 0,
      monthlySurplusCents: 100_000,
      pots: [],
      loans: [
        {
          id: "loan-1",
          balanceCents: 20_000_000,
          interestRateBps: 550,
          monthlyRateCents: 100_000,
          repaymentType: "annuity",
          specialRepaymentMaxYearlyCents: 0,
          fixedInterestUntil: "2036-01-01",
          futureLoanInterestRateBps: null,
          rateCorridor: {
            status: "allowed",
            currentMonthlyCents: 100_000,
            minMonthlyCents: 70_000,
            maxMonthlyCents: 130_000,
            sliderMinMonthlyCents: 70_000,
            monthlyInterestCents: 91_667,
            remainingChanges: 2,
            latestChangeDate: "2036-01-01",
            minRepaymentBps: 100,
            maxRepaymentBps: 500,
            flags: {
              corridorAssumed: false,
              approximatedBase: false,
              currentOutsideCorridor: false,
              minBelowInterest: false,
              perYearUsageUntracked: false,
              exhausted: false,
              corridorEmpty: false,
            },
          },
        },
      ],
    };

    const result = recommendMonthlySavings(rateState, { savingsBufferBps: 0 });
    const view = buildRecommendationLlmView(result, rateState, {
      isDummyHousehold: true,
    });
    const ratePost = view.posten.find((p) => p.art === "ratenerhoehung");
    expect(ratePost).toBeDefined();
    expect(view.werte[`${ratePost!.ref}.aktuelleRate`]).toBe("1.000 €");
    expect(view.werte[`${ratePost!.ref}.neueRate`]).toBe("1.300 €");

    // Accepts valid placeholder-based new rate
    const ok = validateExplanation(
      {
        summary: "Wir verteilen {BETRAG} monatlich.",
        items: [
          {
            ref: ratePost!.ref,
            text: `Rate von {${ratePost!.ref}.aktuelleRate} auf {${ratePost!.ref}.neueRate} erhöhen.`,
          },
        ],
        caveats: [],
      },
      view,
    );
    expect(ok.ok).toBe(true);
    if (ok.ok) {
      expect(ok.explanation.items[0]?.text).toBe(
        "Rate von 1.000 € auf 1.300 € erhöhen.",
      );
    }

    // Rejects invented rate
    const badRate = validateExplanation(
      {
        summary: "Rate auf 1.800 € erhöhen.",
        items: [{ ref: ratePost!.ref, text: `{${ratePost!.ref}.betrag}` }],
        caveats: [],
      },
      view,
    );
    expect(badRate.ok).toBe(false);

    // Rejects invented corridor
    const badCorridor = validateExplanation(
      {
        summary: "Korridor liegt bei 1 bis 5 Prozent.",
        items: [{ ref: ratePost!.ref, text: `{${ratePost!.ref}.betrag}` }],
        caveats: [],
      },
      view,
    );
    expect(badCorridor.ok).toBe(false);
  });
});
