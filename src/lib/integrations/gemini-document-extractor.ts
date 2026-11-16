import { aiDocumentExtractionSchema } from "@/lib/validation/documents";
import type {
  DocumentExtractionContext,
  DocumentExtractionErrorCode,
  DocumentExtractionResult,
  DocumentExtractor,
} from "./document-extractor";

export const DEFAULT_GEMINI_MODEL = "gemini-3.6-flash";
export const DEFAULT_GEMINI_FALLBACK_MODEL = "gemini-3.5-flash-lite";
const DEFAULT_TIMEOUT_MS = 45_000;
const DEFAULT_RETRY_DELAY_MS = 1_000;
const MAX_RETRIES = 3;
const RETRYABLE_STATUSES = new Set([429, 503]);

export interface GeminiConfig {
  apiKey: string;
  model: string;
  fallbackModels: string[];
}

function normalizeModelName(raw: string): string {
  return raw.trim().replace(/^models\//, "");
}

function parseFallbackModels(
  rawFallbackEnv: string | undefined,
  primaryModel: string,
): string[] {
  const candidates =
    rawFallbackEnv !== undefined
      ? rawFallbackEnv.split(",")
      : [DEFAULT_GEMINI_FALLBACK_MODEL];

  return Array.from(
    new Set(
      candidates
        .map(normalizeModelName)
        .filter((candidate) => candidate.length > 0 && candidate !== primaryModel),
    ),
  );
}

export function getGeminiConfig(
  env: Record<string, string | undefined> = process.env,
): GeminiConfig {
  const apiKey = env.GEMINI_API_KEY?.trim() ?? "";
  const model =
    normalizeModelName(env.GEMINI_MODEL?.trim() || DEFAULT_GEMINI_MODEL) ||
    DEFAULT_GEMINI_MODEL;
  const fallbackModels = parseFallbackModels(env.GEMINI_FALLBACK_MODEL, model);
  return { apiKey, model, fallbackModels };
}

export interface GeminiDocumentExtractorOptions {
  apiKey?: string;
  model?: string;
  fallbackModels?: string[];
  fetchFn?: typeof fetch;
  timeoutMs?: number;
  retryDelayMs?: number;
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
  "- extractedContract: falls es sich um einen Kredit-/Darlehensvertrag oder Bausparvertrag (inkl. Konditionenübersicht / Jahreskontoauszug) handelt, ein Objekt mit folgenden Feldern, sonst null:",
  "  - name: aussagekräftiger Vertragsname (z.B. 'Hauskredit Musterbank' oder 'Bausparvertrag Tarif Klassik') oder null",
  "  - provider: Bank / Bausparkasse / Gläubiger oder null",
  "  - category: 'loan' (Kredit/Darlehen) oder 'savings_contract' (Bausparvertrag) oder null",
  "  - currentBalanceCents: aktueller Saldo / Darlehensbetrag / Restschuld bzw. Bauspar-Guthaben als nicht-negative Ganzzahl in Cent (z.B. 295.000,00 € -> 29500000, 1.400,00 € -> 140000) oder null. Niemals Dezimalzahlen!",
  "  - balanceAsOfDate: Stichtag des Saldos bzw. Auszahlungs-/Vertragsdatum als 'YYYY-MM-DD' oder null",
  "  - monthlyRateCents: monatliche Rate / Sparrate als nicht-negative Ganzzahl in Cent (z.B. 1.400,00 € -> 140000) oder null",
  "  - interestRateBps: Sollzinssatz / Guthabenzins als nicht-negative Ganzzahl in Basispunkten (1 % = 100 bps, z.B. 3,45 % -> 345, 0,50 % -> 50, 4,0 % -> 400) oder null",
  "  - repaymentType: für Kredite eines von 'annuity', 'installment', 'lump_sum', sonst null",
  "  - specialRepaymentMaxYearlyCents: maximale jährliche Sondertilgung in Cent (Ganzzahl) oder null",
  "  - fixedInterestUntil: Ende der Zinsbindung als 'YYYY-MM-DD' oder null",
  "  - targetSumCents: bei Bausparverträgen die Bausparsumme in Cent (Ganzzahl) oder null",
  "  - allocationThresholdPercent: bei Bausparverträgen die Zuteilungsschwelle als ganze Zahl 0..100 (z.B. 40 % -> 40) oder null",
  "  - futureLoanInterestRateBps: bei Bausparverträgen der spätere Darlehenszins in Basispunkten (z.B. 2,50 % -> 250) oder null",
  "  - milestoneDate: wichtiges Zieldatum (z.B. geplante Zuteilung / Rückzahlung) als 'YYYY-MM-DD' oder null",
  "  - milestoneLabel: kurze Beschreibung des Meilensteins oder null",
  "Hinweis zu mehrseitigen Verträgen: Werte gezielt die Konditionenübersicht, den Darlehensvertrag-Kopf sowie das ESIS-Merkblatt (Europäisches Standardisiertes Merkblatt) bzw. bei Bausparverträgen die Tarif-/Vertragsdaten-Übersicht aus.",
  "Alle Geldbeträge strikt als Ganzzahl in Cent und Zinssätze als Ganzzahl in Basispunkten angeben; nicht erkennbare Werte und Unterfelder strikt auf null setzen.",
].join("\n");

function buildGeminiEndpoints(model: string, apiKey: string): string[] {
  const normalizedModel = normalizeModelName(model);
  const encodedModel = encodeURIComponent(normalizedModel);
  const aiStudioUrl = `https://generativelanguage.googleapis.com/v1beta/models/${encodedModel}:generateContent`;
  const vertexExpressUrl = `https://aiplatform.googleapis.com/v1/publishers/google/models/${encodedModel}:generateContent`;

  return apiKey.startsWith("AQ.")
    ? [vertexExpressUrl, aiStudioUrl]
    : [aiStudioUrl, vertexExpressUrl];
}

function isEndpointFallbackEligibleStatus(status: number): boolean {
  return status === 400 || status === 401 || status === 403;
}

async function extractGeminiErrorMessage(
  res: Response,
): Promise<string | null> {
  try {
    if (typeof res.json !== "function") {
      return null;
    }
    const body = (await res.json()) as {
      error?: { message?: unknown };
    };
    if (
      typeof body?.error?.message === "string" &&
      body.error.message.trim().length > 0
    ) {
      return body.error.message.trim();
    }
  } catch {
    // Ignore non-JSON error responses
  }
  return null;
}

function formatHttpErrorMessage(status: number, detail: string | null): string {
  const suffix = detail ? ` (${detail})` : "";
  if (status === 401 || status === 403) {
    return `Ungültiger Gemini API-Key (HTTP ${status})${suffix}.`;
  }
  if (status === 429) {
    return `Gemini API Rate-Limit erreicht (HTTP 429)${suffix}.`;
  }
  if (status === 503) {
    return `Gemini API temporär nicht erreichbar (HTTP 503)${suffix}.`;
  }
  return `KI-API antwortete mit HTTP ${status}${suffix}.`;
}

function sleep(ms: number): Promise<void> {
  if (ms <= 0) {
    return Promise.resolve();
  }
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function stripMarkdownCodeFences(rawText: string): string {
  const trimmed = rawText.trim();
  const match = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(trimmed);
  return match?.[1] ? match[1].trim() : trimmed;
}

type RequestAttemptResult =
  | { ok: true; response: Response }
  | {
      ok: false;
      code: Exclude<DocumentExtractionErrorCode, "not_configured" | "invalid_payload">;
      message: string;
      httpStatus?: number;
      canFallbackModel: boolean;
    };

async function executeGeminiRequestWithRetries(params: {
  apiKey: string;
  model: string;
  serializedBody: string;
  fetchFn: typeof fetch;
  timeoutMs: number;
  baseRetryDelayMs: number;
}): Promise<RequestAttemptResult> {
  const endpoints = buildGeminiEndpoints(params.model, params.apiKey);

  for (let idx = 0; idx < endpoints.length; idx++) {
    const url = endpoints[idx]!;
    const hasNextEndpoint = idx < endpoints.length - 1;
    let candidateRes: Response | null = null;
    let lastErrorCode: "timeout" | "network_error" = "network_error";

    for (let retry = 0; retry <= MAX_RETRIES; retry++) {
      candidateRes = null;
      const controller = new AbortController();
      const timeoutHandle =
        params.timeoutMs > 0
          ? setTimeout(() => {
              controller.abort();
            }, params.timeoutMs)
          : null;

      try {
        candidateRes = await params.fetchFn(url, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-goog-api-key": params.apiKey,
          },
          body: params.serializedBody,
          signal: controller.signal,
        });
      } catch (error) {
        lastErrorCode =
          error instanceof Error &&
          (error.name === "AbortError" || error.name === "TimeoutError")
            ? "timeout"
            : "network_error";

        if (retry < MAX_RETRIES) {
          await sleep(params.baseRetryDelayMs * Math.pow(2, retry));
          continue;
        }
        break;
      } finally {
        if (timeoutHandle !== null) {
          clearTimeout(timeoutHandle);
        }
      }

      if (candidateRes.ok) {
        return { ok: true, response: candidateRes };
      }

      if (RETRYABLE_STATUSES.has(candidateRes.status) && retry < MAX_RETRIES) {
        await sleep(params.baseRetryDelayMs * Math.pow(2, retry));
        continue;
      }

      break;
    }

    if (!candidateRes) {
      if (hasNextEndpoint) {
        continue;
      }
      return {
        ok: false,
        code: lastErrorCode,
        message:
          lastErrorCode === "timeout"
            ? "Zeitüberschreitung bei der KI-Dokumentenanalyse."
            : "Netzwerkfehler bei der KI-Dokumentenanalyse.",
        canFallbackModel: true,
      };
    }

    const detail = await extractGeminiErrorMessage(candidateRes);
    if (
      hasNextEndpoint &&
      isEndpointFallbackEligibleStatus(candidateRes.status)
    ) {
      continue;
    }

    return {
      ok: false,
      code: "http_error",
      httpStatus: candidateRes.status,
      message: formatHttpErrorMessage(candidateRes.status, detail),
      canFallbackModel: RETRYABLE_STATUSES.has(candidateRes.status),
    };
  }

  return {
    ok: false,
    code: "http_error",
    message: "KI-API lieferte keine gültige Antwort.",
    canFallbackModel: true,
  };
}

export function createGeminiDocumentExtractor(
  options: GeminiDocumentExtractorOptions = {},
): DocumentExtractor {
  const config = getGeminiConfig();
  const apiKey = (options.apiKey ?? config.apiKey).trim();
  const primaryModel =
    normalizeModelName((options.model ?? config.model).trim()) ||
    DEFAULT_GEMINI_MODEL;

  const rawFallbacks =
    options.fallbackModels !== undefined
      ? options.fallbackModels
      : options.model !== undefined
        ? [DEFAULT_GEMINI_FALLBACK_MODEL]
        : config.fallbackModels;

  const fallbackModels = Array.from(
    new Set(
      rawFallbacks
        .map(normalizeModelName)
        .filter((candidate) => candidate.length > 0 && candidate !== primaryModel),
    ),
  );
  const modelsToTry = [primaryModel, ...fallbackModels];

  const fetchFn = options.fetchFn ?? fetch;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const baseRetryDelayMs = options.retryDelayMs ?? DEFAULT_RETRY_DELAY_MS;

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

      const serializedBody = JSON.stringify({
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
      });

      let response: Response | null = null;
      let resolvedModel = primaryModel;
      let lastFailure: Extract<RequestAttemptResult, { ok: false }> | null =
        null;

      for (let mIdx = 0; mIdx < modelsToTry.length; mIdx++) {
        const currentModel = modelsToTry[mIdx]!;
        const hasFallbackModel = mIdx < modelsToTry.length - 1;

        const attempt = await executeGeminiRequestWithRetries({
          apiKey,
          model: currentModel,
          serializedBody,
          fetchFn,
          timeoutMs,
          baseRetryDelayMs,
        });

        if (attempt.ok) {
          response = attempt.response;
          resolvedModel = currentModel;
          break;
        }

        lastFailure = attempt;
        if (attempt.canFallbackModel && hasFallbackModel) {
          continue;
        }

        return {
          ok: false,
          code: attempt.code,
          message: attempt.message,
          ...(attempt.httpStatus !== undefined
            ? { httpStatus: attempt.httpStatus }
            : {}),
        };
      }

      if (!response) {
        return {
          ok: false,
          code: lastFailure?.code ?? "http_error",
          message:
            lastFailure?.message ?? "KI-API lieferte keine gültige Antwort.",
          ...(lastFailure?.httpStatus !== undefined
            ? { httpStatus: lastFailure.httpStatus }
            : {}),
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
        model: resolvedModel,
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
