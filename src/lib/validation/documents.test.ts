import { describe, expect, it } from "vitest";
import {
  aiDocumentExtractionSchema,
  documentMetadataSchema,
  documentUpdateSchema,
  documentVerifySchema,
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
