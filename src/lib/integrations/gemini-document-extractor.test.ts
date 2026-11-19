import { describe, expect, it, vi } from "vitest";
import {
  DEFAULT_GEMINI_FALLBACK_MODEL,
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
    expect(getGeminiConfig({})).toEqual({
      apiKey: "",
      model: DEFAULT_GEMINI_MODEL,
      fallbackModels: [DEFAULT_GEMINI_FALLBACK_MODEL],
    });
    expect(getGeminiConfig({ GEMINI_MODEL: "  " }).model).toBe(
      DEFAULT_GEMINI_MODEL,
    );
    expect(
      getGeminiConfig({
        GEMINI_API_KEY: " test-key ",
        GEMINI_MODEL: "models/gemini-2.5-pro",
        GEMINI_FALLBACK_MODEL: "gemini-2.5-flash, gemini-3.5-flash-lite",
      }),
    ).toEqual({
      apiKey: "test-key",
      model: "gemini-2.5-pro",
      fallbackModels: ["gemini-2.5-flash", "gemini-3.5-flash-lite"],
    });
    expect(
      getGeminiConfig({
        GEMINI_MODEL: DEFAULT_GEMINI_FALLBACK_MODEL,
      }).fallbackModels,
    ).toEqual([]);
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

  it("returns http_error on HTTP 500 or 429 with error details", async () => {
    const extractor = createGeminiDocumentExtractor({
      apiKey: "secret-api-key",
      retryDelayMs: 0,
      fetchFn: (async () =>
        new Response(
          JSON.stringify({ error: { message: "Quota exceeded" } }),
          { status: 429 },
        )) as unknown as typeof fetch,
    });

    const result = await extractor.extract(SAMPLE_CTX);
    expect(result).toMatchObject({
      ok: false,
      code: "http_error",
      httpStatus: 429,
    });
    if (!result.ok) {
      expect(result.message).toContain("Quota exceeded");
    }
  });

  it("retries transient 503 responses and succeeds on the same model", async () => {
    let attempts = 0;
    const fetchMock = vi.fn(async () => {
      attempts += 1;
      if (attempts < 3) {
        return new Response(
          JSON.stringify({ error: { message: "high demand" } }),
          { status: 503 },
        );
      }
      return new Response(
        JSON.stringify({
          candidates: [
            {
              content: {
                parts: [
                  {
                    text: JSON.stringify({
                      documentType: "invoice",
                      documentDate: "2026-01-10",
                      issuer: "Musterbetrieb GmbH",
                      totalAmountCents: 25_000,
                    }),
                  },
                ],
              },
            },
          ],
        }),
        { status: 200 },
      );
    });

    const extractor = createGeminiDocumentExtractor({
      apiKey: "secret-api-key",
      model: "gemini-3.6-flash",
      fallbackModels: ["gemini-3.5-flash-lite"],
      retryDelayMs: 0,
      fetchFn: fetchMock as unknown as typeof fetch,
    });

    const result = await extractor.extract(SAMPLE_CTX);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.model).toBe("gemini-3.6-flash");
    }
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("falls back to fallbackModels on persistent 503 but NOT on 401 auth errors", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("gemini-3.6-flash")) {
        return new Response(
          JSON.stringify({ error: { message: "This model is currently experiencing high demand." } }),
          { status: 503 },
        );
      }
      return new Response(
        JSON.stringify({
          candidates: [
            {
              content: {
                parts: [
                  {
                    text: JSON.stringify({
                      documentType: "contract",
                      issuer: "Musterbank AG",
                    }),
                  },
                ],
              },
            },
          ],
        }),
        { status: 200 },
      );
    });

    const extractor = createGeminiDocumentExtractor({
      apiKey: "secret-api-key",
      model: "gemini-3.6-flash",
      fallbackModels: ["gemini-3.5-flash-lite"],
      retryDelayMs: 0,
      fetchFn: fetchMock as unknown as typeof fetch,
    });

    const result = await extractor.extract(SAMPLE_CTX);
    expect(result).toMatchObject({
      ok: true,
      model: "gemini-3.5-flash-lite",
      data: {
        documentType: "contract",
        issuer: "Musterbank AG",
      },
    });
    expect(fetchMock).toHaveBeenCalledTimes(5);

    const authFailMock = vi.fn<typeof fetch>(async () =>
      new Response(JSON.stringify({ error: { message: "API key invalid" } }), {
        status: 401,
      }),
    );
    const authExtractor = createGeminiDocumentExtractor({
      apiKey: "invalid-key",
      model: "gemini-3.6-flash",
      fallbackModels: ["gemini-3.5-flash-lite"],
      retryDelayMs: 0,
      fetchFn: authFailMock as unknown as typeof fetch,
    });
    const authRes = await authExtractor.extract(SAMPLE_CTX);
    expect(authRes).toMatchObject({
      ok: false,
      code: "http_error",
      httpStatus: 401,
    });
    expect(
      authFailMock.mock.calls.every((call) =>
        String(call[0]).includes("gemini-3.6-flash"),
      ),
    ).toBe(true);
  });

  it("prefers Vertex Express endpoint for AQ. keys and falls back to AI Studio on 403", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ error: { message: "API disabled" } }), {
          status: 403,
        }),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            candidates: [
              {
                content: {
                  parts: [
                    {
                      text: JSON.stringify({
                        documentType: "invoice",
                        totalAmountCents: 10_000,
                      }),
                    },
                  ],
                },
              },
            ],
          }),
          { status: 200 },
        ),
      );

    const extractor = createGeminiDocumentExtractor({
      apiKey: "AQ.Ab8testKeyExample",
      model: "gemini-3.6-flash",
      retryDelayMs: 0,
      fetchFn: fetchMock as unknown as typeof fetch,
    });

    const res = await extractor.extract(SAMPLE_CTX);
    expect(res.ok).toBe(true);
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain(
      "aiplatform.googleapis.com",
    );
    expect(String(fetchMock.mock.calls[1]?.[0])).toContain(
      "generativelanguage.googleapis.com",
    );
  });

  it("returns timeout on AbortError and network_error on fetch rejection", async () => {
    const abortError = new Error("aborted");
    abortError.name = "AbortError";

    const timeoutExtractor = createGeminiDocumentExtractor({
      apiKey: "secret-api-key",
      retryDelayMs: 0,
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
      retryDelayMs: 0,
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

  it("extracts and validates extractedContract for multi-page loan contracts and checks prompt hints", async () => {
    let capturedPrompt = "";
    const fetchMock = vi.fn(
      async (_input: RequestInfo | URL, init?: RequestInit) => {
        const parsedBody = JSON.parse(String(init?.body)) as {
          contents: Array<{ parts: Array<{ text?: string }> }>;
        };
        capturedPrompt = parsedBody.contents[0]?.parts[0]?.text ?? "";

        return new Response(
          JSON.stringify({
            candidates: [
              {
                content: {
                  parts: [
                    {
                      text: JSON.stringify({
                        documentType: "contract",
                        documentDate: "2026-02-01",
                        issuer: "Musterbank AG",
                        totalAmountCents: null,
                        isTaxRelevant: false,
                        taxYear: null,
                        taxCategory: null,
                        deductibleAmountCents: null,
                        detectedBalanceCents: 29_500_000,
                        extractedContract: {
                          name: "Hauskredit Musterstraße 1",
                          provider: "Musterbank AG",
                          category: "loan",
                          currentBalanceCents: 29_500_000,
                          balanceAsOfDate: "2026-02-01",
                          monthlyRateCents: 140_000,
                          interestRateBps: 345,
                          repaymentType: "annuity",
                          specialRepaymentMaxYearlyCents: 1_000_000,
                          fixedInterestUntil: "2036-02-01",
                          targetSumCents: null,
                          allocationThresholdPercent: null,
                          futureLoanInterestRateBps: null,
                          milestoneDate: "2036-02-01",
                          milestoneLabel: "Ende Zinsbindung",
                        },
                      }),
                    },
                  ],
                },
              },
            ],
          }),
          { status: 200 },
        );
      },
    );

    const extractor = createGeminiDocumentExtractor({
      apiKey: "secret-api-key",
      fetchFn: fetchMock as unknown as typeof fetch,
    });

    const result = await extractor.extract({
      filename: "Darlehensvertrag_Musterbank.pdf",
      mimeType: "application/pdf",
      pdfBase64: SAMPLE_CTX.pdfBase64,
    });

    expect(capturedPrompt).toContain("Konditionenübersicht");
    expect(capturedPrompt).toContain("ESIS-Merkblatt");
    expect(capturedPrompt).toContain("Basispunkten");
    expect(capturedPrompt).toContain("originalPrincipalCents");
    expect(capturedPrompt).toContain("specialRepaymentRight");
    expect(capturedPrompt).toContain("specialRepaymentPercentBps");
    expect(capturedPrompt).toContain("rateChangeRight");
    expect(capturedPrompt).toContain("rateChangeMinRepaymentBps");
    expect(capturedPrompt).toContain("Vorzeitige Rückzahlung");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.extractedContract?.interestRateBps).toBe(345);
      expect(result.data.extractedContract?.currentBalanceCents).toBe(
        29_500_000,
      );
    }
  });

  it("returns invalid_payload when Gemini returns float interestRateBps in extractedContract", async () => {
    const extractor = createGeminiDocumentExtractor({
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
                        documentType: "contract",
                        extractedContract: {
                          name: "Fehlerhafter Zins",
                          interestRateBps: 3.45,
                        },
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

    expect(await extractor.extract(SAMPLE_CTX)).toMatchObject({
      ok: false,
      code: "invalid_payload",
    });
  });
});
