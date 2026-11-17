/**
 * Muster zur Erkennung personenbezogener Freitext-Fragmente (rein, ohne Abhängigkeiten).
 * IBAN: Länderkürzel + 2 Prüfziffern + gruppierte Blöcke (mit/ohne Leerzeichen).
 * Die 4er-Blöcke müssen mindestens eine Ziffer enthalten, damit nachfolgende Wörter
 * nicht mitmaskiert werden.
 */
const IBAN_SOURCE =
  "\\b[a-z]{2}\\d{2}(?: ?(?=[a-z0-9]{0,3}\\d)[a-z0-9]{4}){2,7}(?: ?[a-z0-9]{1,3})?\\b";
const EMAIL_SOURCE = "[a-z0-9._%+-]+@[a-z0-9.-]+\\.[a-z]{2,}";

/** Kürzeste IBAN (Norwegen) hat 15 Zeichen; ISINs (12 Zeichen) sind damit keine IBANs. */
const MIN_IBAN_LENGTH = 15;

export function createIbanRegex(): RegExp {
  return new RegExp(IBAN_SOURCE, "gi");
}

export function isIbanLike(candidate: string): boolean {
  return candidate.replace(/\s/g, "").length >= MIN_IBAN_LENGTH;
}

export function createEmailRegex(): RegExp {
  return new RegExp(EMAIL_SOURCE, "gi");
}

export function containsIban(text: string): boolean {
  for (const match of text.matchAll(createIbanRegex())) {
    if (isIbanLike(match[0])) return true;
  }
  return false;
}

export function containsEmail(text: string): boolean {
  return createEmailRegex().test(text);
}

/** Ziffernfolge mit mindestens 8 zusammenhängenden Stellen (z. B. Kontonummer). */
export function containsLongDigitRun(text: string, minDigits = 8): boolean {
  return new RegExp(`\\d{${minDigits},}`).test(text);
}
