import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as dbModule from "@/backend/db/connection";
import { cashflowItems, externalSnapshots } from "@/backend/db/schema";
import { PATCH as patchAllocationSettings } from "@/app/api/allocation/settings/route";
import { POST as createContract } from "@/app/api/contracts/route";
import { PATCH as patchContract } from "@/app/api/contracts/[id]/route";
import {
  DELETE as deleteCashflowItem,
  GET as getCashflowItem,
  PATCH as patchCashflowItem,
} from "@/app/api/cashflow-items/[id]/route";
import { GET as listCashflowItems, POST as createCashflowItem } from "@/app/api/cashflow-items/route";

const tempDirs: string[] = [];
const originalDbUrl = process.env.DATABASE_URL;
const originalHouseholdDummy = process.env.CORUSCANT_HOUSEHOLD_DUMMY;

beforeEach(() => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "coruscant-cashflow-"));
  tempDirs.push(dir);
  process.env.DATABASE_URL = path.join(dir, "test.db");
  process.env.CORUSCANT_HOUSEHOLD_DUMMY = "false";
});

afterEach(() => {
  dbModule.closeDb();
  if (originalDbUrl === undefined) {
    delete process.env.DATABASE_URL;
  } else {
    process.env.DATABASE_URL = originalDbUrl;
  }
  if (originalHouseholdDummy === undefined) {
    delete process.env.CORUSCANT_HOUSEHOLD_DUMMY;
  } else {
    process.env.CORUSCANT_HOUSEHOLD_DUMMY = originalHouseholdDummy;
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

    // 2. Create active active contract (1200 €) and paused contract (500 €)
    const householdContractRes = await createContract(
      new Request("http://localhost/api/contracts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "Hypothek Musterbank",
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
          name: "Pausierter Sparplan Muster",
          category: "savings_contract",
          status: "paused",
          currentBalanceCents: 500_000,
          balanceAsOfDate: "2026-11-01",
          monthlyRateCents: 50_000,
          interestRateBps: 100,
        }),
      }),
    );
    expect(personalContractRes.status).toBe(201);

    // 3. GET /api/cashflow-items derives only active contracts
    const listRes1 = await listCashflowItems();
    expect(listRes1.status).toBe(200);
    const listBody1 = (await listRes1.json()) as {
      items: Array<{ id: string }>;
      derivedContractItems: Array<{
        linkedContractId: string;
        amountCents: number;
      }>;
      summary: {
        hasHouseholdData: boolean;
        totalInflowCents: number;
        totalOutflowCents: number;
        monthlySurplusCents: number;
        contractOutflowCents: number;
      };
    };
    expect(listBody1.items).toHaveLength(2);
    expect(listBody1.derivedContractItems).toHaveLength(1);
    expect(listBody1.derivedContractItems[0]?.linkedContractId).toBe(
      householdContract.id,
    );
    // Without snapshot (household: null) and includeContractItems=false:
    // 450_000 inflow - 10_000 quarterly/3 = 440_000
    expect(listBody1.summary.hasHouseholdData).toBe(false);
    expect(listBody1.summary.totalInflowCents).toBe(450_000);
    expect(listBody1.summary.totalOutflowCents).toBe(10_000);
    expect(listBody1.summary.contractOutflowCents).toBe(0);
    expect(listBody1.summary.monthlySurplusCents).toBe(440_000);

    // 4. Enabling includeContractItems adds derived contract rate to summary
    const enableContractsRes = await patchAllocationSettings(
      new Request("http://localhost/api/allocation/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ includeContractItems: true }),
      }),
    );
    expect(enableContractsRes.status).toBe(200);

    const listResWithContracts = await listCashflowItems();
    const listBodyWithContracts = (await listResWithContracts.json()) as {
      summary: {
        totalOutflowCents: number;
        contractOutflowCents: number;
        monthlySurplusCents: number;
      };
    };
    expect(listBodyWithContracts.summary.contractOutflowCents).toBe(120_000);
    expect(listBodyWithContracts.summary.totalOutflowCents).toBe(130_000);
    expect(listBodyWithContracts.summary.monthlySurplusCents).toBe(320_000);

    // 5. Pausing household contract immediately removes it from summary
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

  it("computes consolidated summary from stored external_snapshots.household_json and respects variableBasis & includeContractItems", async () => {
    const db = dbModule.getDb();
    db.insert(externalSnapshots)
      .values({
        id: "snap-household-1",
        source: "finanz_cockpit",
        liquidCashCents: 1_000_000,
        etfStocksCents: 2_000_000,
        cryptoCents: 0,
        totalPersonalNetWorthCents: 3_000_000,
        householdJson: JSON.stringify({
          balanceCents: 400_000,
          recurringInflowCents: 500_000,
          recurringOutflowCents: 200_000,
          variableBudgetsCents: 80_000,
          variableRollingAvg3MCents: 95_000,
          variableRollingAvg6MCents: 90_000,
          categoriesBreakdown: [],
        }),
        fetchedAt: "2026-11-17T10:00:00.000Z",
      })
      .run();

    await createContract(
      new Request("http://localhost/api/contracts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "Hauskredit Musterbank",
          category: "loan",
          status: "active",
          currentBalanceCents: 15_000_000,
          balanceAsOfDate: "2026-11-01",
          monthlyRateCents: 100_000,
          interestRateBps: 320,
        }),
      }),
    );

    await patchAllocationSettings(
      new Request("http://localhost/api/allocation/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          variableBasis: "avg_3m",
          includeContractItems: false,
        }),
      }),
    );

    const resNoContract = await listCashflowItems();
    expect(resNoContract.status).toBe(200);
    const bodyNoContract = (await resNoContract.json()) as {
      summary: {
        hasHouseholdData: boolean;
        calibratedInflowCents: number;
        calibratedFixedOutflowCents: number;
        variableOutflowCents: number;
        contractOutflowCents: number;
        monthlySurplusCents: number;
        selectedVariableBasis: string;
      };
    };
    expect(bodyNoContract.summary).toMatchObject({
      hasHouseholdData: true,
      calibratedInflowCents: 500_000,
      calibratedFixedOutflowCents: 200_000,
      variableOutflowCents: 95_000,
      contractOutflowCents: 0,
      monthlySurplusCents: 205_000,
      selectedVariableBasis: "avg_3m",
    });

    await patchAllocationSettings(
      new Request("http://localhost/api/allocation/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ includeContractItems: true }),
      }),
    );

    const resWithContract = await listCashflowItems();
    const bodyWithContract = (await resWithContract.json()) as {
      summary: {
        contractOutflowCents: number;
        monthlySurplusCents: number;
      };
    };
    expect(bodyWithContract.summary.contractOutflowCents).toBe(100_000);
    expect(bodyWithContract.summary.monthlySurplusCents).toBe(105_000);
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

  it("includes propertyInflowCents/propertyOutflowCents in GET summary and forces manual source on POST", async () => {
    const db = dbModule.getDb();
    const { properties } = await import("@/backend/db/schema");
    db.insert(properties)
      .values({
        id: "prop-cf-1",
        name: "Wohnung Musterstraße 1",
        usage: "rented",
        estimatedValueCents: 25_000_000,
        monthlyColdRentCents: 80_000,
        monthlyNonRecoverableCostsCents: 6_000,
        updatedAt: new Date().toISOString(),
      })
      .run();

    const getRes = await listCashflowItems();
    expect(getRes.status).toBe(200);
    const getBody = (await getRes.json()) as {
      derivedPropertyItems: { id: string; source: string }[];
      summary: { propertyInflowCents: number; propertyOutflowCents: number };
    };
    expect(getBody.summary.propertyInflowCents).toBe(80_000);
    expect(getBody.summary.propertyOutflowCents).toBe(6_000);
    expect(getBody.derivedPropertyItems).toHaveLength(2);

    const postRes = await createCashflowItem(
      new Request("http://localhost/api/cashflow-items", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "Manuelle Miete",
          direction: "inflow",
          amountCents: 50_000,
          frequency: "monthly",
          source: "property_linked",
          active: true,
        }),
      }),
    );
    expect(postRes.status).toBe(400);
  });
});
