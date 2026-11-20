import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as dbModule from "@/backend/db/connection";
import { createContract } from "@/backend/db/queries/contracts";
import { contractCreateSchema } from "@/validation/contracts";
import { POST } from "@/app/api/report/advisor/question-check/route";

const tempDirs: string[] = [];
const originalDbUrl = process.env.DATABASE_URL;

beforeEach(() => {
  const dir = fs.mkdtempSync(
    path.join(os.tmpdir(), "coruscant-question-check-db-"),
  );
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

describe("POST /api/report/advisor/question-check", () => {
  it("returns ok for clean text and known_name for seeded provider without leaking the name", async () => {
    createContract(
      contractCreateSchema.parse({
        name: "Darlehen Nord",
        provider: "Musterbank AG",
        category: "loan",
        status: "active",
        currentBalanceCents: 10_000_000,
        balanceAsOfDate: "2026-11-19",
        monthlyRateCents: 100_000,
        interestRateBps: 350,
        repaymentType: "annuity",
      }),
    );

    const okRes = await POST(
      new Request("http://localhost/api/report/advisor/question-check", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text: "Soll ich lieber sondertilgen oder in einen ETF sparen?",
        }),
      }),
    );
    expect(okRes.status).toBe(200);
    expect(okRes.headers.get("Cache-Control")).toBe("no-store");
    expect(await okRes.json()).toEqual({ ok: true, issues: [] });

    const hitRes = await POST(
      new Request("http://localhost/api/report/advisor/question-check", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text: "Lohnt sich Sondertilgung bei der Musterbank?",
        }),
      }),
    );
    expect(hitRes.status).toBe(200);
    expect(hitRes.headers.get("Cache-Control")).toBe("no-store");
    const rawText = await hitRes.text();
    expect(rawText.toLowerCase()).not.toContain("musterbank");
    expect(JSON.parse(rawText)).toEqual({ ok: false, issues: ["known_name"] });
  });

  it("rejects text > 2000 chars, extra keys, and invalid JSON with 400 and Cache-Control: no-store", async () => {
    const tooLong = await POST(
      new Request("http://localhost/api/report/advisor/question-check", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: "a".repeat(2001) }),
      }),
    );
    expect(tooLong.status).toBe(400);
    expect(tooLong.headers.get("Cache-Control")).toBe("no-store");
    expect(await tooLong.json()).toEqual({ error: "invalid_input" });

    const extraKey = await POST(
      new Request("http://localhost/api/report/advisor/question-check", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: "ok", extra: true }),
      }),
    );
    expect(extraKey.status).toBe(400);
    expect(extraKey.headers.get("Cache-Control")).toBe("no-store");

    const invalidJson = await POST(
      new Request("http://localhost/api/report/advisor/question-check", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{not-json",
      }),
    );
    expect(invalidJson.status).toBe(400);
    expect(invalidJson.headers.get("Cache-Control")).toBe("no-store");
  });
});
