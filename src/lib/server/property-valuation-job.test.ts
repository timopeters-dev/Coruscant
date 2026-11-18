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
import {
  getLatestPendingSuggestion,
  getQuotaSnapshot,
  listValuationHistory,
  upsertQuotaSnapshot,
} from "@/db/queries/property-valuations";
import type {
  PropertyValuator,
  ValuatorResult,
} from "@/lib/integrations/property-valuator";
import { runAutoValuationJob } from "./property-valuation-job";

const tempDirs: string[] = [];
const originalDbUrl = process.env.DATABASE_URL;

beforeEach(() => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "coruscant-val-job-"));
  tempDirs.push(dir);
  process.env.DATABASE_URL = path.join(dir, "test.db");
});

afterEach(() => {
  dbModule.closeDb();
  if (originalDbUrl === undefined) {
    delete process.env.DATABASE_URL;
  } else {
    process.env.DATABASE_URL = originalDbUrl;
  }
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir && fs.existsSync(dir)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }
});

function createTestProperty(
  overrides: Partial<Parameters<typeof createProperty>[0]> = {},
) {
  return createProperty({
    name: "Wohnung Musterstraße 1",
    usage: "owner_occupied",
    propertyType: "etw",
    autoValuationInterval: "weekly",
    estimatedValueCents: 30_000_000,
    postalCode: "12345",
    city: "Musterstadt",
    livingAreaSqm: 100,
    ...overrides,
  });
}

function makeOkValuator(
  medianCents = 32_000_000,
  remaining = 8,
): PropertyValuator {
  return {
    estimate: vi.fn(async () => ({
      ok: true as const,
      provider: "immoanalyse" as const,
      result: {
        requestId: "req_job_1",
        cached: false,
        valuability: "valuable" as const,
        lowerCents: medianCents - 3_000_000,
        medianCents,
        upperCents: medianCents + 3_000_000,
        asOfDate: "2026-11-10",
        confidence: "high" as const,
        confidenceScore: 85,
        rationale: "Stabile Marktlage",
        limitations: [],
        factors: [],
      },
      quota: {
        limit: 10,
        used: 10 - remaining,
        remaining,
        resetAt: "2026-12-01T00:00:00Z",
        tariff: "free",
      },
    })),
  };
}

describe("property-valuation-job", () => {
  it("skips without calling valuator when API key is missing", async () => {
    createTestProperty();
    const valuator = makeOkValuator();
    const summary = await runAutoValuationJob({
      now: new Date("2026-11-18T03:30:00Z"),
      valuatorFactory: () => valuator,
      env: { NODE_ENV: "test" },
    });

    expect(summary.status).toBe("skipped");
    expect(valuator.estimate).not.toHaveBeenCalled();
  });

  it("ignores properties with interval off", async () => {
    createTestProperty({ autoValuationInterval: "off" });
    const valuator = makeOkValuator();
    const summary = await runAutoValuationJob({
      now: new Date("2026-11-18T03:30:00Z"),
      valuatorFactory: () => valuator,
      env: { NODE_ENV: "test", IMMOANALYSE_API_KEY: "iap_test_dummy" },
    });

    expect(summary).toMatchObject({ status: "success", processed: 0 });
    expect(valuator.estimate).not.toHaveBeenCalled();
  });

  it("writes directly when source is immoanalyse (or value 0) and updates history + outcome", async () => {
    const prop = createTestProperty({ estimatedValueCents: 0 });
    const valuator = makeOkValuator(32_000_000);

    const summary = await runAutoValuationJob({
      now: new Date("2026-11-18T03:30:00Z"),
      valuatorFactory: () => valuator,
      env: { NODE_ENV: "test", IMMOANALYSE_API_KEY: "iap_test_dummy" },
    });

    expect(summary).toMatchObject({
      status: "success",
      processed: 1,
      written: 1,
      historyOnly: 0,
    });

    const updated = getPropertyById(prop.id)!;
    expect(updated.estimatedValueCents).toBe(32_000_000);
    expect(updated.estimatedValueAsOf).toBe("2026-11-10");
    expect(updated.estimatedValueSource).toBe("immoanalyse");
    expect(updated.lastAutoValuationOutcome).toBe("written");
    expect(updated.lastAutoValuationAt).toBe("2026-11-18T03:30:00.000Z");

    const history = listValuationHistory(prop.id);
    expect(history).toHaveLength(1);
    expect(history[0]?.appliedAt).toBe("2026-11-18T03:30:00.000Z");
    expect(history[0]?.previousValueCents).toBe(0);
    expect(getLatestPendingSuggestion(prop.id)).toBeNull();
  });

  it("protects manual value > 0 and creates pending suggestion only", async () => {
    const prop = createTestProperty({ estimatedValueCents: 30_000_000 });
    const valuator = makeOkValuator(32_000_000);

    const summary = await runAutoValuationJob({
      now: new Date("2026-11-18T03:30:00Z"),
      valuatorFactory: () => valuator,
      env: { NODE_ENV: "test", IMMOANALYSE_API_KEY: "iap_test_dummy" },
    });

    expect(summary).toMatchObject({
      status: "success",
      processed: 1,
      written: 0,
      historyOnly: 1,
    });

    const updated = getPropertyById(prop.id)!;
    expect(updated.estimatedValueCents).toBe(30_000_000);
    expect(updated.estimatedValueSource).toBe("manual");
    expect(updated.lastAutoValuationOutcome).toBe("history_only");

    const pending = getLatestPendingSuggestion(prop.id);
    expect(pending?.medianCents).toBe(32_000_000);
    expect(pending?.appliedAt).toBeNull();
  });

  it("holds value when deviation > 40% even for immoanalyse source", async () => {
    const prop = createTestProperty({ estimatedValueCents: 0 });
    // First run writes 320.000 € and sets source = immoanalyse
    await runAutoValuationJob({
      now: new Date("2026-11-10T03:30:00Z"),
      valuatorFactory: () => makeOkValuator(32_000_000),
      env: { NODE_ENV: "test", IMMOANALYSE_API_KEY: "iap_test_dummy" },
    });

    // Second run 8 days later jumps +50% to 480.000 € -> held
    const summary = await runAutoValuationJob({
      now: new Date("2026-11-18T03:30:00Z"),
      valuatorFactory: () => makeOkValuator(48_000_000),
      env: { NODE_ENV: "test", IMMOANALYSE_API_KEY: "iap_test_dummy" },
    });

    expect(summary).toMatchObject({
      status: "success",
      processed: 1,
      written: 0,
      historyOnly: 1,
    });
    expect(getPropertyById(prop.id)!.estimatedValueCents).toBe(32_000_000);
    expect(getPropertyById(prop.id)!.lastAutoValuationOutcome).toBe(
      "history_only",
    );
  });

  it("marks not_reliably_valuable as done with outcome not_valuable and no history", async () => {
    const prop = createTestProperty({ estimatedValueCents: 30_000_000 });
    const valuator: PropertyValuator = {
      estimate: vi.fn(async (): Promise<ValuatorResult> => ({
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
          rationale: "Zu wenige Daten",
          limitations: [],
          factors: [],
        },
        quota: null,
      })),
    };

    await runAutoValuationJob({
      now: new Date("2026-11-18T03:30:00Z"),
      valuatorFactory: () => valuator,
      env: { NODE_ENV: "test", IMMOANALYSE_API_KEY: "iap_test_dummy" },
    });

    const updated = getPropertyById(prop.id)!;
    expect(updated.lastAutoValuationOutcome).toBe("not_valuable");
    expect(updated.lastAutoValuationAt).toBe("2026-11-18T03:30:00.000Z");
    expect(listValuationHistory(prop.id)).toHaveLength(0);
  });

  it("enforces at most one attempt per day on transient timeout even across restarts", async () => {
    const prop = createTestProperty();
    const timeoutValuator: PropertyValuator = {
      estimate: vi.fn(async (): Promise<ValuatorResult> => ({
        ok: false,
        code: "timeout",
        message: "Timeout",
      })),
    };

    await runAutoValuationJob({
      now: new Date("2026-11-18T03:30:00Z"),
      valuatorFactory: () => timeoutValuator,
      env: { NODE_ENV: "test", IMMOANALYSE_API_KEY: "iap_test_dummy" },
    });

    const afterFirst = getPropertyById(prop.id)!;
    expect(afterFirst.lastAutoValuationAt).toBeNull();
    expect(afterFirst.lastAutoValuationAttemptAt).toBe(
      "2026-11-18T03:30:00.000Z",
    );
    expect(afterFirst.lastAutoValuationOutcome).toBe("error");

    // Same day (simulated restart): not called again
    await runAutoValuationJob({
      now: new Date("2026-11-18T10:00:00Z"),
      valuatorFactory: () => timeoutValuator,
      env: { NODE_ENV: "test", IMMOANALYSE_API_KEY: "iap_test_dummy" },
    });
    expect(timeoutValuator.estimate).toHaveBeenCalledTimes(1);

    // Next day: retried
    await runAutoValuationJob({
      now: new Date("2026-11-19T03:30:00Z"),
      valuatorFactory: () => timeoutValuator,
      env: { NODE_ENV: "test", IMMOANALYSE_API_KEY: "iap_test_dummy" },
    });
    expect(timeoutValuator.estimate).toHaveBeenCalledTimes(2);
  });

  it("protects reserve before and during a run and aborts on 402", async () => {
    createTestProperty({ name: "Objekt 1" });
    createTestProperty({ name: "Objekt 2" });
    createTestProperty({ name: "Objekt 3" });

    upsertQuotaSnapshot({
      limit: 10,
      used: 7,
      remaining: 3,
      resetAt: "2026-12-01T00:00:00Z",
      tariff: "free",
    });

    const valuator = makeOkValuator(32_000_000, 2);
    const skipped = await runAutoValuationJob({
      now: new Date("2026-11-18T03:30:00Z"),
      valuatorFactory: () => valuator,
      env: { NODE_ENV: "test", IMMOANALYSE_API_KEY: "iap_test_dummy" },
    });
    expect(skipped.status).toBe("skipped");
    expect(valuator.estimate).not.toHaveBeenCalled();

    // Reset quota to 4, first call drops remaining to 3 -> stops after 1st object
    upsertQuotaSnapshot({
      limit: 10,
      used: 6,
      remaining: 4,
      resetAt: "2026-12-01T00:00:00Z",
      tariff: "free",
    });

    const dropValuator = makeOkValuator(32_000_000, 3);
    const partial = await runAutoValuationJob({
      now: new Date("2026-11-18T03:30:00Z"),
      valuatorFactory: () => dropValuator,
      env: { NODE_ENV: "test", IMMOANALYSE_API_KEY: "iap_test_dummy" },
    });
    expect(partial.processed).toBe(1);
    expect(dropValuator.estimate).toHaveBeenCalledTimes(1);

    // 402 during run updates quota to 0 and aborts
    upsertQuotaSnapshot({
      limit: 10,
      used: 5,
      remaining: 5,
      resetAt: "2026-12-01T00:00:00Z",
      tariff: "free",
    });
    const quota402Valuator: PropertyValuator = {
      estimate: vi.fn(async (): Promise<ValuatorResult> => ({
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
      })),
    };
    const aborted = await runAutoValuationJob({
      now: new Date("2026-11-19T03:30:00Z"),
      valuatorFactory: () => quota402Valuator,
      env: { NODE_ENV: "test", IMMOANALYSE_API_KEY: "iap_test_dummy" },
    });
    expect(aborted.status).toBe("skipped");
    expect(getQuotaSnapshot()?.remaining).toBe(0);
  });

  it("does not overwrite a manual value saved concurrently while estimate() is in flight", async () => {
    const prop = createTestProperty({ estimatedValueCents: 0 });
    const concurrentValuator: PropertyValuator = {
      estimate: vi.fn(async (): Promise<ValuatorResult> => {
        // Simulate user saving a manual value while the HTTP call is running
        updateProperty(prop.id, { estimatedValueCents: 35_000_000 });
        return {
          ok: true,
          provider: "immoanalyse",
          result: {
            requestId: "req_concurrent",
            cached: false,
            valuability: "valuable",
            lowerCents: 29_000_000,
            medianCents: 32_000_000,
            upperCents: 34_000_000,
            asOfDate: "2026-11-10",
            confidence: "high",
            confidenceScore: 82,
            rationale: "Markt",
            limitations: [],
            factors: [],
          },
          quota: null,
        };
      }),
    };

    const summary = await runAutoValuationJob({
      now: new Date("2026-11-18T20:00:00Z"),
      valuatorFactory: () => concurrentValuator,
      env: { NODE_ENV: "test", IMMOANALYSE_API_KEY: "iap_test_dummy" },
    });

    const updated = getPropertyById(prop.id)!;
    expect(updated.estimatedValueCents).toBe(35_000_000);
    expect(updated.estimatedValueSource).toBe("manual");
    expect(updated.lastAutoValuationOutcome).toBe("history_only");
    expect(summary).toMatchObject({
      status: "success",
      processed: 1,
      written: 0,
      historyOnly: 1,
    });
    expect(getLatestPendingSuggestion(prop.id)?.medianCents).toBe(32_000_000);
  });

  it("returns the newest N entries in ascending order when history exceeds limit", () => {
    const prop = createTestProperty({ estimatedValueCents: 10_000_000 });
    updateProperty(prop.id, { estimatedValueCents: 11_000_000 });
    updateProperty(prop.id, { estimatedValueCents: 12_000_000 });
    updateProperty(prop.id, { estimatedValueCents: 13_000_000 });
    updateProperty(prop.id, { estimatedValueCents: 14_000_000 });
    updateProperty(prop.id, { estimatedValueCents: 15_000_000 });

    const limited = listValuationHistory(prop.id, 3);
    expect(limited.map((e) => e.medianCents)).toEqual([
      13_000_000,
      14_000_000,
      15_000_000,
    ]);
  });
});
