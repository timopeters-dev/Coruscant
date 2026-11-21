import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const SRC = path.resolve(process.cwd(), "src");

function collectTsx(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return collectTsx(full);
    return entry.name.endsWith(".tsx") ? [full] : [];
  });
}

const UI_FILES = [...collectTsx(path.join(SRC, "frontend")), ...collectTsx(path.join(SRC, "app"))];

/** Jede Zeile außerhalb von Kommentaren – auch mehrzeiliger JSX-Text ohne Anführungszeichen. */
function findVisibleLines(pattern: RegExp, allowed: ReadonlySet<string> = new Set()): string[] {
  const isComment = (line: string) => /^\s*(\/\/|\/\*|\*|\{\/\*)/.test(line);
  return UI_FILES.filter((file) => !allowed.has(path.basename(file))).flatMap((file) =>
    readFileSync(file, "utf8")
      .split("\n")
      .flatMap((line, index) =>
        !isComment(line) && pattern.test(line) ? [`${path.relative(SRC, file)}:${index + 1}: ${line.trim()}`] : [],
      ),
  );
}

describe("UI-Wortlaut", () => {
  it("enthält nur Haushalts-Begriffe – weder „Privat“, „Sphäre“ noch „persönlich“", () => {
    expect(findVisibleLines(/(Privat|Sphäre|persönlich)/i)).toEqual([]);
  });

  it("„Plan-Posten“ steht nur in den Auslauf-Komponenten", () => {
    expect(findVisibleLines(/Plan-Posten/, new Set(["legacy-plan-items.tsx", "cashflow-item-modal.tsx"]))).toEqual([]);
  });

  it("Allokation bietet kein Neu-Anlegen von Plan-Posten mehr an", () => {
    const source = readFileSync(path.join(SRC, "frontend/allokation/allokation-workspace.tsx"), "utf8");
    expect(source).not.toContain("CashflowItemModal");
    expect(source).not.toContain("Ersten Plan-Posten anlegen");
  });
});
