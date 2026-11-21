/**
 * Aufrufe der eigenen API aus dem Browser. Liefert immer ein Ergebnis statt zu
 * werfen: `status: null` heißt Netzwerkfehler, sonst kommen Fehlermeldung und
 * Feldfehler aus der Antwort (siehe backend/http.ts).
 */
export type ApiResult<T> =
  | { ok: true; status: number; data: T }
  | {
      ok: false;
      status: number | null;
      /** `error` bzw. `message` aus der Antwort, falls vorhanden. */
      error: string | null;
      fieldErrors: Record<string, string>;
      body: Record<string, unknown> | null;
    };

export interface ApiOptions {
  method?: "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
  /** Wird als JSON gesendet. */
  json?: unknown;
  /** Roher Body, z. B. FormData für Uploads. */
  body?: BodyInit;
  signal?: AbortSignal;
}

export async function api<T = unknown>(path: string, options: ApiOptions = {}): Promise<ApiResult<T>> {
  let response: Response;
  try {
    response = await fetch(path, {
      method: options.method ?? (options.json !== undefined || options.body !== undefined ? "POST" : "GET"),
      signal: options.signal,
      ...(options.json !== undefined
        ? { headers: { "Content-Type": "application/json" }, body: JSON.stringify(options.json) }
        : { body: options.body }),
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") throw error;
    return { ok: false, status: null, error: null, fieldErrors: {}, body: null };
  }

  const body = (await response.json().catch(() => null)) as Record<string, unknown> | null;
  if (response.ok) return { ok: true, status: response.status, data: body as T };
  const message = body?.error ?? body?.message;
  return {
    ok: false,
    status: response.status,
    error: typeof message === "string" ? message : null,
    fieldErrors: (body?.fieldErrors as Record<string, string> | undefined) ?? {},
    body,
  };
}

/** Fehlertext für die Oberfläche: Netzwerkfehler, Servermeldung oder Rückfalltext. */
export function apiErrorMessage(result: Extract<ApiResult<unknown>, { ok: false }>, fallback: string): string {
  if (result.status === null) return "Netzwerkfehler – bitte erneut versuchen.";
  return result.error ?? fallback;
}
