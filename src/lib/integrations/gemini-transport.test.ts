import { describe, expect, it, vi } from "vitest";
import {
  buildGeminiEndpoints,
  createGeminiJsonClient,
  stripMarkdownCodeFences,
} from "./gemini-transport";

function okResponse(text: string): Response {
  return new Response(
    JSON.stringify({ candidates: [{ content: { parts: [{ text }] } }] }),
    { status: 200 },
  );
}

describe("gemini-transport", () => {
  it("nutzt operationLabel in Fehlertexten", async () => {
    const fetchFn = vi.fn().mockRejectedValue(new Error("boom"));
    const client = createGeminiJsonClient({
      apiKey: "key",
      model: "m1",
      fallbackModels: [],
      fetchFn,
      retryDelayMs: 0,
      operationLabel: "KI-Coach",
    });
    const result = await client.generateJson({});
    expect(result).toMatchObject({
      ok: false,
      code: "network_error",
      message: "Netzwerkfehler bei der KI-Coach.",
    });
  });

  it("ordnet Endpoints bei AQ.-Key mit Vertex zuerst", () => {
    const [first, second] = buildGeminiEndpoints("m1", "AQ.abc");
    expect(first).toContain("aiplatform.googleapis.com");
    expect(second).toContain("generativelanguage.googleapis.com");
    const [a] = buildGeminiEndpoints("m1", "plain");
    expect(a).toContain("generativelanguage.googleapis.com");
  });

  it("liefert invalid_payload bei leerem candidates-Array", async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify({ candidates: [] })));
    const client = createGeminiJsonClient({
      apiKey: "key",
      model: "m1",
      fallbackModels: [],
      fetchFn,
      operationLabel: "KI-Coach",
    });
    const result = await client.generateJson({});
    expect(result).toMatchObject({ ok: false, code: "invalid_payload" });
  });

  it("liefert not_configured ohne Key und ohne fetch-Aufruf", async () => {
    const fetchFn = vi.fn();
    const client = createGeminiJsonClient({
      apiKey: "",
      fetchFn,
      operationLabel: "KI-Coach",
    });
    const result = await client.generateJson({});
    expect(result).toMatchObject({ ok: false, code: "not_configured" });
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it("toleriert Code-Fences und gibt das Modell zurück", async () => {
    const fetchFn = vi.fn().mockResolvedValue(okResponse('```json\n{"a":1}\n```'));
    const client = createGeminiJsonClient({
      apiKey: "key",
      model: "m1",
      fallbackModels: [],
      fetchFn,
      operationLabel: "KI-Coach",
    });
    const result = await client.generateJson({});
    expect(result).toEqual({ ok: true, json: { a: 1 }, model: "m1" });
  });

  it("stripMarkdownCodeFences lässt reinen Text unverändert", () => {
    expect(stripMarkdownCodeFences(' {"a":1} ')).toBe('{"a":1}');
  });
});
