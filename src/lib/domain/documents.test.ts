import { describe, expect, it } from "vitest";
import type { DomainContract } from "./contracts";
import {
  type DomainDocument,
  evaluateContractCalibration,
  filterVerifiedDocuments,
  resolveDocumentTaxYear,
} from "./documents";

const sampleLoan: DomainContract = {
  id: "loan-musterbank",
  name: "Musterbank Darlehen",
  sphere: "household",
  category: "loan",
  status: "active",
  currentBalanceCents: 30_000_000, // 300.000,00 €
  balanceAsOfDate: "2026-01-01",
  monthlyRateCents: 150_000, // 1.500,00 €
  interestRateBps: 360, // 3,60 %
  repaymentType: "annuity",
};

function makeDoc(overrides: Partial<DomainDocument> = {}): DomainDocument {
  return {
    id: "doc-1",
    status: "verified",
    documentType: "invoice",
    documentDate: "2025-11-15",
    issuer: "Musterbetrieb GmbH",
    totalAmountCents: 120_000,
    linkedPropertyId: "prop-1",
    linkedContractId: null,
    isTaxRelevant: true,
    taxYear: 2025,
    taxCategory: "handwerker_35a",
    deductibleAmountCents: 84_000,
    detectedBalanceCents: null,
    createdAt: "2026-01-10T10:00:00.000Z",
    ...overrides,
  };
}

describe("evaluateContractCalibration", () => {
  it("computes stored and projected deltas for a newer calibration date", () => {
    const result = evaluateContractCalibration(
      sampleLoan,
      29_500_000,
      "2026-03-01",
      "2026-04-01",
    );

    expect(result.effectiveDate).toBe("2026-03-01");
    expect(result.isOlderThanCurrentCalibration).toBe(false);
    expect(result.previousBalanceCents).toBe(30_000_000);
    expect(result.previousAsOfDate).toBe("2026-01-01");
    expect(result.newBalanceCents).toBe(29_500_000);
    expect(result.deltaToStoredCents).toBe(-500_000);
    expect(result.deltaToProjectedCents).toBe(
      29_500_000 - result.projectedBalanceAtDateCents,
    );
  });

  it("uses fallbackDate when candidateDate is null and supports 0-cent balances", () => {
    const result = evaluateContractCalibration(
      sampleLoan,
      0,
      null,
      "2026-01-01",
    );

    expect(result.effectiveDate).toBe("2026-01-01");
    expect(result.isOlderThanCurrentCalibration).toBe(false);
    expect(result.newBalanceCents).toBe(0);
    expect(result.projectedBalanceAtDateCents).toBe(30_000_000);
    expect(result.deltaToStoredCents).toBe(-30_000_000);
    expect(result.deltaToProjectedCents).toBe(-30_000_000);
  });

  it("flags isOlderThanCurrentCalibration when effectiveDate precedes balanceAsOfDate", () => {
    const result = evaluateContractCalibration(
      sampleLoan,
      30_200_000,
      "2025-12-15",
      "2026-04-01",
    );

    expect(result.effectiveDate).toBe("2025-12-15");
    expect(result.isOlderThanCurrentCalibration).toBe(true);
    expect(result.deltaToStoredCents).toBe(200_000);
  });

  it("throws RangeError for negative balances or invalid dates", () => {
    expect(() =>
      evaluateContractCalibration(sampleLoan, -1, "2026-02-01", "2026-04-01"),
    ).toThrow(RangeError);
    expect(() =>
      evaluateContractCalibration(
        sampleLoan,
        100_000,
        "2026-02-30",
        "2026-04-01",
      ),
    ).toThrow(RangeError);
    expect(() =>
      evaluateContractCalibration(sampleLoan, 100_000, null, "invalid-date"),
    ).toThrow(RangeError);
  });
});

describe("resolveDocumentTaxYear", () => {
  it("prefers explicit taxYear and falls back to valid documentDate year", () => {
    expect(
      resolveDocumentTaxYear({ taxYear: 2024, documentDate: "2025-01-10" }),
    ).toBe(2024);
    expect(
      resolveDocumentTaxYear({ taxYear: null, documentDate: "2025-12-31" }),
    ).toBe(2025);
    expect(
      resolveDocumentTaxYear({ taxYear: null, documentDate: null }),
    ).toBeNull();
    expect(
      resolveDocumentTaxYear({ taxYear: null, documentDate: "invalid" }),
    ).toBeNull();
  });
});

describe("filterVerifiedDocuments", () => {
  it("filters strictly on verified status and combines taxYear, propertyId, contractId, and onlyTaxRelevant", () => {
    const docs = [
      makeDoc({ id: "d1", status: "pending_review", taxYear: 2025 }),
      makeDoc({
        id: "d2",
        status: "verified",
        taxYear: 2025,
        linkedPropertyId: "prop-1",
        linkedContractId: "c-1",
        isTaxRelevant: true,
      }),
      makeDoc({
        id: "d3",
        status: "verified",
        taxYear: 2025,
        linkedPropertyId: "prop-1",
        linkedContractId: "c-2",
        isTaxRelevant: false,
      }),
      makeDoc({
        id: "d4",
        status: "verified",
        taxYear: 2024,
        linkedPropertyId: "prop-2",
        linkedContractId: "c-1",
        isTaxRelevant: true,
      }),
    ];

    expect(filterVerifiedDocuments(docs).map((d) => d.id)).toEqual([
      "d2",
      "d3",
      "d4",
    ]);
    expect(
      filterVerifiedDocuments(docs, {
        taxYear: 2025,
        propertyId: "prop-1",
        onlyTaxRelevant: true,
      }).map((d) => d.id),
    ).toEqual(["d2"]);
    expect(
      filterVerifiedDocuments(docs, {
        contractId: "c-1",
      }).map((d) => d.id),
    ).toEqual(["d2", "d4"]);
  });
});
