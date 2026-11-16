import { describe, expect, it, vi } from "vitest";
import {
  DEFAULT_GEMINI_MODEL,
  createGeminiDocumentExtractor,
  getGeminiConfig,
} from "./gemini-document-extractor";

const SAMPLE_CTX = {
  filename: "Rechnung_Musterbetrieb_2025.pdf",
  mimeType: "application/pdf" as const,
  pdfBase64: Buffer.from("%PDF-1.4\n%%EOF").toString("base64"),
};

describe("getGeminiConfig", () => {
  it("uses GEMINI_MODEL when set and falls back to DEFAULT_GEMINI_MODEL", () => {
    expect(getGeminiConfig({}).model).toBe(DEFAULT_GEMINI_MODEL);
    expect(getGeminiConfig({ GEMINI_MODEL: "  " }).model).toBe(
      DEFAULT_GEMINI_MODEL,
    );
    expect(
      getGeminiConfig({
        GEMINI_API_KEY: " test-key ",
        GEMINI_MODEL: "gemini-2.5-pro",
      }),
    ).toEqual({
      apiKey: "test-key",
      model: "gemini-2.5-pro",
    });
  });
});

describe("createGeminiDocumentExtractor", () => {
  it("sends x-goog-api-key header, strips markdown fences, and validates schema", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      expect(url).toContain("/models/gemini-2.5-flash:generateContent");
      expect(url).not.toContain("secret-api-key");
      expect(init?.headers).toMatchObject({
        "x-goog-api-key": "secret-api-key",
      });

      return new Response(
        JSON.stringify({
          candidates: [
            {
              content: {
                parts: [
                  {
                    text: '```json\n{"documentType":"invoice","documentDate":"2025-11-10","issuer":"Musterbetrieb GmbH","totalAmountCents":120000,"isTaxRelevant":true,"taxYear":2025,"taxCategory":"handwerker_35a","deductibleAmountCents":84000,"detectedBalanceCents":null}\n```',
                  },
                ],
              },
            },
          ],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    });

    const extractor = createGeminiDocumentExtractor({
      apiKey: "secret-api-key",
      model: "gemini-2.5-flash",
      fetchFn: fetchMock as unknown as typeof fetch,
    });

    const result = await extractor.extract(SAMPLE_CTX);
    expect(result).toEqual({
      ok: true,
      model: "gemini-2.5-flash",
      data: {
        documentType: "invoice",
        documentDate: "2025-11-10",
        issuer: "Musterbetrieb GmbH",
        totalAmountCents: 120_000,
        isTaxRelevant: true,
        taxYear: 2025,
        taxCategory: "handwerker_35a",
        deductibleAmountCents: 84_000,
        detectedBalanceCents: null,
      },
    });
  });

  it("returns not_configured when apiKey is missing", async () => {
    const extractor = createGeminiDocumentExtractor({ apiKey: "" });
    const result = await extractor.extract(SAMPLE_CTX);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("not_configured");
    }
  });

  it("returns http_error on HTTP 500 or 429", async () => {
    const extractor = createGeminiDocumentExtractor({
      apiKey: "secret-api-key",
      fetchFn: (async () =>
        new Response("rate limited", { status: 429 })) as unknown as typeof fetch,
    });

    const result = await extractor.extract(SAMPLE_CTX);
    expect(result).toMatchObject({
      ok: false,
      code: "http_error",
      httpStatus: 429,
    });
  });

  it("returns timeout on AbortError and network_error on fetch rejection", async () => {
    const abortError = new Error("aborted");
    abortError.name = "AbortError";

    const timeoutExtractor = createGeminiDocumentExtractor({
      apiKey: "secret-api-key",
      fetchFn: (async () => {
        throw abortError;
      }) as unknown as typeof fetch,
    });
    expect(await timeoutExtractor.extract(SAMPLE_CTX)).toMatchObject({
      ok: false,
      code: "timeout",
    });

    const networkExtractor = createGeminiDocumentExtractor({
      apiKey: "secret-api-key",
      fetchFn: (async () => {
        throw new Error("ECONNREFUSED");
      }) as unknown as typeof fetch,
    });
    const netRes = await networkExtractor.extract(SAMPLE_CTX);
    expect(netRes).toMatchObject({
      ok: false,
      code: "network_error",
    });
  });

  it("returns invalid_payload on invalid JSON, float cents, or deductible > total", async () => {
    const invalidJsonExtractor = createGeminiDocumentExtractor({
      apiKey: "secret-api-key",
      fetchFn: (async () =>
        new Response(
          JSON.stringify({
            candidates: [{ content: { parts: [{ text: "not-json" }] } }],
          }),
          { status: 200 },
        )) as unknown as typeof fetch,
    });
    expect(await invalidJsonExtractor.extract(SAMPLE_CTX)).toMatchObject({
      ok: false,
      code: "invalid_payload",
    });

    const floatCentsExtractor = createGeminiDocumentExtractor({
      apiKey: "secret-api-key",
      fetchFn: (async () =>
        new Response(
          JSON.stringify({
            candidates: [
              {
                content: {
                  parts: [
                    {
                      text: JSON.stringify({
                        documentType: "invoice",
                        totalAmountCents: 99.95,
                      }),
                    },
                  ],
                },
              },
            ],
          }),
          { status: 200 },
        )) as unknown as typeof fetch,
    });
    expect(await floatCentsExtractor.extract(SAMPLE_CTX)).toMatchObject({
      ok: false,
      code: "invalid_payload",
    });

    const inconsistentTaxExtractor = createGeminiDocumentExtractor({
      apiKey: "secret-api-key",
      fetchFn: (async () =>
        new Response(
          JSON.stringify({
            candidates: [
              {
                content: {
                  parts: [
                    {
                      text: JSON.stringify({
                        documentType: "invoice",
                        totalAmountCents: 1000,
                        deductibleAmountCents: 2000,
                      }),
                    },
                  ],
                },
              },
            ],
          }),
          { status: 200 },
        )) as unknown as typeof fetch,
    });
    expect(await inconsistentTaxExtractor.extract(SAMPLE_CTX)).toMatchObject({
      ok: false,
      code: "invalid_payload",
    });
  });
});
