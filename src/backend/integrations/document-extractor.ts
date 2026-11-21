import type { AiDocumentExtraction } from "@/validation/documents";

export interface DocumentExtractionContext {
  filename: string;
  mimeType: "application/pdf";
  pdfBase64: string;
}

export type DocumentExtractionErrorCode =
  | "not_configured"
  | "timeout"
  | "http_error"
  | "network_error"
  | "invalid_payload";

export type DocumentExtractionResult =
  | { ok: true; data: AiDocumentExtraction; model: string }
  | {
      ok: false;
      code: DocumentExtractionErrorCode;
      message: string;
      httpStatus?: number;
    };

export interface DocumentExtractor {
  extract(ctx: DocumentExtractionContext): Promise<DocumentExtractionResult>;
}
