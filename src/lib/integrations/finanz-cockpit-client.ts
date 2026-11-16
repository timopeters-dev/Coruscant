import {
  type FinanzCockpitSummary,
  finanzCockpitSummarySchema,
} from "@/lib/validation/external";

export type FinanzCockpitClientErrorCode =
  | "not_configured"
  | "invalid_config"
  | "unauthorized"
  | "http_error"
  | "timeout"
  | "network_error"
  | "invalid_payload";

export interface FinanzCockpitBridgeConfig {
  configured: boolean;
  baseUrl: string | null;
  token: string | null;
  validUrl: boolean;
}

export type FetchFinanzCockpitSummaryResult =
  | { ok: true; data: FinanzCockpitSummary }
  | {
      ok: false;
      code: FinanzCockpitClientErrorCode;
      message: string;
      httpStatus?: number;
    };

export interface FetchFinanzCockpitSummaryOptions {
  baseUrl?: string;
  token?: string;
  fetchFn?: typeof fetch;
  timeoutMs?: number;
}

function isValidHttpUrl(rawUrl: string): boolean {
  try {
    const parsed = new URL(rawUrl);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

export function getFinanzCockpitBridgeConfig(
  env: Record<string, string | undefined> = process.env,
): FinanzCockpitBridgeConfig {
  const rawUrl = env.FINANZ_COCKPIT_URL?.trim() ?? "";
  const rawToken = env.EXTERNAL_SUMMARY_TOKEN?.trim() ?? "";

  const baseUrl = rawUrl.length > 0 ? rawUrl : null;
  const token = rawToken.length > 0 ? rawToken : null;
  const validUrl = baseUrl !== null && isValidHttpUrl(baseUrl);

  return {
    configured: Boolean(baseUrl && token && validUrl),
    baseUrl,
    token,
    validUrl,
  };
}

export async function fetchFinanzCockpitSummary(
  options: FetchFinanzCockpitSummaryOptions = {},
): Promise<FetchFinanzCockpitSummaryResult> {
  const envConfig = getFinanzCockpitBridgeConfig();
  const baseUrl =
    options.baseUrl !== undefined
      ? options.baseUrl.trim() || null
      : envConfig.baseUrl;
  const token =
    options.token !== undefined
      ? options.token.trim() || null
      : envConfig.token;

  if (!baseUrl || !token) {
    return {
      ok: false,
      code: "not_configured",
      message:
        "FINANZ_COCKPIT_URL oder EXTERNAL_SUMMARY_TOKEN ist nicht konfiguriert.",
    };
  }

  if (!isValidHttpUrl(baseUrl)) {
    return {
      ok: false,
      code: "invalid_config",
      message: "FINANZ_COCKPIT_URL ist keine gültige HTTP(S)-URL.",
    };
  }

  const targetUrl = new URL("/api/external/summary", baseUrl).toString();
  const fetchFn = options.fetchFn ?? fetch;
  const timeoutMs = options.timeoutMs ?? 5_000;

  let response: Response;
  try {
    response = await fetchFn(targetUrl, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
      },
      cache: "no-store",
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    if (
      error instanceof Error &&
      (error.name === "AbortError" || error.name === "TimeoutError")
    ) {
      return {
        ok: false,
        code: "timeout",
        message: "Zeitüberschreitung beim Abruf von finanz_cockpit.",
      };
    }

    return {
      ok: false,
      code: "network_error",
      message: "finanz_cockpit ist aktuell nicht erreichbar.",
    };
  }

  if (response.status === 401 || response.status === 403) {
    return {
      ok: false,
      code: "unauthorized",
      message: "Authentifizierung bei finanz_cockpit fehlgeschlagen.",
      httpStatus: response.status,
    };
  }

  if (!response.ok) {
    return {
      ok: false,
      code: "http_error",
      message: `finanz_cockpit antwortete mit HTTP ${response.status}.`,
      httpStatus: response.status,
    };
  }

  let jsonBody: unknown;
  try {
    jsonBody = await response.json();
  } catch {
    return {
      ok: false,
      code: "invalid_payload",
      message: "Ungültiges JSON-Format von finanz_cockpit.",
    };
  }

  const parsed = finanzCockpitSummarySchema.safeParse(jsonBody);
  if (!parsed.success) {
    return {
      ok: false,
      code: "invalid_payload",
      message: "Ungültiges Antwortformat von finanz_cockpit.",
    };
  }

  return {
    ok: true,
    data: parsed.data,
  };
}
