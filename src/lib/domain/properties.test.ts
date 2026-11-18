import { describe, expect, it } from "vitest";
import {
  type DomainLinkedContract,
  type DomainPropertyDetail,
  summarizeProperties,
} from "./properties";

const baseProperty: DomainPropertyDetail = {
  id: "prop-0",
  name: "Immobilie #0 (Musterstraße 1)",
  usage: "owner_occupied",
  purchaseDate: "2024-01-15",
  purchasePriceCents: 48000000,
  estimatedValueCents: 50000000,
};

describe("summarizeProperties", () => {
  it("computes linked loan/savings projections, net equity, and LTV for a property", () => {
    const contracts: DomainLinkedContract[] = [
      {
        id: "loan-1",
        name: "Hauskredit Musterbank",
        category: "loan",
        status: "active",
        currentBalanceCents: 30000000,
        balanceAsOfDate: "2026-01-01",
        monthlyRateCents: 150000,
        interestRateBps: 360,
        repaymentType: "annuity",
        linkedPropertyId: "prop-0",
      },
      {
        id: "bauspar-1",
        name: "Bausparer Musterkasse",
        category: "savings_contract",
        status: "active",
        currentBalanceCents: 2000000,
        balanceAsOfDate: "2026-01-01",
        monthlyRateCents: 50000,
        interestRateBps: 120,
        linkedPropertyId: "prop-0",
      },
    ];

    const result = summarizeProperties([baseProperty], contracts, "2026-02-01");
    const summary = result["prop-0"];

    expect(summary).toBeDefined();
    if (!summary) {
      throw new Error("Expected summary for prop-0");
    }
    // 1 month elapsed on loan: interest = roundHalfUp(30000000 * 360 / 120000) = 90000
    // new loan balance = 30000000 + 90000 - 150000 = 29940000
    expect(summary.linkedLoanBalanceCents).toBe(29940000);
    // 1 month elapsed on savings: interest = roundHalfUp(2000000 * 120 / 120000) = 2000
    // new savings balance = 2000000 + 50000 + 2000 = 2052000
    expect(summary.linkedSavingsBalanceCents).toBe(2052000);
    expect(summary.netEquityCents).toBe(50000000 - 29940000);
    // LTV = roundHalfUp(29940000 * 10000 / 50000000) = 5988 bps (59.88%)
    expect(summary.ltvBps).toBe(5988);
    expect(summary.linkedContractIds).toEqual(["loan-1", "bauspar-1"]);
  });

  it("handles properties without contracts and zero estimated value", () => {
    const zeroProperty: DomainPropertyDetail = {
      id: "prop-zero",
      name: "Grundstück Musterweg",
      usage: "owner_occupied",
      estimatedValueCents: 0,
    };

    const result = summarizeProperties(
      [baseProperty, zeroProperty],
      [],
      "2026-06-01",
    );

    expect(result["prop-0"]).toEqual({
      propertyId: "prop-0",
      estimatedValueCents: 50000000,
      linkedLoanBalanceCents: 0,
      linkedSavingsBalanceCents: 0,
      netEquityCents: 50000000,
      ltvBps: 0,
      linkedContractIds: [],
    });

    expect(result["prop-zero"]).toEqual({
      propertyId: "prop-zero",
      estimatedValueCents: 0,
      linkedLoanBalanceCents: 0,
      linkedSavingsBalanceCents: 0,
      netEquityCents: 0,
      ltvBps: null,
      linkedContractIds: [],
    });
  });

  it("supports negative net equity (over-financing), ignores closed contracts, and keeps paused contracts at calibrated balance", () => {
    const contracts: DomainLinkedContract[] = [
      {
        id: "loan-paused",
        name: "Privatdarlehen Familie Muster",
        category: "loan",
        status: "paused",
        currentBalanceCents: 55000000,
        balanceAsOfDate: "2026-01-01",
        monthlyRateCents: 100000,
        interestRateBps: 0,
        repaymentType: "lump_sum",
        linkedPropertyId: "prop-0",
      },
      {
        id: "loan-closed",
        name: "Alter Kredit Musterbank",
        category: "loan",
        status: "closed",
        currentBalanceCents: 10000000,
        balanceAsOfDate: "2026-01-01",
        monthlyRateCents: 0,
        interestRateBps: 0,
        repaymentType: "annuity",
        linkedPropertyId: "prop-0",
      },
    ];

    const result = summarizeProperties([baseProperty], contracts, "2026-05-01");
    const summary = result["prop-0"];

    expect(summary).toBeDefined();
    if (!summary) {
      throw new Error("Expected summary for prop-0");
    }
    expect(summary.linkedLoanBalanceCents).toBe(55000000);
    expect(summary.netEquityCents).toBe(-5000000);
    expect(summary.ltvBps).toBe(11000);
    expect(summary.linkedContractIds).toEqual(["loan-paused"]);
  });

  it("throws RangeError on invalid asOfDate or negative/float property amounts", () => {
    expect(() =>
      summarizeProperties([baseProperty], [], "2026-02-30"),
    ).toThrow(RangeError);

    expect(() =>
      summarizeProperties(
        [{ ...baseProperty, estimatedValueCents: -1 }],
        [],
        "2026-05-01",
      ),
    ).toThrow(RangeError);

    expect(() =>
      summarizeProperties(
        [{ ...baseProperty, estimatedValueCents: 123.45 }],
        [],
        "2026-05-01",
      ),
    ).toThrow(RangeError);
  });
});
