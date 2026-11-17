import { describe, expect, it } from "vitest";
import {
  DEFAULT_FINANZ_COCKPIT_SYNC_INTERVAL_MINUTES,
  MAX_FINANZ_COCKPIT_SYNC_INTERVAL_MINUTES,
  MIN_CLOCK_SKEW_RETRY_DELAY_MS,
  computeNextAutoSyncDelayMs,
  evaluateSnapshotFreshness,
  resolveInitialLastAutoAttemptMs,
  resolveSkippedFreshReschedule,
  shouldRunAutoSyncOnVisibility,
} from "./external-sync";

describe("evaluateSnapshotFreshness", () => {
  const baseNow = new Date("2026-11-16T12:15:00.000Z");

  it("returns missing with shouldSync=true when latestFetchedAt is null or empty", () => {
    expect(
      evaluateSnapshotFreshness({
        latestFetchedAt: null,
        intervalMinutes: DEFAULT_FINANZ_COCKPIT_SYNC_INTERVAL_MINUTES,
        now: baseNow,
      }),
    ).toEqual({
      status: "missing",
      shouldSync: true,
      ageMs: null,
      nextSyncAtMs: null,
    });

    expect(
      evaluateSnapshotFreshness({
        latestFetchedAt: "   ",
        intervalMinutes: 15,
        now: baseNow,
      }),
    ).toEqual({
      status: "missing",
      shouldSync: true,
      ageMs: null,
      nextSyncAtMs: null,
    });
  });

  it("returns fresh with nextSyncAtMs when snapshot age is below interval", () => {
    const fetchedAt = "2026-11-16T12:01:00.000Z"; // 14 min old
    const fetchedAtMs = Date.parse(fetchedAt);

    expect(
      evaluateSnapshotFreshness({
        latestFetchedAt: fetchedAt,
        intervalMinutes: 15,
        now: baseNow,
      }),
    ).toEqual({
      status: "fresh",
      shouldSync: false,
      ageMs: 14 * 60_000,
      nextSyncAtMs: fetchedAtMs + 15 * 60_000,
    });
  });

  it("returns stale when snapshot age exceeds interval", () => {
    const fetchedAt = "2026-11-16T11:55:00.000Z"; // 20 min old

    expect(
      evaluateSnapshotFreshness({
        latestFetchedAt: fetchedAt,
        intervalMinutes: 15,
        now: baseNow,
      }),
    ).toEqual({
      status: "stale",
      shouldSync: true,
      ageMs: 20 * 60_000,
      nextSyncAtMs: null,
    });
  });

  it("treats exact interval boundary (ageMs === intervalMs) as stale", () => {
    const fetchedAt = "2026-11-16T12:00:00.000Z"; // exactly 15 min old

    expect(
      evaluateSnapshotFreshness({
        latestFetchedAt: fetchedAt,
        intervalMinutes: 15,
        now: baseNow,
      }),
    ).toEqual({
      status: "stale",
      shouldSync: true,
      ageMs: 15 * 60_000,
      nextSyncAtMs: null,
    });
  });

  it("returns disabled with shouldSync=false when intervalMinutes is 0 (even when snapshot is missing)", () => {
    expect(
      evaluateSnapshotFreshness({
        latestFetchedAt: null,
        intervalMinutes: 0,
        now: baseNow,
      }),
    ).toEqual({
      status: "disabled",
      shouldSync: false,
      ageMs: null,
      nextSyncAtMs: null,
    });
  });

  it("returns stale when latestFetchedAt has an invalid date format", () => {
    expect(
      evaluateSnapshotFreshness({
        latestFetchedAt: "not-a-valid-timestamp",
        intervalMinutes: 15,
        now: baseNow,
      }),
    ).toEqual({
      status: "stale",
      shouldSync: true,
      ageMs: null,
      nextSyncAtMs: null,
    });
  });

  it("clamps future timestamps (clock skew) to ageMs=0 and marks fresh", () => {
    const futureFetchedAt = "2026-11-16T12:20:00.000Z";
    const futureMs = Date.parse(futureFetchedAt);

    expect(
      evaluateSnapshotFreshness({
        latestFetchedAt: futureFetchedAt,
        intervalMinutes: 15,
        now: baseNow,
      }),
    ).toEqual({
      status: "fresh",
      shouldSync: false,
      ageMs: 0,
      nextSyncAtMs: futureMs + 15 * 60_000,
    });
  });

  it("throws on negative, non-integer, or out-of-range intervalMinutes", () => {
    expect(() =>
      evaluateSnapshotFreshness({
        latestFetchedAt: null,
        intervalMinutes: -1,
        now: baseNow,
      }),
    ).toThrow();

    expect(() =>
      evaluateSnapshotFreshness({
        latestFetchedAt: null,
        intervalMinutes: 1.5,
        now: baseNow,
      }),
    ).toThrow();

    expect(() =>
      evaluateSnapshotFreshness({
        latestFetchedAt: null,
        intervalMinutes: MAX_FINANZ_COCKPIT_SYNC_INTERVAL_MINUTES + 1,
        now: baseNow,
      }),
    ).toThrow();
  });
});

describe("computeNextAutoSyncDelayMs", () => {
  it("returns 0 immediately when snapshot is stale", () => {
    expect(
      computeNextAutoSyncDelayMs({
        isSnapshotStale: true,
        nextSyncAtMs: null,
        intervalMinutes: 15,
        nowMs: 1_000_000,
      }),
    ).toBe(0);
  });

  it("schedules remaining time until nextSyncAtMs for partially aged fresh snapshots", () => {
    const nowMs = Date.parse("2026-11-16T12:14:00.000Z");
    const nextSyncAtMs = Date.parse("2026-11-16T12:15:00.000Z"); // 1 min remaining

    expect(
      computeNextAutoSyncDelayMs({
        isSnapshotStale: false,
        nextSyncAtMs,
        intervalMinutes: 15,
        nowMs,
      }),
    ).toBe(60_000);
  });

  it("clamps past nextSyncAtMs to 0 and falls back to intervalMs when nextSyncAtMs is null", () => {
    expect(
      computeNextAutoSyncDelayMs({
        isSnapshotStale: false,
        nextSyncAtMs: 900_000,
        intervalMinutes: 15,
        nowMs: 1_000_000,
      }),
    ).toBe(0);

    expect(
      computeNextAutoSyncDelayMs({
        isSnapshotStale: false,
        nextSyncAtMs: null,
        intervalMinutes: 15,
        nowMs: 1_000_000,
      }),
    ).toBe(15 * 60_000);
  });
});

describe("resolveInitialLastAutoAttemptMs & shouldRunAutoSyncOnVisibility", () => {
  it("seeds lastAutoAttemptMs from nextSyncAtMs so visibilitychange before nextSyncAtMs does not re-trigger", () => {
    const intervalMs = 15 * 60_000;
    const loadedAtMs = Date.parse("2026-11-16T12:10:00.000Z");
    const nextSyncAtMs = Date.parse("2026-11-16T12:15:00.000Z"); // 5 min left

    const seededAttemptMs = resolveInitialLastAutoAttemptMs({
      currentLastAttemptMs: 0,
      isSnapshotStale: false,
      nextSyncAtMs,
      intervalMinutes: 15,
    });
    expect(seededAttemptMs).toBe(nextSyncAtMs - intervalMs);

    // Tab becomes visible 2 min after load (3 min before nextSyncAtMs) -> blocked
    expect(
      shouldRunAutoSyncOnVisibility({
        lastAutoAttemptMs: seededAttemptMs,
        intervalMinutes: 15,
        nowMs: loadedAtMs + 2 * 60_000,
      }),
    ).toBe(false);

    // Tab becomes visible exactly at / after nextSyncAtMs -> allowed
    expect(
      shouldRunAutoSyncOnVisibility({
        lastAutoAttemptMs: seededAttemptMs,
        intervalMinutes: 15,
        nowMs: nextSyncAtMs,
      }),
    ).toBe(true);
  });

  it("keeps currentLastAttemptMs when snapshot is stale or disabled", () => {
    expect(
      resolveInitialLastAutoAttemptMs({
        currentLastAttemptMs: 123_456,
        isSnapshotStale: true,
        nextSyncAtMs: null,
        intervalMinutes: 15,
      }),
    ).toBe(123_456);

    expect(
      shouldRunAutoSyncOnVisibility({
        lastAutoAttemptMs: 0,
        intervalMinutes: 0,
        nowMs: 999_999_999,
      }),
    ).toBe(false);
  });
});

describe("resolveSkippedFreshReschedule", () => {
  it("triggers router refresh when skipped response carries a newer snapshot from another tab and schedules remaining time", () => {
    const nowMs = Date.parse("2026-11-16T12:10:00.000Z");
    const newerFetchedAt = "2026-11-16T12:08:00.000Z"; // next sync in 13 min

    const res = resolveSkippedFreshReschedule({
      snapshotFetchedAt: newerFetchedAt,
      latestFetchedAt: "2026-11-16T11:50:00.000Z",
      intervalMinutes: 15,
      nowMs,
    });

    expect(res.shouldRefresh).toBe(true);
    expect(res.nextDelayMs).toBe(13 * 60_000);
    expect(res.nextLastAttemptMs + 15 * 60_000 - nowMs).toBe(13 * 60_000);
  });

  it("applies minimum backoff on clock skew or timer jitter instead of waiting a full second interval", () => {
    const nowMs = Date.parse("2026-11-16T12:14:59.500Z");
    const fetchedAt = "2026-11-16T12:00:00.000Z"; // 500ms before 15m boundary

    const res = resolveSkippedFreshReschedule({
      snapshotFetchedAt: fetchedAt,
      latestFetchedAt: fetchedAt,
      intervalMinutes: 15,
      nowMs,
    });

    expect(res.shouldRefresh).toBe(false);
    expect(res.nextDelayMs).toBe(MIN_CLOCK_SKEW_RETRY_DELAY_MS);
    expect(res.nextLastAttemptMs + 15 * 60_000 - nowMs).toBe(
      MIN_CLOCK_SKEW_RETRY_DELAY_MS,
    );
  });

  it("falls back to full interval when snapshotFetchedAt is missing or invalid", () => {
    const nowMs = Date.parse("2026-11-16T12:00:00.000Z");

    expect(
      resolveSkippedFreshReschedule({
        snapshotFetchedAt: "invalid-date",
        latestFetchedAt: null,
        intervalMinutes: 15,
        nowMs,
      }),
    ).toEqual({
      shouldRefresh: true,
      nextDelayMs: 15 * 60_000,
      nextLastAttemptMs: nowMs,
    });
  });
});
