import { NextResponse } from "next/server";
import {
  createDocumentRecord,
  DocumentLinkedEntityNotFoundError,
  DuplicateDocumentError,
  listDocuments,
  getDocumentBySha256,
} from "@/db/queries/documents";
import {
  badRequestResponse,
  internalErrorResponse,
} from "@/lib/api/http";
import { getTodayIsoDate } from "@/lib/domain/date";
import { createDefaultDocumentExtractor } from "@/lib/integrations/gemini-document-extractor";
import {
  computeSha256Hex,
  deletePdfFileIfExists,
  InvalidPdfError,
  PdfTooLargeError,
  sanitizeOriginalFilename,
  savePdfFile,
  validatePdfBuffer,
} from "@/lib/storage/pdf-storage";
import { documentStatusSchema } from "@/lib/validation/documents";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const statusParam = searchParams.get("status");
    const taxYearParam = searchParams.get("taxYear");
    const propertyIdParam = searchParams.get("propertyId");
    const contractIdParam = searchParams.get("contractId");
    const onlyTaxRelevantParam = searchParams.get("onlyTaxRelevant");

    let status: "pending_review" | "verified" | undefined;
    if (statusParam !== null && statusParam !== "") {
      const parsedStatus = documentStatusSchema.safeParse(statusParam);
      if (!parsedStatus.success) {
        return badRequestResponse("Ungültiger Status-Filter.");
      }
      status = parsedStatus.data;
    }

    let taxYear: number | undefined;
    if (taxYearParam !== null && taxYearParam !== "") {
      const parsedYear = Number(taxYearParam);
      if (
        !Number.isInteger(parsedYear) ||
        parsedYear < 1900 ||
        parsedYear > 2100
      ) {
        return badRequestResponse("Ungültiges Steuerjahr.");
      }
      taxYear = parsedYear;
    }

    const rows = listDocuments({
      status,
      taxYear,
      propertyId: propertyIdParam || undefined,
      contractId: contractIdParam || undefined,
      onlyTaxRelevant: onlyTaxRelevantParam === "true",
    });

    return NextResponse.json({ documents: rows }, { status: 200 });
  } catch (error) {
    console.error("GET /api/documents failed:", error);
    return internalErrorResponse();
  }
}

export async function POST(request: Request) {
  try {
    let formData: FormData;
    try {
      formData = await request.formData();
    } catch {
      return badRequestResponse("Ungültige Multipart-Anfrage.");
    }

    const fileEntry = formData.get("file");
    if (
      !fileEntry ||
      typeof fileEntry !== "object" ||
      typeof (fileEntry as Blob).arrayBuffer !== "function"
    ) {
      return badRequestResponse(
        "Bitte eine PDF-Datei über das Feld 'file' hochladen.",
      );
    }

    const blob = fileEntry as Blob & { name?: string };
    const buffer = Buffer.from(await blob.arrayBuffer());

    try {
      validatePdfBuffer(buffer);
    } catch (error) {
      if (error instanceof PdfTooLargeError) {
        return NextResponse.json({ error: error.message }, { status: 413 });
      }
      if (error instanceof InvalidPdfError) {
        return badRequestResponse(error.message);
      }
      throw error;
    }

    const sha256Hash = computeSha256Hex(buffer);
    const existing = getDocumentBySha256(sha256Hash);
    if (existing) {
      return NextResponse.json(
        {
          error: `Dieses PDF wurde bereits hochgeladen (${existing.filename}).`,
          existingDocument: existing,
        },
        { status: 409 },
      );
    }

    const rawName =
      typeof blob.name === "string" && blob.name.trim().length > 0
        ? blob.name
        : "dokument.pdf";
    const filename = sanitizeOriginalFilename(rawName);

    const extractor = createDefaultDocumentExtractor();
    const extraction = await extractor.extract({
      filename,
      mimeType: "application/pdf",
      pdfBase64: buffer.toString("base64"),
    });

    const aiStatus = extraction.ok
      ? { status: "extracted" as const, model: extraction.model }
      : extraction.code === "not_configured"
        ? { status: "skipped" as const, message: extraction.message }
        : { status: "failed" as const, message: extraction.message };

    const extractedData = extraction.ok ? extraction.data : null;
    const currentYear = Number(getTodayIsoDate().slice(0, 4));
    const parsedExtractedYear = extractedData?.documentDate
      ? Number(extractedData.documentDate.slice(0, 4))
      : NaN;
    const storageYear =
      Number.isInteger(parsedExtractedYear) &&
      parsedExtractedYear >= 1900 &&
      parsedExtractedYear <= 2100
        ? parsedExtractedYear
        : currentYear;

    const saved = savePdfFile(buffer, storageYear);

    try {
      const created = createDocumentRecord({
        filename,
        storagePath: saved.storagePath,
        sha256Hash: saved.sha256Hash,
        documentType: extractedData?.documentType ?? "other",
        documentDate: extractedData?.documentDate ?? null,
        issuer: extractedData?.issuer ?? null,
        totalAmountCents: extractedData?.totalAmountCents ?? null,
        isTaxRelevant: extractedData?.isTaxRelevant ?? false,
        taxYear: extractedData?.taxYear ?? null,
        taxCategory: extractedData?.taxCategory ?? null,
        deductibleAmountCents: extractedData?.deductibleAmountCents ?? null,
        detectedBalanceCents: extractedData?.detectedBalanceCents ?? null,
        extractedContractJson: extractedData?.extractedContract
          ? JSON.stringify(extractedData.extractedContract)
          : null,
      });

      return NextResponse.json(
        {
          document: created,
          ai: aiStatus,
        },
        { status: 201 },
      );
    } catch (error) {
      deletePdfFileIfExists(saved.storagePath);

      if (error instanceof DuplicateDocumentError) {
        return NextResponse.json(
          {
            error: error.message,
            existingDocument: error.existingDocument,
          },
          { status: 409 },
        );
      }
      if (error instanceof DocumentLinkedEntityNotFoundError) {
        return badRequestResponse(error.message, {
          [error.field]: error.message,
        });
      }
      throw error;
    }
  } catch (error) {
    console.error("POST /api/documents failed:", error);
    return internalErrorResponse();
  }
}
