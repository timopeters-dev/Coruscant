import { describe, expect, it, vi } from "vitest";
import {
  fetchFinanzCockpitSummary,
  getFinanzCockpitBridgeConfig,
} from "./finanz-cockpit-client";

const VALID_PAYLOAD = {
  source: "finanz_cockpit",
  liquidCashCents: 250_000,
  etfStocksCents: 1_500_000,
  cryptoCents: 100_000,
  totalPersonalNetWorthCents: 1_850_000,
  fetchedAt: "2026-11-16T12:00:00.000Z",
};

describe("getFinanzCockpitBridgeConfig", () => {
  it("reports configured only when valid HTTP(S) URL and token are set", () => {
    expect(
      getFinanzCockpitBridgeConfig({
        FINANZ_COCKPIT_URL: "http://127.0.0.1:3001",
        EXTERNAL_SUMMARY_TOKEN: "secret-token",
      }).configured,
    ).toBe(true);

    expect(
      getFinanzCockpitBridgeConfig({
        FINANZ_COCKPIT_URL: "ftp://invalid",
        EXTERNAL_SUMMARY_TOKEN: "secret-token",
      }),
    ).toMatchObject({ configured: false, validUrl: false, publicUrl: null });
  });

  it("resolves publicUrl with FINANZ_COCKPIT_PUBLIC_URL precedence, fallback to FINANZ_COCKPIT_URL, and rejects unsafe URLs", () => {
    expect(
      getFinanzCockpitBridgeConfig({
        FINANZ_COCKPIT_URL: "http://127.0.0.1:3001",
      }).publicUrl,
    ).toBe("http://127.0.0.1:3001");

    expect(
      getFinanzCockpitBridgeConfig({
        FINANZ_COCKPIT_URL: "http://internal-cockpit:3001",
        FINANZ_COCKPIT_PUBLIC_URL: "https://cockpit.muster.local",
      }).publicUrl,
    ).toBe("https://cockpit.muster.local");

    expect(
      getFinanzCockpitBridgeConfig({
        FINANZ_COCKPIT_URL: "http://127.0.0.1:3001",
        FINANZ_COCKPIT_PUBLIC_URL: "javascript:alert(1)",
      }).publicUrl,
    ).toBeNull();

    expect(
      getFinanzCockpitBridgeConfig({
        FINANZ_COCKPIT_PUBLIC_URL: "ftp://example.com",
      }).publicUrl,
    ).toBeNull();
  });

  it("parses syncIntervalMinutes with default 15 and safe fallback on invalid values", () => {
    expect(getFinanzCockpitBridgeConfig({}).syncIntervalMinutes).toBe(15);
    expect(
      getFinanzCockpitBridgeConfig({
        FINANZ_COCKPIT_SYNC_INTERVAL_MINUTES: "0",
      }).syncIntervalMinutes,
    ).toBe(0);
    expect(
      getFinanzCockpitBridgeConfig({
        FINANZ_COCKPIT_SYNC_INTERVAL_MINUTES: "60",
      }).syncIntervalMinutes,
    ).toBe(60);

    for (const invalid of ["abc", "-1", "2.5", "99999"]) {
      expect(
        getFinanzCockpitBridgeConfig({
          FINANZ_COCKPIT_SYNC_INTERVAL_MINUTES: invalid,
        }).syncIntervalMinutes,
      ).toBe(15);
    }
  });
});

describe("fetchFinanzCockpitSummary", () => {
  it("fetches and validates summary with or without trailing slash", async () => {
    const fetchFn = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify(VALID_PAYLOAD), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    const res = await fetchFinanzCockpitSummary({
      baseUrl: "http://127.0.0.1:3001/",
      token: "muster-token",
      fetchFn,
    });

    expect(res).toEqual({ ok: true, data: VALID_PAYLOAD });
    expect(fetchFn).toHaveBeenCalledWith(
      "http://127.0.0.1:3001/api/external/summary",
      expect.objectContaining({
        method: "GET",
        cache: "no-store",
        headers: {
          Authorization: "Bearer muster-token",
          Accept: "application/json",
        },
      }),
    );
  });

  it("returns not_configured and invalid_config for missing or invalid configuration", async () => {
    const missing = await fetchFinanzCockpitSummary({
      baseUrl: "",
      token: "",
    });
    expect(missing).toMatchObject({ ok: false, code: "not_configured" });

    const invalid = await fetchFinanzCockpitSummary({
      baseUrl: "not-a-url",
      token: "muster-token",
    });
    expect(invalid).toMatchObject({ ok: false, code: "invalid_config" });
  });

  it("maps 401, 500, timeout, network error, and invalid payload cleanly without leaking token", async () => {
    const secretToken = "super-secret-token-never-leak";

    const unauth = await fetchFinanzCockpitSummary({
      baseUrl: "http://127.0.0.1:3001",
      token: secretToken,
      fetchFn: vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 401 })),
    });
    expect(unauth).toMatchObject({ ok: false, code: "unauthorized", httpStatus: 401 });
    expect(JSON.stringify(unauth)).not.toContain(secretToken);

    const httpErr = await fetchFinanzCockpitSummary({
      baseUrl: "http://127.0.0.1:3001",
      token: secretToken,
      fetchFn: vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 500 })),
    });
    expect(httpErr).toMatchObject({ ok: false, code: "http_error", httpStatus: 500 });

    const timeoutErr = new Error("Timed out");
    timeoutErr.name = "TimeoutError";
    const timeoutRes = await fetchFinanzCockpitSummary({
      baseUrl: "http://127.0.0.1:3001",
      token: secretToken,
      fetchFn: vi.fn<typeof fetch>().mockRejectedValue(timeoutErr),
    });
    expect(timeoutRes).toMatchObject({ ok: false, code: "timeout" });

    const netRes = await fetchFinanzCockpitSummary({
      baseUrl: "http://127.0.0.1:3001",
      token: secretToken,
      fetchFn: vi.fn<typeof fetch>().mockRejectedValue(new Error("ECONNREFUSED")),
    });
    expect(netRes).toMatchObject({ ok: false, code: "network_error" });

    const invalidPayloadRes = await fetchFinanzCockpitSummary({
      baseUrl: "http://127.0.0.1:3001",
      token: secretToken,
      fetchFn: vi.fn<typeof fetch>().mockResolvedValue(
        new Response(JSON.stringify({ ...VALID_PAYLOAD, liquidCashCents: -10 }), {
          status: 200,
        }),
      ),
    });
    expect(invalidPayloadRes).toMatchObject({ ok: false, code: "invalid_payload" });

    const validHouseholdPayload = {
      ...VALID_PAYLOAD,
      household: {
        balanceCents: 425_000,
        recurringInflowCents: 460_000,
        recurringOutflowCents: 195_000,
        variableBudgetsCents: 95_000,
        variableRollingAvg3MCents: 104_500,
        variableRollingAvg6MCents: 99_200,
        categoriesBreakdown: [
          {
            categoryId: "cat-food",
            categoryName: "Lebensmittel",
            color: "#059669",
            budgetCents: 60_000,
            avg3MCents: 61_500,
            avg6MCents: 58_200,
          },
        ],
      },
    };
    const householdRes = await fetchFinanzCockpitSummary({
      baseUrl: "http://127.0.0.1:3001",
      token: secretToken,
      fetchFn: vi.fn<typeof fetch>().mockResolvedValue(
        new Response(JSON.stringify(validHouseholdPayload), { status: 200 }),
      ),
    });
    expect(householdRes).toEqual({ ok: true, data: validHouseholdPayload });

    const invalidHouseholdRes = await fetchFinanzCockpitSummary({
      baseUrl: "http://127.0.0.1:3001",
      token: secretToken,
      fetchFn: vi.fn<typeof fetch>().mockResolvedValue(
        new Response(
          JSON.stringify({
            ...VALID_PAYLOAD,
            household: {
              ...validHouseholdPayload.household,
              variableRollingAvg3MCents: 123.45,
            },
          }),
          { status: 200 },
        ),
      ),
    });
    expect(invalidHouseholdRes).toMatchObject({
      ok: false,
      code: "invalid_payload",
    });
  });
});
