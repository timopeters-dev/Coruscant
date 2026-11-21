import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { FinancialContractRow } from "@/backend/db/queries/contracts";
import type { DocumentRow } from "@/backend/db/queries/documents";
import { DocumentReviewPanel } from "@/frontend/dokumente/document-review-panel";

const DEFAULT_LOAN_OPTION_COLUMNS = {
  originalPrincipalCents: null,
  specialRepaymentRight: "unknown" as const,
  specialRepaymentBasis: null,
  specialRepaymentPercentBps: null,
  specialRepaymentUsedCents: null,
  specialRepaymentUsedYear: null,
  rateChangeRight: "unknown" as const,
  rateChangeTotalCount: null,
  rateChangeScope: null,
  rateChangeUsedCount: 0,
  rateChangeMinRepaymentBps: null,
  rateChangeMaxRepaymentBps: null,
  rateChangeMinMonthlyCents: null,
  rateChangeMaxMonthlyCents: null,
  loanOptionsNote: null,
};

function makeContract(
  overrides: Partial<FinancialContractRow> = {},
): FinancialContractRow {
  return {
    id: "loan-1",
    name: "Hauskredit Musterstraße 1",
    provider: "Musterbank",
    category: "loan",
    status: "active",
    currentBalanceCents: 20_000_000,
    balanceAsOfDate: "2026-01-01",
    monthlyRateCents: 110_000,
    interestRateBps: 380,
    linkedPropertyId: null,
    milestoneDate: null,
    milestoneLabel: null,
    repaymentType: "annuity",
    specialRepaymentMaxYearlyCents: null,
    fixedInterestUntil: "2036-01-01",
    targetSumCents: null,
    allocationThresholdPercent: null,
    futureLoanInterestRateBps: null,
    ...DEFAULT_LOAN_OPTION_COLUMNS,
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function makeDoc(
  extractedContract: Record<string, unknown> | null,
  linkedContractId: string | null = "loan-1",
): DocumentRow {
  return {
    id: "doc-1",
    filename: "darlehensvertrag-muster.pdf",
    storagePath: "data/documents/doc-1.pdf",
    sha256Hash: "0".repeat(64),
    status: "pending_review",
    documentType: "contract",
    documentDate: "2026-11-01",
    issuer: "Musterbank",
    totalAmountCents: null,
    linkedContractId,
    linkedPropertyId: null,
    isTaxRelevant: false,
    taxYear: null,
    taxCategory: null,
    deductibleAmountCents: null,
    detectedBalanceCents: 19_500_000,
    extractedContractJson: extractedContract ? JSON.stringify(extractedContract) : null,
    createdAt: "2026-11-19T10:00:00.000Z",
  };
}

describe("DocumentReviewPanel loan options opt-in checkbox & diff", () => {
  it("shows opt-in checkbox and only changed fields in diff for a loan with extracted option fields", () => {
    const existingLoan = makeContract({
      originalPrincipalCents: 25_000_000, // identical to extraction -> must NOT appear in diff
      specialRepaymentRight: "unknown", // differs from extracted "allowed" -> MUST appear
    });
    const doc = makeDoc({
      name: "Hauskredit Musterstraße 1",
      provider: "Musterbank",
      category: "loan",
      originalPrincipalCents: 25_000_000,
      specialRepaymentRight: "allowed",
      specialRepaymentBasis: "percent_original",
      specialRepaymentPercentBps: 500,
    });

    const html = renderToStaticMarkup(
      <DocumentReviewPanel
        pendingDocuments={[doc]}
        selectedDocId="doc-1"
        onSelectDoc={() => {}}
        properties={[]}
        contracts={[existingLoan]}
        todayIsoDate="2026-11-19"
        onMutated={() => {}}
      />,
    );

    expect(html).toContain("Darlehensoptionen übernehmen");
    // Changed fields appear with "→"
    expect(html).toContain("Sondertilgungsrecht");
    expect(html).toContain("→");
    expect(html).toContain("5,00 %");
    // Unchanged originalPrincipalCents must NOT be listed in diff
    expect(html).not.toContain("Ursprungsbetrag:");
  });

  it("hides opt-in checkbox when linked contract is a savings contract or no option fields extracted", () => {
    const savingsContract = makeContract({
      id: "sav-1",
      name: "Bausparvertrag Musterbank",
      category: "savings_contract",
      repaymentType: null,
      targetSumCents: 5_000_000,
    });
    const docWithOptsForSavings = makeDoc(
      {
        name: "Bausparvertrag Musterbank",
        specialRepaymentRight: "allowed",
        specialRepaymentMaxYearlyCents: 500_000,
      },
      "sav-1",
    );

    const savingsHtml = renderToStaticMarkup(
      <DocumentReviewPanel
        pendingDocuments={[docWithOptsForSavings]}
        selectedDocId="doc-1"
        onSelectDoc={() => {}}
        properties={[]}
        contracts={[savingsContract]}
        todayIsoDate="2026-11-19"
        onMutated={() => {}}
      />,
    );
    expect(savingsHtml).not.toContain("Darlehensoptionen übernehmen");

    const docWithoutOpts = makeDoc({
      name: "Hauskredit Musterstraße 1",
      provider: "Musterbank",
      category: "loan",
    });
    const noOptsHtml = renderToStaticMarkup(
      <DocumentReviewPanel
        pendingDocuments={[docWithoutOpts]}
        selectedDocId="doc-1"
        onSelectDoc={() => {}}
        properties={[]}
        contracts={[makeContract()]}
        todayIsoDate="2026-11-19"
        onMutated={() => {}}
      />,
    );
    expect(noOptsHtml).not.toContain("Darlehensoptionen übernehmen");
  });
});
