import {
  getBerlinClockSnapshot,
  type BerlinClockSnapshot,
} from "./berlin-clock";
import {
  runAutoValuationJob,
  type JobRunSummary,
} from "./property-valuation-job";

export type SchedulerJobId = "property_valuation";

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
] as const;

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
  startupTimer: ReturnType<typeof setTimeout> | null;
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
      startupTimer: null,
      inFlightJobs: new Set(),
      lastTriggeredSlotByJob: new Map(),
      jobs: {
        property_valuation: {
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
    runner?: () => Promise<JobRunSummary>;
  } = {},
): Promise<JobRunSummary | null> {
  const state = getSchedulerState();
  const env = options.env ?? process.env;

  if (!isValuationJobEnabled(env)) {
    state.jobs[jobId] = {
      lastStatus: "skipped",
      lastRunAt: (options.now ?? new Date()).toISOString(),
      message: "Dev: Opt-in mit ENABLE_VALUATION_SCHEDULER=1",
    };
    return null;
  }

  if (state.inFlightJobs.has(jobId)) {
    return null;
  }

  state.inFlightJobs.add(jobId);
  const now = options.now ?? new Date();
  try {
    const summary = options.runner
      ? await options.runner()
      : await runAutoValuationJob({ now, env });
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

  state.startupTimer = setTimeout(() => {
    void runScheduledJob("property_valuation");
  }, 120_000);
  state.startupTimer.unref();
}

export function stopBackgroundScheduler(): void {
  const state = getSchedulerState();
  if (state.minuteTimer) {
    clearInterval(state.minuteTimer);
    state.minuteTimer = null;
  }
  if (state.startupTimer) {
    clearTimeout(state.startupTimer);
    state.startupTimer = null;
  }
  state.started = false;
}

export function getSchedulerStatusSnapshot(
  now: Date = new Date(),
  env: NodeJS.ProcessEnv = process.env,
): SchedulerStatusSnapshot {
  const state = getSchedulerState();
  const clock = getBerlinClockSnapshot(now);
  const enabled = isValuationJobEnabled(env);
  const jobState = state.jobs.property_valuation;

  const isBeforeTodaySlot =
    clock.hour < 4 || (clock.hour === 4 && clock.minute < 30);
  const nextSlotAt = isBeforeTodaySlot
    ? `${clock.dateKey} 04:30`
    : "nächster Tag 04:30";

  return {
    running: state.started,
    jobs: [
      {
        jobId: "property_valuation",
        enabled,
        lastStatus: jobState.lastStatus,
        lastRunAt: jobState.lastRunAt,
        message:
          jobState.message ??
          (enabled
            ? "Bereit."
            : "Dev: Opt-in mit ENABLE_VALUATION_SCHEDULER=1"),
        nextSlotAt,
      },
    ],
  };
}
