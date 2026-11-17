import { NextResponse } from "next/server";
import { getDocumentById } from "@/db/queries/documents";
import { internalErrorResponse, notFoundResponse } from "@/lib/api/http";
import { PathTraversalError, readPdfFile } from "@/lib/storage/pdf-storage";

export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await context.params;
    const doc = getDocumentById(id);
    if (!doc) {
      return notFoundResponse("Dokument nicht gefunden.");
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

    const asciiFallback = doc.filename.replace(/[^\x20-\x7e]|["\\;]/g, "_");
    const encodedFilename = encodeURIComponent(doc.filename);
    return new NextResponse(new Uint8Array(buffer), {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="${asciiFallback}"; filename*=UTF-8''${encodedFilename}`,
        "X-Content-Type-Options": "nosniff",
        "Cache-Control": "private, no-store",
      },
    });
  } catch (error) {
    console.error("GET /api/documents/[id]/file failed:", error);
    return internalErrorResponse();
  }
}
