import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const SRC = path.resolve(__dirname, "..");

function collectTsx(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return collectTsx(full);
    return entry.name.endsWith(".tsx") && !entry.name.endsWith(".test.tsx")
      ? [full]
      : [];
  });
}

// Jede Zeile außerhalb von Kommentaren, die eines der Wörter enthält – auch
// mehrzeiliger JSX-Text ohne Anführungszeichen.
const FORBIDDEN = /(Privat|Sphäre|persönlich)/i;

function isComment(line: string): boolean {
  return /^\s*(\/\/|\/\*|\*|\{\/\*)/.test(line);
}

describe("UI-Wortlaut (nur Haushalt)", () => {
  it("enthält in sichtbaren Texten weder „Privat“, „Sphäre“ noch „persönlich“", () => {
    const hits: string[] = [];
    for (const file of [
      ...collectTsx(path.join(SRC, "components")),
      ...collectTsx(path.join(SRC, "app")),
    ]) {
      readFileSync(file, "utf8")
        .split("\n")
        .forEach((line, index) => {
          if (!isComment(line) && FORBIDDEN.test(line)) {
            hits.push(`${path.relative(SRC, file)}:${index + 1}: ${line.trim()}`);
          }
        });
    }
    expect(hits).toEqual([]);
  });
});
