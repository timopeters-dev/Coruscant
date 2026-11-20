import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as dbModule from "@/backend/db/connection";
import { createProperty } from "@/backend/db/queries/contracts";
import { createValuationStatusHandler } from "@/app/api/valuation/status/handlers";

const tempDirs: string[] = [];
const originalDbUrl = process.env.DATABASE_URL;

beforeEach(() => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "coruscant-val-status-"));
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

describe("GET /api/valuation/status", () => {
  it("reports configured: false without key, never leaks key, and aggregates plannedConsumption", async () => {
    createProperty({
      name: "Objekt 1",
      usage: "owner_occupied",
      estimatedValueCents: 30_000_000,
      autoValuationInterval: "weekly",
    });
    createProperty({
      name: "Objekt 2",
      usage: "owner_occupied",
      estimatedValueCents: 20_000_000,
      autoValuationInterval: "weekly",
    });

    const GET = createValuationStatusHandler({
      nowFn: () => new Date("2026-11-18T02:00:00Z"),
      env: { NODE_ENV: "development", IMMOANALYSE_API_KEY: "" },
    });

    const res = await GET();
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
