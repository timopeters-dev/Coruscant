import { describe, expect, it } from "vitest";
import { withTempDatabase } from "@tests/helpers/temp-db";
import { apiRequest } from "@tests/helpers/http";
import * as dbModule from "@/backend/db/connection";
import { appMeta } from "@/backend/db/schema";
import { GET, PATCH } from "@/app/api/allocation/settings/route";

withTempDatabase();

describe("/api/allocation/settings", () => {
  it("returns default settings on GET and persists partial/full updates on PATCH", async () => {
    const initialRes = await GET(apiRequest("/api/allocation/settings"));
    expect(initialRes.status).toBe(200);
    expect(await initialRes.json()).toEqual({
      variableBasis: "budget",
      includeContractItems: false,
      includePropertyItems: true,
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
      includePropertyItems: true,
    });

    const patchRes2 = await PATCH(
      new Request("http://localhost/api/allocation/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ includeContractItems: true, includePropertyItems: false }),
      }),
    );
    expect(patchRes2.status).toBe(200);
    expect(await patchRes2.json()).toEqual({
      variableBasis: "avg_3m",
      includeContractItems: true,
      includePropertyItems: false,
    });

    const verifyRes = await GET(apiRequest("/api/allocation/settings"));
    expect(await verifyRes.json()).toEqual({
      variableBasis: "avg_3m",
      includeContractItems: true,
      includePropertyItems: false,
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

    const res = await GET(apiRequest("/api/allocation/settings"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      variableBasis: "budget",
      includeContractItems: true,
      includePropertyItems: true,
    });
  });

  it("returns 400 on invalid variableBasis, invalid includeContractItems, invalid includePropertyItems, or empty patch body", async () => {
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

    const invalidIncludeProperty = await PATCH(
      new Request("http://localhost/api/allocation/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ includePropertyItems: "false" }),
      }),
    );
    expect(invalidIncludeProperty.status).toBe(400);

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
