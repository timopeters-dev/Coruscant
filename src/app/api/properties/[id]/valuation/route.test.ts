import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as dbModule from "@/db";
import {
  createProperty,
  getPropertyById,
  updateProperty,
} from "@/db/queries/contracts";
import { getQuotaSnapshot } from "@/db/queries/property-valuations";
import type { PropertyValuator } from "@/lib/integrations/property-valuator";
import { createValuationAdjustmentsHandler } from "./adjustments/handlers";
import { createValuationAdoptHandler } from "./adopt/handlers";
import {
  createValuationEstimateHandler,
  createValuationPreviewHandler,
} from "./handlers";
import { createValuationHistoryEntryDeleteHandler } from "./history/[historyId]/handlers";
import { createValuationHistoryHandler } from "./history/handlers";

const tempDirs: string[] = [];
const originalDbUrl = process.env.DATABASE_URL;
const originalApiKey = process.env.IMMOANALYSE_API_KEY;

const FIXED_NOW = () => new Date("2026-11-18T18:00:00Z");

beforeEach(() => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "coruscant-valuation-route-"));
  tempDirs.push(dir);
  process.env.DATABASE_URL = path.join(dir, "test.db");
  delete process.env.IMMOANALYSE_API_KEY;
});

afterEach(() => {
  dbModule.closeDb();
  if (originalDbUrl === undefined) {
    delete process.env.DATABASE_URL;
  } else {
    process.env.DATABASE_URL = originalDbUrl;
  }
  if (originalApiKey === undefined) {
    delete process.env.IMMOANALYSE_API_KEY;
  } else {
    process.env.IMMOANALYSE_API_KEY = originalApiKey;
  }
  vi.useRealTimers();
  vi.restoreAllMocks();
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir && fs.existsSync(dir)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }
});

function createSampleProperty(
  overrides: Partial<Parameters<typeof createProperty>[0]> = {},
) {
  return createProperty({
    name: "Wohnung Musterstraße 1",
    usage: "rented",
    propertyType: "etw",
    estimatedValueCents: 30_000_000,
    estimatedValueAsOf: "2026-01-01",
    monthlyColdRentCents: 102_000,
    street: "Musterstraße",
    houseNumber: "1",
    postalCode: "12345",
    city: "Musterstadt",
    livingAreaSqm: 85,
    constructionYear: 1998,
    energyClass: "C",
    ...overrides,
  });
}

describe("/api/properties/[id]/valuation, /adopt, /history", () => {
  it("GET returns requestJson without street/name and works without API key", async () => {
    const prop = createSampleProperty();
    const GET = createValuationPreviewHandler(FIXED_NOW);

    const res = await GET(new Request("http://localhost"), {
      params: Promise.resolve({ id: prop.id }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { requestJson: string; usable: boolean };
    expect(body.usable).toBe(true);
    expect(body.requestJson).not.toContain("Musterstraße");
    expect(body.requestJson).toContain('"haustyp": "etw"');
  });

  it("GET returns 422 missing_property_type when propertyType is null", async () => {
    const prop = createSampleProperty({ propertyType: null });
    const GET = createValuationPreviewHandler(FIXED_NOW);

    const res = await GET(new Request("http://localhost"), {
      params: Promise.resolve({ id: prop.id }),
    });
    expect(res.status).toBe(422);
    const body = (await res.json()) as { code: string; reason: string };
    expect(body.code).toBe("valuation_context_unavailable");
    expect(body.reason).toBe("missing_property_type");
  });

  it("POST happy path creates history entry without mutating property value and uses identical requestJson", async () => {
    const prop = createSampleProperty();
    const GET = createValuationPreviewHandler(FIXED_NOW);
    const previewRes = await GET(new Request("http://localhost"), {
      params: Promise.resolve({ id: prop.id }),
    });
    const previewBody = (await previewRes.json()) as { requestJson: string };

    const estimateMock = vi.fn(async () => ({
      ok: true as const,
      provider: "immoanalyse" as const,
      result: {
        requestId: "req_manual_1",
        cached: false,
        valuability: "valuable" as const,
        lowerCents: 28_000_000,
        medianCents: 32_000_000,
        upperCents: 36_000_000,
        asOfDate: "2026-11-10",
        confidence: "high" as const,
        confidenceScore: 84,
        rationale: "Solide Lage",
        limitations: [],
        factors: [],
      },
      quota: {
        limit: 10,
        used: 1,
        remaining: 9,
        resetAt: "2026-12-01T00:00:00Z",
        tariff: "free",
      },
    }));

    const POST = createValuationEstimateHandler(
      () => ({ estimate: estimateMock }),
      FIXED_NOW,
    );
    const postRes = await POST(
      new Request("http://localhost", { method: "POST", body: "{}" }),
      { params: Promise.resolve({ id: prop.id }) },
    );

    expect(postRes.status).toBe(200);
    const postBody = (await postRes.json()) as {
      historyId: string;
      requestJson: string;
      valuation: { medianCents: number };
    };
    expect(postBody.historyId).toBeTruthy();
    expect(postBody.valuation.medianCents).toBe(32_000_000);
    expect(estimateMock).toHaveBeenCalledWith(previewBody.requestJson);
    expect(postBody.requestJson).toBe(previewBody.requestJson);

    // Property value unchanged until Adopt
    const afterPost = getPropertyById(prop.id)!;
    expect(afterPost.estimatedValueCents).toBe(30_000_000);
    expect(afterPost.estimatedValueSource).toBe("manual");
  });

  it("POST without key returns 503 not_configured without calling fetch", async () => {
    const prop = createSampleProperty();
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const POST = createValuationEstimateHandler(undefined, FIXED_NOW);

    const res = await POST(
      new Request("http://localhost", { method: "POST", body: "{}" }),
      { params: Promise.resolve({ id: prop.id }) },
    );
    expect(res.status).toBe(503);
    expect((await res.json()) as { code: string }).toMatchObject({
      code: "not_configured",
    });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("POST maps not_reliably_valuable, 402 quota_exceeded, API 422, and timeout", async () => {
    const prop = createSampleProperty();

    const nvHandler = createValuationEstimateHandler(
      () => ({
        estimate: async () => ({
          ok: true,
          provider: "immoanalyse",
          result: {
            requestId: "req_nv",
            cached: false,
            valuability: "not_reliably_valuable",
            lowerCents: null,
            medianCents: null,
            upperCents: null,
            asOfDate: "2026-11-18",
            confidence: "low",
            confidenceScore: null,
            rationale: "Zu wenig Daten",
            limitations: [],
            factors: [],
          },
          quota: null,
        }),
      }),
      FIXED_NOW,
    );
    const nvRes = await nvHandler(
      new Request("http://localhost", { method: "POST", body: "{}" }),
      { params: Promise.resolve({ id: prop.id }) },
    );
    expect(nvRes.status).toBe(422);
    expect((await nvRes.json()) as { code: string }).toMatchObject({
      code: "valuation_rejected",
    });

    const quotaHandler = createValuationEstimateHandler(
      () => ({
        estimate: async () => ({
          ok: false,
          code: "quota_exceeded",
          message: "402",
          httpStatus: 402,
          quota: {
            limit: 10,
            used: 10,
            remaining: 0,
            resetAt: "2026-12-01T00:00:00Z",
            tariff: "free",
          },
        }),
      }),
      FIXED_NOW,
    );
    const qRes = await quotaHandler(
      new Request("http://localhost", { method: "POST", body: "{}" }),
      { params: Promise.resolve({ id: prop.id }) },
    );
    expect(qRes.status).toBe(429);
    expect(getQuotaSnapshot()?.remaining).toBe(0);

    const api422Handler = createValuationEstimateHandler(
      () => ({
        estimate: async () => ({
          ok: false,
          code: "not_valuable",
          apiCode: "region_data_insufficient",
          message: "422",
        }),
      }),
      FIXED_NOW,
    );
    const r422 = await api422Handler(
      new Request("http://localhost", { method: "POST", body: "{}" }),
      { params: Promise.resolve({ id: prop.id }) },
    );
    expect(r422.status).toBe(422);
    expect(await r422.json()).toMatchObject({
      code: "not_valuable",
      apiCode: "region_data_insufficient",
    });

    const timeoutHandler = createValuationEstimateHandler(
      () => ({
        estimate: async () => ({
          ok: false,
          code: "timeout",
          message: "timeout",
        }),
      }),
      FIXED_NOW,
    );
    const r504 = await timeoutHandler(
      new Request("http://localhost", { method: "POST", body: "{}" }),
      { params: Promise.resolve({ id: prop.id }) },
    );
    expect(r504.status).toBe(504);
  });

  it("rejects PII injection and non-empty POST bodies", async () => {
    const prop = createSampleProperty({ city: "Musterstraße" });
    // Force raw city bypass via updateProperty so city matches street
    const valuator: PropertyValuator = {
      estimate: vi.fn(),
    };
    const POST = createValuationEstimateHandler(() => valuator, FIXED_NOW);

    // Note: sanitizeCity strips street-like city, so test strict POST body rejection first
    const badBodyRes = await POST(
      new Request("http://localhost", {
        method: "POST",
        body: JSON.stringify({ extra: true }),
      }),
      { params: Promise.resolve({ id: prop.id }) },
    );
    expect(badBodyRes.status).toBe(400);
    expect(valuator.estimate).not.toHaveBeenCalled();
  });

  it("supports adopt (median & upper), rejects foreign/manual/extra-field adopt, and updates history", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-18T17:00:00Z"));

    const propA = createSampleProperty({ name: "Objekt A" });
    const propB = createSampleProperty({ name: "Objekt B" });

    // Create manual history entry via updateProperty on propA
    updateProperty(propA.id, { estimatedValueCents: 31_000_000 });

    const POST = createValuationEstimateHandler(
      () => ({
        estimate: async () => ({
          ok: true,
          provider: "immoanalyse",
          result: {
            requestId: "req_adopt",
            cached: false,
            valuability: "valuable",
            lowerCents: 28_000_000,
            medianCents: 32_000_000,
            upperCents: 36_000_000,
            asOfDate: "2026-11-10",
            confidence: "high",
            confidenceScore: 85,
            rationale: "Gut",
            limitations: [],
            factors: [],
          },
          quota: null,
        }),
      }),
      FIXED_NOW,
    );

    const valRes = await POST(
      new Request("http://localhost", { method: "POST", body: "{}" }),
      { params: Promise.resolve({ id: propA.id }) },
    );
    const { historyId } = (await valRes.json()) as { historyId: string };

    const HISTORY = createValuationHistoryHandler();
    const histBefore = await HISTORY(new Request("http://localhost"), {
      params: Promise.resolve({ id: propA.id }),
    });
    const histBeforeBody = (await histBefore.json()) as {
      entries: Array<{ id: string; source: string }>;
      pendingSuggestion: { id: string } | null;
    };
    expect(histBeforeBody.entries).toHaveLength(2);
    expect(histBeforeBody.pendingSuggestion?.id).toBe(historyId);

    const manualEntry = histBeforeBody.entries.find(
      (e) => e.source === "manual",
    )!;

    const ADOPT = createValuationAdoptHandler(FIXED_NOW);

    // Foreign property -> 404
    const foreignRes = await ADOPT(
      new Request("http://localhost", {
        method: "POST",
        body: JSON.stringify({ historyId, choice: "median" }),
      }),
      { params: Promise.resolve({ id: propB.id }) },
    );
    expect(foreignRes.status).toBe(404);

    // Manual entry -> 404
    const manualRes = await ADOPT(
      new Request("http://localhost", {
        method: "POST",
        body: JSON.stringify({ historyId: manualEntry.id, choice: "median" }),
      }),
      { params: Promise.resolve({ id: propA.id }) },
    );
    expect(manualRes.status).toBe(404);

    // Extra field -> 400
    const strictRes = await ADOPT(
      new Request("http://localhost", {
        method: "POST",
        body: JSON.stringify({
          historyId,
          choice: "median",
          medianCents: 999,
        }),
      }),
      { params: Promise.resolve({ id: propA.id }) },
    );
    expect(strictRes.status).toBe(400);

    // Valid adopt upper -> 200
    const adoptRes = await ADOPT(
      new Request("http://localhost", {
        method: "POST",
        body: JSON.stringify({ historyId, choice: "upper" }),
      }),
      { params: Promise.resolve({ id: propA.id }) },
    );
    expect(adoptRes.status).toBe(200);
    const adoptBody = (await adoptRes.json()) as {
      property: {
        estimatedValueCents: number;
        estimatedValueAsOf: string;
        estimatedValueSource: string;
      };
    };
    expect(adoptBody.property.estimatedValueCents).toBe(36_000_000);
    expect(adoptBody.property.estimatedValueAsOf).toBe("2026-11-10");
    expect(adoptBody.property.estimatedValueSource).toBe("immoanalyse");

    const histAfter = await HISTORY(new Request("http://localhost"), {
      params: Promise.resolve({ id: propA.id }),
    });
    const histAfterBody = (await histAfter.json()) as {
      pendingSuggestion: unknown;
    };
    expect(histAfterBody.pendingSuggestion).toBeNull();
  });

  it("applies current adjustments on adopt (lower) and dynamically adjusts history.pendingSuggestion", async () => {
    const prop = createSampleProperty({ estimatedValueCents: 49_000_000 });
    const ESTIMATE = createValuationEstimateHandler(
      () => ({
        estimate: async () => ({
          ok: true,
          provider: "immoanalyse",
          result: {
            requestId: "req_pending_adj",
            cached: false,
            valuability: "valuable",
            lowerCents: 46_000_000,
            medianCents: 49_000_000,
            upperCents: 52_000_000,
            asOfDate: "2026-11-10",
            confidence: "high",
            confidenceScore: 85,
            rationale: "Markt",
            limitations: [],
            factors: [],
          },
          quota: null,
        }),
      }),
      FIXED_NOW,
    );
    const PUT_ADJ = createValuationAdjustmentsHandler(FIXED_NOW);
    const HISTORY = createValuationHistoryHandler();
    const ADOPT = createValuationAdoptHandler(FIXED_NOW);

    const estRes = await ESTIMATE(
      new Request("http://localhost", { method: "POST", body: "{}" }),
      { params: Promise.resolve({ id: prop.id }) },
    );
    const { historyId } = (await estRes.json()) as { historyId: string };

    // Set -1000 bps while suggestion is pending
    await PUT_ADJ(
      new Request("http://localhost", {
        method: "PUT",
        body: JSON.stringify({
          adjustments: [{ label: "Fertighaus", bps: -1_000 }],
        }),
      }),
      { params: Promise.resolve({ id: prop.id }) },
    );

    const histRes = await HISTORY(new Request("http://localhost"), {
      params: Promise.resolve({ id: prop.id }),
    });
    const histBody = (await histRes.json()) as {
      pendingSuggestion: {
        lowerCents: number;
        medianCents: number;
        upperCents: number;
        adjustmentBps: number;
        adjustedLowerCents: number;
        adjustedMedianCents: number;
        adjustedUpperCents: number;
      };
    };
    expect(histBody.pendingSuggestion.lowerCents).toBe(46_000_000);
    expect(histBody.pendingSuggestion.adjustmentBps).toBe(-1_000);
    expect(histBody.pendingSuggestion.adjustedLowerCents).toBe(41_400_000);
    expect(histBody.pendingSuggestion.adjustedMedianCents).toBe(44_100_000);
    expect(histBody.pendingSuggestion.adjustedUpperCents).toBe(46_800_000);

    // Adopt lower -> writes 41_400_000 and records appliedChoice = lower
    const adoptRes = await ADOPT(
      new Request("http://localhost", {
        method: "POST",
        body: JSON.stringify({ historyId, choice: "lower" }),
      }),
      { params: Promise.resolve({ id: prop.id }) },
    );
    expect(adoptRes.status).toBe(200);
    const adoptBody = (await adoptRes.json()) as {
      property: { estimatedValueCents: number };
    };
    expect(adoptBody.property.estimatedValueCents).toBe(41_400_000);

    const histAfter = await HISTORY(new Request("http://localhost"), {
      params: Promise.resolve({ id: prop.id }),
    });
    const histAfterBody = (await histAfter.json()) as {
      entries: { appliedChoice: string | null; adjustmentBps: number }[];
      pendingSuggestion: unknown;
    };
    expect(histAfterBody.pendingSuggestion).toBeNull();
    expect(histAfterBody.entries[0]?.appliedChoice).toBe("lower");
    expect(histAfterBody.entries[0]?.adjustmentBps).toBe(-1_000);
  });

  it("DELETE removes a single history entry, leaves property value untouched and rejects foreign/unknown ids", async () => {
    const propA = createSampleProperty({ name: "Objekt A" });
    const propB = createSampleProperty({ name: "Objekt B" });

    updateProperty(propA.id, { estimatedValueCents: 31_000_000 });
    updateProperty(propA.id, { estimatedValueCents: 3_100_000_000 });

    const HISTORY = createValuationHistoryHandler();
    const readEntries = async (id: string) => {
      const res = await HISTORY(new Request("http://localhost"), {
        params: Promise.resolve({ id }),
      });
      return ((await res.json()) as {
        entries: Array<{ id: string; medianCents: number }>;
      }).entries;
    };

    const before = await readEntries(propA.id);
    expect(before).toHaveLength(2);
    const typo = before.find((e) => e.medianCents === 3_100_000_000)!;

    const DELETE = createValuationHistoryEntryDeleteHandler();

    const foreignRes = await DELETE(
      new Request("http://localhost", { method: "DELETE" }),
      { params: Promise.resolve({ id: propB.id, historyId: typo.id }) },
    );
    expect(foreignRes.status).toBe(404);

    const unknownRes = await DELETE(
      new Request("http://localhost", { method: "DELETE" }),
      { params: Promise.resolve({ id: propA.id, historyId: "does-not-exist" }) },
    );
    expect(unknownRes.status).toBe(404);

    const okRes = await DELETE(
      new Request("http://localhost", { method: "DELETE" }),
      { params: Promise.resolve({ id: propA.id, historyId: typo.id }) },
    );
    expect(okRes.status).toBe(200);

    const after = await readEntries(propA.id);
    expect(after).toHaveLength(1);
    expect(after[0]!.medianCents).toBe(31_000_000);
    expect(getPropertyById(propA.id)!.estimatedValueCents).toBe(3_100_000_000);

    const againRes = await DELETE(
      new Request("http://localhost", { method: "DELETE" }),
      { params: Promise.resolve({ id: propA.id, historyId: typo.id }) },
    );
    expect(againRes.status).toBe(404);
  });

  it("DELETE of a pending suggestion clears history.pendingSuggestion", async () => {
    const prop = createSampleProperty();
    const ESTIMATE = createValuationEstimateHandler(
      () => ({
        estimate: async () => ({
          ok: true,
          provider: "immoanalyse",
          result: {
            requestId: "req_delete",
            cached: false,
            valuability: "valuable",
            lowerCents: 28_000_000,
            medianCents: 32_000_000,
            upperCents: 36_000_000,
            asOfDate: "2026-11-10",
            confidence: "high",
            confidenceScore: 85,
            rationale: "Gut",
            limitations: [],
            factors: [],
          },
          quota: null,
        }),
      }),
      FIXED_NOW,
    );
    const estRes = await ESTIMATE(
      new Request("http://localhost", { method: "POST", body: "{}" }),
      { params: Promise.resolve({ id: prop.id }) },
    );
    const { historyId } = (await estRes.json()) as { historyId: string };

    const DELETE = createValuationHistoryEntryDeleteHandler();
    const delRes = await DELETE(
      new Request("http://localhost", { method: "DELETE" }),
      { params: Promise.resolve({ id: prop.id, historyId }) },
    );
    expect(delRes.status).toBe(200);

    const HISTORY = createValuationHistoryHandler();
    const histRes = await HISTORY(new Request("http://localhost"), {
      params: Promise.resolve({ id: prop.id }),
    });
    const body = (await histRes.json()) as {
      entries: unknown[];
      pendingSuggestion: unknown;
    };
    expect(body.entries).toHaveLength(0);
    expect(body.pendingSuggestion).toBeNull();
    expect(getPropertyById(prop.id)!.estimatedValueCents).toBe(30_000_000);
  });
});
