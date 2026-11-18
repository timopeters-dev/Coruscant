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

  it("validates extended property metadata, trims strings, handles boundaries, and strips imagePath", () => {
    const parsed = propertyCreateSchema.parse({
      name: "Musterhaus",
      usage: "rented",
      estimatedValueCents: 35000000,
      street: "  Musterstraße  ",
      houseNumber: " 12a ",
      postalCode: " 12345 ",
      city: " Musterstadt ",
      livingAreaSqm: 1,
      usableAreaSqm: 45,
      plotAreaSqm: 500,
      constructionYear: 1500,
      energyClass: "A+",
      features: "  Kamin, Sauna  ",
      imagePath: "/etc/passwd",
    });

    expect(parsed).toEqual({
      name: "Musterhaus",
      usage: "rented",
      estimatedValueCents: 35000000,
      street: "Musterstraße",
      houseNumber: "12a",
      postalCode: "12345",
      city: "Musterstadt",
      livingAreaSqm: 1,
      usableAreaSqm: 45,
      plotAreaSqm: 500,
      constructionYear: 1500,
      energyClass: "A+",
      features: "Kamin, Sauna",
    });
    expect("imagePath" in parsed).toBe(false);

    const upperBoundary = propertyUpdateSchema.parse({
      constructionYear: 2100,
      energyClass: "H",
      street: "   ",
      features: "",
      imagePath: "injected.png",
    });
    expect(upperBoundary).toEqual({
      constructionYear: 2100,
      energyClass: "H",
      street: null,
      features: null,
    });
    expect("imagePath" in upperBoundary).toBe(false);
  });

  it("rejects invalid extended property metadata (zero/negative/float areas, out-of-range year, invalid energyClass, overlong features)", () => {
    expect(
      propertyCreateSchema.safeParse({
        name: "Musterhaus",
        estimatedValueCents: 100000,
        livingAreaSqm: 0,
      }).success,
    ).toBe(false);

    expect(
      propertyCreateSchema.safeParse({
        name: "Musterhaus",
        estimatedValueCents: 100000,
        livingAreaSqm: -10,
      }).success,
    ).toBe(false);

    expect(
      propertyCreateSchema.safeParse({
        name: "Musterhaus",
        estimatedValueCents: 100000,
        livingAreaSqm: 120.5,
      }).success,
    ).toBe(false);

    expect(
      propertyCreateSchema.safeParse({
        name: "Musterhaus",
        estimatedValueCents: 100000,
        usableAreaSqm: 0,
      }).success,
    ).toBe(false);

    expect(
      propertyCreateSchema.safeParse({
        name: "Musterhaus",
        estimatedValueCents: 100000,
        plotAreaSqm: -1,
      }).success,
    ).toBe(false);

    for (const badYear of [1499, 2101, 1999.5]) {
      expect(
        propertyCreateSchema.safeParse({
          name: "Musterhaus",
          estimatedValueCents: 100000,
          constructionYear: badYear,
        }).success,
      ).toBe(false);
    }

    expect(
      propertyCreateSchema.safeParse({
        name: "Musterhaus",
        estimatedValueCents: 100000,
        energyClass: "X",
      }).success,
    ).toBe(false);

    expect(
      propertyCreateSchema.safeParse({
        name: "Musterhaus",
        estimatedValueCents: 100000,
        features: "a".repeat(501),
      }).success,
    ).toBe(false);
  });

  it("rejects rental profile fields on owner_occupied at each field path and accepts them on rented", () => {
    const rentalFields = [
      "monthlyColdRentCents",
      "monthlyNonRecoverableCostsCents",
      "monthlyMaintenanceAllowanceCents",
      "depreciationBasisCents",
    ] as const;

    for (const field of rentalFields) {
      const result = propertyCreateSchema.safeParse({
        name: "Immobilie #0",
        usage: "owner_occupied",
        estimatedValueCents: 30_000_000,
        [field]: 50_000,
      });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues.some((i) => i.path[0] === field)).toBe(true);
      }
    }

    const validRented = propertyCreateSchema.parse({
      name: "Wohnung Musterstraße 1",
      usage: "rented",
      estimatedValueCents: 25_000_000,
      monthlyColdRentCents: 80_000,
      monthlyNonRecoverableCostsCents: 6_000,
      monthlyMaintenanceAllowanceCents: 5_000,
      depreciationBasisCents: 18_000_000,
      maintenanceReservePotId: "  pot-1  ",
    });
    expect(validRented.monthlyColdRentCents).toBe(80_000);
    expect(validRented.maintenanceReservePotId).toBe("pot-1");
  });

  it("rejects invalid rental amounts and overlong maintenanceReservePotId, converts empty potId to null", () => {
    for (const bad of [-1, 100.5, "500", 10_000_001, Number.NaN]) {
      expect(
        propertyCreateSchema.safeParse({
          name: "Wohnung Musterstraße 1",
          usage: "rented",
          estimatedValueCents: 25_000_000,
          monthlyColdRentCents: bad,
        }).success,
      ).toBe(false);
    }

    const emptyPot = propertyCreateSchema.parse({
      name: "Wohnung Musterstraße 1",
      usage: "rented",
      estimatedValueCents: 25_000_000,
      maintenanceReservePotId: "   ",
    });
    expect(emptyPot.maintenanceReservePotId).toBeNull();

    expect(
      propertyCreateSchema.safeParse({
        name: "Wohnung Musterstraße 1",
        usage: "rented",
        estimatedValueCents: 25_000_000,
        maintenanceReservePotId: "p".repeat(121),
      }).success,
    ).toBe(false);
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

  it("validates property renovations and estimatedValueAsOf", () => {
    const valid = propertyCreateSchema.parse({
      name: "Wohnung Musterstraße 1",
      estimatedValueCents: 30_000_000,
      estimatedValueAsOf: "2026-11-01",
      constructionYear: 1998,
      renovations: [
        { year: 2019, kind: "roof" },
        { year: 2021, kind: "heating" },
      ],
    });
    expect(valid.estimatedValueAsOf).toBe("2026-11-01");
    expect(valid.renovations).toHaveLength(2);

    expect(
      propertyUpdateSchema.parse({ estimatedValueAsOf: null })
        .estimatedValueAsOf,
    ).toBeNull();

    expect(
      propertyCreateSchema.safeParse({
        name: "Wohnung Musterstraße 1",
        estimatedValueCents: 30_000_000,
        estimatedValueAsOf: "18.11.2026",
      }).success,
    ).toBe(false);

    // > 10 entries
    expect(
      propertyCreateSchema.safeParse({
        name: "Wohnung Musterstraße 1",
        estimatedValueCents: 30_000_000,
        renovations: Array.from({ length: 11 }, (_, idx) => ({
          year: 2010 + idx,
          kind: "roof",
        })),
      }).success,
    ).toBe(false);

    // Unknown kind
    expect(
      propertyCreateSchema.safeParse({
        name: "Wohnung Musterstraße 1",
        estimatedValueCents: 30_000_000,
        renovations: [{ year: 2020, kind: "pool" }],
      }).success,
    ).toBe(false);

    // Year in future
    expect(
      propertyCreateSchema.safeParse({
        name: "Wohnung Musterstraße 1",
        estimatedValueCents: 30_000_000,
        renovations: [{ year: 2099, kind: "roof" }],
      }).success,
    ).toBe(false);

    // Duplicate (year, kind)
    expect(
      propertyCreateSchema.safeParse({
        name: "Wohnung Musterstraße 1",
        estimatedValueCents: 30_000_000,
        renovations: [
          { year: 2020, kind: "roof" },
          { year: 2020, kind: "roof" },
        ],
      }).success,
    ).toBe(false);

    // Year < constructionYear in same payload
    expect(
      propertyCreateSchema.safeParse({
        name: "Wohnung Musterstraße 1",
        estimatedValueCents: 30_000_000,
        constructionYear: 2005,
        renovations: [{ year: 2000, kind: "roof" }],
      }).success,
    ).toBe(false);
  });
});
