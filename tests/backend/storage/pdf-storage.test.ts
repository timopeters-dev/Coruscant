import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  InvalidPdfError,
  MAX_PDF_SIZE_BYTES,
  PathTraversalError,
  PdfTooLargeError,
  computeSha256Hex,
  deletePdfFileIfExists,
  getPdfFileSize,
  readPdfFile,
  resolveSafeStoragePath,
  sanitizeOriginalFilename,
  savePdfFile,
} from "@/backend/storage/pdf-storage";

const SAMPLE_PDF = Buffer.from("%PDF-1.4\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF\n");

describe("pdf-storage", () => {
  let tempDir: string;
  let outsideDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "coruscant-pdf-test-"));
    outsideDir = fs.mkdtempSync(
      path.join(os.tmpdir(), "coruscant-pdf-outside-"),
    );
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
    fs.rmSync(outsideDir, { recursive: true, force: true });
  });

  it("saves, reads, verifies SHA-256, and deletes a PDF under <year>/<uuid>.pdf", () => {
    const saved = savePdfFile(SAMPLE_PDF, 2026, tempDir);
    expect(saved.storagePath).toMatch(/^2026\/[0-9a-f-]{36}\.pdf$/i);
    expect(saved.byteSize).toBe(SAMPLE_PDF.byteLength);
    expect(saved.sha256Hash).toBe(computeSha256Hex(SAMPLE_PDF));

    const loaded = readPdfFile(saved.storagePath, tempDir);
    expect(loaded.equals(SAMPLE_PDF)).toBe(true);

    deletePdfFileIfExists(saved.storagePath, tempDir);
    expect(() => readPdfFile(saved.storagePath, tempDir)).toThrow();
    // Deleting a non-existent file is a no-op
    expect(() => deletePdfFileIfExists(saved.storagePath, tempDir)).not.toThrow();
  });

  it("rejects non-PDF buffers and oversized files", () => {
    expect(() => savePdfFile(Buffer.alloc(0), 2026, tempDir)).toThrow(
      InvalidPdfError,
    );
    expect(() =>
      savePdfFile(Buffer.from("\x89PNG\r\n\x1a\nhello"), 2026, tempDir),
    ).toThrow(InvalidPdfError);

    const oversized = Buffer.alloc(MAX_PDF_SIZE_BYTES + 1);
    oversized.write("%PDF-1.7", 0, "ascii");
    expect(() => savePdfFile(oversized, 2026, tempDir)).toThrow(
      PdfTooLargeError,
    );
  });

  it("blocks path traversal and symlink escapes", () => {
    const maliciousPaths = [
      "../secret.pdf",
      "/etc/passwd",
      "2026/../../x.pdf",
      "2026\\00000000-0000-0000-0000-000000000000.pdf",
      "2026/00000000-0000-0000-0000-000000000000.pdf\0.png",
      "2026/not-a-uuid.pdf",
    ];

    for (const p of maliciousPaths) {
      expect(() => resolveSafeStoragePath(p, tempDir)).toThrow(
        PathTraversalError,
      );
      expect(() => deletePdfFileIfExists(p, tempDir)).toThrow(
        PathTraversalError,
      );
    }

    // Symlink pointing outside baseDir
    const outsideFile = path.join(outsideDir, "secret.pdf");
    fs.writeFileSync(outsideFile, SAMPLE_PDF);
    const yearDir = path.join(tempDir, "2026");
    fs.mkdirSync(yearDir, { recursive: true });
    const symlinkStoragePath = "2026/11111111-1111-1111-1111-111111111111.pdf";
    fs.symlinkSync(outsideFile, path.join(tempDir, symlinkStoragePath));

    expect(() => readPdfFile(symlinkStoragePath, tempDir)).toThrow(
      PathTraversalError,
    );
  });

  it("sanitizes original filenames", () => {
    expect(sanitizeOriginalFilename("../../etc/passwd")).toBe("passwd");
    expect(sanitizeOriginalFilename("C:\\fakepath\\Muster_Beleg.pdf")).toBe(
      "Muster_Beleg.pdf",
    );
    expect(sanitizeOriginalFilename("   \u0000  ")).toBe("dokument.pdf");
  });

  it("getPdfFileSize: Bytegröße, fehlend und Traversal liefern null", () => {
    const saved = savePdfFile(SAMPLE_PDF, 2026, tempDir);
    expect(getPdfFileSize(saved.storagePath, tempDir)).toBe(SAMPLE_PDF.byteLength);
    deletePdfFileIfExists(saved.storagePath, tempDir);
    expect(getPdfFileSize(saved.storagePath, tempDir)).toBeNull();
    expect(getPdfFileSize("../../etc/passwd", tempDir)).toBeNull();
    expect(getPdfFileSize("/etc/passwd", tempDir)).toBeNull();
  });
});
