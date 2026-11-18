import { afterEach, describe, expect, it, vi } from "vitest";
import { getBerlinClockSnapshot } from "./berlin-clock";
import {
  getDueDailyJobSlots,
  getSchedulerStatusSnapshot,
  isValuationJobEnabled,
  resetSchedulerStateForTests,
  runScheduledJob,
  shouldStartBackgroundScheduler,
} from "./scheduler";

afterEach(() => {
  resetSchedulerStateForTests();
});

describe("scheduler & berlin-clock", () => {
  it("blocks background scheduler in edge, build, test, and DISABLE_SCHEDULER=1", () => {
    expect(
      shouldStartBackgroundScheduler({ NODE_ENV: "production", NEXT_RUNTIME: "edge" }),
    ).toBe(false);
    expect(
      shouldStartBackgroundScheduler({
        NODE_ENV: "production",
        NEXT_PHASE: "phase-production-build",
      }),
    ).toBe(false);
    expect(shouldStartBackgroundScheduler({ NODE_ENV: "test" })).toBe(false);
    expect(
      shouldStartBackgroundScheduler({ NODE_ENV: "production", VITEST: "true" }),
    ).toBe(false);
    expect(
      shouldStartBackgroundScheduler({
        NODE_ENV: "production",
        DISABLE_SCHEDULER: "1",
      }),
    ).toBe(false);
    expect(
      shouldStartBackgroundScheduler({ NODE_ENV: "production" }),
    ).toBe(true);
  });

  it("enables valuation job in production or dev with ENABLE_VALUATION_SCHEDULER=1", () => {
    expect(isValuationJobEnabled({ NODE_ENV: "development" })).toBe(false);
    expect(
      isValuationJobEnabled({
        NODE_ENV: "development",
        ENABLE_VALUATION_SCHEDULER: "1",
      }),
    ).toBe(true);
    expect(isValuationJobEnabled({ NODE_ENV: "production" })).toBe(true);
  });

  it("handles DST transitions in Europe/Berlin accurately", () => {
    // 2026-03-29: CET -> CEST (01:30 UTC = 03:30 CEST; 02:30 UTC = 04:30 CEST)
    const summer = getBerlinClockSnapshot(new Date("2026-03-29T02:30:00Z"));
    expect(summer).toEqual({
      dateKey: "2026-03-29",
      hour: 4,
      minute: 30,
      slotKey: "2026-03-29 04:30",
    });

    // 2026-10-25: CEST -> CET (03:30 UTC = 04:30 CET)
    const winter = getBerlinClockSnapshot(new Date("2026-10-25T03:30:00Z"));
    expect(winter).toEqual({
      dateKey: "2026-10-25",
      hour: 4,
      minute: 30,
      slotKey: "2026-10-25 04:30",
    });
  });

  it("matches 04:30 Berlin slot once per slotKey", () => {
    const clock = getBerlinClockSnapshot(new Date("2026-11-18T03:30:00Z"));
    const triggered = new Map<"property_valuation", string>();
    expect(getDueDailyJobSlots(clock, triggered)).toEqual(["property_valuation"]);

    triggered.set("property_valuation", clock.slotKey);
    expect(getDueDailyJobSlots(clock, triggered)).toEqual([]);
  });

  it("prevents concurrent runs via inFlightJobs", async () => {
    let resolveRun!: () => void;
    const runner = vi.fn(
      () =>
        new Promise<{
          status: "success";
          message: string;
          processed: number;
          written: number;
          historyOnly: number;
          failed: number;
        }>((resolve) => {
          resolveRun = () =>
            resolve({
              status: "success",
              message: "ok",
              processed: 0,
              written: 0,
              historyOnly: 0,
              failed: 0,
            });
        }),
    );

    const firstPromise = runScheduledJob("property_valuation", {
      env: { NODE_ENV: "production" },
      runner,
    });
    const secondResult = await runScheduledJob("property_valuation", {
      env: { NODE_ENV: "production" },
      runner,
    });

    expect(secondResult).toBeNull();
    expect(runner).toHaveBeenCalledTimes(1);

    resolveRun();
    await firstPromise;
  });

  it("includes property_valuation with enabled flag in status snapshot", () => {
    const snap = getSchedulerStatusSnapshot(
      new Date("2026-11-18T02:00:00Z"),
      { NODE_ENV: "development" },
    );
    expect(snap.jobs).toHaveLength(1);
    expect(snap.jobs[0]).toMatchObject({
      jobId: "property_valuation",
      enabled: false,
      nextSlotAt: "2026-11-18 04:30",
    });
  });
});
