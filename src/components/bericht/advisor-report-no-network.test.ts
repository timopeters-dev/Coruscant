import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ALWAYS_FORBIDDEN = [
  '"use server"',
  "'use server'",
  "@/db",
  "localStorage",
  "sessionStorage",
  "indexedDB",
];

function listNonTestFiles(dir: string): string[] {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  return entries
    .filter((e) => e.isFile() && !e.name.includes(".test."))
    .map((e) => path.join(dir, e.name));
}

describe("advisor-report-no-network", () => {
  const berichtDir = path.resolve(process.cwd(), "src/components/bericht");
  const domainDir = path.resolve(process.cwd(), "src/lib/domain");

  const berichtFiles = listNonTestFiles(berichtDir);
  const domainFiles = fs
    .readdirSync(domainDir, { withFileTypes: true })
    .filter(
      (e) =>
        e.isFile() &&
        e.name.startsWith("advisor-report") &&
        !e.name.includes(".test."),
    )
    .map((e) => path.join(domainDir, e.name));

  it("restricts fetch( strictly to use-advisor-question-check.ts with /api/report/advisor/question-check", () => {
    expect(berichtFiles.length).toBeGreaterThanOrEqual(4);
    for (const filePath of berichtFiles) {
      const name = path.basename(filePath);
      const content = fs.readFileSync(filePath, "utf8");

      for (const pattern of ALWAYS_FORBIDDEN) {
        expect(
          content.includes(pattern),
          `${name} must not contain ${pattern}`,
        ).toBe(false);
      }

      if (name === "use-advisor-question-check.ts") {
        const fetchCalls = [...content.matchAll(/fetch\(\s*["'`]([^"'`]+)["'`]/g)];
        expect(fetchCalls.length).toBe(1);
        expect(fetchCalls[0]![1]).toBe("/api/report/advisor/question-check");
      } else {
        expect(
          content.includes("fetch("),
          `${name} must not contain fetch(`,
        ).toBe(false);
      }
    }
  });

  it("ensures domain advisor-report*.ts files contain no fetch, db, or storage access", () => {
    expect(domainFiles.length).toBeGreaterThanOrEqual(3);
    for (const filePath of domainFiles) {
      const name = path.basename(filePath);
      const content = fs.readFileSync(filePath, "utf8");
      for (const pattern of ["fetch(", ...ALWAYS_FORBIDDEN]) {
        expect(
          content.includes(pattern),
          `${name} must not contain ${pattern}`,
        ).toBe(false);
      }
    }
  });
});
