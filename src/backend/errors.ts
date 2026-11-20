export type FieldErrors = Record<string, string>;

/**
 * Ein Fehler, den das Backend bewusst an den Client meldet.
 *
 * `route()` (siehe http.ts) macht daraus die Antwort
 * `{ error: message, ...details }` mit `status`. Jeder andere Fehler wird zu
 * 500 „Interner Serverfehler.“ – Interna gelangen so nie in die Antwort.
 */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly details: { fieldErrors?: FieldErrors } & Record<string, unknown> = {},
  ) {
    super(message);
    this.name = new.target.name;
  }
}

export class NotFoundError extends ApiError {
  constructor(message: string) {
    super(404, message);
  }
}

/** 400 mit Feldfehler; ohne `fieldErrors` wird die Meldung dem Feld `field` zugeordnet. */
export class FieldValidationError extends ApiError {
  constructor(message: string, fieldErrors: FieldErrors | string) {
    super(400, message, {
      fieldErrors: typeof fieldErrors === "string" ? { [fieldErrors]: message } : fieldErrors,
    });
  }
}

export class LinkedPropertyNotFoundError extends FieldValidationError {
  constructor() {
    super("Verknüpfte Immobilie existiert nicht.", { linkedPropertyId: "Unbekannte Immobilie." });
  }
}

export class LinkedContractNotFoundError extends FieldValidationError {
  constructor() {
    super("Verknüpfter Vertrag existiert nicht.", { linkedContractId: "Unbekannter Vertrag." });
  }
}

export function isFileNotFound(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}
