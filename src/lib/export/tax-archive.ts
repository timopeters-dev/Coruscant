import { type Zippable, zipSync } from "fflate";
import {
  buildReadmeText,
  buildReceiptArchivePath,
  buildTaxSummaryCsv,
  buildTaxSummaryJson,
} from "@/lib/domain/tax-export";
import type { TaxYearSummary } from "@/lib/domain/tax-summary";
import { getPdfFileSize, readPdfFile } from "@/lib/storage/pdf-storage";

export const MAX_TAX_EXPORT_BYTES = 250 * 1024 * 1024;

export class TaxExportTooLargeError extends Error {
  constructor(maxBytes: number = MAX_TAX_EXPORT_BYTES) {
    super(
      `Die Belegmappe überschreitet das Limit von ${Math.floor(maxBytes / (1024 * 1024))} MB.`,
    );
    this.name = "TaxExportTooLargeError";
  }
}

export interface TaxArchiveResult {
  zip: Uint8Array;
  missingFiles: { documentId: string; filename: string }[];
}

const encoder = new TextEncoder();

export function buildTaxArchive(input: {
  summary: TaxYearSummary;
  storagePathById: ReadonlyMap<string, string>;
  generatedAt: string;
  maxBytes?: number;
}): TaxArchiveResult {
  const { summary, storagePathById, generatedAt } = input;
  const maxBytes = input.maxBytes ?? MAX_TAX_EXPORT_BYTES;

  // 1. Größen vorab prüfen, bevor etwas gelesen wird.
  let totalBytes = 0;
  const present: typeof summary.items = [];
  const missingFiles: TaxArchiveResult["missingFiles"] = [];
  for (const item of summary.items) {
    const storagePath = storagePathById.get(item.documentId);
    const size = storagePath ? getPdfFileSize(storagePath) : null;
    if (size === null) {
      missingFiles.push({ documentId: item.documentId, filename: item.filename });
      continue;
    }
    totalBytes += size;
    if (totalBytes > maxBytes) {
      throw new TaxExportTooLargeError(maxBytes);
    }
    present.push(item);
  }

  // 2. PDFs lesen (Race: zwischenzeitlich entfernte Dateien gelten als fehlend).
  const root = `Steuer-Belegmappe_${summary.taxYear}`;
  const files: Zippable = {};
  const archivePathById = new Map<string, string>();
  for (const item of present) {
    const storagePath = storagePathById.get(item.documentId) as string;
    let bytes: Buffer;
    try {
      bytes = readPdfFile(storagePath);
    } catch {
      missingFiles.push({ documentId: item.documentId, filename: item.filename });
      continue;
    }
    const archivePath = buildReceiptArchivePath(item);
    archivePathById.set(item.documentId, archivePath);
    files[`${root}/${archivePath}`] = [bytes, { level: 0 }];
  }

  const missingIds = new Set(missingFiles.map((f) => f.documentId));
  files[`${root}/LIESMICH.txt`] = encoder.encode(
    buildReadmeText(summary, { generatedAt, missingFiles }),
  );
  files[`${root}/uebersicht.csv`] = encoder.encode(
    buildTaxSummaryCsv(summary, archivePathById),
  );
  files[`${root}/uebersicht.json`] = encoder.encode(
    buildTaxSummaryJson(summary, {
      generatedAt,
      archivePathById,
      missingDocumentIds: missingIds,
    }),
  );

  return {
    zip: zipSync(files, { mtime: new Date(generatedAt) }),
    missingFiles,
  };
}
