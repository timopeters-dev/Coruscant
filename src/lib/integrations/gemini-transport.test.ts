import { describe, expect, it, vi } from "vitest";
import {
  buildGeminiEndpoints,
  createGeminiJsonClient,
  extractGroundingFromGeminiResponse,
  extractTextFromGeminiResponse,
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
    expect(result).toEqual({
      ok: true,
      json: { a: 1 },
      model: "m1",
      grounding: { sources: [], webSearchQueries: [] },
    });
  });

  it("stripMarkdownCodeFences lässt reinen Text unverändert", () => {
    expect(stripMarkdownCodeFences(' {"a":1} ')).toBe('{"a":1}');
  });

  it("extractTextFromGeminiResponse verbindet mehrere Text-Parts und überspringt thought-Parts", () => {
    expect(
      extractTextFromGeminiResponse({
        candidates: [{ content: { parts: [{ text: "einzelner Part" }] } }],
      }),
    ).toBe("einzelner Part");

    expect(
      extractTextFromGeminiResponse({
        candidates: [
          {
            content: {
              parts: [
                { text: "Gedanke", thought: true },
                { text: '{"a":' },
                { text: "1}" },
              ],
            },
          },
        ],
      }),
    ).toBe('{"a":1}');
  });

  it("extractGroundingFromGeminiResponse filtert https, dedupliziert, kappt bei 8 und liefert bei Fehlen leer", () => {
    expect(extractGroundingFromGeminiResponse(null)).toEqual({
      sources: [],
      webSearchQueries: [],
    });
    expect(extractGroundingFromGeminiResponse({ candidates: [{}] })).toEqual({
      sources: [],
      webSearchQueries: [],
    });

    const chunks = [
      { web: { uri: "http://insecure.example.com", title: "HTTP" } },
      { web: { uri: "javascript:alert(1)", title: "XSS" } },
      { web: { uri: "https://a.example.com/1", title: "  Quelle A  " } },
      { web: { uri: "https://a.example.com/1", title: "Duplikat A" } },
      { web: { uri: "https://b.example.com/2" } },
      ...Array.from({ length: 10 }, (_, idx) => ({
        web: { uri: `https://c${idx}.example.com`, title: `C${idx}` },
      })),
    ];

    const extracted = extractGroundingFromGeminiResponse({
      candidates: [
        {
          groundingMetadata: {
            groundingChunks: chunks,
            webSearchQueries: [
              "  12345 Musterstadt  ",
              "12345 Musterstadt",
              "q2",
              "q3",
              "q4",
              "q5",
              "q6",
            ],
          },
        },
      ],
    });

    expect(extracted.sources).toHaveLength(8);
    expect(extracted.sources[0]).toEqual({
      uri: "https://a.example.com/1",
      title: "Quelle A",
    });
    expect(extracted.sources[1]).toEqual({
      uri: "https://b.example.com/2",
      title: "b.example.com",
    });
    expect(extracted.webSearchQueries).toEqual([
      "12345 Musterstadt",
      "q2",
      "q3",
      "q4",
      "q5",
    ]);
  });

  it("parst JSON mit erklärendem Text davor/danach (Codeblock oder geschweifte Klammern)", async () => {
    const withFencedProse = okResponse(
      'Hier ist die Einschätzung:\n```json\n{"lowerEur": 200000}\n```\nViele Grüße.',
    );
    const client1 = createGeminiJsonClient({
      apiKey: "key",
      model: "m1",
      fallbackModels: [],
      fetchFn: vi.fn().mockResolvedValue(withFencedProse),
      operationLabel: "KI-Wertschätzung",
    });
    expect(await client1.generateJson({})).toMatchObject({
      ok: true,
      json: { lowerEur: 200000 },
    });

    const withBareProse = okResponse(
      'Ergebnis der Marktrecherche: {"medianEur": 320000} (Stand heute)',
    );
    const client2 = createGeminiJsonClient({
      apiKey: "key",
      model: "m1",
      fallbackModels: [],
      fetchFn: vi.fn().mockResolvedValue(withBareProse),
      operationLabel: "KI-Wertschätzung",
    });
    expect(await client2.generateJson({})).toMatchObject({
      ok: true,
      json: { medianEur: 320000 },
    });

    const withoutJson = okResponse("Leider keine Daten gefunden.");
    const client3 = createGeminiJsonClient({
      apiKey: "key",
      model: "m1",
      fallbackModels: [],
      fetchFn: vi.fn().mockResolvedValue(withoutJson),
      operationLabel: "KI-Wertschätzung",
    });
    expect(await client3.generateJson({})).toMatchObject({
      ok: false,
      code: "invalid_payload",
    });
  });
});
