import { describe, expect, it } from "vitest";
import {
  buildReadmeText,
  buildReceiptArchivePath,
  buildTaxSummaryCsv,
  buildTaxSummaryJson,
  slugifyForArchive,
  TAX_EXPORT_SCHEMA_VERSION,
} from "./tax-export";
import {
  summarizeTaxYear,
  type TaxSummaryInputDocument,
  type TaxSummaryItem,
} from "./tax-summary";

function makeDoc(o: Partial<TaxSummaryInputDocument> = {}): TaxSummaryInputDocument {
  return {
    id: "doc-12345678-abcd",
    filename: "rechnung.pdf",
    status: "verified",
    documentDate: "2025-06-15",
    issuer: "Musterbetrieb GmbH",
    totalAmountCents: 120_000,
    linkedPropertyId: null,
    isTaxRelevant: true,
    taxYear: 2025,
    taxCategory: "handwerker_35a",
    deductibleAmountCents: 84_000,
    ...o,
  };
}

function makeItem(o: Partial<TaxSummaryItem> = {}): TaxSummaryItem {
  return {
    documentId: "doc-12345678-abcd",
    filename: "rechnung.pdf",
    issuer: "Musterbetrieb GmbH",
    documentDate: "2025-06-15",
    linkedPropertyId: null,
    bucket: "handwerker_35a",
    totalAmountCents: 1,
    deductibleAmountCents: 1,
    issues: [],
    ...o,
  };
}

describe("slugifyForArchive", () => {
  it("transliteriert Umlaute und ß", () => {
    expect(slugifyForArchive("Müller Bäckerei Straße")).toBe("Mueller-Baeckerei-Strasse");
  });
  it("ersetzt Sonderzeichen und neutralisiert Pfadtrenner", () => {
    const slug = slugifyForArchive("../../etc/passwd");
    expect(slug).not.toContain("/");
    expect(slug).not.toContain("..");
  });
  it("leer → beleg", () => {
    expect(slugifyForArchive("")).toBe("beleg");
    expect(slugifyForArchive("///")).toBe("beleg");
  });
  it("kappt die Länge", () => {
    expect(slugifyForArchive("a".repeat(200), 60)).toHaveLength(60);
  });
});

describe("buildReceiptArchivePath", () => {
  it("ist deterministisch und nutzt Bucket-Position", () => {
    const item = makeItem();
    const path = buildReceiptArchivePath(item);
    expect(path).toBe("belege/00_handwerker_35a/2025-06-15_Musterbetrieb-GmbH_doc-1234.pdf");
    expect(buildReceiptArchivePath(item)).toBe(path);
  });
  it("ohne Datum → ohne-datum", () => {
    expect(buildReceiptArchivePath(makeItem({ documentDate: null }))).toContain("/ohne-datum_");
  });
  it("gleicher Aussteller/Datum, andere ID → anderer Pfad", () => {
    expect(buildReceiptArchivePath(makeItem({ documentId: "aaaaaaaa-1" }))).not.toBe(
      buildReceiptArchivePath(makeItem({ documentId: "bbbbbbbb-1" })),
    );
  });
  it("unassigned liegt in Ordner 05", () => {
    expect(buildReceiptArchivePath(makeItem({ bucket: "unassigned" }))).toContain("/05_unassigned/");
  });
});

describe("buildTaxSummaryCsv", () => {
  it("BOM, Semikolon, CRLF, Header und Beträge", () => {
    const summary = summarizeTaxYear(
      [
        makeDoc({ id: "a", totalAmountCents: 0, deductibleAmountCents: 0 }),
        makeDoc({ id: "b", totalAmountCents: 1205, deductibleAmountCents: 1205 }),
        makeDoc({ id: "c", totalAmountCents: 123_456_789, deductibleAmountCents: null }),
      ],
      2025,
    );
    const csv = buildTaxSummaryCsv(summary, new Map([["a", "belege/x.pdf"]]));
    expect(csv.startsWith("\uFEFFKategorie;Belegdatum;")).toBe(true);
    const lines = csv.split("\r\n");
    expect(lines).toHaveLength(5);
    expect(lines[1]).toContain(";0,00;0,00;");
    expect(lines[1]?.endsWith(";belege/x.pdf")).toBe(true);
    expect(lines[2]).toContain(";12,05;12,05;");
    expect(lines[3]).toContain(";1234567,89;;Lohnanteil fehlt;");
  });

  it("quotet Semikolon, Anführungszeichen und Zeilenumbrüche", () => {
    const summary = summarizeTaxYear(
      [makeDoc({ issuer: 'Muster; "Test"\nGmbH' })],
      2025,
    );
    expect(buildTaxSummaryCsv(summary)).toContain('"Muster; ""Test""\nGmbH"');
  });

  it("schützt vor Formel-Injection", () => {
    for (const evil of ["=HYPERLINK(\"x\")", "+1", "-1", "@SUM(A1)"]) {
      const summary = summarizeTaxYear([makeDoc({ issuer: evil })], 2025);
      const csv = buildTaxSummaryCsv(summary);
      expect(csv).toContain(`'${evil.replace(/"/g, '""')}`);
      expect(csv).not.toMatch(new RegExp(`;${evil.replace(/[$()+@]/g, "\\$&").replace(/"/g, '""')}`));
    }
  });
});

describe("buildTaxSummaryJson", () => {
  const summary = summarizeTaxYear([makeDoc()], 2025);

  it("enthält schemaVersion, Integer-Cent, files mit missing-Flag, keinen storagePath", () => {
    const json = buildTaxSummaryJson(summary, {
      generatedAt: "2026-11-17T10:00:00.000Z",
      archivePathById: new Map([["doc-12345678-abcd", "belege/x.pdf"]]),
      missingDocumentIds: new Set(["doc-12345678-abcd"]),
    });
    const parsed = JSON.parse(json);
    expect(parsed.schemaVersion).toBe(TAX_EXPORT_SCHEMA_VERSION);
    expect(parsed.summary.totalAmountCents).toBe(120_000);
    expect(parsed.files).toEqual([
      { documentId: "doc-12345678-abcd", path: "belege/x.pdf", missing: true },
    ]);
    expect(json).not.toContain("storagePath");
  });

  it("lässt files ohne archivePathById weg", () => {
    const parsed = JSON.parse(buildTaxSummaryJson(summary, { generatedAt: "x" }));
    expect(parsed.files).toBeUndefined();
  });
});

describe("buildReadmeText", () => {
  it("enthält Disclaimer und fehlende Dateien", () => {
    const text = buildReadmeText(summarizeTaxYear([makeDoc()], 2025), {
      generatedAt: "2026-11-17T10:00:00.000Z",
      missingFiles: [{ documentId: "doc-1", filename: "weg.pdf" }],
    });
    expect(text).toContain("keine Steuerberatung");
    expect(text).toContain("weg.pdf");
  });
  it("ohne fehlende Dateien keine Liste", () => {
    const text = buildReadmeText(summarizeTaxYear([], 2025), {
      generatedAt: "x",
      missingFiles: [],
    });
    expect(text).not.toContain("Übersprungene");
  });
});
