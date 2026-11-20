/** Request an eine API-Route; `body` wird als JSON gesendet (Strings unverändert). */
export function apiRequest(path: string, method = "GET", body?: unknown): Request {
  return new Request(`http://localhost${path}`, {
    method,
    ...(body === undefined
      ? {}
      : { headers: { "Content-Type": "application/json" }, body: typeof body === "string" ? body : JSON.stringify(body) }),
  });
}

/** Kontext einer dynamischen Route, z. B. `params({ id: "pot-1" })`. */
export function params<P extends Record<string, string>>(value: P): { params: Promise<P> } {
  return { params: Promise.resolve(value) };
}
