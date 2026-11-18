import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as dbModule from "@/db";
import { createProperty, getPropertyById } from "@/db/queries/contracts";
import { getTodayIsoDate } from "@/lib/domain/date";
import type {
  PropertyValuator,
  ValuatorResult,
} from "@/lib/integrations/property-valuator";
import { propertyCreateSchema } from "@/lib/validation/contracts";
import {
  createValuationEstimateHandler,
  createValuationPreviewHandler,
} from "./handlers";

const tempDirs: string[] = [];
const originalDbUrl = process.env.DATABASE_URL;
const originalGeminiKey = process.env.GEMINI_API_KEY;

beforeEach(() => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "coruscant-valuation-"));
  tempDirs.push(dir);
  process.env.DATABASE_URL = path.join(dir, "test.db");
});

afterEach(() => {
  dbModule.closeDb();
  if (originalDbUrl === undefined) delete process.env.DATABASE_URL;
  else process.env.DATABASE_URL = originalDbUrl;

  if (originalGeminiKey === undefined) delete process.env.GEMINI_API_KEY;
  else process.env.GEMINI_API_KEY = originalGeminiKey;

  vi.restoreAllMocks();

  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir && fs.existsSync(dir)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }
});

function createSampleProperty(overrides: Record<string, unknown> = {}) {
  const parsed = propertyCreateSchema.parse({
    name: "Wohnung Musterstraße 1",
    usage: "owner_occupied",
    estimatedValueCents: 30_000_000,
    estimatedValueAsOf: "2026-10-01",
    street: "Musterstraße",
    houseNumber: "1",
    postalCode: "12345",
    city: "Musterstadt",
    livingAreaSqm: 100,
    constructionYear: 1998,
    energyClass: "C",
    features: "Balkon, Keller",
    ...overrides,
  });
  return createProperty(parsed);
}

function makeValidValuatorResult(): ValuatorResult {
  return {
    ok: true,
    model: "fake-model",
    data: {
      lowerEur: 280_000,
      medianEur: 320_000,
      upperEur: 360_000,
      asOfDate: getTodayIsoDate(),
      rationale: "Vergleichbare Wohnungen in 12345 Musterstadt.",
      factors: [{ label: "Gute Energieklasse", effect: "up" }],
      confidence: "medium",
    },
    grounding: {
      sources: [{ uri: "https://example.com/markt", title: "Marktbericht" }],
      webSearchQueries: ["12345 Musterstadt Quadratmeterpreis"],
    },
  };
}

describe("API /api/properties/[id]/valuation", () => {
  it("GET returns preview contextJson without street/name and works without GEMINI_API_KEY", async () => {
    delete process.env.GEMINI_API_KEY;
    const property = createSampleProperty();

    const getHandler = createValuationPreviewHandler();
    const res = await getHandler(new Request("http://localhost/api"), {
      params: Promise.resolve({ id: property.id }),
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as { contextJson: string; usable: boolean };
    expect(body.usable).toBe(true);
    expect(body.contextJson).not.toContain("Musterstraße");
    expect(body.contextJson).not.toContain("Wohnung Musterstraße 1");
    expect(body.contextJson).toContain('"postalCode": "12345"');
  });

  it("GET returns 422 valuation_context_unavailable when postalCode is missing and 404 for unknown id", async () => {
    const property = createSampleProperty({ postalCode: null });
    const getHandler = createValuationPreviewHandler();

    const missingPlzRes = await getHandler(new Request("http://localhost/api"), {
      params: Promise.resolve({ id: property.id }),
    });
    expect(missingPlzRes.status).toBe(422);
    expect(await missingPlzRes.json()).toMatchObject({
      code: "valuation_context_unavailable",
      reason: "missing_postal_code",
    });

    const notFoundRes = await getHandler(new Request("http://localhost/api"), {
      params: Promise.resolve({ id: "missing-id" }),
    });
    expect(notFoundRes.status).toBe(404);
  });

  it("POST happy path passes exact contextJson matching GET preview and never mutates the property", async () => {
    const property = createSampleProperty();
    const before = getPropertyById(property.id);

    const getRes = await createValuationPreviewHandler()(
      new Request("http://localhost/api"),
      { params: Promise.resolve({ id: property.id }) },
    );
    const getBody = (await getRes.json()) as { contextJson: string };

    const estimate = vi.fn().mockResolvedValue(makeValidValuatorResult());
    const fakeValuator: PropertyValuator = { estimate };

    const postHandler = createValuationEstimateHandler(() => fakeValuator);
    const postRes = await postHandler(
      new Request("http://localhost/api", {
        method: "POST",
        body: "{}",
      }),
      { params: Promise.resolve({ id: property.id }) },
    );

    expect(postRes.status).toBe(200);
    const postBody = (await postRes.json()) as {
      valuation: { medianCents: number };
      warnings: unknown[];
      contextJson: string;
      model: string;
    };

    expect(postBody.valuation.medianCents).toBe(32_000_000);
    expect(postBody.warnings).toEqual([]);
    expect(postBody.model).toBe("fake-model");
    expect(postBody.contextJson).toBe(getBody.contextJson);
    expect(estimate).toHaveBeenCalledWith(getBody.contextJson);

    const after = getPropertyById(property.id);
    expect(after).toEqual(before);
  });

  it("POST with default factory returns 503 not_configured without calling fetch when GEMINI_API_KEY is missing", async () => {
    delete process.env.GEMINI_API_KEY;
    const property = createSampleProperty();
    const fetchSpy = vi.spyOn(globalThis, "fetch");

    const postHandler = createValuationEstimateHandler();
    const res = await postHandler(
      new Request("http://localhost/api", { method: "POST", body: "{}" }),
      { params: Promise.resolve({ id: property.id }) },
    );

    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ code: "not_configured" });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("POST maps transport errors timeout -> 504, network_error -> 502, invalid_payload -> 502", async () => {
    const property = createSampleProperty();

    for (const [code, expectedStatus] of [
      ["timeout", 504],
      ["network_error", 502],
      ["invalid_payload", 502],
    ] as const) {
      const handler = createValuationEstimateHandler(() => ({
        estimate: vi.fn().mockResolvedValue({
          ok: false,
          code,
          message: `Fehler ${code}`,
        }),
      }));

      const res = await handler(
        new Request("http://localhost/api", { method: "POST" }),
        { params: Promise.resolve({ id: property.id }) },
      );

      expect(res.status).toBe(expectedStatus);
      expect(await res.json()).toMatchObject({ code });
    }
  });

  it("POST returns 422 valuation_rejected for ungrounded or bounds_order without mutating DB", async () => {
    const property = createSampleProperty();
    const before = getPropertyById(property.id);

    const ungroundedBase = makeValidValuatorResult();
    if (!ungroundedBase.ok) throw new Error("unexpected");

    const ungroundedHandler = createValuationEstimateHandler(() => ({
      estimate: vi.fn().mockResolvedValue({
        ...ungroundedBase,
        grounding: { sources: [], webSearchQueries: [] },
      }),
    }));
    const ungroundedRes = await ungroundedHandler(
      new Request("http://localhost/api", { method: "POST" }),
      { params: Promise.resolve({ id: property.id }) },
    );
    expect(ungroundedRes.status).toBe(422);
    expect(await ungroundedRes.json()).toMatchObject({
      code: "valuation_rejected",
      reason: "ungrounded",
    });

    const swappedHandler = createValuationEstimateHandler(() => ({
      estimate: vi.fn().mockResolvedValue({
        ...ungroundedBase,
        data: { ...ungroundedBase.data, lowerEur: 400_000, upperEur: 300_000 },
      }),
    }));
    const swappedRes = await swappedHandler(
      new Request("http://localhost/api", { method: "POST" }),
      { params: Promise.resolve({ id: property.id }) },
    );
    expect(swappedRes.status).toBe(422);
    expect(await swappedRes.json()).toMatchObject({
      code: "valuation_rejected",
      reason: "bounds_order",
    });

    expect(getPropertyById(property.id)).toEqual(before);
  });

  it("POST returns 422 valuation_context_unsafe on PII collision and does not call valuator", async () => {
    const property = createSampleProperty({
      street: "Am Lindenhain",
      city: "Am Lindenhain",
    });

    const estimate = vi.fn();
    const handler = createValuationEstimateHandler(() => ({ estimate }));
    const res = await handler(
      new Request("http://localhost/api", { method: "POST" }),
      { params: Promise.resolve({ id: property.id }) },
    );

    expect(res.status).toBe(422);
    expect(await res.json()).toMatchObject({
      code: "valuation_context_unsafe",
    });
    expect(estimate).not.toHaveBeenCalled();
  });

  it("POST rejects extra client fields in request body with 400", async () => {
    const property = createSampleProperty();
    const estimate = vi.fn();
    const handler = createValuationEstimateHandler(() => ({ estimate }));

    const res = await handler(
      new Request("http://localhost/api", {
        method: "POST",
        body: JSON.stringify({ postalCode: "99999" }),
      }),
      { params: Promise.resolve({ id: property.id }) },
    );

    expect(res.status).toBe(400);
    expect(estimate).not.toHaveBeenCalled();
  });
});
