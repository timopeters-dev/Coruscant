import {
  getBerlinClockSnapshot,
  type BerlinClockSnapshot,
} from "./berlin-clock";
import { runBalanceSnapshotJob } from "./balance-snapshot-job";
import {
  runAutoValuationJob,
  type JobRunSummary,
} from "./property-valuation-job";

export type SchedulerJobId = "property_valuation" | "balance_snapshot";

export interface DailySlotTime {
  hour: number;
  minute: number;
}

export interface DailyJobSlotConfig {
  jobId: SchedulerJobId;
  times: readonly DailySlotTime[];
}

export const DAILY_JOB_SLOTS: readonly DailyJobSlotConfig[] = [
  {
    jobId: "property_valuation",
    times: [{ hour: 4, minute: 30 }],
  },
  {
    jobId: "balance_snapshot",
    times: [{ hour: 23, minute: 45 }],
  },
] as const;

const ORDERED_JOB_IDS: readonly SchedulerJobId[] = [
  "property_valuation",
  "balance_snapshot",
];

interface RegisteredJob {
  isEnabled(env: NodeJS.ProcessEnv): boolean;
  run(ctx: {
    now: Date;
    env: NodeJS.ProcessEnv;
    trigger: "scheduler" | "startup";
  }): Promise<JobRunSummary>;
  disabledMessage: string;
}

const JOBS: Record<SchedulerJobId, RegisteredJob> = {
  property_valuation: {
    isEnabled: isValuationJobEnabled,
    run: ({ now, env }) => runAutoValuationJob({ now, env }),
    disabledMessage: "Dev: Opt-in mit ENABLE_VALUATION_SCHEDULER=1",
  },
  balance_snapshot: {
    isEnabled: () => true,
    run: ({ now, trigger }) => runBalanceSnapshotJob({ now, trigger }),
    disabledMessage: "Deaktiviert.",
  },
};

export interface SchedulerJobStatus {
  jobId: SchedulerJobId;
  enabled: boolean;
  lastStatus: JobRunSummary["status"] | null;
  lastRunAt: string | null;
  message: string;
  nextSlotAt: string;
}

export interface SchedulerStatusSnapshot {
  running: boolean;
  jobs: SchedulerJobStatus[];
}

interface SchedulerState {
  started: boolean;
  minuteTimer: ReturnType<typeof setInterval> | null;
  startupTimers: Array<ReturnType<typeof setTimeout>>;
  inFlightJobs: Set<SchedulerJobId>;
  lastTriggeredSlotByJob: Map<SchedulerJobId, string>;
  jobs: Record<
    SchedulerJobId,
    {
      lastStatus: JobRunSummary["status"] | null;
      lastRunAt: string | null;
      message: string | null;
    }
  >;
}

declare global {
  var __coruscantScheduler: SchedulerState | undefined;
}

function getSchedulerState(): SchedulerState {
  if (!globalThis.__coruscantScheduler) {
    globalThis.__coruscantScheduler = {
      started: false,
      minuteTimer: null,
      startupTimers: [],
      inFlightJobs: new Set(),
      lastTriggeredSlotByJob: new Map(),
      jobs: {
        property_valuation: {
          lastStatus: null,
          lastRunAt: null,
          message: null,
        },
        balance_snapshot: {
          lastStatus: null,
          lastRunAt: null,
          message: null,
        },
      },
    };
  }
  return globalThis.__coruscantScheduler;
}

export function resetSchedulerStateForTests(): void {
  stopBackgroundScheduler();
  globalThis.__coruscantScheduler = undefined;
}

export function shouldStartBackgroundScheduler(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  if (env.NEXT_RUNTIME === "edge") return false;
  if (env.NEXT_PHASE === "phase-production-build") return false;
  if (env.NODE_ENV === "test" || Boolean(env.VITEST)) return false;
  if (env.DISABLE_SCHEDULER === "1") return false;
  return true;
}

export function isValuationJobEnabled(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return (
    env.NODE_ENV === "production" || env.ENABLE_VALUATION_SCHEDULER === "1"
  );
}

export function getDueDailyJobSlots(
  clock: BerlinClockSnapshot,
  lastTriggeredSlotByJob: ReadonlyMap<SchedulerJobId, string>,
): SchedulerJobId[] {
  const due: SchedulerJobId[] = [];
  for (const config of DAILY_JOB_SLOTS) {
    const matchesTime = config.times.some(
      (t) => t.hour === clock.hour && t.minute === clock.minute,
    );
    if (!matchesTime) {
      continue;
    }
    if (lastTriggeredSlotByJob.get(config.jobId) === clock.slotKey) {
      continue;
    }
    due.push(config.jobId);
  }
  return due;
}

export async function runScheduledJob(
  jobId: SchedulerJobId,
  options: {
    now?: Date;
    env?: NodeJS.ProcessEnv;
    trigger?: "scheduler" | "startup";
    runner?: () => Promise<JobRunSummary>;
  } = {},
): Promise<JobRunSummary | null> {
  const state = getSchedulerState();
  const env = options.env ?? process.env;
  const job = JOBS[jobId];

  if (!job.isEnabled(env)) {
    state.jobs[jobId] = {
      lastStatus: "skipped",
      lastRunAt: (options.now ?? new Date()).toISOString(),
      message: job.disabledMessage,
    };
    return null;
  }

  if (state.inFlightJobs.has(jobId)) {
    return null;
  }

  state.inFlightJobs.add(jobId);
  const now = options.now ?? new Date();
  const trigger = options.trigger ?? "scheduler";
  try {
    const summary = options.runner
      ? await options.runner()
      : await job.run({ now, env, trigger });
    state.jobs[jobId] = {
      lastStatus: summary.status,
      lastRunAt: now.toISOString(),
      message: summary.message,
    };
    return summary;
  } catch (error) {
    state.jobs[jobId] = {
      lastStatus: "error",
      lastRunAt: now.toISOString(),
      message: error instanceof Error ? error.message : "Unbekannter Fehler.",
    };
    return null;
  } finally {
    state.inFlightJobs.delete(jobId);
  }
}

async function tickScheduler(): Promise<void> {
  const state = getSchedulerState();
  const now = new Date();
  const clock = getBerlinClockSnapshot(now);
  const dueJobs = getDueDailyJobSlots(clock, state.lastTriggeredSlotByJob);

  for (const jobId of dueJobs) {
    state.lastTriggeredSlotByJob.set(jobId, clock.slotKey);
    await runScheduledJob(jobId, { now });
  }
}

export function startBackgroundScheduler(
  env: NodeJS.ProcessEnv = process.env,
): void {
  if (!shouldStartBackgroundScheduler(env)) {
    return;
  }
  const state = getSchedulerState();
  if (state.started) {
    return;
  }
  state.started = true;

  state.minuteTimer = setInterval(() => {
    void tickScheduler();
  }, 60_000);
  state.minuteTimer.unref();

  const valuationStartup = setTimeout(() => {
    void runScheduledJob("property_valuation", { trigger: "startup" });
  }, 120_000);
  valuationStartup.unref();

  const balanceStartup = setTimeout(() => {
    void runScheduledJob("balance_snapshot", { trigger: "startup" });
  }, 30_000);
  balanceStartup.unref();

  state.startupTimers.push(valuationStartup, balanceStartup);
}

export function stopBackgroundScheduler(): void {
  const state = getSchedulerState();
  if (state.minuteTimer) {
    clearInterval(state.minuteTimer);
    state.minuteTimer = null;
  }
  for (const timer of state.startupTimers) {
    clearTimeout(timer);
  }
  state.startupTimers = [];
  state.started = false;
}

function formatNextSlot(
  clock: BerlinClockSnapshot,
  times: readonly DailySlotTime[],
): string {
  const sorted = [...times].sort(
    (a, b) => a.hour * 60 + a.minute - (b.hour * 60 + b.minute),
  );
  const currentMinutes = clock.hour * 60 + clock.minute;
  const upcomingToday = sorted.find(
    (t) => t.hour * 60 + t.minute > currentMinutes,
  );
  const pad = (n: number) => String(n).padStart(2, "0");
  if (upcomingToday) {
    return `${clock.dateKey} ${pad(upcomingToday.hour)}:${pad(upcomingToday.minute)}`;
  }
  const first = sorted[0];
  if (!first) return "—";
  return `nächster Tag ${pad(first.hour)}:${pad(first.minute)}`;
}

export function getSchedulerStatusSnapshot(
  now: Date = new Date(),
  env: NodeJS.ProcessEnv = process.env,
): SchedulerStatusSnapshot {
  const state = getSchedulerState();
  const clock = getBerlinClockSnapshot(now);

  const jobs: SchedulerJobStatus[] = ORDERED_JOB_IDS.map((jobId) => {
    const job = JOBS[jobId];
    const enabled = job.isEnabled(env);
    const jobState = state.jobs[jobId];
    const slotConfig = DAILY_JOB_SLOTS.find((s) => s.jobId === jobId);
    const nextSlotAt = slotConfig
      ? formatNextSlot(clock, slotConfig.times)
      : "—";

    return {
      jobId,
      enabled,
      lastStatus: jobState.lastStatus,
      lastRunAt: jobState.lastRunAt,
      message:
        jobState.message ?? (enabled ? "Bereit." : job.disabledMessage),
      nextSlotAt,
    };
  });

  return {
    running: state.started,
    jobs,
  };
}
