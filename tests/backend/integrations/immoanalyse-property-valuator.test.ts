import { describe, expect, it, vi } from "vitest";
import { createImmoAnalysePropertyValuator } from "@/backend/integrations/immoanalyse-property-valuator";

const SAMPLE_BODY = JSON.stringify(
  {
    haustyp: "etw",
    plz: "12345",
    wohnflaeche: 85,
    vermietet: false,
  },
  null,
  2,
);

const VALID_RESPONSE = {
  request_id: "req_abc",
  cached: false,
  data_as_of: "2026-11-01",
  bewertbarkeit: {
    status: "valuable",
    begruendung: "Solide Vergleichsdaten in Musterstadt",
  },
  marktwert: {
    min: 280_000,
    median: 320_000,
    max: 360_000,
  },
  konfidenz: {
    wert: 80,
    level: "hoch",
  },
  kontingent: {
    limit: 10,
    verbraucht: 1,
    verbleibend: 9,
    reset_at: "2026-12-01T00:00:00Z",
    tarif: "free",
  },
};

describe("immoanalyse-property-valuator", () => {
  it("returns not_configured without calling fetch when API key is missing", async () => {
    const fetchMock = vi.fn<typeof fetch>();
    const valuator = createImmoAnalysePropertyValuator({
      apiKey: "   ",
      fetchImpl: fetchMock,
    });

    const res = await valuator.estimate(SAMPLE_BODY);
    expect(res).toEqual({
      ok: false,
      code: "not_configured",
      message: expect.any(String),
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("sends X-API-Key and exact requestJson body to /valuation and returns normalized result + quota", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify(VALID_RESPONSE), { status: 200 }),
    );
    const valuator = createImmoAnalysePropertyValuator({
      apiKey: "iap_test_dummy",
      baseUrl: "https://immoanalyse.pro/api/v1/",
      fetchImpl: fetchMock,
    });

    const res = await valuator.estimate(SAMPLE_BODY);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("https://immoanalyse.pro/api/v1/valuation");
    expect(init?.method).toBe("POST");
    expect(init?.body).toBe(SAMPLE_BODY);
    expect((init?.headers as Record<string, string>)["X-API-Key"]).toBe(
      "iap_test_dummy",
    );

    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.provider).toBe("immoanalyse");
    expect(res.result.medianCents).toBe(32_000_000);
    expect(res.quota).toEqual({
      limit: 10,
      used: 1,
      remaining: 9,
      resetAt: "2026-12-01T00:00:00Z",
      tariff: "free",
    });
  });

  it("maps HTTP error statuses and never leaks key or body in messages", async () => {
    const cases: Array<{
      status: number;
      body: unknown;
      expectedCode: string;
    }> = [
      { status: 400, body: { error: { code: "bad_request", message: "bad" } }, expectedCode: "invalid_request" },
      { status: 401, body: { error: { code: "unauthorized", message: "invalid" } }, expectedCode: "unauthorized" },
      {
        status: 402,
        body: {
          error: {
            code: "quota_exceeded",
            message: "empty",
            details: { reset_at: "2026-12-01T00:00:00Z" },
          },
        },
        expectedCode: "quota_exceeded",
      },
      {
        status: 422,
        body: {
          error: {
            code: "region_data_insufficient",
            message: "zu wenig Daten",
          },
        },
        expectedCode: "not_valuable",
      },
      { status: 429, body: {}, expectedCode: "rate_limited" },
      { status: 503, body: {}, expectedCode: "http_error" },
    ];

    for (const testCase of cases) {
      const valuator = createImmoAnalysePropertyValuator({
        apiKey: "iap_test_dummy",
        fetchImpl: vi.fn<typeof fetch>().mockResolvedValue(
          new Response(JSON.stringify(testCase.body), {
            status: testCase.status,
          }),
        ),
      });

      const res = await valuator.estimate(SAMPLE_BODY);
      expect(res.ok).toBe(false);
      if (res.ok) continue;
      expect(res.code).toBe(testCase.expectedCode);
      expect(res.message).not.toContain("iap_test_dummy");
      expect(res.message).not.toContain("12345");
      if (testCase.status === 402) {
        expect(res.quota?.remaining).toBe(0);
        expect(res.quota?.resetAt).toBe("2026-12-01T00:00:00Z");
      }
      if (testCase.status === 422) {
        expect(res.apiCode).toBe("region_data_insufficient");
      }
    }
  });

  it("handles abort timeout, network error, broken JSON, and schema violation", async () => {
    const abortError = new Error("Aborted");
    abortError.name = "AbortError";

    const timeoutValuator = createImmoAnalysePropertyValuator({
      apiKey: "iap_test_dummy",
      fetchImpl: vi.fn<typeof fetch>().mockRejectedValue(abortError),
    });
    expect(await timeoutValuator.estimate(SAMPLE_BODY)).toMatchObject({
      ok: false,
      code: "timeout",
    });

    const netValuator = createImmoAnalysePropertyValuator({
      apiKey: "iap_test_dummy",
      fetchImpl: vi.fn<typeof fetch>().mockRejectedValue(new Error("ECONNREFUSED")),
    });
    expect(await netValuator.estimate(SAMPLE_BODY)).toMatchObject({
      ok: false,
      code: "network_error",
    });

    const brokenJsonValuator = createImmoAnalysePropertyValuator({
      apiKey: "iap_test_dummy",
      fetchImpl: vi.fn<typeof fetch>().mockResolvedValue(
        new Response("not-json", { status: 200 }),
      ),
    });
    expect(await brokenJsonValuator.estimate(SAMPLE_BODY)).toMatchObject({
      ok: false,
      code: "invalid_payload",
    });

    const invalidSchemaValuator = createImmoAnalysePropertyValuator({
      apiKey: "iap_test_dummy",
      fetchImpl: vi.fn<typeof fetch>().mockResolvedValue(
        new Response(JSON.stringify({ unexpected: true }), { status: 200 }),
      ),
    });
    expect(await invalidSchemaValuator.estimate(SAMPLE_BODY)).toMatchObject({
      ok: false,
      code: "invalid_payload",
    });
  });
});
