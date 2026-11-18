import { describe, expect, it, vi } from "vitest";
import { validatePropertyValuation } from "@/lib/domain/property-valuation";
import { createGeminiPropertyValuator } from "./gemini-property-valuator";
import type { GeminiJsonClient } from "./gemini-transport";

const sampleContextJson = JSON.stringify(
  {
    schemaVersion: 1,
    asOfMonth: "2026-11",
    location: { country: "DE", postalCode: "12345", city: "Musterstadt" },
  },
  null,
  2,
);

const validJson = {
  lowerEur: 280_000,
  medianEur: 320_000,
  upperEur: 360_000,
  asOfDate: "2026-11-01",
  rationale: "Vergleichspreise in 12345 Musterstadt.",
  factors: [{ label: "Gute Lage", effect: "up" }],
  confidence: "medium",
};

describe("gemini-property-valuator", () => {
  it("sends google_search tool, exact contextJson, and no responseMimeType, returning grounding", async () => {
    const generateJson = vi.fn().mockResolvedValue({
      ok: true,
      json: validJson,
      model: "configured-model",
      grounding: {
        sources: [{ uri: "https://example.com/report", title: "Marktbericht" }],
        webSearchQueries: ["12345 Musterstadt Immobilienpreise"],
      },
    });
    const fakeClient: GeminiJsonClient = { generateJson };

    const valuator = createGeminiPropertyValuator({}, fakeClient);
    const result = await valuator.estimate(sampleContextJson);

    expect(generateJson).toHaveBeenCalledTimes(1);
    const requestBody = generateJson.mock.calls[0]?.[0] as {
      tools?: unknown;
      generationConfig?: Record<string, unknown>;
      contents?: Array<{ parts?: Array<{ text?: string }> }>;
    };

    expect(requestBody.tools).toEqual([{ google_search: {} }]);
    expect(requestBody.generationConfig).toEqual({ temperature: 0.2 });
    expect(requestBody.generationConfig).not.toHaveProperty("responseMimeType");
    expect(requestBody.contents?.[0]?.parts?.[0]?.text).toContain(
      sampleContextJson,
    );

    expect(result).toEqual({
      ok: true,
      data: validJson,
      model: "configured-model",
      grounding: {
        sources: [{ uri: "https://example.com/report", title: "Marktbericht" }],
        webSearchQueries: ["12345 Musterstadt Immobilienpreise"],
      },
    });
  });

  it("returns invalid_payload when output violates valuationModelOutputSchema", async () => {
    const fakeClient: GeminiJsonClient = {
      generateJson: vi.fn().mockResolvedValue({
        ok: true,
        json: { ...validJson, sources: ["https://example.com"] },
        model: "configured-model",
        grounding: { sources: [], webSearchQueries: [] },
      }),
    };

    const valuator = createGeminiPropertyValuator({}, fakeClient);
    const result = await valuator.estimate(sampleContextJson);

    expect(result).toEqual({
      ok: false,
      code: "invalid_payload",
      message: "KI-Output erfüllt das erwartete Schema nicht.",
    });
  });

  it("passes through transport errors like not_configured and timeout", async () => {
    const notConfiguredClient: GeminiJsonClient = {
      generateJson: vi.fn().mockResolvedValue({
        ok: false,
        code: "not_configured",
        message: "GEMINI_API_KEY ist nicht konfiguriert.",
      }),
    };
    const timeoutClient: GeminiJsonClient = {
      generateJson: vi.fn().mockResolvedValue({
        ok: false,
        code: "timeout",
        message: "Zeitüberschreitung bei der KI-Wertschätzung.",
      }),
    };

    expect(
      await createGeminiPropertyValuator({}, notConfiguredClient).estimate(
        sampleContextJson,
      ),
    ).toMatchObject({ ok: false, code: "not_configured" });

    expect(
      await createGeminiPropertyValuator({}, timeoutClient).estimate(
        sampleContextJson,
      ),
    ).toMatchObject({ ok: false, code: "timeout" });
  });

  it("drops invalid http: grounding sources via zod so domain validation rejects as ungrounded", async () => {
    const fakeClient: GeminiJsonClient = {
      generateJson: vi.fn().mockResolvedValue({
        ok: true,
        json: validJson,
        model: "configured-model",
        grounding: {
          sources: [{ uri: "http://insecure.example.com/report", title: "HTTP" }],
          webSearchQueries: ["12345 Musterstadt"],
        },
      }),
    };

    const result = await createGeminiPropertyValuator({}, fakeClient).estimate(
      sampleContextJson,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.grounding.sources).toEqual([]);

    const validated = validatePropertyValuation({
      rawOutput: result.data,
      sources: result.grounding.sources,
      searchQueries: result.grounding.webSearchQueries,
      context: {
        schemaVersion: 1,
        asOfMonth: "2026-11",
        location: { country: "DE", postalCode: "12345", city: "Musterstadt" },
        object: {
          usage: "owner_occupied",
          livingAreaSqm: 100,
          plotAreaSqm: null,
          constructionYear: 1998,
          energyClass: "C",
          renovations: [],
        },
        rental: null,
      },
      currentValueCents: 30_000_000,
      today: "2026-11-18",
    });
    expect(validated).toEqual({ ok: false, reason: "ungrounded" });
  });
});
