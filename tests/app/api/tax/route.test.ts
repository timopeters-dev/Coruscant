import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { unzipSync } from "fflate";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as dbModule from "@/backend/db/connection";
import { createDocumentRecord } from "@/backend/db/queries/documents";
import { documents } from "@/backend/db/schema";
import { eq } from "drizzle-orm";
import * as pdfStorage from "@/backend/storage/pdf-storage";
import { savePdfFile } from "@/backend/storage/pdf-storage";
import { GET as exportRoute } from "@/app/api/tax/export/route";
import { GET as summaryRoute } from "@/app/api/tax/summary/route";

const tempDirs: string[] = [];
const originalDbUrl = process.env.DATABASE_URL;
const originalDocsDir = process.env.DOCUMENTS_DIR;

beforeEach(() => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "coruscant-tax-api-"));
  tempDirs.push(dir);
  process.env.DATABASE_URL = path.join(dir, "test.db");
  process.env.DOCUMENTS_DIR = path.join(dir, "documents");
});

afterEach(() => {
  vi.restoreAllMocks();
  dbModule.closeDb();
  if (originalDbUrl === undefined) delete process.env.DATABASE_URL;
  else process.env.DATABASE_URL = originalDbUrl;
  if (originalDocsDir === undefined) delete process.env.DOCUMENTS_DIR;
  else process.env.DOCUMENTS_DIR = originalDocsDir;
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) fs.rmSync(dir, { recursive: true, force: true });
  }
});

interface SeedOptions {
  label: string;
  status?: "verified" | "pending_review";
  isTaxRelevant?: boolean;
  taxYear?: number | null;
  taxCategory?: "handwerker_35a" | "haushaltsnahe_dl_35a" | null;
  totalAmountCents?: number | null;
  deductibleAmountCents?: number | null;
}

function seed(o: SeedOptions) {
  const bytes = Buffer.from(`%PDF-1.4\n${o.label}\n%%EOF\n`);
  const saved = savePdfFile(bytes, 2025);
  const doc = createDocumentRecord({
    filename: `${o.label}.pdf`,
    storagePath: saved.storagePath,
    sha256Hash: saved.sha256Hash,
    issuer: "Musterbetrieb GmbH",
    documentDate: "2025-05-10",
    totalAmountCents: o.totalAmountCents === undefined ? 100_000 : o.totalAmountCents,
    isTaxRelevant: o.isTaxRelevant ?? true,
    taxYear: o.taxYear === undefined ? 2025 : o.taxYear,
    taxCategory: o.taxCategory === undefined ? "handwerker_35a" : o.taxCategory,
    deductibleAmountCents: o.deductibleAmountCents === undefined ? 60_000 : o.deductibleAmountCents,
  });
  if ((o.status ?? "verified") === "verified") {
    dbModule
      .getDb()
      .update(documents)
      .set({ status: "verified" })
      .where(eq(documents.id, doc.id))
      .run();
  }
  return { id: doc.id, bytes, storagePath: saved.storagePath };
}

function seedYear() {
  return {
    h1: seed({ label: "handwerker-1" }),
    h2: seed({ label: "handwerker-2", totalAmountCents: 50_000, deductibleAmountCents: 30_000 }),
    dl: seed({
      label: "dl-1",
      taxCategory: "haushaltsnahe_dl_35a",
      totalAmountCents: 20_000,
      deductibleAmountCents: 20_000,
    }),
    un: seed({ label: "unassigned-1", taxCategory: null, deductibleAmountCents: null }),
    pending: seed({ label: "pending-1", status: "pending_review" }),
    other: seed({ label: "vorjahr-1", taxYear: 2024 }),
    nonTax: seed({ label: "nontax-1", isTaxRelevant: false }),
  };
}

const req = (url: string) => new Request(`http://localhost${url}`);

describe("GET /api/tax/summary", () => {
  it("liefert korrekte Bucket-Summen ohne storagePath", async () => {
    seedYear();
    const res = await summaryRoute(req("/api/tax/summary?year=2025"));
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).not.toContain("storagePath");
    const body = JSON.parse(text);
    expect(body.availableYears).toEqual([2025, 2024]);
    expect(body.summary.documentCount).toBe(4);
    expect(body.summary.pendingReviewCount).toBe(1);
    const handwerker = body.summary.buckets.find((b: { bucket: string }) => b.bucket === "handwerker_35a");
    expect(handwerker.documentCount).toBe(2);
    expect(handwerker.totalAmountCents).toBe(150_000);
    expect(handwerker.deductibleAmountCents).toBe(90_000);
    expect(handwerker.section35a.creditCents).toBe(18_000);
    expect(body.summary.buckets.map((b: { bucket: string }) => b.bucket)).toEqual([
      "handwerker_35a",
      "haushaltsnahe_dl_35a",
      "unassigned",
    ]);
    expect(body.summary.incompleteCount).toBe(1);
  });

  it.each(["", "abc", "1899", "2101", "2025.5"])("400 für year=%j", async (year) => {
    const res = await summaryRoute(req(`/api/tax/summary?year=${year}`));
    expect(res.status).toBe(400);
  });

  it("400 bei fehlendem year", async () => {
    expect((await summaryRoute(req("/api/tax/summary"))).status).toBe(400);
  });

  it("leeres Jahr → 200 mit documentCount 0", async () => {
    const res = await summaryRoute(req("/api/tax/summary?year=2020"));
    expect(res.status).toBe(200);
    expect((await res.json()).summary.documentCount).toBe(0);
  });
});

describe("GET /api/tax/export", () => {
  it("ZIP enthält genau die verifizierten, steuerrelevanten PDFs des Jahres", async () => {
    const seeded = seedYear();
    const res = await exportRoute(req("/api/tax/export?year=2025"));
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("application/zip");
    expect(res.headers.get("Content-Disposition")).toBe(
      'attachment; filename="Steuer-Belegmappe_2025.zip"',
    );
    expect(res.headers.get("Cache-Control")).toBe("private, no-store");
    expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(res.headers.get("X-Missing-Receipts")).toBe("0");

    const entries = unzipSync(new Uint8Array(await res.arrayBuffer()));
    const names = Object.keys(entries);
    const root = "Steuer-Belegmappe_2025/";
    expect(names).toEqual(
      expect.arrayContaining([`${root}LIESMICH.txt`, `${root}uebersicht.csv`, `${root}uebersicht.json`]),
    );
    const pdfs = names.filter((n) => n.endsWith(".pdf"));
    expect(pdfs).toHaveLength(4);
    const contents = pdfs.map((n) => Buffer.from(entries[n] as Uint8Array));
    for (const c of contents) expect(c.subarray(0, 5).toString("ascii")).toBe("%PDF-");
    const expected = [seeded.h1, seeded.h2, seeded.dl, seeded.un].map((s) => s.bytes);
    for (const bytes of expected) {
      expect(contents.some((c) => c.equals(bytes))).toBe(true);
    }
    for (const excluded of [seeded.pending, seeded.other, seeded.nonTax]) {
      expect(contents.some((c) => c.equals(excluded.bytes))).toBe(false);
    }
  });

  it("fehlende Datei → 200, X-Missing-Receipts 1, missing: true", async () => {
    const seeded = seedYear();
    fs.rmSync(path.join(process.env.DOCUMENTS_DIR as string, seeded.h1.storagePath));
    const res = await exportRoute(req("/api/tax/export?year=2025"));
    expect(res.status).toBe(200);
    expect(res.headers.get("X-Missing-Receipts")).toBe("1");
    const entries = unzipSync(new Uint8Array(await res.arrayBuffer()));
    const root = "Steuer-Belegmappe_2025/";
    const json = JSON.parse(Buffer.from(entries[`${root}uebersicht.json`] as Uint8Array).toString("utf8"));
    expect(json.files.filter((f: { missing: boolean }) => f.missing)).toHaveLength(1);
    expect(Buffer.from(entries[`${root}LIESMICH.txt`] as Uint8Array).toString("utf8")).toContain("handwerker-1.pdf");
  });

  it("csv und json mit passenden Content-Types", async () => {
    seedYear();
    const csv = await exportRoute(req("/api/tax/export?year=2025&format=csv"));
    expect(csv.status).toBe(200);
    expect(csv.headers.get("Content-Type")).toBe("text/csv; charset=utf-8");
    expect(await csv.text()).toContain("Kategorie;Belegdatum;");

    const json = await exportRoute(req("/api/tax/export?year=2025&format=json"));
    expect(json.headers.get("Content-Type")).toBe("application/json; charset=utf-8");
    const body = await json.json();
    expect(body.taxYear).toBe(2025);
    expect(body.files).toBeUndefined();
    expect(JSON.stringify(body)).not.toContain("storagePath");
  });

  it("ungültiges Format oder Jahr → 400", async () => {
    seedYear();
    expect((await exportRoute(req("/api/tax/export?year=2025&format=pdf"))).status).toBe(400);
    expect((await exportRoute(req("/api/tax/export?year=abc"))).status).toBe(400);
    expect((await exportRoute(req("/api/tax/export"))).status).toBe(400);
  });

  it("leeres Jahr → 404", async () => {
    seedYear();
    expect((await exportRoute(req("/api/tax/export?year=2020"))).status).toBe(404);
  });

  it("Größenlimit → 413 ohne PDFs zu lesen", async () => {
    seedYear();
    vi.spyOn(pdfStorage, "getPdfFileSize").mockReturnValue(300 * 1024 * 1024);
    const readSpy = vi.spyOn(pdfStorage, "readPdfFile");
    const res = await exportRoute(req("/api/tax/export?year=2025"));
    expect(res.status).toBe(413);
    expect(readSpy).not.toHaveBeenCalled();
  });

  it("manipulierter storagePath gilt als fehlend", async () => {
    const seeded = seedYear();
    dbModule
      .getDb()
      .update(documents)
      .set({ storagePath: "../../etc/passwd" })
      .where(eq(documents.id, seeded.h1.id))
      .run();
    const readSpy = vi.spyOn(pdfStorage, "readPdfFile");
    const res = await exportRoute(req("/api/tax/export?year=2025"));
    expect(res.status).toBe(200);
    expect(res.headers.get("X-Missing-Receipts")).toBe("1");
    expect(readSpy.mock.calls.every(([p]) => p !== "../../etc/passwd")).toBe(true);
  });
});
