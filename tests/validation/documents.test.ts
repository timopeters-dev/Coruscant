import { describe, expect, it } from "vitest";
import {
  aiDocumentExtractionSchema,
  documentCreateContractSchema,
  documentMetadataSchema,
  documentUpdateSchema,
  documentVerifySchema,
  parseExtractedContractJson,
} from "@/validation/documents";

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

    // Negative Salden sind erlaubt (Bauspar-Abschlussgebühr); Darlehen prüft
    // contractCreateSchema bzw. die Eichung. Gleitkomma bleibt verboten.
    expect(
      aiDocumentExtractionSchema.parse({ detectedBalanceCents: -100 })
        .detectedBalanceCents,
    ).toBe(-100);
    expect(() =>
      aiDocumentExtractionSchema.parse({ detectedBalanceCents: -1.5 }),
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

  it("accepts a negative extracted Bauspar balance (Abschlussgebühr) but rejects a negative loan on contract creation", () => {
    const parsed = aiDocumentExtractionSchema.parse({
      extractedContract: {
        category: "savings_contract",
        currentBalanceCents: -120_000,
      },
    });
    expect(parsed.extractedContract?.currentBalanceCents).toBe(-120_000);

    const base = {
      name: "Musterkasse",
      currentBalanceCents: -120_000,
      balanceAsOfDate: "2026-01-01",
      monthlyRateCents: 20_000,
      interestRateBps: 10,
    };
    expect(
      documentCreateContractSchema.safeParse({
        contract: { ...base, category: "savings_contract" },
      }).success,
    ).toBe(true);
    const loan = documentCreateContractSchema.safeParse({
      contract: { ...base, category: "loan", repaymentType: "annuity" },
    });
    expect(loan.success).toBe(false);
    if (!loan.success) {
      expect(loan.error.issues.some((i) => i.path.join(".") === "contract.currentBalanceCents")).toBe(true);
    }
  });

  it("rejects floats, negative values, out-of-range bps/percent, and invalid dates in extractedContract", () => {
    const invalidCases = [
      { currentBalanceCents: 123.45 },
      { currentBalanceCents: -0.5 },
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

  it("validates loan option fields tolerantly (.catch(null)) while keeping core fields strict, and validates verify applyLoanOptions", () => {
    // Invalid option fields become null while core fields remain intact
    const tolerant = aiDocumentExtractionSchema.parse({
      documentType: "contract",
      extractedContract: {
        name: "Hauskredit Musterbank",
        category: "loan",
        currentBalanceCents: 20_000_000,
        interestRateBps: 350,
        specialRepaymentRight: "allowed",
        specialRepaymentPercentBps: 25_000, // out of range -> null
        rateChangeTotalCount: "5%", // wrong type -> null
        originalPrincipalCents: -100, // invalid -> null
      },
    });
    expect(tolerant.extractedContract?.name).toBe("Hauskredit Musterbank");
    expect(tolerant.extractedContract?.interestRateBps).toBe(350);
    expect(tolerant.extractedContract?.specialRepaymentRight).toBe("allowed");
    expect(tolerant.extractedContract?.specialRepaymentPercentBps).toBeNull();
    expect(tolerant.extractedContract?.rateChangeTotalCount).toBeNull();
    expect(tolerant.extractedContract?.originalPrincipalCents).toBeNull();

    // Invalid core field still fails (regression)
    expect(
      aiDocumentExtractionSchema.safeParse({
        extractedContract: {
          name: "Hauskredit Musterbank",
          interestRateBps: 3.5,
          specialRepaymentRight: "allowed",
        },
      }).success,
    ).toBe(false);

    // Legacy JSON without new fields still parses
    const legacy = parseExtractedContractJson(
      JSON.stringify({ name: "Altkredit", interestRateBps: 300 }),
    );
    expect(legacy?.name).toBe("Altkredit");

    // Verify with applyLoanOptions without linkedContractId is rejected
    expect(
      documentVerifySchema.safeParse({
        documentType: "contract",
        isTaxRelevant: false,
        linkedContractId: null,
        applyLoanOptions: true,
        loanOptions: { specialRepaymentRight: "allowed" },
      }).success,
    ).toBe(false);

    // Verify with applyLoanOptions + linkedContractId + valid loanOptions passes
    const validVerify = documentVerifySchema.parse({
      documentType: "contract",
      isTaxRelevant: false,
      linkedContractId: "loan-1",
      applyLoanOptions: true,
      loanOptions: {
        originalPrincipalCents: 25_000_000,
        specialRepaymentRight: "allowed",
        specialRepaymentBasis: "percent_original",
        specialRepaymentPercentBps: 500,
      },
    });
    expect(validVerify.applyLoanOptions).toBe(true);
    expect(validVerify.loanOptions?.specialRepaymentPercentBps).toBe(500);

    // Invalid specialRepaymentMaxYearlyCents falls back to null while core fields remain intact
    const badMaxYearly = aiDocumentExtractionSchema.parse({
      extractedContract: {
        name: "Hauskredit Musterbank",
        interestRateBps: 350,
        specialRepaymentMaxYearlyCents: "12.500 €",
      },
    });
    expect(badMaxYearly.extractedContract?.name).toBe("Hauskredit Musterbank");
    expect(badMaxYearly.extractedContract?.specialRepaymentMaxYearlyCents).toBeNull();
  });
});
