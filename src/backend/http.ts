import { NextResponse } from "next/server";
import type { ZodError } from "zod";

export async function parseJsonBody(
  request: Request,
): Promise<{ ok: true; data: unknown } | { ok: false; response: NextResponse }> {
  try {
    const data: unknown = await request.json();
    return { ok: true, data };
  } catch {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "Ungültiger JSON-Body." },
        { status: 400 },
      ),
    };
  }
}

export function validationErrorResponse(error: ZodError): NextResponse {
  const fieldErrors: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = issue.path.length > 0 ? issue.path.join(".") : "_root";
    if (!(key in fieldErrors)) {
      fieldErrors[key] = issue.message;
    }
  }

  return NextResponse.json(
    {
      error: "Validierung fehlgeschlagen.",
      fieldErrors,
    },
    { status: 400 },
  );
}

export function badRequestResponse(
  message: string,
  fieldErrors?: Record<string, string>,
): NextResponse {
  return NextResponse.json(
    fieldErrors ? { error: message, fieldErrors } : { error: message },
    { status: 400 },
  );
}

export function notFoundResponse(message: string): NextResponse {
  return NextResponse.json({ error: message }, { status: 404 });
}

export function internalErrorResponse(): NextResponse {
  return NextResponse.json(
    { error: "Interner Serverfehler." },
    { status: 500 },
  );
}
