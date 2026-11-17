import { describe, expect, it } from "vitest";
import {
  aiDocumentExtractionSchema,
  documentCreateContractSchema,
  documentMetadataSchema,
  documentUpdateSchema,
  documentVerifySchema,
  parseExtractedContractJson,
} from "./documents";

describe("aiDocumentExtractionSchema", () => {
  it("parses valid extraction including 0-cent values and defaults", () => {
    const parsed = aiDocumentExtractionSchema.parse({
      documentType: "invoice",
      documentDate: "2025-10-12",
      issuer: "Musterbetrieb GmbH",
      totalAmountCents: 0,
      isTaxRelevant: true,
      taxYear: 2025,
      taxCategory: "handwerker_35a",
      deductibleAmountCents: 0,
      detectedBalanceCents: null,
    });

    expect(parsed.totalAmountCents).toBe(0);
    expect(parsed.deductibleAmountCents).toBe(0);
    expect(parsed.issuer).toBe("Musterbetrieb GmbH");
  });

  it("rejects float amounts, negative amounts, invalid enums, and deductible > total", () => {
    expect(() =>
      aiDocumentExtractionSchema.parse({
        totalAmountCents: 12.34,
      }),
    ).toThrow();

    expect(() =>
      aiDocumentExtractionSchema.parse({
        detectedBalanceCents: -100,
      }),
    ).toThrow();

    expect(() =>
      aiDocumentExtractionSchema.parse({
        documentType: "unknown_type",
      }),
    ).toThrow();

    expect(() =>
      aiDocumentExtractionSchema.parse({
        totalAmountCents: 10_000,
        deductibleAmountCents: 12_000,
      }),
    ).toThrow();
  });
});

describe("documentMetadataSchema & documentVerifySchema", () => {
  it("derives taxYear from documentDate when tax-relevant and normalizes non-tax fields", () => {
    const taxRelevant = documentMetadataSchema.parse({
      documentType: "invoice",
      documentDate: "2025-07-01",
      issuer: "Musterbetrieb GmbH",
      totalAmountCents: 50_000,
      linkedPropertyId: "prop-1",
      linkedContractId: null,
      isTaxRelevant: true,
      taxYear: null,
      taxCategory: "handwerker_35a",
      deductibleAmountCents: 30_000,
      detectedBalanceCents: null,
    });
    expect(taxRelevant.taxYear).toBe(2025);

    const notTaxRelevant = documentMetadataSchema.parse({
      documentType: "other",
      documentDate: "2025-07-01",
      isTaxRelevant: false,
      taxCategory: "handwerker_35a",
      deductibleAmountCents: 30_000,
    });
    expect(notTaxRelevant.taxCategory).toBeNull();
    expect(notTaxRelevant.deductibleAmountCents).toBeNull();
  });

  it("requires linkedContractId and balance when calibrateContract is true", () => {
    expect(() =>
      documentVerifySchema.parse({
        documentType: "loan_statement",
        documentDate: "2026-01-31",
        isTaxRelevant: false,
        calibrateContract: true,
        linkedContractId: null,
        detectedBalanceCents: 29_500_000,
      }),
    ).toThrow();

    expect(() =>
      documentVerifySchema.parse({
        documentType: "loan_statement",
        documentDate: "2026-01-31",
        isTaxRelevant: false,
        calibrateContract: true,
        linkedContractId: "c-1",
        detectedBalanceCents: null,
        calibratedBalanceCents: null,
      }),
    ).toThrow();

    const valid = documentVerifySchema.parse({
      documentType: "loan_statement",
      documentDate: "2026-01-31",
      isTaxRelevant: false,
      calibrateContract: true,
      linkedContractId: "c-1",
      calibratedBalanceCents: 0,
    });
    expect(valid.calibratedBalanceCents).toBe(0);
    expect(valid.calibrateContract).toBe(true);
  });

  it("rejects empty update payloads and invalid dates", () => {
    expect(() => documentUpdateSchema.parse({})).toThrow();
    expect(() =>
      documentUpdateSchema.parse({ documentDate: "2026-02-30" }),
    ).toThrow();
  });
});

describe("extractedContractSchema, parseExtractedContractJson & documentCreateContractSchema", () => {
  it("validates loan and savings_contract extractedContract payloads including 0-values", () => {
    const loan = aiDocumentExtractionSchema.parse({
      documentType: "contract",
      documentDate: "2026-01-15",
      issuer: "Musterbank AG",
      isTaxRelevant: false,
      extractedContract: {
        name: "Hauskredit Musterstraße 1",
        provider: "Musterbank AG",
        category: "loan",
        currentBalanceCents: 29_500_000,
        balanceAsOfDate: "2026-01-15",
        monthlyRateCents: 140_000,
        interestRateBps: 345,
        repaymentType: "annuity",
        specialRepaymentMaxYearlyCents: 1_000_000,
        fixedInterestUntil: "2034-01-15",
        targetSumCents: null,
        allocationThresholdPercent: null,
        futureLoanInterestRateBps: null,
        milestoneDate: "2034-01-15",
        milestoneLabel: "Ende Zinsbindung",
      },
    });
    expect(loan.extractedContract?.interestRateBps).toBe(345);
    expect(loan.extractedContract?.currentBalanceCents).toBe(29_500_000);

    const savings = aiDocumentExtractionSchema.parse({
      documentType: "bauspar_statement",
      extractedContract: {
        category: "savings_contract",
        currentBalanceCents: 0,
        monthlyRateCents: 0,
        interestRateBps: 0,
        targetSumCents: 5_000_000,
        allocationThresholdPercent: 40,
        futureLoanInterestRateBps: 250,
      },
    });
    expect(savings.extractedContract?.allocationThresholdPercent).toBe(40);
    expect(savings.extractedContract?.interestRateBps).toBe(0);

    const thresholdBoundaryZero = aiDocumentExtractionSchema.parse({
      extractedContract: {
        allocationThresholdPercent: 0,
      },
    });
    expect(
      thresholdBoundaryZero.extractedContract?.allocationThresholdPercent,
    ).toBe(0);

    const thresholdBoundaryHundred = aiDocumentExtractionSchema.parse({
      extractedContract: {
        allocationThresholdPercent: 100,
      },
    });
    expect(
      thresholdBoundaryHundred.extractedContract?.allocationThresholdPercent,
    ).toBe(100);
  });

  it("supports partial extractedContract with null fields and null/omitted extractedContract", () => {
    const partial = aiDocumentExtractionSchema.parse({
      documentType: "contract",
      extractedContract: {
        interestRateBps: 345,
        monthlyRateCents: null,
        currentBalanceCents: null,
      },
    });
    expect(partial.extractedContract?.interestRateBps).toBe(345);
    expect(partial.extractedContract?.monthlyRateCents).toBeNull();

    const withNull = aiDocumentExtractionSchema.parse({
      extractedContract: null,
    });
    expect(withNull.extractedContract).toBeNull();

    const omitted = aiDocumentExtractionSchema.parse({});
    expect(omitted.extractedContract).toBeUndefined();
  });

  it("rejects floats, negative values, out-of-range bps/percent, and invalid dates in extractedContract", () => {
    const invalidCases = [
      { currentBalanceCents: 123.45 },
      { currentBalanceCents: -1 },
      { interestRateBps: 3.45 },
      { interestRateBps: -1 },
      { interestRateBps: 100_001 },
      { allocationThresholdPercent: -1 },
      { allocationThresholdPercent: 101 },
      { allocationThresholdPercent: 40.5 },
      { balanceAsOfDate: "2026-02-30" },
      { category: "mortgage" },
      { repaymentType: "bullet" },
    ];

    for (const extractedContract of invalidCases) {
      expect(() =>
        aiDocumentExtractionSchema.parse({ extractedContract }),
      ).toThrow();
    }
  });

  it("parses extractedContract JSON defensively via parseExtractedContractJson", () => {
    expect(
      parseExtractedContractJson(
        JSON.stringify({ name: "Testkredit", interestRateBps: 350 }),
      ),
    ).toEqual({ name: "Testkredit", interestRateBps: 350 });

    expect(parseExtractedContractJson("{invalid-json")).toBeNull();
    expect(
      parseExtractedContractJson(JSON.stringify({ interestRateBps: 3.45 })),
    ).toBeNull();
    expect(parseExtractedContractJson(null)).toBeNull();
  });

  it("validates documentCreateContractSchema with and without document metadata", () => {
    const withoutDoc = documentCreateContractSchema.parse({
      contract: {
        name: "Hauskredit Musterbank",
        category: "loan",
        currentBalanceCents: 29_500_000,
        balanceAsOfDate: "2026-01-15",
        monthlyRateCents: 140_000,
        interestRateBps: 345,
      },
    });
    expect(withoutDoc.contract.repaymentType).toBe("annuity");
    expect(withoutDoc.document).toBeUndefined();

    const withDoc = documentCreateContractSchema.parse({
      contract: {
        name: "Bausparvertrag Musterkasse",
        category: "savings_contract",
        currentBalanceCents: 1_000_000,
        balanceAsOfDate: "2026-02-01",
        monthlyRateCents: 20_000,
        interestRateBps: 50,
      },
      document: {
        documentType: "bauspar_statement",
        totalAmountCents: 50_000,
        isTaxRelevant: true,
        deductibleAmountCents: 25_000,
      },
    });
    expect(withDoc.document?.documentType).toBe("bauspar_statement");

    expect(() =>
      documentCreateContractSchema.parse({
        contract: {
          name: "Hauskredit Musterbank",
          category: "loan",
          currentBalanceCents: 29_500_000,
          balanceAsOfDate: "2026-01-15",
        },
        document: {
          totalAmountCents: 10_000,
          deductibleAmountCents: 12_000,
        },
      }),
    ).toThrow();
  });
});
