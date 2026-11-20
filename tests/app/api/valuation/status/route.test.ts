import { afterEach, describe, expect, it, vi } from "vitest";
import { GET } from "@/app/api/valuation/status/route";
import { createProperty } from "@/backend/db/queries/contracts";
import { apiRequest } from "@tests/helpers/http";
import { withTempDatabase } from "@tests/helpers/temp-db";

withTempDatabase();
afterEach(() => vi.useRealTimers());

describe("GET /api/valuation/status", () => {
  it("reports configured: false without key, never leaks key, and aggregates plannedConsumption", async () => {
    for (const name of ["Objekt 1", "Objekt 2"]) {
      createProperty({ name, usage: "owner_occupied", estimatedValueCents: 30_000_000, autoValuationInterval: "weekly" });
    }
    vi.useFakeTimers({ now: new Date("2026-11-18T02:00:00Z"), toFake: ["Date"] });
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("IMMOANALYSE_API_KEY", "");

    const res = await GET(apiRequest("/api/valuation/status"));
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      configured: boolean;
      quota: { snapshot: unknown; evaluation: { allowed: boolean } };
      plannedConsumption: { peakMonthly: number; overBudget: boolean };
    };
    expect(body.configured).toBe(false);
    expect(body.quota.snapshot).toBeNull();
    expect(body.quota.evaluation.allowed).toBe(true);
    expect(body.plannedConsumption.peakMonthly).toBe(10);
    expect(body.plannedConsumption.overBudget).toBe(true);
    expect(JSON.stringify(body)).not.toContain("IMMOANALYSE_API_KEY");
  });
});
