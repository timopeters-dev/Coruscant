import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import * as dbModule from "@/backend/db/connection";
import { GET } from "@/app/api/health/route";

const healthSchema = z.object({
  status: z.enum(["ok", "error"]),
  db: z.enum(["connected", "disconnected"]),
  journalMode: z.string(),
  foreignKeys: z.boolean(),
  timestamp: z.string().datetime(),
});

const tempDirs: string[] = [];
const originalDbUrl = process.env.DATABASE_URL;

afterEach(() => {
  vi.restoreAllMocks();
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

describe("GET /api/health", () => {
  it("returns 200 with connected WAL database and foreignKeys enabled", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "coruscant-health-"));
    tempDirs.push(dir);
    process.env.DATABASE_URL = path.join(dir, "health.db");

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
