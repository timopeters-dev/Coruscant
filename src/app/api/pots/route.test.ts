import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as dbModule from "@/db";
import { POST as createContract } from "@/app/api/contracts/route";
import { POST as createProperty } from "@/app/api/properties/route";
import {
  DELETE as deletePotById,
  GET as getPotById,
  PATCH as patchPotById,
} from "./[id]/route";
import { POST as allocatePots } from "./allocate/route";
import { POST as reorderPots } from "./reorder/route";
import { GET as listPots, POST as createPot } from "./route";

const tempDirs: string[] = [];
const originalDbUrl = process.env.DATABASE_URL;

beforeEach(() => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "coruscant-pots-"));
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

describe("/api/pots CRUD, percentage guard, reorder, and atomic allocation", () => {
  it("supports all 3 rule types, links, percentage guard, reorder, atomic allocation, and cascade delete", async () => {
    // Setup property & contract for linking
    const propRes = await createProperty(
      new Request("http://localhost/api/properties", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "Musterstraße 1",
          usage: "owner_occupied",
          estimatedValueCents: 40_000_000,
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
          name: "Annuität Musterbank",
          category: "loan",
          currentBalanceCents: 20_000_000,
          balanceAsOfDate: "2026-11-01",
          monthlyRateCents: 100_000,
          interestRateBps: 350,
        }),
      }),
    );
    const { contract } = (await contractRes.json()) as {
      contract: { id: string };
    };

    // 1. Create 3 pots across all ruleTypes
    const p1Res = await createPot(
      new Request("http://localhost/api/pots", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "Instandhaltung Musterstraße 1",
          ruleType: "fill_to_target",
          currentCents: 80_000,
          targetCents: 100_000,
          linkedPropertyId: property.id,
        }),
      }),
    );
    expect(p1Res.status).toBe(201);
    const { pot: pot1 } = (await p1Res.json()) as {
      pot: { id: string; priority: number };
    };
    expect(pot1.priority).toBe(1);

    const p2Res = await createPot(
      new Request("http://localhost/api/pots", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "Urlaubskasse Muster",
          ruleType: "fixed_monthly",
          fixedMonthlyCents: 30_000,
        }),
      }),
    );
    expect(p2Res.status).toBe(201);
    const { pot: pot2 } = (await p2Res.json()) as {
      pot: { id: string; priority: number };
    };
    expect(pot2.priority).toBe(2);

    const p3Res = await createPot(
      new Request("http://localhost/api/pots", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "Sondertilgung Musterbank",
          ruleType: "percentage_of_remainder",
          remainderPercentage: 60,
          linkedContractId: contract.id,
        }),
      }),
    );
    expect(p3Res.status).toBe(201);
    const { pot: pot3 } = (await p3Res.json()) as {
      pot: { id: string; priority: number };
    };
    expect(pot3.priority).toBe(3);

    // 2. Percentage guard: 60% + 50% rejected with 400; 60% + 40% accepted
    const overPctRes = await createPot(
      new Request("http://localhost/api/pots", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "Überlauf",
          ruleType: "percentage_of_remainder",
          remainderPercentage: 50,
        }),
      }),
    );
    expect(overPctRes.status).toBe(400);

    const validPctRes = await createPot(
      new Request("http://localhost/api/pots", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "Haushalts-Puffer",
          ruleType: "percentage_of_remainder",
          remainderPercentage: 40,
        }),
      }),
    );
    expect(validPctRes.status).toBe(201);
    const { pot: pot4 } = (await validPctRes.json()) as {
      pot: { id: string; priority: number };
    };
    expect(pot4.priority).toBe(4);

    // PATCH exceeding 100% also rejected
    const patchOverPct = await patchPotById(
      new Request(`http://localhost/api/pots/${pot4.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ remainderPercentage: 41 }),
      }),
      { params: Promise.resolve({ id: pot4.id }) },
    );
    expect(patchOverPct.status).toBe(400);

    // 3. Reorder atomically
    const reorderRes = await reorderPots(
      new Request("http://localhost/api/pots/reorder", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          orderedPotIds: [pot2.id, pot1.id, pot4.id, pot3.id],
        }),
      }),
    );
    expect(reorderRes.status).toBe(200);
    const { pots: reordered } = (await reorderRes.json()) as {
      pots: Array<{ id: string; priority: number }>;
    };
    expect(reordered.map((p) => [p.id, p.priority])).toEqual([
      [pot2.id, 1],
      [pot1.id, 2],
      [pot4.id, 3],
      [pot3.id, 4],
    ]);

    // Invalid reorder does not partially mutate
    const badReorder = await reorderPots(
      new Request("http://localhost/api/pots/reorder", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          orderedPotIds: [pot1.id, pot2.id],
        }),
      }),
    );
    expect(badReorder.status).toBe(400);

    // 4. Atomic allocation: only amountCents > 0 creates pot_allocations rows
    const allocRes = await allocatePots(
      new Request("http://localhost/api/pots/allocate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          inputAmountCents: 100_000,
          mode: "monthly",
          sourceLabel: "Monatsüberschuss",
          allocations: [
            { potId: pot1.id, amountCents: 20_000 },
            { potId: pot2.id, amountCents: 0 },
            { potId: pot3.id, amountCents: 50_000 },
          ],
        }),
      }),
    );
    expect(allocRes.status).toBe(201);
    const allocBody = (await allocRes.json()) as {
      allocations: Array<{ potId: string; amountCents: number }>;
      totalAllocatedCents: number;
      unallocatedCents: number;
    };
    expect(allocBody.allocations).toHaveLength(2);
    expect(allocBody.totalAllocatedCents).toBe(70_000);
    expect(allocBody.unallocatedCents).toBe(30_000);

    // Verify GET /api/pots reflects new balances and recentAllocations
    const listAfterAlloc = await listPots();
    const listBody = (await listAfterAlloc.json()) as {
      pots: Array<{ id: string; currentCents: number }>;
      recentAllocations: Array<{ potId: string; amountCents: number }>;
    };
    expect(
      listBody.pots.find((p) => p.id === pot1.id)?.currentCents,
    ).toBe(100_000);
    expect(
      listBody.pots.find((p) => p.id === pot3.id)?.currentCents,
    ).toBe(50_000);
    expect(listBody.recentAllocations).toHaveLength(2);

    // 5. Delete pot3 cascades pot_allocations and renumbers priorities 1..3
    const delRes = await deletePotById(
      new Request(`http://localhost/api/pots/${pot3.id}`, {
        method: "DELETE",
      }),
      { params: Promise.resolve({ id: pot3.id }) },
    );
    expect(delRes.status).toBe(200);

    const listAfterDelete = await listPots();
    const afterDeleteBody = (await listAfterDelete.json()) as {
      pots: Array<{ id: string; priority: number }>;
      recentAllocations: Array<{ potId: string }>;
    };
    expect(afterDeleteBody.pots.map((p) => p.priority)).toEqual([1, 2, 3]);
    expect(
      afterDeleteBody.recentAllocations.some((a) => a.potId === pot3.id),
    ).toBe(false);
  });

  it("rolls back atomic allocation completely when any potId is unknown or validation fails", async () => {
    const p1Res = await createPot(
      new Request("http://localhost/api/pots", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "Notgroschen",
          ruleType: "fill_to_target",
          currentCents: 50_000,
          targetCents: 200_000,
        }),
      }),
    );
    const { pot: pot1 } = (await p1Res.json()) as { pot: { id: string } };

    // Unknown second potId must roll back pot1 as well
    const badAlloc1 = await allocatePots(
      new Request("http://localhost/api/pots/allocate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          inputAmountCents: 50_000,
          mode: "one_time",
          sourceLabel: "Einmalzufluss",
          allocations: [
            { potId: pot1.id, amountCents: 20_000 },
            { potId: "unknown-pot-id", amountCents: 10_000 },
          ],
        }),
      }),
    );
    expect(badAlloc1.status).toBe(400);

    const getPot1 = await getPotById(
      new Request(`http://localhost/api/pots/${pot1.id}`),
      { params: Promise.resolve({ id: pot1.id }) },
    );
    const { pot: unchanged } = (await getPot1.json()) as {
      pot: { currentCents: number };
    };
    expect(unchanged.currentCents).toBe(50_000);

    // Exceeding inputAmountCents -> 400
    const badAlloc2 = await allocatePots(
      new Request("http://localhost/api/pots/allocate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          inputAmountCents: 10_000,
          mode: "monthly",
          sourceLabel: "Monatsüberschuss",
          allocations: [{ potId: pot1.id, amountCents: 10_001 }],
        }),
      }),
    );
    expect(badAlloc2.status).toBe(400);

    // Zero sum -> 400
    const badAlloc3 = await allocatePots(
      new Request("http://localhost/api/pots/allocate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          inputAmountCents: 10_000,
          mode: "monthly",
          sourceLabel: "Monatsüberschuss",
          allocations: [{ potId: pot1.id, amountCents: 0 }],
        }),
      }),
    );
    expect(badAlloc3.status).toBe(400);
  });

  it("handles 404 on unknown pot id, 400 on invalid links, and rule-switching via PATCH", async () => {
    // 404 on GET / PATCH / DELETE for unknown pot
    const notFoundGet = await getPotById(
      new Request("http://localhost/api/pots/does-not-exist"),
      { params: Promise.resolve({ id: "does-not-exist" }) },
    );
    expect(notFoundGet.status).toBe(404);

    const notFoundPatch = await patchPotById(
      new Request("http://localhost/api/pots/does-not-exist", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "Neu" }),
      }),
      { params: Promise.resolve({ id: "does-not-exist" }) },
    );
    expect(notFoundPatch.status).toBe(404);

    const notFoundDelete = await deletePotById(
      new Request("http://localhost/api/pots/does-not-exist", {
        method: "DELETE",
      }),
      { params: Promise.resolve({ id: "does-not-exist" }) },
    );
    expect(notFoundDelete.status).toBe(404);

    // 400 on invalid linkedPropertyId / linkedContractId
    const badPropLink = await createPot(
      new Request("http://localhost/api/pots", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "Ungültige Immobilie",
          ruleType: "fill_to_target",
          targetCents: 100_000,
          linkedPropertyId: "unknown-property",
        }),
      }),
    );
    expect(badPropLink.status).toBe(400);

    const badContractLink = await createPot(
      new Request("http://localhost/api/pots", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "Ungültiger Vertrag",
          ruleType: "fill_to_target",
          targetCents: 100_000,
          linkedContractId: "unknown-contract",
        }),
      }),
    );
    expect(badContractLink.status).toBe(400);

    // Rule switching via PATCH: percentage_of_remainder (80%) -> fill_to_target frees 80% quota
    const pctPotRes = await createPot(
      new Request("http://localhost/api/pots", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "Resttopf A",
          ruleType: "percentage_of_remainder",
          remainderPercentage: 80,
        }),
      }),
    );
    expect(pctPotRes.status).toBe(201);
    const { pot: pctPot } = (await pctPotRes.json()) as {
      pot: { id: string };
    };

    // Switching to fixed_monthly without fixedMonthlyCents -> 400
    const invalidSwitch = await patchPotById(
      new Request(`http://localhost/api/pots/${pctPot.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ruleType: "fixed_monthly" }),
      }),
      { params: Promise.resolve({ id: pctPot.id }) },
    );
    expect(invalidSwitch.status).toBe(400);

    // Switching to fill_to_target with targetCents -> 200 and clears remainderPercentage
    const validSwitch = await patchPotById(
      new Request(`http://localhost/api/pots/${pctPot.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ruleType: "fill_to_target",
          targetCents: 500_000,
        }),
      }),
      { params: Promise.resolve({ id: pctPot.id }) },
    );
    expect(validSwitch.status).toBe(200);
    const { pot: switched } = (await validSwitch.json()) as {
      pot: { ruleType: string; remainderPercentage: number | null };
    };
    expect(switched.ruleType).toBe("fill_to_target");
    expect(switched.remainderPercentage).toBeNull();

    // Now another pot can claim 100% remainderPercentage
    const fullPctPot = await createPot(
      new Request("http://localhost/api/pots", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "Resttopf B",
          ruleType: "percentage_of_remainder",
          remainderPercentage: 100,
        }),
      }),
    );
    expect(fullPctPot.status).toBe(201);
  });
});
