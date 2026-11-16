import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as dbModule from "@/db";
import { cashflowItems } from "@/db/schema";
import { POST as createContract } from "@/app/api/contracts/route";
import { PATCH as patchContract } from "@/app/api/contracts/[id]/route";
import {
  DELETE as deleteCashflowItem,
  GET as getCashflowItem,
  PATCH as patchCashflowItem,
} from "./[id]/route";
import { GET as listCashflowItems, POST as createCashflowItem } from "./route";

const tempDirs: string[] = [];
const originalDbUrl = process.env.DATABASE_URL;

beforeEach(() => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "coruscant-cashflow-"));
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

describe("/api/cashflow-items CRUD & live contract derivation", () => {
  it("supports manual CRUD, frequency normalization, and live household contract sync", async () => {
    // 1. Create manual inflow (monthly) and outflow (quarterly)
    const inflowRes = await createCashflowItem(
      new Request("http://localhost/api/cashflow-items", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "Nettogehalt Muster",
          direction: "inflow",
          amountCents: 450_000,
          frequency: "monthly",
          active: true,
        }),
      }),
    );
    expect(inflowRes.status).toBe(201);
    const { item: inflow } = (await inflowRes.json()) as {
      item: { id: string; source: string };
    };
    expect(inflow.source).toBe("manual");

    const outflowRes = await createCashflowItem(
      new Request("http://localhost/api/cashflow-items", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "Grundsteuer Musterstadt",
          direction: "outflow",
          amountCents: 30_000,
          frequency: "quarterly",
        }),
      }),
    );
    expect(outflowRes.status).toBe(201);
    const { item: outflow } = (await outflowRes.json()) as {
      item: { id: string };
    };

    // 2. Create active household contract (1200 €) and personal contract (500 €)
    const householdContractRes = await createContract(
      new Request("http://localhost/api/contracts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "Hypothek Musterbank",
          sphere: "household",
          category: "loan",
          status: "active",
          currentBalanceCents: 25_000_000,
          balanceAsOfDate: "2026-11-01",
          monthlyRateCents: 120_000,
          interestRateBps: 350,
        }),
      }),
    );
    expect(householdContractRes.status).toBe(201);
    const { contract: householdContract } =
      (await householdContractRes.json()) as {
        contract: { id: string };
      };

    const personalContractRes = await createContract(
      new Request("http://localhost/api/contracts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "Privat-Sparplan Muster",
          sphere: "personal",
          category: "savings_contract",
          status: "active",
          currentBalanceCents: 500_000,
          balanceAsOfDate: "2026-11-01",
          monthlyRateCents: 50_000,
          interestRateBps: 100,
        }),
      }),
    );
    expect(personalContractRes.status).toBe(201);

    // 3. GET /api/cashflow-items derives only active household contracts
    const listRes1 = await listCashflowItems();
    expect(listRes1.status).toBe(200);
    const listBody1 = (await listRes1.json()) as {
      items: Array<{ id: string }>;
      derivedContractItems: Array<{
        linkedContractId: string;
        amountCents: number;
      }>;
      summary: {
        totalInflowCents: number;
        totalOutflowCents: number;
        monthlySurplusCents: number;
      };
    };
    expect(listBody1.items).toHaveLength(2);
    expect(listBody1.derivedContractItems).toHaveLength(1);
    expect(listBody1.derivedContractItems[0]?.linkedContractId).toBe(
      householdContract.id,
    );
    // 450_000 inflow - (10_000 quarterly/3 + 120_000 contract) = 320_000
    expect(listBody1.summary.totalInflowCents).toBe(450_000);
    expect(listBody1.summary.totalOutflowCents).toBe(130_000);
    expect(listBody1.summary.monthlySurplusCents).toBe(320_000);

    // 4. Pausing household contract immediately removes it from summary
    const pauseRes = await patchContract(
      new Request(`http://localhost/api/contracts/${householdContract.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "paused" }),
      }),
      { params: Promise.resolve({ id: householdContract.id }) },
    );
    expect(pauseRes.status).toBe(200);

    const listRes2 = await listCashflowItems();
    const listBody2 = (await listRes2.json()) as {
      derivedContractItems: unknown[];
      summary: { monthlySurplusCents: number };
    };
    expect(listBody2.derivedContractItems).toHaveLength(0);
    expect(listBody2.summary.monthlySurplusCents).toBe(440_000);

    // 5. PATCH { active: false } excludes item from summary on subsequent GET
    const patchRes = await patchCashflowItem(
      new Request(`http://localhost/api/cashflow-items/${outflow.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ active: false }),
      }),
      { params: Promise.resolve({ id: outflow.id }) },
    );
    expect(patchRes.status).toBe(200);

    const listResAfterDeactivate = await listCashflowItems();
    const listBodyAfterDeactivate = (await listResAfterDeactivate.json()) as {
      summary: { totalOutflowCents: number; monthlySurplusCents: number };
    };
    expect(listBodyAfterDeactivate.summary.totalOutflowCents).toBe(0);
    expect(listBodyAfterDeactivate.summary.monthlySurplusCents).toBe(450_000);

    const getRes = await getCashflowItem(
      new Request(`http://localhost/api/cashflow-items/${outflow.id}`),
      { params: Promise.resolve({ id: outflow.id }) },
    );
    expect(getRes.status).toBe(200);

    const delRes = await deleteCashflowItem(
      new Request(`http://localhost/api/cashflow-items/${outflow.id}`, {
        method: "DELETE",
      }),
      { params: Promise.resolve({ id: outflow.id }) },
    );
    expect(delRes.status).toBe(200);
  });

  it("rejects invalid amounts, unknown ids, and does not leak internal paths", async () => {

    const floatRes = await createCashflowItem(
      new Request("http://localhost/api/cashflow-items", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "Ungültig",
          direction: "inflow",
          amountCents: 12.34,
          frequency: "monthly",
        }),
      }),
    );
    expect(floatRes.status).toBe(400);
    const errText = await floatRes.text();
    expect(errText).not.toContain("/tmp");
    expect(errText).not.toContain("node_modules");

    const notFoundGet = await getCashflowItem(
      new Request("http://localhost/api/cashflow-items/does-not-exist"),
      { params: Promise.resolve({ id: "does-not-exist" }) },
    );
    expect(notFoundGet.status).toBe(404);

    const notFoundPatch = await patchCashflowItem(
      new Request("http://localhost/api/cashflow-items/does-not-exist", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ active: false }),
      }),
      { params: Promise.resolve({ id: "does-not-exist" }) },
    );
    expect(notFoundPatch.status).toBe(404);

    const notFoundDelete = await deleteCashflowItem(
      new Request("http://localhost/api/cashflow-items/does-not-exist", {
        method: "DELETE",
      }),
      { params: Promise.resolve({ id: "does-not-exist" }) },
    );
    expect(notFoundDelete.status).toBe(404);

    // Non-manual cashflow item cannot be modified or deleted via API (400)
    const db = dbModule.getDb();
    db.insert(cashflowItems)
      .values({
        id: "sync-item-1",
        name: "Cockpit Sync Position",
        direction: "inflow",
        amountCents: 100_000,
        frequency: "monthly",
        source: "finanz_cockpit_sync",
        linkedContractId: null,
        active: true,
        updatedAt: new Date().toISOString(),
      })
      .run();

    const nonManualPatch = await patchCashflowItem(
      new Request("http://localhost/api/cashflow-items/sync-item-1", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ active: false }),
      }),
      { params: Promise.resolve({ id: "sync-item-1" }) },
    );
    expect(nonManualPatch.status).toBe(400);

    const nonManualDelete = await deleteCashflowItem(
      new Request("http://localhost/api/cashflow-items/sync-item-1", {
        method: "DELETE",
      }),
      { params: Promise.resolve({ id: "sync-item-1" }) },
    );
    expect(nonManualDelete.status).toBe(400);
  });
});
