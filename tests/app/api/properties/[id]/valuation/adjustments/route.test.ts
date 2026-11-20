import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  adjustmentsRoute,
  adoptRoute,
  estimateRoute,
  historyRoute,
} from "@tests/helpers/valuation-routes";
import { withTempDatabase } from "@tests/helpers/temp-db";
import { createProperty, getPropertyById } from "@/backend/db/queries/properties";
import { listValuationHistory } from "@/backend/db/queries/property-valuations";
import { PATCH as patchProperty } from "@/app/api/properties/[id]/route";

const FIXED_NOW_1 = () => new Date("2026-11-18T18:00:00Z");
const FIXED_NOW_2 = () => new Date("2026-11-18T19:00:00Z");

vi.mock("@/backend/integrations/property-valuator", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/backend/integrations/property-valuator")>();
  return { ...actual, createDefaultPropertyValuator: vi.fn(actual.createDefaultPropertyValuator) };
});

withTempDatabase();

beforeEach(() => vi.stubEnv("IMMOANALYSE_API_KEY", ""));

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

function createSampleProperty(
  overrides: Partial<Parameters<typeof createProperty>[0]> = {},
) {
  return createProperty({
    name: "Haus Musterstraße 1",
    usage: "owner_occupied",
    propertyType: "efh",
    estimatedValueCents: 49_000_000,
    postalCode: "12345",
    city: "Musterstadt",
    livingAreaSqm: 140,
    ...overrides,
  });
}

function makeEstimateHandler(nowFn = FIXED_NOW_1) {
  return estimateRoute(() => ({
      estimate: async () => ({
        ok: true,
        provider: "immoanalyse",
        result: {
          requestId: "req_base_1",
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
    }), nowFn);
}

describe("PUT /api/properties/[id]/valuation/adjustments", () => {
  it("recomputes immoanalyse median value, inserts adjustment history entry, and resets cleanly on []", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const prop = createSampleProperty();
    const ESTIMATE = makeEstimateHandler(FIXED_NOW_1);
    const ADOPT = adoptRoute(FIXED_NOW_1);
    const PUT_ADJ = adjustmentsRoute(FIXED_NOW_2);

    const estRes = await ESTIMATE(
      new Request("http://localhost", { method: "POST", body: "{}" }),
      { params: Promise.resolve({ id: prop.id }) },
    );
    const { historyId } = (await estRes.json()) as { historyId: string };

    await ADOPT(
      new Request("http://localhost", {
        method: "POST",
        body: JSON.stringify({ historyId, choice: "median" }),
      }),
      { params: Promise.resolve({ id: prop.id }) },
    );

    const putRes = await PUT_ADJ(
      new Request("http://localhost", {
        method: "PUT",
        body: JSON.stringify({
          adjustments: [{ label: "Fertighaus", bps: -1_000 }],
          expectedEstimatedValueCents: 49_000_000,
        }),
      }),
      { params: Promise.resolve({ id: prop.id }) },
    );

    expect(putRes.status).toBe(200);
    const putBody = (await putRes.json()) as {
      property: {
        estimatedValueCents: number;
        estimatedValueAsOf: string;
        estimatedValueSource: string;
        valuationAdjustments: { label: string; bps: number }[];
      };
      totalBps: number;
      recompute: { fromCents: number; toCents: number } | null;
      reason: string | null;
    };
    expect(putBody.totalBps).toBe(-1_000);
    expect(putBody.recompute).toEqual({
      fromCents: 49_000_000,
      toCents: 44_100_000,
    });
    expect(putBody.reason).toBeNull();
    expect(putBody.property.estimatedValueCents).toBe(44_100_000);
    expect(putBody.property.estimatedValueAsOf).toBe("2026-11-10");
    expect(putBody.property.estimatedValueSource).toBe("immoanalyse");
    expect(putBody.property.valuationAdjustments).toEqual([
      { label: "Fertighaus", bps: -1_000 },
    ]);

    const history = listValuationHistory(prop.id);
    const adjEntry = history[history.length - 1]!;
    expect(adjEntry.trigger).toBe("adjustment");
    expect(adjEntry.source).toBe("immoanalyse");
    expect(adjEntry.previousValueCents).toBe(49_000_000);
    expect(adjEntry.valuedAt).toBe(FIXED_NOW_2().toISOString());
    expect(adjEntry.requestId).toBe("req_base_1");
    expect(adjEntry.adjustmentBps).toBe(-1_000);
    expect(adjEntry.appliedChoice).toBe("median");

    // Reset to [] -> recomputes back to 49_000_000
    const resetRes = await PUT_ADJ(
      new Request("http://localhost", {
        method: "PUT",
        body: JSON.stringify({ adjustments: [] }),
      }),
      { params: Promise.resolve({ id: prop.id }) },
    );
    expect(resetRes.status).toBe(200);
    const resetBody = (await resetRes.json()) as {
      property: { estimatedValueCents: number; valuationAdjustments: unknown[] };
      recompute: { fromCents: number; toCents: number } | null;
    };
    expect(resetBody.recompute).toEqual({
      fromCents: 44_100_000,
      toCents: 49_000_000,
    });
    expect(resetBody.property.estimatedValueCents).toBe(49_000_000);
    expect(resetBody.property.valuationAdjustments).toEqual([]);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("recomputes on upperCents when appliedChoice was upper", async () => {
    const prop = createSampleProperty();
    const ESTIMATE = makeEstimateHandler(FIXED_NOW_1);
    const ADOPT = adoptRoute(FIXED_NOW_1);
    const PUT_ADJ = adjustmentsRoute(FIXED_NOW_2);

    const estRes = await ESTIMATE(
      new Request("http://localhost", { method: "POST", body: "{}" }),
      { params: Promise.resolve({ id: prop.id }) },
    );
    const { historyId } = (await estRes.json()) as { historyId: string };

    await ADOPT(
      new Request("http://localhost", {
        method: "POST",
        body: JSON.stringify({ historyId, choice: "upper" }),
      }),
      { params: Promise.resolve({ id: prop.id }) },
    );

    const putRes = await PUT_ADJ(
      new Request("http://localhost", {
        method: "PUT",
        body: JSON.stringify({
          adjustments: [{ label: "Fertighaus", bps: -1_000 }],
        }),
      }),
      { params: Promise.resolve({ id: prop.id }) },
    );
    expect(putRes.status).toBe(200);
    const body = (await putRes.json()) as {
      recompute: { fromCents: number; toCents: number } | null;
    };
    expect(body.recompute).toEqual({
      fromCents: 52_000_000,
      toCents: 46_800_000,
    });
  });

  it("saves adjustments without recompute when source is manual", async () => {
    const prop = createSampleProperty({ estimatedValueCents: 49_000_000 });
    const PUT_ADJ = adjustmentsRoute(FIXED_NOW_1);

    const putRes = await PUT_ADJ(
      new Request("http://localhost", {
        method: "PUT",
        body: JSON.stringify({
          adjustments: [{ label: "Ruhige Lage", bps: 300 }],
        }),
      }),
      { params: Promise.resolve({ id: prop.id }) },
    );
    expect(putRes.status).toBe(200);
    const body = (await putRes.json()) as {
      property: { estimatedValueCents: number };
      recompute: null;
      reason: string;
    };
    expect(body.recompute).toBeNull();
    expect(body.reason).toBe("manual_source");
    expect(body.property.estimatedValueCents).toBe(49_000_000);
    expect(listValuationHistory(prop.id)).toHaveLength(0);
  });

  it("returns 409 value_changed atomically when expectedEstimatedValueCents mismatches", async () => {
    const prop = createSampleProperty({ estimatedValueCents: 49_000_000 });
    const PUT_ADJ = adjustmentsRoute(FIXED_NOW_1);

    const res = await PUT_ADJ(
      new Request("http://localhost", {
        method: "PUT",
        body: JSON.stringify({
          adjustments: [{ label: "Fertighaus", bps: -1_000 }],
          expectedEstimatedValueCents: 48_000_000,
        }),
      }),
      { params: Promise.resolve({ id: prop.id }) },
    );
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({
      code: "value_changed",
      currentValueCents: 49_000_000,
    });
    expect(getPropertyById(prop.id)!.valuationAdjustments).toBeNull();
  });

  it("rejects invalid payloads with 400, unknown property with 404, and PATCH with valuationAdjustments with 400", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const prop = createSampleProperty();
    const PUT_ADJ = adjustmentsRoute(FIXED_NOW_1);

    const badPayloads = [
      // 9 items
      JSON.stringify({
        adjustments: Array.from({ length: 9 }, (_, i) => ({
          label: `P${i}`,
          bps: 100,
        })),
      }),
      // sum > 5000
      JSON.stringify({
        adjustments: [
          { label: "A", bps: 3_000 },
          { label: "B", bps: 3_000 },
        ],
      }),
      // bps = 0
      JSON.stringify({ adjustments: [{ label: "Zero", bps: 0 }] }),
      // duplicate
      JSON.stringify({
        adjustments: [
          { label: "Fertighaus", bps: -1_000 },
          { label: "fertighaus", bps: -500 },
        ],
      }),
      // extra field
      JSON.stringify({ adjustments: [], extra: true }),
      // broken JSON
      "{broken",
    ];

    for (const body of badPayloads) {
      const res = await PUT_ADJ(
        new Request("http://localhost", { method: "PUT", body }),
        { params: Promise.resolve({ id: prop.id }) },
      );
      expect(res.status).toBe(400);
    }

    const notFoundRes = await PUT_ADJ(
      new Request("http://localhost", {
        method: "PUT",
        body: JSON.stringify({ adjustments: [] }),
      }),
      { params: Promise.resolve({ id: "00000000-0000-0000-0000-000000000000" }) },
    );
    expect(notFoundRes.status).toBe(404);

    const patchRes = await patchProperty(
      new Request("http://localhost", {
        method: "PATCH",
        body: JSON.stringify({
          valuationAdjustments: [{ label: "Fertighaus", bps: -1_000 }],
        }),
      }),
      { params: Promise.resolve({ id: prop.id }) },
    );
    expect(patchRes.status).toBe(400);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("preserves an open pendingSuggestion across PUT /adjustments so it can still be adopted", async () => {
    const prop = createSampleProperty({ estimatedValueCents: 49_000_000 });
    const ESTIMATE_1 = makeEstimateHandler(FIXED_NOW_1);
    const ESTIMATE_2 = estimateRoute(() => ({
        estimate: async () => ({
          ok: true,
          provider: "immoanalyse",
          result: {
            requestId: "req_pending_after_adopt",
            cached: false,
            valuability: "valuable",
            lowerCents: 70_000_000,
            medianCents: 75_000_000,
            upperCents: 80_000_000,
            asOfDate: "2026-11-15",
            confidence: "high",
            confidenceScore: 85,
            rationale: "Markt",
            limitations: [],
            factors: [],
          },
          quota: null,
        }),
      }), FIXED_NOW_2);
    const ADOPT = adoptRoute(FIXED_NOW_1);
    const PUT_ADJ = adjustmentsRoute(() => new Date("2026-11-18T20:00:00Z"));
    const HISTORY = historyRoute();

    // 1. First estimate + adopt
    const est1Res = await ESTIMATE_1(
      new Request("http://localhost", { method: "POST", body: "{}" }),
      { params: Promise.resolve({ id: prop.id }) },
    );
    const { historyId: firstId } = (await est1Res.json()) as {
      historyId: string;
    };
    await ADOPT(
      new Request("http://localhost", {
        method: "POST",
        body: JSON.stringify({ historyId: firstId, choice: "median" }),
      }),
      { params: Promise.resolve({ id: prop.id }) },
    );

    // 2. Second estimate creates open pendingSuggestion (history_only)
    const est2Res = await ESTIMATE_2(
      new Request("http://localhost", { method: "POST", body: "{}" }),
      { params: Promise.resolve({ id: prop.id }) },
    );
    const { historyId: pendingId } = (await est2Res.json()) as {
      historyId: string;
    };

    // 3. PUT adjustments -> inserts trigger='adjustment' row with newer valuedAt
    const putRes = await PUT_ADJ(
      new Request("http://localhost", {
        method: "PUT",
        body: JSON.stringify({
          adjustments: [{ label: "Fertighaus", bps: -1_000 }],
          expectedEstimatedValueCents: 49_000_000,
        }),
      }),
      { params: Promise.resolve({ id: prop.id }) },
    );
    expect(putRes.status).toBe(200);

    // 4. GET history must still expose pendingSuggestion with updated adjusted bounds
    const histRes = await HISTORY(new Request("http://localhost"), {
      params: Promise.resolve({ id: prop.id }),
    });
    expect(histRes.status).toBe(200);
    const histBody = (await histRes.json()) as {
      pendingSuggestion: {
        id: string;
        adjustedMedianCents: number;
      } | null;
    };
    expect(histBody.pendingSuggestion?.id).toBe(pendingId);
    expect(histBody.pendingSuggestion?.adjustedMedianCents).toBe(67_500_000);

    // 5. Adopt on pendingSuggestion must succeed
    const adopt2Res = await ADOPT(
      new Request("http://localhost", {
        method: "POST",
        body: JSON.stringify({ historyId: pendingId, choice: "median" }),
      }),
      { params: Promise.resolve({ id: prop.id }) },
    );
    expect(adopt2Res.status).toBe(200);
    const adopt2Body = (await adopt2Res.json()) as {
      property: { estimatedValueCents: number };
    };
    expect(adopt2Body.property.estimatedValueCents).toBe(67_500_000);
  });

  it("persists catalogKey in property and valuation history and rejects unknown/duplicate/exclusive conflicts", async () => {
    const prop = createSampleProperty({ estimatedValueCents: 49_000_000 });
    const ESTIMATE = makeEstimateHandler(FIXED_NOW_1);
    const ADOPT = adoptRoute(FIXED_NOW_1);
    const PUT_ADJ = adjustmentsRoute(FIXED_NOW_2);

    const estRes = await ESTIMATE(
      new Request("http://localhost", { method: "POST", body: "{}" }),
      { params: Promise.resolve({ id: prop.id }) },
    );
    const { historyId } = (await estRes.json()) as { historyId: string };
    await ADOPT(
      new Request("http://localhost", {
        method: "POST",
        body: JSON.stringify({ historyId, choice: "median" }),
      }),
      { params: Promise.resolve({ id: prop.id }) },
    );

    const putOk = await PUT_ADJ(
      new Request("http://localhost", {
        method: "PUT",
        body: JSON.stringify({
          adjustments: [
            {
              label: "irgendein alt-label",
              bps: -1_000,
              catalogKey: "construction_prefab",
            },
          ],
          expectedEstimatedValueCents: 49_000_000,
        }),
      }),
      { params: Promise.resolve({ id: prop.id }) },
    );
    expect(putOk.status).toBe(200);
    const okBody = (await putOk.json()) as {
      property: {
        valuationAdjustments: Array<{
          label: string;
          bps: number;
          catalogKey?: string;
        }>;
      };
    };
    expect(okBody.property.valuationAdjustments).toEqual([
      {
        label: "Fertighaus (Holzständerbauweise)",
        bps: -1_000,
        catalogKey: "construction_prefab",
      },
    ]);
    const history = listValuationHistory(prop.id);
    const adjEntry = history.find((h) => h.trigger === "adjustment")!;
    expect(adjEntry.adjustmentsJson).toContain("construction_prefab");

    // Validation errors for catalogKey
    const invalidPayloads = [
      {
        adjustments: [
          { label: "X", bps: 100, catalogKey: "nonexistent_key" },
        ],
      },
      {
        adjustments: [
          { label: "Vollkeller", bps: 300, catalogKey: "basement_full" },
          { label: "Vollkeller", bps: 300, catalogKey: "basement_full" },
        ],
      },
      {
        adjustments: [
          { label: "Balkon / Terrasse / Loggia", bps: 300, catalogKey: "features_balcony" },
          { label: "Kein Balkon", bps: -300, catalogKey: "features_no_balcony" },
        ],
      },
      {
        adjustments: [
          { label: "Frei", bps: 100, extraField: true },
        ],
      },
    ];
    for (const payload of invalidPayloads) {
      const badRes = await PUT_ADJ(
        new Request("http://localhost", {
          method: "PUT",
          body: JSON.stringify(payload),
        }),
        { params: Promise.resolve({ id: prop.id }) },
      );
      expect(badRes.status).toBe(400);
    }
  });
});
