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

beforeEach(() => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "coruscant-sync-"));
  tempDirs.push(dir);
  process.env.DATABASE_URL = path.join(dir, "test.db");
});

afterEach(() => {
  vi.restoreAllMocks();
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
});
