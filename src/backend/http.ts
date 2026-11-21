import { NextResponse } from "next/server";
import type { ZodError, ZodType } from "zod";
import { ApiError, type FieldErrors } from "./errors";

/** Kontext dynamischer Next-Routen, z. B. `RouteContext<{ id: string }>`. */
export interface RouteContext<P extends Record<string, string> = { id: string }> {
  params: Promise<P>;
}

type Handler<C> = (request: Request, context: C) => Promise<Response> | Response;

/**
 * Einheitliche Fehlerbehandlung für alle API-Routen: `ApiError` wird zur
 * passenden JSON-Antwort, alles andere zu 500 ohne interne Details.
 */
export function route<C = unknown>(handler: Handler<C>): (request: Request, context?: C) => Promise<Response> {
  return async (request, context) => {
    try {
      return await handler(request, context as C);
    } catch (error) {
      if (error instanceof ApiError) {
        return NextResponse.json({ error: error.message, ...error.details }, { status: error.status });
      }
      console.error(`${request?.method ?? "?"} ${request ? new URL(request.url).pathname : "?"} failed:`, error);
      return NextResponse.json({ error: "Interner Serverfehler." }, { status: 500 });
    }
  };
}

export function json(data: unknown, status = 200, headers?: HeadersInit): NextResponse {
  return NextResponse.json(data, { status, headers });
}

export function validationError(error: ZodError): ApiError {
  const fieldErrors: FieldErrors = {};
  for (const issue of error.issues) {
    const key = issue.path.length > 0 ? issue.path.join(".") : "_root";
    fieldErrors[key] ??= issue.message;
  }
  return new ApiError(400, "Validierung fehlgeschlagen.", { fieldErrors });
}

/** Wirft `ApiError` 400, wenn `data` nicht zum Schema passt. */
export function parseOrThrow<T>(schema: ZodType<T>, data: unknown): T {
  const parsed = schema.safeParse(data);
  if (!parsed.success) throw validationError(parsed.error);
  return parsed.data;
}

/**
 * Liest und validiert den JSON-Body. Mit `emptyBody` ist ein leerer Body
 * erlaubt und wird durch diesen Wert ersetzt.
 */
export async function readJson<T>(request: Request, schema: ZodType<T>, options: { emptyBody?: unknown } = {}): Promise<T> {
  let data: unknown;
  try {
    const text = await request.text();
    data = text.trim() === "" && "emptyBody" in options ? options.emptyBody : JSON.parse(text);
  } catch {
    throw new ApiError(400, "Ungültiger JSON-Body.");
  }
  return parseOrThrow(schema, data);
}

/** Liest ein Multipart-Formular und liefert das Datei-Feld `file`. */
export async function readUploadedFile(request: Request, messages: { invalidForm: string; missingFile: string }): Promise<Blob & { name?: string }> {
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    throw new ApiError(400, messages.invalidForm);
  }
  const file = form.get("file");
  if (!(file instanceof Blob)) throw new ApiError(400, messages.missingFile);
  return file;
}

/** Binärantwort für Downloads; nie zwischenspeichern, nie MIME-sniffen. */
export function fileResponse(body: Uint8Array | string, headers: Record<string, string>): NextResponse {
  const payload = typeof body === "string" ? body : new Uint8Array(body.buffer as ArrayBuffer, body.byteOffset, body.byteLength);
  return new NextResponse(payload, {
    status: 200,
    headers: { "X-Content-Type-Options": "nosniff", "Cache-Control": "private, no-store", ...headers },
  });
}
