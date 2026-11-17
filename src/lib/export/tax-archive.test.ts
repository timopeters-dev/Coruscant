import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { unzipSync } from "fflate";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { summarizeTaxYear, type TaxSummaryInputDocument } from "@/lib/domain/tax-summary";
import { savePdfFile } from "@/lib/storage/pdf-storage";
import { buildTaxArchive, TaxExportTooLargeError } from "./tax-archive";

const GENERATED_AT = "2026-11-17T10:00:00.000Z";
const originalDocsDir = process.env.DOCUMENTS_DIR;
let tempDir: string;

function pdfBytes(extra: string): Buffer {
  return Buffer.from(`%PDF-1.4\n${extra.repeat(200)}\n%%EOF\n`);
}

function makeDoc(id: string, o: Partial<TaxSummaryInputDocument> = {}): TaxSummaryInputDocument {
  return {
    id,
    filename: "Rechnung_Müller.pdf",
    status: "verified",
    documentDate: "2025-06-15",
    issuer: "Muster Gebäudereinigung",
    totalAmountCents: 10_000,
    linkedPropertyId: null,
    isTaxRelevant: true,
    taxYear: 2025,
    taxCategory: "haushaltsnahe_dl_35a",
    deductibleAmountCents: 8_000,
    ...o,
  };
}

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "coruscant-tax-archive-"));
  process.env.DOCUMENTS_DIR = tempDir;
});

afterEach(() => {
  if (originalDocsDir === undefined) delete process.env.DOCUMENTS_DIR;
  else process.env.DOCUMENTS_DIR = originalDocsDir;
  fs.rmSync(tempDir, { recursive: true, force: true });
});

function seed() {
  const a = savePdfFile(pdfBytes("a"), 2025);
  const b = savePdfFile(pdfBytes("b"), 2025);
  const summary = summarizeTaxYear([makeDoc("aaaaaaaa-1"), makeDoc("bbbbbbbb-2")], 2025);
  const storagePathById = new Map([
    ["aaaaaaaa-1", a.storagePath],
    ["bbbbbbbb-2", b.storagePath],
  ]);
  return { summary, storagePathById };
}

describe("buildTaxArchive", () => {
  it("ist bei fixem generatedAt deterministisch", () => {
    const { summary, storagePathById } = seed();
    const one = buildTaxArchive({ summary, storagePathById, generatedAt: GENERATED_AT });
    const two = buildTaxArchive({ summary, storagePathById, generatedAt: GENERATED_AT });
    expect(Buffer.from(one.zip).equals(Buffer.from(two.zip))).toBe(true);
  });

  it("speichert PDFs unkomprimiert und enthält Übersichtsdateien", () => {
    const { summary, storagePathById } = seed();
    const { zip, missingFiles } = buildTaxArchive({ summary, storagePathById, generatedAt: GENERATED_AT });
    expect(missingFiles).toEqual([]);
    const entries = unzipSync(zip);
    const names = Object.keys(entries);
    const root = "Steuer-Belegmappe_2025/";
    expect(names).toEqual(
      expect.arrayContaining([`${root}LIESMICH.txt`, `${root}uebersicht.csv`, `${root}uebersicht.json`]),
    );
    const pdfNames = names.filter((n) => n.endsWith(".pdf"));
    expect(pdfNames).toHaveLength(2);
    expect(pdfNames[0]).toContain("Muster-Gebaeudereinigung");
    // level 0 → ZIP ist mindestens so groß wie die Roh-PDFs
    const rawSize = pdfBytes("a").byteLength + pdfBytes("b").byteLength;
    expect(zip.byteLength).toBeGreaterThan(rawSize);
    // CSV: UTF-8 mit BOM, korrekte Umlaute im Dateinamen
    const csv = Buffer.from(entries[`${root}uebersicht.csv`] as Uint8Array).toString("utf8");
    expect(csv).toContain("Rechnung_Müller.pdf");
  });

  it("überspringt fehlende Dateien und weist sie aus", () => {
    const { summary, storagePathById } = seed();
    fs.rmSync(path.join(tempDir, storagePathById.get("bbbbbbbb-2") as string));
    const { zip, missingFiles } = buildTaxArchive({ summary, storagePathById, generatedAt: GENERATED_AT });
    expect(missingFiles.map((f) => f.documentId)).toEqual(["bbbbbbbb-2"]);
    const entries = unzipSync(zip);
    expect(Object.keys(entries).filter((n) => n.endsWith(".pdf"))).toHaveLength(1);
    const json = JSON.parse(
      Buffer.from(entries["Steuer-Belegmappe_2025/uebersicht.json"] as Uint8Array).toString("utf8"),
    );
    expect(json.files.find((f: { documentId: string }) => f.documentId === "bbbbbbbb-2").missing).toBe(true);
  });

  it("wirft TaxExportTooLargeError über dem Limit", () => {
    const { summary, storagePathById } = seed();
    expect(() =>
      buildTaxArchive({ summary, storagePathById, generatedAt: GENERATED_AT, maxBytes: 10 }),
    ).toThrow(TaxExportTooLargeError);
  });

  it("behandelt manipulierte storagePaths als fehlend", () => {
    const summary = summarizeTaxYear([makeDoc("aaaaaaaa-1")], 2025);
    const { missingFiles } = buildTaxArchive({
      summary,
      storagePathById: new Map([["aaaaaaaa-1", "../../etc/passwd"]]),
      generatedAt: GENERATED_AT,
    });
    expect(missingFiles).toHaveLength(1);
  });
});
