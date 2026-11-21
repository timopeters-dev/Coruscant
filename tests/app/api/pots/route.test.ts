import { describe, expect, it } from "vitest";
import * as dbModule from "@/backend/db/connection";
import { withTempDatabase } from "@tests/helpers/temp-db";
import { apiRequest } from "@tests/helpers/http";
import { pots as potsTable } from "@/backend/db/schema";
import { eq } from "drizzle-orm";
import { addMonthsToIsoDate, getTodayIsoDate } from "@/domain/core/date";
import { POST as createContract } from "@/app/api/contracts/route";
import { POST as createProperty } from "@/app/api/properties/route";
import {
  DELETE as deletePotById,
  GET as getPotById,
  PATCH as patchPotById,
} from "@/app/api/pots/[id]/route";
import { POST as allocatePots } from "@/app/api/pots/allocate/route";
import { POST as reorderPots } from "@/app/api/pots/reorder/route";
import { GET as listPots, POST as createPot } from "@/app/api/pots/route";

withTempDatabase();

describe("/api/pots purpose", () => {
  it("speichert purpose im Roundtrip, lässt es bei PATCH ohne purpose unverändert und migriert Bestand auf null", async () => {
    const created = await createPot(
      new Request("http://localhost/api/pots", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "Muster-Notgroschen",
          ruleType: "fill_to_target",
          targetCents: 300_000,
          purpose: "emergency_fund",
        }),
      }),
    );
    expect(created.status).toBe(201);
    const { pot } = (await created.json()) as {
      pot: { id: string; purpose: string | null };
    };
    expect(pot.purpose).toBe("emergency_fund");

    const withoutPurpose = await createPot(
      new Request("http://localhost/api/pots", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "Muster-Topf",
          ruleType: "fixed_monthly",
          fixedMonthlyCents: 10_000,
        }),
      }),
    );
    const { pot: plain } = (await withoutPurpose.json()) as {
      pot: { purpose: string | null };
    };
    expect(plain.purpose).toBeNull();

    const renamed = await patchPotById(
      new Request(`http://localhost/api/pots/${pot.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "Muster-Notgroschen 2" }),
      }),
      { params: Promise.resolve({ id: pot.id }) },
    );
    const { pot: afterRename } = (await renamed.json()) as {
      pot: { purpose: string | null };
    };
    expect(afterRename.purpose).toBe("emergency_fund");

    const changed = await patchPotById(
      new Request(`http://localhost/api/pots/${pot.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ purpose: "goal" }),
      }),
      { params: Promise.resolve({ id: pot.id }) },
    );
    const { pot: afterChange } = (await changed.json()) as {
      pot: { purpose: string | null };
    };
    expect(afterChange.purpose).toBe("goal");

    const cleared = await patchPotById(
      new Request(`http://localhost/api/pots/${pot.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ purpose: null }),
      }),
      { params: Promise.resolve({ id: pot.id }) },
    );
    const { pot: afterClear } = (await cleared.json()) as {
      pot: { purpose: string | null };
    };
    expect(afterClear.purpose).toBeNull();

    const invalid = await createPot(
      new Request("http://localhost/api/pots", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "Ungültig",
          ruleType: "fixed_monthly",
          fixedMonthlyCents: 100,
          purpose: "notgroschen",
        }),
      }),
    );
    expect(invalid.status).toBe(400);
  });
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
    const listAfterAlloc = await listPots(apiRequest("/api/pots"));
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

    const listAfterDelete = await listPots(apiRequest("/api/pots"));
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

  it("validates and persists targetDate on POST and PATCH", async () => {
    const today = getTodayIsoDate();
    const future = addMonthsToIsoDate(today, 12);
    const tooFar = addMonthsToIsoDate(today, 481);

    // POST valid targetDate
    const createdRes = await createPot(
      new Request("http://localhost/api/pots", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "Topf Musterziel",
          ruleType: "fill_to_target",
          targetCents: 500_000,
          targetDate: future,
        }),
      }),
    );
    expect(createdRes.status).toBe(201);
    const { pot: created } = (await createdRes.json()) as {
      pot: { id: string; targetDate: string | null };
    };
    expect(created.targetDate).toBe(future);

    // POST past date -> 400 fieldErrors.targetDate
    const pastRes = await createPot(
      new Request("http://localhost/api/pots", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "Topf Vergangenheit",
          ruleType: "fill_to_target",
          targetCents: 100_000,
          targetDate: "2020-01-01",
        }),
      }),
    );
    expect(pastRes.status).toBe(400);
    const pastJson = (await pastRes.json()) as {
      fieldErrors?: Record<string, string>;
    };
    expect(pastJson.fieldErrors?.targetDate).toBeTruthy();

    // POST without targetCents -> 400
    const noTargetRes = await createPot(
      new Request("http://localhost/api/pots", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "Topf Ohne Ziel",
          ruleType: "fixed_monthly",
          fixedMonthlyCents: 10_000,
          targetDate: future,
        }),
      }),
    );
    expect(noTargetRes.status).toBe(400);

    // POST invalid date -> 400
    const badDateRes = await createPot(
      new Request("http://localhost/api/pots", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "Topf Ungültiges Datum",
          ruleType: "fill_to_target",
          targetCents: 100_000,
          targetDate: "2027-02-29",
        }),
      }),
    );
    expect(badDateRes.status).toBe(400);

    // POST > 40 years -> 400
    const tooFarRes = await createPot(
      new Request("http://localhost/api/pots", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "Topf Zu Weit",
          ruleType: "fill_to_target",
          targetCents: 100_000,
          targetDate: tooFar,
        }),
      }),
    );
    expect(tooFarRes.status).toBe(400);

    // PATCH past date in body -> 400
    const patchPastRes = await patchPotById(
      new Request(`http://localhost/api/pots/${created.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ targetDate: "2020-01-01" }),
      }),
      { params: Promise.resolve({ id: created.id }) },
    );
    expect(patchPastRes.status).toBe(400);

    // PATCH clearing targetDate -> 200
    const clearDateRes = await patchPotById(
      new Request(`http://localhost/api/pots/${created.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ targetDate: null }),
      }),
      { params: Promise.resolve({ id: created.id }) },
    );
    expect(clearDateRes.status).toBe(200);
    const { pot: cleared } = (await clearDateRes.json()) as {
      pot: { targetDate: string | null };
    };
    expect(cleared.targetDate).toBeNull();

    // PATCH setting targetDate again -> 200
    const setDateRes = await patchPotById(
      new Request(`http://localhost/api/pots/${created.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ targetDate: future }),
      }),
      { params: Promise.resolve({ id: created.id }) },
    );
    expect(setDateRes.status).toBe(200);

    // PATCH targetCents: null while targetDate exists -> 400 fieldErrors.targetDate
    const dropTargetRes = await patchPotById(
      new Request(`http://localhost/api/pots/${created.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ruleType: "fixed_monthly",
          fixedMonthlyCents: 10_000,
          targetCents: null,
        }),
      }),
      { params: Promise.resolve({ id: created.id }) },
    );
    expect(dropTargetRes.status).toBe(400);
    const dropTargetJson = (await dropTargetRes.json()) as {
      fieldErrors?: Record<string, string>;
    };
    expect(dropTargetJson.fieldErrors?.targetDate).toBeTruthy();

    // Existing past targetDate in DB does not block PATCHing name
    dbModule
      .getDb()
      .update(potsTable)
      .set({ targetDate: "2020-05-01" })
      .where(eq(potsTable.id, created.id))
      .run();
    const renameRes = await patchPotById(
      new Request(`http://localhost/api/pots/${created.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "Topf Umbenannt" }),
      }),
      { params: Promise.resolve({ id: created.id }) },
    );
    expect(renameRes.status).toBe(200);
    const { pot: renamed } = (await renameRes.json()) as {
      pot: { name: string; targetDate: string | null };
    };
    expect(renamed.name).toBe("Topf Umbenannt");
    expect(renamed.targetDate).toBe("2020-05-01");

    // Full-payload PATCH with unchanged expired targetDate -> 200 (UI edit flow)
    const fullPayloadExpiredRes = await patchPotById(
      new Request(`http://localhost/api/pots/${created.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "Topf Umbenannt 2",
          targetCents: 500_000,
          targetDate: "2020-05-01",
        }),
      }),
      { params: Promise.resolve({ id: created.id }) },
    );
    expect(fullPayloadExpiredRes.status).toBe(200);
    const { pot: fullPayloadExpired } = (await fullPayloadExpiredRes.json()) as {
      pot: { name: string; targetDate: string | null };
    };
    expect(fullPayloadExpired.name).toBe("Topf Umbenannt 2");
    expect(fullPayloadExpired.targetDate).toBe("2020-05-01");

    // Changing an expired targetDate to another past date -> 400
    const changeToOtherPastRes = await patchPotById(
      new Request(`http://localhost/api/pots/${created.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ targetDate: "2020-06-01" }),
      }),
      { params: Promise.resolve({ id: created.id }) },
    );
    expect(changeToOtherPastRes.status).toBe(400);
    const changeToOtherPastJson = (await changeToOtherPastRes.json()) as {
      fieldErrors?: Record<string, string>;
    };
    expect(changeToOtherPastJson.fieldErrors?.targetDate).toBeTruthy();

    // PATCH unknown ID -> 404
    const notFoundRes = await patchPotById(
      new Request("http://localhost/api/pots/non-existent-id", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "Egal" }),
      }),
      { params: Promise.resolve({ id: "non-existent-id" }) },
    );
    expect(notFoundRes.status).toBe(404);
  });
});
