import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as dbModule from "@/backend/db/connection";
import {
  createContract,
  createProperty,
  getContractById,
  listContracts,
} from "@/backend/db/queries/contracts";
import { getDocumentById } from "@/backend/db/queries/documents";
import * as extractorModule from "@/backend/integrations/gemini-document-extractor";
import { contractCreateSchema } from "@/validation/contracts";
import { POST as analyzeDocument } from "@/app/api/documents/[id]/analyze/route";
import { POST as createContractFromDocumentRoute } from "@/app/api/documents/[id]/create-contract/route";
import { GET as downloadDocumentFile } from "@/app/api/documents/[id]/file/route";
import {
  DELETE as deleteDocument,
  PATCH as patchDocument,
} from "@/app/api/documents/[id]/route";
import { POST as verifyDocument } from "@/app/api/documents/[id]/verify/route";
import { GET as listDocumentsRoute, POST as uploadDocument } from "@/app/api/documents/route";

const SAMPLE_PDF_BYTES = Buffer.from(
  "%PDF-1.4\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF\n",
);

const tempDirs: string[] = [];
const originalDbUrl = process.env.DATABASE_URL;
const originalDocsDir = process.env.DOCUMENTS_DIR;

function makePdfRequest(
  bytes: Buffer = SAMPLE_PDF_BYTES,
  filename = "Jahresauszug_Musterbank_2026.pdf",
): Request {
  const formData = new FormData();
  const file = new File([new Uint8Array(bytes)], filename, {
    type: "application/pdf",
  });
  formData.append("file", file);
  return new Request("http://localhost/api/documents", {
    method: "POST",
    body: formData,
  });
}

beforeEach(() => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "coruscant-docs-api-"));
  tempDirs.push(dir);
  process.env.DATABASE_URL = path.join(dir, "test.db");
  process.env.DOCUMENTS_DIR = path.join(dir, "documents");
});

afterEach(() => {
  vi.restoreAllMocks();
  dbModule.closeDb();
  if (originalDbUrl === undefined) {
    delete process.env.DATABASE_URL;
  } else {
    process.env.DATABASE_URL = originalDbUrl;
  }
  if (originalDocsDir === undefined) {
    delete process.env.DOCUMENTS_DIR;
  } else {
    process.env.DOCUMENTS_DIR = originalDocsDir;
  }
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir && fs.existsSync(dir)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }
});

describe("/api/documents integration", () => {
  it("uploads PDF with mocked AI extraction, streams file, and blocks duplicate uploads", async () => {
    vi.spyOn(
      extractorModule,
      "createDefaultDocumentExtractor",
    ).mockReturnValue({
      extract: async () => ({
        ok: true,
        model: "gemini-2.5-flash",
        data: {
          documentType: "loan_statement",
          documentDate: "2026-03-15",
          issuer: "Musterbank",
          totalAmountCents: null,
          isTaxRelevant: false,
          taxYear: null,
          taxCategory: null,
          deductibleAmountCents: null,
          detectedBalanceCents: 29_500_000,
        },
      }),
    });

    const contract = createContract({
      name: "Musterbank Darlehen",
      provider: "Musterbank",
      category: "loan",
      status: "active",
      currentBalanceCents: 30_000_000,
      balanceAsOfDate: "2026-01-01",
      monthlyRateCents: 150_000,
      interestRateBps: 350,
      linkedPropertyId: null,
      milestoneDate: null,
      milestoneLabel: null,
      repaymentType: "annuity",
      specialRepaymentMaxYearlyCents: null,
      fixedInterestUntil: null,
      targetSumCents: null,
      allocationThresholdPercent: null,
      futureLoanInterestRateBps: null,
      originalPrincipalCents: null,
      specialRepaymentRight: "unknown",
      specialRepaymentBasis: null,
      specialRepaymentPercentBps: null,
      specialRepaymentUsedCents: null,
      specialRepaymentUsedYear: null,
      rateChangeRight: "unknown",
      rateChangeTotalCount: null,
      rateChangeScope: null,
      rateChangeUsedCount: 0,
      rateChangeMinRepaymentBps: null,
      rateChangeMaxRepaymentBps: null,
      rateChangeMinMonthlyCents: null,
      rateChangeMaxMonthlyCents: null,
      loanOptionsNote: null,
    });

    const uploadRes = await uploadDocument(makePdfRequest());
    expect(uploadRes.status).toBe(201);
    const uploadBody = (await uploadRes.json()) as {
      document: {
        id: string;
        status: string;
        storagePath: string;
        detectedBalanceCents: number | null;
      };
      ai: { status: string; model?: string };
    };

    expect(uploadBody.document.status).toBe("pending_review");
    expect(uploadBody.document.storagePath).toMatch(/^2026\/[0-9a-f-]{36}\.pdf$/i);
    expect(uploadBody.document.detectedBalanceCents).toBe(29_500_000);
    expect(uploadBody.ai).toEqual({
      status: "extracted",
      model: "gemini-2.5-flash",
    });

    // Contract remains untouched after upload
    expect(getContractById(contract.id)?.currentBalanceCents).toBe(30_000_000);

    // Physical file exists on disk
    const docsDir = process.env.DOCUMENTS_DIR as string;
    expect(
      fs.existsSync(path.join(docsDir, uploadBody.document.storagePath)),
    ).toBe(true);

    // Duplicate upload returns 409 and does not create a second file
    const dupRes = await uploadDocument(makePdfRequest());
    expect(dupRes.status).toBe(409);
    const dupBody = (await dupRes.json()) as {
      existingDocument: { id: string };
    };
    expect(dupBody.existingDocument.id).toBe(uploadBody.document.id);
    const filesIn2026 = fs.readdirSync(path.join(docsDir, "2026"));
    expect(filesIn2026).toHaveLength(1);

    // Stream file
    const fileRes = await downloadDocumentFile(
      new Request(`http://localhost/api/documents/${uploadBody.document.id}/file`),
      { params: Promise.resolve({ id: uploadBody.document.id }) },
    );
    expect(fileRes.status).toBe(200);
    expect(fileRes.headers.get("Content-Type")).toBe("application/pdf");
    expect(fileRes.headers.get("X-Content-Type-Options")).toBe("nosniff");
    const streamedBytes = Buffer.from(await fileRes.arrayBuffer());
    expect(streamedBytes.equals(SAMPLE_PDF_BYTES)).toBe(true);
  });

  it("stays resilient when AI fails or is not configured", async () => {
    vi.spyOn(
      extractorModule,
      "createDefaultDocumentExtractor",
    ).mockReturnValue({
      extract: async () => ({
        ok: false,
        code: "not_configured",
        message: "GEMINI_API_KEY ist nicht konfiguriert.",
      }),
    });

    const uploadRes = await uploadDocument(
      makePdfRequest(SAMPLE_PDF_BYTES, "Beleg_Offline.pdf"),
    );
    expect(uploadRes.status).toBe(201);
    const body = (await uploadRes.json()) as {
      document: { id: string; status: string; documentType: string };
      ai: { status: string; message?: string };
    };
    expect(body.document.status).toBe("pending_review");
    expect(body.document.documentType).toBe("other");
    expect(body.ai.status).toBe("skipped");

    const listRes = await listDocumentsRoute(
      new Request("http://localhost/api/documents?status=pending_review"),
    );
    expect(listRes.status).toBe(200);
    const listBody = (await listRes.json()) as {
      documents: Array<{ id: string }>;
    };
    expect(listBody.documents.map((d) => d.id)).toContain(body.document.id);
  });

  it("verifies atomically, protects against backdated calibration, blocks analyze on verified, and deletes file + record", async () => {
    vi.spyOn(
      extractorModule,
      "createDefaultDocumentExtractor",
    ).mockReturnValue({
      extract: async () => ({
        ok: false,
        code: "not_configured",
        message: "Kein Key",
      }),
    });

    const contract = createContract({
      name: "Musterbank Darlehen",
      provider: "Musterbank",
      category: "loan",
      status: "active",
      currentBalanceCents: 30_000_000,
      balanceAsOfDate: "2026-02-01",
      monthlyRateCents: 150_000,
      interestRateBps: 350,
      linkedPropertyId: null,
      milestoneDate: null,
      milestoneLabel: null,
      repaymentType: "annuity",
      specialRepaymentMaxYearlyCents: null,
      fixedInterestUntil: null,
      targetSumCents: null,
      allocationThresholdPercent: null,
      futureLoanInterestRateBps: null,
      originalPrincipalCents: null,
      specialRepaymentRight: "unknown",
      specialRepaymentBasis: null,
      specialRepaymentPercentBps: null,
      specialRepaymentUsedCents: null,
      specialRepaymentUsedYear: null,
      rateChangeRight: "unknown",
      rateChangeTotalCount: null,
      rateChangeScope: null,
      rateChangeUsedCount: 0,
      rateChangeMinRepaymentBps: null,
      rateChangeMaxRepaymentBps: null,
      rateChangeMinMonthlyCents: null,
      rateChangeMaxMonthlyCents: null,
      loanOptionsNote: null,
    });

    const uploadRes = await uploadDocument(makePdfRequest());
    const { document: doc } = (await uploadRes.json()) as {
      document: { id: string; storagePath: string };
    };

    // 1. Older calibration date without allowOlderCalibrationDate -> 409 Conflict
    const conflictRes = await verifyDocument(
      new Request(`http://localhost/api/documents/${doc.id}/verify`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          documentType: "loan_statement",
          documentDate: "2026-01-15",
          issuer: "Musterbank",
          linkedContractId: contract.id,
          isTaxRelevant: false,
          detectedBalanceCents: 29_500_000,
          calibrateContract: true,
          calibratedBalanceCents: 29_500_000,
          calibrationDate: "2026-01-15",
          allowOlderCalibrationDate: false,
        }),
      }),
      { params: Promise.resolve({ id: doc.id }) },
    );
    expect(conflictRes.status).toBe(409);
    // Contract and document remain unchanged
    expect(getContractById(contract.id)?.currentBalanceCents).toBe(30_000_000);

    // 2. Newer calibration date -> 200 and updates contract atomically
    const verifyRes = await verifyDocument(
      new Request(`http://localhost/api/documents/${doc.id}/verify`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          documentType: "loan_statement",
          documentDate: "2026-03-01",
          issuer: "Musterbank",
          linkedContractId: contract.id,
          isTaxRelevant: false,
          detectedBalanceCents: 29_500_000,
          calibrateContract: true,
          calibratedBalanceCents: 29_500_000,
          calibrationDate: "2026-03-01",
        }),
      }),
      { params: Promise.resolve({ id: doc.id }) },
    );
    expect(verifyRes.status).toBe(200);
    const verifyBody = (await verifyRes.clone().json()) as Record<string, unknown>;
    const returnedContract = (verifyBody.calibratedContract ?? verifyBody.contract) as
      | Record<string, unknown>
      | undefined;
    expect(returnedContract).toBeDefined();
    expect("sphere" in returnedContract!).toBe(false);
    const updatedContract = getContractById(contract.id);
    expect(updatedContract?.currentBalanceCents).toBe(29_500_000);
    expect(updatedContract?.balanceAsOfDate).toBe("2026-03-01");

    // 3. Re-analyzing a verified document is blocked with 409
    const analyzeRes = await analyzeDocument(
      new Request(`http://localhost/api/documents/${doc.id}/analyze`, {
        method: "POST",
      }),
      { params: Promise.resolve({ id: doc.id }) },
    );
    expect(analyzeRes.status).toBe(409);

    // 4. PATCH updates metadata without mutating contract
    const patchRes = await patchDocument(
      new Request(`http://localhost/api/documents/${doc.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ issuer: "Musterbank AG" }),
      }),
      { params: Promise.resolve({ id: doc.id }) },
    );
    expect(patchRes.status).toBe(200);
    expect(getContractById(contract.id)?.currentBalanceCents).toBe(29_500_000);

    // 5. DELETE removes DB record and PDF file
    const deleteRes = await deleteDocument(
      new Request(`http://localhost/api/documents/${doc.id}`, {
        method: "DELETE",
      }),
      { params: Promise.resolve({ id: doc.id }) },
    );
    expect(deleteRes.status).toBe(200);
    const docsDir = process.env.DOCUMENTS_DIR as string;
    expect(fs.existsSync(path.join(docsDir, doc.storagePath))).toBe(false);
  });

  it("falls back to current year when AI returns a documentDate outside 1900..2100", async () => {
    vi.spyOn(
      extractorModule,
      "createDefaultDocumentExtractor",
    ).mockReturnValue({
      extract: async () => ({
        ok: true,
        model: "gemini-2.5-flash",
        data: {
          documentType: "invoice",
          documentDate: "0025-11-10",
          issuer: "Musterbetrieb GmbH",
          totalAmountCents: 50_000,
          isTaxRelevant: false,
          taxYear: null,
          taxCategory: null,
          deductibleAmountCents: null,
          detectedBalanceCents: null,
        },
      }),
    });

    const uploadRes = await uploadDocument(
      makePdfRequest(SAMPLE_PDF_BYTES, "OCR_Datum_Fehler.pdf"),
    );
    expect(uploadRes.status).toBe(201);
    const body = (await uploadRes.json()) as {
      document: { storagePath: string };
    };
    const currentYearPrefix = `${new Date().getFullYear()}/`;
    expect(body.document.storagePath.startsWith(currentYearPrefix)).toBe(true);
  });

  it("re-analyzes pending documents and returns 409 if verified concurrently during extraction", async () => {
    let resolveInFlight!: (
      value: Awaited<
        ReturnType<
          ReturnType<typeof extractorModule.createDefaultDocumentExtractor>["extract"]
        >
      >,
    ) => void;

    const extractSpy = vi.spyOn(
      extractorModule,
      "createDefaultDocumentExtractor",
    );

    // Initial upload without AI
    extractSpy.mockReturnValueOnce({
      extract: async () => ({
        ok: false,
        code: "not_configured",
        message: "Kein Key",
      }),
    });

    const uploadRes = await uploadDocument(
      makePdfRequest(SAMPLE_PDF_BYTES, "Reanalyse_Test.pdf"),
    );
    expect(uploadRes.status).toBe(201);
    const { document: doc } = (await uploadRes.json()) as {
      document: { id: string };
    };

    // 1. Successful re-analyze on pending_review
    extractSpy.mockReturnValueOnce({
      extract: async () => ({
        ok: true,
        model: "gemini-2.5-flash",
        data: {
          documentType: "invoice",
          documentDate: "2026-04-10",
          issuer: "Musterbetrieb GmbH",
          totalAmountCents: 75_000,
          isTaxRelevant: true,
          taxYear: 2026,
          taxCategory: "handwerker_35a",
          deductibleAmountCents: 50_000,
          detectedBalanceCents: null,
        },
      }),
    });

    const analyzeOkRes = await analyzeDocument(
      new Request(`http://localhost/api/documents/${doc.id}/analyze`, {
        method: "POST",
      }),
      { params: Promise.resolve({ id: doc.id }) },
    );
    expect(analyzeOkRes.status).toBe(200);
    const analyzeOkBody = (await analyzeOkRes.json()) as {
      document: { issuer: string | null; totalAmountCents: number | null };
      ai: { status: string; model?: string };
    };
    expect(analyzeOkBody.ai).toEqual({
      status: "extracted",
      model: "gemini-2.5-flash",
    });
    expect(analyzeOkBody.document.issuer).toBe("Musterbetrieb GmbH");
    expect(analyzeOkBody.document.totalAmountCents).toBe(75_000);

    // 2. Concurrent verification while analyze is in-flight -> 409 without overwriting
    extractSpy.mockReturnValueOnce({
      extract: () =>
        new Promise((resolve) => {
          resolveInFlight = resolve;
        }),
    });

    const inFlightPromise = analyzeDocument(
      new Request(`http://localhost/api/documents/${doc.id}/analyze`, {
        method: "POST",
      }),
      { params: Promise.resolve({ id: doc.id }) },
    );

    // Wait a tick so extract() has started, then verify concurrently
    await Promise.resolve();
    const verifyRes = await verifyDocument(
      new Request(`http://localhost/api/documents/${doc.id}/verify`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          documentType: "invoice",
          documentDate: "2026-04-10",
          issuer: "Manuell Geprüft GmbH",
          totalAmountCents: 80_000,
          isTaxRelevant: false,
        }),
      }),
      { params: Promise.resolve({ id: doc.id }) },
    );
    expect(verifyRes.status).toBe(200);

    resolveInFlight({
      ok: true,
      model: "gemini-2.5-flash",
      data: {
        documentType: "other",
        documentDate: null,
        issuer: "Überschreiber AG",
        totalAmountCents: 100,
        isTaxRelevant: false,
        taxYear: null,
        taxCategory: null,
        deductibleAmountCents: null,
        detectedBalanceCents: null,
      },
    });

    const raceRes = await inFlightPromise;
    expect(raceRes.status).toBe(409);

    // Verified issuer must still be "Manuell Geprüft GmbH"
    const listRes = await listDocumentsRoute(
      new Request("http://localhost/api/documents?status=verified"),
    );
    const listBody = (await listRes.json()) as {
      documents: Array<{ id: string; issuer: string | null }>;
    };
    expect(listBody.documents.find((d) => d.id === doc.id)?.issuer).toBe(
      "Manuell Geprüft GmbH",
    );
  });

  it("streams PDFs whose filenames contain non-ASCII characters (> U+00FF) with RFC 5987 Content-Disposition", async () => {
    vi.spyOn(
      extractorModule,
      "createDefaultDocumentExtractor",
    ).mockReturnValue({
      extract: async () => ({
        ok: false,
        code: "not_configured",
        message: "Kein Key",
      }),
    });

    const unicodeFilename = "Rechnung – Musterbetrieb €.pdf";
    const uploadRes = await uploadDocument(
      makePdfRequest(SAMPLE_PDF_BYTES, unicodeFilename),
    );
    expect(uploadRes.status).toBe(201);
    const { document: doc } = (await uploadRes.json()) as {
      document: { id: string; filename: string };
    };

    const fileRes = await downloadDocumentFile(
      new Request(`http://localhost/api/documents/${doc.id}/file`),
      { params: Promise.resolve({ id: doc.id }) },
    );
    expect(fileRes.status).toBe(200);
    const disposition = fileRes.headers.get("Content-Disposition") ?? "";
    expect(disposition).toContain('filename="Rechnung _ Musterbetrieb _.pdf"');
    expect(disposition).toContain(
      `filename*=UTF-8''${encodeURIComponent(unicodeFilename)}`,
    );
  });

  it("persists extractedContractJson on upload and updates it on analyze", async () => {
    const extractSpy = vi
      .spyOn(extractorModule, "createDefaultDocumentExtractor")
      .mockReturnValue({
        extract: async () => ({
          ok: true,
          model: "gemini-2.5-flash",
          data: {
            documentType: "contract",
            documentDate: "2026-02-01",
            issuer: "Musterbank AG",
            totalAmountCents: null,
            isTaxRelevant: false,
            taxYear: null,
            taxCategory: null,
            deductibleAmountCents: null,
            detectedBalanceCents: 29_500_000,
            extractedContract: {
              name: "Hauskredit Musterstraße 1",
              provider: "Musterbank AG",
              category: "loan",
              currentBalanceCents: 29_500_000,
              balanceAsOfDate: "2026-02-01",
              monthlyRateCents: 140_000,
              interestRateBps: 345,
            },
          },
        }),
      });

    const uploadRes = await uploadDocument(
      makePdfRequest(SAMPLE_PDF_BYTES, "Kreditvertrag_Musterbank.pdf"),
    );
    expect(uploadRes.status).toBe(201);
    const uploadBody = (await uploadRes.json()) as {
      document: { id: string; extractedContractJson: string | null };
    };
    expect(uploadBody.document.extractedContractJson).toBeTruthy();
    expect(JSON.parse(uploadBody.document.extractedContractJson!)).toMatchObject(
      {
        name: "Hauskredit Musterstraße 1",
        interestRateBps: 345,
      },
    );

    extractSpy.mockReturnValue({
      extract: async () => ({
        ok: true,
        model: "gemini-2.5-flash",
        data: {
          documentType: "contract",
          documentDate: "2026-02-15",
          issuer: "Musterbank AG",
          totalAmountCents: null,
          isTaxRelevant: false,
          taxYear: null,
          taxCategory: null,
          deductibleAmountCents: null,
          detectedBalanceCents: 29_400_000,
          extractedContract: {
            name: "Hauskredit Musterstraße 1 (Aktualisiert)",
            interestRateBps: 355,
          },
        },
      }),
    });

    const analyzeRes = await analyzeDocument(
      new Request(
        `http://localhost/api/documents/${uploadBody.document.id}/analyze`,
        { method: "POST" },
      ),
      { params: Promise.resolve({ id: uploadBody.document.id }) },
    );
    expect(analyzeRes.status).toBe(200);
    const analyzeBody = (await analyzeRes.json()) as {
      document: { extractedContractJson: string | null };
    };
    expect(
      JSON.parse(analyzeBody.document.extractedContractJson!),
    ).toMatchObject({
      name: "Hauskredit Musterstraße 1 (Aktualisiert)",
      interestRateBps: 355,
    });
  });

  it("creates loan contract + verifies document atomically and supports 1:N follow-up verify", async () => {
    vi.spyOn(
      extractorModule,
      "createDefaultDocumentExtractor",
    ).mockReturnValue({
      extract: async () => ({
        ok: false,
        code: "not_configured",
        message: "Kein Key",
      }),
    });

    const property = createProperty({
      name: "Immobilie #0 (Musterstraße 1)",
      usage: "owner_occupied",
      purchaseDate: "2024-01-01",
      purchasePriceCents: 45_000_000,
      estimatedValueCents: 48_000_000,
    });

    const firstUpload = await uploadDocument(
      makePdfRequest(
        Buffer.from("%PDF-1.4\n%contract-1\n%%EOF"),
        "Darlehensvertrag_Musterbank.pdf",
      ),
    );
    expect(firstUpload.status).toBe(201);
    const { document: doc1 } = (await firstUpload.json()) as {
      document: { id: string };
    };

    const createRes = await createContractFromDocumentRoute(
      new Request(`http://localhost/api/documents/${doc1.id}/create-contract`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contract: {
            name: "Hauskredit Musterstraße 1",
            provider: "Musterbank AG",
            category: "loan",
            status: "active",
            currentBalanceCents: 29_500_000,
            balanceAsOfDate: "2026-02-01",
            monthlyRateCents: 140_000,
            interestRateBps: 345,
            linkedPropertyId: property.id,
            repaymentType: "annuity",
            fixedInterestUntil: "2036-02-01",
          },
          document: {
            documentType: "contract",
            documentDate: "2026-02-01",
            issuer: "Musterbank AG",
            linkedPropertyId: property.id,
            isTaxRelevant: false,
          },
        }),
      }),
      { params: Promise.resolve({ id: doc1.id }) },
    );

    expect(createRes.status).toBe(201);
    const createdBody = (await createRes.clone().json()) as {
      contract: {
        id: string;
        linkedPropertyId: string | null;
        interestRateBps: number;
        currentBalanceCents: number;
      };
      document: {
        id: string;
        status: string;
        linkedContractId: string | null;
        linkedPropertyId: string | null;
      };
    };

    expect("sphere" in createdBody.contract).toBe(false);
    expect(createdBody.contract.linkedPropertyId).toBe(property.id);
    expect(createdBody.contract.interestRateBps).toBe(345);
    expect(createdBody.contract.currentBalanceCents).toBe(29_500_000);
    expect(createdBody.document.status).toBe("verified");
    expect(createdBody.document.linkedContractId).toBe(createdBody.contract.id);
    expect(createdBody.document.linkedPropertyId).toBe(property.id);

    // 1:N follow-up PDF can still be verified against the newly created contract
    const secondUpload = await uploadDocument(
      makePdfRequest(
        Buffer.from("%PDF-1.4\n%statement-2\n%%EOF"),
        "Jahreskontoauszug_Musterbank.pdf",
      ),
    );
    expect(secondUpload.status).toBe(201);
    const { document: doc2 } = (await secondUpload.json()) as {
      document: { id: string };
    };

    const verifySecond = await verifyDocument(
      new Request(`http://localhost/api/documents/${doc2.id}/verify`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          documentType: "loan_statement",
          documentDate: "2026-12-31",
          issuer: "Musterbank AG",
          linkedPropertyId: property.id,
          linkedContractId: createdBody.contract.id,
          isTaxRelevant: false,
          calibrateContract: false,
        }),
      }),
      { params: Promise.resolve({ id: doc2.id }) },
    );
    expect(verifySecond.status).toBe(200);

    // Duplicate create-contract on already linked doc1 -> 409
    const duplicateLinkRes = await createContractFromDocumentRoute(
      new Request(`http://localhost/api/documents/${doc1.id}/create-contract`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contract: {
            name: "Doppelter Vertrag",
            category: "loan",
            currentBalanceCents: 100_000,
            balanceAsOfDate: "2026-02-01",
          },
        }),
      }),
      { params: Promise.resolve({ id: doc1.id }) },
    );
    expect(duplicateLinkRes.status).toBe(409);
  });

  it("creates savings_contract with document tax tagging and rolls back atomically on invalid linkedPropertyId", async () => {
    vi.spyOn(
      extractorModule,
      "createDefaultDocumentExtractor",
    ).mockReturnValue({
      extract: async () => ({
        ok: false,
        code: "not_configured",
        message: "Kein Key",
      }),
    });

    const upload1 = await uploadDocument(
      makePdfRequest(
        Buffer.from("%PDF-1.4\n%bauspar-1\n%%EOF"),
        "Bausparvertrag_Musterkasse.pdf",
      ),
    );
    const { document: doc1 } = (await upload1.json()) as {
      document: { id: string };
    };

    const savingsRes = await createContractFromDocumentRoute(
      new Request(`http://localhost/api/documents/${doc1.id}/create-contract`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contract: {
            name: "Bausparvertrag Tarif Klassik",
            provider: "Muster-Bausparkasse",
            category: "savings_contract",
            currentBalanceCents: 1_250_000,
            balanceAsOfDate: "2026-03-01",
            monthlyRateCents: 25_000,
            interestRateBps: 50,
            targetSumCents: 5_000_000,
            allocationThresholdPercent: 40,
            futureLoanInterestRateBps: 250,
          },
          document: {
            documentType: "bauspar_statement",
            documentDate: "2026-03-01",
            issuer: "Muster-Bausparkasse",
            totalAmountCents: 10_000,
            isTaxRelevant: true,
            taxCategory: "capital_gains",
            deductibleAmountCents: 5_000,
          },
        }),
      }),
      { params: Promise.resolve({ id: doc1.id }) },
    );
    expect(savingsRes.status).toBe(201);
    const savingsBody = (await savingsRes.json()) as {
      contract: { category: string; allocationThresholdPercent: number | null };
      document: {
        isTaxRelevant: boolean;
        taxYear: number | null;
        taxCategory: string | null;
        deductibleAmountCents: number | null;
      };
    };
    expect(savingsBody.contract.category).toBe("savings_contract");
    expect(savingsBody.contract.allocationThresholdPercent).toBe(40);
    expect(savingsBody.document.isTaxRelevant).toBe(true);
    expect(savingsBody.document.taxYear).toBe(2026);
    expect(savingsBody.document.taxCategory).toBe("capital_gains");
    expect(savingsBody.document.deductibleAmountCents).toBe(5_000);

    // Atomic rollback test
    const upload2 = await uploadDocument(
      makePdfRequest(
        Buffer.from("%PDF-1.4\n%rollback-2\n%%EOF"),
        "Rollback_Test.pdf",
      ),
    );
    const { document: doc2 } = (await upload2.json()) as {
      document: { id: string };
    };
    const contractsBefore = listContracts().length;

    const rollbackRes = await createContractFromDocumentRoute(
      new Request(`http://localhost/api/documents/${doc2.id}/create-contract`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contract: {
            name: "Ungültige Immobilie",
            category: "loan",
            currentBalanceCents: 500_000,
            balanceAsOfDate: "2026-03-01",
            linkedPropertyId: "non-existent-property-id",
          },
        }),
      }),
      { params: Promise.resolve({ id: doc2.id }) },
    );
    expect(rollbackRes.status).toBe(400);
    expect(listContracts().length).toBe(contractsBefore);
    expect(getDocumentById(doc2.id)?.status).toBe("pending_review");
    expect(getDocumentById(doc2.id)?.linkedContractId).toBeNull();

    // Negative cases: 404 unknown doc, 400 invalid cent/bps values
    const notFoundRes = await createContractFromDocumentRoute(
      new Request("http://localhost/api/documents/missing-id/create-contract", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contract: {
            name: "Test",
            category: "loan",
            currentBalanceCents: 100_000,
            balanceAsOfDate: "2026-03-01",
          },
        }),
      }),
      { params: Promise.resolve({ id: "missing-id" }) },
    );
    expect(notFoundRes.status).toBe(404);

    const invalidUnitsRes = await createContractFromDocumentRoute(
      new Request(`http://localhost/api/documents/${doc2.id}/create-contract`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contract: {
            name: "Float Test",
            category: "loan",
            currentBalanceCents: 123.45,
            balanceAsOfDate: "2026-03-01",
            interestRateBps: 3.45,
          },
        }),
      }),
      { params: Promise.resolve({ id: doc2.id }) },
    );
    expect(invalidUnitsRes.status).toBe(400);
  });

  it("applies non-null loanOptions during verify in the same transaction without touching usage, and rolls back calibration on 422", async () => {
    vi.spyOn(
      extractorModule,
      "createDefaultDocumentExtractor",
    ).mockReturnValue({
      extract: async () => ({
        ok: false,
        code: "not_configured",
        message: "Kein Key",
      }),
    });

    const loan = createContract(
      contractCreateSchema.parse({
        name: "Hauskredit Musterstraße 1",
        category: "loan",
        currentBalanceCents: 20_000_000,
        balanceAsOfDate: "2026-01-01",
        monthlyRateCents: 110_000,
        interestRateBps: 350,
        repaymentType: "annuity",
        originalPrincipalCents: 24_000_000,
        specialRepaymentUsedCents: 200_000,
        specialRepaymentUsedYear: 2026,
        rateChangeRight: "allowed",
        rateChangeTotalCount: 2,
        rateChangeUsedCount: 1,
        rateChangeMinMonthlyCents: 80_000,
        rateChangeMaxMonthlyCents: 120_000,
      }),
    );

    const upload1 = await uploadDocument(
      makePdfRequest(
        Buffer.from("%PDF-1.4\n%verify-rollback\n%%EOF"),
        "Darlehen_Konflikt.pdf",
      ),
    );
    const { document: doc1 } = (await upload1.json()) as {
      document: { id: string };
    };

    // Conflict: calibrate + applyLoanOptions with bps corridor (160k..180k) that has empty intersection with existing 80k..120k
    const conflictRes = await verifyDocument(
      new Request(`http://localhost/api/documents/${doc1.id}/verify`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          documentType: "contract",
          documentDate: "2026-06-01",
          isTaxRelevant: false,
          linkedContractId: loan.id,
          calibrateContract: true,
          calibratedBalanceCents: 19_000_000,
          calibrationDate: "2026-06-01",
          applyLoanOptions: true,
          loanOptions: {
            rateChangeRight: "allowed",
            rateChangeMinRepaymentBps: 500,
            rateChangeMaxRepaymentBps: 600,
          },
        }),
      }),
      { params: Promise.resolve({ id: doc1.id }) },
    );
    expect(conflictRes.status).toBe(422);

    // Entire transaction rolled back (calibration AND document status!)
    const loanAfterConflict = getContractById(loan.id)!;
    expect(loanAfterConflict.currentBalanceCents).toBe(20_000_000);
    expect(loanAfterConflict.balanceAsOfDate).toBe("2026-01-01");
    expect(getDocumentById(doc1.id)?.status).toBe("pending_review");

    // Valid verify with calibrate + applyLoanOptions updates only non-null fields and preserves usage
    const okRes = await verifyDocument(
      new Request(`http://localhost/api/documents/${doc1.id}/verify`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          documentType: "contract",
          documentDate: "2026-06-01",
          isTaxRelevant: false,
          linkedContractId: loan.id,
          calibrateContract: true,
          calibratedBalanceCents: 19_000_000,
          calibrationDate: "2026-06-01",
          applyLoanOptions: true,
          loanOptions: {
            specialRepaymentRight: "allowed",
            specialRepaymentBasis: "percent_original",
            specialRepaymentPercentBps: 500,
          },
        }),
      }),
      { params: Promise.resolve({ id: doc1.id }) },
    );
    expect(okRes.status).toBe(200);

    const loanAfterOk = getContractById(loan.id)!;
    expect(loanAfterOk.currentBalanceCents).toBe(19_000_000);
    expect(loanAfterOk.originalPrincipalCents).toBe(24_000_000); // preserved
    expect(loanAfterOk.specialRepaymentRight).toBe("allowed");
    expect(loanAfterOk.specialRepaymentBasis).toBe("percent_original");
    expect(loanAfterOk.specialRepaymentPercentBps).toBe(500);
    expect(loanAfterOk.specialRepaymentUsedCents).toBe(200_000); // usage untouched
    expect(loanAfterOk.rateChangeUsedCount).toBe(1); // usage untouched
    expect(getDocumentById(doc1.id)?.status).toBe("verified");
  });
});
