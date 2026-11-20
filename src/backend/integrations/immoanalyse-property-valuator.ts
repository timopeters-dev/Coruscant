import type { QuotaSnapshot } from "@/domain/properties/valuation/auto-schedule";
import { getTodayIsoDate } from "@/domain/core/date";
import {
  immoAnalyseValuationResponseSchema,
  parseImmoAnalyseErrorPayload,
} from "@/validation/immoanalyse";
import {
  normalizeImmoAnalyseResult,
  normalizeQuota,
} from "./immoanalyse-mapping";
import type {
  PropertyValuator,
  ValuatorErrorCode,
  ValuatorResult,
} from "./property-valuator";

export const DEFAULT_IMMOANALYSE_BASE_URL = "https://immoanalyse.pro/api/v1";
export const DEFAULT_IMMOANALYSE_TIMEOUT_MS = 60_000;

export interface ImmoAnalysePropertyValuatorOptions {
  apiKey?: string;
  baseUrl?: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  fallbackAsOfDate?: string;
}

function mapHttpStatusToErrorCode(status: number): ValuatorErrorCode {
  if (status === 400 || status === 413) return "invalid_request";
  if (status === 401) return "unauthorized";
  if (status === 402) return "quota_exceeded";
  if (status === 422) return "not_valuable";
  if (status === 429) return "rate_limited";
  return "http_error";
}

function extractQuotaFrom402Details(details: unknown): QuotaSnapshot {
  let resetAt: string | null = null;
  let limit = 0;
  let used = 0;
  let tariff: string | null = null;

  if (typeof details === "object" && details !== null) {
    const record = details as Record<string, unknown>;
    if (typeof record.reset_at === "string") {
      resetAt = record.reset_at;
    }
    if (
      typeof record.limit === "number" &&
      Number.isInteger(record.limit) &&
      record.limit >= 0
    ) {
      limit = record.limit;
    }
    if (
      typeof record.verbraucht === "number" &&
      Number.isInteger(record.verbraucht) &&
      record.verbraucht >= 0
    ) {
      used = record.verbraucht;
    }
    if (typeof record.tarif === "string") {
      tariff = record.tarif;
    }
  }

  return {
    limit,
    used,
    remaining: 0,
    resetAt,
    tariff,
  };
}

export function createImmoAnalysePropertyValuator(
  options: ImmoAnalysePropertyValuatorOptions = {},
): PropertyValuator {
  const apiKey = (options.apiKey ?? process.env.IMMOANALYSE_API_KEY ?? "").trim();
  const rawBaseUrl = (
    options.baseUrl ??
    process.env.IMMOANALYSE_BASE_URL ??
    DEFAULT_IMMOANALYSE_BASE_URL
  ).trim();
  const baseUrl = (
    rawBaseUrl.length > 0 ? rawBaseUrl : DEFAULT_IMMOANALYSE_BASE_URL
  ).replace(/\/+$/, "");
  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? DEFAULT_IMMOANALYSE_TIMEOUT_MS;

  return {
    async estimate(requestJson: string): Promise<ValuatorResult> {
      if (apiKey.length === 0) {
        return {
          ok: false,
          code: "not_configured",
          message: "IMMOANALYSE_API_KEY ist nicht konfiguriert.",
        };
      }

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);

      let response: Response;
      try {
        response = await fetchImpl(`${baseUrl}/valuation`, {
          method: "POST",
          headers: {
            "X-API-Key": apiKey,
            "Content-Type": "application/json",
            Accept: "application/json",
          },
          body: requestJson,
          signal: controller.signal,
        });
      } catch (error) {
        clearTimeout(timer);
        if (error instanceof Error && error.name === "AbortError") {
          return {
            ok: false,
            code: "timeout",
            message: "Zeitüberschreitung bei der Wertschätzungs-Anfrage.",
          };
        }
        return {
          ok: false,
          code: "network_error",
          message: "Netzwerkfehler bei der Wertschätzungs-Anfrage.",
        };
      } finally {
        clearTimeout(timer);
      }

      let rawJson: unknown = null;
      try {
        rawJson = await response.json();
      } catch {
        rawJson = null;
      }

      if (!response.ok) {
        const code = mapHttpStatusToErrorCode(response.status);
        const errorPayload = parseImmoAnalyseErrorPayload(rawJson);
        const apiCode = errorPayload?.error.code;
        const quota =
          response.status === 402
            ? extractQuotaFrom402Details(errorPayload?.error.details)
            : undefined;

        return {
          ok: false,
          code,
          message: `ImmoAnalyse.Pro antwortete mit HTTP ${response.status}.`,
          httpStatus: response.status,
          ...(apiCode ? { apiCode } : {}),
          ...(quota ? { quota } : {}),
        };
      }

      if (rawJson === null) {
        return {
          ok: false,
          code: "invalid_payload",
          message: "Antwort von ImmoAnalyse.Pro ist kein gültiges JSON.",
        };
      }

      const parsed = immoAnalyseValuationResponseSchema.safeParse(rawJson);
      if (!parsed.success) {
        return {
          ok: false,
          code: "invalid_payload",
          message: "Antwort von ImmoAnalyse.Pro entspricht nicht dem Schema.",
        };
      }

      const fallbackAsOf = options.fallbackAsOfDate ?? getTodayIsoDate();
      const result = normalizeImmoAnalyseResult(parsed.data, fallbackAsOf);
      const quota = normalizeQuota(parsed.data.kontingent);

      return {
        ok: true,
        result,
        quota,
        provider: "immoanalyse",
      };
    },
  };
}
