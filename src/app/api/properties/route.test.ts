import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as dbModule from "@/db";
import { POST as createContract } from "@/app/api/contracts/route";
import { GET as listContracts } from "@/app/api/contracts/route";
import {
  DELETE as deletePropertyById,
  GET as getPropertyById,
  PATCH as patchPropertyById,
} from "./[id]/route";
import { GET as listProperties, POST as createProperty } from "./route";

const tempDirs: string[] = [];
const originalDbUrl = process.env.DATABASE_URL;

beforeEach(() => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "coruscant-properties-"));
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

describe("/api/properties CRUD & integrity", () => {
  it("supports POST -> GET list -> GET [id] -> PATCH [id] -> DELETE [id]", async () => {
    const createReq = new Request("http://localhost/api/properties", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "Immobilie #0 (Musterstraße 1)",
        usage: "owner_occupied",
        purchaseDate: "2024-03-01",
        purchasePriceCents: 45000000,
        estimatedValueCents: 48000000,
      }),
    });

    const createRes = await createProperty(createReq);
    expect(createRes.status).toBe(201);
    const createdBody = (await createRes.json()) as {
      property: { id: string; name: string; estimatedValueCents: number };
    };
    const propertyId = createdBody.property.id;
    expect(createdBody.property.name).toBe("Immobilie #0 (Musterstraße 1)");
    expect(createdBody.property.estimatedValueCents).toBe(48000000);

    const listRes = await listProperties();
    expect(listRes.status).toBe(200);
    const listBody = (await listRes.json()) as {
      properties: Array<{ id: string }>;
    };
    expect(listBody.properties).toHaveLength(1);
    expect(listBody.properties[0]?.id).toBe(propertyId);

    const getRes = await getPropertyById(new Request("http://localhost"), {
      params: Promise.resolve({ id: propertyId }),
    });
    expect(getRes.status).toBe(200);

    const patchRes = await patchPropertyById(
      new Request("http://localhost", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ estimatedValueCents: 49500000 }),
      }),
      { params: Promise.resolve({ id: propertyId }) },
    );
    expect(patchRes.status).toBe(200);
    const patchedBody = (await patchRes.json()) as {
      property: { estimatedValueCents: number };
    };
    expect(patchedBody.property.estimatedValueCents).toBe(49500000);

    const deleteRes = await deletePropertyById(new Request("http://localhost"), {
      params: Promise.resolve({ id: propertyId }),
    });
    expect(deleteRes.status).toBe(200);
    expect(await deleteRes.json()).toEqual({ deletedId: propertyId });

    const afterDeleteRes = await getPropertyById(
      new Request("http://localhost"),
      { params: Promise.resolve({ id: propertyId }) },
    );
    expect(afterDeleteRes.status).toBe(404);
  });

  it("returns 400 on invalid inputs and 404 on unknown IDs without leaking internals", async () => {
    const invalidRes = await createProperty(
      new Request("http://localhost/api/properties", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "",
          purchaseDate: "2026-02-30",
          estimatedValueCents: -500,
        }),
      }),
    );
    expect(invalidRes.status).toBe(400);
    const raw = await invalidRes.text();
    expect(raw).not.toContain("SQLITE");
    expect(raw).not.toContain("Error:");

    const unknownRes = await getPropertyById(new Request("http://localhost"), {
      params: Promise.resolve({ id: "missing-prop" }),
    });
    expect(unknownRes.status).toBe(404);
  });

  it("sets linkedPropertyId to null on contracts when a linked property is deleted", async () => {
    const propRes = await createProperty(
      new Request("http://localhost/api/properties", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "Immobilie #0 (Musterstraße 1)",
          estimatedValueCents: 40000000,
        }),
      }),
    );
    const { property } = (await propRes.json()) as {
      property: { id: string };
    };

    const contractRes = await createContract(
      new Request("http://localhost/api/contracts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "Hauskredit Musterbank",
          category: "loan",
          currentBalanceCents: 25000000,
          balanceAsOfDate: "2026-11-01",
          monthlyRateCents: 120000,
          interestRateBps: 340,
          linkedPropertyId: property.id,
        }),
      }),
    );
    expect(contractRes.status).toBe(201);

    const delRes = await deletePropertyById(new Request("http://localhost"), {
      params: Promise.resolve({ id: property.id }),
    });
    expect(delRes.status).toBe(200);

    const contractsRes = await listContracts();
    const { contracts } = (await contractsRes.json()) as {
      contracts: Array<{ id: string; linkedPropertyId: string | null }>;
    };
    expect(contracts).toHaveLength(1);
    expect(contracts[0]?.linkedPropertyId).toBeNull();
  });
});
