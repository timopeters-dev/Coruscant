import { describe, expect, it } from "vitest";
import { redactFreeText, trimChatHistory } from "./coach-text";

describe("redactFreeText", () => {
  it("maskiert IBANs mit und ohne Leerzeichen sowie in Kleinbuchstaben", () => {
    expect(redactFreeText("Meine IBAN DE02 1203 0000 0000 2020 51 bitte")).toBe(
      "Meine IBAN [IBAN entfernt] bitte",
    );
    expect(redactFreeText("DE02120300000000202051")).toBe("[IBAN entfernt]");
    expect(redactFreeText("de02 1203 0000 0000 2020 51")).toBe("[IBAN entfernt]");
  });

  it("maskiert ausländische IBANs mit Buchstaben-Bankcode (GB, NL)", () => {
    expect(redactFreeText("IBAN GB29 NWBK 6016 1331 9268 19 danke")).toBe(
      "IBAN [IBAN entfernt] danke",
    );
    expect(redactFreeText("NL91ABNA0417164300")).toBe("[IBAN entfernt]");
    expect(redactFreeText("nl91 abna 0417 1643 00")).toBe("[IBAN entfernt]");
  });

  it("lässt ISINs unverändert", () => {
    expect(redactFreeText("Der ETF IE00B4L5Y983 und LU0392494562 passen")).toBe(
      "Der ETF IE00B4L5Y983 und LU0392494562 passen",
    );
  });

  it("maskiert E-Mail-Adressen", () => {
    expect(redactFreeText("Schreib an kontakt@example.com danke")).toBe(
      "Schreib an [E-Mail entfernt] danke",
    );
  });

  it("lässt normale Sätze mit Zahlen unverändert", () => {
    const text = "In 3 Jahre brauche ich 500 € für 2026, ISIN IE00B4L5Y983.";
    expect(redactFreeText(text)).toBe(text);
    expect(redactFreeText("")).toBe("");
  });
});

describe("trimChatHistory", () => {
  const make = (n: number) =>
    Array.from({ length: n }, (_, i) => ({
      role: i % 2 === 0 ? ("user" as const) : ("coach" as const),
      text: `m${i}`,
    }));

  it("behält bei 30 Nachrichten die letzten 20 und beginnt mit user", () => {
    const trimmed = trimChatHistory(make(30));
    expect(trimmed).toHaveLength(20);
    expect(trimmed[0]!.role).toBe("user");
    expect(trimmed.at(-1)!.text).toBe("m29");
  });

  it("überspringt führende coach-Nachrichten", () => {
    const trimmed = trimChatHistory(make(31));
    expect(trimmed[0]!.role).toBe("user");
    expect(trimmed).toHaveLength(19);
  });

  it("behält eine einzelne Nachricht und liefert [] ohne user", () => {
    expect(trimChatHistory(make(1))).toHaveLength(1);
    expect(trimChatHistory([{ role: "coach" as const, text: "x" }])).toEqual([]);
    expect(trimChatHistory([])).toEqual([]);
  });
});
