import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as dbModule from "@/backend/db/connection";
import { createPot, getPotById, listPots } from "@/backend/db/queries/allocation";
import { listBalanceSnapshots } from "@/backend/db/queries/balance-history";
import { eq, sql } from "drizzle-orm";
import { pots } from "@/backend/db/schema";
import { potCreateSchema } from "@/validation/allocation";
import {
  getLatestExternalSnapshot,
  insertExternalSnapshot,
  parseSnapshotAccounts,
  parseSnapshotHousehold,
  parseSnapshotPositions,
} from "@/backend/db/queries/cockpit";
import * as allocationQueries from "@/backend/db/queries/allocation";
import { getTodayIsoDate } from "@/domain/core/date";
import * as bridgeClient from "@/backend/integrations/finanz-cockpit-client";
import * as balanceSnapshotJob from "@/backend/jobs/balance-snapshot-job";
import { POST as syncExternal } from "@/app/api/external/sync/route";

const tempDirs: string[] = [];
const originalDbUrl = process.env.DATABASE_URL;
const originalSyncInterval = process.env.FINANZ_COCKPIT_SYNC_INTERVAL_MINUTES;

function createSyncRequest(body: unknown): Request {
  return new Request("http://localhost/api/external/sync", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

beforeEach(() => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "coruscant-sync-"));
  tempDirs.push(dir);
  process.env.DATABASE_URL = path.join(dir, "test.db");
  delete process.env.FINANZ_COCKPIT_SYNC_INTERVAL_MINUTES;
});

afterEach(() => {
  vi.restoreAllMocks();
  dbModule.closeDb();
  if (originalDbUrl === undefined) {
    delete process.env.DATABASE_URL;
  } else {
    process.env.DATABASE_URL = originalDbUrl;
  }
  if (originalSyncInterval === undefined) {
    delete process.env.FINANZ_COCKPIT_SYNC_INTERVAL_MINUTES;
  } else {
    process.env.FINANZ_COCKPIT_SYNC_INTERVAL_MINUTES = originalSyncInterval;
  }
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir && fs.existsSync(dir)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }
});

describe("POST /api/external/sync", () => {
  it("persists a new snapshot in external_snapshots on successful sync", async () => {
    vi.spyOn(bridgeClient, "fetchFinanzCockpitSummary").mockResolvedValue({
      ok: true,
      data: {
        source: "finanz_cockpit",
        liquidCashCents: 300_000,
        etfStocksCents: 1_200_000,
        cryptoCents: 50_000,
        totalPersonalNetWorthCents: 1_550_000,
        fetchedAt: "2026-11-16T14:00:00.000Z",
      },
    });

    const response = await syncExternal();
    expect(response.status).toBe(200);

    const body = await response.json();
    expect(body.status).toBe("synced");
    expect(body.snapshot).toMatchObject({
      source: "finanz_cockpit",
      liquidCashCents: 300_000,
      etfStocksCents: 1_200_000,
      cryptoCents: 50_000,
      totalPersonalNetWorthCents: 1_550_000,
      fetchedAt: "2026-11-16T14:00:00.000Z",
    });

    const latest = getLatestExternalSnapshot();
    expect(latest?.id).toBe(body.snapshot.id);
  });

  it("returns offline_fallback with existing snapshot when finanz_cockpit is unreachable", async () => {
    const existing = insertExternalSnapshot({
      source: "finanz_cockpit",
      liquidCashCents: 100_000,
      etfStocksCents: 900_000,
      cryptoCents: 0,
      totalPersonalNetWorthCents: 1_000_000,
      fetchedAt: "2026-11-15T18:00:00.000Z",
    });

    vi.spyOn(bridgeClient, "fetchFinanzCockpitSummary").mockResolvedValue({
      ok: false,
      code: "network_error",
      message: "finanz_cockpit ist aktuell nicht erreichbar.",
    });

    const response = await syncExternal();
    expect(response.status).toBe(502);

    const body = await response.json();
    expect(body.status).toBe("offline_fallback");
    expect(body.errorCode).toBe("network_error");
    expect(body.snapshot?.id).toBe(existing.id);

    const latestAfter = getLatestExternalSnapshot();
    expect(latestAfter?.id).toBe(existing.id);
  });

  it("returns snapshot: null when unconfigured or offline on first start", async () => {
    vi.spyOn(bridgeClient, "fetchFinanzCockpitSummary").mockResolvedValue({
      ok: false,
      code: "not_configured",
      message:
        "FINANZ_COCKPIT_URL oder EXTERNAL_SUMMARY_TOKEN ist nicht konfiguriert.",
    });

    const response = await syncExternal();
    expect(response.status).toBe(503);

    const body = await response.json();
    expect(body.status).toBe("unconfigured");
    expect(body.errorCode).toBe("not_configured");
    expect(body.snapshot).toBeNull();
  });

  it("returns 503 with status unconfigured and preserves fallback snapshot on invalid_config", async () => {
    const existing = insertExternalSnapshot({
      source: "finanz_cockpit",
      liquidCashCents: 100_000,
      etfStocksCents: 0,
      cryptoCents: 0,
      totalPersonalNetWorthCents: 100_000,
      fetchedAt: "2026-11-15T18:00:00.000Z",
    });

    vi.spyOn(bridgeClient, "fetchFinanzCockpitSummary").mockResolvedValue({
      ok: false,
      code: "invalid_config",
      message: "FINANZ_COCKPIT_URL ist keine gültige HTTP(S)-URL.",
    });

    const response = await syncExternal();
    expect(response.status).toBe(503);

    const body = await response.json();
    expect(body.status).toBe("unconfigured");
    expect(body.errorCode).toBe("invalid_config");
    expect(body.message).toBe(
      "FINANZ_COCKPIT_URL ist keine gültige HTTP(S)-URL.",
    );
    expect(body.snapshot?.id).toBe(existing.id);
  });

  it("returns structured 500 JSON error if DB persistence throws unexpectedly", async () => {
    vi.spyOn(bridgeClient, "fetchFinanzCockpitSummary").mockResolvedValue({
      ok: true,
      data: {
        source: "finanz_cockpit",
        liquidCashCents: 100_000,
        etfStocksCents: 0,
        cryptoCents: 0,
        totalPersonalNetWorthCents: 100_000,
        fetchedAt: "2026-11-16T14:00:00.000Z",
      },
    });
    vi.spyOn(allocationQueries, "storeSnapshotAndSyncPots").mockImplementation(() => {
      throw new Error("SQLITE_BUSY");
    });

    const response = await syncExternal();
    expect(response.status).toBe(500);
    const body = await response.json();
    expect(body).toHaveProperty("error");
  });

  it("skips upstream fetch in auto mode when latest snapshot is still fresh", async () => {
    const freshTimestamp = new Date(Date.now() - 2 * 60_000).toISOString();
    const existing = insertExternalSnapshot({
      source: "finanz_cockpit",
      liquidCashCents: 200_000,
      etfStocksCents: 800_000,
      cryptoCents: 0,
      totalPersonalNetWorthCents: 1_000_000,
      fetchedAt: freshTimestamp,
    });

    const fetchSpy = vi.spyOn(bridgeClient, "fetchFinanzCockpitSummary");
    const response = await syncExternal(createSyncRequest({ mode: "auto" }));

    expect(response.status).toBe(200);
    expect(fetchSpy).not.toHaveBeenCalled();

    const body = await response.json();
    expect(body).toMatchObject({
      status: "skipped",
      reason: "fresh",
    });
    expect(body.snapshot?.id).toBe(existing.id);
  });

  it("syncs in auto mode when snapshot is stale or missing", async () => {
    const staleTimestamp = new Date(Date.now() - 30 * 60_000).toISOString();
    insertExternalSnapshot({
      source: "finanz_cockpit",
      liquidCashCents: 100_000,
      etfStocksCents: 500_000,
      cryptoCents: 0,
      totalPersonalNetWorthCents: 600_000,
      fetchedAt: staleTimestamp,
    });

    const fetchSpy = vi
      .spyOn(bridgeClient, "fetchFinanzCockpitSummary")
      .mockResolvedValue({
        ok: true,
        data: {
          source: "finanz_cockpit",
          liquidCashCents: 350_000,
          etfStocksCents: 1_150_000,
          cryptoCents: 0,
          totalPersonalNetWorthCents: 1_500_000,
          fetchedAt: new Date().toISOString(),
        },
      });

    const response = await syncExternal(createSyncRequest({ mode: "auto" }));
    expect(response.status).toBe(200);
    expect(fetchSpy).toHaveBeenCalledTimes(1);

    const body = await response.json();
    expect(body.status).toBe("synced");
    expect(body.snapshot.totalPersonalNetWorthCents).toBe(1_500_000);
  });

  it("skips upstream fetch in auto mode when FINANZ_COCKPIT_SYNC_INTERVAL_MINUTES is 0", async () => {
    process.env.FINANZ_COCKPIT_SYNC_INTERVAL_MINUTES = "0";
    const fetchSpy = vi.spyOn(bridgeClient, "fetchFinanzCockpitSummary");

    const response = await syncExternal(createSyncRequest({ mode: "auto" }));
    expect(response.status).toBe(200);
    expect(fetchSpy).not.toHaveBeenCalled();

    const body = await response.json();
    expect(body).toMatchObject({
      status: "skipped",
      reason: "disabled",
      snapshot: null,
    });
  });

  it("returns 502 offline_fallback and keeps latest snapshot when auto sync fails upstream", async () => {
    const staleTimestamp = new Date(Date.now() - 30 * 60_000).toISOString();
    const existing = insertExternalSnapshot({
      source: "finanz_cockpit",
      liquidCashCents: 150_000,
      etfStocksCents: 750_000,
      cryptoCents: 0,
      totalPersonalNetWorthCents: 900_000,
      fetchedAt: staleTimestamp,
    });

    vi.spyOn(bridgeClient, "fetchFinanzCockpitSummary").mockResolvedValue({
      ok: false,
      code: "http_error",
      httpStatus: 500,
      message: "finanz_cockpit antwortete mit HTTP 500.",
    });

    const response = await syncExternal(createSyncRequest({ mode: "auto" }));
    expect(response.status).toBe(502);

    const body = await response.json();
    expect(body.status).toBe("offline_fallback");
    expect(body.snapshot?.id).toBe(existing.id);
    expect(getLatestExternalSnapshot()?.id).toBe(existing.id);
  });

  it("forces upstream sync in manual mode even when snapshot is fresh", async () => {
    const freshTimestamp = new Date(Date.now() - 60_000).toISOString();
    insertExternalSnapshot({
      source: "finanz_cockpit",
      liquidCashCents: 100_000,
      etfStocksCents: 400_000,
      cryptoCents: 0,
      totalPersonalNetWorthCents: 500_000,
      fetchedAt: freshTimestamp,
    });

    const fetchSpy = vi
      .spyOn(bridgeClient, "fetchFinanzCockpitSummary")
      .mockResolvedValue({
        ok: true,
        data: {
          source: "finanz_cockpit",
          liquidCashCents: 250_000,
          etfStocksCents: 550_000,
          cryptoCents: 0,
          totalPersonalNetWorthCents: 800_000,
          fetchedAt: new Date().toISOString(),
        },
      });

    const response = await syncExternal(createSyncRequest({ mode: "manual" }));
    expect(response.status).toBe(200);
    expect(fetchSpy).toHaveBeenCalledTimes(1);

    const body = await response.json();
    expect(body.status).toBe("synced");
    expect(body.snapshot.totalPersonalNetWorthCents).toBe(800_000);
  });

  it("returns 400 on invalid JSON body or invalid sync mode", async () => {
    const invalidJsonResponse = await syncExternal(
      createSyncRequest("{invalid-json"),
    );
    expect(invalidJsonResponse.status).toBe(400);

    const invalidModeResponse = await syncExternal(
      createSyncRequest({ mode: "background" }),
    );
    expect(invalidModeResponse.status).toBe(400);
  });

  it("persists and roundtrips household_json in external_snapshots on sync", async () => {
    const household = {
      balanceCents: 425_000,
      recurringInflowCents: 460_000,
      recurringOutflowCents: 195_000,
      variableBudgetsCents: 95_000,
      variableRollingAvg3MCents: 104_500,
      variableRollingAvg6MCents: 99_200,
      categoriesBreakdown: [
        {
          categoryId: "cat-lebensmittel",
          categoryName: "Lebensmittel",
          color: "#059669",
          budgetCents: 60_000,
          avg3MCents: 61_500,
          avg6MCents: 58_200,
        },
      ],
    };

    vi.spyOn(bridgeClient, "fetchFinanzCockpitSummary").mockResolvedValue({
      ok: true,
      data: {
        source: "finanz_cockpit",
        liquidCashCents: 200_000,
        etfStocksCents: 500_000,
        cryptoCents: 0,
        totalPersonalNetWorthCents: 700_000,
        fetchedAt: "2026-11-17T12:00:00.000Z",
        household,
      },
    });

    const response = await syncExternal(createSyncRequest({ mode: "manual" }));
    expect(response.status).toBe(200);

    const latest = getLatestExternalSnapshot();
    expect(latest).not.toBeNull();
    expect(parseSnapshotHousehold(latest)).toEqual(household);
    expect(
      parseSnapshotHousehold({ householdJson: "{corrupt-json" }),
    ).toBeNull();
  });

  describe("pot sync", () => {
    const account = (id: string, scope: "household" | "personal", balanceCents: number, holdingsValueCents = 0) => ({
      id,
      name: `Muster ${id}`,
      type: "checking" as const,
      scope,
      balanceCents,
      holdingsValueCents,
    });

    function mockSummary(
      fetchedAt: string,
      extra: Record<string, unknown> = {},
    ) {
      vi.spyOn(bridgeClient, "fetchFinanzCockpitSummary").mockResolvedValue({
        ok: true,
        data: {
          source: "finanz_cockpit",
          liquidCashCents: 0,
          etfStocksCents: 0,
          cryptoCents: 0,
          totalPersonalNetWorthCents: 0,
          fetchedAt,
          ...extra,
        } as never,
      });
    }

    function makePot(name: string, externalLink: { kind: "account" | "position"; ref: string } | null, currentCents = 0) {
      const created = createPot(
        potCreateSchema.parse({
          name,
          ruleType: "fill_to_target",
          targetCents: 1_000_000,
          currentCents,
        }),
      );
      if (externalLink) {
        // Direct DB write: simulates an existing link regardless of snapshot availability.
        dbModule
          .getDb()
          .update(pots)
          .set({ externalLinkKind: externalLink.kind, externalLinkRef: externalLink.ref })
          .where(eq(pots.id, created.id))
          .run();
      }
      return created;
    }

    it("updates linked pots, never touches virtual pots, and reports potSync counts", async () => {
      const virtual = makePot("Virtuell", null, 50_000);
      const linkedAcc = makePot("Konto", { kind: "account", ref: "acc-1" }, 1);
      const linkedSame = makePot("Gleich", { kind: "account", ref: "acc-2" }, 7_000);
      const linkedGone = makePot("Weg", { kind: "account", ref: "acc-gone" }, 9_000);
      const virtualBefore = getPotById(virtual.id);

      mockSummary("2026-11-17T09:00:00.000Z", {
        accounts: [account("acc-1", "household", 120_000, 30_000), account("acc-2", "household", 7_000)],
        positions: [],
      });

      const response = await syncExternal();
      const body = await response.json();
      expect(body.status).toBe("synced");
      expect(body.potSync).toEqual({ updated: 1, unchanged: 1, missing: [linkedGone.id], conflicts: [], outOfScope: [], clamped: [] });

      expect(getPotById(virtual.id)).toEqual(virtualBefore);
      expect(getPotById(linkedAcc.id)).toMatchObject({
        currentCents: 150_000,
        externalLinkScope: "household",
        externalSyncedAt: "2026-11-17T09:00:00.000Z",
      });
      expect(getPotById(linkedSame.id)).toMatchObject({
        currentCents: 7_000,
        externalLinkScope: "household",
        externalSyncedAt: "2026-11-17T09:00:00.000Z",
      });
      expect(getPotById(linkedGone.id)).toMatchObject({
        currentCents: 9_000,
        externalLinkScope: null,
        externalSyncedAt: null,
      });
    });

    it("keeps stand and syncedAt of a pot whose target vanished in a later snapshot", async () => {
      const pot = makePot("Konto", { kind: "account", ref: "acc-1" });
      mockSummary("2026-11-17T09:00:00.000Z", { accounts: [account("acc-1", "household", 5_000)], positions: [] });
      await syncExternal();
      expect(getPotById(pot.id)?.currentCents).toBe(5_000);

      vi.restoreAllMocks();
      mockSummary("2026-11-17T10:00:00.000Z", { accounts: [], positions: [] });
      const body = await (await syncExternal()).json();
      expect(body.potSync.missing).toEqual([pot.id]);
      expect(getPotById(pot.id)).toMatchObject({
        currentCents: 5_000,
        externalSyncedAt: "2026-11-17T09:00:00.000Z",
      });
    });

    it("keeps personal-linked pots untouched, flags them in potSync.outOfScope and updates household pots", async () => {
      const hh = makePot("Haushalt", { kind: "account", ref: "acc-hh-1" }, 1);
      const pr = makePot("Privat", { kind: "account", ref: "acc-pr-1" }, 4_000);
      const prBefore = getPotById(pr.id);

      mockSummary("2026-11-17T09:00:00.000Z", {
        accounts: [account("acc-hh-1", "household", 20_000), account("acc-pr-1", "personal", 900_000)],
        positions: [],
      });

      const body = await (await syncExternal()).json();
      expect(body.potSync).toEqual({ updated: 1, unchanged: 0, missing: [], conflicts: [], outOfScope: [pr.id], clamped: [] });
      expect(getPotById(hh.id)).toMatchObject({ currentCents: 20_000, externalLinkScope: "household" });
      expect(getPotById(pr.id)).toMatchObject({
        currentCents: 4_000,
        externalLinkScope: "personal",
        externalSyncedAt: prBefore?.externalSyncedAt ?? null,
      });
    });

    it("tolerates an older payload without accounts/positions", async () => {
      const pot = makePot("Konto", { kind: "account", ref: "acc-1" }, 3_000);
      mockSummary("2026-11-17T09:00:00.000Z");
      const response = await syncExternal();
      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.potSync).toEqual({ updated: 0, unchanged: 0, missing: [pot.id], conflicts: [], outOfScope: [], clamped: [] });
      expect(getPotById(pot.id)?.currentCents).toBe(3_000);
    });

    it("does not touch pots when finanz_cockpit is offline or unconfigured", async () => {
      const pot = makePot("Konto", { kind: "account", ref: "acc-1" }, 3_000);
      const before = getPotById(pot.id);

      for (const code of ["network_error", "not_configured"] as const) {
        vi.restoreAllMocks();
        vi.spyOn(bridgeClient, "fetchFinanzCockpitSummary").mockResolvedValue({
          ok: false,
          code,
          message: "nicht erreichbar",
        });
        const response = await syncExternal();
        expect([502, 503]).toContain(response.status);
        expect((await response.json()).potSync).toBeUndefined();
        expect(getPotById(pot.id)).toEqual(before);
      }
    });

    it("does not sync pots when auto mode skips a fresh snapshot", async () => {
      process.env.FINANZ_COCKPIT_SYNC_INTERVAL_MINUTES = "60";
      const pot = makePot("Konto", { kind: "account", ref: "acc-1" }, 3_000);
      insertExternalSnapshot({
        source: "finanz_cockpit",
        liquidCashCents: 0,
        etfStocksCents: 0,
        cryptoCents: 0,
        totalPersonalNetWorthCents: 0,
        fetchedAt: new Date().toISOString(),
        accounts: [account("acc-1", "household", 99_000)],
        positions: [],
      });
      const fetchSpy = vi.spyOn(bridgeClient, "fetchFinanzCockpitSummary");

      const body = await (await syncExternal(createSyncRequest({ mode: "auto" }))).json();
      expect(body.status).toBe("skipped");
      expect(body.potSync).toBeUndefined();
      expect(fetchSpy).not.toHaveBeenCalled();
      expect(getPotById(pot.id)?.currentCents).toBe(3_000);
    });

    it("reports clamped (overdrawn) linked pots in the potSync response", async () => {
      const pot = makePot("Dispo", { kind: "account", ref: "acc-1" }, 500);
      mockSummary("2026-11-17T09:00:00.000Z", { accounts: [account("acc-1", "household", -2_000)], positions: [] });
      const body = await (await syncExternal()).json();
      expect(body.potSync.clamped).toEqual([pot.id]);
      expect(getPotById(pot.id)?.currentCents).toBe(0);

      vi.restoreAllMocks();
      mockSummary("2026-11-17T10:00:00.000Z", { accounts: [account("acc-1", "household", -5)], positions: [] });
      const again = await (await syncExternal()).json();
      expect(again.potSync).toMatchObject({ unchanged: 1, clamped: [pot.id] });
    });

    it("is atomic: a failing pot sync stores no snapshot and leaves pots untouched", async () => {
      const pot = makePot("Konto", { kind: "account", ref: "acc-1" }, 3_000);
      // Corrupt stand (REAL value) makes computePotSyncPlan throw a RangeError.
      dbModule
        .getDb()
        .run(sql`UPDATE pots SET current_cents = 10.5 WHERE id = ${pot.id}`);
      mockSummary("2026-11-17T09:00:00.000Z", { accounts: [account("acc-1", "household", 5_000)], positions: [] });

      const response = await syncExternal();
      expect(response.status).toBe(500);
      expect(getLatestExternalSnapshot()).toBeNull();
      expect(getPotById(pot.id)?.externalSyncedAt).toBeNull();
    });

    it("survives a position moving into a linked account: 200, snapshot stored, conflict reported, others synced", async () => {
      const position = (accountId: string) => ({
        id: "pos-1", accountId, symbol: "MSTR", isin: null, name: "Muster-ETF", assetClass: "etf",
        marketValueCents: 4_000, costBasisCents: null, lastPriceAt: null,
      });
      const accountPot = makePot("Depot", { kind: "account", ref: "acc-depot" }, 1);
      const positionPot = makePot("ETF", { kind: "position", ref: "pos-1" }, 2);
      const otherPot = makePot("Giro", { kind: "account", ref: "acc-giro" }, 3);

      mockSummary("2026-11-17T09:00:00.000Z", {
        accounts: [account("acc-depot", "household", 100, 4_000), account("acc-giro", "household", 700), account("acc-other", "household", 0)],
        positions: [position("acc-other")],
      });
      const first = await (await syncExternal()).json();
      expect(first.potSync.conflicts).toEqual([]);
      expect(getPotById(positionPot.id)?.currentCents).toBe(4_000);

      // Between two syncs the position moves into the linked account.
      vi.restoreAllMocks();
      mockSummary("2026-11-17T10:00:00.000Z", {
        accounts: [account("acc-depot", "household", 200, 4_000), account("acc-giro", "household", 900), account("acc-other", "household", 0)],
        positions: [position("acc-depot")],
      });
      const response = await syncExternal();
      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.potSync.conflicts).toEqual([positionPot.id]);
      expect(getLatestExternalSnapshot()?.fetchedAt).toBe("2026-11-17T10:00:00.000Z");
      expect(getPotById(positionPot.id)).toMatchObject({ currentCents: 4_000, externalSyncedAt: "2026-11-17T09:00:00.000Z" });
      expect(getPotById(accountPot.id)?.currentCents).toBe(4_200);
      expect(getPotById(otherPot.id)?.currentCents).toBe(900);
    });

    it("stores balanceAsOf as externalSyncedAt and falls back to fetchedAt when unknown", async () => {
      const dated = makePot("Datiert", { kind: "account", ref: "acc-1" });
      const undated = makePot("Undatiert", { kind: "account", ref: "acc-2" });
      mockSummary("2026-11-17T09:00:00.000Z", {
        accounts: [
          { ...account("acc-1", "household", 10), balanceAsOf: "2026-11-17T06:00:00.000Z" },
          account("acc-2", "household", 20),
        ],
        positions: [],
      });
      await syncExternal();
      expect(getPotById(dated.id)?.externalSyncedAt).toBe("2026-11-17T06:00:00.000Z");
      expect(getPotById(undated.id)?.externalSyncedAt).toBe("2026-11-17T09:00:00.000Z");
    });

    it("persists accounts/positions JSON and parses corrupt JSON to []", async () => {
      mockSummary("2026-11-17T09:00:00.000Z", {
        accounts: [account("acc-1", "household", 100)],
        positions: [],
      });
      await syncExternal();
      const latest = getLatestExternalSnapshot();
      expect(parseSnapshotAccounts(latest)).toHaveLength(1);
      expect(parseSnapshotPositions(latest)).toEqual([]);
      expect(parseSnapshotAccounts({ accountsJson: "{corrupt" })).toEqual([]);
      expect(parseSnapshotAccounts({ accountsJson: '[{"id":1}]' })).toEqual([]);
      expect(parseSnapshotAccounts({ accountsJson: null })).toEqual([]);
      expect(listPots()).toEqual([]);
    });
  });

  describe("balance history snapshot hook", () => {
    it("records a daily balance snapshot on successful sync when balance is non-empty", async () => {
      createPot(
        potCreateSchema.parse({
          name: "Notgroschen",
          currentCents: 250_000,
          targetCents: 500_000,
          ruleType: "fill_to_target",
        }),
      );
      vi.spyOn(bridgeClient, "fetchFinanzCockpitSummary").mockResolvedValue({
        ok: true,
        data: {
          source: "finanz_cockpit",
          liquidCashCents: 100_000,
          etfStocksCents: 0,
          cryptoCents: 0,
          totalPersonalNetWorthCents: 100_000,
          fetchedAt: new Date().toISOString(),
        },
      });

      const response = await syncExternal(createSyncRequest({ mode: "manual" }));
      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.status).toBe("synced");
      expect(body.historyRecorded).toBe(true);
      const snapshots = listBalanceSnapshots();
      expect(snapshots).toHaveLength(1);
      expect(snapshots[0]?.date).toBe(getTodayIsoDate());
    });

    it("keeps 200 synced with historyRecorded=false when runBalanceSnapshotJob throws", async () => {
      createPot(
        potCreateSchema.parse({
          name: "Notgroschen",
          currentCents: 250_000,
          targetCents: 500_000,
          ruleType: "fill_to_target",
        }),
      );
      vi.spyOn(bridgeClient, "fetchFinanzCockpitSummary").mockResolvedValue({
        ok: true,
        data: {
          source: "finanz_cockpit",
          liquidCashCents: 100_000,
          etfStocksCents: 0,
          cryptoCents: 0,
          totalPersonalNetWorthCents: 100_000,
          fetchedAt: new Date().toISOString(),
        },
      });
      const spy = vi
        .spyOn(balanceSnapshotJob, "runBalanceSnapshotJob")
        .mockRejectedValue(new Error("snapshot boom"));

      const response = await syncExternal(createSyncRequest({ mode: "manual" }));
      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.status).toBe("synced");
      expect(body.historyRecorded).toBe(false);
      expect(spy).toHaveBeenCalledWith({ trigger: "sync" });
    });

    it("does not write a balance snapshot on skipped/fresh, offline_fallback, or unconfigured", async () => {
      createPot(
        potCreateSchema.parse({
          name: "Notgroschen",
          currentCents: 250_000,
          targetCents: 500_000,
          ruleType: "fill_to_target",
        }),
      );

      // 1) unconfigured
      vi.spyOn(bridgeClient, "fetchFinanzCockpitSummary").mockResolvedValue({
        ok: false,
        code: "not_configured",
        message: "Nicht konfiguriert.",
      });
      const unconf = await syncExternal(createSyncRequest({ mode: "manual" }));
      expect(unconf.status).toBe(503);

      // 2) offline_fallback
      vi.spyOn(bridgeClient, "fetchFinanzCockpitSummary").mockResolvedValue({
        ok: false,
        code: "http_error",
        httpStatus: 500,
        message: "Fehler",
      });
      const fallback = await syncExternal(createSyncRequest({ mode: "manual" }));
      expect(fallback.status).toBe(502);

      // 3) skipped fresh
      insertExternalSnapshot({
        source: "finanz_cockpit",
        liquidCashCents: 100_000,
        etfStocksCents: 0,
        cryptoCents: 0,
        totalPersonalNetWorthCents: 100_000,
        fetchedAt: new Date().toISOString(),
      });
      const skipped = await syncExternal(createSyncRequest({ mode: "auto" }));
      expect(skipped.status).toBe(200);
      expect((await skipped.json()).status).toBe("skipped");

      expect(listBalanceSnapshots()).toEqual([]);
    });
  });
});
