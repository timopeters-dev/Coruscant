import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as dbModule from "@/db";
import {
  applyPotSyncFromSnapshot,
  getPendingTransferCentsByPotId,
  getPotById as getPotRow,
  listPots as listPotRows,
} from "@/db/queries/allocation";
import { getLatestExternalSnapshot, insertExternalSnapshot } from "@/db/queries/cockpit";
import { potAllocations, pots } from "@/db/schema";
import { eq } from "drizzle-orm";
import { finanzCockpitSummarySchema } from "@/lib/validation/external";
import { applyPendingTransfers } from "@/lib/domain/pot-sync";
import { calculateWaterfallSuggestion } from "@/lib/domain/waterfall";
import { PATCH as patchPotById } from "./[id]/route";
import { POST as allocatePots } from "./allocate/route";
import { POST as createPot } from "./route";

const tempDirs: string[] = [];
const originalDbUrl = process.env.DATABASE_URL;

beforeEach(() => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "coruscant-potlink-"));
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

const tick = () => new Promise((resolve) => setTimeout(resolve, 5));

function seedSnapshot(
  fetchedAt = "2026-11-17T08:00:00.000Z",
  balanceAsOf?: string,
) {
  return insertExternalSnapshot(
    finanzCockpitSummarySchema.parse({
    source: "finanz_cockpit",
    liquidCashCents: 0,
    etfStocksCents: 0,
    cryptoCents: 0,
    totalPersonalNetWorthCents: 0,
    fetchedAt,
    accounts: [
      { id: "acc-giro", name: "Musterbank Tagesgeld", type: "savings", scope: "household", balanceCents: 250_000, holdingsValueCents: 0, ...(balanceAsOf ? { balanceAsOf } : {}) },
      { id: "acc-depot", name: "Muster-Depot", type: "brokerage", scope: "personal", balanceCents: 10_000, holdingsValueCents: 500_000 },
    ],
    positions: [
      { id: "pos-1", accountId: "acc-depot", symbol: "MSTR", isin: "XX0000000001", name: "Muster-ETF", assetClass: "etf", marketValueCents: 400_000, costBasisCents: null, lastPriceAt: null },
    ],
  }));
}

function jsonRequest(url: string, method: string, body: unknown): Request {
  return new Request(url, {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function create(body: Record<string, unknown>) {
  const res = await createPot(jsonRequest("http://localhost/api/pots", "POST", body));
  return {
    status: res.status,
    json: (await res.json()) as {
      pot?: {
        id: string;
        currentCents: number;
        externalLinkKind: string | null;
        externalLinkRef: string | null;
        externalLinkScope: string | null;
        externalSyncedAt: string | null;
      };
      fieldErrors?: Record<string, string>;
    },
  };
}

async function patch(id: string, body: Record<string, unknown>) {
  const res = await patchPotById(
    jsonRequest(`http://localhost/api/pots/${id}`, "PATCH", body),
    { params: Promise.resolve({ id }) },
  );
  return { status: res.status };
}

const baseBody = { ruleType: "fill_to_target", targetCents: 1_000_000 };

describe("pots linked to finanz_cockpit accounts/positions", () => {
  it("takes currentCents, scope and syncedAt from the latest snapshot on create", async () => {
    const snapshot = seedSnapshot();
    const account = await create({ ...baseBody, name: "Tagesgeld-Topf", currentCents: 999, externalLink: { kind: "account", ref: "acc-giro" } });
    expect(account.status).toBe(201);
    expect(account.json.pot).toMatchObject({
      currentCents: 250_000,
      externalLinkKind: "account",
      externalLinkRef: "acc-giro",
      externalLinkScope: "household",
      externalSyncedAt: snapshot.fetchedAt,
    });

    const position = await create({ ...baseBody, name: "ETF-Topf", externalLink: { kind: "position", ref: "pos-1" } });
    expect(position.json.pot).toMatchObject({ currentCents: 400_000, externalLinkScope: "personal" });

  });

  it("includes cash and holdings for a depot account link", async () => {
    seedSnapshot();
    const depot = await create({ ...baseBody, name: "Depot-Topf", externalLink: { kind: "account", ref: "acc-depot" } });
    expect(depot.json.pot?.currentCents).toBe(510_000);
  });

  it("rejects linking to a target that is not in the snapshot (or without snapshot) with 400", async () => {
    const withoutSnapshot = await create({ ...baseBody, name: "Ohne Snapshot", externalLink: { kind: "account", ref: "acc-giro" } });
    expect(withoutSnapshot.status).toBe(400);
    expect(withoutSnapshot.json.fieldErrors?.externalLink).toBeDefined();

    seedSnapshot();
    const unknown = await create({ ...baseBody, name: "Fehlt", currentCents: 1_234, externalLink: { kind: "account", ref: "unbekannt" } });
    expect(unknown.status).toBe(400);
    expect(listPotRows()).toHaveLength(0);
  });

  it("re-linking to an unknown target is rejected and keeps scope, stand and link of the pot", async () => {
    seedSnapshot();
    const { json } = await create({ ...baseBody, name: "Personal", externalLink: { kind: "account", ref: "acc-depot" } });
    const id = json.pot!.id;

    const res = await patch(id, { externalLink: { kind: "account", ref: "unbekannt" } });
    expect(res.status).toBe(400);
    expect(getPotRow(id)).toMatchObject({
      currentCents: 510_000,
      externalLinkRef: "acc-depot",
      externalLinkScope: "personal",
    });
  });

  it("rejects an account link together with a position of that account (both orders) with 409", async () => {
    seedSnapshot();
    const account = await create({ ...baseBody, name: "Depot", externalLink: { kind: "account", ref: "acc-depot" } });
    expect(account.status).toBe(201);
    const position = await create({ ...baseBody, name: "ETF", externalLink: { kind: "position", ref: "pos-1" } });
    expect(position.status).toBe(409);
    expect(position.json.fieldErrors?.externalLink).toBeDefined();
    expect(listPotRows()).toHaveLength(1);

    // other direction + via PATCH
    const posFirst = await create({ ...baseBody, name: "ETF2", externalLink: { kind: "position", ref: "pos-1" } });
    expect(posFirst.status).toBe(409); // account still taken
    const accountPot = account.json.pot!.id;
    expect((await patch(accountPot, { externalLink: null })).status).toBe(200);
    const pos = await create({ ...baseBody, name: "ETF3", externalLink: { kind: "position", ref: "pos-1" } });
    expect(pos.status).toBe(201);
    const relink = await patch(accountPot, { externalLink: { kind: "account", ref: "acc-depot" } });
    expect(relink.status).toBe(409);
    expect(getPotRow(accountPot)?.externalLinkKind).toBeNull();
  });

  it("rejects a second pot with the same link with 409 and an externalLink field error", async () => {
    seedSnapshot();
    const first = await create({ ...baseBody, name: "A", externalLink: { kind: "account", ref: "acc-giro" } });
    expect(first.status).toBe(201);
    const second = await create({ ...baseBody, name: "B", externalLink: { kind: "account", ref: "acc-giro" } });
    expect(second.status).toBe(409);
    expect(second.json.fieldErrors?.externalLink).toBeDefined();
    expect(listPotRows()).toHaveLength(1);
  });

  it("allows multiple virtual pots (NULL links do not collide)", async () => {
    expect((await create({ ...baseBody, name: "V1" })).status).toBe(201);
    expect((await create({ ...baseBody, name: "V2" })).status).toBe(201);
  });

  it("rejects invalid externalLink payloads with 400", async () => {
    expect((await create({ ...baseBody, name: "X", externalLink: { kind: "account", ref: "" } })).status).toBe(400);
    expect((await create({ ...baseBody, name: "X", externalLink: { kind: "savings_pot", ref: "a" } })).status).toBe(400);
  });

  it("rejects PATCH currentCents on a linked pot with 400, unless unlinking in the same patch", async () => {
    seedSnapshot();
    const { json } = await create({ ...baseBody, name: "Linked", externalLink: { kind: "account", ref: "acc-giro" } });
    const id = json.pot!.id;

    const rejected = await patch(id, { currentCents: 5 });
    expect(rejected.status).toBe(400);
    expect(getPotRow(id)?.currentCents).toBe(250_000);

    const withLinkSame = await patch(id, { currentCents: 5, externalLink: { kind: "account", ref: "acc-giro" } });
    expect(withLinkSame.status).toBe(400);

    const unlink = await patch(id, { currentCents: 7_000, externalLink: null });
    expect(unlink.status).toBe(200);
    expect(getPotRow(id)).toMatchObject({
      currentCents: 7_000,
      externalLinkKind: null,
      externalLinkRef: null,
      externalLinkScope: null,
      externalSyncedAt: null,
    });
  });

  it("unlinks while keeping the last stand and allows editing other fields of a linked pot", async () => {
    seedSnapshot();
    const { json } = await create({ ...baseBody, name: "Linked", externalLink: { kind: "account", ref: "acc-giro" } });
    const id = json.pot!.id;

    const rename = await patch(id, { name: "Umbenannt" });
    expect(rename.status).toBe(200);
    expect(getPotRow(id)).toMatchObject({ name: "Umbenannt", externalLinkRef: "acc-giro", currentCents: 250_000 });

    const unlink = await patch(id, { externalLink: null });
    expect(unlink.status).toBe(200);
    expect(getPotRow(id)).toMatchObject({ currentCents: 250_000, externalLinkKind: null, externalLinkRef: null });
  });

  it("links an existing virtual pot (without currentCents) and takes over the snapshot value", async () => {
    seedSnapshot();
    const { json } = await create({ ...baseBody, name: "Virtuell", currentCents: 42 });
    const res = await patch(json.pot!.id, { externalLink: { kind: "position", ref: "pos-1" } });
    expect(res.status).toBe(200);
    expect(getPotRow(json.pot!.id)).toMatchObject({ currentCents: 400_000, externalLinkScope: "personal" });
  });

  it("returns 409 when re-linking to a target that another pot holds", async () => {
    seedSnapshot();
    await create({ ...baseBody, name: "A", externalLink: { kind: "account", ref: "acc-giro" } });
    const b = await create({ ...baseBody, name: "B" });
    const res = await patch(b.json.pot!.id, { externalLink: { kind: "account", ref: "acc-giro" } });
    expect(res.status).toBe(409);
    expect(getPotRow(b.json.pot!.id)?.externalLinkKind).toBeNull();
  });

  it("does not suggest an open transfer twice before the next sync (pending transfers)", async () => {
    seedSnapshot("2026-11-17T08:00:00.000Z");
    const linked = await create({ ...baseBody, targetCents: 300_000, name: "Linked", externalLink: { kind: "account", ref: "acc-giro" } });
    const virtual = await create({ ...baseBody, name: "Virtual" });
    const id = linked.json.pot!.id;
    expect(getPendingTransferCentsByPotId().size).toBe(0);

    const allocate = (amountCents: number) =>
      allocatePots(
        jsonRequest("http://localhost/api/pots/allocate", "POST", {
          inputAmountCents: amountCents,
          mode: "one_time",
          sourceLabel: "Einmalzufluss",
          allocations: [{ potId: id, amountCents }],
        }),
      );
    expect((await allocate(30_000)).status).toBe(201);
    expect((await allocate(10_000)).status).toBe(201);
    expect(getPendingTransferCentsByPotId().get(id)).toBe(40_000);
    expect(getPendingTransferCentsByPotId().has(virtual.json.pot!.id)).toBe(false);

    // Headroom for the next suggestion respects the open transfers (stand 250_000 + 40_000, target 300_000).
    const pots = applyPendingTransfers(listPotRows(), getPendingTransferCentsByPotId());
    const plan = calculateWaterfallSuggestion(pots, 100_000, { mode: "one_time" });
    expect(plan.suggestions.find((s) => s.potId === id)?.allocatedCents).toBe(10_000);

    // A later sync (newer fetchedAt) clears the pending amount.
    seedSnapshot("2999-01-01T00:00:00.000Z");
    const latest = getLatestExternalSnapshot()!;
    applyPotSyncFromSnapshot(latest);
    expect(getPendingTransferCentsByPotId().size).toBe(0);
  });

  it("allocate: journals linked pots but only raises currentCents of virtual pots", async () => {
    seedSnapshot();
    const linked = await create({ ...baseBody, name: "Linked", externalLink: { kind: "account", ref: "acc-giro" } });
    const virtual = await create({ ...baseBody, name: "Virtual", currentCents: 10_000 });

    const res = await allocatePots(
      jsonRequest("http://localhost/api/pots/allocate", "POST", {
        inputAmountCents: 100_000,
        mode: "one_time",
        sourceLabel: "Einmalzufluss",
        allocations: [
          { potId: linked.json.pot!.id, amountCents: 60_000 },
          { potId: virtual.json.pot!.id, amountCents: 40_000 },
        ],
      }),
    );
    expect(res.status).toBe(201);
    const body = (await res.json()) as {
      allocations: unknown[];
      transferPlanPotIds: string[];
    };
    expect(body.allocations).toHaveLength(2);
    expect(body.transferPlanPotIds).toEqual([linked.json.pot!.id]);
    expect(getPotRow(linked.json.pot!.id)?.currentCents).toBe(250_000);
    expect(getPotRow(virtual.json.pot!.id)?.currentCents).toBe(50_000);
  });

  it("keeps open transfers across a sync whose bank data (balanceAsOf) did not change", async () => {
    // Bank data is from 06:00; two syncs later it is still the same.
    seedSnapshot("2026-11-17T07:00:00.000Z", "2026-11-17T06:00:00.000Z");
    const linked = await create({ ...baseBody, name: "Linked", externalLink: { kind: "account", ref: "acc-giro" } });
    const id = linked.json.pot!.id;
    expect(getPotRow(id)?.externalSyncedAt).toBe("2026-11-17T06:00:00.000Z");

    await tick();
    await allocatePots(
      jsonRequest("http://localhost/api/pots/allocate", "POST", {
        inputAmountCents: 50_000,
        mode: "one_time",
        sourceLabel: "Einmalzufluss",
        allocations: [{ potId: id, amountCents: 50_000 }],
      }),
    );
    expect(getPendingTransferCentsByPotId().get(id)).toBe(50_000);

    // A later sync (fetchedAt = far in the future) with identical balanceAsOf.
    const stale = seedSnapshot("2999-01-01T00:00:00.000Z", "2026-11-17T06:00:00.000Z");
    applyPotSyncFromSnapshot(stale);
    expect(getPotRow(id)?.externalSyncedAt).toBe("2026-11-17T06:00:00.000Z");
    expect(getPendingTransferCentsByPotId().get(id)).toBe(50_000);

    // Fresh bank data (newer than the transfer) clears the pending amount.
    const fresh = seedSnapshot("2999-01-02T00:00:00.000Z", "2999-01-02T00:00:00.000Z");
    applyPotSyncFromSnapshot(fresh);
    expect(getPendingTransferCentsByPotId().has(id)).toBe(false);
  });

  it("does not count journal entries from before the (re-)link as pending transfers", async () => {
    seedSnapshot("2026-11-17T07:00:00.000Z", "2026-11-17T06:00:00.000Z");
    const virtual = await create({ ...baseBody, name: "Virtuell" });
    const id = virtual.json.pot!.id;

    // Plain booking on the virtual pot, before it gets linked.
    await tick();
    await allocatePots(
      jsonRequest("http://localhost/api/pots/allocate", "POST", {
        inputAmountCents: 10_000,
        mode: "one_time",
        sourceLabel: "Einmalzufluss",
        allocations: [{ potId: id, amountCents: 10_000 }],
      }),
    );
    await tick();
    expect((await patch(id, { externalLink: { kind: "account", ref: "acc-giro" } })).status).toBe(200);
    const linkedAt = getPotRow(id)?.externalLinkedAt;
    expect(linkedAt).toBeTruthy();
    expect(getPendingTransferCentsByPotId().has(id)).toBe(false);

    // A transfer after linking counts; unlinking resets linkedAt.
    await tick();
    await allocatePots(
      jsonRequest("http://localhost/api/pots/allocate", "POST", {
        inputAmountCents: 20_000,
        mode: "one_time",
        sourceLabel: "Einmalzufluss",
        allocations: [{ potId: id, amountCents: 20_000 }],
      }),
    );
    expect(getPendingTransferCentsByPotId().get(id)).toBe(20_000);
    await patch(id, { externalLink: null });
    expect(getPotRow(id)?.externalLinkedAt).toBeNull();
  });

  it("treats a transfer 0.5s after a second-precision balanceAsOf as pending (timestamp normalization)", async () => {
    seedSnapshot("2026-11-17T07:00:00.000Z", "2026-11-17T06:00:00Z");
    const linked = await create({ ...baseBody, name: "Linked", externalLink: { kind: "account", ref: "acc-giro" } });
    const id = linked.json.pot!.id;
    expect(getPotRow(id)?.externalSyncedAt).toBe("2026-11-17T06:00:00.000Z");

    // Link happened long before; journal entry shortly after the bank data timestamp.
    dbModule.getDb().update(pots).set({ externalLinkedAt: "2026-11-17T05:00:00.000Z" }).where(eq(pots.id, id)).run();
    dbModule.getDb().insert(potAllocations).values({
      id: "alloc-1",
      potId: id,
      amountCents: 70_000,
      sourceLabel: "Einmalzufluss",
      allocatedAt: "2026-11-17T06:00:00.500Z",
    }).run();

    expect(getPendingTransferCentsByPotId().get(id)).toBe(70_000);
  });
});
