import { describe, expect, it } from "vitest";
import { withTempDatabase } from "@tests/helpers/temp-db";
import { ZodError } from "zod";
import { createContract, updateContract } from "@/backend/db/queries/contracts";
import { createDocumentRecord, DocumentValidationError } from "@/backend/db/queries/documents";
import { verifyDocumentAndOptionallyCalibrate } from "@/backend/db/queries/document-review";
import { contractCreateSchema } from "@/validation/contracts";
import { documentVerifySchema } from "@/validation/documents";

withTempDatabase();

const savingsInput = {
  name: "Bausparvertrag Musterkasse",
  provider: "Musterkasse",
  category: "savings_contract" as const,
  status: "active" as const,
  currentBalanceCents: -120_000,
  balanceAsOfDate: "2026-01-01",
  monthlyRateCents: 20_000,
  interestRateBps: 10,
  targetSumCents: 5_000_000,
};

function makeDocument(sha: string) {
  return createDocumentRecord({
    filename: "Musterkasse_Auszug.pdf",
    storagePath: `x/${sha}.pdf`,
    sha256Hash: sha,
    documentType: "bauspar_statement",
  });
}

describe("Bausparvertrag mit negativem Saldo (Abschlussgebühr) – DB", () => {
  it("legt einen Bausparvertrag mit negativem Startsaldo an", () => {
    const created = createContract(contractCreateSchema.parse(savingsInput));
    expect(created.currentBalanceCents).toBe(-120_000);
  });

  it("lehnt einen Wechsel zu Darlehen ab, solange der Saldo negativ ist", () => {
    const created = createContract(contractCreateSchema.parse(savingsInput));
    expect(() =>
      updateContract(created.id, {
        category: "loan",
        repaymentType: "annuity",
      }),
    ).toThrow(ZodError);
  });

  it("eicht einen Bausparvertrag auf einen negativen Auszugsstand", () => {
    const created = createContract(
      contractCreateSchema.parse({ ...savingsInput, currentBalanceCents: 0 }),
    );
    const doc = makeDocument("hash-neg-sav");
    const result = verifyDocumentAndOptionallyCalibrate(
      doc.id,
      documentVerifySchema.parse({
        documentType: "bauspar_statement",
        documentDate: "2026-02-01",
        isTaxRelevant: false,
        linkedContractId: created.id,
        detectedBalanceCents: -80_000,
        calibrateContract: true,
      }),
      "2026-02-15",
    );
    expect(result.calibratedContract?.currentBalanceCents).toBe(-80_000);
    expect(result.calibratedContract?.balanceAsOfDate).toBe("2026-02-01");
  });

  it("lehnt eine negative Eichung bei Darlehen mit Feldfehler ab", () => {
    const loan = createContract(
      contractCreateSchema.parse({
        ...savingsInput,
        name: "Hauskredit Musterbank",
        category: "loan",
        currentBalanceCents: 10_000_000,
        repaymentType: "annuity",
        targetSumCents: null,
      }),
    );
    const doc = makeDocument("hash-neg-loan");
    expect(() =>
      verifyDocumentAndOptionallyCalibrate(
        doc.id,
        documentVerifySchema.parse({
          documentType: "loan_statement",
          documentDate: "2026-02-01",
          isTaxRelevant: false,
          linkedContractId: loan.id,
          detectedBalanceCents: -1,
          calibrateContract: true,
        }),
        "2026-02-15",
      ),
    ).toThrow(DocumentValidationError);
  });
});
