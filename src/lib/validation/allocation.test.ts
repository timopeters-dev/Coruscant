import { describe, expect, it } from "vitest";
import {
  cashflowCreateSchema,
  cashflowUpdateSchema,
  potAllocateSchema,
  potCreateSchema,
  potReorderSchema,
  potUpdateSchema,
  validatePotTargetDateWindow,
} from "./allocation";

describe("cashflowCreateSchema & cashflowUpdateSchema", () => {
  it("accepts valid manual cashflow items and defaults active=true", () => {
    const parsed = cashflowCreateSchema.parse({
      name: "Nettogehalt Muster",
      direction: "inflow",
      amountCents: 420_000,
      frequency: "monthly",
    });

    expect(parsed).toEqual({
      name: "Nettogehalt Muster",
      direction: "inflow",
      amountCents: 420_000,
      frequency: "monthly",
      active: true,
    });
  });

  it("rejects floats, negative amounts, empty names, and unknown fields like source", () => {
    expect(
      cashflowCreateSchema.safeParse({
        name: "Test",
        direction: "inflow",
        amountCents: 100.5,
        frequency: "monthly",
      }).success,
    ).toBe(false);

    expect(
      cashflowCreateSchema.safeParse({
        name: "Test",
        direction: "outflow",
        amountCents: -1,
        frequency: "monthly",
      }).success,
    ).toBe(false);

    expect(
      cashflowCreateSchema.safeParse({
        name: "   ",
        direction: "inflow",
        amountCents: 100,
        frequency: "monthly",
      }).success,
    ).toBe(false);

    expect(
      cashflowCreateSchema.safeParse({
        name: "Vertragstest",
        direction: "outflow",
        amountCents: 10_000,
        frequency: "monthly",
        source: "contract_linked",
      }).success,
    ).toBe(false);

    expect(cashflowUpdateSchema.safeParse({}).success).toBe(false);
    expect(() =>
      potAllocateSchema.safeParse({
        inputAmountCents: Number.MAX_SAFE_INTEGER,
        mode: "one_time",
        sourceLabel: "Einmalzufluss",
        allocations: [
          { potId: "pot-1", amountCents: Number.MAX_SAFE_INTEGER },
          { potId: "pot-2", amountCents: 1 },
        ],
      }),
    ).not.toThrow();

    expect(
      potAllocateSchema.safeParse({
        inputAmountCents: Number.MAX_SAFE_INTEGER,
        mode: "one_time",
        sourceLabel: "Einmalzufluss",
        allocations: [
          { potId: "pot-1", amountCents: Number.MAX_SAFE_INTEGER },
          { potId: "pot-2", amountCents: 1 },
        ],
      }).success,
    ).toBe(false);
  });
});

describe("potCreateSchema", () => {
  it("validates and normalizes all 3 rule types", () => {
    const fill = potCreateSchema.parse({
      name: "Notgroschen",
      ruleType: "fill_to_target",
      currentCents: 100_000,
      targetCents: 500_000,
      fixedMonthlyCents: 99_999,
      remainderPercentage: 50,
      linkedPropertyId: "  ",
      linkedContractId: "contract-1",
    });
    expect(fill).toEqual({
      name: "Notgroschen",
      ruleType: "fill_to_target",
      currentCents: 100_000,
      targetCents: 500_000,
      targetDate: null,
      fixedMonthlyCents: null,
      remainderPercentage: null,
      linkedPropertyId: null,
      linkedContractId: "contract-1",
      externalLink: null,
      purpose: null,
    });

    const fixed = potCreateSchema.parse({
      name: "Instandhaltung Musterstraße 1",
      ruleType: "fixed_monthly",
      fixedMonthlyCents: 25_000,
      remainderPercentage: 10,
    });
    expect(fixed.fixedMonthlyCents).toBe(25_000);
    expect(fixed.remainderPercentage).toBeNull();
    expect(fixed.currentCents).toBe(0);

    const pct = potCreateSchema.parse({
      name: "Sondertilgung",
      ruleType: "percentage_of_remainder",
      remainderPercentage: 60,
      targetCents: 300_000,
    });
    expect(pct.remainderPercentage).toBe(60);
    expect(pct.fixedMonthlyCents).toBeNull();
    expect(pct.targetCents).toBe(300_000);
  });

  it("validiert purpose: gültig, null und weggelassen akzeptiert, Nicht-Enum abgelehnt", () => {
    const base = {
      name: "Muster-Notgroschen",
      ruleType: "fill_to_target" as const,
      targetCents: 100_000,
    };
    expect(potCreateSchema.parse({ ...base, purpose: "emergency_fund" }).purpose).toBe(
      "emergency_fund",
    );
    expect(potCreateSchema.parse({ ...base, purpose: "goal" }).purpose).toBe("goal");
    expect(potCreateSchema.parse({ ...base, purpose: "investment" }).purpose).toBe(
      "investment",
    );
    expect(potCreateSchema.parse({ ...base, purpose: null }).purpose).toBeNull();
    expect(potCreateSchema.parse(base).purpose).toBeNull();
    expect(potCreateSchema.safeParse({ ...base, purpose: "notgroschen" }).success).toBe(
      false,
    );
  });

  it("potUpdateSchema: purpose optional, Nicht-Enum abgelehnt, Update ohne purpose lässt undefined", () => {
    expect(potUpdateSchema.parse({ purpose: "goal" }).purpose).toBe("goal");
    expect(potUpdateSchema.parse({ purpose: null }).purpose).toBeNull();
    expect(potUpdateSchema.parse({ name: "Neu" }).purpose).toBeUndefined();
    expect(potUpdateSchema.safeParse({ purpose: "notgroschen" }).success).toBe(false);
  });

  it("validates the optional externalLink (kind/ref)", () => {
    const base = {
      name: "Muster-Tagesgeld",
      ruleType: "fill_to_target" as const,
      targetCents: 100_000,
    };
    expect(
      potCreateSchema.parse({
        ...base,
        externalLink: { kind: "account", ref: "  acc-1 " },
      }).externalLink,
    ).toEqual({ kind: "account", ref: "acc-1" });
    expect(potCreateSchema.parse({ ...base, externalLink: null }).externalLink).toBeNull();
    expect(potCreateSchema.parse(base).externalLink).toBeNull();

    expect(
      potCreateSchema.safeParse({ ...base, externalLink: { kind: "account", ref: "  " } }).success,
    ).toBe(false);
    expect(
      potCreateSchema.safeParse({ ...base, externalLink: { kind: "savings_pot", ref: "x" } }).success,
    ).toBe(false);
  });

  it("rejects missing rule-specific fields and out-of-range percentages", () => {
    expect(
      potCreateSchema.safeParse({
        name: "Fehlender Zielwert",
        ruleType: "fill_to_target",
      }).success,
    ).toBe(false);

    expect(
      potCreateSchema.safeParse({
        name: "Fehlender Monatsbetrag",
        ruleType: "fixed_monthly",
      }).success,
    ).toBe(false);

    expect(
      potCreateSchema.safeParse({
        name: "Prozent > 100",
        ruleType: "percentage_of_remainder",
        remainderPercentage: 101,
      }).success,
    ).toBe(false);

    expect(
      potCreateSchema.safeParse({
        name: "Prozent < 0",
        ruleType: "percentage_of_remainder",
        remainderPercentage: -1,
      }).success,
    ).toBe(false);
    expect(() =>
      potAllocateSchema.safeParse({
        inputAmountCents: Number.MAX_SAFE_INTEGER,
        mode: "one_time",
        sourceLabel: "Einmalzufluss",
        allocations: [
          { potId: "pot-1", amountCents: Number.MAX_SAFE_INTEGER },
          { potId: "pot-2", amountCents: 1 },
        ],
      }),
    ).not.toThrow();

    expect(
      potAllocateSchema.safeParse({
        inputAmountCents: Number.MAX_SAFE_INTEGER,
        mode: "one_time",
        sourceLabel: "Einmalzufluss",
        allocations: [
          { potId: "pot-1", amountCents: Number.MAX_SAFE_INTEGER },
          { potId: "pot-2", amountCents: 1 },
        ],
      }).success,
    ).toBe(false);
  });
});

describe("potReorderSchema & potAllocateSchema", () => {
  it("validates valid reorder and allocate payloads", () => {
    expect(
      potReorderSchema.parse({ orderedPotIds: ["pot-2", "pot-1"] }),
    ).toEqual({ orderedPotIds: ["pot-2", "pot-1"] });

    expect(
      potAllocateSchema.parse({
        inputAmountCents: 150_000,
        mode: "monthly",
        sourceLabel: "Monatsüberschuss",
        allocations: [
          { potId: "pot-1", amountCents: 100_000 },
          { potId: "pot-2", amountCents: 0 },
        ],
      }).allocations,
    ).toHaveLength(2);
  });

  it("rejects duplicate ids, zero-sum allocations, and exceeding inputAmountCents", () => {
    expect(potReorderSchema.safeParse({ orderedPotIds: [] }).success).toBe(
      false,
    );
    expect(
      potReorderSchema.safeParse({ orderedPotIds: ["pot-1", "pot-1"] }).success,
    ).toBe(false);

    expect(
      potAllocateSchema.safeParse({
        inputAmountCents: 0,
        mode: "one_time",
        sourceLabel: "Einmalzufluss",
        allocations: [{ potId: "pot-1", amountCents: 0 }],
      }).success,
    ).toBe(false);

    expect(
      potAllocateSchema.safeParse({
        inputAmountCents: 50_000,
        mode: "monthly",
        sourceLabel: "Monatsüberschuss",
        allocations: [
          { potId: "pot-1", amountCents: 0 },
          { potId: "pot-2", amountCents: 0 },
        ],
      }).success,
    ).toBe(false);

    expect(
      potAllocateSchema.safeParse({
        inputAmountCents: 50_000,
        mode: "monthly",
        sourceLabel: "Monatsüberschuss",
        allocations: [
          { potId: "pot-1", amountCents: 30_000 },
          { potId: "pot-2", amountCents: 20_001 },
        ],
      }).success,
    ).toBe(false);

    expect(
      potAllocateSchema.safeParse({
        inputAmountCents: 50_000,
        mode: "monthly",
        sourceLabel: "Monatsüberschuss",
        allocations: [
          { potId: "pot-1", amountCents: 10_000 },
          { potId: "pot-1", amountCents: 10_000 },
        ],
      }).success,
    ).toBe(false);
    expect(() =>
      potAllocateSchema.safeParse({
        inputAmountCents: Number.MAX_SAFE_INTEGER,
        mode: "one_time",
        sourceLabel: "Einmalzufluss",
        allocations: [
          { potId: "pot-1", amountCents: Number.MAX_SAFE_INTEGER },
          { potId: "pot-2", amountCents: 1 },
        ],
      }),
    ).not.toThrow();

    expect(
      potAllocateSchema.safeParse({
        inputAmountCents: Number.MAX_SAFE_INTEGER,
        mode: "one_time",
        sourceLabel: "Einmalzufluss",
        allocations: [
          { potId: "pot-1", amountCents: Number.MAX_SAFE_INTEGER },
          { potId: "pot-2", amountCents: 1 },
        ],
      }).success,
    ).toBe(false);
  });
});

describe("pot targetDate validation", () => {
  it("accepts valid targetDate with targetCents and normalizes empty string to null", () => {
    const parsed = potCreateSchema.parse({
      name: "Topf Musterziel",
      ruleType: "fill_to_target",
      targetCents: 100_000,
      targetDate: "2028-06-30",
    });
    expect(parsed.targetDate).toBe("2028-06-30");

    const empty = potCreateSchema.parse({
      name: "Topf Ohne Termin",
      ruleType: "fixed_monthly",
      fixedMonthlyCents: 10_000,
      targetDate: "",
    });
    expect(empty.targetDate).toBeNull();
  });

  it("rejects invalid ISO dates", () => {
    for (const badDate of ["2027-13-01", "2027-02-29", "morgen"]) {
      const res = potCreateSchema.safeParse({
        name: "Topf Musterziel",
        ruleType: "fill_to_target",
        targetCents: 100_000,
        targetDate: badDate,
      });
      expect(res.success).toBe(false);
    }
  });

  it("rejects targetDate without targetCents across all ruleTypes with issue on targetDate", () => {
    const cases = [
      { name: "T1", ruleType: "fill_to_target", targetDate: "2028-06-30" },
      { name: "T2", ruleType: "fixed_monthly", fixedMonthlyCents: 10_000, targetDate: "2028-06-30" },
      { name: "T3", ruleType: "percentage_of_remainder", remainderPercentage: 50, targetDate: "2028-06-30" },
    ];
    for (const c of cases) {
      const res = potCreateSchema.safeParse(c);
      expect(res.success).toBe(false);
      if (!res.success) {
        expect(res.error.issues.some((i) => i.path.includes("targetDate"))).toBe(true);
      }
    }
  });

  it("validates targetDate window (today .. +480 months)", () => {
    expect(validatePotTargetDateWindow("2026-11-17", "2026-11-18")).toBe(
      "Das Zieldatum darf nicht in der Vergangenheit liegen.",
    );
    expect(validatePotTargetDateWindow("2026-11-18", "2026-11-18")).toBeNull();
    expect(validatePotTargetDateWindow("2066-11-18", "2026-11-18")).toBeNull();
    expect(validatePotTargetDateWindow("2066-12-18", "2026-11-18")).toBe(
      "Das Zieldatum darf höchstens 40 Jahre in der Zukunft liegen.",
    );
  });
});
