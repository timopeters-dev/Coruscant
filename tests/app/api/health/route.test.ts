import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import * as dbModule from "@/backend/db/connection";
import { GET } from "@/app/api/health/route";
import { withTempDatabase } from "@tests/helpers/temp-db";

const healthSchema = z.object({
  status: z.enum(["ok", "error"]),
  db: z.enum(["connected", "disconnected"]),
  journalMode: z.string(),
  foreignKeys: z.boolean(),
  timestamp: z.string().datetime(),
});

withTempDatabase();
afterEach(() => vi.restoreAllMocks());

describe("GET /api/health", () => {
  it("returns 200 with connected WAL database and foreignKeys enabled", async () => {
    const response = await GET();
    expect(response.status).toBe(200);

    const body = healthSchema.parse(await response.json());
    expect(body.status).toBe("ok");
    expect(body.db).toBe("connected");
    expect(body.journalMode.toLowerCase()).toBe("wal");
    expect(body.foreignKeys).toBe(true);
  });

  it("returns 503 without leaking internal paths or stack traces when DB fails", async () => {
    vi.spyOn(dbModule, "getSqlite").mockImplementation(() => {
      throw new Error("ENOENT: /secret/internal/path/coruscant.db");
    });

    const response = await GET();
    expect(response.status).toBe(503);

    const rawText = await response.text();
    expect(rawText).not.toContain("/secret/internal/path");
    expect(rawText).not.toContain("ENOENT");

    const body = healthSchema.parse(JSON.parse(rawText));
    expect(body.status).toBe("error");
    expect(body.db).toBe("disconnected");
    expect(body.foreignKeys).toBe(false);
  });
});
