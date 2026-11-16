import { NextResponse } from "next/server";
import {
  applyAiExtractionIfPending,
  DocumentAlreadyVerifiedError,
  DocumentNotFoundError,
  getDocumentById,
} from "@/db/queries/documents";
import { internalErrorResponse, notFoundResponse } from "@/lib/api/http";
import { createDefaultDocumentExtractor } from "@/lib/integrations/gemini-document-extractor";
import { PathTraversalError, readPdfFile } from "@/lib/storage/pdf-storage";

export const dynamic = "force-dynamic";

export async function POST(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await context.params;
    const doc = getDocumentById(id);
    if (!doc) {
      return notFoundResponse("Dokument nicht gefunden.");
    }

    if (doc.status === "verified") {
      return NextResponse.json(
        {
          error:
            "Bereits verifizierte Belege können nicht erneut durch die KI überschrieben werden.",
        },
        { status: 409 },
      );
    }

    let buffer: Buffer;
    try {
      buffer = readPdfFile(doc.storagePath);
    } catch (error) {
      if (
        error instanceof PathTraversalError ||
        (error &&
          typeof error === "object" &&
          "code" in error &&
          error.code === "ENOENT")
      ) {
        return notFoundResponse("PDF-Datei nicht gefunden.");
      }
      throw error;
    }

    const extractor = createDefaultDocumentExtractor();
    const extraction = await extractor.extract({
      filename: doc.filename,
      mimeType: "application/pdf",
      pdfBase64: buffer.toString("base64"),
    });

    if (!extraction.ok) {
      return NextResponse.json(
        {
          document: doc,
          ai: {
            status:
              extraction.code === "not_configured" ? "skipped" : "failed",
            message: extraction.message,
          },
        },
        { status: 200 },
      );
    }

    const updated = applyAiExtractionIfPending(id, {
      documentType: extraction.data.documentType,
      documentDate: extraction.data.documentDate,
      issuer: extraction.data.issuer,
      totalAmountCents: extraction.data.totalAmountCents,
      isTaxRelevant: extraction.data.isTaxRelevant,
      taxYear: extraction.data.taxYear,
      taxCategory: extraction.data.taxCategory,
      deductibleAmountCents: extraction.data.deductibleAmountCents,
      detectedBalanceCents: extraction.data.detectedBalanceCents,
    });

    return NextResponse.json(
      {
        document: updated,
        ai: {
          status: "extracted",
          model: extraction.model,
        },
      },
      { status: 200 },
    );
  } catch (error) {
    if (error instanceof DocumentNotFoundError) {
      return notFoundResponse(error.message);
    }
    if (error instanceof DocumentAlreadyVerifiedError) {
      return NextResponse.json({ error: error.message }, { status: 409 });
    }
    console.error("POST /api/documents/[id]/analyze failed:", error);
    return internalErrorResponse();
  }
}
