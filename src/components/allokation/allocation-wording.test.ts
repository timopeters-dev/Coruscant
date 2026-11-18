import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const SRC = path.resolve(__dirname, "..", "..");
const ALLOWED = new Set(["legacy-plan-items.tsx", "cashflow-item-modal.tsx"]);

function collectTsx(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return collectTsx(full);
    return entry.name.endsWith(".tsx") && !entry.name.endsWith(".test.tsx")
      ? [full]
      : [];
  });
}

function isComment(line: string): boolean {
  return /^\s*(\/\/|\/\*|\*|\{\/\*)/.test(line);
}

describe("UI-Wortlaut Allokation (Plan-Posten im Auslauf)", () => {
  it("„Plan-Posten“ steht nur in legacy-plan-items.tsx und cashflow-item-modal.tsx", () => {
    const hits: string[] = [];
    for (const file of [
      ...collectTsx(path.join(SRC, "components")),
      ...collectTsx(path.join(SRC, "app")),
    ]) {
      if (ALLOWED.has(path.basename(file))) continue;
      readFileSync(file, "utf8")
        .split("\n")
        .forEach((line, index) => {
          if (!isComment(line) && /Plan-Posten/.test(line)) {
            hits.push(`${path.relative(SRC, file)}:${index + 1}: ${line.trim()}`);
          }
        });
    }
    expect(hits).toEqual([]);
  });

  it("allokation-workspace.tsx enthält kein Neu-Anlegen von Plan-Posten", () => {
    const source = readFileSync(
      path.join(SRC, "components", "allokation", "allokation-workspace.tsx"),
      "utf8",
    );
    expect(source).not.toContain("CashflowItemModal");
    expect(source).not.toContain("Ersten Plan-Posten anlegen");
  });
});
