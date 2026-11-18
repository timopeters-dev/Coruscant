export const DEFAULT_GEMINI_MODEL = "gemini-3.6-flash";
export const DEFAULT_GEMINI_FALLBACK_MODEL = "gemini-3.5-flash-lite";
const DEFAULT_TIMEOUT_MS = 45_000;
const DEFAULT_RETRY_DELAY_MS = 1_000;
const MAX_RETRIES = 3;
const RETRYABLE_STATUSES = new Set([429, 503]);

export type GeminiTransportErrorCode =
  | "not_configured"
  | "timeout"
  | "http_error"
  | "network_error"
  | "invalid_payload";

export interface GeminiConfig {
  apiKey: string;
  model: string;
  fallbackModels: string[];
}

export function normalizeModelName(raw: string): string {
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

export function buildGeminiEndpoints(model: string, apiKey: string): string[] {
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

export function stripMarkdownCodeFences(rawText: string): string {
  const trimmed = rawText.trim();
  const match = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(trimmed);
  return match?.[1] ? match[1].trim() : trimmed;
}

export function parseGeminiJsonText(rawText: string): unknown {
  try {
    return JSON.parse(stripMarkdownCodeFences(rawText));
  } catch {
    // Fallback für Antworten ohne responseMimeType (z. B. erklärender Text vor/nach JSON)
  }

  const fencedMatch = /```(?:json)?\s*([\s\S]*?)\s*```/i.exec(rawText);
  if (fencedMatch?.[1]) {
    return JSON.parse(fencedMatch[1].trim());
  }

  const firstBrace = rawText.indexOf("{");
  const lastBrace = rawText.lastIndexOf("}");
  if (firstBrace !== -1 && lastBrace > firstBrace) {
    return JSON.parse(rawText.slice(firstBrace, lastBrace + 1));
  }

  throw new SyntaxError("Kein gültiges JSON im KI-Text gefunden.");
}

const MAX_GROUNDING_SOURCES = 8;
const MAX_GROUNDING_TITLE_LENGTH = 120;
const MAX_SEARCH_QUERIES = 5;
const MAX_SEARCH_QUERY_LENGTH = 200;

export interface GeminiGroundingSource {
  uri: string;
  title: string;
}

export interface GeminiGroundingMetadata {
  sources: GeminiGroundingSource[];
  webSearchQueries: string[];
}

export function extractTextFromGeminiResponse(body: unknown): string | null {
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

  const texts: string[] = [];
  for (const part of parts) {
    if (!part || typeof part !== "object") {
      continue;
    }
    const candidatePart = part as { text?: unknown; thought?: unknown };
    if (candidatePart.thought === true) {
      continue;
    }
    if (typeof candidatePart.text === "string") {
      texts.push(candidatePart.text);
    }
  }

  return texts.length > 0 ? texts.join("") : null;
}

export function extractGroundingFromGeminiResponse(
  body: unknown,
): GeminiGroundingMetadata {
  const empty: GeminiGroundingMetadata = { sources: [], webSearchQueries: [] };
  if (!body || typeof body !== "object") {
    return empty;
  }
  const candidates = (body as { candidates?: unknown }).candidates;
  if (!Array.isArray(candidates) || candidates.length === 0) {
    return empty;
  }
  const first = candidates[0];
  if (!first || typeof first !== "object") {
    return empty;
  }
  const groundingMetadata = (first as { groundingMetadata?: unknown })
    .groundingMetadata;
  if (!groundingMetadata || typeof groundingMetadata !== "object") {
    return empty;
  }

  const sources: GeminiGroundingSource[] = [];
  const seenUris = new Set<string>();
  const rawChunks = (groundingMetadata as { groundingChunks?: unknown })
    .groundingChunks;

  if (Array.isArray(rawChunks)) {
    for (const chunk of rawChunks) {
      if (sources.length >= MAX_GROUNDING_SOURCES) {
        break;
      }
      if (!chunk || typeof chunk !== "object") {
        continue;
      }
      const web = (chunk as { web?: unknown }).web;
      if (!web || typeof web !== "object") {
        continue;
      }
      const rawUri = (web as { uri?: unknown }).uri;
      if (typeof rawUri !== "string") {
        continue;
      }
      const trimmedUri = rawUri.trim();
      let parsedUrl: URL;
      try {
        parsedUrl = new URL(trimmedUri);
      } catch {
        continue;
      }
      if (parsedUrl.protocol !== "https:") {
        continue;
      }
      if (seenUris.has(trimmedUri)) {
        continue;
      }
      seenUris.add(trimmedUri);

      const rawTitle = (web as { title?: unknown }).title;
      const trimmedTitle =
        typeof rawTitle === "string" ? rawTitle.trim() : "";
      const title = (trimmedTitle || parsedUrl.host).slice(
        0,
        MAX_GROUNDING_TITLE_LENGTH,
      );

      sources.push({ uri: trimmedUri, title });
    }
  }

  const webSearchQueries: string[] = [];
  const seenQueries = new Set<string>();
  const rawQueries = (groundingMetadata as { webSearchQueries?: unknown })
    .webSearchQueries;
  if (Array.isArray(rawQueries)) {
    for (const q of rawQueries) {
      if (webSearchQueries.length >= MAX_SEARCH_QUERIES) {
        break;
      }
      if (typeof q !== "string") {
        continue;
      }
      const trimmed = q.trim().slice(0, MAX_SEARCH_QUERY_LENGTH);
      if (trimmed.length === 0 || seenQueries.has(trimmed)) {
        continue;
      }
      seenQueries.add(trimmed);
      webSearchQueries.push(trimmed);
    }
  }

  return { sources, webSearchQueries };
}

type RequestAttemptResult =
  | { ok: true; response: Response }
  | {
      ok: false;
      code: Exclude<GeminiTransportErrorCode, "not_configured" | "invalid_payload">;
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
  operationLabel: string;
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
            ? `Zeitüberschreitung bei der ${params.operationLabel}.`
            : `Netzwerkfehler bei der ${params.operationLabel}.`,
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

export interface GeminiJsonClientOptions {
  apiKey?: string;
  model?: string;
  fallbackModels?: string[];
  fetchFn?: typeof fetch;
  timeoutMs?: number;
  retryDelayMs?: number;
  /** Text für Fehlermeldungen, z. B. „KI-Dokumentenanalyse“. */
  operationLabel: string;
}

export type GeminiJsonResult =
  | {
      ok: true;
      json: unknown;
      model: string;
      grounding: GeminiGroundingMetadata;
    }
  | {
      ok: false;
      code: GeminiTransportErrorCode;
      message: string;
      httpStatus?: number;
    };

export interface GeminiJsonClient {
  generateJson(body: unknown): Promise<GeminiJsonResult>;
}

export function createGeminiJsonClient(
  options: GeminiJsonClientOptions,
): GeminiJsonClient {
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
    async generateJson(body: unknown): Promise<GeminiJsonResult> {
      if (!apiKey) {
        return {
          ok: false,
          code: "not_configured",
          message: "GEMINI_API_KEY ist nicht konfiguriert.",
        };
      }

      const serializedBody = JSON.stringify(body);

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
          operationLabel: options.operationLabel,
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
        parsedJson = parseGeminiJsonText(textCandidate);
      } catch {
        return {
          ok: false,
          code: "invalid_payload",
          message: "Extrahierter KI-Text ist kein gültiges JSON.",
        };
      }

      return {
        ok: true,
        json: parsedJson,
        model: resolvedModel,
        grounding: extractGroundingFromGeminiResponse(rawBody),
      };
    },
  };
}
