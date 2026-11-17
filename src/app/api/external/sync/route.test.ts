import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as dbModule from "@/db";
import {
  getLatestExternalSnapshot,
  insertExternalSnapshot,
} from "@/db/queries/cockpit";
import * as cockpitQueries from "@/db/queries/cockpit";
import * as bridgeClient from "@/lib/integrations/finanz-cockpit-client";
import { POST as syncExternal } from "./route";

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
    vi.spyOn(cockpitQueries, "insertExternalSnapshot").mockImplementation(() => {
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
});
