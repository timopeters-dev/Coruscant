/** Schutz vor personenbezogenen Daten: Prüfung der anonymisierten Sicht und freier Berater-Fragen. */
import type { AdvisorReport } from "./types";
import { containsEmail, containsIban, containsLongDigitRun } from "@/domain/core/pii-patterns";
import { KIND_LABEL_DE } from "@/domain/recommendation/text";
import type { AdvisorReportView } from "./view-types";

export type AdvisorQuestionIssue = "iban" | "email" | "digit_run" | "known_name";

export interface AdvisorQuestionCheckResult {
  ok: boolean;
  issues: AdvisorQuestionIssue[];
}

export class AdvisorReportPiiError extends Error {
  readonly fieldPath: string;
  readonly reason: AdvisorQuestionIssue;

  constructor(fieldPath: string, reason: AdvisorQuestionIssue) {
    super(
      `PII detected in anonymized advisor report at "${fieldPath}" (${reason})`,
    );
    this.name = "AdvisorReportPiiError";
    this.fieldPath = fieldPath;
    this.reason = reason;
  }
}


export const GENERIC_FINANCE_TERMS: ReadonlySet<string> = new Set([
  "kredit",
  "kredite",
  "darlehen",
  "bauspar",
  "bausparer",
  "bausparvertrag",
  "annuität",
  "annuitaet",
  "tilgung",
  "endfällig",
  "sondertilgung",
  "tilgungsreserve",
  "wohnung",
  "haus",
  "topf",
  "töpfe",
  "ziel-topf",
  "notgroschen",
  "urlaub",
  "rücklage",
  "ruecklage",
  "immobilie",
  "immobilien",
  "konto",
  "sparen",
  "tagesgeld",
  "depot",
  "haushalt",
  "haushalts-app",
  "haushaltskonto",
  "geld",
  "zinsen",
  "zins",
  "rate",
  "sparrate",
  "miete",
  "kaltmiete",
  "vermietet",
  "eigengenutzt",
  "investition",
  "sparziel",
  "ohne zweck",
  "puffer",
  "reserve",
  "bank",
  "vertrag",
  "verträge",
  "guthaben",
  "schulden",
  "bilanz",
  "meilenstein",
  "etf",
]);

const VIEW_VOCABULARY_TERMS: ReadonlySet<string> = new Set([
  ...GENERIC_FINANCE_TERMS,
  ...Object.values(KIND_LABEL_DE).map((label) =>
    label.normalize("NFKC").trim().replace(/\s+/g, " ").toLowerCase(),
  ),
]);


function normalizeSensitive(value: string): string {
  return value.normalize("NFKC").trim().replace(/\s+/g, " ").toLowerCase();
}

export function collectSensitiveStrings(report: AdvisorReport): string[] {
  const unique = new Set<string>();
  for (const label of Object.values(report.labels)) {
    for (const candidate of [
      label.name,
      label.provider,
      label.milestoneLabel,
      label.loanOptionsNote,
    ]) {
      if (typeof candidate !== "string") continue;
      const normalized = normalizeSensitive(candidate);
      if (normalized.length >= 3) {
        unique.add(normalized);
      }
    }
  }
  return Array.from(unique).sort();
}

function walkStrings(
  value: unknown,
  path: string,
  visit: (str: string, fieldPath: string) => void,
): void {
  if (typeof value === "string") {
    visit(value, path);
    return;
  }
  if (value === null || value === undefined || typeof value !== "object") {
    return;
  }
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i += 1) {
      walkStrings(value[i], `${path}[${i}]`, visit);
    }
    return;
  }
  for (const [key, nested] of Object.entries(value)) {
    const nextPath = path.length > 0 ? `${path}.${key}` : key;
    walkStrings(nested, nextPath, visit);
  }
}

export function assertAnonymizedViewClean(
  view: AdvisorReportView,
  sensitive: readonly string[],
): void {
  const matchers = sensitive
    .map((s) => normalizeSensitive(s))
    .filter((s) => s.length >= 3 && !VIEW_VOCABULARY_TERMS.has(s))
    .map(
      (term) =>
        new RegExp(
          `(?<![\\p{L}\\p{N}])${escapeRegExp(term)}(?![\\p{L}\\p{N}])`,
          "u",
        ),
    );

  walkStrings(view, "", (str, fieldPath) => {
    if (containsIban(str)) {
      throw new AdvisorReportPiiError(fieldPath, "iban");
    }
    if (containsEmail(str)) {
      throw new AdvisorReportPiiError(fieldPath, "email");
    }
    if (containsLongDigitRun(str, 8)) {
      throw new AdvisorReportPiiError(fieldPath, "digit_run");
    }
    const normalizedStr = normalizeSensitive(str);
    for (const pattern of matchers) {
      if (pattern.test(normalizedStr)) {
        throw new AdvisorReportPiiError(fieldPath, "known_name");
      }
    }
  });
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function extractQuestionMatchTerms(sensitive: readonly string[]): string[] {
  const terms = new Set<string>();
  for (const raw of sensitive) {
    const normalized = normalizeSensitive(raw);
    if (normalized.length >= 3 && !/^\d+$/.test(normalized) && !GENERIC_FINANCE_TERMS.has(normalized)) {
      terms.add(normalized);
    }
    const words = normalized.match(/[\p{L}\p{N}]+/gu) ?? [];
    for (const word of words) {
      if (word.length < 4) continue;
      if (/^\d+$/.test(word)) continue;
      if (GENERIC_FINANCE_TERMS.has(word)) continue;
      terms.add(word);
    }
  }
  return Array.from(terms);
}

export function checkAdvisorQuestion(
  text: string,
  sensitive: readonly string[],
): AdvisorQuestionCheckResult {
  const normalized = text.normalize("NFKC").trim();
  if (normalized.length === 0) {
    return { ok: true, issues: [] };
  }

  const issues: AdvisorQuestionIssue[] = [];
  if (containsIban(normalized)) {
    issues.push("iban");
  }
  if (containsEmail(normalized)) {
    issues.push("email");
  }
  if (containsLongDigitRun(normalized, 8)) {
    issues.push("digit_run");
  }

  const lowerText = normalized.replace(/\s+/g, " ").toLowerCase();
  const terms = extractQuestionMatchTerms(sensitive);
  for (const term of terms) {
    const pattern = new RegExp(
      `(?<![\\p{L}\\p{N}])${escapeRegExp(term)}(?![\\p{L}\\p{N}])`,
      "u",
    );
    if (pattern.test(lowerText)) {
      issues.push("known_name");
      break;
    }
  }

  return {
    ok: issues.length === 0,
    issues,
  };
}
