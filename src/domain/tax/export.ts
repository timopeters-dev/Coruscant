import { formatDateTimeDE } from "@/domain/core/date-format";
import { TAX_BUCKET_LABELS, TAX_DISCLAIMER, TAX_ISSUE_LABELS } from "./labels";
import {
  TAX_BUCKETS,
  type TaxBucket,
  type TaxSummaryItem,
  type TaxYearSummary,
} from "./summary";

export const TAX_EXPORT_SCHEMA_VERSION = 1;

const TRANSLITERATIONS: Record<string, string> = {
  ä: "ae",
  ö: "oe",
  ü: "ue",
  Ä: "Ae",
  Ö: "Oe",
  Ü: "Ue",
  ß: "ss",
};

export function slugifyForArchive(input: string, maxLength = 60): string {
  const transliterated = input.replace(/[äöüÄÖÜß]/g, (c) => TRANSLITERATIONS[c] ?? c);
  const slug = transliterated
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^A-Za-z0-9._-]/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/\.{2,}/g, ".")
    .slice(0, Math.max(1, maxLength))
    .replace(/^[-.]+|[-.]+$/g, "");
  return slug.length > 0 ? slug : "beleg";
}

export function buildReceiptArchivePath(item: TaxSummaryItem): string {
  const index = TAX_BUCKETS.indexOf(item.bucket);
  const nn = String(index).padStart(2, "0");
  const date = item.documentDate ?? "ohne-datum";
  const label = slugifyForArchive(item.issuer ?? item.filename);
  const id8 = slugifyForArchive(item.documentId.slice(0, 8));
  return `belege/${nn}_${item.bucket}/${slugifyForArchive(date, 10)}_${label}_${id8}.pdf`;
}

function formatCentsCsv(cents: number | null): string {
  if (cents === null) return "";
  const euros = Math.trunc(cents / 100);
  const rest = cents % 100;
  return `${euros},${String(rest).padStart(2, "0")}`;
}

function csvCell(value: string): string {
  let text = value;
  if (/^[=+\-@\t\r]/.test(text)) {
    text = `'${text}`;
  }
  if (/[;"\r\n]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

const CSV_HEADER = [
  "Kategorie",
  "Belegdatum",
  "Aussteller",
  "Dateiname",
  "Gesamtbetrag",
  "Absetzbar",
  "Hinweise",
  "Datei in Mappe",
];

export function buildTaxSummaryCsv(
  summary: TaxYearSummary,
  archivePathById: ReadonlyMap<string, string> = new Map(),
  labels: Record<TaxBucket, string> = TAX_BUCKET_LABELS,
): string {
  const rows: string[] = [CSV_HEADER.join(";")];
  for (const item of summary.items) {
    const cells = [
      csvCell(labels[item.bucket]),
      csvCell(item.documentDate ?? ""),
      csvCell(item.issuer ?? ""),
      csvCell(item.filename),
      formatCentsCsv(item.totalAmountCents),
      formatCentsCsv(item.deductibleAmountCents),
      csvCell(item.issues.map((i) => TAX_ISSUE_LABELS[i]).join(", ")),
      csvCell(archivePathById.get(item.documentId) ?? ""),
    ];
    rows.push(cells.join(";"));
  }
  return `\uFEFF${rows.join("\r\n")}\r\n`;
}

export interface TaxJsonOptions {
  generatedAt: string;
  /** Wenn gesetzt, wird ein `files`-Block erzeugt (nur ZIP). */
  archivePathById?: ReadonlyMap<string, string>;
  missingDocumentIds?: ReadonlySet<string>;
}

export function buildTaxSummaryJson(
  summary: TaxYearSummary,
  options: TaxJsonOptions,
): string {
  const payload: Record<string, unknown> = {
    schemaVersion: TAX_EXPORT_SCHEMA_VERSION,
    generatedAt: options.generatedAt,
    taxYear: summary.taxYear,
    disclaimer: TAX_DISCLAIMER,
    summary,
  };
  if (options.archivePathById) {
    const missing = options.missingDocumentIds ?? new Set<string>();
    payload.files = summary.items.map((item) => ({
      documentId: item.documentId,
      path: options.archivePathById?.get(item.documentId) ?? null,
      missing: missing.has(item.documentId),
    }));
  }
  return JSON.stringify(payload, null, 2);
}

export function buildReadmeText(
  summary: TaxYearSummary,
  options: {
    generatedAt: string;
    missingFiles: readonly { documentId: string; filename: string }[];
  },
): string {
  const lines = [
    `Steuer-Belegmappe ${summary.taxYear}`,
    `Erstellt am: ${formatDateTimeDE(options.generatedAt)}`,
    "",
    "Inhalt:",
    "- uebersicht.csv  (Excel/LibreOffice, Semikolon, UTF-8)",
    "- uebersicht.json (maschinenlesbar, Beträge in Cent)",
    "- belege/         (PDF-Belege nach Kategorie)",
    "",
    `Belege: ${summary.documentCount} (unvollständig: ${summary.incompleteCount})`,
  ];
  if (summary.pendingReviewCount > 0) {
    lines.push(
      `Hinweis: ${summary.pendingReviewCount} Beleg(e) des Jahres sind noch in Prüfung und nicht enthalten.`,
    );
  }
  if (options.missingFiles.length > 0) {
    lines.push("", "Übersprungene Belege (PDF-Datei nicht gefunden):");
    for (const file of options.missingFiles) {
      lines.push(`- ${file.filename} (${file.documentId})`);
    }
  }
  lines.push("", TAX_DISCLAIMER, "");
  return lines.join("\r\n");
}
