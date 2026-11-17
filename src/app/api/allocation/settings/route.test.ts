import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as dbModule from "@/db";
import { appMeta } from "@/db/schema";
import { GET, PATCH } from "./route";

const tempDirs: string[] = [];
const originalDbUrl = process.env.DATABASE_URL;

beforeEach(() => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "coruscant-alloc-settings-"));
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
  for (const dir of tempDirs.splice(0, tempDirs.length)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe("/api/allocation/settings", () => {
  it("returns default settings on GET and persists partial/full updates on PATCH", async () => {
    const initialRes = await GET();
    expect(initialRes.status).toBe(200);
    expect(await initialRes.json()).toEqual({
      variableBasis: "budget",
      includeContractItems: false,
    });

    const patchRes1 = await PATCH(
      new Request("http://localhost/api/allocation/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ variableBasis: "avg_3m" }),
      }),
    );
    expect(patchRes1.status).toBe(200);
    expect(await patchRes1.json()).toEqual({
      variableBasis: "avg_3m",
      includeContractItems: false,
    });

    const patchRes2 = await PATCH(
      new Request("http://localhost/api/allocation/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ includeContractItems: true }),
      }),
    );
    expect(patchRes2.status).toBe(200);
    expect(await patchRes2.json()).toEqual({
      variableBasis: "avg_3m",
      includeContractItems: true,
    });

    const verifyRes = await GET();
    expect(await verifyRes.json()).toEqual({
      variableBasis: "avg_3m",
      includeContractItems: true,
    });
  });

  it("falls back to legacy allocation_include_contracts_mode_b key when new key is absent", async () => {
    const db = dbModule.getDb();
    db.insert(appMeta)
      .values({
        key: "allocation_include_contracts_mode_b",
        value: "true",
        updatedAt: new Date().toISOString(),
      })
      .run();

    const res = await GET();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      variableBasis: "budget",
      includeContractItems: true,
    });
  });

  it("returns 400 on invalid variableBasis, invalid includeContractItems, or empty patch body", async () => {
    const invalidBasis = await PATCH(
      new Request("http://localhost/api/allocation/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ variableBasis: "avg_12m" }),
      }),
    );
    expect(invalidBasis.status).toBe(400);

    const invalidInclude = await PATCH(
      new Request("http://localhost/api/allocation/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ includeContractItems: "true" }),
      }),
    );
    expect(invalidInclude.status).toBe(400);

    const emptyPatch = await PATCH(
      new Request("http://localhost/api/allocation/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      }),
    );
    expect(emptyPatch.status).toBe(400);
  });
});
