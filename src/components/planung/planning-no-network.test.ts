import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const FORBIDDEN_PATTERNS = [
  "fetch(",
  '"use server"',
  "'use server'",
  "@/db",
  "router.push",
  "router.refresh",
];

function collectFiles(dir: string, predicate: (name: string) => boolean): string[] {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    if (entry.isFile() && predicate(entry.name)) {
      files.push(path.join(dir, entry.name));
    }
  }
  return files;
}

describe("planning-no-network", () => {
  const planungDir = path.resolve(process.cwd(), "src/components/planung");
  const chartsDir = path.resolve(process.cwd(), "src/components/charts");
  const domainDir = path.resolve(process.cwd(), "src/lib/domain");

  const targetFiles = [
    ...collectFiles(
      planungDir,
      (name) =>
        !name.includes(".test.") &&
        (name === "free-money-panel.tsx" ||
          name === "salary-panel.tsx" ||
          name === "planung-workspace.tsx" ||
          name === "recommendation-text.ts" ||
          name.startsWith("planning-")),
    ),
    ...collectFiles(chartsDir, (name) => !name.includes(".test.")),
    path.join(domainDir, "recommendation.ts"),
    path.join(domainDir, "recommendation-llm.ts"),
  ];

  it("contains no fetch, use server, db imports, or router mutations", () => {
    expect(targetFiles.length).toBeGreaterThan(5);
    for (const filePath of targetFiles) {
      const content = fs.readFileSync(filePath, "utf8");
      for (const pattern of FORBIDDEN_PATTERNS) {
        expect(
          content.includes(pattern),
          `${path.basename(filePath)} must not contain ${pattern}`,
        ).toBe(false);
      }
    }
  });
});
