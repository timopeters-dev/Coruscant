import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  deletePropertyImageIfExists,
  InvalidPropertyImageError,
  MAX_PROPERTY_IMAGE_BYTES,
  PropertyImagePathTraversalError,
  PropertyImageTooLargeError,
  readPropertyImageFile,
  resolveSafePropertyImagePath,
  savePropertyImageFile,
} from "./property-image-storage";

const JPEG_HEADER = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
const PNG_HEADER = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00,
]);
const WEBP_HEADER = Buffer.from([
  0x52, 0x49, 0x46, 0x46, 0x10, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50,
]);

let tempDir: string;

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "coruscant-prop-img-"));
});

afterEach(() => {
  if (tempDir && fs.existsSync(tempDir)) {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

describe("property-image-storage", () => {
  it("saves, reads, and deletes valid JPEG, PNG, and WebP buffers", () => {
    const samples: Array<{ buf: Buffer; mime: string; ext: string }> = [
      { buf: JPEG_HEADER, mime: "image/jpeg", ext: ".jpg" },
      { buf: PNG_HEADER, mime: "image/png", ext: ".png" },
      { buf: WEBP_HEADER, mime: "image/webp", ext: ".webp" },
    ];

    for (const sample of samples) {
      const saved = savePropertyImageFile(sample.buf, sample.mime, tempDir);
      expect(saved.mimeType).toBe(sample.mime);
      expect(saved.byteSize).toBe(sample.buf.byteLength);
      expect(saved.storagePath.endsWith(sample.ext)).toBe(true);

      const read = readPropertyImageFile(saved.storagePath, tempDir);
      expect(read.mimeType).toBe(sample.mime);
      expect(read.buffer.equals(sample.buf)).toBe(true);

      deletePropertyImageIfExists(saved.storagePath, tempDir);
      expect(() =>
        readPropertyImageFile(saved.storagePath, tempDir),
      ).toThrow();
      // Idempotent delete
      expect(() =>
        deletePropertyImageIfExists(saved.storagePath, tempDir),
      ).not.toThrow();
    }
  });

  it("rejects empty buffers, oversized files, and mismatched/invalid magic bytes", () => {
    expect(() =>
      savePropertyImageFile(Buffer.alloc(0), "image/png", tempDir),
    ).toThrow(InvalidPropertyImageError);

    const oversized = Buffer.alloc(MAX_PROPERTY_IMAGE_BYTES + 1);
    JPEG_HEADER.copy(oversized);
    expect(() =>
      savePropertyImageFile(oversized, "image/jpeg", tempDir),
    ).toThrow(PropertyImageTooLargeError);

    const pdfBytes = Buffer.from("%PDF-1.7 fake", "ascii");
    expect(() =>
      savePropertyImageFile(pdfBytes, "image/png", tempDir),
    ).toThrow(InvalidPropertyImageError);

    const svgBytes = Buffer.from("<svg><script>alert(1)</script></svg>");
    expect(() =>
      savePropertyImageFile(svgBytes, "image/svg+xml", tempDir),
    ).toThrow(InvalidPropertyImageError);

    // JPEG magic bytes disguised as image/png
    expect(() =>
      savePropertyImageFile(JPEG_HEADER, "image/png", tempDir),
    ).toThrow(InvalidPropertyImageError);
  });

  it("blocks path traversal and non-UUID storage paths", () => {
    const badPaths = [
      "../evil.png",
      "../../etc/passwd",
      "/etc/passwd",
      "00000000-0000-0000-0000-000000000000.png\0.jpg",
      "not-a-uuid.png",
      "subdir/00000000-0000-0000-0000-000000000000.png",
      "00000000-0000-0000-0000-000000000000.svg",
    ];

    for (const badPath of badPaths) {
      expect(() => resolveSafePropertyImagePath(badPath, tempDir)).toThrow(
        PropertyImagePathTraversalError,
      );
      expect(() => readPropertyImageFile(badPath, tempDir)).toThrow(
        PropertyImagePathTraversalError,
      );
    }
  });
});
