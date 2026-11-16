import { describe, expect, it } from "vitest";
import {
  contractCreateSchema,
  contractUpdateSchema,
  propertyCreateSchema,
  propertyUpdateSchema,
} from "./contracts";

describe("propertyCreateSchema & propertyUpdateSchema", () => {
  it("validates a valid property payload and converts empty optional strings to null", () => {
    const parsed = propertyCreateSchema.parse({
      name: "  Immobilie #0 (Musterstraße 1)  ",
      usage: "owner_occupied",
      purchaseDate: "",
      purchasePriceCents: 45000000,
      estimatedValueCents: 48000000,
    });

    expect(parsed).toEqual({
      name: "Immobilie #0 (Musterstraße 1)",
      usage: "owner_occupied",
      purchaseDate: null,
      purchasePriceCents: 45000000,
      estimatedValueCents: 48000000,
    });
  });

  it("rejects invalid dates, floats, negative cents, and empty updates", () => {
    expect(
      propertyCreateSchema.safeParse({
        name: "Musterhaus",
        purchaseDate: "2026-02-30",
        estimatedValueCents: 100000,
      }).success,
    ).toBe(false);

    expect(
      propertyCreateSchema.safeParse({
        name: "Musterhaus",
        estimatedValueCents: 123.45,
      }).success,
    ).toBe(false);

    expect(
      propertyCreateSchema.safeParse({
        name: "Musterhaus",
        estimatedValueCents: -1,
      }).success,
    ).toBe(false);

    expect(propertyUpdateSchema.safeParse({}).success).toBe(false);
  });
});

describe("contractCreateSchema & contractUpdateSchema", () => {
  it("normalizes loan contracts (annuity, installment, lump_sum) and strips savings fields", () => {
    const annuity = contractCreateSchema.parse({
      name: "Hauskredit Musterbank",
      provider: "Musterbank",
      category: "loan",
      currentBalanceCents: 29500000,
      balanceAsOfDate: "2026-11-01",
      monthlyRateCents: 140000,
      interestRateBps: 350,
      targetSumCents: 5000000, // should be stripped for loans
    });

    expect(annuity.repaymentType).toBe("annuity");
    expect(annuity.targetSumCents).toBeNull();
    expect(annuity.allocationThresholdPercent).toBeNull();
    expect(annuity.futureLoanInterestRateBps).toBeNull();

    const lumpSum = contractCreateSchema.parse({
      name: "Privatdarlehen Familie Muster",
      category: "loan",
      repaymentType: "lump_sum",
      currentBalanceCents: 2500000,
      balanceAsOfDate: "2026-11-01",
      monthlyRateCents: 0,
      interestRateBps: 0,
      milestoneDate: "2028-12-31",
      milestoneLabel: "Rückzahlung",
    });

    expect(lumpSum.repaymentType).toBe("lump_sum");
    expect(lumpSum.milestoneDate).toBe("2028-12-31");
  });

  it("normalizes savings_contract and strips loan-specific fields", () => {
    const bauspar = contractCreateSchema.parse({
      name: "Bausparvertrag Musterkasse",
      category: "savings_contract",
      currentBalanceCents: 1800000,
      balanceAsOfDate: "2026-11-01",
      monthlyRateCents: 30000,
      interestRateBps: 100,
      repaymentType: "annuity", // should be stripped
      fixedInterestUntil: "2030-01-01", // should be stripped
      targetSumCents: 5000000,
      allocationThresholdPercent: 40,
      futureLoanInterestRateBps: 250,
    });

    expect(bauspar.repaymentType).toBeNull();
    expect(bauspar.fixedInterestUntil).toBeNull();
    expect(bauspar.specialRepaymentMaxYearlyCents).toBeNull();
    expect(bauspar.targetSumCents).toBe(5000000);
    expect(bauspar.allocationThresholdPercent).toBe(40);
    expect(bauspar.futureLoanInterestRateBps).toBe(250);
  });

  it("rejects invalid dates, float cents, negative bps, and out-of-range thresholds", () => {
    expect(
      contractCreateSchema.safeParse({
        name: "Test",
        category: "loan",
        currentBalanceCents: 1000,
        balanceAsOfDate: "2026-02-30",
      }).success,
    ).toBe(false);

    expect(
      contractCreateSchema.safeParse({
        name: "Test",
        category: "loan",
        currentBalanceCents: 123.45,
        balanceAsOfDate: "2026-11-01",
      }).success,
    ).toBe(false);

    expect(
      contractCreateSchema.safeParse({
        name: "Test",
        category: "loan",
        currentBalanceCents: 1000,
        balanceAsOfDate: "2026-11-01",
        interestRateBps: -10,
      }).success,
    ).toBe(false);

    expect(
      contractCreateSchema.safeParse({
        name: "Test",
        category: "savings_contract",
        currentBalanceCents: 1000,
        balanceAsOfDate: "2026-11-01",
        allocationThresholdPercent: 101,
      }).success,
    ).toBe(false);

    expect(contractUpdateSchema.safeParse({}).success).toBe(false);
  });
});
