import { aiDocumentExtractionSchema } from "@/lib/validation/documents";
import type {
  DocumentExtractionContext,
  DocumentExtractionResult,
  DocumentExtractor,
} from "./document-extractor";

export const DEFAULT_GEMINI_MODEL = "gemini-2.5-flash";
const DEFAULT_TIMEOUT_MS = 25_000;

export interface GeminiConfig {
  apiKey: string;
  model: string;
}

export function getGeminiConfig(
  env: Record<string, string | undefined> = process.env,
): GeminiConfig {
  const apiKey = env.GEMINI_API_KEY?.trim() ?? "";
  const model = env.GEMINI_MODEL?.trim() || DEFAULT_GEMINI_MODEL;
  return { apiKey, model };
}

export interface GeminiDocumentExtractorOptions {
  apiKey?: string;
  model?: string;
  fetchFn?: typeof fetch;
  timeoutMs?: number;
}

const EXTRACTION_PROMPT = [
  "Analysiere das angehängte deutsche Finanz-/Haushaltsdokument (PDF) und extrahiere strukturierte Metadaten als JSON.",
  "Antworte ausschließlich mit einem JSON-Objekt mit genau diesen Feldern:",
  "- documentType: eines von 'invoice', 'bauspar_statement', 'loan_statement', 'contract', 'tax_notice', 'other'",
  "- documentDate: Beleg-/Stichtagsdatum als 'YYYY-MM-DD' oder null",
  "- issuer: Name des Ausstellers / der Bank / des Betriebs oder null",
  "- totalAmountCents: Gesamtbetrag als nicht-negative Ganzzahl in Cent (z.B. 123,45 € -> 12345) oder null. Niemals Dezimalzahlen!",
  "- isTaxRelevant: boolean (true bei Handwerkerrechnung, haushaltsnaher Dienstleistung, Werbungskosten V+V, Steuerbescheid, Kapitalerträgen)",
  "- taxYear: vierstellige Jahreszahl (Integer) oder null",
  "- taxCategory: eines von 'handwerker_35a', 'haushaltsnahe_dl_35a', 'werbungskosten_vv', 'capital_gains', 'other' oder null",
  "- deductibleAmountCents: absetzbarer Betrag / Lohnanteil (z.B. bei § 35a) als nicht-negative Ganzzahl in Cent (<= totalAmountCents) oder null",
  "- detectedBalanceCents: erkannter aktueller Darlehens-, Konto- oder Bauspar-Saldo als nicht-negative Ganzzahl in Cent oder null",
  "Unbekannte Werte strikt auf null setzen.",
].join("\n");

function stripMarkdownCodeFences(rawText: string): string {
  const trimmed = rawText.trim();
  const match = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(trimmed);
  return match?.[1] ? match[1].trim() : trimmed;
}

export function createGeminiDocumentExtractor(
  options: GeminiDocumentExtractorOptions = {},
): DocumentExtractor {
  const config = getGeminiConfig();
  const apiKey = (options.apiKey ?? config.apiKey).trim();
  const model = (options.model ?? config.model).trim() || DEFAULT_GEMINI_MODEL;
  const fetchFn = options.fetchFn ?? fetch;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  return {
    async extract(
      ctx: DocumentExtractionContext,
    ): Promise<DocumentExtractionResult> {
      if (!apiKey) {
        return {
          ok: false,
          code: "not_configured",
          message: "GEMINI_API_KEY ist nicht konfiguriert.",
        };
      }

      const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;
      const controller = new AbortController();
      const timeoutHandle = setTimeout(() => {
        controller.abort();
      }, timeoutMs);

      let response: Response;
      try {
        response = await fetchFn(endpoint, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-goog-api-key": apiKey,
          },
          body: JSON.stringify({
            contents: [
              {
                parts: [
                  {
                    text: `${EXTRACTION_PROMPT}\n\nDateiname: ${ctx.filename}`,
                  },
                  {
                    inline_data: {
                      mime_type: ctx.mimeType,
                      data: ctx.pdfBase64,
                    },
                  },
                ],
              },
            ],
            generationConfig: {
              responseMimeType: "application/json",
              temperature: 0.1,
            },
          }),
          signal: controller.signal,
        });
      } catch (error) {
        clearTimeout(timeoutHandle);
        if (error instanceof Error && error.name === "AbortError") {
          return {
            ok: false,
            code: "timeout",
            message: "Zeitüberschreitung bei der KI-Dokumentenanalyse.",
          };
        }
        return {
          ok: false,
          code: "network_error",
          message: "Netzwerkfehler bei der KI-Dokumentenanalyse.",
        };
      } finally {
        clearTimeout(timeoutHandle);
      }

      if (!response.ok) {
        return {
          ok: false,
          code: "http_error",
          httpStatus: response.status,
          message: `KI-API antwortete mit HTTP ${response.status}.`,
        };
      }

      let rawBody: unknown;
      try {
        rawBody = await response.json();
      } catch {
        return {
          ok: false,
          code: "invalid_payload",
          message: "KI-Antwort ist kein gültiges JSON.",
        };
      }

      const textCandidate = extractTextFromGeminiResponse(rawBody);
      if (textCandidate === null) {
        return {
          ok: false,
          code: "invalid_payload",
          message: "KI-Antwort enthält keinen auswertbaren Text.",
        };
      }

      let parsedJson: unknown;
      try {
        parsedJson = JSON.parse(stripMarkdownCodeFences(textCandidate));
      } catch {
        return {
          ok: false,
          code: "invalid_payload",
          message: "Extrahierter KI-Text ist kein gültiges JSON.",
        };
      }

      const validated = aiDocumentExtractionSchema.safeParse(parsedJson);
      if (!validated.success) {
        return {
          ok: false,
          code: "invalid_payload",
          message: "KI-Output erfüllt das erwartete Schema nicht.",
        };
      }

      return {
        ok: true,
        data: validated.data,
        model,
      };
    },
  };
}

function extractTextFromGeminiResponse(body: unknown): string | null {
  if (!body || typeof body !== "object") {
    return null;
  }
  const candidates = (body as { candidates?: unknown }).candidates;
  if (!Array.isArray(candidates) || candidates.length === 0) {
    return null;
  }
  const first = candidates[0];
  if (!first || typeof first !== "object") {
    return null;
  }
  const content = (first as { content?: unknown }).content;
  if (!content || typeof content !== "object") {
    return null;
  }
  const parts = (content as { parts?: unknown }).parts;
  if (!Array.isArray(parts) || parts.length === 0) {
    return null;
  }
  const firstPart = parts[0];
  if (!firstPart || typeof firstPart !== "object") {
    return null;
  }
  const text = (firstPart as { text?: unknown }).text;
  return typeof text === "string" ? text : null;
}

export function createDefaultDocumentExtractor(): DocumentExtractor {
  return createGeminiDocumentExtractor();
}
